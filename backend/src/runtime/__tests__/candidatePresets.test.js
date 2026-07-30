const {
    CANDIDATE_PRESETS,
    getCandidatePreset,
    applyCandidatePreset,
    listCandidatePresets,
} = require("../candidatePresets");

// Returns the keys whose values differ between two configs.
function diffKeys(a, b) {
    return Object.keys({ ...a, ...b })
        .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
        .sort();
}

describe("candidate presets", () => {
    test("getCandidatePreset returns null for unknown keys", () => {
        expect(getCandidatePreset("nope")).toBeNull();
        expect(getCandidatePreset(null)).toBeNull();
    });

    test("applyCandidatePreset preserves the strategy and overlays preset config", () => {
        const { config, preset } = applyCandidatePreset(
            { strategy: "supertrend_momentum", enableShorting: false },
            "lab_shorts"
        );

        expect(preset.key).toBe("lab_shorts");
        expect(config.strategy).toBe("supertrend_momentum");
        expect(config.enableShorting).toBe(true);
    });

    test("applyCandidatePreset is a passthrough when no preset is named", () => {
        const base = { strategy: "supertrend_momentum", minAdx: 21 };
        const { config, preset } = applyCandidatePreset(base, null);

        expect(preset).toBeNull();
        expect(config).toEqual(base);
    });

    test("every preset is listed with a key, label and description", () => {
        const listed = listCandidatePresets();
        expect(listed.length).toBe(Object.keys(CANDIDATE_PRESETS).length);
        listed.forEach((preset) => {
            expect(preset.key).toBeTruthy();
            expect(preset.label).toBeTruthy();
            expect(preset.description).toBeTruthy();
        });
    });
});

// The lab arms are only interpretable if each one differs from the control by
// exactly the variable it claims to test. If a future edit widens an arm, the
// experiment silently stops attributing cause and these tests should fail.
describe("2026-07-30 entry-drought lab arms", () => {
    const control = CANDIDATE_PRESETS.lab_control.config;

    test("control restates the live entry logic that produced zero entries", () => {
        expect(control.enableShorting).toBe(false);
        expect(control.enableFreshFlipEntries).toBe(false);
        expect(control.enableHTFFilter).toBe(true);
        expect(control.maxSpreadPips).toBe(1.2);
    });

    test("all arms share one capacity profile so slot contention cannot confound", () => {
        const arms = [
            "lab_control",
            "lab_shorts",
            "lab_no_htf",
            "lab_fresh_flips",
            "lab_tradeable_spread",
            "lab_unconstrained",
        ];

        arms.forEach((key) => {
            const { config } = CANDIDATE_PRESETS[key];
            expect(config.maxOpenPositions).toBe(control.maxOpenPositions);
            expect(config.riskPerTrade).toBe(control.riskPerTrade);
            expect(config.maxCapitalAtRisk).toBe(control.maxCapitalAtRisk);
            expect(config.maxPortfolioExposure).toBe(control.maxPortfolioExposure);
        });
    });

    test.each([
        ["lab_shorts", ["enableShorting", "enableShortContinuationEntry"]],
        ["lab_no_htf", ["enableHTFFilter"]],
        ["lab_fresh_flips", ["enableFreshFlipEntries"]],
        ["lab_tradeable_spread", ["maxSpreadPips"]],
    ])("%s isolates exactly one variable against the control", (key, expectedKeys) => {
        const armConfig = CANDIDATE_PRESETS[key].config;
        expect(diffKeys(control, armConfig)).toEqual([...expectedKeys].sort());
    });

    test("the combined arm relaxes every tested gate at once", () => {
        const combined = CANDIDATE_PRESETS.lab_unconstrained.config;

        expect(combined.enableShorting).toBe(true);
        expect(combined.enableFreshFlipEntries).toBe(true);
        expect(combined.enableHTFFilter).toBe(false);
        expect(combined.maxSpreadPips).toBe(3.0);
        // Wider continuation window than control on both edges.
        expect(combined.continuationPullbackMinAtr).toBeLessThan(
            control.continuationPullbackMinAtr
        );
        expect(combined.continuationPullbackMaxAtr).toBeGreaterThan(
            control.continuationPullbackMaxAtr
        );
    });

    // The UI's batch launch selects arms by group, so every arm must carry it
    // and unrelated presets must not be swept into the experiment.
    test("all six arms share one group and phase2 is excluded", () => {
        const listed = listCandidatePresets();
        const grouped = listed.filter((preset) => preset.group?.key);

        expect(grouped).toHaveLength(6);
        expect(new Set(grouped.map((preset) => preset.group.key)).size).toBe(1);
        expect(
            listed.find((preset) => preset.key === "phase2_room_to_run").group
        ).toBeNull();
    });

    test("no lab arm enables live trading", () => {
        Object.values(CANDIDATE_PRESETS).forEach((preset) => {
            expect(preset.config.enableTrading).toBeUndefined();
        });
    });
});
