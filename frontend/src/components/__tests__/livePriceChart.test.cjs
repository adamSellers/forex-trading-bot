// node --test frontend/src/components/__tests__/livePriceChart.test.cjs
// Run the actual component, hook, indicators and Recharts rendering with only
// effects, the API and UI wrappers controlled locally. No browser/server needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const parser = require('@babel/parser');
const { transformSync } = require('rolldown/utils');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const recharts = require('recharts');
const { normalizeOandaPrice } = require('../../../../backend/src/runtime/quoteAvailability');

const sourcePath = path.join(__dirname, '../dashboard/LivePriceChart.jsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
const componentCode = transformSync(sourcePath, ast.program.body
  .filter(node => !['ImportDeclaration', 'ExportDefaultDeclaration'].includes(node.type))
  .map(node => source.slice(node.start, node.end)).join('\n'), { jsx: { runtime: 'classic' } }).code;
const indicators = fs.readFileSync(path.join(__dirname, '../../utils/indicators.js'), 'utf8');
const calculateEMA = vm.runInNewContext(indicators.replace(/export /g, '') + '\ncalculateEMA;');
const shared = fs.readFileSync(path.join(__dirname, '../dashboard/Shared.jsx'), 'utf8');
const sharedAst = parser.parse(shared, { sourceType: 'module', plugins: ['jsx'] });
function sharedValue(name) {
  const declaration = sharedAst.program.body.find(node =>
    node.declaration?.declarations?.some(item => item.id.name === name)).declaration;
  const value = declaration.declarations.find(item => item.id.name === name).init;
  return vm.runInNewContext('(' + shared.slice(value.start, value.end) + ')');
}

// Sanitized market observations from docs/reviews/evidence/2026-10-01/audusd-3487.json.
// Keep this small fixture in the regression so private investigation/ledger data
// need not be published. Tuples: start time, open, high, low, close, volume.
// Match /api/candles' completed-only, numeric OHLC response contract.
const candles = [
  ["2026-09-30T11:00:00.000000000Z", 0.6973, 0.69732, 0.69686, 0.69693, 648],
  ["2026-09-30T11:15:00.000000000Z", 0.69693, 0.69728, 0.69684, 0.6972, 758],
  ["2026-09-30T11:30:00.000000000Z", 0.69722, 0.69744, 0.69713, 0.69718, 789],
  ["2026-09-30T11:45:00.000000000Z", 0.69718, 0.69734, 0.69666, 0.69684, 1055],
  ["2026-09-30T12:00:00.000000000Z", 0.69685, 0.69702, 0.69666, 0.69695, 1502],
  ["2026-09-30T12:15:00.000000000Z", 0.69693, 0.69693, 0.69635, 0.69681, 1306],
  ["2026-09-30T12:30:00.000000000Z", 0.69677, 0.69878, 0.69677, 0.69798, 3141],
  ["2026-09-30T12:45:00.000000000Z", 0.69797, 0.69814, 0.69714, 0.6972, 2468],
  ["2026-09-30T13:00:00.000000000Z", 0.6972, 0.69738, 0.69644, 0.69653, 2037],
  ["2026-09-30T13:15:00.000000000Z", 0.69653, 0.69684, 0.69619, 0.69633, 1823],
  ["2026-09-30T13:30:00.000000000Z", 0.69636, 0.69656, 0.69568, 0.69578, 1629],
  ["2026-09-30T13:45:00.000000000Z", 0.69572, 0.696, 0.6953, 0.69578, 1852],
  ["2026-09-30T14:00:00.000000000Z", 0.69578, 0.6963, 0.69542, 0.69588, 1978],
  ["2026-09-30T14:15:00.000000000Z", 0.6959, 0.69606, 0.69513, 0.69528, 1658],
  ["2026-09-30T14:30:00.000000000Z", 0.69526, 0.6957, 0.6951, 0.69553, 1592],
  ["2026-09-30T14:45:00.000000000Z", 0.69552, 0.69644, 0.69552, 0.69564, 2343],
  ["2026-09-30T15:00:00.000000000Z", 0.69564, 0.69594, 0.6953, 0.69574, 1769],
  ["2026-09-30T15:15:00.000000000Z", 0.69578, 0.69602, 0.69518, 0.69573, 1180],
  ["2026-09-30T15:30:00.000000000Z", 0.69573, 0.69579, 0.69524, 0.69528, 1212],
  ["2026-09-30T15:45:00.000000000Z", 0.69526, 0.69547, 0.69492, 0.69513, 1166],
  ["2026-09-30T16:00:00.000000000Z", 0.69512, 0.69512, 0.6948, 0.69505, 1282],
  ["2026-09-30T16:15:00.000000000Z", 0.69508, 0.6952, 0.69489, 0.69496, 1164],
  ["2026-09-30T16:30:00.000000000Z", 0.69497, 0.69514, 0.69474, 0.69511, 950],
  ["2026-09-30T16:45:00.000000000Z", 0.6951, 0.69512, 0.6948, 0.69511, 1108],
  ["2026-09-30T17:00:00.000000000Z", 0.69512, 0.69523, 0.695, 0.69514, 1114],
  ["2026-09-30T17:15:00.000000000Z", 0.69514, 0.69514, 0.6948, 0.69494, 928],
  ["2026-09-30T17:30:00.000000000Z", 0.69491, 0.69505, 0.6948, 0.69486, 901],
  ["2026-09-30T17:45:00.000000000Z", 0.69487, 0.69504, 0.69479, 0.69492, 915],
  ["2026-09-30T18:00:00.000000000Z", 0.69494, 0.69501, 0.69476, 0.69479, 858],
  ["2026-09-30T18:15:00.000000000Z", 0.69479, 0.69507, 0.69478, 0.69492, 703],
  ["2026-09-30T18:30:00.000000000Z", 0.69492, 0.69501, 0.69474, 0.695, 608],
  ["2026-09-30T18:45:00.000000000Z", 0.69499, 0.69501, 0.69476, 0.69491, 729],
  ["2026-09-30T19:00:00.000000000Z", 0.69492, 0.69492, 0.69464, 0.69486, 563],
  ["2026-09-30T19:15:00.000000000Z", 0.69482, 0.69491, 0.69475, 0.69486, 678],
  ["2026-09-30T19:30:00.000000000Z", 0.69484, 0.69484, 0.69452, 0.69454, 584],
  ["2026-09-30T19:45:00.000000000Z", 0.69455, 0.69461, 0.69432, 0.6945, 1070],
  ["2026-09-30T20:00:00.000000000Z", 0.6945, 0.69452, 0.69426, 0.69437, 675],
  ["2026-09-30T20:15:00.000000000Z", 0.69438, 0.6946, 0.69426, 0.69458, 363],
].map(([time, open, high, low, close, volume]) => Object.freeze({ time, open, high, low, close, volume }));
const fullPrice = {
  "time": "2026-09-30T14:50:34.655786070Z",
  "instrument": "AUD_USD",
  "tradeable": true,
  "bids": [
    {
      "price": "0.69633",
      "liquidity": "500000"
    }
  ],
  "asks": [
    {
      "price": "0.69642",
      "liquidity": "500000"
    }
  ]
};
const quote = normalizeOandaPrice(fullPrice, {
  instrument: 'AUD_USD', fetchedAt: Date.parse(fullPrice.time) + 250,
});
const plain = value => JSON.parse(JSON.stringify(value));
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function elements(tree, predicate) {
  if (!React.isValidElement(tree)) return [];
  return [predicate(tree) ? tree : null,
    ...React.Children.toArray(tree.props.children).flatMap(child => elements(child, predicate))].filter(Boolean);
}
function textContent(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (!React.isValidElement(tree)) return String(tree);
  return textContent(tree.props.children);
}

function mount(prices = { AUD_USD: quote }, initialTimeframe = 'M15') {
  const state = [], setters = [], effects = [], memos = [];
  const pendingEffects = [];
  const requests = [], intervals = new Map();
  let cursor = 0, dirty = false, nextInterval = 1, tree;
  let props = { prices, assets: ['AUD_USD', 'EUR_USD'], initialTimeframe };
  const context = {
    React, ...recharts, calculateEMA,
    formatPrice: sharedValue('formatPrice'), formatInstrument: sharedValue('formatInstrument'),
    FOREX_INSTRUMENTS: ['AUD_USD', 'EUR_USD'], INSTRUMENT_INFO: {},
    useTheme: () => ({ palette: {
      background: { paper: '#111111' }, primary: { main: '#00bfd0' },
      text: { secondary: '#999999' }, success: { main: '#00aa00' },
      error: { main: '#ff0000' }, divider: '#444444',
    }, shadows: Array(5).fill('none') }),
    alpha: color => color,
    useState(initial) {
      const id = cursor++;
      if (!(id in state)) state[id] = typeof initial === 'function' ? initial() : initial;
      if (!setters[id]) setters[id] = value => {
        const next = typeof value === 'function' ? value(state[id]) : value;
        if (!Object.is(next, state[id])) { state[id] = next; dirty = true; }
      };
      return [state[id], setters[id]];
    },
    useMemo(factory, deps) {
      const id = cursor++;
      if (!sameDeps(memos[id]?.deps, deps)) memos[id] = { deps, value: factory() };
      return memos[id].value;
    },
    useEffect(callback, deps) {
      const id = cursor++;
      if (!sameDeps(effects[id]?.deps, deps)) {
        pendingEffects.push(() => {
          effects[id]?.cleanup?.();
          effects[id] = { deps, cleanup: callback() };
        });
      }
    },
    tradingAPI: { getCandles(instrument, timeframe, count) {
      return new Promise((resolve, reject) => requests.push({ instrument, timeframe, count, resolve, reject }));
    } },
    setInterval(callback, ms) { const id = nextInterval++; intervals.set(id, { callback, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  context.useCallback = (callback, deps) => context.useMemo(() => callback, deps);
  for (const name of ['Typography', 'Box', 'ToggleButtonGroup', 'ToggleButton', 'FormControl',
    'Select', 'MenuItem', 'Grid', 'CircularProgress', 'Alert']) context[name] = name;
  const Component = vm.runInNewContext(componentCode + '\nLivePriceChart;', context);
  function render() { cursor = 0; dirty = false; tree = Component(props); return tree; }
  function flush() {
    for (let i = 0; i < 20; i++) {
      while (pendingEffects.length) pendingEffects.shift()();
      if (!dirty) return tree;
      render();
    }
    throw new Error('Component did not settle');
  }
  const app = {
    requests, intervals,
    get tree() { return tree; },
    find(type) { return elements(tree, e => e.type === type); },
    get chart() { return app.find(recharts.LineChart)[0]; },
    get dot() { return app.find(recharts.ReferenceDot)[0]; },
    get data() { return app.chart?.props.data ?? []; },
    update(nextPrices) { props = { ...props, prices: nextPrices }; render(); return flush(); },
    select(type, value, commit = true) {
      app.find(type)[0].props.onChange({ target: { value } }, value);
      render();
      if (commit) flush();
    },
    flush,
    poll() {
      assert.equal(intervals.size, 1, 'exactly one active candle poll');
      const timer = [...intervals.values()][0];
      assert.equal(timer.ms, 60000);
      timer.callback();
    },
    async settle() {
      // Drain promise continuations from the VM realm before flushing renders.
      await new Promise(resolve => setImmediate(resolve));
      flush();
    },
    async respond(index, rows = candles) {
      const request = requests[index];
      request.resolve({ instrument: request.instrument, granularity: request.timeframe, candles: rows });
      await app.settle();
    },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
  render(); flush();
  return app;
}

function tooltip(app, row) {
  const content = app.find(recharts.Tooltip)[0].props.content;
  return textContent(content.type({ active: true, payload: [{ payload: row }] }));
}
function currentPrice(app) {
  return textContent(app.find('Typography').find(e => e.props.variant === 'h5'));
}

test('broker quotes stay separate from completed OHLC, indicators and historical tooltips', async () => {
  const app = mount();
  await app.respond(0);
  const before = plain(app.data);
  assert.equal(app.requests[0].instrument, 'AUD_USD');
  assert.equal(app.requests[0].timeframe, 'M15');
  assert.equal(app.requests[0].count, 100);
  assert.equal(app.data.length, candles.length);
  assert.equal(app.data.at(-1).close, candles.at(-1).close, 'broker quote must not overwrite the last completed close');
  assert.ok(app.data.some(row => Number.isFinite(row.fastMA)));
  assert.ok(app.data.some(row => Number.isFinite(row.stValue)));
  for (let i = 0; i < candles.length; i++) {
    const row = app.data[i], candle = candles[i];
    for (const key of ['open', 'high', 'low', 'close', 'volume']) assert.equal(row[key], candle[key]);
    assert.equal(row.time, Date.parse(candle.time));
    assert.equal(row.closeTime, Date.parse(candle.time) + 15 * 60000);
  }
  const changed = { ...quote, mid: 0.72, price: 0.72, timestamp: quote.timestamp + 1000 };
  app.update({ AUD_USD: changed });
  assert.deepEqual(plain(app.data), before, 'quotes cannot rewrite history or change indicator inputs');
  assert.equal(app.dot.props.x, changed.timestamp);
  assert.equal(app.dot.props.y, changed.mid);
  assert.equal(currentPrice(app), '0.72000');
  assert.ok(textContent(app.tree).includes(new Date(changed.timestamp).toLocaleTimeString()));
  const last = app.data.at(-1);
  const historical = tooltip(app, last);
  assert.ok(historical.includes(last.close.toFixed(5)));
  assert.ok(historical.includes(last.high.toFixed(5)));
  assert.ok(historical.includes(last.low.toFixed(5)));
  assert.ok(historical.includes(new Date(last.time).toLocaleString()));
  assert.ok(historical.includes(new Date(last.closeTime).toLocaleTimeString()));
  assert.ok(!historical.includes('0.72000'));
  app.unmount();
});

test('the active H4 strategy opens its chart on H4 while retaining manual timeframe selection', async () => {
  const app = mount({ AUD_USD: quote }, 'H4');
  assert.equal(app.requests[0].timeframe, 'H4');
  const h4Candles = candles.map((candle, index) => ({ ...candle,
    time: new Date(Date.parse('2026-09-22T21:00:00Z') + index * 4 * 60 * 60 * 1000).toISOString() }));
  await app.respond(0, h4Candles);
  assert.equal(app.data.at(-1).time, Date.parse(h4Candles.at(-1).time));
  assert.equal(app.data.at(-1).closeTime - app.data.at(-1).time, 4 * 60 * 60 * 1000);
  app.select('ToggleButtonGroup', 'M15');
  assert.equal(app.requests.at(-1).timeframe, 'M15');
  app.unmount();
});

test('healthy unchanged broker events retain their timestamp when a later receipt arrives', async () => {
  const app = mount();
  await app.respond(0);
  const before = plain(app.data);
  app.update({ AUD_USD: { ...quote, fetchedAt: quote.fetchedAt + 3600000 } });
  assert.equal(app.dot.props.x, quote.timestamp);
  assert.equal(app.dot.props.y, quote.mid);
  assert.deepEqual(plain(app.data), before);
  assert.equal(app.find('Alert').length, 0);
  assert.equal(currentPrice(app), quote.mid.toFixed(5));
  app.unmount();
});

test('an event inside a candle remains at its own time when that candle completes', async () => {
  const app = mount();
  const completeBeforeQuote = candles.filter(c => Date.parse(c.time) + 15 * 60000 <= quote.timestamp);
  const completedAtNextBoundary = candles.filter(c => Date.parse(c.time) <= quote.timestamp);
  await app.respond(0, completeBeforeQuote);
  assert.ok(app.dot.props.x > app.data.at(-1).closeTime);
  const priorLast = plain(app.data.at(-1));
  app.poll();
  await app.respond(1, completedAtNextBoundary);
  assert.equal(app.dot.props.x, quote.timestamp);
  assert.ok(app.dot.props.x < app.data.at(-1).closeTime);
  assert.deepEqual(plain(app.data.at(-2)), priorLast);
  const stopCandle = app.data.at(-1);
  assert.equal(stopCandle.high, 0.69644, 'recorded stop-out spike is preserved in the completed candle');
  assert.equal(stopCandle.close, 0.69564);
  assert.notEqual(stopCandle.close, app.dot.props.y);
  app.unmount();
});

test('Recharts places a quote on a numeric time axis between completed close times', async () => {
  const app = mount();
  await app.respond(0);
  assert.equal(app.find(recharts.XAxis)[0].props.dataKey, 'closeTime');
  assert.equal(app.find(recharts.XAxis)[0].props.type, 'number');
  const first = app.data[0].closeTime, last = app.data.at(-1).closeTime;
  const xAt = timestamp => {
    app.update({ AUD_USD: { ...quote, timestamp } });
    const markup = renderToStaticMarkup(React.cloneElement(app.chart, { width: 1000, height: 400 }));
    const circle = markup.match(/<circle\b([^>]*)>\s*<title>Latest midpoint:/);
    assert.ok(circle, 'actual Recharts renderer emits the quote marker');
    const cx = Number(circle[1].match(/\bcx="([^"]+)"/)[1]);
    assert.ok(Number.isFinite(cx));
    return cx;
  };
  const left = xAt(first), right = xAt(last), between = xAt(quote.timestamp);
  const expected = left + (right - left) * (quote.timestamp - first) / (last - first);
  assert.ok(Math.abs(between - expected) < 0.01, 'quote x position reflects elapsed time, not a candle category');
  assert.ok(between > left && between < right);
  app.unmount();
});

test('the newest poll wins, including when an older poll later errors', async () => {
  const app = mount();
  await app.respond(0, candles.slice(0, -2));
  app.poll(); // request 1 stalls
  app.poll(); // request 2 completes first
  await app.respond(2, candles.slice(0, -1));
  const newer = plain(app.data);
  await app.respond(1, candles.slice(0, -2));
  assert.deepEqual(plain(app.data), newer);
  app.poll(); // request 3 errors late
  app.poll();
  await app.respond(4, candles);
  app.requests[3].reject(new Error('older poll failed'));
  await app.settle();
  assert.equal(app.find('Alert').length, 0);
  assert.equal(app.data.at(-1).close, candles.at(-1).close);
  app.unmount();
});

test('instrument and timeframe changes never display or accept the previous selection', async () => {
  const eurQuote = { ...quote, mid: 1.15, price: 1.15 };
  const app = mount({ AUD_USD: quote, EUR_USD: eurQuote });
  await app.respond(0);
  app.poll(); // AUD M15 remains in flight
  app.select('Select', 'EUR_USD', false);
  assert.equal(app.data.length, 0, 'old AUD history is hidden even before effects run');
  assert.equal(app.dot, undefined);
  app.flush();
  assert.equal(app.requests[2].instrument, 'EUR_USD');
  await app.respond(1); // old instrument resolves
  assert.equal(app.data.length, 0);
  const eurCandles = candles.map(c => ({ ...c, open: c.open + 0.45, high: c.high + 0.45,
    low: c.low + 0.45, close: c.close + 0.45 }));
  await app.respond(2, eurCandles);
  assert.equal(app.dot.props.y, eurQuote.mid);
  app.poll(); // EUR M15 remains in flight
  app.select('ToggleButtonGroup', 'H1', false);
  assert.equal(app.data.length, 0);
  app.flush();
  assert.equal(app.requests[4].timeframe, 'H1');
  await app.respond(3, eurCandles);
  assert.equal(app.data.length, 0);
  await app.respond(4, [eurCandles[0]]);
  assert.equal(app.data[0].closeTime, Date.parse(eurCandles[0].time) + 60 * 60000);
  assert.equal(app.intervals.size, 1);
  app.unmount();
  assert.equal(app.intervals.size, 0);
});

test('empty candle responses clear history; failed polls recover on the next response', async () => {
  const app = mount();
  await app.respond(0);
  app.poll();
  await app.respond(1, []);
  assert.equal(app.data.length, 0);
  app.poll();
  app.requests[2].reject(new Error('candle request failed'));
  await app.settle();
  assert.equal(textContent(app.find('Alert')[0]), 'candle request failed');
  app.poll();
  await app.respond(3);
  assert.equal(app.find('Alert').length, 0);
  assert.equal(app.data.length, candles.length);
  app.unmount();
});

test('missing timestamp cannot masquerade as a live candle or marker; price fallback still works', async () => {
  const app = mount({ AUD_USD: { ...quote, timestamp: null } });
  await app.respond(0);
  assert.equal(app.dot, undefined);
  assert.equal(currentPrice(app), candles.at(-1).close.toFixed(5));
  assert.ok(textContent(app.tree).includes('Last completed candle'));
  app.update({ AUD_USD: { ...quote, mid: null } });
  assert.equal(app.dot.props.y, quote.price);
  app.unmount();
});
