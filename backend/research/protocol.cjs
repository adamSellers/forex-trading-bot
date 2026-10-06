#!/usr/bin/env node
'use strict';

// A local protocol/trial ledger records assertions and hashes. It does not prove
// outcomes were unseen, grant entry permission or promote/deploy a strategy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sorted } = require('./audit_inputs.cjs');

function stamp(value) {
    if (typeof value !== 'string') throw new Error('Period boundaries must be explicit timezone-aware ISO strings');
    // Date.parse accepts local dates and silently rolls some invalid calendars.
    // Validate the declared calendar and timezone before comparing UTC instants.
    const match = /^(\d{4})-?(\d{2})-?(\d{2})[Tt ](\d{2}):?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?(?::?\d{2}(?:[.,]\d+)?)?)$/.exec(value);
    if (!match) throw new Error('Period boundaries must include a timezone and a valid ISO calendar');
    const [, y, mo, d, h, mi, s = '0', fraction = '', zone] = match;
    const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) throw new Error('Invalid ISO period boundary');
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    calendar.setUTCHours(hour, minute, second, 0);
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new Error('Invalid ISO period boundary');
    let offsetMicros = 0n;
    if (zone !== 'Z') {
        const offset = /^([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2})(?:[.,](\d+))?)?$/.exec(zone);
        const [, sign, zh, zm = '0', zs = '0', zf = ''] = offset;
        if (Number(zh) > 23 || Number(zm) > 59 || Number(zs) > 59) throw new Error('Invalid ISO timezone offset');
        offsetMicros = BigInt(Number(zh) * 3600 + Number(zm) * 60 + Number(zs)) * 1_000_000n
            + BigInt(zf.padEnd(6, '0').slice(0, 6) || '0');
        if (sign === '-') offsetMicros = -offsetMicros;
    }
    // The prior tool compared microsecond datetimes. Retain that precision for
    // period overlap/future checks instead of truncating to Date milliseconds.
    return BigInt(calendar.getTime()) * 1000n + BigInt(fraction.padEnd(6, '0').slice(0, 6) || '0') - offsetMicros;
}

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function meaningful(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return Boolean(value);
}

function validate(spec, registeredAt = new Date()) {
    const registeredMicros = typeof registeredAt === 'string' ? stamp(registeredAt)
        : registeredAt instanceof Date && Number.isFinite(registeredAt.getTime()) ? BigInt(registeredAt.getTime()) * 1000n : null;
    if (registeredMicros === null) throw new Error('Invalid protocol registration time');
    if (spec?.schemaVersion !== 1) throw new Error('Unsupported protocol schema');
    for (const key of ['candidateId', 'hypothesis', 'baselineIdentity', 'dataManifestSha256', 'entryPolicy',
        'exitPolicy', 'featuresKnownAtDecision', 'costCases', 'economicObjectives', 'uncertaintyMethod',
        'trialBudget', 'periods', 'labelPolicy', 'evaluationUse']) {
        if (!meaningful(spec[key])) throw new Error(`Missing explicit protocol field: ${key}`);
    }
    if (!['RETROSPECTIVE', 'FUTURE_UNTOUCHED'].includes(spec.evaluationUse)) throw new Error('evaluationUse must distinguish retrospective from future untouched evidence');
    if (typeof spec.dataManifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(spec.dataManifestSha256)) throw new Error('dataManifestSha256 must identify the frozen input manifest');
    const budget = spec.trialBudget;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget) || !Number.isInteger(budget.maximumVariants)
        || budget.maximumVariants < 1 || !meaningful(budget.selectionRule)) throw new Error('trialBudget requires a positive maximumVariants and an explicit selectionRule');
    if (!Array.isArray(spec.periods)) throw new Error('periods must be an explicit ordered list');
    let previousEnd = null;
    const finalPeriods = [];
    for (const period of spec.periods) {
        const start = stamp(period?.fromUtc), end = stamp(period?.toUtcExclusive);
        if (start >= end || (previousEnd !== null && start < previousEnd)) throw new Error('Period boundaries must be chronological and nonoverlapping');
        previousEnd = end;
        if (!['DEVELOPMENT', 'VALIDATION', 'FINAL_EVALUATION'].includes(period.role)) throw new Error('Unknown period role');
        if (period.role === 'FINAL_EVALUATION') finalPeriods.push([period, start]);
    }
    if (!finalPeriods.length) throw new Error('Specify a final evaluation period, including its retrospective/future status');
    if (spec.evaluationUse === 'FUTURE_UNTOUCHED') {
        if (!meaningful(spec.outcomeAccessPolicy)) throw new Error('Future protocols need an explicit outcome-access and reveal policy');
        for (const [period, start] of finalPeriods) {
            if (start <= registeredMicros || period.alreadyInspected !== false) throw new Error('A final interval already begun/inspected cannot be relabelled future untouched');
        }
    }
    return { valid: true, candidateId: spec.candidateId, evaluationUse: spec.evaluationUse,
        limits: 'Protocol/ledger metadata cannot prove that nobody inspected outcomes or validate a profitability claim.' };
}

function appendEvent(file, event) {
    const ledger = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { schemaVersion: 1, events: [] };
    if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger.events)) throw new Error('Unsupported trial ledger');
    const registered = ledger.events.some((row) => row?.kind === 'REGISTERED' && row.candidateId === event.candidateId);
    if (event.kind === 'REGISTERED' && registered) throw new Error('Candidate ID already registered; use a new identity for a changed specification');
    if (event.kind !== 'REGISTERED' && !registered) throw new Error('Record the protocol before recording its result or abandonment');
    ledger.events.push(event);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(sorted(ledger), null, 2)}\n`);
    fs.renameSync(temporary, file);
}

function main(argv = process.argv.slice(2), now = new Date()) {
    if ((argv.length === 1 && ['--help', '-h'].includes(argv[0]))
        || (['validate', 'register', 'result'].includes(argv[0]) && ['--help', '-h'].includes(argv[1]))) {
        console.log('Usage: node protocol.cjs validate spec.json | register spec.json --ledger ledger.json | result candidate-id --ledger ledger.json --artifact result.json --status SUPPORTED|REJECTED|INCONCLUSIVE|ABANDONED');
        return 0;
    }
    const [operation, input, ...remaining] = argv;
    if (!['validate', 'register', 'result'].includes(operation) || !input || input.startsWith('--')) throw new Error('Specify validate/register with a protocol or result with a candidate ID');
    const allowed = operation === 'register' ? ['ledger'] : operation === 'result' ? ['ledger', 'artifact', 'status'] : [];
    const options = {};
    for (let index = 0; index < remaining.length; index++) {
        const option = remaining[index];
        const equal = option.indexOf('=');
        const key = option.startsWith('--') ? option.slice(2, equal < 0 ? undefined : equal) : '';
        const value = equal < 0 ? remaining[index + 1] : option.slice(equal + 1);
        if (!allowed.includes(key) || !value || value.startsWith('--')) throw new Error(`Unknown or incomplete protocol option: ${option}`);
        options[key] = value;
        if (equal < 0) index++;
    }
    for (const key of allowed) if (!options[key]) throw new Error(`Missing protocol option: --${key}`);
    let result;
    if (operation === 'validate' || operation === 'register') {
        const spec = JSON.parse(fs.readFileSync(input, 'utf8'));
        result = validate(spec, now);
        if (operation === 'register') appendEvent(options.ledger, { kind: 'REGISTERED', registeredAtUtc: now.toISOString(),
            candidateId: spec.candidateId, specSha256: sha(input), protocol: spec });
    } else {
        if (!['SUPPORTED', 'REJECTED', 'INCONCLUSIVE', 'ABANDONED'].includes(options.status)) throw new Error('Unknown result status');
        appendEvent(options.ledger, { kind: 'RESULT_RECORDED', recordedAtUtc: now.toISOString(),
            candidateId: input, status: options.status, artifactSha256: sha(options.artifact), artifact: options.artifact });
        result = { recorded: true, candidateId: input, status: options.status };
    }
    console.log(JSON.stringify(result));
    return 0;
}

if (require.main === module) {
    try { process.exitCode = main(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { stamp, sha, validate, appendEvent, main };
