const meanReversionStrategy = require("../meanReversion");

function buildCandles(finalClose) {
    return Array.from({ length: 40 }, (_, index) => {
        const close =
            index === 39
                ? finalClose
                : 1.1 + Math.sin(index / 3) * 0.0002;

        return {
            time: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
            open: close + 0.0001,
            high: close + 0.0004,
            low: close - 0.0004,
            close,
            volume: 100 + index,
        };
    });
}

function createMarketContext({ rsi, atr, h1Adx, spreadPips = 1.0, session = "London" }) {
    return {
        session: {
            session,
            spreadPips,
        },
        timeframes: {
            "15m": {
                indicators: {
                    rsi: [rsi],
                    atr: [atr],
                },
            },
            "1h": {
                indicators: {
                    adx: [
                        {
                            adx: h1Adx + 1,
                            pdi: 18,
                            mdi: 20,
                        },
                        {
                            adx: h1Adx,
                            pdi: 18,
                            mdi: 20,
                        },
                    ],
                },
                candles: [],
            },
        },
    };
}

describe("meanReversionStrategy", () => {
    test("emits a long entry after a lower-band failed sweep and reclaim", async () => {
        const result = await meanReversionStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles(1.0998),
            currentPrice: 1.0998,
            config: { minNetRewardRisk: 0 },
            marketContext: createMarketContext({
                rsi: 24,
                atr: 0.001,
                h1Adx: 18,
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "MEAN_REVERSION_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "MEAN_REVERSION_BAND_FADE",
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
                    family: "mean_reversion",
                    setup: "lower_band_fade",
                    entryBias: "long",
                    failedSweep: expect.objectContaining({
                        longFailedSweep: true,
                    }),
                    expectedEdge: expect.objectContaining({
                        spreadCostPips: 1,
                    }),
                    regime: expect.objectContaining({
                        h1Adx: 18,
                        maxH1Adx: 25,
                    }),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeLessThan(1.0998);
        expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(1.0998);
    });

    test("emits a short entry after an upper-band failed sweep and reclaim", async () => {
        const result = await meanReversionStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles(1.1003),
            currentPrice: 1.1003,
            config: { minNetRewardRisk: 0 },
            marketContext: createMarketContext({
                rsi: 76,
                atr: 0.001,
                h1Adx: 17,
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                reasonCode: "MEAN_REVERSION_SHORT_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_SHORT",
                entryType: "MEAN_REVERSION_BAND_FADE",
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
                    family: "mean_reversion",
                    setup: "upper_band_fade",
                    entryBias: "short",
                    failedSweep: expect.objectContaining({
                        shortFailedSweep: true,
                    }),
                    regime: expect.objectContaining({
                        h1Adx: 17,
                        maxH1Adx: 25,
                    }),
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeGreaterThan(1.1003);
        expect(result.tradePlan.takeProfitPrice).toBeLessThan(1.1003);
    });

    test("filters raw lower-band touches that do not reclaim the band", async () => {
        const result = await meanReversionStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles(1.096),
            currentPrice: 1.096,
            config: {},
            marketContext: createMarketContext({
                rsi: 24,
                atr: 0.001,
                h1Adx: 18,
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "MEAN_REVERSION_FAILED_SWEEP_FILTERED",
                signalClass: "FILTERED",
                strategyContext: expect.objectContaining({
                    failedSweep: expect.objectContaining({
                        longSwept: true,
                        longReclaimed: false,
                        longFailedSweep: false,
                    }),
                }),
            })
        );
    });

    test("filters the setup when the higher-timeframe ADX regime is too strong", async () => {
        const result = await meanReversionStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles(1.096),
            currentPrice: 1.096,
            config: {},
            marketContext: createMarketContext({
                rsi: 24,
                atr: 0.001,
                h1Adx: 31,
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "MEAN_REVERSION_REGIME_FILTERED",
                signalClass: "FILTERED",
                strategyContext: expect.objectContaining({
                    family: "mean_reversion",
                    regime: expect.objectContaining({
                        h1Adx: 31,
                        maxH1Adx: 25,
                    }),
                }),
            })
        );
    });

    test("filters a nominal band fade whose target does not clear net reward/risk", async () => {
        const result = await meanReversionStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: buildCandles(1.0998),
            currentPrice: 1.0998,
            config: {},
            marketContext: createMarketContext({
                rsi: 24,
                atr: 0.001,
                h1Adx: 18,
            }),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "MEAN_REVERSION_NET_RR_FILTERED",
            })
        );
    });
});
