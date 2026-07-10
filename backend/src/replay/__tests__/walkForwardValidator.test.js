const {
    WalkForwardValidator,
    buildPurgedWalkForwardSplits,
} = require("../walkForwardValidator");

function dataset(count = 14) {
    const start = Date.parse("2026-01-01T00:00:00Z");
    return {
        AUD_USD: Array.from({ length: count }, (_, index) => ({
            time: start + index * 900000,
            open: 0.65,
            high: 0.651,
            low: 0.649,
            close: 0.65,
            complete: true,
        })),
    };
}

function resultFor(pnl, range) {
    return {
        trades: [{
            instrument: "AUD_USD",
            netPnlAud: pnl,
            executionCostAud: 0,
        }],
        equityCurve: [
            { time: range.from, equityAud: 100 },
            { time: range.to, equityAud: 100 + pnl },
        ],
        rejections: [],
    };
}

describe("WalkForwardValidator", () => {
    test("creates chronological splits with explicit embargo gaps", () => {
        const splits = buildPurgedWalkForwardSplits(dataset(), {
            trainBars: 4,
            validationBars: 2,
            testBars: 2,
            embargoBars: 1,
            stepBars: 2,
        });
        expect(splits[0].train.to).toBeLessThan(splits[0].validation.from);
        expect(splits[0].validation.to).toBeLessThan(splits[0].test.from);
    });

    test("selects on validation and reports untouched forward-test eligibility", async () => {
        const validator = new WalkForwardValidator({
            warmupBars: 1,
            criteria: {
                minimumTrades: 1,
                minimumProfitFactor: 1,
                maximumDrawdownPct: 1,
                minimumDeflatedSharpeProbability: 0,
                maximumInstrumentConcentration: 1,
            },
            bootstrap: { samples: 100, seed: 3 },
            engineFactory: async (variant, _phase, _fold, range) => ({
                run: async (_data, runOptions) => {
                    expect(runOptions.tradeFrom).toBe(range.from);
                    return resultFor(variant.id === "good" ? 2 : -2, range);
                },
            }),
        });
        const result = await validator.run(
            dataset(),
            [{ id: "bad" }, { id: "good" }],
            {
                trainBars: 4,
                validationBars: 2,
                testBars: 2,
                embargoBars: 1,
                stepBars: 2,
            }
        );

        expect(result.folds[0].selectedVariant.id).toBe("good");
        expect(result.folds[0].test.netPnlAud).toBe(2);
        expect(result.selectionPolicy.testResultsUsedForSelection).toBe(false);
        expect(result.eligibleForShadow).toBe(true);
    });
});
