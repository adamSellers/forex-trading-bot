const squeezePlayStrategy = require("../squeezePlay");

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

function buildCandles({ basePrice = 1.1, finalOpen, finalClose }) {
    return Array.from({ length: 40 }, (_, index) => {
        const time = new Date(Date.UTC(2026, 0, 3, 0, index * 15)).toISOString();
        const close =
            index === 39 ? finalClose : basePrice + Math.sin(index / 6) * 0.0001;
        const open = index === 39 ? finalOpen : close - 0.00005;

        return createCandle(time, open, close + 0.00025, close - 0.00025, close);
    });
}

function createMarketContext({
    atr = 0.0007,
    session = "London",
    spreadPips = 1.0,
    squeezePlay,
}) {
    return {
        session: {
            session,
            spreadPips,
        },
        timeframes: {
            "15m": {
                indicators: {
                    atr: [atr],
                },
                derived: {
                    squeezePlay,
                },
            },
            "1h": {
                candles: [],
            },
        },
    };
}

describe("squeezePlayStrategy", () => {
    test("emits a long entry when a bullish squeeze release confirms", async () => {
        const result = await squeezePlayStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles({
                basePrice: 1.1,
                finalOpen: 1.1002,
                finalClose: 1.1011,
            }),
            currentPrice: 1.1011,
            config: {},
            marketContext: createMarketContext({
                squeezePlay: {
                    releaseTriggered: true,
                    priorSqueezeCount: 7,
                    slope: 0.00004,
                    direction: "LONG",
                    h1AtrPercentile: 42,
                    isInSqueeze: false,
                },
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "SQUEEZE_PLAY_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "SQUEEZE_PLAY_RELEASE",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
                strategyContext: expect.objectContaining({
                    family: "squeeze_play",
                    setup: "release",
                    entryBias: "long",
                    compression: expect.objectContaining({
                        priorBars: 7,
                    }),
                    volatility: expect.objectContaining({
                        h1AtrPercentile: 42,
                    }),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeLessThan(1.1011);
        expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(1.1011);
    });

    test("emits a short entry when a bearish squeeze release confirms", async () => {
        const result = await squeezePlayStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles({
                basePrice: 1.2,
                finalOpen: 1.2008,
                finalClose: 1.1997,
            }),
            currentPrice: 1.1997,
            config: {},
            marketContext: createMarketContext({
                session: "New York",
                squeezePlay: {
                    releaseTriggered: true,
                    priorSqueezeCount: 8,
                    slope: -0.00005,
                    direction: "SHORT",
                    h1AtrPercentile: 38,
                    isInSqueeze: false,
                },
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                reasonCode: "SQUEEZE_PLAY_SHORT_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_SHORT",
                entryType: "SQUEEZE_PLAY_RELEASE",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
                strategyContext: expect.objectContaining({
                    family: "squeeze_play",
                    setup: "release",
                    entryBias: "short",
                    compression: expect.objectContaining({
                        priorBars: 8,
                    }),
                    volatility: expect.objectContaining({
                        h1AtrPercentile: 38,
                    }),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeGreaterThan(1.1997);
        expect(result.tradePlan.takeProfitPrice).toBeLessThan(1.1997);
    });

    test("filters the setup when H1 volatility is outside the squeeze regime", async () => {
        const result = await squeezePlayStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles({
                basePrice: 1.1,
                finalOpen: 1.1002,
                finalClose: 1.1011,
            }),
            currentPrice: 1.1011,
            config: {},
            marketContext: createMarketContext({
                squeezePlay: {
                    releaseTriggered: true,
                    priorSqueezeCount: 7,
                    slope: 0.00004,
                    direction: "LONG",
                    h1AtrPercentile: 74,
                    isInSqueeze: false,
                },
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "SQUEEZE_PLAY_H1_REGIME_FILTERED",
                signalClass: "FILTERED",
                strategyContext: expect.objectContaining({
                    family: "squeeze_play",
                    volatility: expect.objectContaining({
                        h1AtrPercentile: 74,
                        maxH1AtrPercentile: 60,
                    }),
                }),
            })
        );
    });
});
