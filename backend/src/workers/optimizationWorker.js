// backend/src/workers/optimizationWorker.js
const { runSimulation } = require("./backtestWorker");
const HistoricalDataService = require("../services/historicalDataService");

const DEFAULT_CANDIDATES = [
    "AUD_USD",
    "EUR_USD",
    "GBP_USD",
    "NZD_USD",
    "USD_CAD",
    "USD_CHF",
    "USD_JPY",
    "EUR_GBP",
    "EUR_JPY",
    "GBP_JPY",
];

process.on("message", async (msg) => {
    if (msg.command === "start_optimization") {
        try {
            await runOptimizer(msg.config || {});
        } catch (error) {
            if (process.send) {
                process.send({ type: "error", error: error.message });
            }
            process.exit(1);
        }
    }
});

async function runOptimizer(userConfig) {
    const historicalDataService = new HistoricalDataService();
    const candidates = Array.isArray(userConfig.candidates) && userConfig.candidates.length > 0
        ? userConfig.candidates
        : DEFAULT_CANDIDATES;

    if (process.send) {
        process.send({
            type: "progress",
            message: `Initializing optimizer for ${candidates.length} assets...`,
            percent: 5,
        });
    }

    const ranked = [];

    for (let i = 0; i < candidates.length; i++) {
        const asset = candidates[i];
        const progress = 10 + Math.round(((i + 1) / candidates.length) * 60);

        if (process.send) {
            process.send({
                type: "progress",
                message: `Scoring ${asset}...`,
                percent: progress,
            });
        }

        const simConfig = {
            ...userConfig,
            assets: [asset],
            weights: { [asset]: 100 },
            balance: 1000,
        };

        const simResult = await runSimulation(simConfig, {
            historicalDataService,
        });

        const stats = simResult.stats || {};
        const score = calculateScore(stats);

        ranked.push({
            symbol: asset,
            pnl: Number(stats.netProfit) || 0,
            winRate: Number(stats.winRate) || 0,
            trades: Number(stats.totalTrades) || 0,
            score,
            rawStats: stats,
        });
    }

    const winners = ranked
        .filter((r) => r.pnl > 0 && r.trades > 5)
        .sort((a, b) => b.score - a.score);

    if (winners.length === 0) {
        throw new Error("No profitable assets found with these settings.");
    }

    const topPicks = winners.slice(0, 4).map((w) => w.symbol);
    const optimizedWeights = {};
    const split = 100 / topPicks.length;
    for (const symbol of topPicks) {
        optimizedWeights[symbol] = split;
    }

    if (process.send) {
        process.send({
            type: "progress",
            message: "Validating optimized portfolio...",
            percent: 85,
        });
    }

    const finalResult = await runSimulation(
        {
            ...userConfig,
            assets: topPicks,
            weights: optimizedWeights,
            balance: Number(userConfig.balance) > 0 ? Number(userConfig.balance) : 1000,
        },
        { historicalDataService }
    );

    if (process.send) {
        process.send({
            type: "optimization_complete",
            data: {
                rankedAssets: winners,
                optimizedPortfolio: {
                    assets: topPicks,
                    stats: finalResult.stats,
                    equityCurve: finalResult.equityCurve,
                },
                configUsed: finalResult.configUsed,
                recommendation: `Recommended Portfolio: ${topPicks.join(", ")}`,
            },
        });
    }

    process.exit(0);
}

function calculateScore(stats) {
    const pnl = Number(stats.netProfit) || 0;
    const winRate = Number(stats.winRate) || 0;
    return pnl * (winRate / 100);
}
