const rangeBreakoutStrategy = require("../rangeBreakout");

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

function buildLondonRangeCandles() {
    const candles = [];
    const start = Date.UTC(2026, 0, 1, 7, 0, 0, 0);
    const closes = [
        1.1, 1.1001, 1.10015, 1.09995, 1.1002, 1.10005,
        1.0999, 1.1001, 1.1002, 1.10005, 1.1001, 1.1,
    ];

    closes.forEach((close, index) => {
        const time = new Date(start + index * 5 * 60 * 1000).toISOString();
        candles.push(
            createCandle(
                time,
                close - 0.00005,
                1.1005,
                1.0995,
                close
            )
        );
    });

    for (let index = 12; index < 30; index += 1) {
        const base = 1.1001 + (index - 12) * 0.00002;
        const time = new Date(start + index * 5 * 60 * 1000).toISOString();
        candles.push(
            createCandle(time, base, base + 0.0002, base - 0.0002, base + 0.00005)
        );
    }

    return candles;
}

function buildNewYorkRangeCandles() {
    const candles = [];
    const start = Date.UTC(2026, 0, 1, 12, 0, 0, 0);
    const closes = [
        1.2, 1.1999, 1.19985, 1.20005, 1.1998, 1.19995,
        1.2001, 1.1999, 1.19985, 1.19995, 1.1999, 1.2,
    ];

    closes.forEach((close, index) => {
        const time = new Date(start + index * 5 * 60 * 1000).toISOString();
        candles.push(
            createCandle(
                time,
                close + 0.00005,
                1.2005,
                1.1995,
                close
            )
        );
    });

    for (let index = 12; index < 30; index += 1) {
        const base = 1.1999 - (index - 12) * 0.00002;
        const time = new Date(start + index * 5 * 60 * 1000).toISOString();
        candles.push(
            createCandle(time, base, base + 0.0002, base - 0.0002, base - 0.00005)
        );
    }

    return candles;
}

function buildVolatileLondonRangeCandles() {
    return buildLondonRangeCandles().map((candle, index) => {
        if (index < 22 || index > 27) {
            return candle;
        }

        return {
            ...candle,
            open: 1.1002,
            high: 1.1012,
            low: 1.0988,
            close: 1.1001,
        };
    });
}

describe("rangeBreakoutStrategy", () => {
    test("emits a long entry on a valid London opening-range breakout", async () => {
        const result = await rangeBreakoutStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: [
                createCandle("2026-01-01T09:00:00.000Z", 1.1001, 1.10035, 1.09995, 1.1003),
                createCandle("2026-01-01T09:15:00.000Z", 1.1002, 1.10085, 1.1001, 1.10075),
            ],
            currentPrice: 1.10075,
            config: {},
            marketContext: {
                session: {
                    session: "London",
                    spreadPips: 1.0,
                },
                timeframes: {
                    "5m": {
                        candles: buildLondonRangeCandles(),
                    },
                    "1h": {
                        indicators: {
                            atr: [0.0008],
                        },
                        candles: [],
                    },
                },
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "RANGE_BREAKOUT_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "RANGE_BREAKOUT_OPENING_RANGE",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
                expectedEdge: expect.objectContaining({
                    grossTargetPips: expect.any(Number),
                    grossStopPips: expect.any(Number),
                    spreadCostPips: 1,
                    breakEvenWinRate: expect.any(Number),
                    brokerFeedingOnly: expect.any(Boolean),
                }),
                strategyContext: expect.objectContaining({
                    family: "range_breakout",
                    setup: "opening_range_breakout",
                    entryBias: "long",
                    breakoutQuality: expect.objectContaining({
                        compressionOk: true,
                        longQualityOk: true,
                    }),
                    expectedEdge: expect.objectContaining({
                        spreadCostPips: 1,
                    }),
                    openingRange: expect.objectContaining({
                        session: "London",
                        high: expect.any(Number),
                        low: expect.any(Number),
                        atrRatio: expect.any(Number),
                    }),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeCloseTo(1.0995, 5);
        expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(1.10075);
    });

    test("emits a short entry on a valid New York opening-range breakdown", async () => {
        const result = await rangeBreakoutStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: [
                createCandle("2026-01-01T14:00:00.000Z", 1.19995, 1.2001, 1.19975, 1.1997),
                createCandle("2026-01-01T14:15:00.000Z", 1.1998, 1.19985, 1.1992, 1.19925),
            ],
            currentPrice: 1.19925,
            config: {},
            marketContext: {
                session: {
                    session: "New York",
                    spreadPips: 0.9,
                },
                timeframes: {
                    "5m": {
                        candles: buildNewYorkRangeCandles(),
                    },
                    "1h": {
                        indicators: {
                            atr: [0.0008],
                        },
                        candles: [],
                    },
                },
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                reasonCode: "RANGE_BREAKOUT_SHORT_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_SHORT",
                entryType: "RANGE_BREAKOUT_OPENING_RANGE",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
                expectedEdge: expect.objectContaining({
                    grossTargetPips: expect.any(Number),
                    grossStopPips: expect.any(Number),
                    spreadCostPips: 0.9,
                    breakEvenWinRate: expect.any(Number),
                    brokerFeedingOnly: expect.any(Boolean),
                }),
                strategyContext: expect.objectContaining({
                    family: "range_breakout",
                    setup: "opening_range_breakdown",
                    entryBias: "short",
                    breakoutQuality: expect.objectContaining({
                        compressionOk: true,
                        shortQualityOk: true,
                    }),
                    openingRange: expect.objectContaining({
                        session: "New York",
                        high: expect.any(Number),
                        low: expect.any(Number),
                        atrRatio: expect.any(Number),
                    }),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeCloseTo(1.2005, 5);
        expect(result.tradePlan.takeProfitPrice).toBeLessThan(1.19925);
    });

    test("filters setups when the opening range is too small relative to H1 ATR", async () => {
        const result = await rangeBreakoutStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: [
                createCandle("2026-01-01T09:00:00.000Z", 1.1001, 1.10035, 1.09995, 1.1003),
                createCandle("2026-01-01T09:15:00.000Z", 1.1002, 1.10085, 1.1001, 1.10075),
            ],
            currentPrice: 1.10075,
            config: {},
            marketContext: {
                session: {
                    session: "London",
                    spreadPips: 1.0,
                },
                timeframes: {
                    "5m": {
                        candles: buildLondonRangeCandles(),
                    },
                    "1h": {
                        indicators: {
                            atr: [0.003],
                        },
                        candles: [],
                    },
                },
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "RANGE_BREAKOUT_RANGE_FILTERED",
                signalClass: "FILTERED",
                strategyContext: expect.objectContaining({
                    family: "range_breakout",
                    openingRange: expect.objectContaining({
                        session: "London",
                        atrRatio: expect.any(Number),
                    }),
                }),
            })
        );
    });

    test("filters fresh breaks without acceptance, retest, or pre-breakout compression", async () => {
        const result = await rangeBreakoutStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: [
                createCandle("2026-01-01T09:00:00.000Z", 1.1001, 1.10035, 1.09995, 1.1003),
                createCandle("2026-01-01T09:15:00.000Z", 1.1002, 1.10085, 1.1001, 1.10075),
            ],
            currentPrice: 1.10075,
            config: {},
            marketContext: {
                session: {
                    session: "London",
                    spreadPips: 1.0,
                },
                timeframes: {
                    "5m": {
                        candles: buildVolatileLondonRangeCandles(),
                    },
                    "1h": {
                        indicators: {
                            atr: [0.0008],
                        },
                        candles: [],
                    },
                },
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "RANGE_BREAKOUT_QUALITY_FILTERED",
                signalClass: "FILTERED",
                strategyContext: expect.objectContaining({
                    breakoutQuality: expect.objectContaining({
                        compressionOk: false,
                        longAcceptanceOk: false,
                        longQualityOk: false,
                    }),
                }),
            })
        );
    });
});
