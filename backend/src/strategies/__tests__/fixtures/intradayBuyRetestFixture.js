// Genuine reflected BUY midpoint/bid pattern; H1 is independently synthetic.
const { sellRetestFixture } = require("./intradaySellRetestFixture");
function buyRetestFixture(options = {}) {
    const source = sellRetestFixture(options);
    const reflect = (candle) => {
        const { open, high, low, close } = candle;
        const prices = { open: 2.4 - open, high: 2.4 - low, low: 2.4 - high, close: 2.4 - close };
        return { ...candle, ...prices,
            bid: candle.ask ? { open: 2.4 - candle.ask.open, high: 2.4 - candle.ask.low,
                low: 2.4 - candle.ask.high, close: 2.4 - candle.ask.close } : undefined };
    };
    const m15 = source.m15.map(reflect);
    const h1 = source.h1.map(reflect);
    const currentPrice = m15.at(-1).close;
    return { ...source, m15, h1, currentPrice, marketContext: { ...source.marketContext,
        price: { ...source.marketContext.price, price: currentPrice, mid: currentPrice,
            bid: currentPrice - .00002, ask: currentPrice + .00002 },
        timeframes: { '15m': { candles: m15 }, '1h': { candles: h1 } } } };
}

module.exports = { sellRetestFixture, buyRetestFixture };
