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
        const config = materializeStrategyConfig(
            { strategy: "range_breakout", assets: ["EUR_USD"] },
            { strategyKey: "range_breakout" }
        );

        expect(config).toEqual(
            expect.objectContaining({
                strategy: "range_breakout",
                assets: ["EUR_USD"],
                londonOpenHourUTC: 7,
                rangeMinAtrRatio: 0.5,
                breakoutAcceptanceCloses: 2,
                referenceCurrency: "AUD",
            })
        );
    });

    test("hashes strategy, model, exit, and future canonical fields", () => {
        const base = materializeStrategyConfig({
            strategy: "timesfm_directional",
            timesFmModelRevision: "v1",
            trailingStopRiskMultiple: 1,
            customResearchField: "a",
        });
        const modelChanged = { ...base, timesFmModelRevision: "v2" };
        const exitChanged = { ...base, trailingStopRiskMultiple: 1.5 };
        const futureFieldChanged = { ...base, customResearchField: "b" };

        expect(computeConfigHash(modelChanged)).not.toBe(computeConfigHash(base));
        expect(computeConfigHash(exitChanged)).not.toBe(computeConfigHash(base));
        expect(computeConfigHash(futureFieldChanged)).not.toBe(
            computeConfigHash(base)
        );
        expect(buildHashableConfig(base)).toEqual(
            expect.objectContaining({
                timesFmModelRevision: "v1",
                trailingStopRiskMultiple: 1,
                customResearchField: "a",
            })
        );
    });

    test("does not change experiment identity for operational pause state", () => {
        const config = materializeStrategyConfig({ strategy: "supertrend_momentum" });
        expect(computeConfigHash({ ...config, enableTrading: true })).toBe(
            computeConfigHash({ ...config, enableTrading: false })
        );
    });
});
