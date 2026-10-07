// Synthetic software fixtures, not market evidence or candidate returns. The
// active BUY fixture completes a genuine break/retest/confirmation. The legacy
// waveform remains available to prove that old pullbacks/breakouts no longer
// bypass the new BUY contract; neither fixture is historical market evidence.
const BASE_PRICES = { AUD_USD: 0.66, EUR_USD: 1.1, GBP_USD: 1.3, USD_JPY: 150 };
const M15_MS = 900_000;
const H1_MS = 3_600_000;

function legacyBuyEntryFixture({ instrument = 'EUR_USD', entry = 'pullback',
    nowMs = Date.parse('2026-09-11T13:00:00Z'), spreadPips = 0.4 } = {}) {
    if (!(instrument in BASE_PRICES)) throw new Error(`Unsupported fixture instrument: ${instrument}`);
    if (!['pullback', 'breakout'].includes(entry)) throw new Error(`Unknown fixture entry: ${entry}`);
    if (!Number.isFinite(nowMs) || nowMs % M15_MS !== 0) {
        throw new Error('Fixture observation must be aligned to a completed M15 close');
    }
    const scale = instrument.endsWith('_JPY') ? 100 : 1;
    const base = BASE_PRICES[instrument];
    const amplitude = entry === 'pullback' ? 0.0001 : 0.0003;
    const phase = entry === 'pullback' ? 1.4 : 2.8;
    const pipValue = 0.0001 * scale;
    const halfSpread = spreadPips * pipValue / 2;
    let previousClose;
    const m15 = Array.from({ length: 640 }, (_, ordinal) => {
        const index = ordinal - 480;
        const movement = index < 0 ? index * 0.000075
            : index * 0.00001 + Math.sin(index / 2 + phase) * amplitude;
        const close = base + movement * scale;
        const open = previousClose ?? close;
        previousClose = close;
        const prices = { open, close, high: Math.max(open, close) + 0.00003 * scale,
            low: Math.min(open, close) - 0.00003 * scale };
        return { time: new Date(nowMs - (640 - ordinal) * M15_MS).toISOString(),
            complete: true, volume: 100, ...prices,
            ask: Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, value + halfSpread])),
        };
    });
    const hours = new Map();
    for (const candle of m15) {
        const hour = Math.floor(Date.parse(candle.time) / H1_MS) * H1_MS;
        if (!hours.has(hour)) hours.set(hour, []);
        hours.get(hour).push(candle);
    }
    const h1 = [...hours].filter(([hour, bars]) => bars.length === 4 && hour + H1_MS <= nowMs)
        .map(([hour, bars]) => ({ time: new Date(hour).toISOString(), complete: true,
            open: bars[0].open, close: bars.at(-1).close,
            high: Math.max(...bars.map((bar) => bar.high)), low: Math.min(...bars.map((bar) => bar.low)),
            volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
            ask: { open: bars[0].ask.open, close: bars.at(-1).ask.close,
                high: Math.max(...bars.map((bar) => bar.ask.high)), low: Math.min(...bars.map((bar) => bar.ask.low)) },
        }));
    const currentPrice = m15.at(-1).close;
    return { instrument, nowMs, currentPrice, m15, h1,
        marketContext: { price: { instrument, price: currentPrice, mid: currentPrice,
            bid: currentPrice - halfSpread, ask: currentPrice + halfSpread,
            spread: spreadPips, tradeable: true, timestamp: nowMs, fetchedAt: nowMs },
        session: { spreadPips, tradeable: true },
        timeframes: { '15m': { candles: m15 }, '1h': { candles: h1 } } },
    };
}

function buyEntryFixture({ instrument = 'EUR_USD', nowMs = Date.parse('2026-09-11T13:00:00Z'),
    spreadPips = 0.4 } = {}) {
    const flow = legacyBuyEntryFixture({ instrument, entry: 'breakout', nowMs, spreadPips });
    const scale = instrument.endsWith('_JPY') ? 100 : 1;
    const step = 0.0001 * scale;
    const halfSpread = spreadPips * step / 2;
    // Oscillating warmup supplies nondegenerate directional movement without
    // freezing an ancient monotonic breakout before the tested final episode.
    // These declared software bars also aggregate into the actual H1 inputs.
    flow.m15.slice(0, 480).forEach((bar, index) => {
        const close = BASE_PRICES[instrument] + Math.sin(index / 3) * 0.00004 * scale;
        const open = BASE_PRICES[instrument] + Math.sin((index - 1) / 3) * 0.00004 * scale;
        Object.assign(bar, { open, close, high: Math.max(open, close) + 0.00006 * scale,
            low: Math.min(open, close) - 0.00006 * scale });
    });
    const level = Math.max(...flow.m15.slice(-11, -3).map((bar) => bar.high));
    const ending = [
        { open: level - step, high: level + 3 * step, low: level - 2 * step, close: level + 2 * step },
        { open: level + 2 * step, high: level + 3 * step, low: level - 2 * step, close: level + step },
        { open: level + step, high: level + 5 * step, low: level + 0.5 * step, close: level + 4 * step },
    ];
    ending.forEach((prices, index) => Object.assign(flow.m15[flow.m15.length - 3 + index], prices));
    flow.m15.forEach((bar) => {
        for (const [component, sign] of [['ask', 1], ['bid', -1]]) {
            bar[component] = Object.fromEntries(['open', 'high', 'low', 'close']
                .map((key) => [key, bar[key] + sign * halfSpread]));
        }
    });
    flow.h1 = [];
    const hours = new Map();
    for (const bar of flow.m15) {
        const hour = Math.floor(Date.parse(bar.time) / H1_MS) * H1_MS;
        if (!hours.has(hour)) hours.set(hour, []);
        hours.get(hour).push(bar);
    }
    for (const [time, bars] of hours) {
        if (bars.length !== 4 || time + H1_MS > nowMs) continue;
        const aggregate = (component = null) => {
            const rows = component ? bars.map((bar) => bar[component]) : bars;
            return { open: rows[0].open, high: Math.max(...rows.map((bar) => bar.high)),
                low: Math.min(...rows.map((bar) => bar.low)), close: rows.at(-1).close };
        };
        flow.h1.push({ time: new Date(time).toISOString(), complete: true, volume: 400,
            ...aggregate(), bid: aggregate('bid'), ask: aggregate('ask') });
    }
    flow.currentPrice = flow.m15.at(-1).close;
    flow.marketContext.price = { ...flow.marketContext.price, price: flow.currentPrice, mid: flow.currentPrice,
        bid: flow.currentPrice - halfSpread, ask: flow.currentPrice + halfSpread };
    flow.marketContext.timeframes = { '15m': { candles: flow.m15 }, '1h': { candles: flow.h1 } };
    return flow;
}

module.exports = { buyEntryFixture, legacyBuyEntryFixture };
