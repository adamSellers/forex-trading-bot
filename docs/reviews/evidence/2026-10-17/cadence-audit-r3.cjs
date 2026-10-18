'use strict';
// Docs-only analysis of completed frozen outputs. Does not import the app,
// modify the evaluator, fit a strategy, infer missing quotes, or place orders.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), recent = args.includes('--recent');
const cohort = recent ? 'recent' : 'full';
const outputAt = args.indexOf('--output');
const destination = outputAt >= 0 ? path.resolve(args[outputAt + 1]) : path.join(__dirname, `cadence-audit-r3-${cohort}.json`);
const specDirectory = path.join(__dirname, `viability-r3/specs/${cohort}`);
const resultDirectory = path.join(root, `backend/data/backtests/viability-20261017/r3/${cohort}`);
const specs = fs.readdirSync(specDirectory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const file = path.join(specDirectory, name), bytes = fs.readFileSync(file), spec = JSON.parse(bytes);
    const resultPath = path.join(resultDirectory, `${spec.caseId}.json`);
    assert.ok(fs.existsSync(resultPath), `Complete all cases before cadence audit: ${spec.caseId}`);
    return { file, spec, specSha256: sha(bytes), resultPath };
});
assert.equal(specs.length, 8);
const archivePath = path.resolve(specDirectory, specs[0].spec.archivePath), archiveBytes = fs.readFileSync(archivePath);
const archiveSha256 = sha(archiveBytes), archive = JSON.parse(archiveBytes);
const fromMs = Date.parse(specs[0].spec.fromUtc), toMs = Date.parse(specs[0].spec.toUtcExclusive);
const assets = specs[0].spec.assets;
const grids = Object.fromEntries(assets.map((asset) => [asset, archive.candlesByInstrument[asset]
    .map((bar) => bar.time * 1000).filter((at) => at >= fromMs && at < toMs)]));
const all = [...new Set(Object.values(grids).flat())].sort((a, b) => a - b);
function after(times, value) {
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if (times[mid] <= value) low = mid + 1; else high = mid; }
    return low;
}
function before(times, value) {
    let low = 0, high = times.length;
    while (low < high) { const mid = (low + high) >>> 1; if (times[mid] < value) low = mid + 1; else high = mid; }
    return low;
}
function observationsBetween(times, start, end) {
    const left = after(times, start), right = before(times, end);
    const inside = times.slice(left, right);
    return { distinctM15BoundariesStrictlyBetween: inside.length,
        observedUtcDates: new Set(inside.map((at) => new Date(at).toISOString().slice(0, 10))).size,
        retainedM15IntervalHours: inside.length / 4 };
}
function episode(trade) {
    let payload = trade.broker_reconciliation_payload;
    if (typeof payload === 'string') payload = JSON.parse(payload);
    const context = payload?.liveRuntime?.entryTelemetry?.strategyContext;
    if (trade.side === 'BUY') return context?.buyRetest?.episodeId ? `BUY:${trade.instrument}:${context.buyRetest.episodeId}` : null;
    const breakout = context?.sellRetest?.breakout;
    return Number.isFinite(breakout?.closedAt) && Number.isFinite(breakout?.level)
        ? `SELL:${trade.instrument}:${breakout.closedAt}:${breakout.level}` : null;
}
const cases = [];
for (const item of specs) {
    const { spec } = item, resultBytes = fs.readFileSync(item.resultPath), result = JSON.parse(resultBytes);
    assert.equal(result.specSha256, item.specSha256); assert.equal(spec.archiveSha256, archiveSha256);
    assert.equal(result.archiveSha256, archiveSha256); assert.equal(Date.parse(spec.fromUtc), fromMs);
    assert.equal(Date.parse(spec.toUtcExclusive), toMs); assert.deepEqual(spec.assets, assets);
    assert.equal(result.summary.scanSummary.boundaryScans, all.length);
    const entries = result.persistedTrades, times = entries.map((row) => row.entry_time).sort((a, b) => a - b);
    const bounds = [fromMs, ...times, toMs], gaps = bounds.slice(1).map((end, index) => {
        const start = bounds[index];
        return { fromUtc: new Date(start).toISOString(), toUtc: new Date(end).toISOString(),
            calendarDays: (end - start) / 86_400_000,
            leftBoundaryCensored: index === 0, rightBoundaryCensored: index === bounds.length - 2,
            betweenObservedEntries: index > 0 && index < bounds.length - 2,
            ...observationsBetween(all, start, end),
            byPair: Object.fromEntries(assets.map((asset) => [asset, observationsBetween(grids[asset], start, end)])) };
    }).sort((a, b) => b.calendarDays - a.calendarDays);
    assert.equal(result.summary.frequency.entryGapDays.maximum, gaps[0].calendarDays);
    const byYear = {}, byQuarter = {}, byPair = Object.fromEntries(assets.map((asset) => [asset, 0]));
    for (let date = new Date(fromMs); date.getTime() < toMs; date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))) {
        byYear[String(date.getUTCFullYear())] ??= 0;
        byQuarter[`${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`] ??= 0;
    }
    for (const trade of entries) {
        const date = new Date(trade.entry_time), year = date.getUTCFullYear();
        byYear[String(year)]++; byQuarter[`${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`]++; byPair[trade.instrument]++;
    }
    const episodes = entries.map(episode), knownEpisodes = episodes.filter(Boolean);
    cases.push({ caseId: spec.caseId, specSha256: item.specSha256, resultSha256: sha(resultBytes),
        entries: entries.length, closedTrades: result.summary.closedTrades, openBoundaryTrades: result.summary.openBoundaryTrades.length,
        tradeBearingUtcEntryDays: new Set(times.map((at) => new Date(at).toISOString().slice(0, 10))).size,
        distinctFilledBreakoutEpisodes: new Set(knownEpisodes).size, entriesWithoutEpisodeEvidence: episodes.filter((value) => value === null).length,
        entryCountsByYear: byYear, entryCountsByQuarter: byQuarter, entryCountsByPair: byPair,
        entriesPer30CalendarDays: entries.length / ((toMs - fromMs) / (30 * 86_400_000)),
        longestObservedEntryGaps: gaps.slice(0, 10) });
}
const output = { schemaVersion: 1, artifactKind: 'DOCS_ONLY_FROZEN_R3_CADENCE_AND_CENSORING_AUDIT',
    cohort, toolSha256: sha(fs.readFileSync(__filename)), archiveSha256,
    interval: { fromUtc: specs[0].spec.fromUtc, toUtcExclusive: specs[0].spec.toUtcExclusive },
    coverage: { distinctM15Boundaries: all.length, observedUtcDates: new Set(all.map((at) => new Date(at).toISOString().slice(0, 10))).size },
    definitions: {
        entries: 'Persisted actual-engine entries, including any open boundary positions. Period counts differ from closed-trade-only economic tables if exposure remains open.',
        episodes: 'BUY episodeId or SELL frozen breakout time/level, grouped by instrument and direction from broker-backed entry telemetry. Counts describe concentration, not proven independent samples.',
        gaps: 'Observed span between entries with start/end cohort boundaries included. Boundary-touching spans are censored; their length does not bound the eventual complete waiting time.',
        marketCoverage: 'Counts retained M15 start boundaries strictly inside the gap and their observed UTC dates. Each retained interval contributes 0.25 coverage hours. Missing intervals are not filled. These are observations, not all eligible setups, independent trials, market-session days or exact open-market duration.',
    },
    cases,
};
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: path.relative(root, destination), cohort,
    cases: cases.map((row) => ({ caseId: row.caseId, entries: row.entries, episodes: row.distinctFilledBreakoutEpisodes,
        longestCalendarGapDays: row.longestObservedEntryGaps[0].calendarDays,
        gapM15Boundaries: row.longestObservedEntryGaps[0].distinctM15BoundariesStrictlyBetween })) }));
