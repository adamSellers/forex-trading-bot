const {
    buildHashableConfig,
    computeConfigHash,
    materializeStrategyConfig,
    normalizeTradingConfig,
    cloneDefaultConfig,
} = require("../tradingConfig");

describe("tradingConfig", () => {
    test("historical H4-v1 snapshots retain the captured hash and never acquire peak-trail fields", () => {
        const historical = require("../../../../shared/legacyH4ChannelConfigDefaults.json");
        expect(computeConfigHash(historical)).toBe("5c21f2ba01099502340f");
        expect(normalizeTradingConfig(historical)).toEqual(historical);
        expect(materializeStrategyConfig(historical)).toEqual(historical);
        expect(materializeStrategyConfig({ strategy: "multi_day_trend" }, { baseConfig: historical })).toEqual(historical);
        expect(materializeStrategyConfig(historical)).not.toHaveProperty("enablePeakProfitTrail");
        expect(computeConfigHash(cloneDefaultConfig())).not.toBe(computeConfigHash(historical));
    });

    test("new peak-trail fields normalize explicitly and affect the release identity", () => {
        const config = normalizeTradingConfig({ enablePeakProfitTrail: "true",
            peakProfitTrailActivationRiskMultiple: "1", peakProfitTrailRiskMultiple: "0.5" });
        expect(config).toMatchObject({ configSchemaVersion: 6, liveReleaseVersion: "h4-channel-v2",
            executionPolicyVersion: "h4-channel-risk-v2", enablePeakProfitTrail: true,
            peakProfitTrailActivationRiskMultiple: 1, peakProfitTrailRiskMultiple: 0.5 });
        for (const change of [{ enablePeakProfitTrail: false }, { peakProfitTrailActivationRiskMultiple: 2 },
            { peakProfitTrailRiskMultiple: 0.75 }]) {
            expect(computeConfigHash({ ...config, ...change })).not.toBe(computeConfigHash(config));
        }
    });

    test("retains the deployed v4 snapshot hash and old capacity semantics", () => {
        const historical = {
            ...require("../../../../shared/legacyIntradayConfigDefaults.json"),
            liveReleaseVersion: "m15-intraday-v4",
            executionPolicyVersion: "intraday-risk-v4",
            maxOpenPositions: 1,
        };
        expect(normalizeTradingConfig(historical).maxOpenPositions).toBe(1);
        // Captured from v4 before this change; normalizing history must not
        // rewrite its capacity policy or silently change experiment identity.
        expect(computeConfigHash(historical)).toBe("49808daa3caffd0405c4");
        expect(computeConfigHash(cloneDefaultConfig())).not.toBe(computeConfigHash(historical));
    });
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
