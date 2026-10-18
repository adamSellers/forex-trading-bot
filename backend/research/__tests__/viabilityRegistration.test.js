const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashReplaySources } = require('../replayManifest.cjs');
const { verifyViabilityRegistration } = require('../viabilityRegistration.cjs');
const root = path.resolve(__dirname, '../../..');
let directory;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viability-registration-test-')); });
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
function fixture() {
    const write = (name, value) => { const bytes = JSON.stringify(value), file = path.join(directory, name);
        fs.writeFileSync(file, bytes); return { path: file, sha256: hash(bytes) }; };
    const archive = write('archive.json', {}), metadata = write('metadata.json', { instruments: [{ name: 'EUR_USD', marginRate: '0.03333333333333' }] });
    const protocol = write('protocol.json', { baselineIdentity: { assets: ['EUR_USD'] } });
    const input = write('input.json', { files: [archive, metadata] });
    const shared = { homeConversionFeeRate: 0.01, unrealizedConversionPurpose: 'position', policyOptimization: true,
        initialBalanceAud: 100, commissionAud: 0 };
    const launch = write('launch.json', { ...shared, sourceHashes: hashReplaySources(root), protocolSha256: protocol.sha256,
        inputManifestSha256: input.sha256, scoredCohorts: [{ id: 'test', fromUtc: '2026-01-01T00:00:00Z', toUtcExclusive: '2026-02-01T00:00:00Z', warmupDays: 40 }],
        models: [{ id: 'test', spreadsPips: { EUR_USD: 1 }, slippagePips: 0.2 }], paths: ['OHLC'] });
    const spec = { ...shared, archivePath: archive.path, archiveSha256: archive.sha256,
        instrumentMetadataPath: metadata.path, instrumentMetadataSha256: metadata.sha256,
        protocolPath: protocol.path, protocolSha256: protocol.sha256, inputManifestPath: input.path, inputManifestSha256: input.sha256,
        launchRegistrationPath: launch.path, launchRegistrationSha256: launch.sha256, cohortId: 'test', costCaseId: 'test',
        fromUtc: '2026-01-01T00:00:00Z', toUtcExclusive: '2026-02-01T00:00:00Z', pathOrder: 'OHLC', assets: ['EUR_USD'],
        spreadPips: { EUR_USD: 1 }, slippagePips: 0.2 };
    return { spec, specPath: path.join(directory, 'spec.json'), root };
}
test('all registered resources, exact full source set, cohort and physics declarations validate', () => {
    const result = verifyViabilityRegistration(fixture());
    expect(result.instrumentMetadata.EUR_USD.marginRate).toBe('0.03333333333333');
    expect(result.sourceHashes).toEqual(hashReplaySources(root));
});
test.each(['protocol', 'inputManifest', 'launchRegistration', 'instrumentMetadata'])('changed pinned %s is rejected before market replay', (stem) => {
    const args = fixture(); fs.appendFileSync(args.spec[`${stem}Path`], ' ');
    expect(() => verifyViabilityRegistration(args)).toThrow('hash mismatch');
});
test.each([{ homeConversionFeeRate: 0 }, { unrealizedConversionPurpose: 'pnl' }, { policyOptimization: false },
    { spreadPips: { EUR_USD: 0.5 } }, { fromUtc: '2026-01-02T00:00:00Z' }])('unregistered declarations %j cannot silently change a run', (change) => {
    const args = fixture(); Object.assign(args.spec, change);
    expect(() => verifyViabilityRegistration(args)).toThrow();
});
test('a missing transitive source pin is rejected before market replay', () => {
    const args = fixture(), file = args.spec.launchRegistrationPath, launch = JSON.parse(fs.readFileSync(file));
    delete launch.sourceHashes['backend/src/runtime/currencyConversion.js'];
    fs.writeFileSync(file, JSON.stringify(launch)); args.spec.launchRegistrationSha256 = hash(fs.readFileSync(file));
    expect(() => verifyViabilityRegistration(args)).toThrow('complete source');
});
