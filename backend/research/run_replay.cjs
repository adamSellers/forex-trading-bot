#!/usr/bin/env node
// A separate process is the isolation boundary. No server or dotenv import.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const major = Number(process.versions.node.split('.')[0]);
if (major < 20 || major >= 23) throw new Error('Use the project-supported Node >=20 <23 runtime');
const manifest = process.argv[2];
const output = process.argv[3];
if (!manifest || !output) throw new Error('Usage: node backend/research/run_replay.cjs manifest.json output.json');
const manifestPath = path.resolve(manifest);
const outputPath = path.resolve(output);
if (manifestPath === outputPath || fs.existsSync(outputPath)) throw new Error('Choose a new output path; research evidence is not overwritten');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-replay-process-'));
const env = { ...process.env, NODE_ENV: 'test', DB_PATH: path.join(directory, 'isolated.db'),
    RESEARCH_REPLAY_ISOLATED: '1', RESEARCH_REPLAY_MANIFEST: manifestPath, RESEARCH_REPLAY_OUTPUT: outputPath };
// An inherited Node preload can otherwise reload .env after stripping secrets.
for (const key of Object.keys(env)) {
    if (/^(OANDA_|EMAIL_|AWS_|S3_|SMTP_|DOTENV_CONFIG_)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
}
const backend = path.resolve(__dirname, '..');
try {
    const result = spawnSync(process.execPath, ['--max-old-space-size=4096', path.join(backend, 'node_modules/jest/bin/jest.js'),
        '--runInBand', '--runTestsByPath', path.join(__dirname, '__tests__/persistedReplay.test.js')],
        { cwd: backend, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
