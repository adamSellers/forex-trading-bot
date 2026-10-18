'use strict';
// Independent diagnostic: actual pure policy states; no fills, cash or return model.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const { HistoricalMarket } = require(path.join(root, 'backend/research/historicalMarket.cjs'));
const { evaluateIntradayBuyRetest } = require(path.join(root, 'backend/src/runtime/intradayBuyRetestPolicy.js'));
const { evaluateIntradaySellRetest } = require(path.join(root, 'backend/src/runtime/intradaySellRetestPolicy.js'));
const { evaluateIntradayMomentumEntry } = require(path.join(root, 'backend/src/strategies/intradayMomentum.js'));
const config = require(path.join(root, 'shared/tradingConfigDefaults.json'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const specPath = 'docs/reviews/evidence/2026-10-17/viability-specs/recent/recent-optimistic-OHLC.json';
const specBytes = fs.readFileSync(path.join(root, specPath));
const spec = JSON.parse(specBytes);
const archiveBytes = fs.readFileSync(spec.archivePath);
if (sha(archiveBytes) !== spec.archiveSha256) throw Error('Archive hash mismatch');
const archive = JSON.parse(archiveBytes);
const fromMs = Date.parse(spec.fromUtc), toMs = Date.parse(spec.toUtcExclusive);
const keys = ['o', 'h', 'l', 'c'];
const output = { schemaVersion: 1, artifactKind: 'INDEPENDENT_UNCONDITIONAL_CURRENT_PATTERN_DIAGNOSTIC',
    source: { path: path.relative(root, spec.archivePath), sha256: sha(archiveBytes), specPath, specSha256: sha(specBytes), runtime: process.version },
    tool: { path: path.relative(root, __filename), sha256: sha(fs.readFileSync(__filename)) },
    interval: { fromUtc: spec.fromUtc, toUtcExclusive: spec.toUtcExclusive },
    methods: [
        'Fresh state at September 15 with exactly the same 500 retained completed M15 candles at startup as the persisted recent evaluator; input contains its identical 40-day prefix.',
        'Actual BUY and SELL pure policies receive the complete retained 500-bar cache at every distinct modeled M15 boundary. Prior state is preserved; consumed fill sets remain empty because the portfolio evaluation made no fills.',
        'Raw ready confirmations are recorded before H1, RSI, candle quality, liquid-session, cost, loss-reset or portfolio admission. Distinct confirmation candles and distinct breakout episodes are separate counts.',
        'For each raw confirmation, actual current strategy is evaluated with both actual policy decisions, matching reconstructed H1 and the new bar midpoint opening quote; this identifies its first failed strategy gate without changing any rule.',
        'Native retained side candles and coherent optimistic synthetic sides are separate price worlds. Midpoint pattern geometry is identical; side-based structural stop prices can differ.',
        'This diagnostic makes no trade fills, independent candidate P&L, portfolio returns or counterfactual missed-profit claim.',
    ], worlds: {} };
const sourceFiles = ['backend/research/historicalMarket.cjs', 'backend/src/runtime/intradayBuyRetestPolicy.js',
    'backend/src/runtime/intradaySellRetestPolicy.js', 'backend/src/strategies/intradayMomentum.js',
    'backend/src/runtime/marketDataFreshness.js', 'shared/tradingConfigDefaults.json'];
output.sourceHashes = Object.fromEntries(sourceFiles.map((name) => [name, sha(fs.readFileSync(path.join(root, name)))]));

async function main() {
    for (const world of ['native', 'optimistic']) {
        const input = {};
        for (const instrument of spec.assets) {
            const half = spec.spreadPips[instrument] * (instrument.endsWith('JPY') ? 0.01 : 0.0001) / 2;
            input[instrument] = archive.candlesByInstrument[instrument]
                .filter((bar) => bar.time * 1000 >= fromMs - 40 * 86_400_000 && bar.time * 1000 < toMs)
                .map((bar) => world === 'native' ? bar : { ...bar,
                    bid: Object.fromEntries(keys.map((key) => [key, bar.mid[key] - half])),
                    ask: Object.fromEntries(keys.map((key) => [key, bar.mid[key] + half])) });
        }
        const boundaries = [...new Set(Object.values(input).flatMap((bars) => bars.map((bar) => bar.time * 1000)))]
            .filter((time) => time >= fromMs && time < toMs).sort((a, b) => a - b);
        let nowMs = fromMs;
        const market = new HistoricalMarket({ candlesByInstrument: input, clock: { nowMs: () => nowMs },
            maxBars: 500, completedOnlyDeclared: true });
        const states = {}, results = {}, events = [];
        for (const instrument of spec.assets) {
            states[instrument] = { BUY: null, SELL: null };
            results[instrument] = { initialM15Count: market.getCandles(instrument, 'M15').length,
                initialH1Count: market.getCandles(instrument, 'H1').length,
                BUY: { readyConfirmationCandles: 0, breakoutEpisodes: new Set(), classifications: {}, maximumFrozenAgeDays: 0 },
                SELL: { readyConfirmationCandles: 0, breakoutEpisodes: new Set(), classifications: {}, maximumFrozenAgeDays: 0 } };
            if (results[instrument].initialM15Count !== 500) throw Error('Initial retained cache differs from evaluator');
        }
        for (const [index, at] of boundaries.entries()) {
            nowMs = at; market.advanceTo(at);
            for (const instrument of spec.assets) {
                const candles = market.getCandles(instrument, 'M15'), h1 = market.getCandles(instrument, 'H1');
                const buy = evaluateIntradayBuyRetest({ instrument, candles, breakoutBars: config.intradayBreakoutBars,
                    nowMs: at, priorState: states[instrument].BUY, consumedEpisodeIds: [] });
                const sell = evaluateIntradaySellRetest({ instrument, candles, breakoutBars: config.intradayBreakoutBars,
                    nowMs: at, priorState: states[instrument].SELL, consumedPatternIds: [] });
                states[instrument] = { BUY: buy.state, SELL: sell.state };
                for (const [side, decision] of [['BUY', buy], ['SELL', sell]]) {
                    const result = results[instrument][side];
                    result.classifications[decision.classification] = (result.classifications[decision.classification] || 0) + 1;
                    if (decision.breakout) result.maximumFrozenAgeDays = Math.max(result.maximumFrozenAgeDays, (at - decision.breakout.closedAt) / 86_400_000);
                    if (!decision.ready) continue;
                    result.readyConfirmationCandles++;
                    result.breakoutEpisodes.add(decision.breakout.closedAt);
                    const newBar = input[instrument].find((bar) => bar.time * 1000 === at);
                    const currentPrice = newBar?.mid.o ?? candles.at(-1).close;
                    const spreadPips = world === 'optimistic' ? spec.spreadPips[instrument]
                        : (newBar.ask.o - newBar.bid.o) / (instrument.endsWith('JPY') ? 0.01 : 0.0001);
                    const strategy = await evaluateIntradayMomentumEntry({ instrument, currentPrice, config, nowMs: at,
                        marketContext: { timeframes: { '15m': { candles }, '1h': { candles: h1 } },
                            session: { tradeable: !!newBar, spreadPips }, instrumentMetadata: { displayPrecision: instrument.endsWith('JPY') ? 3 : 5 } },
                        latestClosedTrade: null, reentryHistoryAvailable: true, lossResetTrades: [],
                        sellRetestDecision: sell, buyRetestDecision: buy });
                    events.push({ atUtc: new Date(at).toISOString(), instrument, side,
                        confirmationCandleStartUtc: decision.confirmation.time, breakout: decision.breakout,
                        retest: decision.retest, episodeId: decision.episodeId ?? null, patternId: decision.patternId ?? null,
                        structuralStopLossPrice: decision.structuralStopLossPrice,
                        firstStrategyReasonCode: strategy.reasonCode, gatedSignalType: strategy.signalType,
                        gatedDirection: strategy.currentDir, h1: strategy.strategyContext?.h1 ?? null,
                        m15: strategy.strategyContext?.m15 ? { rsi: strategy.strategyContext.m15.rsi,
                            bodyRatio: strategy.strategyContext.m15.bodyRatio, rangeAtr: strategy.strategyContext.m15.rangeAtr } : null });
                }
            }
            if (index % 300 === 0) process.stderr.write(`${world} patterns ${index}/${boundaries.length}\n`);
        }
        for (const instrument of spec.assets) for (const side of ['BUY', 'SELL']) {
            results[instrument][side].distinctBreakoutEpisodesWithConfirmation = results[instrument][side].breakoutEpisodes.size;
            delete results[instrument][side].breakoutEpisodes;
        }
        output.worlds[world] = { boundaries: boundaries.length, observationsByPair: results, confirmedEvents: events,
            confirmedEventFirstStrategyGateCounts: events.reduce((counts, event) => {
                counts[event.firstStrategyReasonCode] = (counts[event.firstStrategyReasonCode] || 0) + 1; return counts;
            }, {}), finalStates: states };
    }
    const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'unconditional-pattern-audit.json');
    fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output: path.relative(root, destination), totals: Object.fromEntries(Object.entries(output.worlds).map(([world, result]) =>
        [world, { confirmedEvents: result.confirmedEvents.length, firstGates: result.confirmedEventFirstStrategyGateCounts }])) }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
