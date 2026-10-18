#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const [specArg, outputArg] = process.argv.slice(2);
if (!specArg || !outputArg) throw new Error('Usage: node backend/research/run_viability.cjs spec.json NEW-output.json');
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use supported Node22');
const specPath = path.resolve(specArg), outputPath = path.resolve(outputArg);
if (fs.existsSync(outputPath)) throw new Error('Choose new evidence path');
// Refuse changed/unregistered execution sources before the Jest child imports
// production orchestration, as well as at the child's evaluation boundary.
require('./viabilityRegistration.cjs').verifyViabilityRegistration({
    spec: JSON.parse(fs.readFileSync(specPath, 'utf8')), specPath, root: path.resolve(__dirname, '../..'),
});
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-viability-'));
const env = { ...process.env, NODE_ENV: 'test', DB_PATH: path.join(directory, 'isolated.db'),
    RESEARCH_REPLAY_ISOLATED: '1', RESEARCH_VIABILITY_SPEC: specPath, RESEARCH_VIABILITY_OUTPUT: outputPath };
for (const key of Object.keys(env)) if (/^(OANDA_|EMAIL_|AWS_|S3_|SMTP_|DOTENV_CONFIG_)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
try {
    const result = spawnSync(process.execPath, ['--max-old-space-size=4096', path.resolve(__dirname, '../node_modules/jest/bin/jest.js'),
        '--runInBand', '--runTestsByPath', path.resolve(__dirname, '__tests__/viabilityEvaluation.test.js')],
    { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
