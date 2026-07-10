const { computeConfigHash } = require("../config/tradingConfig");

const CONTROLLED_LIVE_RISK_LIMITS = Object.freeze({
    maxOpenPositions: 1,
    maxRiskPerTrade: 0.005,
    maxCapitalAtRisk: 50,
    maxPortfolioExposure: 0.1,
    maxAggregateStopRiskPctNav: 0.01,
    maxNetCurrencyExposurePctNav: 2,
    maxCorrelatedExposurePctNav: 2,
    maxDailyLossPctNav: 0.02,
    maxDrawdownPctNav: 0.08,
    maxConsecutiveLosses: 3,
});

const CONTROLLED_BASELINE_STRATEGY = "supertrend_momentum";
const CONTROLLED_BASELINE_ACTIVATION_BASIS =
    "explicit_user_baseline_resume";
const CONTROLLED_BASELINE_CONFIRMATION = "RESUME_CONTROLLED_BASELINE";

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
        maxAggregateStopRiskPctNav: capPositiveNumber(
            config.maxAggregateStopRiskPctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxAggregateStopRiskPctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxAggregateStopRiskPctNav
        ),
        maxNetCurrencyExposurePctNav: capPositiveNumber(
            config.maxNetCurrencyExposurePctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxNetCurrencyExposurePctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxNetCurrencyExposurePctNav
        ),
        maxCorrelatedExposurePctNav: capPositiveNumber(
            config.maxCorrelatedExposurePctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxCorrelatedExposurePctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxCorrelatedExposurePctNav
        ),
        maxDailyLossPctNav: capPositiveNumber(
            config.maxDailyLossPctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxDailyLossPctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxDailyLossPctNav
        ),
        maxDrawdownPctNav: capPositiveNumber(
            config.maxDrawdownPctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxDrawdownPctNav,
            CONTROLLED_LIVE_RISK_LIMITS.maxDrawdownPctNav
        ),
        maxConsecutiveLosses: Math.max(
            1,
            Math.floor(
                capPositiveNumber(
                    config.maxConsecutiveLosses,
                    CONTROLLED_LIVE_RISK_LIMITS.maxConsecutiveLosses,
                    CONTROLLED_LIVE_RISK_LIMITS.maxConsecutiveLosses
                )
            )
        ),
        portfolioRiskEnforcement: true,
        referenceCurrency: "AUD",
        accountCurrency: "AUD",
        liveActivationPhase: "phase4_controlled",
    };
}

function getControlledRiskChecks(config = {}) {
    return [
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
            actual: toFiniteNumber(config[key], Infinity),
            max: CONTROLLED_LIVE_RISK_LIMITS[key],
        })),
    ];
}

function getControlledRiskLimitViolations(config = {}) {
    return getControlledRiskChecks(config).filter(
        (check) =>
            !Number.isFinite(check.actual) ||
            check.actual <= 0 ||
            check.actual > check.max
    );
}

function getPromotionGate(liveSelection = {}) {
    return (
        liveSelection?.liveRun?.metadata?.promotionGate ||
        liveSelection?.liveRun?.metadata?.phase4ControlledLive?.promotionGate ||
        null
    );
}

function evaluateControlledBaselineResumeEligibility({
    liveSelection = null,
    config = {},
} = {}) {
    const reasons = [];
    const liveRun = liveSelection?.liveRun || null;
    const promotionGate = getPromotionGate(liveSelection);

    if (!liveRun) {
        reasons.push({
            code: "NO_ACTIVE_LIVE_SELECTION",
            message: "No active live selection is available to migrate",
        });
    }

    const strategy = liveRun?.strategy || liveSelection?.strategy || null;
    const hasCanonicalStrategyIdentity =
        liveRun?.strategy === CONTROLLED_BASELINE_STRATEGY &&
        (!liveSelection?.strategy ||
            liveSelection.strategy === liveRun.strategy);
    if (liveRun && !hasCanonicalStrategyIdentity) {
        reasons.push({
            code: "CONTROLLED_BASELINE_STRATEGY_REQUIRED",
            message: `Only the canonical ${CONTROLLED_BASELINE_STRATEGY} live baseline can use explicit baseline resume`,
        });
    }

    if (
        liveRun?.metadata?.promotedFromRunId ||
        promotionGate?.passed === true
    ) {
        reasons.push({
            code: "PROMOTED_SELECTION_NOT_ELIGIBLE",
            message: "Candidate-promoted selections must use the normal controlled live activation path",
        });
    }

    if (liveRun?.metadata?.activationBasis) {
        reasons.push({
            code: "LIVE_SELECTION_ALREADY_MIGRATED",
            message: "The active live selection already has an explicit activation basis",
        });
    }

    if (config.enableTrading === true) {
        reasons.push({
            code: "TRADING_MUST_BE_PAUSED",
            message: "Pause live entries before migrating the legacy baseline",
        });
    }

    return {
        eligible: reasons.length === 0,
        code:
            reasons.length === 0
                ? "CONTROLLED_BASELINE_RESUME_AVAILABLE"
                : "CONTROLLED_BASELINE_RESUME_UNAVAILABLE",
        requiresExplicitConfirmation: true,
        requiredConfirmation: CONTROLLED_BASELINE_CONFIRMATION,
        requiresFlatPreflight: true,
        strategy: strategy || null,
        predecessorLiveRunId: liveRun?.runId || null,
        predecessorShadowRunId: liveSelection?.shadowRun?.runId || null,
        reasons,
    };
}

function hasValidBaselineResumeEvidence(liveSelection = {}) {
    const liveRun = liveSelection?.liveRun || null;
    const metadata = liveRun?.metadata || {};
    const controlledMetadata = metadata.phase4ControlledLive || null;
    const evidence = metadata.controlledBaselineResume || null;
    const strategy = liveRun?.strategy || null;

    return (
        metadata.activationBasis === CONTROLLED_BASELINE_ACTIVATION_BASIS &&
        strategy === CONTROLLED_BASELINE_STRATEGY &&
        (!liveSelection?.strategy || liveSelection.strategy === strategy) &&
        evidence?.confirmed === true &&
        Number.isFinite(Number(evidence.confirmedAt)) &&
        Number(evidence.confirmedAt) > 0 &&
        Boolean(liveRun?.parentRunId) &&
        evidence.predecessorLiveRunId === liveRun.parentRunId &&
        controlledMetadata?.activationBasis ===
            CONTROLLED_BASELINE_ACTIVATION_BASIS &&
        controlledMetadata?.predecessorLiveRunId === liveRun.parentRunId &&
        !metadata.promotedFromRunId &&
        !metadata.promotionGate
    );
}

function evaluateControlledLiveReadiness({ liveSelection = null, config = {} } = {}) {
    const reasons = [];
    const promotionGate = getPromotionGate(liveSelection);
    const liveRun = liveSelection?.liveRun || null;
    const controlledMetadata = liveRun?.metadata?.phase4ControlledLive || null;
    const riskChecks = getControlledRiskChecks(config);
    const currentConfigHash = computeConfigHash(config);
    const requestedActivationBasis = liveRun?.metadata?.activationBasis || null;
    const baselineResumeEvidenceValid =
        requestedActivationBasis === CONTROLLED_BASELINE_ACTIVATION_BASIS &&
        hasValidBaselineResumeEvidence(liveSelection);
    const promotionEvidenceValid =
        promotionGate?.passed === true &&
        promotionGate?.gateVersion === 2 &&
        Boolean(liveRun?.metadata?.promotedFromRunId);
    const activationBasis = baselineResumeEvidenceValid
        ? CONTROLLED_BASELINE_ACTIVATION_BASIS
        : promotionEvidenceValid
          ? "candidate_promotion"
          : requestedActivationBasis;

    if (!liveSelection?.liveRun) {
        reasons.push({
            code: "NO_ACTIVE_LIVE_SELECTION",
            message: "No active live selection is available for controlled activation",
        });
    }

    if (!baselineResumeEvidenceValid) {
        if (requestedActivationBasis === CONTROLLED_BASELINE_ACTIVATION_BASIS) {
            reasons.push({
                code: "BASELINE_RESUME_EVIDENCE_INVALID",
                message: "Explicit baseline resume evidence or immutable predecessor lineage is invalid",
            });
        } else {
            if (promotionGate?.passed !== true || promotionGate?.gateVersion !== 2) {
                reasons.push({
                    code: "PROMOTION_GATE_NOT_PASSED",
                    message: "Live entries require a candidate promotion with a passing realistic-paper gate",
                });
            }

            if (!liveRun?.metadata?.promotedFromRunId) {
                reasons.push({
                    code: "PROMOTION_PATH_REQUIRED",
                    message: "The active live run was not created by the candidate promotion path",
                });
            }
        }
    }

    if (
        !controlledMetadata?.liveConfigHash ||
        controlledMetadata.liveConfigHash !== liveRun?.configHash
    ) {
        reasons.push({
            code: "LIVE_CONFIG_IDENTITY_MISMATCH",
            message: "Controlled-live metadata does not match the immutable live run configuration",
        });
    }

    if (liveRun?.configHash && currentConfigHash !== liveRun.configHash) {
        reasons.push({
            code: "ACTIVE_CONFIG_MISMATCH",
            message: "The current canonical configuration differs from the promoted live run",
            actualConfigHash: currentConfigHash,
            requiredConfigHash: liveRun.configHash,
        });
    }

    if (
        !baselineResumeEvidenceValid &&
        promotionGate?.configHash &&
        controlledMetadata?.sourceConfigHash !== promotionGate.configHash
    ) {
        reasons.push({
            code: "PROMOTION_SOURCE_IDENTITY_MISMATCH",
            message: "Promotion evidence does not match the candidate configuration",
        });
    }

    if (
        config.referenceCurrency !== "AUD" ||
        (config.accountCurrency && config.accountCurrency !== "AUD")
    ) {
        reasons.push({
            code: "REFERENCE_CURRENCY_MISMATCH",
            message: "Live risk controls require AUD account and reference currency",
        });
    }

    if (config.portfolioRiskEnforcement !== true) {
        reasons.push({
            code: "PORTFOLIO_RISK_ENFORCEMENT_DISABLED",
            message: "NAV-aware portfolio risk enforcement must be enabled",
        });
    }

    riskChecks.forEach((check) => {
        if (
            !Number.isFinite(check.actual) ||
            check.actual <= 0 ||
            check.actual > check.max
        ) {
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
        strategy: liveSelection?.liveRun?.strategy || liveSelection?.strategy || null,
        activationBasis,
        currentConfigHash,
        requirements: {
            activationBasis: [
                "candidate_promotion",
                CONTROLLED_BASELINE_ACTIVATION_BASIS,
            ],
            promotionGate: baselineResumeEvidenceValid
                ? "NOT_APPLICABLE"
                : "PASS",
            riskLimits: CONTROLLED_LIVE_RISK_LIMITS,
        },
        activationOptions: {
            controlledBaselineResume:
                evaluateControlledBaselineResumeEligibility({
                    liveSelection,
                    config,
                }),
        },
        promotionGate,
        risk: {
            maxOpenPositions: toFiniteNumber(config.maxOpenPositions, null),
            riskPerTrade: toFiniteNumber(config.riskPerTrade, null),
            maxCapitalAtRisk: toFiniteNumber(config.maxCapitalAtRisk, null),
            maxPortfolioExposure: toFiniteNumber(config.maxPortfolioExposure, null),
            maxAggregateStopRiskPctNav: toFiniteNumber(
                config.maxAggregateStopRiskPctNav,
                null
            ),
            maxNetCurrencyExposurePctNav: toFiniteNumber(
                config.maxNetCurrencyExposurePctNav,
                null
            ),
            maxCorrelatedExposurePctNav: toFiniteNumber(
                config.maxCorrelatedExposurePctNav,
                null
            ),
            maxDailyLossPctNav: toFiniteNumber(config.maxDailyLossPctNav, null),
            maxDrawdownPctNav: toFiniteNumber(config.maxDrawdownPctNav, null),
            maxConsecutiveLosses: toFiniteNumber(
                config.maxConsecutiveLosses,
                null
            ),
        },
        reasons,
    };
}

module.exports = {
    CONTROLLED_BASELINE_ACTIVATION_BASIS,
    CONTROLLED_BASELINE_CONFIRMATION,
    CONTROLLED_BASELINE_STRATEGY,
    CONTROLLED_LIVE_RISK_LIMITS,
    applyControlledLiveConfig,
    evaluateControlledBaselineResumeEligibility,
    evaluateControlledLiveReadiness,
    getControlledRiskChecks,
    getControlledRiskLimitViolations,
};
