const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReplayTestHarness, fixtureArchive, START, M15 } = require('../testHarness.cjs');
const env = createReplayTestHarness();
const { verifyReplaySources } = require('../replayManifest.cjs');
const { sellRetestFixture } = require('../../src/strategies/__tests__/fixtures/intradaySellRetestFixture');
const { buyEntryFixture } = require('../fixtures/causalFlows.cjs');
const { cloneDefaultConfig } = require('../../src/config/tradingConfig');
const { getStrategyDefinition } = require('../../src/strategies');

describe('persisted chronological production-path replay', () => {
    test('SELL structural evidence, actual SQLite intent/trade and timed closure reproduce across restart', async () => {
        async function run(restart) {
            const flow = { ...sellRetestFixture({ nowMs: START }), instrument: 'GBP_USD', independentH1: true };
            const h = await env.replay({ input: fixtureArchive([flow]), assets: ['GBP_USD'], startMs: START - 2 * M15 });
            await h.observeAt(START - 2 * M15);
            await h.observeAt(START - M15);
            if (restart) await h.restart();
            await h.observeAt(START);
            const open = await h.repositories.trades.getAllTrades();
            expect(open).toHaveLength(1);
            expect(open[0]).toMatchObject({ side: 'SELL', entryType: 'M15_BREAK_RETEST_REJECTION', isOpen: true });
            const stop = open[0].stopLossPrice;
            await h.observeAt(START + 6 * 3_600_000, { scan: false });
            const snapshot = await h.snapshot();
            expect(snapshot.tables.trades).toHaveLength(1);
            expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, exit_reason: 'TIME_STOP', stop_loss_price: stop });
            expect(snapshot.tables.entry_decisions.at(-1).outcome).toBe('FILLED');
            expect(snapshot.tables.broker_order_intents.at(-1).status).toBe('COMPLETED');
            expect(snapshot.analytics.summary.totalTrades).toBe(1);
            expect(snapshot.accounting.status).toBe('RECONCILED');
            expect(h.engine.stats.errors).toBe(0);
            expect(env.networkAttempts).toBe(0);
            await env.release(h);
            return snapshot;
        }
        const first = await run(false);
        expect(await run(false)).toEqual(first);
        expect(await run(true)).toEqual(first);
    });

    test.each(['EUR_USD', 'USD_JPY'])('healthy %s BUY executes through causal M15/H1 and real conversion/sizing', async (instrument) => {
        const flow = buyEntryFixture({ instrument, nowMs: START });
        const h = await env.replay({ input: fixtureArchive([flow]), assets: [instrument] });
        expect(h.dataService.homeConversionCache.USD).toMatchObject({
            accountGain: expect.any(Number), accountLoss: expect.any(Number),
        });
        await h.observeAt(START);
        const trades = await h.repositories.trades.getAllTrades();
        expect(trades).toHaveLength(1);
        expect(trades[0]).toMatchObject({ side: 'BUY', isOpen: true });
        expect(Number.isInteger(trades[0].units)).toBe(true);
        expect(trades[0].stopLossPrice).toBeLessThan(trades[0].entryPrice);
        expect(trades[0].takeProfitPrice).toBeGreaterThan(trades[0].entryPrice);
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('competing eligible pairs evolve account exposure and survive ownership restart without another fill', async () => {
        const flows = ['EUR_USD', 'USD_JPY'].map((instrument) => buyEntryFixture({ instrument, nowMs: START }));
        // Larger synthetic NAV demonstrates admission while retaining the A$100
        // sizing cap and all production risk/margin limits, without funding live.
        const h = await env.replay({ input: fixtureArchive(flows), assets: flows.map((flow) => flow.instrument), initialBalanceAud: 1000 });
        await h.observeAt(START);
        const first = await h.repositories.trades.getAllTrades();
        expect(first).toHaveLength(2);
        expect((await h.broker.getAccountSummary()).account.marginUsed).not.toBe('0');
        await h.restart();
        await h.observeAt(START + 60_000);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(2);
        expect(h.engine.openTrades.size).toBe(2);
        expect(h.engine.brokerStateUncertain).toBe(false);
        expect(h.engine.stats.errors).toBe(0);
    });

    test('existing account constraints may reject another pair without becoming a count cap', async () => {
        const flows = ['EUR_USD', 'USD_JPY'].map((instrument) => buyEntryFixture({ instrument, nowMs: START }));
        const h = await env.replay({ input: fixtureArchive(flows), assets: flows.map((flow) => flow.instrument) });
        await h.observeAt(START);
        const decisions = await env.database('entry_decisions').select('instrument', 'outcome', 'rejection_code');
        expect(decisions.filter((row) => row.outcome === 'FILLED')).toHaveLength(1);
        expect(decisions.filter((row) => row.outcome === 'REJECTED')).toHaveLength(1);
        expect(decisions.find((row) => row.outcome === 'REJECTED').rejection_code).not.toBe('MAX_POSITIONS');
        expect(h.engine.stats.errors).toBe(0);
    });

    test('local final-price decline can reconsider a healthy repeated event using its original anchor', async () => {
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const h = await env.replay({ input: fixtureArchive([flow]), assets: ['EUR_USD'] });
        const pricing = h.broker.getPricing.bind(h.broker);
        let wide = true;
        // Change only the singleton transport used for final execution pricing;
        // normal DataService delivery still includes healthy conversion evidence.
        env.setFinalPricing(async (instruments, options) => {
            const payload = await pricing(instruments, options);
            if (wide && options?.includeHomeConversions) payload.prices = payload.prices.map((quote) => quote.instrument !== 'EUR_USD' ? quote : {
                ...quote, asks: quote.asks.map((level) => ({ ...level, price: String(Number(level.price) + 0.002) })),
            });
            return payload;
        });
        await h.observeAt(START);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(0);
        const rejected = await env.database('entry_decisions').first();
        expect(rejected.rejection_code).toBe('SPREAD_TOO_WIDE');
        wide = false;
        await h.observeAt(START + 60_000);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        const decisions = await env.database('entry_decisions').orderBy('id');
        expect(decisions.at(-1).outcome).toBe('FILLED');
        expect(decisions.at(-1).entry_reference_price).toBe(rejected.entry_reference_price);
        expect(decisions.at(-1).setup_id).toBe(rejected.setup_id);
        expect(Number(rejected.entry_reference_price)).toBeGreaterThan(0);
        expect(h.engine.stats.errors).toBe(0);
    });

    test('broker-confirmed breakeven, gap stop and explicit lifetime costs reconcile after restart', async () => {
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const h = await env.replay({ input: fixtureArchive([flow]), assets: ['EUR_USD'],
            brokerOptions: { commissionAud: 0.01 } });
        await h.observeAt(START);
        const trade = (await h.repositories.trades.getAllTrades())[0];
        const risk = trade.entryPrice - trade.stopLossPrice;
        const originalQuote = h.market.getQuote.bind(h.market);
        let bid = trade.entryPrice + 1.1 * risk;
        h.market.getQuote = (instrument) => {
            const quote = originalQuote(instrument);
            return instrument !== 'EUR_USD' ? quote : { ...quote,
                time: new Date(h.clock.nowMs()).toISOString(), researchObservation: 'SYNTHETIC_POINT',
                bids: [{ price: bid.toFixed(5), liquidity: 1_000_000 }],
                asks: [{ price: (bid + 0.00004).toFixed(5), liquidity: 1_000_000 }] };
        };
        await h.observeAt(START + 10_000, { scan: false });
        const protectedTrade = (await h.repositories.trades.getAllTrades())[0];
        expect(protectedTrade).toMatchObject({ breakevenHit: true, activeStopType: 'BREAKEVEN', stopLossPrice: trade.entryPrice });
        h.broker.applyFinancing({ id: 'declared-carry', tradeId: trade.oandaTradeId, amountAud: -0.02, atMs: h.clock.nowMs() });
        await h.restart();
        bid = trade.entryPrice - 0.0001;
        await h.observeAt(START + 20_000, { scan: false });
        const snapshot = await h.snapshot();
        expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, active_stop_type: 'BREAKEVEN' });
        expect(snapshot.accounting).toMatchObject({ status: 'RECONCILED', commissionAud: 0.02, financingAud: -0.02 });
        expect(snapshot.accounting.tradeChecks[0].recordedNetAud).toBeLessThan(0);
        expect(h.engine.stats.errors).toBe(0);
    });

    test('a filled order with a lost response resolves from its durable intent without another order', async () => {
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const h = await env.replay({ input: fixtureArchive([flow]), assets: ['EUR_USD'] });
        const submit = h.broker.placeMarketOrder.bind(h.broker);
        let submissions = 0;
        h.broker.placeMarketOrder = async (...args) => {
            submissions++;
            await submit(...args);
            const error = new Error('Declared lost response after broker fill');
            error.code = 'ETIMEDOUT';
            throw error;
        };
        await h.observeAt(START);
        await h.restart();
        await h.observeAt(START + 60_000);
        const snapshot = await h.snapshot();
        expect(submissions).toBe(1);
        expect(snapshot.tables.trades).toHaveLength(1);
        expect(snapshot.tables.broker_order_intents).toHaveLength(1);
        expect(snapshot.tables.broker_order_intents[0].status).toBe('COMPLETED');
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(h.engine.brokerStateUncertain).toBe(false);
    });

    const manifestPath = process.env.RESEARCH_REPLAY_MANIFEST;
    if (manifestPath) test('runs the explicitly pinned historical coarse-close manifest', async () => {
        const spec = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (spec.schemaVersion !== 1 || spec.evidenceLevel !== 'M15_COMPLETED_CLOSE_SCREENING') throw new Error('Unknown replay manifest/evidence contract');
        if (spec.pricingAssumptions?.tradeable !== true || !(spec.pricingAssumptions.liquidityUnits > 0)) throw new Error('Declare modeled tradeability and liquidity');
        if (spec.nodeVersion !== process.versions.node) throw new Error('Use the manifest-pinned Node version');
        verifyReplaySources(path.resolve(__dirname, '../../..'), spec.sourceHashes);
        const config = cloneDefaultConfig();
        const actualIdentity = { strategy: config.strategy,
            strategyVersion: getStrategyDefinition(config.strategy).version,
            releaseVersion: config.liveReleaseVersion, executionPolicyVersion: config.executionPolicyVersion,
            pricingModelVersion: config.pricingModelVersion };
        expect(spec.baselineIdentity).toEqual(actualIdentity);
        const archivePath = path.resolve(path.dirname(manifestPath), spec.archive.path);
        const bytes = fs.readFileSync(archivePath);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== spec.archive.sha256) throw new Error('Historical archive hash differs from manifest');
        const archive = JSON.parse(bytes);
        if (archive.granularity !== 'M15' || archive.completeCandlesOnly !== true) throw new Error('Explicit completed-only M15 provenance required');
        const startMs = Date.parse(spec.fromUtc), endMs = Date.parse(spec.toUtcExclusive);
        if (!(startMs < endMs) || !spec.assets?.length || !Number.isFinite(spec.warmupDays)) throw new Error('Explicit interval/assets/warmup required');
        const input = { candlesByInstrument: {}, completedOnlyDeclared: true };
        for (const instrument of [...new Set([...spec.assets, 'AUD_USD'])]) {
            if (!archive.candlesByInstrument[instrument]) throw new Error(`Missing archive instrument ${instrument}`);
            input.candlesByInstrument[instrument] = archive.candlesByInstrument[instrument].filter((bar) =>
                bar.time * 1000 >= startMs - spec.warmupDays * 86_400_000 && bar.time * 1000 < endMs);
        }
        const h = await env.replay({ input, assets: spec.assets, startMs, initialBalanceAud: spec.initialBalanceAud,
            brokerOptions: { metadata: spec.metadata, slippagePips: spec.slippagePips, commissionAud: spec.commissionAud },
            modelPricing: spec.pricingAssumptions });
        for (let at = startMs; at < endMs; at += M15) await h.observeAt(at);
        const snapshot = await h.snapshot();
        expect(snapshot.runtime.strategy).toBe(actualIdentity.strategy);
        expect(snapshot.config.liveReleaseVersion).toBe(actualIdentity.releaseVersion);
        expect(snapshot.config.executionPolicyVersion).toBe(actualIdentity.executionPolicyVersion);
        expect(snapshot.config.pricingModelVersion).toBe(actualIdentity.pricingModelVersion);
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(env.networkAttempts).toBe(0);
        if (h.engine.stats.errors) throw new Error(`Unexpected engine errors: ${h.engine.stats.errors}`);
        const output = { schemaVersion: 1, artifactKind: 'PERSISTED_CAUSAL_COARSE_REPLAY',
            manifestSha256: crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
            manifest: spec, runtimeEnvironment: { nodeVersion: process.versions.node,
                platform: process.platform, architecture: process.arch, icuVersion: process.versions.icu,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                dependencies: Object.fromEntries(['jest', 'knex', 'better-sqlite3'].map((name) =>
                    [name, require(`${name}/package.json`).version])) },
            market: h.market.summary(), networkAttempts: env.networkAttempts,
            snapshot, limits: ['M15 component closes are modeled price observations, not synchronous executable account quotes.',
                'Broker-held stops/targets here observe supplied closes only; unobserved intrabar crossings, management opportunities and financing remain unresolved.',
                'This checks orchestration/account state and cannot establish profitable strategy expectancy or an exact broker replay.'] };
        fs.writeFileSync(process.env.RESEARCH_REPLAY_OUTPUT, JSON.stringify(output, null, 2) + '\n');
    }, 300_000);
});
