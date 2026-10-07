// Synthetic lifecycle observations only. Independent H1 inputs below isolate
// the completed-regime reset contract; they are not M15 historical aggregates.
const { buyEntryFixture } = require('./causalFlows.cjs');
const { sellRetestFixture } = require('../../src/strategies/__tests__/fixtures/intradaySellRetestFixture');
const M15 = 900_000;
const HOUR = 3_600_000;
const START = Date.parse('2026-09-11T13:00:00Z');

function candle(time, open, close, halfSpread = 0.00002, wick = 0.00003) {
    const prices = { open, close, high: Math.max(open, close) + wick,
        low: Math.min(open, close) - wick };
    return { time: new Date(time).toISOString(), complete: true, volume: 100,
        ...prices, ask: Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, value + halfSpread])),
        bid: Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, value - halfSpread])) };
}

function buyLifecycleFlow({ instrument = 'EUR_USD', nowMs = START, futureBars = 32, resetHour = null } = {}) {
    const flow = buyEntryFixture({ instrument, nowMs });
    const scale = instrument.endsWith('_JPY') ? 100 : 1;
    const base = flow.currentPrice;
    const frozenLevel = Math.max(...flow.m15.slice(-11, -3).map((bar) => bar.high));
    for (let index = 0; index < futureBars; index++) {
        const close = base + (index + 1) * 0.00001 * scale + Math.sin(index / 2) * 0.0001 * scale;
        const bar = candle(nowMs + index * M15, flow.m15.at(-1).close, close,
            0.00002 * scale, 0.00003 * scale);
        // Further completed touches do not cancel the frozen episode: every
        // close remains above its level. They cannot authorize a second fill.
        if (index % 3 === 0) {
            bar.low = frozenLevel - 0.00005 * scale;
            bar.bid.low = bar.low - 0.00002 * scale;
            bar.ask.low = bar.low + 0.00002 * scale;
        }
        flow.m15.push(bar);
    }
    if (resetHour !== null) {
        flow.independentH1 = true;
        const initialClose = flow.h1.at(-1).close;
        for (let hour = 1; hour <= Math.ceil(futureBars / 4); hour++) {
            const close = initialClose + (hour < resetHour ? hour * 0.0001
                : hour === resetHour ? -0.0015
                    : 0.002 + (hour - resetHour - 1) * 0.001) * scale;
            flow.h1.push(candle(nowMs + (hour - 1) * HOUR, flow.h1.at(-1).close, close,
                0.00002 * scale, 0.00003 * scale));
        }
    }
    return flow;
}

function sellFadeFlow({ instrument = 'GBP_USD', nowMs = START } = {}) {
    const flow = { ...sellRetestFixture({ nowMs }), instrument, independentH1: true };
    const firstClose = flow.m15.at(-1).close - 0.00015;
    flow.m15.push(candle(nowMs, flow.m15.at(-1).close, firstClose));
    // A later bearish breakout stays above the existing short RSI minimum;
    // its prior bar started before the parent TP, so it cannot supply freshness.
    flow.m15.push(candle(nowMs + M15, firstClose + 0.00005, firstClose - 0.00004));
    return flow;
}

module.exports = { buyLifecycleFlow, sellFadeFlow, candle };
