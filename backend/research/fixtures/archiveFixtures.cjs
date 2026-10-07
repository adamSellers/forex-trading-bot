// Explicit synthetic software observations; no historical pricing claim.
const START = Date.parse('2026-09-11T13:00:00Z');
const M15 = 900_000;
const metadata = {
    AUD_USD: { name: 'AUD_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05', tradeUnitsPrecision: 0 },
    EUR_USD: { name: 'EUR_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05', tradeUnitsPrecision: 0 },
    GBP_USD: { name: 'GBP_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05', tradeUnitsPrecision: 0 },
    USD_JPY: { name: 'USD_JPY', displayPrecision: 3, pipLocation: -2, marginRate: '0.05', tradeUnitsPrecision: 0 },
};
const pricingAssumptions = { tradeable: true, liquidityUnits: 1_000_000 };

function rawBar(bar) {
    const mid = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => ['ohlc'[i], bar[key]]));
    const ask = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => ['ohlc'[i], bar.ask?.[key] ?? bar[key] + 0.00002]));
    const bid = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) =>
        ['ohlc'[i], bar.bid?.[key] ?? mid['ohlc'[i]] - (ask['ohlc'[i]] - mid['ohlc'[i]])]));
    return { time: Date.parse(bar.time) / 1000, mid, ask, bid, complete: true, volume: bar.volume || 100 };
}
function fixtureArchive(flows, { futureIntervals = 24 } = {}) {
    const candlesByInstrument = {};
    const h1ByInstrument = {};
    for (const flow of flows) {
        const bars = flow.m15.map(rawBar);
        const final = bars.at(-1);
        for (let index = 1; index <= futureIntervals; index++) {
            bars.push({ ...final, time: final.time + index * 900,
                mid: Object.fromEntries('ohlc'.split('').map((key) => [key, final.mid.c])),
                bid: Object.fromEntries('ohlc'.split('').map((key) => [key, final.bid.c])),
                ask: Object.fromEntries('ohlc'.split('').map((key) => [key, final.ask.c])) });
        }
        candlesByInstrument[flow.instrument] = bars;
        // SELL fixture explicitly supplies independent H1 software evidence;
        // coherent BUY fixtures use the adapter's actual M15 aggregation.
        if (flow.independentH1) h1ByInstrument[flow.instrument] = flow.h1.map(rawBar);
    }
    const longest = Object.values(candlesByInstrument).sort((a, b) => b.length - a.length)[0];
    if (!candlesByInstrument.AUD_USD) candlesByInstrument.AUD_USD = longest.map((bar) => ({
        time: bar.time, complete: true, volume: 100,
        mid: { o: 0.66667, h: 0.6667, l: 0.66664, c: 0.66667 },
        bid: { o: 0.66665, h: 0.66668, l: 0.66662, c: 0.66665 },
        ask: { o: 0.66669, h: 0.66672, l: 0.66666, c: 0.66669 },
    }));
    return { candlesByInstrument, h1ByInstrument };
}

module.exports = { START, M15, metadata, pricingAssumptions, rawBar, fixtureArchive };
