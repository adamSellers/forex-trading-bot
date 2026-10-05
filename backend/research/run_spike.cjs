#!/usr/bin/env node
// Isolated architecture spike; no production server, dotenv loading or broker credentials.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const major = Number(process.versions.node.split('.')[0]);
if (major < 20 || major >= 23) throw new Error('Use the project-supported Node >=20 <23 runtime');
const backend = path.resolve(__dirname, '..');
const env = { ...process.env, NODE_ENV: 'test' };
for (const key of Object.keys(env)) {
    if (/^(OANDA_|EMAIL_|AWS_|S3_|SMTP_)/.test(key)) delete env[key];
}
const output = process.argv[2];
if (output) env.RESEARCH_REPORT_PATH = path.resolve(output);
else delete env.RESEARCH_REPORT_PATH;
const result = spawnSync(process.execPath, [path.join(backend, 'node_modules/jest/bin/jest.js'),
    '--runInBand', '--runTestsByPath', path.join(__dirname, '__tests__/orchestrationSpike.test.js')],
    { cwd: backend, env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
