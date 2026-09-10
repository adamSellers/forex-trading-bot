const {
    CANONICAL_STRATEGY_KEYS,
    getStrategyDefinition,
    isCanonicalStrategyKey,
    listStrategyCatalog,
    strategyRegistry,
} = require("../index");
const { createStrategyDefinition, createNoopResult } = require("../strategyContract");

describe("live strategy registry", () => {
    test("exposes intraday_momentum as the only runnable strategy", () => {
        expect(CANONICAL_STRATEGY_KEYS).toEqual(["intraday_momentum"]);
        expect(Object.keys(strategyRegistry)).toEqual(["intraday_momentum"]);
        expect(listStrategyCatalog()).toEqual([
            expect.objectContaining({
                key: "intraday_momentum",
                version: "1.1.2",
                runtimeStatus: "live_ready",
                metadata: expect.objectContaining({ supportsLive: true }),
            }),
        ]);
    });

    test("rejects every retired strategy key", () => {
        expect(isCanonicalStrategyKey("intraday_momentum")).toBe(true);
        expect(isCanonicalStrategyKey("carry_trend")).toBe(false);
        expect(isCanonicalStrategyKey("supertrend_momentum")).toBe(false);
        expect(() => getStrategyDefinition("supertrend_momentum")).toThrow(
            "Unknown canonical strategy key"
        );
    });

    test("the contract accepts only the live strategy", () => {
        const definition = createStrategyDefinition({
            key: "intraday_momentum",
            label: "M15 Intraday Momentum",
        });
        expect(definition.evaluateEntry()).toEqual(
            expect.objectContaining({ reasonCode: "STRATEGY_NOT_READY" })
        );
        expect(() =>
            createStrategyDefinition({ key: "squeeze_play", label: "Retired" })
        ).toThrow("Unknown canonical strategy key");
        expect(createNoopResult({ strategy: "intraday_momentum" }).metadata).toEqual({
            strategy: "intraday_momentum",
        });
    });
});
