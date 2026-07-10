const crypto = require("crypto");
const { calculateReplayStatistics, estimateProbabilityOfBacktestOverfitting } = require("./replayStatistics");

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${stableJson(value[key])}`
        ).join(",")}}`;
    }
    return JSON.stringify(value);
}

function hashValue(value) {
    return crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 16);
}

function uniqueTimes(candlesByInstrument) {
    return Array.from(new Set(Object.values(candlesByInstrument)
        .flat()
        .map((candle) => {
            const numeric = Number(candle.time);
            return Number.isFinite(numeric)
                ? numeric > 1e12 ? numeric : numeric * 1000
                : Date.parse(candle.time);
        })
        .filter(Number.isFinite))).sort((a, b) => a - b);
}

function buildPurgedWalkForwardSplits(candlesByInstrument, options = {}) {
    const times = uniqueTimes(candlesByInstrument);
    const trainBars = Math.max(1, Number(options.trainBars) || 2000);
    const validationBars = Math.max(1, Number(options.validationBars) || 500);
    const testBars = Math.max(1, Number(options.testBars) || 500);
    const embargoBars = Math.max(0, Number(options.embargoBars) || 1);
    const stepBars = Math.max(1, Number(options.stepBars) || testBars);
    const anchored = options.anchored !== false;
    const splits = [];
    for (let trainEnd = trainBars; ; trainEnd += stepBars) {
        const validationStart = trainEnd + embargoBars;
        const validationEnd = validationStart + validationBars;
        const testStart = validationEnd + embargoBars;
        const testEnd = testStart + testBars;
        if (testEnd > times.length) break;
        const trainStart = anchored ? 0 : trainEnd - trainBars;
        splits.push({
            fold: splits.length + 1,
            train: { from: times[trainStart], to: times[trainEnd - 1] },
            validation: { from: times[validationStart], to: times[validationEnd - 1] },
            test: { from: times[testStart], to: times[testEnd - 1] },
            embargoBars,
        });
    }
    if (!splits.length) {
        throw new Error(
            `Insufficient history for walk-forward split: ${times.length} bars available`
        );
    }
    return splits;
}

function sliceDataset(candlesByInstrument, range, options = {}) {
    const output = {};
    const warmupBars = Math.max(0, Number(options.warmupBars) || 0);
    for (const [instrument, candles] of Object.entries(candlesByInstrument)) {
        const withTimes = candles.map((candle) => {
            const raw = Number(candle.time);
            const time = Number.isFinite(raw)
                ? raw > 1e12 ? raw : raw * 1000
                : Date.parse(candle.time);
            return { candle, time };
        });
        const first = withTimes.findIndex((row) => row.time >= range.from);
        const start = first === -1 ? withTimes.length : Math.max(0, first - warmupBars);
        output[instrument] = withTimes
            .slice(start)
            .filter((row) => row.time <= range.to)
            .map((row) => row.candle);
    }
    return output;
}

function scoreStatistics(stats, options = {}) {
    if (stats.tradeCount < (options.minimumTrades || 30)) return -Infinity;
    if (stats.maxDrawdownPct > (options.maximumDrawdownPct || 0.15)) return -Infinity;
    if (stats.profitFactor < (options.minimumProfitFactor || 1)) return -Infinity;
    // Prefer a lower-bound positive expectancy, then PF and drawdown. This avoids
    // selecting a tiny high-return sample purely on its point estimate.
    return (
        stats.expectancy95Aud.lower * 1000 +
        Math.min(5, stats.profitFactor) * 10 -
        stats.maxDrawdownPct * 100
    );
}

class WalkForwardValidator {
    constructor(options = {}) {
        if (typeof options.engineFactory !== "function") {
            throw new Error("WalkForwardValidator requires engineFactory(variant, phase, fold)");
        }
        this.engineFactory = options.engineFactory;
        this.criteria = {
            minimumTrades: 30,
            minimumProfitFactor: 1.05,
            maximumDrawdownPct: 0.15,
            minimumWinRateLower95: 0,
            minimumDeflatedSharpeProbability: 0.8,
            maximumInstrumentConcentration: 0.75,
            ...options.criteria,
        };
        this.bootstrap = options.bootstrap || {};
        this.warmupBars = Math.max(0, Number(options.warmupBars) || 250);
    }

    _passes(stats) {
        return (
            stats.tradeCount >= this.criteria.minimumTrades &&
            stats.profitFactor >= this.criteria.minimumProfitFactor &&
            stats.maxDrawdownPct <= this.criteria.maximumDrawdownPct &&
            stats.winRate95.lower >= this.criteria.minimumWinRateLower95 &&
            stats.deflatedSharpeProbability >=
                this.criteria.minimumDeflatedSharpeProbability &&
            stats.concentration.topShare <=
                this.criteria.maximumInstrumentConcentration &&
            stats.expectancy95Aud.lower > 0
        );
    }

    async _evaluate(variant, phase, fold, dataset, trialCount, range) {
        const engine = await this.engineFactory(variant, phase, fold, range);
        const result = await engine.run(dataset, {
            tradeFrom: range.from,
            tradeTo: range.to,
        });
        const statistics = calculateReplayStatistics(result, {
            trialCount,
            bootstrap: this.bootstrap,
        });
        return { result, statistics };
    }

    async run(candlesByInstrument, variants, splitOptions = {}) {
        if (!Array.isArray(variants) || !variants.length) {
            throw new Error("At least one explicit strategy variant is required");
        }
        const normalizedVariants = variants.map((variant, index) => ({
            id: variant.id || `variant_${index + 1}`,
            ...variant,
        }));
        const splits = buildPurgedWalkForwardSplits(candlesByInstrument, splitOptions);
        const folds = [];
        const pboRows = [];

        for (const split of splits) {
            const trainData = sliceDataset(candlesByInstrument, split.train, {
                warmupBars: this.warmupBars,
            });
            const validationData = sliceDataset(candlesByInstrument, split.validation, {
                warmupBars: this.warmupBars,
            });
            const testData = sliceDataset(candlesByInstrument, split.test, {
                warmupBars: this.warmupBars,
            });
            const candidates = [];

            for (const variant of normalizedVariants) {
                const train = await this._evaluate(
                    variant,
                    "train",
                    split.fold,
                    trainData,
                    normalizedVariants.length,
                    split.train
                );
                const validation = await this._evaluate(
                    variant,
                    "validation",
                    split.fold,
                    validationData,
                    normalizedVariants.length,
                    split.validation
                );
                candidates.push({
                    variant,
                    train: train.statistics,
                    validation: validation.statistics,
                    score: scoreStatistics(validation.statistics, this.criteria),
                });
            }

            candidates.sort((a, b) => b.score - a.score);
            const selected = candidates[0];
            const test = selected && Number.isFinite(selected.score)
                ? await this._evaluate(
                    selected.variant,
                    "test",
                    split.fold,
                    testData,
                    normalizedVariants.length,
                    split.test
                )
                : null;

            // Evaluate all variants OOS only for PBO diagnostics. These results
            // never participate in selection or parameter changes.
            const pboVariants = [];
            for (const candidate of candidates) {
                const outOfSample = candidate.variant.id === selected?.variant.id && test
                    ? test
                    : await this._evaluate(
                        candidate.variant,
                        "pbo_diagnostic",
                        split.fold,
                        testData,
                        normalizedVariants.length,
                        split.test
                    );
                pboVariants.push({
                    id: candidate.variant.id,
                    inSampleScore: candidate.score,
                    outOfSampleScore: outOfSample.statistics.expectancyAud,
                });
            }
            pboRows.push({ fold: split.fold, variants: pboVariants });
            folds.push({
                split,
                selectedVariant: selected?.variant || null,
                candidates,
                test: test?.statistics || null,
                testPassed: test ? this._passes(test.statistics) : false,
            });
        }

        const testedFolds = folds.filter((fold) => fold.test);
        const pbo = estimateProbabilityOfBacktestOverfitting(pboRows);
        const allFoldsPassed = testedFolds.length === folds.length &&
            testedFolds.every((fold) => fold.testPassed);
        return {
            datasetHash: hashValue(candlesByInstrument),
            variantSetHash: hashValue(normalizedVariants),
            trialCount: normalizedVariants.length,
            foldCount: folds.length,
            folds,
            pbo,
            eligibleForShadow: allFoldsPassed &&
                (pbo.probability === null || pbo.probability <= 0.5),
            selectionPolicy: {
                selectedOn: "validation_only",
                evaluatedOn: "purged_forward_test",
                criteria: this.criteria,
                testResultsUsedForSelection: false,
            },
        };
    }
}

module.exports = {
    WalkForwardValidator,
    buildPurgedWalkForwardSplits,
    hashValue,
    scoreStatistics,
    sliceDataset,
};
