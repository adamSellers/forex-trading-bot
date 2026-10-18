const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const realNow = performance.now.bind(performance);
const { createReplayTestHarness } = require('../testHarness.cjs');
const { ViabilityMarket, PERIOD } = require('../viabilityMarket.cjs');
const { summarizeViability } = require('../viabilitySummary.cjs');
const { cloneDefaultConfig } = require('../../src/config/tradingConfig');
const { hashReplaySources } = require('../replayManifest.cjs');
const { verifyViabilityRegistration } = require('../viabilityRegistration.cjs');
const configuredSpecPath = process.env.RESEARCH_VIABILITY_SPEC;
const configuredSpec = configuredSpecPath ? JSON.parse(fs.readFileSync(configuredSpecPath, 'utf8')) : null;
const { createPolicyOptimization } = require('../viabilityPolicyOptimization.cjs');
const policyOptimization = createPolicyOptimization();
if (configuredSpec?.policyOptimization === true) for (const [modulePath, name, side] of [
    ['../../src/runtime/intradayBuyRetestPolicy', 'evaluateIntradayBuyRetest', 'BUY'],
    ['../../src/runtime/intradaySellRetestPolicy', 'evaluateIntradaySellRetest', 'SELL'],
]) jest.doMock(modulePath, () => {
    const actual = jest.requireActual(modulePath);
    return { ...actual, [name]: policyOptimization.wrap(actual[name], side) };
});
// Exact-input memoization of the pure calendar export used by both actual
// retest policies. The source implementation still computes each distinct
// timestamp. Overlapping candle windows otherwise reformat identical NY times.
const calendarCache = new Map();
if (process.env.RESEARCH_VIABILITY_CALENDAR_CACHE !== '0') jest.doMock('../../src/runtime/marketDataFreshness', () => {
    const actual = jest.requireActual('../../src/runtime/marketDataFreshness');
    return { ...actual, getForexMarketState: (...args) => {
        if (args.length !== 1 || !Number.isFinite(args[0])) return actual.getForexMarketState(...args);
        if (calendarCache.has(args[0])) return calendarCache.get(args[0]);
        const value = Object.freeze(actual.getForexMarketState(...args));
        calendarCache.set(args[0], value);
        if (calendarCache.size > 20_000) calendarCache.delete(calendarCache.keys().next().value);
        return value;
    } };
});
const env = createReplayTestHarness();
const { getStrategyDefinition } = require('../../src/strategies');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const { needsMinuteScan } = require("../viabilitySchedule.cjs");

function sourceHashes() {
    return hashReplaySources(path.resolve(__dirname, '../../..'));
}

function spreadBars(bars, instrument, spread) {
    if (spread === null) return bars;
    const pips = typeof spread === 'number' ? spread : spread[instrument];
    const half = pips * (instrument.endsWith('_JPY') ? 0.01 : 0.0001) / 2;
    return bars.map((bar) => {
        const mid = bar.mid ?? bar;
        const component = (sign) => Object.fromEntries(['o', 'h', 'l', 'c'].map((key, index) =>
            [key, Number(mid[key] ?? mid[['open', 'high', 'low', 'close'][index]]) + sign * half]));
        return { ...bar, bid: component(-1), ask: component(1) };
    });
}

const specPath = process.env.RESEARCH_VIABILITY_SPEC;
(specPath ? describe : describe.skip)('current v6 retrospective viability experiment', () => {
    test('runs the frozen rules through actual persisted coordinator, entry, risk and exits', async () => {
        const started = realNow(), spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
        const registered = verifyViabilityRegistration({ spec, specPath, root: path.resolve(__dirname, '../../..') });
        const beforeSources = registered.sourceHashes;
        if (spec.schemaVersion !== 1 || spec.evaluationUse !== 'RETROSPECTIVE' || !['OHLC', 'OLHC'].includes(spec.pathOrder)) throw new Error('Explicit retrospective path specification required');
        const archivePath = path.resolve(path.dirname(specPath), spec.archivePath);
        const bytes = fs.readFileSync(archivePath), archiveHash = hash(bytes), archive = JSON.parse(bytes);
        if (archiveHash !== spec.archiveSha256 || (archive.granularity ?? spec.archiveGranularity) !== 'M15' || archive.completeCandlesOnly !== true) throw new Error('Archive provenance/hash mismatch');
        const fromMs = Date.parse(spec.fromUtc), toMs = Date.parse(spec.toUtcExclusive);
        const input = { candlesByInstrument: {}, completedOnlyDeclared: true };
        for (const instrument of spec.assets) {
            const selected = archive.candlesByInstrument[instrument].filter((bar) => bar.time * 1000 >= fromMs - 40 * 86_400_000 && bar.time * 1000 < toMs);
            input.candlesByInstrument[instrument] = spreadBars(selected, instrument, spec.spreadPips);
        }
        const costs = new Map(), equity = [], histogram = {}, candidates = [], waitingAgeMs = {}, uniqueActionable = new Map();
        let actionableEmissions = 0;
        let minuteScans = 0, boundaryScans = 0, managementSamples = 0, droppedSignalRows = 0;
        const point = (quote) => (Number(quote.bids[0].price) + Number(quote.asks[0].price)) / 2;
        const h = await env.replay({ input, assets: spec.assets, startMs: fromMs,
            initialBalanceAud: spec.initialBalanceAud, captureEvents: false,
            brokerOptions: { metadata: registered.instrumentMetadata, slippagePips: spec.slippagePips, commissionAud: spec.commissionAud,
                unrealizedConversionPurpose: spec.unrealizedConversionPurpose },
            marketFactory: ({ clock }) => new ViabilityMarket({ ...input, clock, maxBars: 500,
                pricingAssumptions: { tradeable: true, liquidityUnits: 1_000_000 }, pathOrder: spec.pathOrder, spreadPips: spec.spreadPips,
                homeConversionFeeRate: spec.homeConversionFeeRate }),
            beforeBoot: ({ broker, market }) => {
                // Quote-only trace rows and full events do not govern decisions.
                // Retain every execution/protection/financing transaction.
                const record = broker._record.bind(broker);
                broker._record = (type, details) => { if (type !== 'QUOTE_OBSERVED') record(type, details); };
                const place = broker.placeMarketOrder.bind(broker), close = broker._close.bind(broker);
                broker.placeMarketOrder = async (instrument, units, options) => {
                    const quote = market.getQuote(instrument), conversions = market.getHomeConversions();
                    const result = await place(instrument, units, options);
                    const id = result.orderFillTransaction?.tradeOpened?.tradeID;
                    if (id) {
                        const fill = Number(result.orderFillTransaction.price), counter = instrument.split('_')[1];
                        const conversion = counter === 'AUD' ? 1 : Number(conversions.find((row) => row.currency === counter).accountLoss);
                        costs.set(id, { brokerTradeId: id, entryMid: point(quote), units: Number(units),
                            initialRiskAud: Math.abs(fill - Number(options.stopLossPrice)) * Math.abs(Number(units)) * conversion,
                            entrySpreadPips: (Number(quote.asks[0].price) - Number(quote.bids[0].price)) / broker.getPipValue(instrument) });
                    }
                    return result;
                };
                broker._close = (trade, quote, reason, order) => {
                    const row = costs.get(trade.id), units = Number(trade.currentUnits), entryFill = Number(trade.price), exitMid = point(quote);
                    const result = close(trade, quote, reason, order);
                    if (row) {
                        const actualGross = Number(trade.realizedPL), exitFill = Number(trade.averageClosePrice);
                        const counter = trade.instrument.split('_')[1];
                        const positionConversion = counter === 'AUD' ? 1 : broker._rate(counter, 'position');
                        const midpointPL = (exitMid - row.entryMid) * units;
                        const executableQuotePL = (exitFill - entryFill) * units;
                        row.grossBeforeEstimatedFrictionAud = midpointPL * positionConversion;
                        row.executablePricePnlBeforeConversionFeeAud = executableQuotePL * positionConversion;
                        row.executionFrictionAud = row.grossBeforeEstimatedFrictionAud - row.executablePricePnlBeforeConversionFeeAud + Number(trade.commission);
                        row.homeConversionCostAud = row.executablePricePnlBeforeConversionFeeAud - actualGross;
                        row.estimatedFrictionAud = row.executionFrictionAud + row.homeConversionCostAud;
                        row.netR = (actualGross + Number(trade.financing) - Number(trade.commission)) / row.initialRiskAud;
                    }
                    return result;
                };
            } });
        const config = cloneDefaultConfig();
        if (config.liveReleaseVersion !== 'm15-intraday-v6') throw new Error('Experiment requires current v6');
        if (spec.smokeReconsiderationFirstMinute === true) {
            const pricing = h.broker.getPricing.bind(h.broker);
            env.setFinalPricing(async (instruments, options) => {
                const payload = await pricing(instruments, options);
                if (h.clock.nowMs() < fromMs + 60_000 && options?.includeHomeConversions) payload.prices = payload.prices.map((quote) => ({
                    ...quote, asks: quote.asks.map((level) => ({ ...level, price: String(Number(level.price) + 0.002) })) }));
                return payload;
            });
        }
        const observeSignals = (signals, at, boundary) => {
            for (const signal of signals) {
                const key = `${signal.symbol}:${signal.reasonCode}`;
                histogram[key] = (histogram[key] ?? 0) + 1;
                if (boundary && ['BUY', 'SELL'].includes(signal.signal)) candidates.push({ atMs: at, instrument: signal.symbol,
                    side: signal.signal, setupId: signal.setupId, reasonCode: signal.reasonCode });
                if (['BUY', 'SELL'].includes(signal.signal)) {
                    actionableEmissions++;
                    const identity = `${signal.symbol}:${signal.signal}:${signal.setupId}`;
                    if (!uniqueActionable.has(identity)) uniqueActionable.set(identity, { firstAtMs: at, instrument: signal.symbol,
                        side: signal.signal, setupId: signal.setupId, entryType: signal.entryType });
                }
                const context = signal.strategyContext ?? signal.decisionContext?.strategyContext ?? {};
                for (const [side, item] of [['BUY', context.buyRetest], ['SELL', context.sellRetest]]) {
                    const age = at - Number(item?.breakout?.closedAt);
                    if (Number.isFinite(age) && age >= 0) waitingAgeMs[`${signal.symbol}:${side}`] = Math.max(waitingAgeMs[`${signal.symbol}:${side}`] ?? 0, age);
                }
            }
        };
        const equityPoint = async (atMs) => { const account = (await h.broker.getAccountSummary()).account;
            equity.push({ atMs, navAud: Number(account.NAV), balanceAud: Number(account.balance), openTrades: Number(account.openTradeCount) }); };
        const boundaryTimes = [...new Set(Object.values(input.candlesByInstrument).flatMap((bars) => bars.map((bar) => bar.time * 1000)))]
            .filter((time) => time >= fromMs && time < toMs).sort((a, b) => a - b);
        for (const [index, at] of boundaryTimes.entries()) {
            let signals = await h.observeAt(at); boundaryScans++; observeSignals(signals, at, true); await equityPoint(at);
            // Completed-candle early HOLD filters cannot change inside this M15
            // interval (session/rollover edges align with quarters). Dynamic
            // cost/price/action/re-entry cases retain actual one-minute scans.
            let dynamic = needsMinuteScan(signals, h.engine.openTrades.size > 0, spec.scanMode);
            for (let offset = 5_000; offset < PERIOD; offset += 5_000) {
                const now = at + offset;
                if (now >= toMs) break;
                const hasExposure = h.engine.openTrades.size > 0;
                const minute = offset % 60_000 === 0 && dynamic;
                if (!hasExposure && !minute) continue;
                if (hasExposure && offset % 10_000 === 0) {
                    signals = await h.observeAt(now, { scan: minute, monitor: true }); managementSamples++;
                    await equityPoint(now);
                } else if (hasExposure) {
                    h.advanceTo(now);
                    for (const instrument of spec.assets) h.broker.observePrice(instrument);
                    continue;
                } else signals = await h.observeAt(now, { scan: true, monitor: false });
                if (minute) { minuteScans++; observeSignals(signals, now, false);
                    dynamic = needsMinuteScan(signals, h.engine.openTrades.size > 0, spec.scanMode); }
            }
            if (index % 96 === 0 || index === boundaryTimes.length - 1) {
                // Signals have already passed through the real repository,
                // queue and engine. No trading consumer rereads saved signals;
                // retain counts/candidates and discard bulky HOLD trace rows.
                droppedSignalRows += await env.database('signals').delete();
                for (const method of Object.values(require('../../src/utils/logger'))) method.mockClear?.();
            }
            if (index % 100 === 0) process.stderr.write(`viability ${spec.caseId}: ${index}/${boundaryTimes.length}, trades=${h.broker.trades.size}, elapsed=${((realNow() - started) / 1000).toFixed(1)}s\n`);
        }
        h.advanceTo(toMs - 1);
        await equityPoint(toMs - 1);
        const snapshot = await h.snapshot();
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(env.networkAttempts).toBe(0); expect(h.engine.stats.errors).toBe(0);
        const summary = summarizeViability({ snapshot, fromMs, toMs, equity, tradeCosts: [...costs.values()],
            scanSummary: { boundaryScans, minuteScans, managementSamples, reasonCounts: histogram, boundaryCandidates: candidates,
                actionableEmissions, uniqueActionableCandidates: [...uniqueActionable.values()],
                observedMarketDates: [...new Set(boundaryTimes.map((at) => new Date(at).toISOString().slice(0, 10)))],
                maximumObservedFrozenBreakoutAgeDays: Object.fromEntries(Object.entries(waitingAgeMs).map(([key, age]) => [key, age / 86_400_000])),
                droppedSignalRows, retentionPolicy: 'All decisions/trades/intents/broker state retained. Consumed signal trace rows periodically removed after aggregate capture; analytics signal counts are not used.' },
            pathAssumptions: { order: spec.pathOrder, spreadPips: spec.spreadPips, slippagePipsPerExecution: spec.slippagePips,
                commissionAudPerExecution: spec.commissionAud, scanMode: spec.scanMode,
                homeConversionFeeRate: spec.homeConversionFeeRate, instrumentMetadata: registered.instrumentMetadata,
                unrealizedConversionPurpose: spec.unrealizedConversionPurpose, policyOptimization: spec.policyOptimization,
                syntheticSides: spec.spreadPips !== null, managementSeconds: 10, sourceProtectionSampleSeconds: 5,
                schedule: 'Path linear between O/H/L/C at 0/5/10/15 minutes. Actual scans at M15 boundaries plus 60s in dynamic cases; static early candle HOLD cases compressed. Source quote protection precedes 10s app management.',
                synchronousQuotesAndLiquidity: 'DECLARED_COUNTERFACTUAL; NOT OBSERVED',
                limitations: ['M15 retained OHLC does not identify exact intrabar ordering/timing; two paths are sensitivity witnesses, not exhaustive bounds.',
                    'Synthetic constant pair spreads derive all bid/ask candle features and quotes coherently from midpoint; this changes historical side anchors and is an explicit alternative price world.',
                    'Native component path pairs independent side extrema synchronously by assumption; actual simultaneous spread/liquidity unknown.',
                    'Current captured instrument margin/precision metadata is applied retrospectively. Local leverage/risk rules remain actual; no historical metadata or latency parity.',
                    'Settlement home factors use modeled midpoint cross rates with the declared fee once into AUD; source quotes and cross rates remain modeled, not retained account factors.',
                    'Unrealized conversion uses the declared neutral position factor. Instrument marking remains the supplied liquidation-side proxy, not a claim of exact v20 margin NAV.',
                    'No financing events supplied; no exact total historical cost claim.',
                    'No forced end close, annual cash reset, episode reset, risk-gate override, optimization or untouched holdout.'] } });
        const output = { schemaVersion: 2, artifactKind: 'CURRENT_V6_RETROSPECTIVE_VIABILITY_MODEL', spec,
            specSha256: hash(fs.readFileSync(specPath)), archiveSha256: archiveHash, sourceHashes: beforeSources,
            baselineIdentity: { strategy: config.strategy, strategyVersion: getStrategyDefinition(config.strategy).version,
                releaseVersion: config.liveReleaseVersion, executionPolicyVersion: config.executionPolicyVersion, pricingModelVersion: config.pricingModelVersion },
            nodeVersion: process.versions.node, elapsedSeconds: (realNow() - started) / 1000,
            registration: registered.registration, optimization: policyOptimization.getStats(),
            networkAttempts: env.networkAttempts, engineErrors: h.engine.stats.errors,
            marketInputCoverage: h.market.summary().instruments,
            summary, brokerLedger: snapshot.brokerLedger, persistedTrades: snapshot.tables.trades,
            entryDecisions: snapshot.tables.entry_decisions, equityDailyAndTradeObservations: equity };
        expect(sourceHashes()).toEqual(beforeSources);
        fs.writeFileSync(process.env.RESEARCH_VIABILITY_OUTPUT, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
        process.stderr.write(`viability COMPLETE ${spec.caseId}: ${summary.closedTrades} closed net=${summary.netAud} R=${summary.totalNetR} elapsed=${output.elapsedSeconds.toFixed(1)}s\n`);
        await env.release(h);
    }, 7_200_000);
});
