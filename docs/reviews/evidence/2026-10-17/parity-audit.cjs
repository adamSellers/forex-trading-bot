'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../..');
const sourcePath = 'backend/data/historical/viability_20261017_recent.json';
const buffer = fs.readFileSync(path.join(root, sourcePath));
const data = JSON.parse(buffer);
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const round = (value) => Number(value.toFixed(10));
const results = {};
for (const instrument of Object.keys(data.candlesByInstrument)) {
    const m15 = data.candlesByInstrument[instrument];
    const h1 = data.h1ByInstrument[instrument];
    const pip = instrument.endsWith('JPY') ? 0.01 : 0.0001;
    const check = (rows, interval) => {
        const problems = [], gaps = [];
        const seen = new Set();
        rows.forEach((row, index) => {
            if (!Number.isSafeInteger(row.time) || row.time % interval || seen.has(row.time) ||
                index > 0 && row.time <= rows[index - 1].time || row.complete !== true) problems.push({ index, time: row.time, type: 'TIME_ORDER_COMPLETION' });
            seen.add(row.time);
            for (const component of ['mid', 'bid', 'ask']) {
                const c = row[component];
                if (!c || !['o', 'h', 'l', 'c'].every((key) => Number.isFinite(c[key]) && c[key] > 0) ||
                    c.h < Math.max(c.o, c.l, c.c) || c.l > Math.min(c.o, c.h, c.c)) problems.push({ index, time: row.time, component, type: 'OHLC' });
            }
            if (index > 0 && row.time > rows[index - 1].time + interval) gaps.push({ fromUtc: iso(rows[index - 1].time + interval), toUtcExclusive: iso(row.time), absentGridIntervals: (row.time - rows[index - 1].time) / interval - 1 });
        });
        return { count: rows.length, firstIntervalStartUtc: iso(rows[0].time), lastIntervalEndUtc: iso(rows.at(-1).time + interval), structuralProblems: problems.length,
            firstProblems: problems.slice(0, 10), gaps, absentGridIntervals: gaps.reduce((n, row) => n + row.absentGridIntervals, 0) };
    };
    const quarterMap = new Map(m15.map((row) => [row.time, row]));
    let matchedHours = 0, matchedComponents = 0, volumeMatches = 0, allFieldMatchHours = 0;
    const fieldDifferences = [], incompleteQuarterHours = [];
    const directHours = new Set(h1.map((row) => row.time));
    for (const direct of h1) {
        const quarters = [0, 900, 1800, 2700].map((offset) => quarterMap.get(direct.time + offset));
        if (!quarters.every((row) => row?.complete === true)) {
            incompleteQuarterHours.push({ timeUtc: iso(direct.time), availableQuarters: quarters.filter(Boolean).length });
            continue;
        }
        matchedHours++;
        const before = fieldDifferences.length;
        for (const component of ['mid', 'bid', 'ask']) {
            const reconstructed = { o: quarters[0][component].o, h: Math.max(...quarters.map((row) => row[component].h)),
                l: Math.min(...quarters.map((row) => row[component].l)), c: quarters[3][component].c };
            let componentMatches = true;
            for (const key of ['o', 'h', 'l', 'c']) if (reconstructed[key] !== direct[component][key]) {
                componentMatches = false;
                fieldDifferences.push({ timeUtc: iso(direct.time), component, field: key, direct: direct[component][key], reconstructed: reconstructed[key], differencePips: round((reconstructed[key] - direct[component][key]) / pip) });
            }
            if (componentMatches) matchedComponents++;
        }
        const volume = quarters.reduce((n, row) => n + row.volume, 0);
        if (volume === direct.volume) volumeMatches++;
        else fieldDifferences.push({ timeUtc: iso(direct.time), component: null, field: 'volume', direct: direct.volume, reconstructed: volume });
        if (before === fieldDifferences.length) allFieldMatchHours++;
    }
    const observedHours = new Set(m15.map((row) => Math.floor(row.time / 3600) * 3600));
    const m15HoursWithoutDirectH1 = [...observedHours].filter((time) => !directHours.has(time)).map(iso);
    const differences = m15.map((candle) => (candle.ask.c - candle.bid.c) / pip).sort((a, b) => a - b);
    results[instrument] = { m15: check(m15, 900), h1: check(h1, 3600), parity: {
        comparedCompleteFourQuarterHours: matchedHours, comparedComponentOhlcs: matchedHours * 3,
        exactMatchedComponentOhlcs: matchedComponents, exactMatchedVolumeHours: volumeMatches,
        exactMatchedAllFieldsHours: allFieldMatchHours, fieldDifferenceCount: fieldDifferences.length,
        firstFieldDifferences: fieldDifferences.slice(0, 50), incompleteQuarterHours, m15HoursWithoutDirectH1,
        status: fieldDifferences.length ? 'DISCREPANCIES_OBSERVED' : 'EXACT_ON_ALL_COMPARABLE_HOURS' },
        componentCloseDifference: { meaning: 'Independent ask-component close minus bid-component close; not verified simultaneous account spread.',
            medianPips: round(differences[Math.floor(differences.length / 2)]), p90Pips: round(differences[Math.floor(differences.length * 0.9)]),
            atMostConfiguredOnePointTwoPips: differences.filter((value) => value <= 1.2 + 1e-8).length,
            total: differences.length } };
}
const output = { schemaVersion: 1, artifactKind: 'INDEPENDENT_RECENT_M15_TO_DIRECT_H1_PARITY_AUDIT',
    capturedOnSydneyDate: '2026-10-17', source: { path: sourcePath, bytes: buffer.length, sha256: sha(buffer),
        downloadedAtUtc: data.downloadedAtUtc, origin: data.source, runtime: process.version },
    tool: { path: path.relative(root, __filename), sha256: sha(fs.readFileSync(__filename)) },
    instruments: results,
    interpretation: [
        'Exact compared prices establish direct-H1 agreement for these recently retained account-independent instrument candle observations; do not extend that finding automatically to every 2020-August 2026 hour.',
        'Hours lacking four retained quarters are excluded and reported. Missing intervals may be closures, holidays, quiet intervals or capture gaps; this audit does not diagnose service health or synthesize prices.',
        'Matching candle OHLC does not validate simultaneous account pricing, home conversions, executable liquidity, quote receipt, source event ordering, five-second path or ten-second management.',
        'Any 5-second interpolated price paths remain declared sensitivities. High-first/low-first paths are not exhaustive account-return bounds.',
    ], changesMade: 'Only local standalone audit script and result. No strategy/runtime/live changes.' };
const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'parity-audit.json');
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: path.relative(root, destination), sourceSha256: output.source.sha256,
    byPair: Object.fromEntries(Object.entries(results).map(([pair, result]) => [pair, { comparableHours: result.parity.comparedCompleteFourQuarterHours,
        exactHours: result.parity.exactMatchedAllFieldsHours, fieldDifferences: result.parity.fieldDifferenceCount,
        incompleteQuarterHours: result.parity.incompleteQuarterHours.length, m15Problems: result.m15.structuralProblems, h1Problems: result.h1.structuralProblems }])) }));
