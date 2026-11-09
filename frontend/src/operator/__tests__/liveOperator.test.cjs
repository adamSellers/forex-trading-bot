const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modulePath = pathToFileURL(path.join(__dirname, '../liveOperator.js')).href;
const load = () => import(modulePath);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); };

function view(publication, { streamId = 'first-boot', balance = 100, enabled = false, signals = [] } = {}) {
  const names = ['systemStatus', 'engineStatus', 'portfolio', 'trades', 'signals', 'prices', 'account',
    'liveSelection', 'catalog', 'readiness', 'operationalHealth'];
  return { schemaVersion: 1, streamId, publication, generatedAt: 1000 + publication,
    intent: { entriesEnabled: enabled, durable: true }, activation: { allowed: true, reasons: [] },
    entries: { state: enabled ? 'WATCHING' : 'PAUSED', entryRisk: null },
    protection: { engineAttached: true, monitoringActive: true },
    identity: { liveRunId: 'run-1', strategy: 'multi_day_trend' },
    overview: { systemStatus: { config: { enableTrading: enabled } }, engineStatus: { isRunning: true },
      portfolio: { balance }, trades: [], signals, prices: [], account: { balance },
      liveSelection: { liveRunId: 'run-1' }, catalog: [], readiness: { activationAllowed: true },
      operationalHealth: { entryState: enabled ? 'WATCHING' : 'PAUSED' } },
    observations: Object.fromEntries(names.map((name) => [name, { status: 'available', observedAt: 1000,
      lastAttemptAt: 1000, error: null }])) };
}

class Socket {
  connected = true;
  callbacks = new Map();
  sent = [];
  on(event, listener) {
    if (!this.callbacks.has(event)) this.callbacks.set(event, new Set());
    this.callbacks.get(event).add(listener);
  }
  off(event, listener) { this.callbacks.get(event)?.delete(listener); }
  emit(event, value) {
    this.sent.push({ event, value });
    for (const listener of this.callbacks.get(event) || []) listener(value);
  }
  connect() { this.connected = true; this.emit('connect'); }
}

function clock() {
  let next = 0;
  const timers = new Map();
  return { timers,
    setTimeoutFn: (callback, delay) => { timers.set(++next, { callback, delay }); return next; },
    clearTimeoutFn: (id) => timers.delete(id),
    fire: (delay) => {
      const [id, timer] = [...timers].find(([, value]) => value.delay === delay);
      timers.delete(id);
      timer.callback();
    },
  };
}

test('subscribers receive an operator view through one shared transport subscription', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  const first = deferred();
  let reads = 0;
  const operator = createLiveOperator({ socket, transport: { readDashboard: () => { reads++; return first.promise; } } });
  const stopFirst = operator.subscribe(() => {});
  const stopSecond = operator.subscribe(() => {});
  try {
    await settle();
    assert.equal(reads, 1);
    assert.equal(socket.callbacks.get('operatorView').size, 1);
    first.resolve(view(1));
    await settle();
    assert.equal(operator.getSnapshot().view.overview.account.balance, 100);
    assert.equal(operator.getSnapshot().loading, false);
    assert.equal(operator.getSnapshot().lastUpdate, 1001);
    stopFirst();
    assert.equal(socket.callbacks.get('operatorView').size, 1);
    stopSecond();
    assert.equal(socket.callbacks.get('operatorView').size, 0);
  } finally { operator.dispose(); }
});

test('an explicit enable command adopts its confirmed view and reports acceptance', async () => {
  const { createLiveOperator } = await load();
  const operator = createLiveOperator({ transport: {
    readDashboard: async () => view(1),
    enableEntries: async () => ({ command: 'enableEntries', outcome: 'accepted', success: true,
      message: 'Live entries enabled', view: view(2, { enabled: true }) }),
  } });
  try {
    await operator.readDashboard();
    const result = await operator.enableEntries();
    assert.equal(result.outcome, 'accepted');
    assert.equal(operator.getSnapshot().view.intent.entriesEnabled, true);
    assert.equal(operator.getSnapshot().notice, 'Live entries enabled');
    assert.equal(operator.getSnapshot().error, null);
    assert.equal(operator.getSnapshot().action, null);
  } finally { operator.dispose(); }
});

test('a newer socket publication wins over an older HTTP response', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  const request = deferred();
  const operator = createLiveOperator({ socket, transport: { readDashboard: () => request.promise } });
  const stop = operator.subscribe(() => {});
  try {
    socket.emit('operatorView', view(3, { balance: 300 }));
    request.resolve(view(2, { balance: 200 }));
    await settle();
    assert.equal(operator.getSnapshot().view.overview.account.balance, 300);
    assert.equal(operator.getSnapshot().lastUpdate, 1003);
  } finally { stop(); operator.dispose(); }
});

test('a first socket observation prevents an unknown old process response from replacing it', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  const old = deferred();
  const operator = createLiveOperator({ socket, transport: { readDashboard: () => old.promise } });
  const stop = operator.subscribe(() => {});
  try {
    socket.emit('operatorView', view(1, { streamId: 'new-boot', balance: 400 }));
    old.resolve(view(900, { balance: 90 }));
    await settle();
    assert.equal(operator.getSnapshot().view.streamId, 'new-boot');
    assert.equal(operator.getSnapshot().view.overview.account.balance, 400);
  } finally { stop(); operator.dispose(); }
});

test('the latest requested HTTP refresh wins and failed refreshes retain the last good view', async () => {
  const { createLiveOperator } = await load();
  const requests = [];
  const operator = createLiveOperator({ transport: { readDashboard: () => {
    const request = deferred(); requests.push(request); return request.promise;
  } } });
  try {
    const older = operator.refresh();
    const newer = operator.refresh();
    await settle();
    requests[1].resolve(view(2, { balance: 200 }));
    await newer;
    requests[0].resolve(view(1, { balance: 100 }));
    await older;
    assert.equal(operator.getSnapshot().view.overview.account.balance, 200);
    const failed = operator.refresh();
    await settle();
    requests[2].reject(new Error('read unavailable'));
    await failed;
    assert.equal(operator.getSnapshot().view.overview.account.balance, 200);
    assert.equal(operator.getSnapshot().lastUpdate, 1002);
    assert.match(operator.getSnapshot().dataError, /refresh failed.*read unavailable/);
  } finally { operator.dispose(); }
});

test('reconnection accepts a reset publication counter and rejects an in-flight previous process response', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  const requests = [];
  const operator = createLiveOperator({ socket, transport: { readDashboard: () => {
    const request = deferred(); requests.push(request); return request.promise;
  } } });
  const stop = operator.subscribe(() => {});
  try {
    await settle();
    requests[0].resolve(view(30));
    await settle();
    const oldRead = operator.refresh();
    await settle();
    socket.connected = false;
    socket.emit('disconnect');
    socket.connected = true;
    socket.emit('connect');
    await settle();
    requests[2].resolve(view(1, { streamId: 'second-boot', balance: 250 }));
    await settle();
    requests[1].resolve(view(31, { balance: 5 }));
    await oldRead;
    socket.emit('operatorView', view(999, { balance: 1 }));
    assert.equal(operator.getSnapshot().view.streamId, 'second-boot');
    assert.equal(operator.getSnapshot().view.overview.account.balance, 250);
    assert.equal(operator.getSnapshot().dataError, null);
  } finally { stop(); operator.dispose(); }
});

test('partial views expose independent source failures and preserve observation and quote timestamps', async () => {
  const { createLiveOperator } = await load();
  const partial = view(1);
  partial.activation.allowed = null;
  partial.observations.account = { status: 'unavailable', observedAt: 50, lastAttemptAt: 1001, error: 'Broker unavailable' };
  partial.observations.operationalHealth = { status: 'unavailable', observedAt: null, lastAttemptAt: 1001, error: 'Health unavailable' };
  partial.overview.prices = [{ instrument: 'EUR_USD', timestamp: 100, fetchedAt: 1000, mid: 1.1 }];
  const operator = createLiveOperator({ transport: { readDashboard: async () => partial } });
  try {
    await operator.refresh();
    const state = operator.getSnapshot();
    assert.match(state.dataError, /account, operationalHealth/);
    assert.equal(state.view.observations.account.observedAt, 50);
    assert.deepEqual(state.view.overview.prices[0], { instrument: 'EUR_USD', timestamp: 100, fetchedAt: 1000, mid: 1.1 });
    assert.equal(state.view.activation.allowed, null);
    assert.equal(Object.isFrozen(state.view.overview.prices[0]), true);
  } finally { operator.dispose(); }
});

test('empty signals from a new owner replace the previous run instead of retaining its signals', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  const operator = createLiveOperator({ socket, transport: { readDashboard: async () => view(1,
    { signals: [{ symbol: 'EUR_USD', runId: 'run-1', signal: 'BUY' }] }) } });
  const stop = operator.subscribe(() => {});
  try {
    await settle();
    const replacement = view(2);
    replacement.identity.liveRunId = 'run-2';
    socket.emit('operatorView', replacement);
    assert.deepEqual(operator.getSnapshot().view.overview.signals, []);
  } finally { stop(); operator.dispose(); }
});

test('accepted commands remain accepted when the subsequent dashboard refresh failed', async () => {
  const { createLiveOperator } = await load();
  const operator = createLiveOperator({ transport: { readDashboard: async () => view(1),
    enableEntries: async () => ({ command: 'enableEntries', outcome: 'accepted', success: true,
      message: 'Live entries enabled', view: null, refreshError: 'Dashboard unavailable' }) } });
  try {
    await operator.refresh();
    const result = await operator.enableEntries();
    assert.equal(result.outcome, 'accepted');
    assert.equal(operator.getSnapshot().error, null);
    assert.equal(operator.getSnapshot().notice, 'Live entries enabled');
    assert.match(operator.getSnapshot().dataError, /Dashboard unavailable/);
    assert.equal(operator.getSnapshot().view.publication, 1);
  } finally { operator.dispose(); }
});

test('an accepted pause settles before its background refresh and remains accepted if that read fails', async () => {
  const { createLiveOperator } = await load();
  const timing = clock();
  const reading = deferred();
  let pauses = 0, reads = 0, acknowledged = false;
  const operator = createLiveOperator({ ...timing, transport: {
    pauseEntries: async () => {
      pauses++;
      return { command: 'pauseEntries', outcome: 'accepted', success: true,
        message: 'Live entries paused', view: view(2), refreshPending: true };
    },
    readDashboard: () => { reads++; return reading.promise; },
  } });
  try {
    const pausing = operator.pauseEntries().then((result) => { acknowledged = true; return result; });
    await settle();
    assert.equal(acknowledged, true, 'The pause acknowledgement cannot await the observation request');
    assert.equal((await pausing).outcome, 'accepted');
    assert.equal(operator.getSnapshot().action, null);
    assert.equal(operator.getSnapshot().view.intent.entriesEnabled, false);
    assert.equal(reads, 1);
    assert.equal(operator.getSnapshot().notice, 'Live entries paused');
    reading.reject(new Error('follow-up unavailable'));
    await settle();
    assert.equal(operator.getSnapshot().commandResult.outcome, 'accepted');
    assert.equal(operator.getSnapshot().notice, 'Live entries paused');
    assert.equal(operator.getSnapshot().error, null);
    assert.match(operator.getSnapshot().dataError, /refresh failed.*follow-up unavailable/);
    assert.equal(pauses, 1);
    assert.equal(reads, 1);
  } finally { operator.dispose(); }
});

test('a known activation rejection keeps its readiness evidence instead of becoming an unknown result', async () => {
  const { createLiveOperator } = await load();
  const readiness = { activationAllowed: false, reasons: [{ code: 'BROKER_LIFECYCLE_UNRESOLVED' }] };
  const operator = createLiveOperator({ transport: { enableEntries: async () => {
    throw Object.assign(new Error('HTTP409'), { payload: { command: 'enableEntries', outcome: 'rejected',
      success: false, message: 'Live strategy readiness failed', liveReadiness: readiness, view: null } });
  } } });
  try {
    const result = await operator.enableEntries();
    assert.equal(result.outcome, 'rejected');
    assert.deepEqual(operator.getSnapshot().commandResult.liveReadiness, readiness);
    assert.equal(operator.getSnapshot().error, 'Live strategy readiness failed');
  } finally { operator.dispose(); }
});

test('a lost mutation response is unknown and is never automatically repeated', async () => {
  const { createLiveOperator } = await load();
  let writes = 0;
  const operator = createLiveOperator({ transport: { pauseEntries: async () => {
    writes++; throw new Error('connection lost');
  }, readDashboard: async () => view(1) } });
  try {
    const result = await operator.pauseEntries();
    await operator.refresh();
    assert.equal(result.outcome, 'unknown');
    assert.match(operator.getSnapshot().error, /result is unknown/);
    assert.equal(writes, 1);
  } finally { operator.dispose(); }
});

test('pause proceeds while enable is pending and late enable feedback cannot replace its result', async () => {
  const { createLiveOperator } = await load();
  const enabling = deferred();
  let enables = 0, pauses = 0;
  const operator = createLiveOperator({ transport: {
    enableEntries: () => { enables++; return enabling.promise; },
    pauseEntries: async () => { pauses++; return { command: 'pauseEntries', outcome: 'accepted',
      success: true, message: 'Live entries paused', view: view(3) }; },
  } });
  try {
    const enable = operator.enableEntries();
    const duplicate = operator.enableEntries();
    await settle();
    assert.deepEqual(operator.getSnapshot().pendingCommands, ['enable']);
    await operator.pauseEntries();
    assert.equal(pauses, 1);
    enabling.resolve({ command: 'enableEntries', outcome: 'rejected', success: false,
      message: 'Enable superseded', liveReadiness: { activationAllowed: false }, view: view(2) });
    await Promise.all([enable, duplicate]);
    assert.equal(enables, 1);
    assert.equal(operator.getSnapshot().view.publication, 3);
    assert.equal(operator.getSnapshot().view.intent.entriesEnabled, false);
    assert.equal(operator.getSnapshot().commandResult.command, 'pauseEntries');
    assert.equal(operator.getSnapshot().notice, 'Live entries paused');
    assert.equal(operator.getSnapshot().error, null);
    assert.deepEqual(operator.getSnapshot().pendingCommands, []);
  } finally { operator.dispose(); }
});

test('a read deadline retains the last view without timing out an in-progress mutation', async () => {
  const { createLiveOperator } = await load();
  const timing = clock();
  let reads = 0, writes = 0;
  const writing = deferred();
  const operator = createLiveOperator({ ...timing, transport: {
    readDashboard: () => ++reads === 1 ? Promise.resolve(view(1)) : new Promise(() => {}),
    reconcileBroker: () => { writes++; return writing.promise; },
  } });
  try {
    await operator.refresh();
    const read = operator.refresh();
    const command = operator.reconcileBroker();
    await settle();
    timing.fire(25000);
    await read;
    assert.equal(operator.getSnapshot().view.publication, 1);
    assert.equal(operator.getSnapshot().lastUpdate, 1001);
    assert.match(operator.getSnapshot().dataError, /timed out/);
    assert.equal(operator.getSnapshot().action, 'reconcile');
    assert.equal(operator.getSnapshot().error, null);
    assert.equal(timing.timers.size, 0);
    writing.resolve({ command: 'reconcileBroker', outcome: 'accepted', success: true,
      message: 'Broker reconciliation completed', view: view(2) });
    const result = await command;
    assert.equal(result.outcome, 'accepted');
    assert.equal(operator.getSnapshot().error, null);
    assert.equal(writes, 1);
    assert.equal(operator.getSnapshot().action, null);
  } finally { operator.dispose(); }
});

test('the final unsubscribe cancels read deadlines and polling without removing another socket listener', async () => {
  const { createLiveOperator } = await load();
  const timing = clock();
  const socket = new Socket();
  const external = () => {};
  socket.on('operatorView', external);
  const operator = createLiveOperator({ ...timing, socket,
    transport: { readDashboard: () => new Promise(() => {}) } });
  const stop = operator.subscribe(() => {});
  await settle();
  assert.equal(timing.timers.size, 2);
  stop();
  await settle();
  assert.equal(timing.timers.size, 0);
  assert.deepEqual([...socket.callbacks.get('operatorView')], [external]);
  operator.dispose();
});

test('local observers share one backend subscription, resubscribe on reconnect, and release it without disconnecting the socket', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  const external = () => {};
  socket.on('operatorView', external);
  const operator = createLiveOperator({ socket, transport: { readDashboard: async () => view(1) } });
  const protocol = () => socket.sent.filter(({ event }) => ['operatorSubscribe', 'operatorUnsubscribe'].includes(event))
    .map(({ event }) => event);
  const first = operator.subscribe(() => {});
  const second = operator.subscribe(() => {});
  try {
    await settle();
    assert.deepEqual(protocol(), ['operatorSubscribe']);
    first();
    assert.deepEqual(protocol(), ['operatorSubscribe']);
    socket.connected = false;
    socket.emit('disconnect');
    socket.connected = true;
    socket.emit('connect');
    await settle();
    assert.deepEqual(protocol(), ['operatorSubscribe', 'operatorSubscribe']);
    second();
    assert.deepEqual(protocol(), ['operatorSubscribe', 'operatorSubscribe', 'operatorUnsubscribe']);
    assert.equal(socket.connected, true);
    assert.deepEqual([...socket.callbacks.get('operatorView')], [external]);
  } finally { first(); second(); operator.dispose(); }
});

test('stopping before the shared socket connects cannot subscribe the backend later', async () => {
  const { createLiveOperator } = await load();
  const socket = new Socket();
  socket.connected = false;
  socket.connect = () => {};
  const external = () => {};
  socket.on('connect', external);
  const operator = createLiveOperator({ socket, transport: { readDashboard: async () => view(1) } });
  const stop = operator.subscribe(() => {});
  stop();
  socket.connected = true;
  socket.emit('connect');
  await settle();
  assert.deepEqual(socket.sent.filter(({ event }) => event === 'operatorSubscribe'), []);
  assert.deepEqual([...socket.callbacks.get('connect')], [external]);
  assert.equal(socket.connected, true);
  operator.dispose();
});
