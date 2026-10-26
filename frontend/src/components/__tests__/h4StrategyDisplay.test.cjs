// Render the actual display components with controlled hooks and API boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const parser = require('@babel/parser');
const { transformSync } = require('rolldown/utils');
const React = require('react');

const display = import('../../utils/strategyDisplay.js');

function textContent(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  if (!React.isValidElement(tree)) return String(tree);
  return textContent(tree.props.children);
}

async function component(relativePath, name, states = []) {
  const sourcePath = path.join(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const body = ast.program.body.filter(node => !['ImportDeclaration', 'ExportDefaultDeclaration'].includes(node.type))
    .map(node => source.slice(node.start, node.end)).join('\n');
  const code = transformSync(sourcePath, body, { jsx: { runtime: 'classic' } }).code;
  let stateIndex = 0;
  const context = {
    React, ...(await display),
    useMemo: callback => callback(), useCallback: callback => callback, useEffect: () => {},
    useState: initial => [stateIndex < states.length ? states[stateIndex++] : initial, () => {}],
    configAPI: {},
    useTheme: () => ({ palette: { success: { main: '#0a0' }, warning: { main: '#a80' }, info: { main: '#08a' } } }),
    alpha: color => color,
  };
  for (const node of ast.program.body.filter(node => node.type === 'ImportDeclaration' && node.source.value.startsWith('@mui/'))) {
    for (const specifier of node.specifiers) {
      if (!(specifier.local.name in context)) context[specifier.local.name] = specifier.local.name;
    }
  }
  return vm.runInNewContext(code + `\n${name};`, context);
}

const h4Config = {
  strategy: 'multi_day_trend', liveReleaseVersion: 'h4-channel-v2', timeframe: '4h',
  trendBreakoutBars: 20, trendExitBars: 10, trendAtrPeriod: 14, trendStopAtr: 2,
  minStopLossPips: 6, enableShorting: true, weekendCloseLocalHour: 16, weekendCloseLocalMinute: 45,
  riskPerTrade: 0.0025, maxCapitalAtRisk: 100, maxAggregateStopRiskPctNav: 0.005,
  maxDailyLossPctNav: 0.01, maxDrawdownPctNav: 0.05, assets: ['AUD_USD'],
  positionPolicy: { scope: 'PER_INSTRUMENT', maxPerInstrument: 1 },
  enablePeakProfitTrail: true, peakProfitTrailActivationRiskMultiple: 1, peakProfitTrailRiskMultiple: 0.5,
};

test('H4 configuration reports the deployed channel, floor, exits and shared risk limits', async () => {
  const Config = await component('../TradingConfig.jsx', 'TradingConfig', [h4Config, null]);
  const text = textContent(Config());
  for (const expected of ['H4 Trend', 'Prior 20 H4 bars', '2 × H4 ATR(14)', '6 pips',
    '10 H4 bars', '+1R', '0.5R', 'tighter protective stop wins', 'initial filled price-to-stop distance',
    'Friday 16:45 New York', 'None / off', 'One per pair', '0.25%', '0.50%']) {
    assert.ok(text.includes(expected), expected);
  }
  assert.ok(!text.includes('H1 trend EMAs'));
  assert.ok(!text.includes('Profit target 1.5R'));
});

test('retained H4-v1 configuration reports its channel without claiming peak protection', async () => {
  const { enablePeakProfitTrail, peakProfitTrailActivationRiskMultiple, peakProfitTrailRiskMultiple, ...legacy } = h4Config;
  const Config = await component('../TradingConfig.jsx', 'TradingConfig', [{ ...legacy, liveReleaseVersion: 'h4-channel-v1' }, null]);
  const text = textContent(Config());
  assert.ok(text.includes('10 H4 bars'));
  assert.ok(!text.includes('Peak trailing gap'));
  assert.ok(!text.includes('second trail'));
});

test('a retained v6 configuration keeps its M15 label and exit values', async () => {
  const legacy = { ...h4Config, strategy: 'intraday_momentum', liveReleaseVersion: 'm15-intraday-v6',
    timeframe: '15m', intradayFastEmaPeriod: 20, intradaySlowEmaPeriod: 50,
    intradayMinAdx: 20, intradayBreakoutBars: 8, intradayStopAtr: 1.25,
    intradayTargetRiskMultiple: 1.5, timeStopHours: 6 };
  const Config = await component('../TradingConfig.jsx', 'TradingConfig', [legacy, null]);
  const text = textContent(Config());
  assert.ok(text.includes('M15 Intraday Momentum'));
  assert.ok(text.includes('1.5R'));
  assert.ok(text.includes('6 hours'));
  assert.ok(!text.includes('Friday 16:45 New York'));
});

test('mixed current and legacy signals retain their own timeframe and unknown values', async () => {
  const Signals = await component('../dashboard/TradingSignals.jsx', 'TradingSignals');
  const text = textContent(Signals({ systemStatus: { config: h4Config }, signals: [
    { symbol: 'AUD_USD', strategy: 'multi_day_trend', strategyVersion: '2.1.0', signal: 'HOLD',
      signalCandleTime: 1, timestamp: 1, strategyContext: { family: 'multi_day_trend',
        h4: { channelLow: 0.65, channelHigh: 0.67, freshLong: false, freshShort: false } } },
    { symbol: 'AUD_USD', strategy: 'intraday_momentum', strategyVersion: '1.4.0', signal: 'HOLD',
      signalCandleTime: 2, timestamp: 2, strategyContext: { h1: { shortRegime: true, adx: 24 }, m15: { rsi: 44 } } },
  ] }));
  assert.ok(text.includes('H4 Trend v2.1.0'));
  assert.ok(text.includes('0.65000 – 0.67000'));
  assert.ok(text.includes('ATR --'), 'uncomputed ATR must not become zero');
  assert.ok(text.includes('M15 Intraday Momentum v1.4.0'));
  assert.ok(text.includes('H1 SHORT'));
  assert.ok(text.includes('M15 RSI 44.0'));
});

test('market watching text follows the actual strategy without changing entry state', async () => {
  const health = { status: 'healthy', market: { open: true }, entryState: 'WATCHING', checkedAt: 1 };
  for (const [strategy, expected] of [['multi_day_trend', 'H4 channel breakout'], ['intraday_momentum', 'M15 setup']]) {
    const Banner = await component('../dashboard/MarketStatusBanner.jsx', 'MarketStatusBanner', [health, false, false]);
    assert.ok(textContent(Banner({ strategy })).includes(expected));
  }
  const Banner = await component('../dashboard/MarketStatusBanner.jsx', 'MarketStatusBanner', [{ ...health, entryState: 'PAUSED' }, false, false]);
  assert.ok(textContent(Banner({ strategy: 'multi_day_trend' })).includes('New entries are paused'));
});

test('the active catalog cannot rename a historical intraday run', async () => {
  const { strategyLabel, isH4Trend } = await display;
  assert.equal(strategyLabel('intraday_momentum', 'H4 Trend'), 'M15 Intraday Momentum');
  assert.equal(isH4Trend({ strategy: 'intraday_momentum', liveReleaseVersion: 'm15-intraday-v6' }), false);
  assert.equal(isH4Trend({ liveReleaseVersion: 'h4-channel-v1' }), true);
  assert.equal(isH4Trend({ liveReleaseVersion: 'h4-channel-v2' }), true);
});
