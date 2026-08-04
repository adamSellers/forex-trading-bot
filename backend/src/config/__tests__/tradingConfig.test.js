const {
    buildHashableConfig,
    computeConfigHash,
    materializeStrategyConfig,
    normalizeTradingConfig,
} = require("../tradingConfig");

describe("tradingConfig", () => {
    test("uses AUD as the immutable reference and account currency", () => {
        const config = normalizeTradingConfig({
            referenceCurrency: "USD",
            accountCurrency: "USD",
        });

        expect(config.referenceCurrency).toBe("AUD");
        expect(config.accountCurrency).toBe("AUD");
    });

    test("materializes strategy defaults into a self-contained snapshot", () => {
        const config = materializeStrategyConfig({
            strategy: "carry_trend",
            assets: ["EUR_USD"],
        });

        expect(config).toEqual(
            expect.objectContaining({
                strategy: "carry_trend",
                assets: ["EUR_USD"],
                carryTrendFastDays: 50,
                carryTrendSlowDays: 200,
                carryTrendBreakoutDays: 20,
                referenceCurrency: "AUD",
            })
        );
    });

    test("hashes strategy, model, exit, and future canonical fields", () => {
        const base = materializeStrategyConfig({
            strategy: "carry_trend",
            carryTrendMinimumMomentum: 0.01,
            trailingStopRiskMultiple: 1,
            futureLiveField: "a",
        });
        const modelChanged = { ...base, carryTrendMinimumMomentum: 0.02 };
        const exitChanged = { ...base, trailingStopRiskMultiple: 1.5 };
        const futureFieldChanged = { ...base, futureLiveField: "b" };

        expect(computeConfigHash(modelChanged)).not.toBe(computeConfigHash(base));
        expect(computeConfigHash(exitChanged)).not.toBe(computeConfigHash(base));
        expect(computeConfigHash(futureFieldChanged)).not.toBe(
            computeConfigHash(base)
        );
        expect(buildHashableConfig(base)).toEqual(
            expect.objectContaining({
                carryTrendMinimumMomentum: 0.01,
                trailingStopRiskMultiple: 1,
                futureLiveField: "a",
            })
        );
    });

    test("does not change experiment identity for operational pause state", () => {
        const config = materializeStrategyConfig({ strategy: "carry_trend" });
        expect(computeConfigHash({ ...config, enableTrading: true })).toBe(
            computeConfigHash({ ...config, enableTrading: false })
        );
    });
});
