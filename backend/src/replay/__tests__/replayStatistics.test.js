const {
    calculateReplayStatistics,
    deflatedSharpeProbability,
    estimateProbabilityOfBacktestOverfitting,
    wilsonInterval,
} = require("../replayStatistics");

describe("replay statistics", () => {
    test("reports AUD expectancy, costs, confidence, and drawdown", () => {
        const stats = calculateReplayStatistics({
            trades: [
                { instrument: "AUD_USD", netPnlAud: 4, executionCostAud: 1 },
                { instrument: "AUD_USD", netPnlAud: -2, executionCostAud: 1 },
                { instrument: "EUR_AUD", netPnlAud: 2, executionCostAud: 0.5 },
            ],
            equityCurve: [
                { time: Date.parse("2026-07-01"), equityAud: 100 },
                { time: Date.parse("2026-07-02"), equityAud: 95 },
                { time: Date.parse("2026-07-03"), equityAud: 104 },
            ],
            rejections: [],
        }, { bootstrap: { samples: 200, seed: 7 } });

        expect(stats.referenceCurrency).toBe("AUD");
        expect(stats.tradeCount).toBe(3);
        expect(stats.netPnlAud).toBe(4);
        expect(stats.profitFactor).toBe(3);
        expect(stats.maxDrawdownPct).toBeCloseTo(0.05);
        expect(stats.executionCostAud).toBe(2.5);
        expect(stats.expectancy95Aud.samples).toBe(200);
    });

    test("confidence functions penalize small samples and multiple trials", () => {
        expect(wilsonInterval(2, 2).lower).toBeLessThan(0.5);
        const single = deflatedSharpeProbability([0.01, 0.02, -0.005, 0.015], 1);
        const many = deflatedSharpeProbability([0.01, 0.02, -0.005, 0.015], 100);
        expect(many.probability).toBeLessThan(single.probability);
    });

    test("PBO flags an in-sample winner that ranks in the OOS bottom half", () => {
        const pbo = estimateProbabilityOfBacktestOverfitting([
            {
                variants: [
                    { id: "a", inSampleScore: 10, outOfSampleScore: -2 },
                    { id: "b", inSampleScore: 5, outOfSampleScore: 3 },
                ],
            },
        ]);
        expect(pbo).toEqual({ probability: 1, observations: 1 });
    });
});
