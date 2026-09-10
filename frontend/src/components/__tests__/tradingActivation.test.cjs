// node frontend/src/components/__tests__/tradingActivation.test.cjs
// Exercise the actual dashboard callback without a browser or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const parser = require('@babel/parser');

const source = fs.readFileSync(path.join(__dirname, '../TradingDashboard.jsx'), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
function findInitializer(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'VariableDeclarator' && node.id.name === name) return node.init;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findInitializer(child, name);
      if (found) return found;
    }
  }
  return null;
}
const callback = findInitializer(ast, 'handleToggleTrading');
const blocked = findInitializer(ast, 'liveActivationBlocked');
assert.equal(callback?.type, 'ArrowFunctionExpression');

async function toggle({ tradingEnabled = false, readiness }) {
  const calls = [];
  const state = {};
  const context = {
    tradingEnabled, tradingAction: null, liveReadiness: readiness,
    tradingAPI: {
      getLiveReadiness: async () => readiness,
      startTrading: async () => { calls.push('start'); return { liveReadiness: readiness, message: 'Enabled; cooling down' }; },
      stopTrading: async () => { calls.push('stop'); return { message: 'Paused' }; },
    },
    fetchInitialData: async () => { calls.push('refresh'); },
    formatApiErrorMessage: (error) => error.message,
  };
  for (const key of ['TradingAction', 'Error', 'Notice', 'ActivationFailure', 'LiveReadiness', 'ReadinessDialogOpen']) {
    context['set' + key] = (value) => { state[key] = value; };
  }
  const activationBlocked = vm.runInNewContext(source.slice(blocked.start, blocked.end), context);
  await vm.runInNewContext('(' + source.slice(callback.start, callback.end) + ')', context)();
  return { calls, state, activationBlocked };
}

test('Enable Live works during an allowed cooldown while retaining its pending-entry state', async () => {
  const readiness = { passed: false, activationAllowed: true, status: 'COOLDOWN' };
  const result = await toggle({ readiness });
  assert.equal(result.activationBlocked, false);
  assert.deepEqual(result.calls, ['start', 'refresh']);
  assert.equal(result.state.LiveReadiness, readiness);
  assert.equal(result.state.Notice, 'Enabled; cooling down');
  assert.equal(result.state.ReadinessDialogOpen, undefined);
});

test('a cooldown accompanied by another readiness blocker cannot activate', async () => {
  const result = await toggle({ readiness: { passed: false, activationAllowed: false, status: 'FAIL' } });
  assert.equal(result.activationBlocked, true);
  assert.deepEqual(result.calls, []);
  assert.equal(result.state.ReadinessDialogOpen, true);
});

test('an enabled bot can still be explicitly paused during its cooldown', async () => {
  const result = await toggle({ tradingEnabled: true,
    readiness: { passed: false, activationAllowed: true, status: 'COOLDOWN' } });
  assert.deepEqual(result.calls, ['stop', 'refresh']);
  assert.equal(result.state.Notice, 'Paused');
});
