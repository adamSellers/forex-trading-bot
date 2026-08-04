const {
    CANONICAL_STRATEGY_KEYS,
    getStrategyDefinition,
    isCanonicalStrategyKey,
    listStrategyCatalog,
    strategyRegistry,
} = require("../index");
const { createStrategyDefinition, createNoopResult } = require("../strategyContract");

describe("live strategy registry", () => {
    test("exposes carry_trend as the only runnable strategy", () => {
        expect(CANONICAL_STRATEGY_KEYS).toEqual(["carry_trend"]);
        expect(Object.keys(strategyRegistry)).toEqual(["carry_trend"]);
        expect(listStrategyCatalog()).toEqual([
            expect.objectContaining({
                key: "carry_trend",
                version: "1.0.0",
                runtimeStatus: "live_ready",
                metadata: expect.objectContaining({ supportsLive: true }),
            }),
        ]);
    });

    test("rejects every retired strategy key", () => {
        expect(isCanonicalStrategyKey("carry_trend")).toBe(true);
        expect(isCanonicalStrategyKey("supertrend_momentum")).toBe(false);
        expect(() => getStrategyDefinition("supertrend_momentum")).toThrow(
            "Unknown canonical strategy key"
        );
    });

    test("the contract accepts only the live strategy", () => {
        const definition = createStrategyDefinition({
            key: "carry_trend",
            label: "Carry Trend",
        });
        expect(definition.evaluateEntry()).toEqual(
            expect.objectContaining({ reasonCode: "STRATEGY_NOT_READY" })
        );
        expect(() =>
            createStrategyDefinition({ key: "squeeze_play", label: "Retired" })
        ).toThrow("Unknown canonical strategy key");
        expect(createNoopResult({ strategy: "carry_trend" }).metadata).toEqual({
            strategy: "carry_trend",
        });
    });
});
