const CANDIDATE_PRESETS = Object.freeze({
    phase2_room_to_run: Object.freeze({
        key: "phase2_room_to_run",
        label: "Phase 2 Room To Run",
        description:
            "Long-only, London/New York candidate that removes the weakest live cohorts and gives winners more room before protective stops tighten.",
        config: Object.freeze({
            enableShorting: false,
            enableShortContinuationEntry: false,
            enableSessionFilter: true,
            activeSessions: ["london", "newyork"],
            assets: ["EUR_USD", "GBP_USD", "USD_JPY"],
            timeStopHours: 0,
            enableBreakeven: true,
            breakevenTriggerRiskMultiple: 1.0,
            trailingStopActivationRiskMultiple: 1.5,
            trailingStopRiskMultiple: 1.0,
            timesFmStrategyRiskReward: 3.0,
        }),
    }),
});

function listCandidatePresets() {
    return Object.values(CANDIDATE_PRESETS).map((preset) => ({
        key: preset.key,
        label: preset.label,
        description: preset.description,
        config: { ...preset.config },
    }));
}

function getCandidatePreset(presetKey) {
    if (!presetKey) return null;
    return CANDIDATE_PRESETS[presetKey] || null;
}

function applyCandidatePreset(config = {}, presetKey = null) {
    const preset = getCandidatePreset(presetKey);
    if (!preset) {
        return {
            config: { ...config },
            preset: null,
        };
    }

    return {
        config: {
            ...config,
            ...preset.config,
            strategy: config.strategy,
        },
        preset,
    };
}

module.exports = {
    CANDIDATE_PRESETS,
    listCandidatePresets,
    getCandidatePreset,
    applyCandidatePreset,
};
