'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// Process-local exact-input memoization of a pure calendar export. The actual
// policy and shared H1 implementations are unchanged and are hashed below.
const calendar = require(path.join(root, 'backend/src/runtime/marketDataFreshness.js'));
const originalCalendar = calendar.getForexMarketState, calendarCache = new Map();
calendar.getForexMarketState = (time) => {
    if (!Number.isFinite(time)) return originalCalendar(time);
    if (calendarCache.has(time)) return calendarCache.get(time);
    const value = Object.freeze(originalCalendar(time)); calendarCache.set(time, value);
    if (calendarCache.size > 20_000) calendarCache.delete(calendarCache.keys().next().value);
    return value;
};
const { HistoricalMarket } = require(path.join(root, 'backend/research/historicalMarket.cjs'));
const { evaluateIntradayBuyRetest } = require(path.join(root, 'backend/src/runtime/intradayBuyRetestPolicy.js'));
const { evaluateIntradaySellRetest } = require(path.join(root, 'backend/src/runtime/intradaySellRetestPolicy.js'));
const { calculateH1RegimeHistory } = require(path.join(root, 'backend/src/runtime/intradayLossResetPolicy.js'));
const { evaluateIntradayMomentumEntry } = require(path.join(root, 'backend/src/strategies/intradayMomentum.js'));
const config = require(path.join(root, 'shared/tradingConfigDefaults.json'));
const sourceFiles = ['backend/research/historicalMarket.cjs', 'backend/src/runtime/intradayBuyRetestPolicy.js',
    'backend/src/runtime/intradaySellRetestPolicy.js', 'backend/src/runtime/intradayLossResetPolicy.js',
    'backend/src/runtime/marketDataFreshness.js', 'backend/src/strategies/intradayMomentum.js',
    'backend/src/utils/indicators.js', 'shared/tradingConfigDefaults.json'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map((name) => [name, sha(fs.readFileSync(path.join(root, name)))]));
const initialSourceHashes = sourceHashes();
const readJson = (relative) => JSON.parse(fs.readFileSync(path.resolve(root, relative)));
const eventIdentity = (event) => [event.atUtc, event.instrument, event.side, event.episodeId, event.patternId, event.structuralStopLossPrice];

async function run({ archive, spec, world, recordRegime }) {
    const from = Date.parse(spec.fromUtc), to = Date.parse(spec.toUtcExclusive), input = {};
    for (const instrument of spec.assets) {
        const half = spec.spreadPips[instrument] * (instrument.endsWith('JPY') ? 0.01 : 0.0001) / 2;
        input[instrument] = archive.candlesByInstrument[instrument]
            .filter((bar) => bar.time * 1000 >= from - 40 * 86_400_000 && bar.time * 1000 < to)
            .map((bar) => world === 'native' ? bar : { ...bar,
                bid: Object.fromEntries(['o', 'h', 'l', 'c'].map((key) => [key, bar.mid[key] - half])),
                ask: Object.fromEntries(['o', 'h', 'l', 'c'].map((key) => [key, bar.mid[key] + half])) });
    }
    const boundaries = [...new Set(Object.values(input).flatMap((bars) => bars.map((bar) => bar.time * 1000)))]
        .filter((time) => time >= from && time < to).sort((a, b) => a - b);
    let now = from;
    const market = new HistoricalMarket({ candlesByInstrument: input, clock: { nowMs: () => now }, maxBars: 500, completedOnlyDeclared: true });
    const states = {}, events = [], yearly = {}, initialCache = {}, indices = {};
    for (const instrument of spec.assets) {
        states[instrument] = { BUY: null, SELL: null }; indices[instrument] = 0;
        initialCache[instrument] = { m15: market.getCandles(instrument, 'M15').length, h1: market.getCandles(instrument, 'H1').length };
        assert.equal(initialCache[instrument].m15, 500);
    }
    for (const [index, at] of boundaries.entries()) {
        now = at; market.advanceTo(at);
        for (const instrument of spec.assets) {
            const allM15 = market.getCandles(instrument, 'M15');
            // The first call establishes the exact cold 500-bar state. Later
            // calls retain eight prior bars plus the newest completed bar.
            const candles = states[instrument].BUY === null ? allM15 : allM15.slice(-9);
            const buy = evaluateIntradayBuyRetest({ instrument, candles, breakoutBars: config.intradayBreakoutBars, nowMs: at,
                priorState: states[instrument].BUY, consumedEpisodeIds: [] });
            const sell = evaluateIntradaySellRetest({ instrument, candles, breakoutBars: config.intradayBreakoutBars, nowMs: at,
                priorState: states[instrument].SELL, consumedPatternIds: [] });
            states[instrument] = { BUY: buy.state, SELL: sell.state };
            for (const [side, decision] of [['BUY', buy], ['SELL', sell]]) {
                if (!decision.ready) continue;
                const event = { atUtc: new Date(at).toISOString(), instrument, side,
                    episodeId: decision.episodeId ?? null, patternId: decision.patternId ?? null,
                    structuralStopLossPrice: decision.structuralStopLossPrice,
                    breakout: decision.breakout, retest: decision.retest, confirmation: decision.confirmation };
                if (recordRegime) {
                    const h1 = market.getCandles(instrument, 'H1');
                    const closeAt = Date.parse(allM15.at(-1).time) + 900_000;
                    const regimes = calculateH1RegimeHistory({ h1Candles: h1, config, nowMs: at, signalCandleCloseTime: closeAt });
                    const current = regimes.at(-1);
                    const expectedClose = Date.parse(h1.at(-1)?.time) + 3_600_000;
                    const valid = current?.valid === true && current.closedAt === expectedClose;
                    const alignment = !valid ? 'UNAVAILABLE'
                        : (side === 'BUY' ? current.longRegime : current.shortRegime) ? 'ALIGNED'
                            : (side === 'BUY' ? current.shortRegime : current.longRegime) ? 'OPPOSITE' : 'NEUTRAL_OR_WEAK';
                    event.h1Alignment = alignment; event.h1 = current ?? null; event.h1Candles = h1.length;
                    if (alignment === 'ALIGNED') {
                        while (indices[instrument] + 1 < input[instrument].length && input[instrument][indices[instrument] + 1].time * 1000 <= at) indices[instrument]++;
                        const newBar = input[instrument][indices[instrument]];
                        const currentPrice = newBar?.time * 1000 === at ? newBar.mid.o : allM15.at(-1).close;
                        const spreadPips = (newBar.ask.o - newBar.bid.o) / (instrument.endsWith('JPY') ? 0.01 : 0.0001);
                        const strategy = await evaluateIntradayMomentumEntry({ instrument, currentPrice, config, nowMs: at,
                            marketContext: { timeframes: { '15m': { candles: allM15 }, '1h': { candles: h1 } },
                                session: { tradeable: newBar.time * 1000 === at, spreadPips },
                                instrumentMetadata: { displayPrecision: instrument.endsWith('JPY') ? 3 : 5 } },
                            latestClosedTrade: null, reentryHistoryAvailable: true, lossResetTrades: [],
                            sellRetestDecision: sell, buyRetestDecision: buy });
                        event.firstStrategyGateInNativeNoFillState = strategy.reasonCode;
                        event.nativeNoFillSignalType = strategy.signalType;
                    }
                    const year = new Date(at).getUTCFullYear();
                    const count = yearly[year] ||= { confirmedCandles: 0, bySide: {}, h1Alignment: {}, alignedFirstNativeGate: {} };
                    count.confirmedCandles++; count.bySide[side] = (count.bySide[side] || 0) + 1;
                    count.h1Alignment[alignment] = (count.h1Alignment[alignment] || 0) + 1;
                    if (event.firstStrategyGateInNativeNoFillState) count.alignedFirstNativeGate[event.firstStrategyGateInNativeNoFillState] = (count.alignedFirstNativeGate[event.firstStrategyGateInNativeNoFillState] || 0) + 1;
                }
                events.push(event);
            }
        }
        if (recordRegime && index % 10_000 === 0) process.stderr.write(`full raw patterns ${index}/${boundaries.length}, confirmations=${events.length}\n`);
    }
    return { boundaries: boundaries.length, initialCache, events, yearly, finalStates: states };
}

async function main() {
    const recentSpec = readJson('docs/reviews/evidence/2026-10-17/viability-specs/recent/recent-optimistic-OHLC.json');
    const recentArchive = readJson(recentSpec.archivePath), reference = readJson('docs/reviews/evidence/2026-10-17/unconditional-pattern-audit.json');
    const parity = {};
    for (const world of ['native', 'optimistic']) {
        const result = await run({ archive: recentArchive, spec: recentSpec, world, recordRegime: false });
        assert.deepEqual(result.events.map(eventIdentity), reference.worlds[world].confirmedEvents.map(eventIdentity));
        assert.deepEqual(result.finalStates, reference.worlds[world].finalStates);
        parity[world] = { allConfirmationTimesAndIdentitiesMatchFull500Cache: true, confirmationCount: result.events.length,
            exactFinalPairSideStates: 8, initialCache: result.initialCache };
    }
    process.stderr.write('Recent full500 versus seed500/advance9 parity PASSED for both side worlds\n');
    const specPath = 'docs/reviews/evidence/2026-10-17/viability-model/specs/full-optimistic-ohlc.json';
    const spec = readJson(specPath), bytes = fs.readFileSync(spec.archivePath);
    assert.equal(sha(bytes), spec.archiveSha256);
    const archive = JSON.parse(bytes);
    const result = await run({ archive, spec, world: 'native', recordRegime: true });
    assert.deepEqual(sourceHashes(), initialSourceHashes);
    const output = { schemaVersion: 1, artifactKind: 'UNCONDITIONAL_CURRENT_PATTERN_GEOMETRY_AND_H1_SCREEN_NO_FILLS',
        runtime: process.version, toolSha256: sha(fs.readFileSync(__filename)), sourceHashes: initialSourceHashes,
        archivePath: path.relative(root, spec.archivePath), archiveSha256: spec.archiveSha256, specPath,
        specSha256: sha(fs.readFileSync(path.join(root, specPath))), interval: { fromUtc: spec.fromUtc, toUtcExclusive: spec.toUtcExclusive },
        recentFeedOptimizationParity: parity,
        methods: ['Actual current BUY/SELL pure policy functions, one cold 500-bar seed then prior eight plus newest completed M15; prior state persists across all years.',
            'Full-vs-short feed parity is tested against all recent confirmation times/identities/structural stops and all final states in native and synthetic side worlds before this full run.',
            'Native completed bid/ask components determine structural stops; raw midpoint geometry and explicit side validity determine readiness. No consumed fill IDs are supplied.',
            'Each raw ready confirmation is paired with the actual shared H1 predicate calculated from its current 500 completed H1 window and signal-close cutoff.',
            'Actual strategy first gates are inspected only for H1-aligned raw confirmations in an empty-history/no-fill state using native opening spread proxy. This remains a feature diagnostic, not order admission.',
            'Pure calendar export uses exact-timestamp process-local memoization only; source code, product configuration and all runtime source files remain unchanged.'],
        limits: ['No trade execution, fill consumption, protected-exit/reentry/loss feedback, portfolio competition, cash returns, expectancy or attainable trade-frequency claim.',
            'Confirmed candle counts can repeat a BUY breakout episode; episode IDs and timestamps remain in the full event list.',
            'No annual cash or episode resets. This hypothetical no-fill lineage can diverge from full persisted runtime as soon as a model trade fills.',
            'H1 reconstruction for the old archive has not been directly verified for every historical hour; recent direct-H1 parity was separately exact.',
            'Side component extrema/closing/opening prices are not verified account-specific executable quotes.'], result };
    const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'full-pattern-screen.json');
    fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output: path.relative(root, destination), boundaries: result.boundaries,
        confirmations: result.events.length, yearly: result.yearly }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
