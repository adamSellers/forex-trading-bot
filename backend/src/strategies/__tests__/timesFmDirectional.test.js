const timesFmDirectionalStrategy = require("../timesFmDirectional");

function buildCandles(count = 80, start = 1.08) {
    return Array.from({ length: count }, (_, index) => {
        const close = start + index * 0.0001;
        return {
            time: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
            open: close - 0.0002,
            high: close + 0.0003,
            low: close - 0.0003,
            close,
            volume: 100,
        };
    });
}

describe("timesFmDirectionalStrategy", () => {
    test("returns BUY when the forecast is strong and bullish", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext: {
                session: {
                    session: "London",
                    spreadPips: 0.8,
                },
                timeframes: {
                    "15m": {
                        indicators: {
                            atr: Array.from({ length: 20 }, () => 0.0012),
                        },
                    },
                },
                timesFmForecast: {
                    available: true,
                    direction: "BULLISH",
                    confidence: 0.82,
                    returnBps: 14.4,
                    volatilityRegime: "NORMAL",
                    neutral: false,
                },
            },
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "TIMESFM_DIRECTIONAL_LONG_ACTIONABLE",
                entryType: "TIMESFM_DIRECTIONAL",
                signalClass: "ACTIONABLE",
                tradePlan: expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                    takeProfitPrice: expect.any(Number),
                }),
            })
        );
    });

    test("returns HOLD when the forecast is unavailable", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            marketContext: {
                session: {
                    session: "London",
                    spreadPips: 0.8,
                },
                timeframes: {
                    "15m": {
                        indicators: {
                            atr: Array.from({ length: 20 }, () => 0.0012),
                        },
                    },
                },
                timesFmForecast: {
                    available: false,
                    reason: "sidecar_unavailable",
                },
            },
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "TIMESFM_DIRECTIONAL_NO_FORECAST",
            })
        );
    });

    test("returns HOLD when the forecast is below confidence threshold", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext: {
                session: {
                    session: "London",
                    spreadPips: 0.8,
                },
                timeframes: {
                    "15m": {
                        indicators: {
                            atr: Array.from({ length: 20 }, () => 0.0012),
                        },
                    },
                },
                timesFmForecast: {
                    available: true,
                    direction: "BEARISH",
                    confidence: 0.55,
                    returnBps: -16.5,
                    volatilityRegime: "NORMAL",
                    neutral: false,
                },
            },
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
                timesFmStrategyMinConfidence: 0.7,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "TIMESFM_DIRECTIONAL_CONFIDENCE_FILTERED",
            })
        );
    });
});
