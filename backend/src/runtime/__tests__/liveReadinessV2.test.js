const {
    evaluateLiveReadiness,
    getLiveRiskLimitViolations,
} = require("../liveReadiness");
const { computeConfigHash } = require("../../config/tradingConfig");

function readyConfig(overrides = {}) {
    return {
        strategy: "intraday_momentum",
        referenceCurrency: "AUD",
        accountCurrency: "AUD",
        portfolioRiskEnforcement: true,
        maxOpenPositions: 1,
        riskPerTrade: 0.0025,
        maxCapitalAtRisk: 100,
        maxPortfolioExposure: 0.3,
        maxAggregateStopRiskPctNav: 0.005,
        maxNetCurrencyExposurePctNav: 1,
        maxCorrelatedExposurePctNav: 1,
        maxDailyLossPctNav: 0.01,
        maxDrawdownPctNav: 0.05,
        maxConsecutiveLosses: 3,
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
    test("passes a matching M15 intraday live release", () => {
        const config = readyConfig();
        const readiness = evaluateLiveReadiness({
            config,
            liveSelection: readySelection(config),
        });

        expect(readiness).toEqual(
            expect.objectContaining({
                passed: true,
                status: "PASS",
                strategy: "intraday_momentum",
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

    test("reports an active loss cooldown as a bounded entry block", () => {
        const config = readyConfig();
        const cooldownUntil = Date.now() + 60_000;
        const readiness = evaluateLiveReadiness({
            config,
            liveSelection: readySelection(config),
            entryRisk: {
                status: "COOLDOWN",
                entryAllowed: false,
                cooldownActive: true,
                consecutiveLosses: 3,
                maxConsecutiveLosses: 3,
                cooldownStartedAt: Date.now(),
                cooldownUntil,
                remainingMs: 60_000,
            },
        });

        expect(readiness).toEqual(
            expect.objectContaining({
                passed: false,
                status: "COOLDOWN",
                entryRisk: expect.objectContaining({
                    cooldownUntil,
                }),
            })
        );
        expect(readiness.reasons).toEqual([
            expect.objectContaining({
                code: "CONSECUTIVE_LOSS_COOLDOWN",
                cooldownUntil,
            }),
        ]);
    });
});
