const { getForexMarketState } = require("../../../runtime/marketDataFreshness");

const H4_MS = 4 * 60 * 60 * 1000;

function attachSides(candle, halfSpread = 0.00002) {
    for (const [component, offset] of [["bid", -halfSpread], ["ask", halfSpread]]) {
        candle[component] = Object.fromEntries(["open", "high", "low", "close"]
            .map((key) => [key, candle[key] + offset]));
    }
    return candle;
}

function multiDayTrendFixture({
    side = "BUY",
    count = 48,
    closeAt = "2026-10-13T13:00:00.000Z",
    scale = 1,
} = {}) {
    const nowMs = Date.parse(closeAt);
    const starts = [];
    for (let close = nowMs; starts.length < count; close -= H4_MS) {
        if (getForexMarketState(close - 120_000).open) starts.unshift(close - H4_MS);
    }
    const h4 = starts.map((startedAt, index) => {
        const close = 1.1 + Math.sin(index) * 0.0001;
        return { time: new Date(startedAt).toISOString(), open: 1.1, close,
            high: 1.101, low: 1.099, complete: true, volume: 100 };
    });
    Object.assign(h4.at(-1), { open: 1.1002, close: 1.102, high: 1.1023, low: 1.1001 });
    if (side === "SELL") {
        h4.forEach((candle) => {
            const { open, close, high, low } = candle;
            Object.assign(candle, { open: 2.4 - open, close: 2.4 - close,
                high: 2.4 - low, low: 2.4 - high });
        });
    }
    h4.forEach((candle) => {
        for (const key of ["open", "close", "high", "low"]) candle[key] *= scale;
        attachSides(candle, 0.00002 * scale);
    });
    const currentPrice = h4.at(-1).close;
    return { instrument: "EUR_USD", nowMs, currentPrice, candles: h4, h4,
        marketContext: {
            price: { price: currentPrice, bid: currentPrice - 0.00002 * scale,
                ask: currentPrice + 0.00002 * scale, tradeable: true },
            session: { tradeable: true, spreadPips: 0.4 * scale },
            timeframes: { "4h": { candles: h4 } },
        } };
}

function appendH4(fixture, prices) {
    const nextStart = Date.parse(fixture.h4.at(-1).time) + H4_MS;
    const candle = attachSides({ time: new Date(nextStart).toISOString(),
        complete: true, volume: 100, ...prices });
    fixture.h4.push(candle);
    fixture.nowMs = nextStart + H4_MS;
    fixture.currentPrice = candle.close;
    fixture.marketContext.price = { price: candle.close, bid: candle.close - 0.00002,
        ask: candle.close + 0.00002, tradeable: true };
    return fixture;
}

module.exports = { H4_MS, attachSides, multiDayTrendFixture, appendH4 };
