function mean(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
    if (values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(
        values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
            (values.length - 1)
    );
}

function wilsonInterval(successes, observations, z = 1.959963984540054) {
    if (!observations) return { lower: 0, upper: 1 };
    const p = successes / observations;
    const denominator = 1 + (z ** 2) / observations;
    const centre = p + (z ** 2) / (2 * observations);
    const margin = z * Math.sqrt(
        (p * (1 - p) + (z ** 2) / (4 * observations)) / observations
    );
    return {
        lower: Math.max(0, (centre - margin) / denominator),
        upper: Math.min(1, (centre + margin) / denominator),
    };
}

function createPrng(seed = 0x9e3779b9) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

function percentile(sorted, probability) {
    if (!sorted.length) return 0;
    const index = (sorted.length - 1) * probability;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function bootstrapMeanInterval(values, options = {}) {
    if (!values.length) return { lower: 0, upper: 0, samples: 0 };
    const samples = Math.max(100, Number(options.samples) || 2000);
    const confidence = Math.min(0.999, Math.max(0.5, Number(options.confidence) || 0.95));
    const random = createPrng(Number(options.seed) || 0x5f3759df);
    const estimates = [];
    for (let sample = 0; sample < samples; sample += 1) {
        let total = 0;
        for (let index = 0; index < values.length; index += 1) {
            total += values[Math.floor(random() * values.length)];
        }
        estimates.push(total / values.length);
    }
    estimates.sort((a, b) => a - b);
    const tail = (1 - confidence) / 2;
    return {
        lower: percentile(estimates, tail),
        upper: percentile(estimates, 1 - tail),
        samples,
    };
}

function erf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
        Math.exp(-x * x);
    return sign * y;
}

function normalCdf(value) {
    return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function moments(values) {
    const average = mean(values);
    const deviation = sampleStandardDeviation(values);
    if (!deviation || values.length < 3) {
        return { mean: average, standardDeviation: deviation, skewness: 0, kurtosis: 3 };
    }
    const standardized = values.map((value) => (value - average) / deviation);
    return {
        mean: average,
        standardDeviation: deviation,
        skewness: mean(standardized.map((value) => value ** 3)),
        kurtosis: mean(standardized.map((value) => value ** 4)),
    };
}

/** Bailey & Lopez de Prado probabilistic Sharpe ratio approximation. */
function probabilisticSharpeRatio(returns, benchmarkSharpe = 0) {
    if (returns.length < 3) return 0;
    const stats = moments(returns);
    if (!stats.standardDeviation) return stats.mean > 0 ? 1 : 0;
    const sharpe = stats.mean / stats.standardDeviation;
    const denominator = Math.sqrt(
        Math.max(
            1e-12,
            1 - stats.skewness * sharpe +
                ((stats.kurtosis - 1) / 4) * sharpe ** 2
        )
    );
    return normalCdf(
        ((sharpe - benchmarkSharpe) * Math.sqrt(returns.length - 1)) / denominator
    );
}

function deflatedSharpeProbability(returns, trials = 1) {
    const trialCount = Math.max(1, Number(trials) || 1);
    const benchmark = returns.length > 1 && trialCount > 1
        ? Math.sqrt((2 * Math.log(trialCount)) / (returns.length - 1))
        : 0;
    return {
        probability: probabilisticSharpeRatio(returns, benchmark),
        benchmarkSharpe: benchmark,
        trials: trialCount,
    };
}

function calculateDrawdown(equityCurve = []) {
    let peak = -Infinity;
    let maxDrawdownAud = 0;
    let maxDrawdownPct = 0;
    for (const point of equityCurve) {
        const equity = Number(point.equityAud);
        if (!Number.isFinite(equity)) continue;
        peak = Math.max(peak, equity);
        if (!(peak > 0)) continue;
        const drawdownAud = peak - equity;
        if (drawdownAud > maxDrawdownAud) maxDrawdownAud = drawdownAud;
        maxDrawdownPct = Math.max(maxDrawdownPct, drawdownAud / peak);
    }
    return { maxDrawdownAud, maxDrawdownPct };
}

function buildDailyReturns(equityCurve = []) {
    const lastByDay = new Map();
    for (const point of equityCurve) {
        const day = new Date(point.time).toISOString().slice(0, 10);
        lastByDay.set(day, Number(point.equityAud));
    }
    const values = Array.from(lastByDay.values()).filter(Number.isFinite);
    const returns = [];
    for (let index = 1; index < values.length; index += 1) {
        if (values[index - 1] > 0) returns.push(values[index] / values[index - 1] - 1);
    }
    return returns;
}

function calculateConcentration(trades = []) {
    const absoluteByInstrument = new Map();
    for (const trade of trades) {
        absoluteByInstrument.set(
            trade.instrument,
            (absoluteByInstrument.get(trade.instrument) || 0) + Math.abs(trade.netPnlAud || 0)
        );
    }
    const values = Array.from(absoluteByInstrument.entries());
    const total = values.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return { topInstrument: null, topShare: 0, herfindahl: 0 };
    const shares = values.map(([instrument, value]) => [instrument, value / total]);
    shares.sort((a, b) => b[1] - a[1]);
    return {
        topInstrument: shares[0][0],
        topShare: shares[0][1],
        herfindahl: shares.reduce((sum, [, share]) => sum + share ** 2, 0),
    };
}

function calculateReplayStatistics(result, options = {}) {
    const trades = result.trades || [];
    const pnl = trades.map((trade) => Number(trade.netPnlAud) || 0);
    const wins = pnl.filter((value) => value > 0);
    const losses = pnl.filter((value) => value < 0);
    const grossProfit = wins.reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
    const dailyReturns = buildDailyReturns(result.equityCurve || []);
    const dailyDeviation = sampleStandardDeviation(dailyReturns);
    const annualizedSharpe = dailyDeviation
        ? (mean(dailyReturns) / dailyDeviation) * Math.sqrt(252)
        : 0;
    const downside = dailyReturns.filter((value) => value < 0);
    const downsideDeviation = sampleStandardDeviation(downside);
    const annualizedSortino = downsideDeviation
        ? (mean(dailyReturns) / downsideDeviation) * Math.sqrt(252)
        : 0;
    const executionCosts = trades.reduce(
        (sum, trade) => sum + (Number(trade.executionCostAud) || 0),
        0
    );
    const financing = trades.reduce(
        (sum, trade) => sum + (Number(trade.financingAud) || 0),
        0
    );
    const commission = trades.reduce(
        (sum, trade) => sum + (Number(trade.commissionAud) || 0),
        0
    );
    const drawdown = calculateDrawdown(result.equityCurve || []);
    const deflated = deflatedSharpeProbability(
        dailyReturns,
        options.trialCount || 1
    );
    return {
        referenceCurrency: "AUD",
        tradeCount: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: trades.length ? wins.length / trades.length : 0,
        winRate95: wilsonInterval(wins.length, trades.length),
        netPnlAud: pnl.reduce((sum, value) => sum + value, 0),
        grossProfitAud: grossProfit,
        grossLossAud: grossLoss,
        profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        expectancyAud: mean(pnl),
        expectancy95Aud: bootstrapMeanInterval(pnl, options.bootstrap),
        averageWinAud: mean(wins),
        averageLossAud: mean(losses),
        payoffRatio: losses.length && mean(losses) !== 0
            ? mean(wins) / Math.abs(mean(losses))
            : 0,
        maxDrawdownAud: drawdown.maxDrawdownAud,
        maxDrawdownPct: drawdown.maxDrawdownPct,
        annualizedSharpe,
        annualizedSortino,
        probabilisticSharpe: probabilisticSharpeRatio(dailyReturns),
        deflatedSharpeProbability: deflated.probability,
        deflatedSharpeBenchmark: deflated.benchmarkSharpe,
        trialCount: deflated.trials,
        executionCostAud: executionCosts,
        financingAud: financing,
        commissionAud: commission,
        costToGrossProfit: grossProfit ? executionCosts / grossProfit : Infinity,
        concentration: calculateConcentration(trades),
        rejectionCount: (result.rejections || []).length,
    };
}

function estimateProbabilityOfBacktestOverfitting(foldVariantResults = []) {
    let observations = 0;
    let overfitSelections = 0;
    for (const fold of foldVariantResults) {
        const rows = (fold.variants || []).filter(
            (row) => Number.isFinite(row.inSampleScore) && Number.isFinite(row.outOfSampleScore)
        );
        if (rows.length < 2) continue;
        const selected = [...rows].sort((a, b) => b.inSampleScore - a.inSampleScore)[0];
        const rankedOos = [...rows].sort((a, b) => a.outOfSampleScore - b.outOfSampleScore);
        const rank = rankedOos.findIndex((row) => row.id === selected.id) + 1;
        observations += 1;
        if (rank <= rows.length / 2) overfitSelections += 1;
    }
    return {
        probability: observations ? overfitSelections / observations : null,
        observations,
    };
}

module.exports = {
    bootstrapMeanInterval,
    calculateReplayStatistics,
    deflatedSharpeProbability,
    estimateProbabilityOfBacktestOverfitting,
    probabilisticSharpeRatio,
    wilsonInterval,
};
