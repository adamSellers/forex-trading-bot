#!/usr/bin/env node
'use strict';

// Audit local retained input coverage only; no runtime imports or broker access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_ARCHIVE = path.join(ROOT, 'backend/data/historical/research_M15_MBA_20200101_20260803.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'docs/reviews/evidence/2026-10-06/research/input-audit-node.json');
const INTERVAL_SECONDS = 900;

function digest(file) {
    const hash = crypto.createHash('sha256');
    const descriptor = fs.openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytes;
        while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    } finally { fs.closeSync(descriptor); }
    return hash.digest('hex');
}

function iso(seconds) {
    // Preserve the earlier audit's UTC second/microsecond representation rather
    // than introducing a different timestamp unit with Node's Date API.
    const microseconds = Math.round(seconds * 1_000_000);
    const wholeSeconds = Math.floor(microseconds / 1_000_000);
    const fraction = microseconds - wholeSeconds * 1_000_000;
    const base = new Date(wholeSeconds * 1000).toISOString().replace('.000Z', '');
    return `${base}${fraction ? `.${String(fraction).padStart(6, '0')}` : ''}Z`;
}

function location(file) {
    const absolute = path.resolve(file);
    const relative = path.relative(ROOT, absolute);
    return relative && (relative === '..' || relative.startsWith(`..${path.sep}`)) ? absolute : relative || '.';
}

function pricesValid(component) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) return false;
    const values = ['o', 'h', 'l', 'c'].map((key) => component[key]);
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return false;
    const [opening, high, low, close] = values;
    return low <= opening && opening <= high && low <= close && close <= high;
}

function roundedSix(value) {
    // Round the actual binary float to six places with ties to even, preserving
    // the original audit's percentile arithmetic at exact half-way values.
    const data = new DataView(new ArrayBuffer(8));
    data.setFloat64(0, Math.abs(value));
    const bits = data.getBigUint64(0);
    const exponentBits = Number((bits >> 52n) & 2047n);
    const mantissa = (bits & ((1n << 52n) - 1n)) + (exponentBits ? 1n << 52n : 0n);
    const exponent = (exponentBits || 1) - 1023 - 52;
    let numerator = mantissa * 1_000_000n;
    const denominator = exponent < 0 ? 1n << BigInt(-exponent) : 1n;
    if (exponent >= 0) numerator <<= BigInt(exponent);
    let rounded = numerator / denominator;
    const remainder = numerator % denominator;
    if (remainder * 2n > denominator || (remainder * 2n === denominator && rounded % 2n)) rounded++;
    return Math.sign(value) * Number(rounded) / 1_000_000;
}

function summarizeInstrument(instrument, bars, declaredFrom, declaredTo) {
    if (!Array.isArray(bars)) throw new TypeError('Instrument candles must be an explicit array');
    const months = {}, components = {}, completion = {};
    const invalid = [], misaligned = [], nonordered = [], duplicates = [], gaps = [];
    const seen = new Set(), times = [], sideCloseDifferences = [];
    let previous = null;
    const increment = (counter, key) => { counter[key] = (counter[key] || 0) + 1; };
    for (const [index, bar] of bars.entries()) {
        const started = bar?.time;
        if (typeof started !== 'number' || !Number.isFinite(started) || !Number.isInteger(started)) {
            invalid.push({ index, reason: 'INVALID_SECONDS_TIMESTAMP' });
            continue;
        }
        times.push(started);
        increment(months, iso(started).slice(0, 7));
        if (started % INTERVAL_SECONDS) misaligned.push(index);
        if (seen.has(started)) duplicates.push(index);
        seen.add(started);
        if (previous !== null) {
            if (started <= previous) nonordered.push(index);
            else if (started - previous > INTERVAL_SECONDS) gaps.push({
                fromUtc: iso(previous + INTERVAL_SECONDS), toUtcExclusive: iso(started),
                absentGridSlots: Math.floor((started - previous) / INTERVAL_SECONDS) - 1,
            });
        }
        previous = started;
        increment(completion, bar.complete === true ? 'explicit_complete'
            : bar.complete === false ? 'explicit_incomplete' : 'not_retained_per_candle');
        for (const component of ['mid', 'bid', 'ask']) {
            if (pricesValid(bar[component])) increment(components, component);
            else invalid.push({ index, reason: 'INVALID_OR_MISSING_OHLC', component });
        }
        if (pricesValid(bar.bid) && pricesValid(bar.ask)) {
            const pip = instrument.endsWith('_JPY') ? 0.01 : 0.0001;
            sideCloseDifferences.push((bar.ask.c - bar.bid.c) / pip);
        }
    }
    sideCloseDifferences.sort((a, b) => a - b);
    const percentile = (probability) => sideCloseDifferences.length
        ? roundedSix(sideCloseDifferences[Math.floor((sideCloseDifferences.length - 1) * probability)]) : null;
    const boundaries = [];
    let first = null, last = null;
    // Avoid spreading a multi-year input into a function's argument list.
    for (const time of times) { first = first === null ? time : Math.min(first, time); last = last === null ? time : Math.max(last, time); }
    if (first !== null) {
        if (declaredFrom < first) boundaries.push({ fromUtc: iso(declaredFrom), toUtcExclusive: iso(first), kind: 'LEADING_UNOBSERVED' });
        if (last + INTERVAL_SECONDS < declaredTo) boundaries.push({ fromUtc: iso(last + INTERVAL_SECONDS), toUtcExclusive: iso(declaredTo), kind: 'TRAILING_UNOBSERVED' });
    }
    return {
        instrument, candles: bars.length,
        firstIntervalStartUtc: first === null ? null : iso(first),
        lastIntervalStartUtc: last === null ? null : iso(last),
        lastIntervalEndUtc: last === null ? null : iso(last + INTERVAL_SECONDS),
        validComponents: components, completionEvidence: completion,
        duplicateTimes: duplicates.length, nonIncreasingTimes: nonordered.length,
        misalignedStarts: misaligned.length, invalidRowsOrComponents: invalid.length,
        firstProblems: [...invalid, ...misaligned.map((index) => ({ index, reason: 'MISALIGNED_START' })),
            ...nonordered.map((index) => ({ index, reason: 'NON_INCREASING_START' }))].slice(0, 20),
        candlesByMonthUtc: Object.fromEntries(Object.entries(months).sort(([a], [b]) => a.localeCompare(b))),
        unobservedIntervals: gaps, unobservedBoundaryIntervals: boundaries,
        absentGridSlotsBetweenObservedCandles: gaps.reduce((sum, gap) => sum + gap.absentGridSlots, 0),
        sideCloseDifferencePips: { median: percentile(0.5), p95: percentile(0.95),
            negativeCount: sideCloseDifferences.filter((value) => value < 0).length,
            meaning: 'Ask-component close minus bid-component close; components can close at different events. This is not a synchronous executable account spread.' },
    };
}

function priorResults(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
        const file = path.join(directory, name);
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { path: location(file), sha256: digest(file), generatedAt: saved.generatedAt ?? null,
            evaluationUse: 'ALREADY_INSPECTED_RETROSPECTIVE', sourceCodeRevisionRetained: saved.source?.revision ?? null,
            periods: saved.periods ?? [], results: (saved.results ?? []).map((row) => ({
                variant: row.variant?.id ?? null, period: row.period ?? null, stress: row.stress ?? null,
                trades: row.statistics?.tradeCount ?? null, profitFactor: row.statistics?.profitFactor ?? null,
                netPnlAud: row.statistics?.netPnlAud ?? null, assumptions: row.assumptions ?? {},
            })) };
    });
}

function audit(archive, baseline, oldResults) {
    const saved = JSON.parse(fs.readFileSync(archive, 'utf8'));
    if (saved?.granularity !== 'M15' || !saved.candlesByInstrument || typeof saved.candlesByInstrument !== 'object'
        || Array.isArray(saved.candlesByInstrument)) throw new Error('Expected the retained M15 candlesByInstrument schema; no implicit adapter');
    const start = saved.from, end = saved.to;
    if (![start, end].every((value) => typeof value === 'number' && Number.isFinite(value)) || start > end) {
        throw new Error('Missing or invalid declared seconds bounds');
    }
    const instruments = Object.entries(saved.candlesByInstrument).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bars]) => summarizeInstrument(name, bars, start, end));
    const baselineSaved = baseline ? JSON.parse(fs.readFileSync(baseline, 'utf8')) : null;
    return {
        schemaVersion: 1, artifactKind: 'LOCAL_INPUT_COVERAGE_AUDIT', baseline: baselineSaved?.baseline ?? null,
        source: { path: location(archive), sha256: digest(archive), bytes: fs.statSync(archive).size,
            provider: saved.source ?? null, downloadedAt: saved.downloadedAt ?? null, schemaVersion: saved.schemaVersion ?? null,
            granularity: 'M15', priceComponentsDeclared: saved.pricingComponents ?? null,
            completeCandlesOnlyDeclared: saved.completeCandlesOnly ?? null,
            timestampUnit: 'UNIX_SECONDS', timestampMeaning: 'INTERVAL_START',
            declaredFromUtc: iso(start), declaredToUtc: iso(end),
            declaredToInclusivity: 'UNVERIFIED; report actual last interval separately',
            evaluationUse: 'DEVELOPMENT_OR_RETROSPECTIVE_ROBUSTNESS; ALL OLD HOLDOUT PERIODS ALREADY INSPECTED' },
        tools: { auditPath: location(__filename), auditSha256: digest(__filename), runtime: `Node.js ${process.versions.node} standard library` },
        baselineInput: baseline ? { path: location(baseline), sha256: digest(baseline) } : null,
        coverage: { instruments: instruments.length, candles: instruments.reduce((sum, row) => sum + row.candles, 0),
            structuralProblems: instruments.reduce((sum, row) => sum + row.duplicateTimes + row.nonIncreasingTimes
                + row.misalignedStarts + row.invalidRowsOrComponents, 0) },
        instruments, previousResearch: priorResults(oldResults),
        limits: [
            'Unobserved intervals include possible closures, holidays, quiet intervals and capture gaps; this audit cannot distinguish them or diagnose a broker outage.',
            'Per-candle completion flags may not have been retained. The top-level completed-only claim is provenance, not independently verified completion evidence.',
            'M15 OHLC does not establish intrabar event ordering, exact account quotes/fills, ten-second breakeven polling, historical liquidity or financing.',
            'H1 reconstruction and contemporaneous AUD conversion parity have not yet been validated.',
            'Input validity does not establish strategy profitability. This artifact performs no strategy replay and generates no replacement fills.',
            'Reviewed September/October outcomes and all previous holdout results remain development/retrospective evidence; reserve future outcomes after candidate freeze for untouched evaluation.',
        ],
    };
}

function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
    return value;
}

function main(argv = process.argv.slice(2)) {
    const options = { archive: DEFAULT_ARCHIVE, baseline: path.join(ROOT, 'docs/reviews/evidence/2026-10-06/planning-baseline.json'),
        'prior-results': path.join(ROOT, 'backend/data/backtests'), output: DEFAULT_OUTPUT };
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--help' || argv[index] === '-h') {
            console.log('Usage: node audit_inputs.cjs [--archive path] [--baseline path] [--prior-results directory] [--output path]');
            return 0;
        }
        const option = argv[index];
        const equal = option.indexOf('=');
        const key = option.startsWith('--') ? option.slice(2, equal < 0 ? undefined : equal) : '';
        const value = equal < 0 ? argv[index + 1] : option.slice(equal + 1);
        if (!Object.hasOwn(options, key) || !value || value.startsWith('--')) throw new Error(`Unknown or incomplete audit option: ${option}`);
        options[key] = value;
        if (equal < 0) index++;
    }
    const result = audit(options.archive, options.baseline, options['prior-results']);
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(sorted(result), null, 2)}\n`);
    console.log(JSON.stringify({ output: options.output, coverage: result.coverage, historicalUse: result.source.evaluationUse }));
    return result.coverage.structuralProblems ? 1 : 0;
}

if (require.main === module) {
    try { process.exitCode = main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { audit, digest, iso, location, pricesValid, roundedSix, summarizeInstrument, priorResults, sorted, main, DEFAULT_OUTPUT };
