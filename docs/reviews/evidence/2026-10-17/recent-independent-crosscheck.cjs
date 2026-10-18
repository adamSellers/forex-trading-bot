'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const { ReplayBroker } = require(path.join(root, 'backend/research/replayBroker.cjs'));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative)));
const summaryPath = 'docs/reviews/evidence/2026-10-17/viability-recent-summary.json';
const patternPath = 'docs/reviews/evidence/2026-10-17/unconditional-pattern-audit.json';
const summary = read(summaryPath), patterns = read(patternPath);
assert.equal(summary.caseCount, 8); assert.equal(summary.cases.length, 8);
assert.equal(sha(JSON.stringify(summary.sourceHashes)), summary.sourcePinSetSha256);
const sourceChanges = Object.entries(summary.sourceHashes).filter(([name, expected]) => sha(fs.readFileSync(path.join(root, name))) !== expected).map(([name]) => name);
assert.equal(sourceChanges.length, 0);
const checks = [], statesCompared = [];
for (const item of summary.cases) {
    const bytes = fs.readFileSync(item.resultPath), result = JSON.parse(bytes), actual = result.summary;
    assert.equal(sha(bytes), item.resultSha256);
    assert.equal(result.spec.caseId, item.caseId);
    assert.equal(result.specSha256, item.specSha256);
    assert.equal(result.archiveSha256, item.archiveSha256);
    assert.deepEqual(result.sourceHashes, summary.sourceHashes);
    assert.equal(sha(JSON.stringify(result.spec)), sha(JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, `docs/reviews/evidence/2026-10-17/viability-specs/recent/${item.caseId}.json`))))));
    assert.equal(actual.closedTrades, 0); assert.equal(actual.openBoundaryTrades.length, 0);
    assert.equal(actual.scanSummary.uniqueActionableCandidates.length, 0);
    assert.equal(actual.scanSummary.actionableEmissions, 0);
    assert.equal(actual.scanSummary.boundaryScans, 2292);
    assert.equal(result.persistedTrades.length, 0); assert.equal(result.entryDecisions.length, 0); assert.equal(result.brokerLedger.length, 0);
    assert.equal(actual.netAud, 0); assert.equal(actual.totalNetR, 0);
    assert.equal(actual.averageNetR, null); assert.equal(actual.winRate, null);
    assert.equal(actual.initialBalanceAud, 100); assert.equal(actual.finalBalanceAud, 100);
    assert.equal(actual.accounting.status, 'RECONCILED');
    assert.equal(actual.accounting.expectedBalanceAud, 100); assert.equal(actual.accounting.observedBalanceAud, 100);
    assert.equal(actual.financing.newYork1700CutoffCrossings.length, 0);
    assert.equal(Object.values(actual.scanSummary.reasonCounts).reduce((a, b) => a + b, 0), 2292 * 4);
    if (item.caseId.startsWith('recent-optimistic') || item.caseId.startsWith('recent-archive_components')) {
        const world = item.caseId.startsWith('recent-optimistic') ? 'optimistic' : 'native';
        let states = 0;
        for (const row of actual.finalBrokerRuntimeState) {
            const match = row.state_key.match(/^intraday-(buy|sell)-retest:v1:([A-Z_]+):/);
            if (!match) continue;
            assert.deepEqual(JSON.parse(row.state_value), patterns.worlds[world].finalStates[match[2]][match[1].toUpperCase()]); states++;
        }
        assert.equal(states, 8); statesCompared.push({ caseId: item.caseId, exactStateMatches: states });
    }
    checks.push({ caseId: item.caseId, resultSha256: item.resultSha256, sourcePinsMatch: true,
        resultAndSpecHashesMatch: true, independentNoTradeArithmetic: true, modeledBoundaries: 2292 });
}
const patternSummary = {};
for (const [world, result] of Object.entries(patterns.worlds)) {
    patternSummary[world] = { confirmedCandles: result.confirmedEvents.length,
        distinctBreakoutEpisodes: Object.values(result.observationsByPair).reduce((n, row) => n + row.BUY.distinctBreakoutEpisodesWithConfirmation + row.SELL.distinctBreakoutEpisodesWithConfirmation, 0),
        firstStrategyGates: result.confirmedEventFirstStrategyGateCounts,
        observedH1DirectionAtRawConfirmation: result.confirmedEvents.reduce((counts, event) => {
            const key = !event.h1 ? 'UNOBSERVED_BECAUSE_MARKET_GATE_RETURNED_FIRST'
                : event.gatedDirection === 0 ? 'NEUTRAL_OR_WEAK'
                    : event.gatedDirection === (event.side === 'BUY' ? 1 : -1) ? 'ALIGNED' : 'OPPOSITE';
            counts[key] = (counts[key] || 0) + 1; return counts;
        }, {}) };
}
const archivePath = 'backend/data/historical/viability_20261017_recent.json';
const archive = read(archivePath);
const broker = new ReplayBroker({ clock: { nowMs: () => 0 }, market: { getQuote() {}, getHomeConversions() { return []; } },
    metadata: { GBP_USD: { name: 'GBP_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05' } } });
const half = 1.1 * 0.0001 / 2, roundedSpreads = {};
let maximumRoundingPips = 0, points = 0;
for (const candle of archive.candlesByInstrument.GBP_USD) for (const key of ['o', 'h', 'l', 'c']) {
    const bid = candle.mid[key] - half, ask = candle.mid[key] + half;
    const roundedBid = Number(broker.formatPrice('GBP_USD', bid)), roundedAsk = Number(broker.formatPrice('GBP_USD', ask));
    maximumRoundingPips = Math.max(maximumRoundingPips, Math.abs(roundedBid - bid) / 0.0001, Math.abs(roundedAsk - ask) / 0.0001);
    const spread = Number(((roundedAsk - roundedBid) / 0.0001).toFixed(8)); roundedSpreads[spread] = (roundedSpreads[spread] || 0) + 1; points++;
}
const output = { schemaVersion: 1, artifactKind: 'INDEPENDENT_RECENT_MODEL_ARITHMETIC_STATE_AND_PRECISION_CROSSCHECK',
    runtime: process.version, toolSha256: sha(fs.readFileSync(__filename)),
    inputHashes: { [summaryPath]: sha(fs.readFileSync(path.join(root, summaryPath))),
        [patternPath]: sha(fs.readFileSync(path.join(root, patternPath))) },
    sourcePinSetSha256: summary.sourcePinSetSha256, sourceFileCount: Object.keys(summary.sourceHashes).length,
    casesChecked: checks, independentPatternStateMatches: statesCompared, rawPatternSummary: patternSummary,
    precisionSensitivity: { method: 'Actual ReplayBroker.formatPrice on synthetic GBP_USD midpoint +/- half of declared 1.1 pip spread for every recent retained midpoint OHLC vertex.',
        componentPoints: points, maximumPerSideRoundingErrorPips: Number(maximumRoundingPips.toFixed(10)),
        roundedAskMinusBidPipsCounts: roundedSpreads, interpretation: 'The source spread stays 1.1 pips, but two rounded fills can reduce cost by approximately 0.1 pip. Sampled paths also have fractional ticks; ordinary per-fill rounding is at most half a display tick. This is a small optimistic precision assumption, not a demonstrated sizing-budget violation. No recent admitted candidate reaches costs, so it does not change this cohort zero-trade finding.' },
    limits: ['Eight zero-trade cost/path cases are repeated conditional sensitivities of the same interval, not eight independent strategy trials or evidence of zero trading risk.',
        'The raw-pattern diagnostic has no fills; it attributes an observed filter intersection, not a hypothetical relaxed-rule strategy return.',
        'No H1-aligned raw confirmation is observed where H1 was computed. This is not proof the rules are logically impossible or no future confirmation can align.',
        'The 32 calendar day drought is conditional on the specified September 15 cold lineage and excludes no-trade outcomes beyond the declared interval.'] };
const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'recent-independent-crosscheck.json');
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ caseCount: checks.length, exactFinalStateComparisons: statesCompared.reduce((n, row) => n + row.exactStateMatches, 0),
    sourceFileCount: output.sourceFileCount, rawPatternSummary: patternSummary, precision: output.precisionSensitivity.maximumPerSideRoundingErrorPips }));
