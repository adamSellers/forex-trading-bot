const {
    CONSECUTIVE_LOSS_COOLDOWN_MS,
    evaluateConsecutiveLossCooldown,
    evaluatePortfolioRisk,
} = require("../portfolioRiskPolicy");
const { cloneDefaultConfig } = require("../../config/tradingConfig");

const permissiveConfig = {
    minNavAud: 50,
    maxAggregateStopRiskPctNav: 0.02,
    maxNetCurrencyExposurePctNav: 0.5,
    maxCorrelatedExposurePctNav: 0.5,
    maxDailyLossPctNav: 0.02,
    maxDrawdownPctNav: 0.08,
    maxConsecutiveLosses: 3,
    correlationThreshold: 0.7,
};

describe("portfolioRiskPolicy", () => {
    test("starts a bounded cooldown at the third consecutive loss", () => {
        const finalExit = Date.UTC(2026, 7, 21, 12, 30);
        const state = evaluateConsecutiveLossCooldown({
            closedTrades: [
                { pnlAud: -0.1, exitTime: finalExit - 2_000 },
                { pnlAud: -0.1, exitTime: finalExit - 1_000 },
                { pnlAud: -0.1, exitTime: finalExit },
            ],
            maxConsecutiveLosses: 3,
            evaluatedAt: finalExit + 1_000,
        });

        expect(state).toEqual(
            expect.objectContaining({
                status: "COOLDOWN",
                entryAllowed: false,
                cooldownActive: true,
                consecutiveLosses: 3,
                cooldownStartedAt: finalExit,
                cooldownUntil: finalExit + CONSECUTIVE_LOSS_COOLDOWN_MS,
            })
        );
    });

    test("expires the cooldown and reconstructs the same reset after restart", () => {
        const finalExit = Date.UTC(2026, 7, 21, 12, 30);
        const closedTrades = [
            { pnlAud: -0.1, exitTime: finalExit - 2_000 },
            { pnlAud: -0.1, exitTime: finalExit - 1_000 },
            { pnlAud: -0.1, exitTime: finalExit },
        ];
        const evaluatedAt = finalExit + CONSECUTIVE_LOSS_COOLDOWN_MS;
        const firstEvaluation = evaluateConsecutiveLossCooldown({
            closedTrades,
            evaluatedAt,
        });
        const restartEvaluation = evaluateConsecutiveLossCooldown({
            closedTrades,
            evaluatedAt,
        });

        expect(firstEvaluation).toEqual(restartEvaluation);
        expect(firstEvaluation).toEqual(
            expect.objectContaining({
                status: "READY",
                entryAllowed: true,
                cooldownActive: false,
                consecutiveLosses: 0,
                streakResetAt: evaluatedAt,
            })
        );
    });

    test("counts a post-cooldown loss as the first loss of a new streak", () => {
        const finalExit = Date.UTC(2026, 7, 21, 12, 30);
        const resetAt = finalExit + CONSECUTIVE_LOSS_COOLDOWN_MS;
        const state = evaluateConsecutiveLossCooldown({
            closedTrades: [
                { pnlAud: -0.1, exitTime: finalExit - 2_000 },
                { pnlAud: -0.1, exitTime: finalExit - 1_000 },
                { pnlAud: -0.1, exitTime: finalExit },
                { pnlAud: -0.1, exitTime: resetAt + 1_000 },
            ],
            evaluatedAt: resetAt + 2_000,
        });

        expect(state).toEqual(
            expect.objectContaining({
                status: "READY",
                entryAllowed: true,
                cooldownActive: false,
                consecutiveLosses: 1,
                streakResetAt: resetAt,
            })
        );
    });

    test("passes a fully valued AUD pre-trade portfolio inside every limit", () => {
        const result = evaluatePortfolioRisk({
            navAud: 1000,
            proposedTrade: {
                instrument: "EUR_USD",
                side: "BUY",
                notionalAud: 100,
                stopRiskAud: 5,
            },
            config: permissiveConfig,
        });

        expect(result.passed).toBe(true);
        expect(result.referenceCurrency).toBe("AUD");
        expect(result.metrics.aggregateStopRiskPctNav).toBe(0.005);
    });

    test("allows the release-sized one-position notional inside the margin envelope", () => {
        const result = evaluatePortfolioRisk({
            navAud: 96.74,
            proposedTrade: {
                instrument: "USD_JPY",
                side: "BUY",
                notionalAud: 508.5,
                stopRiskAud: 0.19323,
            },
            config: cloneDefaultConfig(),
        });

        expect(result.passed).toBe(true);
        expect(result.metrics.largestNetCurrencyExposurePctNav).toBeLessThan(6);
    });

    test("fails closed when NAV, stop risk, or AUD notional is unavailable", () => {
        const result = evaluatePortfolioRisk({
            proposedTrade: { instrument: "EUR_USD", side: "BUY" },
        });

        expect(result.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "NAV_UNAVAILABLE" }),
                expect.objectContaining({ code: "STOP_RISK_UNAVAILABLE" }),
                expect.objectContaining({ code: "CURRENCY_EXPOSURE_UNAVAILABLE" }),
            ])
        );
    });

    test("blocks aggregate, currency, correlated, daily, drawdown, and loss-streak risk", () => {
        const result = evaluatePortfolioRisk({
            navAud: 1000,
            highWatermarkNavAud: 1100,
            dailyRealizedPnlAud: -25,
            lossStreakState: {
                cooldownActive: true,
                consecutiveLosses: 3,
                cooldownStartedAt: Date.now(),
                cooldownUntil: Date.now() + CONSECUTIVE_LOSS_COOLDOWN_MS,
                remainingMs: CONSECUTIVE_LOSS_COOLDOWN_MS,
            },
            openPositions: [
                {
                    instrument: "GBP_USD",
                    side: "BUY",
                    notionalAud: 300,
                    stopRiskAud: 12,
                },
            ],
            proposedTrade: {
                instrument: "EUR_USD",
                side: "BUY",
                notionalAud: 300,
                stopRiskAud: 12,
            },
            correlations: { "EUR_USD|GBP_USD": 0.85 },
            config: {
                ...permissiveConfig,
                maxAggregateStopRiskPctNav: 0.01,
                maxNetCurrencyExposurePctNav: 0.2,
                maxCorrelatedExposurePctNav: 0.4,
            },
        });

        expect(result.reasons.map((reason) => reason.code)).toEqual(
            expect.arrayContaining([
                "AGGREGATE_STOP_RISK",
                "NET_CURRENCY_EXPOSURE",
                "CORRELATED_EXPOSURE",
                "DAILY_LOSS_LIMIT",
                "DRAWDOWN_LIMIT",
                "CONSECUTIVE_LOSS_COOLDOWN",
            ])
        );
    });
});
