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
            strategy: "intraday_momentum",
            assets: ["EUR_USD"],
        });

        expect(config).toEqual(
            expect.objectContaining({
                strategy: "intraday_momentum",
                assets: ["EUR_USD"],
                intradayFastEmaPeriod: 20,
                intradaySlowEmaPeriod: 50,
                intradayBreakoutBars: 8,
                referenceCurrency: "AUD",
            })
        );
    });

    test("hashes strategy, model, exit, and future canonical fields", () => {
        const base = materializeStrategyConfig({
            strategy: "intraday_momentum",
            intradayMinAdx: 20,
            trailingStopRiskMultiple: 1,
            futureLiveField: "a",
        });
        const modelChanged = { ...base, intradayMinAdx: 22 };
        const exitChanged = { ...base, trailingStopRiskMultiple: 1.5 };
        const futureFieldChanged = { ...base, futureLiveField: "b" };

        expect(computeConfigHash(modelChanged)).not.toBe(computeConfigHash(base));
        expect(computeConfigHash(exitChanged)).not.toBe(computeConfigHash(base));
        expect(computeConfigHash(futureFieldChanged)).not.toBe(
            computeConfigHash(base)
        );
        expect(buildHashableConfig(base)).toEqual(
            expect.objectContaining({
                intradayMinAdx: 20,
                trailingStopRiskMultiple: 1,
                futureLiveField: "a",
            })
        );
    });

    test("does not change experiment identity for operational pause state", () => {
        const config = materializeStrategyConfig({
            strategy: "intraday_momentum",
        });
        expect(computeConfigHash({ ...config, enableTrading: true })).toBe(
            computeConfigHash({ ...config, enableTrading: false })
        );
    });
});
