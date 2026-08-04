const { computeConfigHash } = require("../config/tradingConfig");
const { getStrategyDefinition } = require("../strategies");

const LIVE_RISK_LIMITS = Object.freeze({
    maxOpenPositions: 1,
    maxRiskPerTrade: 0.01,
    maxCapitalAtRisk: 100,
    maxPortfolioExposure: 0.3,
    maxAggregateStopRiskPctNav: 0.01,
    maxNetCurrencyExposurePctNav: 1,
    maxCorrelatedExposurePctNav: 1,
    maxDailyLossPctNav: 0.02,
    maxDrawdownPctNav: 0.1,
    maxConsecutiveLosses: 5,
});

function finite(value, fallback = Infinity) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getLiveRiskChecks(config = {}) {
    return [
        {
            key: "maxOpenPositions",
            actual: Math.floor(finite(config.maxOpenPositions)),
            max: LIVE_RISK_LIMITS.maxOpenPositions,
        },
        {
            key: "riskPerTrade",
            actual: finite(config.riskPerTrade),
            max: LIVE_RISK_LIMITS.maxRiskPerTrade,
        },
        ...[
            "maxCapitalAtRisk",
            "maxPortfolioExposure",
            "maxAggregateStopRiskPctNav",
            "maxNetCurrencyExposurePctNav",
            "maxCorrelatedExposurePctNav",
            "maxDailyLossPctNav",
            "maxDrawdownPctNav",
            "maxConsecutiveLosses",
        ].map((key) => ({
            key,
            actual: finite(config[key]),
            max: LIVE_RISK_LIMITS[key],
        })),
    ];
}

function getLiveRiskLimitViolations(config = {}) {
    return getLiveRiskChecks(config).filter(
        (check) =>
            !Number.isFinite(check.actual) ||
            check.actual <= 0 ||
            check.actual > check.max
    );
}

function evaluateLiveReadiness({ liveSelection = null, config = {} } = {}) {
    const reasons = [];
    const liveRun = liveSelection?.liveRun || null;
    let strategy = null;
    try {
        strategy = getStrategyDefinition(config.strategy);
    } catch (error) {
        reasons.push({
            code: "UNKNOWN_LIVE_STRATEGY",
            message: error.message,
        });
    }

    if (!liveRun) {
        reasons.push({
            code: "NO_ACTIVE_LIVE_RUNTIME",
            message: "The live strategy runtime is not active",
        });
    }
    if (strategy && strategy.metadata?.supportsLive !== true) {
        reasons.push({
            code: "STRATEGY_NOT_LIVE_READY",
            message: `${strategy.label} is not implemented for live execution`,
        });
    }
    if (liveRun && liveRun.strategy !== config.strategy) {
        reasons.push({
            code: "LIVE_STRATEGY_MISMATCH",
            message: "The active runtime strategy differs from the deployed config",
            active: liveRun.strategy,
            configured: config.strategy,
        });
    }

    const currentConfigHash = computeConfigHash(config);
    if (liveRun?.configHash && liveRun.configHash !== currentConfigHash) {
        reasons.push({
            code: "LIVE_CONFIG_MISMATCH",
            message: "The active runtime has not loaded the deployed strategy config",
            active: liveRun.configHash,
            configured: currentConfigHash,
        });
    }
    if (
        config.referenceCurrency !== "AUD" ||
        config.accountCurrency !== "AUD"
    ) {
        reasons.push({
            code: "ACCOUNT_CURRENCY_MISMATCH",
            message: "Account and risk calculations must use AUD",
        });
    }
    if (config.portfolioRiskEnforcement !== true) {
        reasons.push({
            code: "PORTFOLIO_RISK_DISABLED",
            message: "Portfolio risk enforcement is disabled",
        });
    }
    getLiveRiskLimitViolations(config).forEach((check) => {
        reasons.push({
            code: "LIVE_RISK_LIMIT",
            key: check.key,
            actual: Number.isFinite(check.actual) ? check.actual : null,
            max: check.max,
            message: `${check.key} exceeds the deployed live risk ceiling`,
        });
    });

    return {
        passed: reasons.length === 0,
        status: reasons.length === 0 ? "PASS" : "FAIL",
        strategy: config.strategy || null,
        strategyVersion: strategy?.version || null,
        liveRunId: liveRun?.runId || null,
        selectionId: liveSelection?.selectionId || null,
        currentConfigHash,
        riskLimits: LIVE_RISK_LIMITS,
        riskChecks: getLiveRiskChecks(config),
        reasons,
    };
}

module.exports = {
    LIVE_RISK_LIMITS,
    evaluateLiveReadiness,
    getLiveRiskChecks,
    getLiveRiskLimitViolations,
};
