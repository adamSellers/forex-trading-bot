const {
    applyControlledLiveConfig,
    evaluateControlledLiveReadiness,
    getControlledRiskLimitViolations,
} = require("../liveActivationReadiness");
const { computeConfigHash } = require("../../config/tradingConfig");

function buildLiveSelection(overrides = {}) {
    const configHash = overrides.configHash || "live-config";
    return {
        selectionId: "selection-1",
        liveRun: {
            runId: "run-live",
            strategy: "timesfm_directional",
            configHash,
            metadata: {
                promotedFromRunId: "candidate-1",
                promotionGate: {
                    passed: true,
                    status: "PASS",
                    gateVersion: 2,
                    configHash: "candidate-config",
                },
                phase4ControlledLive: {
                    sourceConfigHash: "candidate-config",
                    liveConfigHash: configHash,
                },
            },
            ...overrides,
        },
    };
}

describe("liveActivationReadiness", () => {
    test("applies every controlled cap, AUD identity, and keeps entries paused", () => {
        const config = applyControlledLiveConfig({
            enableTrading: true,
            maxOpenPositions: 3,
            riskPerTrade: 0.02,
            maxCapitalAtRisk: 500,
            maxPortfolioExposure: 0.5,
            maxAggregateStopRiskPctNav: 0.1,
            maxDailyLossPctNav: 0.1,
            maxDrawdownPctNav: 0.5,
            maxConsecutiveLosses: 20,
        });

        expect(config).toEqual(
            expect.objectContaining({
                enableTrading: false,
                referenceCurrency: "AUD",
                accountCurrency: "AUD",
                portfolioRiskEnforcement: true,
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
                maxAggregateStopRiskPctNav: 0.01,
                maxDailyLossPctNav: 0.02,
                maxDrawdownPctNav: 0.08,
                maxConsecutiveLosses: 3,
            })
        );
    });

    test("fails readiness without gate-v2 promotion-path evidence", () => {
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildLiveSelection({ metadata: {} }),
            config: applyControlledLiveConfig({}),
        });

        expect(readiness.reasons.map((reason) => reason.code)).toEqual(
            expect.arrayContaining([
                "PROMOTION_GATE_NOT_PASSED",
                "PROMOTION_PATH_REQUIRED",
                "LIVE_CONFIG_IDENTITY_MISMATCH",
            ])
        );
    });

    test("fails when any controlled portfolio risk cap is exceeded", () => {
        const config = {
            ...applyControlledLiveConfig({}),
            maxOpenPositions: 2,
            maxAggregateStopRiskPctNav: 0.02,
            maxConsecutiveLosses: 4,
        };
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildLiveSelection({
                configHash: computeConfigHash(config),
            }),
            config,
        });

        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxOpenPositions",
                }),
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxAggregateStopRiskPctNav",
                }),
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxConsecutiveLosses",
                }),
            ])
        );
        expect(getControlledRiskLimitViolations(config)).toHaveLength(3);
    });

    test("passes only with immutable promotion identity and all controls enabled", () => {
        const config = applyControlledLiveConfig({});
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildLiveSelection({
                configHash: computeConfigHash(config),
            }),
            config,
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
