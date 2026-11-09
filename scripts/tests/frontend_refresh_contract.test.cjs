// Compatibility entry point for the operator module's public refresh contracts.
// The contracts now live at the shared operator interface rather than extracting
// a React callback and mocking its private state setters.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '../..');
const directory = path.join(projectRoot, 'frontend/src/operator/__tests__');
const files = fs.readdirSync(directory).filter(name => name.endsWith('.test.cjs'))
  .sort().map(name => path.join(directory, name));
if (!files.length) throw new Error('The public operator contract suite is missing');
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: projectRoot, env: process.env, stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
process.stdout.write('Frontend refresh and command contracts passed through the public operator interface.\n');
