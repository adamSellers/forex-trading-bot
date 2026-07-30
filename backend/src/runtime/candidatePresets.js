// Paper-lab capacity shared by every 2026-07-30 experiment arm.
//
// Candidates inherit the ACTIVE LIVE config as their base, which currently
// carries the Phase 4 controlled-live caps (maxOpenPositions:1, riskPerTrade
// 0.005, maxCapitalAtRisk 50 AUD sized to a ~A$96 live account). Those caps are
// correct for live but ruinous for an experiment: with 4 pairs and a single slot
// you cannot tell "the strategy found nothing" apart from "the strategy found
// something but had nowhere to put it". Every arm therefore shares one generous
// capacity profile so the ONLY thing that differs between arms is the entry gate
// under test. Paper-only: these values never reach the live engine.
const LAB_CAPACITY = Object.freeze({
    maxOpenPositions: 4, // one slot per traded pair
    riskPerTrade: 0.01,
    maxCapitalAtRisk: 5000, // paper starts at 10,000 AUD
    maxPortfolioExposure: 0.5,
    timeStopHours: 0, // match live: no time stop
});

// The live baseline's entry logic, restated explicitly so each arm's diff is
// readable rather than inherited-and-implied. This is the CONTROL: measured over
// 2026-07-23..30 it produced 36 fresh flips and zero entries.
const LAB_BASELINE_ENTRY = Object.freeze({
    enableShorting: false,
    enableShortContinuationEntry: false,
    enableFreshFlipEntries: false,
    enableContinuationEntry: true,
    enableLongContinuationEntry: true,
    enableHTFFilter: true,
    htfTimeframe: "1h",
    maxSpreadPips: 1.2,
    continuationPullbackMinAtr: 0.5,
    continuationPullbackMaxAtr: 1.5,
    continuationMaxChaseAtr: 0.75,
    // Stated explicitly (they match live) so the ADX arms below read as a clean
    // one-key diff rather than an invisible inherited default.
    enableAdxFilter: true,
    minAdx: 21,
    adxSlopeFilter: true,
    requireDirectionalAdx: true,
});

function labArm(overrides) {
    return Object.freeze({ ...LAB_CAPACITY, ...LAB_BASELINE_ENTRY, ...overrides });
}

// Arms belonging to one comparable experiment. The UI uses this to offer a
// batch launch, so a six-arm study does not depend on hand-run CLI loops.
const LAB_GROUP = Object.freeze({
    key: "entry_drought_lab_2026_07_30",
    label: "Entry Drought Lab (2026-07-30)",
});

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

    // ---- 2026-07-30 entry-drought experiment ----
    // Diagnosis: live emitted ZERO BUY signals in 7 days. 36 fresh flips
    // produced 0 entries. Each arm below targets one measured leak so the
    // resulting expectancy is attributable. Promotion still has to clear the
    // Phase 3 gate, so nothing here can reach live on its own.

    lab_control: Object.freeze({
        key: "lab_control",
        label: "Lab Control (live entry logic)",
        group: LAB_GROUP,
        description:
            "Control arm: the exact live entry logic with lab capacity. Every other arm is read as a diff against this one, so a shared baseline is required to attribute any change in trade rate or expectancy.",
        config: labArm({}),
    }),

    lab_shorts: Object.freeze({
        key: "lab_shorts",
        label: "Lab A: shorts enabled",
        group: LAB_GROUP,
        description:
            "Largest measured leak: 26 of 36 fresh flips (72%) were SHORT and discarded untested while the market was near-perfectly two-sided (H1 53% up / 47% down). Tests whether the long-only rule is protecting the account or starving it.",
        config: labArm({
            enableShorting: true,
            enableShortContinuationEntry: true,
        }),
    }),

    lab_no_htf: Object.freeze({
        key: "lab_no_htf",
        label: "Lab B: HTF veto removed",
        group: LAB_GROUP,
        description:
            "Second largest leak: the H1 trend veto blocked 10 long setups outright and another 7 decayed to MOMENTUM_FADED while waiting for confirmation. Tests whether the HTF gate adds edge or merely adds latency.",
        config: labArm({ enableHTFFilter: false }),
    }),

    lab_fresh_flips: Object.freeze({
        key: "lab_fresh_flips",
        label: "Lab C: fresh-flip entries enabled",
        group: LAB_GROUP,
        description:
            "Structural leak: with fresh-flip entries disabled, every setup must survive a multi-stage HTF-confirmation or pullback sequence, and this week nothing did. Tests entering on the qualified flip itself.",
        config: labArm({ enableFreshFlipEntries: true }),
    }),

    lab_tradeable_spread: Object.freeze({
        key: "lab_tradeable_spread",
        label: "Lab D: realistic spread ceiling",
        group: LAB_GROUP,
        description:
            "maxSpreadPips 1.2 acts as an undeclared pair exclusion: GBP_USD averaged 4.46 pips in London/NY and passed only 5.5% of samples. Raised to 3.0 so spread-driven rejections stop masquerading as absent signals. Paper prices bid/ask, so the wider cost is still charged.",
        config: labArm({ maxSpreadPips: 3.0 }),
    }),

    // Added 2026-07-31 after the first 17h of lab data showed EVERY arm dying at
    // the same upstream gate: all six logged an identical LONG_FRESH_FLIP_BLOCKED_ADX
    // count, meaning the variables under test sit downstream of ADX and could
    // never discriminate. Measured over 207 flips in 30 days: 52% of flips occur
    // with ADX < 21, and the share with ADX RISING collapses from 64% (ADX<15) to
    // 12% (ADX>=25) — high ADX at a flip mostly means the prior trend is exhausting.
    // The live gate (ADX >= 21 AND rising) admits 6.3% of flips and discards 58 of
    // the 71 flips where momentum was genuinely building.
    lab_early_momentum: Object.freeze({
        key: "lab_early_momentum",
        label: "Lab F: early momentum (ADX floor 12, still rising)",
        group: LAB_GROUP,
        description:
            "Keeps the requirement that ADX is RISING but drops the floor from 21 to 12, targeting the 82% of building-momentum flips the live gate rejects for being early. Tests the 'we always enter late' hypothesis directly: momentum must be building, but need not already be mature.",
        config: labArm({ minAdx: 12 }),
    }),

    lab_adx_off: Object.freeze({
        key: "lab_adx_off",
        label: "Lab G: ADX stack disabled",
        group: LAB_GROUP,
        description:
            "Disables the whole ADX stack (floor, rising-slope and directional +DI/-DI checks all short-circuit on this one flag). Separates 'the floor is set wrong' from 'a double-smoothed lagging strength index should not gate entry timing at all'.",
        config: labArm({ enableAdxFilter: false }),
    }),

    lab_unconstrained: Object.freeze({
        key: "lab_unconstrained",
        label: "Lab E: all relaxations combined",
        group: LAB_GROUP,
        description:
            "Upper bound on trade frequency with every relaxation at once, plus a wider continuation window. Not a promotion candidate — it establishes how much opportunity exists at all, so the single-variable arms can be judged against a known ceiling.",
        config: labArm({
            enableShorting: true,
            enableShortContinuationEntry: true,
            enableHTFFilter: false,
            enableFreshFlipEntries: true,
            maxSpreadPips: 3.0,
            continuationPullbackMinAtr: 0.3,
            continuationPullbackMaxAtr: 2.5,
            continuationMaxChaseAtr: 1.25,
            // Without this the "ceiling" is still ADX-bound and under-reports
            // available opportunity — the 17h sample showed ADX killing setups
            // upstream of every other relaxation in this arm.
            enableAdxFilter: false,
        }),
    }),
});

function listCandidatePresets() {
    return Object.values(CANDIDATE_PRESETS).map((preset) => ({
        key: preset.key,
        label: preset.label,
        description: preset.description,
        group: preset.group || null,
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
    LAB_GROUP,
    LAB_CAPACITY,
    LAB_BASELINE_ENTRY,
    listCandidatePresets,
    getCandidatePreset,
    applyCandidatePreset,
};
