#!/usr/bin/env node
'use strict';
// Optional software-runtime repair only. Never use historical mode without a
// separately registered, actual failed-test timeout log for that exact spec.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const backend = path.join(root, 'backend');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const [specArg, outputArg, registrationArg, expectedRegistrationSha256] = process.argv.slice(2);
if (!specArg || !outputArg || !registrationArg || !/^[a-f0-9]{64}$/.test(expectedRegistrationSha256 ?? '')) {
    throw new Error('Usage: node runtime-budget-repair-launcher.cjs spec.json NEW-result.json registration.json registration-sha256');
}
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use supported Node22');
const specPath = path.resolve(specArg), outputPath = path.resolve(outputArg), registrationPath = path.resolve(registrationArg);
if (fs.existsSync(outputPath) || fs.existsSync(`${outputPath}.runtime-repair.json`)) throw new Error('Choose new evidence path');
const registrationBytes = fs.readFileSync(registrationPath);
if (sha(registrationBytes) !== expectedRegistrationSha256) throw new Error('Runtime repair registration hash mismatch');
const registration = JSON.parse(registrationBytes), specBytes = fs.readFileSync(specPath), spec = JSON.parse(specBytes);
if (registration.schemaVersion !== 1 || registration.originalTimeoutMs !== 7_200_000 || registration.extendedTimeoutMs !== 21_600_000 ||
    registration.testName !== 'runs the frozen rules through actual persisted coordinator, entry, risk and exits') throw new Error('Unregistered runtime-only repair');
for (const item of [registration.helper, registration.launcher]) {
    if (sha(fs.readFileSync(path.resolve(root, item.path))) !== item.sha256) throw new Error('Runtime repair executable changed');
}
if (path.resolve(root, registration.launcher.path) !== __filename) throw new Error('Wrong runtime repair launcher');
const allowed = registration.allowedCases?.find((row) => row.caseId === spec.caseId && row.specSha256 === sha(specBytes));
if (!allowed) throw new Error('Case/spec absent from runtime repair registration');
if (registration.mode === 'SOFTWARE_VALIDATION_CONTROL') {
    if (!spec.caseId.startsWith('software-')) throw new Error('Software control cannot run a historical scored case');
} else if (registration.mode === 'ACTUAL_TIMEOUT_RECOVERY') {
    if (allowed.trigger?.kind !== 'ACTUAL_NATIVE_JEST_TIMEOUT' || allowed.trigger.originalTimeoutMs !== 7_200_000) throw new Error('Actual native timeout proof is required');
    const failureBytes = fs.readFileSync(path.resolve(root, allowed.trigger.logPath));
    if (sha(failureBytes) !== allowed.trigger.logSha256 || !/Exceeded timeout of[\s\S]*for a test/.test(failureBytes.toString('utf8'))) throw new Error('Registered actual timeout log proof mismatch');
} else throw new Error('Unsupported runtime repair mode');
const { verifyViabilityRegistration } = require(path.join(root, 'backend/research/viabilityRegistration.cjs'));
const { verifyReplaySources } = require(path.join(root, 'backend/research/replayManifest.cjs'));
const registered = verifyViabilityRegistration({ spec, specPath, root });
if (sha(JSON.stringify(registered.sourceHashes)) !== registration.financialSourcePinSetSha256) throw new Error('Financial source closure differs');
const helperPath = path.resolve(root, registration.helper.path);
const originalConfig = require(path.join(backend, 'jest.config.js'));
const config = { ...originalConfig, rootDir: backend,
    setupFilesAfterEnv: [...originalConfig.setupFilesAfterEnv.map((file) => path.resolve(backend, file)), helperPath] };
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-viability-runtime-repair-'));
const env = { ...process.env, NODE_ENV: 'test', DB_PATH: path.join(directory, 'isolated.db'),
    RESEARCH_REPLAY_ISOLATED: '1', RESEARCH_VIABILITY_SPEC: specPath, RESEARCH_VIABILITY_OUTPUT: outputPath,
    RESEARCH_VIABILITY_RUNTIME_REPAIR_REGISTRATION: registrationPath,
    RESEARCH_VIABILITY_RUNTIME_REPAIR_SHA256: expectedRegistrationSha256 };
for (const key of Object.keys(env)) if (/^(OANDA_|EMAIL_|AWS_|S3_|SMTP_|DOTENV_CONFIG_)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
const startedAtUtc = new Date().toISOString();
let exitCode = null, error = null;
try {
    const child = spawnSync(process.execPath, ['--max-old-space-size=4096', path.join(backend, 'node_modules/jest/bin/jest.js'),
        '--config', JSON.stringify(config), '--runInBand', '--runTestsByPath', path.join(backend, 'research/__tests__/viabilityEvaluation.test.js')],
    { cwd: backend, env, stdio: 'inherit' });
    if (child.error) throw child.error;
    exitCode = child.status ?? 1;
    verifyReplaySources(root, registered.sourceHashes);
    process.exitCode = exitCode;
} catch (caught) { error = caught.message; process.exitCode = 1; throw caught;
} finally {
    const evidence = { schemaVersion: 1, artifactKind: 'EXTERNAL_NATIVE_TIMEOUT_ONLY_RUNTIME_REPAIR_ATTEMPT',
        mode: registration.mode, caseId: spec.caseId, specSha256: sha(specBytes), financialSourcePinSetSha256: registration.financialSourcePinSetSha256,
        runtimeRegistrationPath: path.relative(root, registrationPath), runtimeRegistrationSha256: expectedRegistrationSha256,
        helper: registration.helper, launcher: registration.launcher,
        originalTimeoutMs: registration.originalTimeoutMs, extendedTimeoutMs: registration.extendedTimeoutMs,
        startedAtUtc, completedAtUtc: new Date().toISOString(), nodeVersion: process.versions.node, exitCode, error,
        outputPath: path.relative(root, outputPath), outputSha256: fs.existsSync(outputPath) ? sha(fs.readFileSync(outputPath)) : null,
        financialChange: 'NONE; same test function, financial source closure, original spec, path/cost/account assumptions and original isolated setup.' };
    fs.writeFileSync(`${outputPath}.runtime-repair.json`, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    fs.rmSync(directory, { recursive: true, force: true });
}
