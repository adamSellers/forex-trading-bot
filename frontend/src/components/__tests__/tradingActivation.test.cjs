// Mount the actual dashboard and operator hook with React DOM. Only external
// operator transport, socket delivery, browser layout and candle HTTP are faked.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, afterEach, test } = require('node:test');
const { JSDOM } = require('jsdom');

const frontendRoot = path.resolve(__dirname, '../../..');
const mounted = new Set();
const operators = new Set();
const originalGlobals = new Map();
let dom;
let vite;
let React;
let act;
let createRoot;
let ThemeProvider;
let Dashboard;
let tradingTheme;
let createLiveOperator;
let originalFetch;
let unexpectedRequests = [];

function installGlobal(key, value) {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class OperatorSocket {
  connected = true;
  listeners = new Map();
  sent = [];
  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
  }
  off(event, listener) { this.listeners.get(event)?.delete(listener); }
  emit(event, value) { this.sent.push({ event, value }); }
  deliver(event, value) { for (const listener of [...this.listeners.get(event) || []]) listener(value); }
  connect() { this.connected = true; this.deliver('connect'); }
  count(event) { return this.listeners.get(event)?.size || 0; }
}
function operatorView({ enabled = false, ready = true, cooldown = false, publication = 1, ...overrides } = {}) {
  const generatedAt = Date.now();
  const entryRisk = { cooldownActive: cooldown, cooldownUntil: cooldown ? generatedAt + 60000 : null,
    remainingMs: cooldown ? 60000 : 0, entryAllowed: !cooldown };
  const readiness = { passed: ready && !cooldown, activationAllowed: ready, entryRisk,
    status: cooldown ? 'COOLDOWN' : ready ? 'PASS' : 'FAIL', reasons: [] };
  return { schemaVersion: 1, streamId: 'operator-dom-test', publication, generatedAt,
    intent: { entriesEnabled: enabled, durable: true }, activation: { allowed: ready, reasons: [] },
    entries: { state: enabled ? cooldown ? 'COOLDOWN' : 'WATCHING' : 'PAUSED', entryRisk },
    protection: { engineAttached: true, monitoringActive: true },
    identity: { liveRunId: 'run-1', strategy: 'multi_day_trend' },
    overview: {
      systemStatus: { config: { enableTrading: enabled, strategy: 'multi_day_trend', strategyVersion: '2.1.0',
        timeframe: '4h', assets: ['EUR_USD'] } },
      engineStatus: { isRunning: true, openPositions: 0, openTrades: [] },
      catalog: [{ key: 'multi_day_trend', label: 'H4 Trend', version: '2.1.0' }],
      portfolio: { balance: 100, totalValue: 100, currency: 'AUD', marginAvailable: 100,
        positions: [], realizedLast24hAud: 0 },
      account: { balance: 100, currency: 'AUD', marginUsed: 0, marginAvailable: 100,
        openTrades: 0, pendingOrders: 0, unrealizedPL: 0 },
      trades: [], prices: [], signals: [],
      liveSelection: { strategy: 'multi_day_trend', liveRunId: 'run-1', selectionId: 'selection-1' },
      readiness,
      operationalHealth: { status: 'healthy', checkedAt: generatedAt, market: { open: true, sessions: [] },
        issues: [], entryState: enabled ? 'WATCHING' : 'PAUSED' },
    },
    observations: Object.fromEntries(['systemStatus', 'engineStatus', 'portfolio', 'trades', 'signals', 'prices',
      'account', 'liveSelection', 'catalog', 'readiness', 'operationalHealth'].map(source =>
      [source, { status: 'available', observedAt: generatedAt, lastAttemptAt: generatedAt, error: null }])),
    ...overrides };
}
async function flush(operation = () => {}) {
  await act(async () => {
    await operation();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
function button(container, label) {
  const found = [...container.querySelectorAll('button')].find(element => element.textContent.includes(label));
  assert.ok(found, `Rendered button ${label} is available`);
  return found;
}
async function mount(view = operatorView(), overrides = {}) {
  const socket = new OperatorSocket();
  const calls = [];
  let current = view;
  const transport = {
    readDashboard: async () => { calls.push('read'); return structuredClone(current); },
    enableEntries: async () => {
      calls.push('enable'); current = { ...current, publication: current.publication + 1,
        intent: { entriesEnabled: true, durable: true },
        entries: { ...current.entries, state: current.entries.entryRisk?.cooldownActive ? 'COOLDOWN' : 'WATCHING' } };
      return { command: 'enableEntries', outcome: 'accepted', message: 'Live trading enabled', view: current };
    },
    pauseEntries: async () => {
      calls.push('pause'); current = { ...current, publication: current.publication + 1,
        intent: { entriesEnabled: false, durable: true }, entries: { ...current.entries, state: 'PAUSED' } };
      return { command: 'pauseEntries', outcome: 'accepted', message: 'Live entries disabled', view: current };
    },
    reconcileBroker: async () => { calls.push('reconcile'); return { command: 'reconcileBroker',
      outcome: 'accepted', message: 'Broker reconciliation completed', view: { ...current, publication: current.publication + 1 } }; },
    ...overrides,
  };
  const timers = new Set();
  const operator = createLiveOperator({ transport, socket,
    setTimeoutFn: (callback, delay) => { const timer = setTimeout(callback, delay); timers.add(timer); return timer; },
    clearTimeoutFn: timer => { timers.delete(timer); clearTimeout(timer); },
  });
  operators.add(operator);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const fixture = { container, root, operator, socket, calls, transport, timers,
    push: async next => { current = next; await flush(() => socket.deliver('operatorView', next)); },
    unmount: async () => {
      if (!mounted.delete(fixture)) return;
      await flush(() => root.unmount()); container.remove();
    },
  };
  mounted.add(fixture);
  await flush(() => root.render(React.createElement(React.StrictMode, null,
    React.createElement(ThemeProvider, { theme: tradingTheme }, React.createElement(Dashboard, { operator })))));
  return fixture;
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node',
    'Document', 'DocumentFragment', 'MutationObserver', 'Event', 'MouseEvent']) installGlobal(key, dom.window[key]);
  installGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  installGlobal('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  installGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  installGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ target, contentRect: { width: 800, height: 300 } }]); }
    unobserve() {}
    disconnect() {}
  });
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
  React = require('react');
  act = React.act;
  ({ createRoot } = require('react-dom/client'));
  ({ ThemeProvider } = require('@mui/material/styles'));
  const { createServer } = await import(path.join(frontendRoot, 'node_modules/vite/dist/node/index.js'));
  vite = await createServer({ root: frontendRoot, logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false } });
  ({ default: Dashboard } = await vite.ssrLoadModule('/src/components/TradingDashboard.jsx'));
  ({ tradingTheme } = await vite.ssrLoadModule('/src/theme/tradingTheme.js'));
  ({ createLiveOperator } = await vite.ssrLoadModule('/src/operator/liveOperator.js'));
  originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/candles/')) {
      unexpectedRequests.push(url.href);
      throw new Error(`Unexpected network request: ${url.href}`);
    }
    return new Response(JSON.stringify({ instrument: url.pathname.split('/').at(-1), candles: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
afterEach(async () => {
  for (const fixture of [...mounted]) await fixture.unmount();
  for (const operator of operators) operator.dispose();
  operators.clear();
  assert.deepEqual(unexpectedRequests, [], 'Only declared candle HTTP may occur');
  unexpectedRequests = [];
  document.body.replaceChildren();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await vite?.close();
  dom?.window.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test('the mounted dashboard enables entries through one operator command during an allowed cooldown', async () => {
  const ui = await mount(operatorView({ cooldown: true }));
  const enable = button(ui.container, 'ENABLE LIVE');
  assert.equal(enable.disabled, false);
  await flush(() => enable.click());
  assert.equal(ui.calls.filter(call => call === 'enable').length, 1);
  assert.ok(button(ui.container, 'PAUSE LIVE'));
  assert.ok(ui.container.textContent.includes('Live trading enabled'));
});

test('a backend activation rejection rerenders its actual dialog without a second readiness request', async () => {
  const ui = await mount(operatorView({ ready: false }));
  ui.transport.enableEntries = async () => {
    ui.calls.push('enable');
    return { command: 'enableEntries', outcome: 'rejected', message: 'Live strategy readiness failed',
      error: 'Live strategy readiness failed', code: 'LIVE_READINESS_FAILED', view: null };
  };
  await flush(() => button(ui.container, 'LIVE BLOCKED').click());
  assert.equal(ui.calls.filter(call => call === 'enable').length, 1);
  assert.ok(document.querySelector('[role="dialog"]'));
  assert.ok(document.body.textContent.includes('LIVE_READINESS_FAILED'));
  assert.equal(ui.operator.getSnapshot().commandResult.outcome, 'rejected');
});

for (const pendingAction of ['enable', 'reconcile']) {
  test(`pause stays usable while ${pendingAction} awaits its external response`, async () => {
    const ui = await mount(operatorView({ enabled: pendingAction === 'reconcile' }));
    const pending = deferred();
    ui.transport[pendingAction === 'enable' ? 'enableEntries' : 'reconcileBroker'] = () => {
      ui.calls.push(pendingAction); return pending.promise;
    };
    await flush(() => pendingAction === 'enable'
      ? button(ui.container, 'ENABLE LIVE').click()
      : ui.container.querySelector('[aria-label="Reconcile broker"]').click());
    const pause = button(ui.container, 'PAUSE LIVE');
    assert.equal(pause.disabled, false);
    await flush(() => pause.click());
    assert.equal(ui.calls.filter(call => call === 'pause').length, 1);
    assert.ok(ui.container.textContent.includes('Live entries disabled'));
    assert.ok(ui.container.textContent.includes('New entries are paused'));
    await flush(() => pending.resolve({ command: pendingAction === 'enable' ? 'enableEntries' : 'reconcileBroker',
      outcome: 'rejected', message: 'Older operation finished after pause' }));
    assert.equal(ui.operator.getSnapshot().commandResult.command, 'pauseEntries');
    assert.ok(!document.body.textContent.includes('Older operation finished after pause'));
    assert.equal(document.querySelector('[role="dialog"]'), null);
  });
}

test('a socket publication rerenders current intent and an obsolete HTTP view cannot undo it', async () => {
  const oldRead = deferred();
  const ui = await mount(operatorView(), { readDashboard: () => oldRead.promise });
  await ui.push(operatorView({ enabled: true, publication: 2 }));
  assert.ok(button(ui.container, 'PAUSE LIVE'));
  await flush(() => oldRead.resolve(operatorView({ enabled: false, publication: 1 })));
  assert.ok(button(ui.container, 'PAUSE LIVE'));
  assert.equal(ui.operator.getSnapshot().view.publication, 2);
});

test('partial observations retain display values while readiness and broker availability remain explicit', async () => {
  const view = operatorView();
  view.activation.allowed = null;
  view.observations.readiness = { status: 'unavailable', observedAt: view.generatedAt - 1000,
    lastAttemptAt: view.generatedAt, error: 'Readiness unavailable' };
  view.observations.account = { status: 'unavailable', observedAt: view.generatedAt - 1000,
    lastAttemptAt: view.generatedAt, error: 'Broker connection failed' };
  const ui = await mount(view);
  assert.ok(ui.container.textContent.includes('observations are unavailable: account, readiness') ||
    ui.container.textContent.includes('observations are unavailable: readiness, account'));
  assert.ok(ui.container.textContent.includes('The latest broker connection check failed'));
  const readinessChip = [...ui.container.querySelectorAll('[role="button"]')]
    .find(element => element.textContent === 'READINESS UNAVAILABLE');
  assert.ok(readinessChip);
  await flush(() => readinessChip.click());
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog.textContent.includes('Live readiness is unavailable'));
  assert.ok(!dialog.textContent.includes('Every live readiness check currently passes'));
});

test('a confirmed enable with a failed view refresh shows accepted intent and a separate refresh warning', async () => {
  const ui = await mount();
  ui.transport.enableEntries = async () => {
    ui.calls.push('enable');
    return { command: 'enableEntries', outcome: 'accepted', message: 'Live trading enabled',
      refreshError: 'Observation read failed', view: operatorView({ enabled: true, publication: 2 }) };
  };
  await flush(() => button(ui.container, 'ENABLE LIVE').click());
  assert.ok(ui.container.textContent.includes('Live trading enabled'));
  assert.ok(ui.container.textContent.includes('Dashboard refresh after enable failed'));
  assert.equal(ui.operator.getSnapshot().error, null);
  assert.equal(ui.operator.getSnapshot().commandResult.outcome, 'accepted');
  assert.ok(button(ui.container, 'PAUSE LIVE'));
});

test('a lost command response is shown as unknown without automatically repeating the mutation', async () => {
  const ui = await mount();
  ui.transport.enableEntries = async () => { ui.calls.push('enable'); throw new Error('Response lost'); };
  await flush(() => button(ui.container, 'ENABLE LIVE').click());
  await flush();
  assert.ok(ui.container.textContent.includes('result is unknown'));
  assert.equal(ui.calls.filter(call => call === 'enable').length, 1);
  assert.equal(ui.operator.getSnapshot().commandResult.outcome, 'unknown');
});

test('actual state subscriptions replace empty signals and never display a previous owner as current', async () => {
  const view = operatorView();
  view.overview.signals = [{ symbol: 'EUR_USD', runId: 'run-1', strategy: 'multi_day_trend',
    signal: 'BUY', signalClass: 'ACTIONABLE', timestamp: Date.now(), message: 'Current owner signal' }];
  const ui = await mount(view);
  await flush(() => button(ui.container, 'SIGNALS').click());
  assert.ok(ui.container.textContent.includes('Current owner signal'));
  await ui.push({ ...view, publication: 2, overview: { ...view.overview, signals: [] } });
  assert.ok(!ui.container.textContent.includes('Current owner signal'));
  assert.ok(ui.container.textContent.includes('WAITING FOR LIVE MARKET SNAPSHOT'));
  await ui.push({ ...view, publication: 3, identity: { ...view.identity, liveRunId: 'run-2' } });
  assert.ok(!ui.container.textContent.includes('Current owner signal'));
});

test('the real pause result updates the banner before older operational health has refreshed', async () => {
  const view = operatorView({ enabled: true });
  const checkedAt = view.overview.operationalHealth.checkedAt;
  const ui = await mount(view);
  assert.ok(ui.container.textContent.includes('Watching for a completed H4 channel breakout'));
  await flush(() => button(ui.container, 'PAUSE LIVE').click());
  assert.ok(ui.container.textContent.includes('New entries are paused'));
  assert.ok(!ui.container.textContent.includes('Watching for a completed H4 channel breakout'));
  assert.equal(ui.operator.getSnapshot().view.overview.operationalHealth.checkedAt, checkedAt);
  assert.equal(ui.operator.getSnapshot().view.overview.operationalHealth.entryState, 'WATCHING');
});

test('real hook unmount removes only its listeners and cancels its own observation timers', async () => {
  const ui = await mount();
  const unrelated = () => {};
  ui.socket.on('operatorView', unrelated);
  assert.equal(ui.socket.count('operatorView'), 2);
  assert.equal(ui.socket.count('connect'), 1);
  assert.ok(ui.timers.size > 0);
  await ui.unmount();
  // Assert before dispose: only React's real hook cleanup can satisfy these.
  assert.equal(ui.socket.count('operatorView'), 1);
  assert.ok(ui.socket.listeners.get('operatorView').has(unrelated));
  assert.equal(ui.socket.count('connect'), 0);
  assert.equal(ui.socket.count('disconnect'), 0);
  assert.equal(ui.socket.count('connect_error'), 0);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.socket.sent.at(-1).event, 'operatorUnsubscribe');
});

test('a mounted enabled cooldown can be paused without clearing its saved cooldown deadline', async () => {
  const view = operatorView({ enabled: true, cooldown: true });
  const deadline = view.entries.entryRisk.cooldownUntil;
  const ui = await mount(view);
  const pause = button(ui.container, 'PAUSE LIVE');
  assert.equal(pause.disabled, false);
  await flush(() => pause.click());
  const state = ui.operator.getSnapshot().view;
  assert.equal(state.intent.entriesEnabled, false);
  assert.equal(state.entries.state, 'PAUSED');
  assert.equal(state.entries.entryRisk.cooldownUntil, deadline);
  assert.ok(ui.container.textContent.includes('New entries are paused'));
});
