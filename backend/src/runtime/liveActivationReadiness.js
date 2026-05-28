const CONTROLLED_LIVE_RISK_LIMITS = Object.freeze({
    maxOpenPositions: 1,
    maxRiskPerTrade: 0.005,
    maxCapitalAtRisk: 50,
    maxPortfolioExposure: 0.1,
});

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function capPositiveNumber(value, max, fallback) {
    const parsed = toFiniteNumber(value, fallback);
    const safeValue = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    return Math.min(safeValue, max);
}

function applyControlledLiveConfig(config = {}) {
    return {
        ...config,
        enableTrading: false,
        maxOpenPositions: Math.max(
            1,
            Math.floor(
                capPositiveNumber(
                    config.maxOpenPositions,
                    CONTROLLED_LIVE_RISK_LIMITS.maxOpenPositions,
                    CONTROLLED_LIVE_RISK_LIMITS.maxOpenPositions
                )
            )
        ),
        riskPerTrade: capPositiveNumber(
            config.riskPerTrade,
            CONTROLLED_LIVE_RISK_LIMITS.maxRiskPerTrade,
            CONTROLLED_LIVE_RISK_LIMITS.maxRiskPerTrade
        ),
        maxCapitalAtRisk: capPositiveNumber(
            config.maxCapitalAtRisk,
            CONTROLLED_LIVE_RISK_LIMITS.maxCapitalAtRisk,
            CONTROLLED_LIVE_RISK_LIMITS.maxCapitalAtRisk
        ),
        maxPortfolioExposure: capPositiveNumber(
            config.maxPortfolioExposure,
            CONTROLLED_LIVE_RISK_LIMITS.maxPortfolioExposure,
            CONTROLLED_LIVE_RISK_LIMITS.maxPortfolioExposure
        ),
        liveActivationPhase: "phase4_controlled",
    };
}

function getPromotionGate(liveSelection = {}) {
    return (
        liveSelection?.liveRun?.metadata?.promotionGate ||
        liveSelection?.liveRun?.metadata?.phase4ControlledLive?.promotionGate ||
        null
    );
}

function evaluateControlledLiveReadiness({ liveSelection = null, config = {} } = {}) {
    const reasons = [];
    const promotionGate = getPromotionGate(liveSelection);
    const riskChecks = [
        {
            key: "maxOpenPositions",
            actual: Math.floor(toFiniteNumber(config.maxOpenPositions, Infinity)),
            max: CONTROLLED_LIVE_RISK_LIMITS.maxOpenPositions,
        },
        {
            key: "riskPerTrade",
            actual: toFiniteNumber(config.riskPerTrade, Infinity),
            max: CONTROLLED_LIVE_RISK_LIMITS.maxRiskPerTrade,
        },
        {
            key: "maxCapitalAtRisk",
            actual: toFiniteNumber(config.maxCapitalAtRisk, Infinity),
            max: CONTROLLED_LIVE_RISK_LIMITS.maxCapitalAtRisk,
        },
        {
            key: "maxPortfolioExposure",
            actual: toFiniteNumber(config.maxPortfolioExposure, Infinity),
            max: CONTROLLED_LIVE_RISK_LIMITS.maxPortfolioExposure,
        },
    ];

    if (!liveSelection?.liveRun) {
        reasons.push({
            code: "NO_ACTIVE_LIVE_SELECTION",
            message: "No active live selection is available for controlled activation",
        });
    }

    if (promotionGate?.passed !== true) {
        reasons.push({
            code: "PROMOTION_GATE_NOT_PASSED",
            message: "Live entries require a candidate promotion with a passing realistic-paper gate",
        });
    }

    riskChecks.forEach((check) => {
        if (!Number.isFinite(check.actual) || check.actual > check.max) {
            reasons.push({
                code: "CONTROLLED_RISK_LIMIT",
                message: `${check.key} exceeds the controlled live limit`,
                key: check.key,
                actual: Number.isFinite(check.actual) ? check.actual : null,
                max: check.max,
            });
        }
    });

    return {
        passed: reasons.length === 0,
        status: reasons.length === 0 ? "PASS" : "FAIL",
        selectionId: liveSelection?.selectionId || null,
        liveRunId: liveSelection?.liveRun?.runId || null,
        strategy: liveSelection?.strategy || liveSelection?.liveRun?.strategy || null,
        requirements: {
            promotionGate: "PASS",
            riskLimits: CONTROLLED_LIVE_RISK_LIMITS,
        },
        promotionGate,
        risk: {
            maxOpenPositions: toFiniteNumber(config.maxOpenPositions, null),
            riskPerTrade: toFiniteNumber(config.riskPerTrade, null),
            maxCapitalAtRisk: toFiniteNumber(config.maxCapitalAtRisk, null),
            maxPortfolioExposure: toFiniteNumber(config.maxPortfolioExposure, null),
        },
        reasons,
    };
}

module.exports = {
    CONTROLLED_LIVE_RISK_LIMITS,
    applyControlledLiveConfig,
    evaluateControlledLiveReadiness,
};
