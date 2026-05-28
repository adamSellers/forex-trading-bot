const {
    evaluatePromotionGate,
    resolveRequiredSides,
} = require("../promotionGate");

function buildAnalytics({ trades = 60, netExpectancyPips = 1.2, bySide = [] } = {}) {
    return {
        cohortExpectancy: {
            summary: {
                trades,
                wins: Math.floor(trades / 2),
                losses: trades - Math.floor(trades / 2),
                winRatePct: 50,
                totalPnLPips: trades * netExpectancyPips,
                netExpectancyPips,
                netExpectancyAud: 0.3,
                profitFactorPips: netExpectancyPips > 0 ? 1.2 : 0.8,
            },
            bySide,
        },
    };
}

describe("promotionGate", () => {
    test("requires a minimum closed-trade sample before promotion", () => {
        const gate = evaluatePromotionGate({
            analytics: buildAnalytics({ trades: 49, netExpectancyPips: 1 }),
            run: {
                runId: "candidate-1",
                strategy: "timesfm_directional",
                configSnapshot: { enableShorting: false },
            },
            options: {
                minClosedTrades: 50,
                minSideTrades: 1,
            },
        });

        expect(gate.passed).toBe(false);
        expect(gate.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "MIN_CLOSED_TRADES",
                    actual: 49,
                    required: 50,
                }),
            ])
        );
    });

    test("rejects negative overall realistic-paper net expectancy", () => {
        const gate = evaluatePromotionGate({
            analytics: buildAnalytics({
                trades: 60,
                netExpectancyPips: -0.4,
                bySide: [
                    {
                        side: "BUY",
                        trades: 60,
                        netExpectancyPips: -0.4,
                    },
                ],
            }),
            run: {
                runId: "candidate-2",
                strategy: "timesfm_directional",
                configSnapshot: { enableShorting: false },
            },
            options: {
                minClosedTrades: 50,
                minSideTrades: 10,
            },
        });

        expect(gate.passed).toBe(false);
        expect(gate.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "OVERALL_NET_EXPECTANCY",
                    actual: -0.4,
                }),
                expect.objectContaining({
                    code: "SIDE_NET_EXPECTANCY",
                    side: "BUY",
                    actual: -0.4,
                }),
            ])
        );
    });

    test("requires every traded side to clear sample and expectancy when shorts are enabled", () => {
        const gate = evaluatePromotionGate({
            analytics: buildAnalytics({
                trades: 70,
                netExpectancyPips: 0.6,
                bySide: [
                    {
                        side: "BUY",
                        trades: 55,
                        netExpectancyPips: 1.2,
                    },
                    {
                        side: "SELL",
                        trades: 15,
                        netExpectancyPips: -1.4,
                    },
                ],
            }),
            run: {
                runId: "candidate-3",
                strategy: "supertrend_momentum",
                configSnapshot: { enableShorting: true },
            },
            options: {
                minClosedTrades: 50,
                minSideTrades: 10,
            },
        });

        expect(gate.passed).toBe(false);
        expect(gate.requirements.requiredSides).toEqual(["BUY", "SELL"]);
        expect(gate.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "SIDE_NET_EXPECTANCY",
                    side: "SELL",
                    actual: -1.4,
                }),
            ])
        );
    });

    test("passes a long-only candidate with enough positive BUY expectancy", () => {
        const gate = evaluatePromotionGate({
            analytics: buildAnalytics({
                trades: 65,
                netExpectancyPips: 0.9,
                bySide: [
                    {
                        side: "BUY",
                        trades: 65,
                        wins: 34,
                        losses: 31,
                        winRatePct: 52.3,
                        totalPnLPips: 58.5,
                        netExpectancyPips: 0.9,
                        avgR: 0.12,
                    },
                ],
            }),
            run: {
                runId: "candidate-4",
                strategy: "timesfm_directional",
                configSnapshot: { enableShorting: false },
            },
            options: {
                minClosedTrades: 50,
                minSideTrades: 10,
            },
        });

        expect(gate.passed).toBe(true);
        expect(gate.status).toBe("PASS");
        expect(gate.requirements.requiredSides).toEqual(["BUY"]);
        expect(gate.sideExpectancy).toEqual([
            expect.objectContaining({
                side: "BUY",
                trades: 65,
                netExpectancyPips: 0.9,
            }),
        ]);
    });

    test("infers required sides from the candidate config", () => {
        expect(resolveRequiredSides({ enableShorting: false })).toEqual(["BUY"]);
        expect(resolveRequiredSides({ enableShorting: true })).toEqual([
            "BUY",
            "SELL",
        ]);
    });
});
