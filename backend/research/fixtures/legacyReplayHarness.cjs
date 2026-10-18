// Test compatibility for the retained v6 synthetic M15 scenarios. This does not
// restore the original executable source closure or republish historical results;
// those remain pinned to the separately preserved r3 source bundle.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { afterEach, jest: jestApi } = require('@jest/globals');
const retainedDefaults = require('../../../shared/legacyIntradayConfigDefaults.json');
const original = require('../testHarness.cjs');

const LEGACY_FIXTURE_IDENTITY = Object.freeze({
    strategy: 'intraday_momentum', strategyVersion: '1.4.0', configSchemaVersion: 4,
    releaseVersion: 'm15-intraday-v6', executionPolicyVersion: 'intraday-risk-v6',
    originalConfigSourceSha256: 'dcfd0a08d865ea80d6b3e71476f0d4044d7fdc3f2de132642d0bcf9969d85fbf',
    configJsonSha256: '8361dabc098e2c1c5baf355e79e9c3f612293ef746a57b4bdacbb463be60e88c',
    historicalSourceBundleSha256: 'a9aa201d48c2b93f3e26ab426479cbd3f4249c0710dffa399885d0a800d27835',
});

function cloneLegacyConfig() {
    const actual = crypto.createHash('sha256').update(JSON.stringify(retainedDefaults)).digest('hex');
    if (actual !== LEGACY_FIXTURE_IDENTITY.configJsonSha256) {
        throw new Error('Retained v6 fixture configuration differs from its original source-bundle values');
    }
    return JSON.parse(JSON.stringify(retainedDefaults));
}

function createReplayTestHarness() {
    // These fixtures exercise the retired release, so its deployed-default
    // input must also be explicit. Otherwise the current ConfigService correctly
    // migrates their saved v6 files into H4 before any legacy scenario can run.
    // Retain every real normalization/hash method and the actual orchestrator;
    // only this test process's declared release-default input is substituted.
    jestApi.doMock('../../src/config/tradingConfig', () => ({
        ...jestApi.requireActual('../../src/config/tradingConfig'),
        cloneDefaultConfig: cloneLegacyConfig,
        DEFAULT_TRADING_CONFIG: cloneLegacyConfig(),
    }));
    const harness = original.createReplayTestHarness();
    const replay = harness.replay;
    const directories = new Set();
    // The financial research harness is retained unchanged. Supplying an actual
    // caller-owned legacy configuration makes the intended historical identity
    // explicit at its existing persistence seam, including across cold restart.
    harness.replay = async (options = {}) => {
        let configPath = options.configPath;
        if (!configPath) {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-v6-fixture-'));
            directories.add(directory);
            configPath = path.join(directory, 'config.json');
        }
        if (!fs.existsSync(configPath)) {
            fs.mkdirSync(path.dirname(configPath), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({ ...cloneLegacyConfig(),
                assets: options.assets || cloneLegacyConfig().assets,
                enableTrading: true, enableEmailAlerts: false }));
        } else {
            const retained = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (retained.strategy !== LEGACY_FIXTURE_IDENTITY.strategy ||
                retained.liveReleaseVersion !== LEGACY_FIXTURE_IDENTITY.releaseVersion ||
                retained.executionPolicyVersion !== LEGACY_FIXTURE_IDENTITY.executionPolicyVersion) {
                throw new Error('Legacy replay fixture cannot reuse another release configuration');
            }
        }
        return replay({ ...options, configPath });
    };
    afterEach(() => {
        for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
        directories.clear();
    });
    return harness;
}

module.exports = { ...original, createReplayTestHarness, cloneLegacyConfig, LEGACY_FIXTURE_IDENTITY };
