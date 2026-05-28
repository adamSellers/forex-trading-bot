const {
    applyControlledLiveConfig,
    evaluateControlledLiveReadiness,
} = require("../liveActivationReadiness");

describe("liveActivationReadiness", () => {
    test("applies conservative live activation caps and keeps entries paused", () => {
        const config = applyControlledLiveConfig({
            enableTrading: true,
            maxOpenPositions: 3,
            riskPerTrade: 0.02,
            maxCapitalAtRisk: 500,
            maxPortfolioExposure: 0.5,
            strategy: "timesfm_directional",
        });

        expect(config).toEqual(
            expect.objectContaining({
                enableTrading: false,
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
                liveActivationPhase: "phase4_controlled",
                strategy: "timesfm_directional",
            })
        );
    });

    test("fails readiness without passing promotion evidence", () => {
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: {
                selectionId: "selection-1",
                liveRun: {
                    runId: "run-live",
                    strategy: "timesfm_directional",
                    metadata: {},
                },
            },
            config: applyControlledLiveConfig({}),
        });

        expect(readiness.passed).toBe(false);
        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "PROMOTION_GATE_NOT_PASSED",
                }),
            ])
        );
    });

    test("fails readiness when controlled risk caps are exceeded", () => {
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: {
                selectionId: "selection-1",
                liveRun: {
                    runId: "run-live",
                    strategy: "timesfm_directional",
                    metadata: {
                        promotionGate: {
                            passed: true,
                            status: "PASS",
                        },
                    },
                },
            },
            config: {
                maxOpenPositions: 2,
                riskPerTrade: 0.01,
                maxCapitalAtRisk: 100,
                maxPortfolioExposure: 0.5,
            },
        });

        expect(readiness.passed).toBe(false);
        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "riskPerTrade",
                }),
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxPortfolioExposure",
                }),
            ])
        );
    });

    test("passes readiness with promotion evidence and controlled risk caps", () => {
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: {
                selectionId: "selection-1",
                liveRun: {
                    runId: "run-live",
                    strategy: "timesfm_directional",
                    metadata: {
                        promotionGate: {
                            passed: true,
                            status: "PASS",
                        },
                    },
                },
            },
            config: {
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
            },
        });

        expect(readiness).toEqual(
            expect.objectContaining({
                passed: true,
                status: "PASS",
                liveRunId: "run-live",
                strategy: "timesfm_directional",
            })
        );
    });
});
