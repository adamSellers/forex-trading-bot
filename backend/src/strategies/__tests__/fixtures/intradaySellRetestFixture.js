// Deterministic broker-shaped midpoint/ask candles. The final three distinct
// M15 candles break an eight-bar low, retest it and then confirm rejection.
function sellRetestFixture({ nowMs = Date.parse("2026-08-10T10:00:00Z"), scale = 0.0001 } = {}) {
    let previousClose = 1.3;
    const m15 = Array.from({ length: 160 }, (_, index) => {
        const close = 1.3 - index * 0.00001 - Math.sin(index / 2 + 2.8) * 0.0003;
        const open = index ? previousClose : close;
        previousClose = close;
        return { time: new Date(nowMs - (160 - index) * 900_000).toISOString(),
            open, close, high: Math.max(open, close) + 0.00003,
            low: Math.min(open, close) - 0.00003, complete: true };
    });
    const h1End = Math.floor(nowMs / 3_600_000) * 3_600_000;
    const h1 = Array.from({ length: 160 }, (_, index) => {
        const close = 1.3 - index * 0.0003 - Math.sin(index / 3) * 0.0003 * 0.8;
        return { time: new Date(h1End - (160 - index) * 3_600_000).toISOString(),
            open: close + 0.0003 * 0.4, close, high: close + 0.0003 * 1.8,
            low: close - 0.0003 * 1.8, complete: true };
    });
    const level = Math.min(...m15.slice(-11, -3).map((candle) => candle.low));
    const ending = [
        { open: level + scale, high: level + scale * 2, low: level - scale * 3, close: level - scale * 2 },
        { open: level - scale * 2, high: level + scale * 2, low: level - scale * 3, close: level - scale },
        { open: level - scale, high: level - scale * 0.5, low: level - scale * 5, close: level - scale * 4 },
    ];
    ending.forEach((prices, index) => Object.assign(m15[m15.length - 3 + index], prices));
    m15.forEach((candle) => {
        candle.ask = Object.fromEntries(["open", "high", "low", "close"]
            .map((key) => [key, Number((candle[key] + 0.00002).toFixed(5))]));
    });
    const currentPrice = m15.at(-1).close;
    return { instrument: "EUR_USD", nowMs, currentPrice, m15, h1,
        marketContext: {
            price: { instrument: "EUR_USD", price: currentPrice, mid: currentPrice,
                bid: currentPrice - 0.00002, ask: currentPrice + 0.00002,
                spread: 0.4, tradeable: true, timestamp: nowMs, fetchedAt: nowMs },
            session: { spreadPips: 0.4, tradeable: true },
            timeframes: { "15m": { candles: m15 }, "1h": { candles: h1 } },
        } };
}

module.exports = { sellRetestFixture };
