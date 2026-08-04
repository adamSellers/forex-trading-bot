const {
    evaluateLiveReadiness,
    getLiveRiskLimitViolations,
} = require("../liveReadiness");
const { computeConfigHash } = require("../../config/tradingConfig");

function readyConfig(overrides = {}) {
    return {
        strategy: "carry_trend",
        referenceCurrency: "AUD",
        accountCurrency: "AUD",
        portfolioRiskEnforcement: true,
        maxOpenPositions: 1,
        riskPerTrade: 0.005,
        maxCapitalAtRisk: 100,
        maxPortfolioExposure: 0.3,
        maxAggregateStopRiskPctNav: 0.01,
        maxNetCurrencyExposurePctNav: 1,
        maxCorrelatedExposurePctNav: 1,
        maxDailyLossPctNav: 0.02,
        maxDrawdownPctNav: 0.1,
        maxConsecutiveLosses: 5,
        ...overrides,
    };
}

function readySelection(config) {
    return {
        selectionId: "live-selection",
        liveRun: {
            runId: "live-run",
            strategy: config.strategy,
            configHash: computeConfigHash(config),
        },
    };
}

describe("liveReadiness", () => {
    test("passes a matching carry-trend live release", () => {
        const config = readyConfig();
        const readiness = evaluateLiveReadiness({
            config,
            liveSelection: readySelection(config),
        });

        expect(readiness).toEqual(
            expect.objectContaining({
                passed: true,
                status: "PASS",
                strategy: "carry_trend",
                strategyVersion: "1.0.0",
            })
        );
        expect(readiness).not.toHaveProperty("activationOptions");
    });

    test("fails if the runtime is stale or configured risk exceeds the release", () => {
        const config = readyConfig({
            riskPerTrade: 0.02,
        });
        const selection = readySelection(readyConfig());
        const readiness = evaluateLiveReadiness({ config, liveSelection: selection });

        expect(readiness.passed).toBe(false);
        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "LIVE_CONFIG_MISMATCH" }),
                expect.objectContaining({
                    code: "LIVE_RISK_LIMIT",
                    key: "riskPerTrade",
                }),
            ])
        );
    });

    test("limits the installation to one simultaneous live position", () => {
        expect(
            getLiveRiskLimitViolations(
                readyConfig({ maxOpenPositions: 2 })
            )
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    key: "maxOpenPositions",
                    max: 1,
                }),
            ])
        );
    });
});
