const path = require('node:path');
const { hashReplaySources, verifyReplaySources } = require('../replayManifest.cjs');

const root = path.resolve(__dirname, '../../..');

test('replay pins actual runtime transitive sources, migrations, configuration and harness', () => {
    const hashes = hashReplaySources(root);
    for (const file of ['backend/src/utils/indicators.js', 'backend/src/runtime/intradayLossResetPolicy.js',
        'backend/src/services/tradeReconciliationService.js', 'backend/src/services/analyticsService.js',
        'shared/tradingConfigDefaults.json', 'backend/research/__tests__/persistedReplay.test.js']) {
        expect(hashes[file]).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(Object.keys(hashes).some((file) => file.startsWith('backend/migrations/'))).toBe(true);
    expect(verifyReplaySources(root, hashes)).toEqual(hashes);
});

test('missing transitive pin, stale content or newly unpinned source cannot claim parity', () => {
    const hashes = hashReplaySources(root);
    const missing = { ...hashes };
    delete missing['backend/src/utils/indicators.js'];
    expect(() => verifyReplaySources(root, missing)).toThrow('complete source');
    expect(() => verifyReplaySources(root, { ...hashes, 'backend/src/utils/indicators.js': '0'.repeat(64) }))
        .toThrow('Replay source differs');
    expect(() => verifyReplaySources(root, { ...hashes, 'backend/src/unrecorded.js': '0'.repeat(64) }))
        .toThrow('complete source');
});
