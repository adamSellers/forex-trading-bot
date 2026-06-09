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

function buildMarketContext(forecast = {}, overrides = {}) {
    return {
        session: {
            session: "London",
            spreadPips: 0.8,
            ...(overrides.session || {}),
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
            ...forecast,
        },
    };
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

    test("floors the plan stop at minStopLossPips and scales the target to keep R:R", async () => {
        const candles = buildCandles();
        const entryPrice = candles[candles.length - 1].close;
        const marketContext = buildMarketContext();
        // 4-pip ATR x 1.5 = 6-pip raw stop, below the 15-pip default floor.
        marketContext.timeframes["15m"].indicators.atr = Array.from(
            { length: 20 },
            () => 0.0004
        );

        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: entryPrice,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext,
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
            },
        });

        expect(result.signalType).toBe("BUY");
        // Stop floored to 15 pips; reward = floored stop x default 3.0 R:R.
        expect(result.tradePlan.stopLossPrice).toBeCloseTo(entryPrice - 0.0015, 8);
        expect(result.tradePlan.takeProfitPrice).toBeCloseTo(entryPrice + 0.0045, 8);
    });

    test("uses the raw ATR stop when it is wider than the floor", async () => {
        const candles = buildCandles();
        const entryPrice = candles[candles.length - 1].close;

        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: entryPrice,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            // Default context ATR is 12 pips: 12 x 1.5 = 18-pip stop, above the floor.
            marketContext: buildMarketContext(),
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
            },
        });

        expect(result.signalType).toBe("BUY");
        expect(result.tradePlan.stopLossPrice).toBeCloseTo(entryPrice - 0.0018, 8);
        expect(result.tradePlan.takeProfitPrice).toBeCloseTo(entryPrice + 0.0054, 8);
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

    test("blocks bearish forecasts by default for the long-only Phase 2 posture", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext: buildMarketContext({
                direction: "BEARISH",
                confidence: 0.82,
                returnBps: -14.4,
            }),
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "TIMESFM_DIRECTIONAL_SHORTS_DISABLED",
            })
        );
    });

    test("allows bearish forecasts when shorting is explicitly enabled", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "EUR_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext: buildMarketContext({
                direction: "BEARISH",
                confidence: 0.82,
                returnBps: -14.4,
            }),
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
                enableShorting: true,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                reasonCode: "TIMESFM_DIRECTIONAL_SHORT_ACTIONABLE",
                signalClass: "ACTIONABLE",
            })
        );
    });

    test("allows the lower return floor when confidence is high", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext: buildMarketContext({
                confidence: 0.82,
                returnBps: 7.7,
            }),
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
                timesFmStrategyMinReturnBps: 10,
                timesFmStrategyHighConfidenceThreshold: 0.8,
                timesFmStrategyHighConfidenceMinReturnBps: 7.5,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "TIMESFM_DIRECTIONAL_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
            })
        );
        expect(result.reason).toContain("min 7.5bps");
    });

    test("keeps the base return floor when confidence is below high confidence", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "GBP_USD",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.0001),
            },
            marketContext: buildMarketContext({
                confidence: 0.79,
                returnBps: 7.7,
            }),
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
                timesFmStrategyMinReturnBps: 10,
                timesFmStrategyHighConfidenceThreshold: 0.8,
                timesFmStrategyHighConfidenceMinReturnBps: 7.5,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "TIMESFM_DIRECTIONAL_RETURN_FILTERED",
            })
        );
        expect(result.reason).toContain("10.0bps threshold");
    });

    test("still filters high confidence forecasts below the lower return floor", async () => {
        const candles = buildCandles();
        const result = await timesFmDirectionalStrategy.evaluateEntry({
            instrument: "USD_JPY",
            candles,
            currentPrice: candles[candles.length - 1].close,
            dataService: {
                getPipValue: jest.fn(() => 0.01),
            },
            marketContext: buildMarketContext({
                confidence: 0.84,
                returnBps: 7.4,
            }),
            config: {
                timeframe: "15m",
                maxSpreadPips: 1.2,
                timesFmStrategyMinReturnBps: 10,
                timesFmStrategyHighConfidenceThreshold: 0.8,
                timesFmStrategyHighConfidenceMinReturnBps: 7.5,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "TIMESFM_DIRECTIONAL_RETURN_FILTERED",
            })
        );
        expect(result.reason).toContain("7.5bps threshold");
    });
});
