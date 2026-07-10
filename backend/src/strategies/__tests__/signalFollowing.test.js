jest.mock("../index", () => ({
    getStrategyDefinition: jest.fn(),
}));

const { getStrategyDefinition } = require("../index");
const signalFollowingStrategy = require("../signalFollowing");

function buildCandles(count = 60) {
    return Array.from({ length: count }, (_, index) => ({
        time: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
        open: 1.1 + index * 0.0001,
        high: 1.101 + index * 0.0001,
        low: 1.099 + index * 0.0001,
        close: 1.1 + index * 0.0001,
    }));
}

function mockStrategyEvaluations(evaluationsByStrategy = {}) {
    getStrategyDefinition.mockImplementation((strategyKey) => ({
        key: strategyKey,
        evaluateEntry: jest.fn(async () => evaluationsByStrategy[strategyKey]),
    }));
}

describe("signalFollowingStrategy", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("follows the first actionable source BUY and preserves the plan", async () => {
        mockStrategyEvaluations({
            mean_reversion: {
                signalType: "BUY",
                reasonCode: "MEAN_REVERSION_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "MEAN_REVERSION_BAND_FADE",
                signalCandleTime: "2026-01-01T00:00:00.000Z",
                atrVal: 0.001,
                atrPips: 10,
                rsiVal: 25,
                adxVal: 18,
                pdiVal: 12,
                mdiVal: 16,
                adxRising: false,
                prevAdxVal: 17,
                currentDir: 1,
                tradePlan: {
                    stopLossPrice: 1.098,
                    takeProfitPrice: 1.104,
                },
            },
        });

        const result = await signalFollowingStrategy.evaluateSignalFollowingEntry({
            instrument: "EUR_USD",
            candles: buildCandles(),
            currentPrice: 1.1,
            config: {
                counterSignalSourceStrategies: ["mean_reversion"],
                signalFollowingMinConfirmations: 1,
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "SIGNAL_FOLLOWING_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "SIGNAL_FOLLOWING",
                tradePlan: {
                    stopLossPrice: 1.098,
                    takeProfitPrice: 1.104,
                },
            })
        );
        expect(result.strategyContext.selectedSource).toEqual(
            expect.objectContaining({
                strategy: "mean_reversion",
                signalType: "BUY",
                reasonCode: "MEAN_REVERSION_LONG_ACTIONABLE",
            })
        );
    });

    test("follows the first actionable source SELL and skips holds", async () => {
        mockStrategyEvaluations({
            timesfm_directional: {
                signalType: "HOLD",
                reasonCode: "TIMESFM_DIRECTIONAL_WAIT",
                signalClass: "FILTERED",
                intent: "WAIT",
            },
            stochastic_divergence: {
                signalType: "SELL",
                reasonCode: "STOCHASTIC_DIVERGENCE_SHORT_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_SHORT",
                entryType: "STOCHASTIC_DIVERGENCE_REVERSAL",
                signalCandleTime: "2026-01-01T00:00:00.000Z",
                atrVal: 0.001,
                atrPips: 10,
                tradePlan: {
                    stopLossPrice: 1.103,
                    takeProfitPrice: 1.096,
                },
            },
        });

        const result = await signalFollowingStrategy.evaluateSignalFollowingEntry({
            instrument: "EUR_USD",
            candles: buildCandles(),
            currentPrice: 1.1,
            config: {
                counterSignalSourceStrategies: [
                    "timesfm_directional",
                    "stochastic_divergence",
                ],
                signalFollowingMinConfirmations: 1,
            },
        });

        expect(result.signalType).toBe("SELL");
        expect(result.tradePlan).toEqual({
            stopLossPrice: 1.103,
            takeProfitPrice: 1.096,
        });
        expect(result.strategyContext.selectedSource.strategy).toBe(
            "stochastic_divergence"
        );
    });

    test("uses fallback follow plan when source risk prices are absent", async () => {
        mockStrategyEvaluations({
            mean_reversion: {
                signalType: "BUY",
                reasonCode: "MEAN_REVERSION_LONG_ACTIONABLE",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "MEAN_REVERSION_BAND_FADE",
                signalCandleTime: "2026-01-01T00:00:00.000Z",
                atrVal: 0.001,
                atrPips: 10,
                tradePlan: null,
            },
        });

        const result = await signalFollowingStrategy.evaluateSignalFollowingEntry({
            instrument: "EUR_USD",
            candles: buildCandles(),
            currentPrice: 1.1,
            config: {
                counterSignalSourceStrategies: ["mean_reversion"],
                counterSignalStopLossPips: 20,
                counterSignalTakeProfitPips: 20,
                signalFollowingMinConfirmations: 1,
            },
        });

        expect(result.signalType).toBe("BUY");
        expect(result.tradePlan).toEqual({
            stopLossPrice: 1.098,
            takeProfitPrice: 1.102,
        });
    });

    test("holds when no configured source strategy is actionable", async () => {
        mockStrategyEvaluations({
            mean_reversion: {
                signalType: "HOLD",
                reasonCode: "MEAN_REVERSION_WAIT",
                signalClass: "FILTERED",
                intent: "WAIT",
            },
        });

        const result = await signalFollowingStrategy.evaluateSignalFollowingEntry({
            instrument: "EUR_USD",
            candles: buildCandles(),
            currentPrice: 1.1,
            config: {
                counterSignalSourceStrategies: ["mean_reversion"],
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "SIGNAL_FOLLOWING_NO_SOURCE_ENTRY",
                signalClass: "FILTERED",
            })
        );
    });

    test("requires consensus by default instead of taking the first signal", async () => {
        mockStrategyEvaluations({
            mean_reversion: {
                signalType: "BUY",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "MEAN_REVERSION_BAND_FADE",
                tradePlan: { stopLossPrice: 1.098, takeProfitPrice: 1.104 },
            },
            stochastic_divergence: {
                signalType: "HOLD",
                signalClass: "FILTERED",
                intent: "WAIT",
            },
        });

        const result = await signalFollowingStrategy.evaluateSignalFollowingEntry({
            instrument: "EUR_USD",
            candles: buildCandles(),
            currentPrice: 1.1,
            config: {
                counterSignalSourceStrategies: [
                    "mean_reversion",
                    "stochastic_divergence",
                ],
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reasonCode: "SIGNAL_FOLLOWING_CONSENSUS_FILTERED",
                signalClass: "PENDING",
            })
        );
    });
});
