const stochasticDivergenceStrategy = require("../stochasticDivergence");

function createCandle(time, open, high, low, close) {
    return {
        time,
        open,
        high,
        low,
        close,
        volume: 100,
    };
}

function buildBullishCandles() {
    return Array.from({ length: 40 }, (_, index) => {
        const time = new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString();
        let open = 1.1;
        let high = 1.1004;
        let low = 1.0996;
        let close = 1.1;

        if (index === 24) {
            open = 1.0986;
            high = 1.0989;
            low = 1.0980;
            close = 1.0984;
        } else if (index === 32) {
            open = 1.0981;
            high = 1.0984;
            low = 1.0975;
            close = 1.0979;
        } else if (index === 38) {
            open = 1.0982;
            high = 1.0985;
            low = 1.0979;
            close = 1.0981;
        } else if (index === 39) {
            open = 1.0982;
            high = 1.0991;
            low = 1.0980;
            close = 1.0988;
        }

        return createCandle(time, open, high, low, close);
    });
}

function buildBearishCandles() {
    return Array.from({ length: 40 }, (_, index) => {
        const time = new Date(Date.UTC(2026, 0, 2, 0, index * 15)).toISOString();
        let open = 1.2;
        let high = 1.2004;
        let low = 1.1996;
        let close = 1.2;

        if (index === 24) {
            open = 1.2018;
            high = 1.2020;
            low = 1.2013;
            close = 1.2016;
        } else if (index === 32) {
            open = 1.2024;
            high = 1.2027;
            low = 1.2020;
            close = 1.2023;
        } else if (index === 38) {
            open = 1.2021;
            high = 1.2024;
            low = 1.2019;
            close = 1.2022;
        } else if (index === 39) {
            open = 1.2021;
            high = 1.2022;
            low = 1.2009;
            close = 1.2011;
        }

        return createCandle(time, open, high, low, close);
    });
}

function buildAlignedStochasticSeries(length, values = {}) {
    return Array.from({ length }, (_, index) => values[index] || null);
}

function createMarketContext({
    stochastic15m,
    stochastic1h,
    atr = 0.0006,
    spreadPips = 1.0,
    session = "London",
}) {
    return {
        session: {
            session,
            spreadPips,
        },
        timeframes: {
            "15m": {
                indicators: {
                    stochastic: stochastic15m,
                    atr: [atr],
                },
            },
            "1h": {
                indicators: {
                    stochastic: stochastic1h,
                },
                candles: [],
            },
        },
    };
}

describe("stochasticDivergenceStrategy", () => {
    test("emits a long entry when bullish divergence confirms with an M15 stochastic cross", async () => {
        const candles = buildBullishCandles();
        const result = await stochasticDivergenceStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles,
            currentPrice: 1.0988,
            config: {},
            marketContext: createMarketContext({
                stochastic15m: buildAlignedStochasticSeries(40, {
                    24: { k: 8, d: 12 },
                    32: { k: 14, d: 16 },
                    38: { k: 18, d: 22 },
                    39: { k: 24, d: 20 },
                }),
                stochastic1h: buildAlignedStochasticSeries(6, {
                    4: { k: 52, d: 49 },
                    5: { k: 57, d: 53 },
                }),
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "STOCHASTIC_DIVERGENCE_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "STOCHASTIC_DIVERGENCE_REVERSAL",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeLessThan(1.0975);
        expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(1.0988);
    });

    test("emits a short entry when bearish divergence confirms with an M15 stochastic cross", async () => {
        const candles = buildBearishCandles();
        const result = await stochasticDivergenceStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles,
            currentPrice: 1.2011,
            config: {},
            marketContext: createMarketContext({
                session: "New York",
                stochastic15m: buildAlignedStochasticSeries(40, {
                    24: { k: 92, d: 89 },
                    32: { k: 86, d: 88 },
                    38: { k: 82, d: 78 },
                    39: { k: 74, d: 78 },
                }),
                stochastic1h: buildAlignedStochasticSeries(6, {
                    4: { k: 47, d: 50 },
                    5: { k: 42, d: 46 },
                }),
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                reasonCode: "STOCHASTIC_DIVERGENCE_SHORT_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_SHORT",
                entryType: "STOCHASTIC_DIVERGENCE_REVERSAL",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeGreaterThan(1.2027);
        expect(result.tradePlan.takeProfitPrice).toBeLessThan(1.2011);
    });

    test("filters a bullish divergence when the H1 stochastic context is not supportive", async () => {
        const candles = buildBullishCandles();
        const result = await stochasticDivergenceStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles,
            currentPrice: 1.0988,
            config: {},
            marketContext: createMarketContext({
                stochastic15m: buildAlignedStochasticSeries(40, {
                    24: { k: 8, d: 12 },
                    32: { k: 14, d: 16 },
                    38: { k: 18, d: 22 },
                    39: { k: 24, d: 20 },
                }),
                stochastic1h: buildAlignedStochasticSeries(6, {
                    4: { k: 44, d: 48 },
                    5: { k: 40, d: 45 },
                }),
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "STOCHASTIC_DIVERGENCE_HTF_LONG_FILTERED",
                signalClass: "FILTERED",
            })
        );
    });
});
