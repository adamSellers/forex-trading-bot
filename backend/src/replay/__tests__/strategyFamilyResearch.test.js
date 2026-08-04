const createResearchStrategy = require("../strategyFamilyResearch");

describe("research strategy families", () => {
    test.each([
        "session_expansion",
        "medium_term_trend",
        "pullback_continuation",
        "mean_reversion",
        "cross_sectional_momentum",
    ])("creates a deterministic warmup decision for %s", async (family) => {
        const strategy = createResearchStrategy({ family, config: {} });
        const result = await strategy({
            instrument: "AUD_USD",
            timestamp: Date.parse("2026-08-03T00:00:00Z"),
            candle: { close: 0.65 },
            candles: [],
            histories: new Map(),
            position: null,
        });

        expect(result).toEqual(
            expect.objectContaining({
                signal: "HOLD",
                signalClass: "FILTERED",
                intent: "WAIT",
                reasonCode: expect.any(String),
            })
        );
    });

    test("rejects unknown families instead of silently using a fallback", () => {
        expect(() =>
            createResearchStrategy({ family: "curve_fit_special" })
        ).toThrow("Unknown research strategy family");
    });
});
