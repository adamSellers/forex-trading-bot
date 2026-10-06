// Synthetic software fixtures, not market evidence or candidate returns. The
// final 160 M15 observations reproduce the deployed-default BUY pattern from
// intradayMomentum.test.js; earlier observations supply coherent H1 warmup.
const BASE_PRICES = { AUD_USD: 0.66, EUR_USD: 1.1, GBP_USD: 1.3, USD_JPY: 150 };
const M15_MS = 900_000;
const H1_MS = 3_600_000;

function buyEntryFixture({ instrument = 'EUR_USD', entry = 'pullback',
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

module.exports = { buyEntryFixture };
