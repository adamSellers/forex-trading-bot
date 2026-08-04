const STRATEGY_AUDIT_VERSION = "2026-08-04";

const DEFAULT_QUALIFICATION = Object.freeze({
    status: "REQUIRES_PROMOTION",
    liveEligible: null,
    reasonCode: "PAPER_PROMOTION_GATE_REQUIRED",
    evaluatedAt: null,
    evidenceArtifact: null,
});

const QUALIFICATIONS = Object.freeze({
    supertrend_momentum: Object.freeze({
        status: "REJECTED",
        liveEligible: false,
        reasonCode: "FAILED_OUT_OF_SAMPLE_STRATEGY_AUDIT",
        evaluatedAt: STRATEGY_AUDIT_VERSION,
        evidenceArtifact: "AUDIT_AND_STRATEGY_OVERHAUL_2026-08-04.md",
    }),
});

function getStrategyLiveQualification(strategyKey) {
    return {
        ...DEFAULT_QUALIFICATION,
        ...(QUALIFICATIONS[strategyKey] || {}),
    };
}

module.exports = {
    STRATEGY_AUDIT_VERSION,
    getStrategyLiveQualification,
};
