const { calculateExpectedEdge } = require("../expectedEdge");

describe("calculateExpectedEdge", () => {
    test("calculates cost-aware payoff metadata from trade plan prices", () => {
        expect(
            calculateExpectedEdge({
                entryPrice: 1.1,
                stopLossPrice: 1.0985,
                takeProfitPrice: 1.1025,
                pipValue: 0.0001,
                spreadPips: 1,
                slippagePips: 0.2,
            })
        ).toEqual(
            expect.objectContaining({
                grossTargetPips: 25,
                grossStopPips: 15,
                spreadCostPips: 1,
                slippageCostPips: 0.2,
                totalCostPips: 1.2,
                grossRewardRisk: 1.667,
                breakEvenWinRate: 0.405,
                payoffSkewPips: 10,
                targetAfterCostPips: 23.8,
                netEdgePips: null,
                requiresProbabilityModel: true,
                edgeVerdict: "REQUIRES_WIN_RATE_MODEL",
                brokerFeedingOnly: false,
            })
        );
    });

    test("calculates probability-weighted expectancy when a win rate is supplied", () => {
        expect(
            calculateExpectedEdge({
                stopPips: 15,
                targetPips: 25,
                spreadPips: 1,
                slippagePips: 0.2,
                winProbability: 0.5,
            })
        ).toEqual(
            expect.objectContaining({
                assumedWinProbability: 0.5,
                grossExpectancyPips: 5,
                netExpectancyPips: 3.8,
                netEdgePips: 3.8,
                requiresProbabilityModel: false,
                edgeVerdict: "POSITIVE_EXPECTANCY",
                brokerFeedingOnly: false,
            })
        );
    });

    test("flags broker-feeding-only ideas when target payoff is consumed by costs", () => {
        expect(
            calculateExpectedEdge({
                entryPrice: 1.1,
                stopPips: 10,
                targetPips: 0.8,
                pipValue: 0.0001,
                spreadPips: 1,
                slippagePips: 0.2,
            })
        ).toEqual(
            expect.objectContaining({
                targetAfterCostPips: -0.4,
                netEdgePips: null,
                requiresProbabilityModel: true,
                brokerFeedingOnly: true,
                brokerFeedingReason: expect.stringContaining("spread/slippage"),
            })
        );
    });
});
