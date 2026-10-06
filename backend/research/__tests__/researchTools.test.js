const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const audit = require('../audit_inputs.cjs');
const protocol = require('../protocol.cjs');

const HERE = path.resolve(__dirname, '..');
const NOW = new Date('2026-10-06T00:00:00Z');
const clone = (value) => JSON.parse(JSON.stringify(value));
function bar(time) {
    return { time, complete: true, ...Object.fromEntries(['mid', 'bid', 'ask'].map((component) =>
        [component, { o: 1, h: 1.1, l: 0.9, c: 1 }])) };
}
function candidate() {
    return { schemaVersion: 1, candidateId: 'fixture', hypothesis: 'Fixture only',
        baselineIdentity: { revision: 'fixture' }, dataManifestSha256: 'a'.repeat(64),
        entryPolicy: 'unchanged', exitPolicy: 'unchanged', featuresKnownAtDecision: ['completed bar'],
        costCases: ['bid/ask'], economicObjectives: ['net-R baseline comparison'], uncertaintyMethod: 'episode clusters',
        trialBudget: { maximumVariants: 1, selectionRule: 'retain all results' },
        labelPolicy: 'declare actual vs modelled', evaluationUse: 'FUTURE_UNTOUCHED',
        outcomeAccessPolicy: 'reveal after final interval closes',
        periods: [{ role: 'FINAL_EVALUATION', fromUtc: '2027-01-01T00:00:00Z',
            toUtcExclusive: '2027-02-01T00:00:00Z', alreadyInspected: false }] };
}

let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-node-research-tools-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });
function save(name, value) {
    const file = path.join(directory, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
}
function cli(tool, args) {
    return spawnSync(process.execPath, [path.join(HERE, `${tool}.cjs`), ...args],
        { encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_OPTIONS: '' } });
}

describe('Node retained-input coverage audit', () => {
    test('absent intervals remain coverage, with explicit leading/trailing observations', () => {
        const rows = [bar(900), bar(1800), bar(4500)];
        const result = audit.summarizeInstrument('EUR_USD', rows, 0, 6300);
        expect(result).toMatchObject({ candles: 3, invalidRowsOrComponents: 0,
            absentGridSlotsBetweenObservedCandles: 2, firstIntervalStartUtc: '1970-01-01T00:15:00Z',
            lastIntervalEndUtc: '1970-01-01T01:30:00Z', validComponents: { mid: 3, bid: 3, ask: 3 } });
        expect(result.unobservedIntervals).toEqual([{ fromUtc: '1970-01-01T00:45:00Z',
            toUtcExclusive: '1970-01-01T01:15:00Z', absentGridSlots: 2 }]);
        expect(result.unobservedBoundaryIntervals).toEqual([
            { fromUtc: '1970-01-01T00:00:00Z', toUtcExclusive: '1970-01-01T00:15:00Z', kind: 'LEADING_UNOBSERVED' },
            { fromUtc: '1970-01-01T01:30:00Z', toUtcExclusive: '1970-01-01T01:45:00Z', kind: 'TRAILING_UNOBSERVED' },
        ]);
        expect(result).not.toHaveProperty('unhealthy');
    });

    test('records duplicates, disorder, alignment and invalid components without dropping valid evidence', () => {
        const rows = [bar(0), bar(0), bar(901), bar(900)];
        rows[2].ask.h = 0.5;
        const result = audit.summarizeInstrument('EUR_USD', rows, 0, 1800);
        expect(result).toMatchObject({ duplicateTimes: 1, nonIncreasingTimes: 2,
            misalignedStarts: 1, invalidRowsOrComponents: 1, validComponents: { mid: 4, bid: 4, ask: 3 } });
        expect(result.firstProblems).toEqual([
            { index: 2, reason: 'INVALID_OR_MISSING_OHLC', component: 'ask' },
            { index: 2, reason: 'MISALIGNED_START' },
            { index: 1, reason: 'NON_INCREASING_START' },
            { index: 3, reason: 'NON_INCREASING_START' },
        ]);
    });

    test.each([true, '900', NaN, Infinity, 900.1, null])('rejects noninteger numeric timestamp evidence %s', (time) => {
        const result = audit.summarizeInstrument('USD_JPY', [bar(time)], 0, 1800);
        expect(result.invalidRowsOrComponents).toBe(1);
        expect(result.firstProblems).toEqual([{ index: 0, reason: 'INVALID_SECONDS_TIMESTAMP' }]);
        expect(result.completionEvidence).toEqual({});
    });

    test('retains unknown/incomplete completion and JPY close-difference units', () => {
        const rows = [bar(0), bar(900), bar(1800)];
        delete rows[0].complete;
        rows[1].complete = false;
        rows.forEach((row, index) => { row.ask.c = 1 + [0.01, -0.01, 0.02][index]; });
        const result = audit.summarizeInstrument('USD_JPY', rows, 0, 2700);
        expect(result.completionEvidence).toEqual({ not_retained_per_candle: 1, explicit_incomplete: 1, explicit_complete: 1 });
        expect(result.sideCloseDifferencePips).toMatchObject({ median: 1, p95: 1, negativeCount: 1 });
        expect(result.sideCloseDifferencePips.meaning).toContain('not a synchronous executable account spread');
        expect(audit.summarizeInstrument('EUR_USD', [], 0, 900).sideCloseDifferencePips.median).toBeNull();
    });

    test('numeric OHLC validation rejects booleans/strings and UTC formatting keeps seconds/microseconds', () => {
        expect(audit.pricesValid({ o: true, h: 2, l: 0.5, c: 1 })).toBe(false);
        expect(audit.pricesValid({ o: '1', h: 2, l: 0.5, c: 1 })).toBe(false);
        expect(audit.iso(0)).toBe('1970-01-01T00:00:00Z');
        expect(audit.iso(0.000001)).toBe('1970-01-01T00:00:00.000001Z');
        expect(audit.roundedSix(0.0078125)).toBe(0.007812);
        expect(audit.roundedSix(0.0234375)).toBe(0.023438);
        expect(audit.roundedSix(-0.0078125)).toBe(-0.007812);
    });

    test('real file CLI output is deterministic, hashes sources, preserves rewrite semantics and failure exit', () => {
        const archive = save('archive.json', { granularity: 'M15', from: 0, to: 4500, pricingComponents: 'MBA',
            completeCandlesOnly: true, candlesByInstrument: { USD_JPY: [bar(0)], EUR_USD: [bar(0), bar(900), bar(3600)] } });
        const baseline = save('baseline.json', { baseline: { strategy: 'fixture' } });
        const prior = path.join(directory, 'prior');
        const priorPath = save('prior/saved.json', { generatedAt: 'fixture', source: { revision: 'fixture' },
            results: [{ variant: { id: 'old-trial' }, statistics: { tradeCount: 3, profitFactor: 0.5, netPnlAud: -1 } }] });
        const output = path.join(directory, 'new', 'audit.json');
        const args = ['--archive', archive, '--baseline', baseline, '--prior-results', prior, '--output', output];
        expect(cli('audit_inputs', args).status).toBe(0);
        const original = fs.readFileSync(output, 'utf8'), saved = JSON.parse(original);
        expect(saved.coverage).toEqual({ instruments: 2, candles: 4, structuralProblems: 0 });
        expect(saved.source.sha256).toBe(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'));
        expect(saved.tools).toMatchObject({ auditPath: 'backend/research/audit_inputs.cjs',
            runtime: `Node.js ${process.versions.node} standard library`, auditSha256: audit.digest(path.join(HERE, 'audit_inputs.cjs')) });
        expect(saved.previousResearch[0]).toMatchObject({ sha256: audit.digest(priorPath),
            evaluationUse: 'ALREADY_INSPECTED_RETROSPECTIVE', sourceCodeRevisionRetained: 'fixture' });
        expect(saved.previousResearch[0].results).toEqual([{ variant: 'old-trial', period: null, stress: null,
            trades: 3, profitFactor: 0.5, netPnlAud: -1, assumptions: {} }]);
        expect(cli('audit_inputs', args).status).toBe(0);
        expect(fs.readFileSync(output, 'utf8')).toBe(original);
        expect(cli('audit_inputs', args.reduce((result, option, index) => index % 2 ? result
            : [...result, `${option}=${args[index + 1]}`], [])).status).toBe(0);
        expect(fs.readFileSync(output, 'utf8')).toBe(original);
        const invalidArchive = save('invalid.json', { granularity: 'M15', from: 0, to: 900,
            candlesByInstrument: { EUR_USD: [bar(0), bar(0)] } });
        expect(cli('audit_inputs', ['--archive', invalidArchive, ...args.slice(2)]).status).toBe(1);
        expect(JSON.parse(fs.readFileSync(output, 'utf8')).coverage.structuralProblems).toBe(2);
        expect(cli('audit_inputs', ['--archive', path.join(directory, 'absent'), ...args.slice(2)]).status).toBe(1);
    });

    test('schema and declared bounds fail explicitly rather than introducing adapters', () => {
        const file = save('bad.json', { granularity: 'H1', candlesByInstrument: {} });
        expect(() => audit.audit(file, null, directory)).toThrow('no implicit adapter');
        const bounds = save('bounds.json', { granularity: 'M15', from: 2, to: 1, candlesByInstrument: {} });
        expect(() => audit.audit(bounds, null, directory)).toThrow('seconds bounds');
        expect(audit.DEFAULT_OUTPUT).toContain('input-audit-node.json');
    });
});

describe('Node prespecified protocol and durable trial ledger', () => {
    test('future final periods remain strictly unstarted and explicitly uninspected', () => {
        expect(protocol.validate(candidate(), NOW).valid).toBe(true);
        expect(() => protocol.validate(candidate(), new Date('2027-01-01T00:00:00Z'))).toThrow('already begun/inspected');
        const inspected = candidate(); inspected.periods[0].alreadyInspected = true;
        expect(() => protocol.validate(inspected, NOW)).toThrow('already begun/inspected');
        delete inspected.periods[0].alreadyInspected;
        expect(() => protocol.validate(inspected, NOW)).toThrow('already begun/inspected');
        const noPolicy = candidate(); delete noPolicy.outcomeAccessPolicy;
        expect(() => protocol.validate(noPolicy, NOW)).toThrow('outcome-access');
    });

    test('retrospective finals retain their declared status even if already inspected', () => {
        const value = candidate(); value.evaluationUse = 'RETROSPECTIVE';
        value.periods[0].fromUtc = '2020-01-01T00:00:00Z';
        value.periods[0].toUtcExclusive = '2020-02-01T00:00:00Z';
        value.periods[0].alreadyInspected = true;
        delete value.outcomeAccessPolicy;
        expect(protocol.validate(value, NOW)).toMatchObject({ valid: true, evaluationUse: 'RETROSPECTIVE' });
    });

    test('timezone offsets compare instants and submillisecond period boundaries remain distinct', () => {
        expect(protocol.stamp('2027-01-01T11:00:00+11:00')).toBe(protocol.stamp('2027-01-01T00:00:00Z'));
        const value = candidate();
        value.periods[0].fromUtc = '2027-01-01T00:00:00.000001Z';
        value.periods[0].toUtcExclusive = '2027-01-01T00:00:00.000002Z';
        expect(protocol.validate(value, '2027-01-01T00:00:00Z').valid).toBe(true);
        expect(() => protocol.validate(value, '2027-01-01T00:00:00.000001Z')).toThrow('already begun');
    });

    test.each(['2027-01-01', '2027-01-01T00:00:00', '2027-02-30T00:00:00Z',
        '2027-01-01T24:00:00Z', '2027-01-01T00:00:00+25:00', null])('rejects invalid or timezone-free boundary %s', (boundary) => {
        expect(() => protocol.stamp(boundary)).toThrow();
    });

    test('allows adjacent periods but rejects overlap, unknown roles and missing final periods', () => {
        const value = candidate();
        value.periods.unshift({ role: 'DEVELOPMENT', fromUtc: '2026-01-01T00:00:00Z', toUtcExclusive: '2027-01-01T00:00:00Z' });
        expect(protocol.validate(value, NOW).valid).toBe(true);
        const overlap = clone(value); overlap.periods[1].fromUtc = '2026-12-31T00:00:00Z';
        expect(() => protocol.validate(overlap, NOW)).toThrow('nonoverlapping');
        const unknown = clone(value); unknown.periods[0].role = 'UNKNOWN';
        expect(() => protocol.validate(unknown, NOW)).toThrow('Unknown period role');
        const noFinal = candidate(); noFinal.periods[0].role = 'VALIDATION';
        expect(() => protocol.validate(noFinal, NOW)).toThrow('final evaluation period');
    });

    test.each([0, -1, 1.5, true, '2'])('rejects invalid variant budget %s', (maximumVariants) => {
        const value = candidate(); value.trialBudget.maximumVariants = maximumVariants;
        expect(() => protocol.validate(value, NOW)).toThrow('maximumVariants');
    });

    test('requires explicit nonempty specification and frozen lowercase manifest identity', () => {
        const value = candidate(); value.featuresKnownAtDecision = [];
        expect(() => protocol.validate(value, NOW)).toThrow('featuresKnownAtDecision');
        const identity = candidate(); identity.baselineIdentity = {};
        expect(() => protocol.validate(identity, NOW)).toThrow('baselineIdentity');
        const hash = candidate(); hash.dataManifestSha256 = 'A'.repeat(64);
        expect(() => protocol.validate(hash, NOW)).toThrow('frozen input manifest');
    });

    test('file CLI preserves registered protocol and all result statuses, hashes artifact bytes and rejects unregistered/duplicate IDs', () => {
        const value = candidate(); value.evaluationUse = 'RETROSPECTIVE';
        const spec = save('candidate.json', value), artifact = save('artifact.json', { fixtureOnly: true });
        const ledger = path.join(directory, 'ledger', 'trials.json');
        expect(cli('protocol', ['validate', spec]).status).toBe(0);
        expect(cli('protocol', ['register', spec, '--ledger', ledger]).status).toBe(0);
        const registeredBytes = fs.readFileSync(ledger, 'utf8');
        expect(cli('protocol', ['register', spec, '--ledger', ledger]).status).toBe(1);
        expect(fs.readFileSync(ledger, 'utf8')).toBe(registeredBytes);
        for (const status of ['SUPPORTED', 'REJECTED', 'INCONCLUSIVE', 'ABANDONED']) {
            expect(cli('protocol', ['result', value.candidateId, '--ledger', ledger, '--artifact', artifact, '--status', status]).status).toBe(0);
        }
        const saved = JSON.parse(fs.readFileSync(ledger, 'utf8'));
        expect(saved.schemaVersion).toBe(1);
        expect(saved.events[0]).toMatchObject({ kind: 'REGISTERED', candidateId: 'fixture', protocol: value, specSha256: protocol.sha(spec) });
        expect(saved.events[0].registeredAtUtc).toMatch(/Z$/);
        expect(saved.events.slice(1).map((event) => event.status)).toEqual(['SUPPORTED', 'REJECTED', 'INCONCLUSIVE', 'ABANDONED']);
        for (const event of saved.events.slice(1)) expect(event).toMatchObject({ kind: 'RESULT_RECORDED', candidateId: 'fixture', artifact, artifactSha256: protocol.sha(artifact) });
        expect(fs.existsSync(`${ledger}.tmp`)).toBe(false);
        expect(cli('protocol', ['result', 'unregistered', '--ledger', ledger, '--artifact', artifact, '--status', 'REJECTED']).status).toBe(1);
        expect(cli('protocol', ['result', 'fixture', '--ledger', ledger, '--artifact', artifact, '--status', 'OTHER']).status).toBe(1);
        expect(JSON.parse(fs.readFileSync(ledger, 'utf8'))).toEqual(saved);
    });

    test('existing unsupported ledger is not overwritten', () => {
        const ledger = save('ledger.json', { schemaVersion: 2, events: [] });
        const bytes = fs.readFileSync(ledger, 'utf8');
        expect(() => protocol.appendEvent(ledger, { kind: 'REGISTERED', candidateId: 'fixture' })).toThrow('Unsupported trial ledger');
        expect(fs.readFileSync(ledger, 'utf8')).toBe(bytes);
    });

    test('CLI help and equals-form options preserve ordinary command usage', () => {
        expect(cli('audit_inputs', ['--help']).status).toBe(0);
        expect(cli('protocol', ['register', '--help']).status).toBe(0);
        const value = candidate(); value.evaluationUse = 'RETROSPECTIVE';
        const spec = save('candidate.json', value), ledger = path.join(directory, 'ledger.json');
        expect(cli('protocol', ['register', spec, `--ledger=${ledger}`]).status).toBe(0);
        expect(JSON.parse(fs.readFileSync(ledger, 'utf8')).events[0].candidateId).toBe('fixture');
    });
});
