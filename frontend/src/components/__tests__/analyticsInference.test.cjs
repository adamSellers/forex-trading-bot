const assert = require('node:assert/strict');
const { test } = require('node:test');

const load = () => import('../../utils/analyticsInference.js');
const money = (value) => `${Number(value) < 0 ? '-' : '+'}A$${Math.abs(Number(value)).toFixed(4)}`;

test('singleton inference explains unavailable bounds while the observed loss remains available', async () => {
  const { formatExpectancyInference } = await load();
  const summary = { totalTrades: 1, avgPnLAud: -0.1787,
    expectancy95Aud: { lower: null, upper: null, observations: 1, samples: 0, status: 'SINGLE_OBSERVATION' } };
  assert.equal(money(summary.avgPnLAud), '-A$0.1787');
  assert.equal(formatExpectancyInference(summary, money), 'An expectancy interval is unavailable with only one closed trade.');
});

test('empty and constant samples cannot display a numerical confidence interval', async () => {
  const { formatExpectancyInference } = await load();
  assert.match(formatExpectancyInference({ totalTrades: 0 }, money), /without closed trades/);
  assert.match(formatExpectancyInference({ totalTrades: 3,
    expectancy95Aud: { status: 'NO_OBSERVED_VARIATION', observations: 3, lower: null, upper: null } }, money), /no variation/);
  assert.match(formatExpectancyInference({ totalTrades: 3,
    expectancy95Aud: { lower: 0, upper: 0 } }, money), /no variation/);
});

test('diverse samples display observed empirical bounds and their independence assumption', async () => {
  const { formatExpectancyInference } = await load();
  const text = formatExpectancyInference({ totalTrades: 3,
    expectancy95Aud: { status: 'AVAILABLE', observations: 3, lower: -0.125, upper: 0.25 } }, money);
  assert.match(text, /-A\$0\.1250 to \+A\$0\.2500/);
  assert.match(text, /treats trades as independent/);
});

test('missing or unknown inference metadata does not turn null bounds into zero money', async () => {
  const { formatExpectancyInference } = await load();
  const text = formatExpectancyInference({ totalTrades: 4,
    expectancy95Aud: { status: 'UNAVAILABLE', lower: null, upper: null } }, money);
  assert.equal(text, 'An expectancy interval is unavailable for this sample.');
  assert.doesNotMatch(text, /A\$/);
  assert.match(formatExpectancyInference({ totalTrades: 1,
    expectancy95Aud: { lower: -0.1787, upper: -0.1787 } }, money), /one closed trade/);
});
