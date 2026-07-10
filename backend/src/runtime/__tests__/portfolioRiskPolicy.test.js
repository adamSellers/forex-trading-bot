const { evaluatePortfolioRisk } = require("../portfolioRiskPolicy");

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
            consecutiveLosses: 3,
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
                "CONSECUTIVE_LOSS_LIMIT",
            ])
        );
    });
});
