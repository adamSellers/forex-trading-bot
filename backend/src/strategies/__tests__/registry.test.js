const {
    CANONICAL_STRATEGY_KEYS,
    getStrategyDefinition,
    isCanonicalStrategyKey,
    listStrategyCatalog,
    strategyRegistry,
} = require("../index");
const {
    createStrategyDefinition,
    createNoopResult,
} = require("../strategyContract");

describe("strategy registry", () => {
    test("includes all canonical strategy keys", () => {
        expect(CANONICAL_STRATEGY_KEYS).toEqual([
            "supertrend_momentum",
            "mean_reversion",
            "range_breakout",
            "stochastic_divergence",
            "squeeze_play",
            "timesfm_directional",
        ]);

        expect(Object.keys(strategyRegistry)).toEqual(CANONICAL_STRATEGY_KEYS);
    });

    test("returns canonical catalog metadata in locked order", () => {
        const catalog = listStrategyCatalog();

        expect(catalog).toHaveLength(6);
        expect(catalog.map((strategy) => strategy.key)).toEqual(
            CANONICAL_STRATEGY_KEYS
        );
        expect(catalog[0]).toEqual(
            expect.objectContaining({
                key: "supertrend_momentum",
                runtimeStatus: "baseline",
            })
        );
    });

    test("exposes canonical lookup helpers", () => {
        expect(isCanonicalStrategyKey("supertrend_momentum")).toBe(true);
        expect(isCanonicalStrategyKey("balanced")).toBe(false);
        expect(getStrategyDefinition("mean_reversion")).toEqual(
            expect.objectContaining({
                key: "mean_reversion",
                label: "Mean Reversion",
            })
        );
        expect(getStrategyDefinition("stochastic_divergence")).toEqual(
            expect.objectContaining({
                key: "stochastic_divergence",
                runtimeStatus: "candidate",
            })
        );
        expect(getStrategyDefinition("squeeze_play")).toEqual(
            expect.objectContaining({
                key: "squeeze_play",
                runtimeStatus: "candidate",
            })
        );
        expect(getStrategyDefinition("timesfm_directional")).toEqual(
            expect.objectContaining({
                key: "timesfm_directional",
                runtimeStatus: "candidate",
                metadata: expect.objectContaining({
                    supportsLive: true,
                    supportsShadow: true,
                    supportsCandidate: true,
                }),
            })
        );
    });
});

describe("strategy contract", () => {
    test("creates a canonical definition with noop runtime hooks by default", () => {
        const definition = createStrategyDefinition({
            key: "squeeze_play",
            label: "Squeeze Play",
        });

        expect(definition.createInitialState()).toEqual({});
        expect(definition.reduceState({ openTrades: 1 })).toEqual({
            openTrades: 1,
        });
        expect(definition.evaluateEntry()).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reason: "Strategy not yet wired into runtime",
                reasonCode: "STRATEGY_NOT_READY",
            })
        );
    });

    test("rejects unknown strategy keys", () => {
        expect(() =>
            createStrategyDefinition({
                key: "balanced",
                label: "Balanced",
            })
        ).toThrow("Unknown canonical strategy key");
    });

    test("builds noop results with strategy metadata", () => {
        expect(createNoopResult({ strategy: "range_breakout" })).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                reason: "Strategy not yet wired into runtime",
                metadata: {
                    strategy: "range_breakout",
                },
            })
        );
    });
});
