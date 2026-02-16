// backend/src/workers/optimizationWorker.js
const { runSimulation } = require("./backtestWorker"); // Reuse your fixed logic
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// PATHS
const LAB_DIR = path.join(__dirname, "../../backtest_lab");
const DB_PATH = path.join(LAB_DIR, "data/market_data.db");
const FETCH_SCRIPT = path.join(LAB_DIR, "fetch_candles.js");
const BUILD_SCRIPT = path.join(LAB_DIR, "build_15m_dataset.js");

// CANDIDATE POOL (The "Universe" to test)
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
            await runOptimizer(msg.config);
        } catch (error) {
            if (process.send)
                process.send({ type: "error", error: error.message });
            process.exit(1);
        }
    }
});

async function runOptimizer(userConfig) {
    // 1. Prepare Data
    const candidates = userConfig.candidates || DEFAULT_CANDIDATES;
    if (process.send)
        process.send({
            type: "progress",
            message: `Initializing Data for ${candidates.length} assets...`,
            percent: 5,
        });

    // Ensure we have data for ALL candidates
    // Note: We force a check to ensure fetch_candles downloads everything needed
    await ensureLabData(candidates);

    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

    // 2. Phase 1: The Screener (Test Indivudal Performance)
    const results = [];
    let completed = 0;

    if (process.send)
        process.send({
            type: "progress",
            message: `🧪 Phase 1: Screening Assets...`,
            percent: 10,
        });

    for (const asset of candidates) {
        // Run simulation on SINGLE asset
        // We divide capital by 1 to simulate "All In" on this asset to test its raw quality
        const singleConfig = {
            ...userConfig,
            assets: [asset],
            weights: { [asset]: 100 },
            balance: 1000, // Standardize test capital
        };

        try {
            // We wrap the callback-based DB call from runSimulation if needed,
            // but runSimulation is async in our updated file.
            // However, runSimulation expects to query the DB itself.
            // We need to inject the DB or let it handle it.
            // The exported runSimulation takes (db, config).

            const simResult = await runSimulation(db, singleConfig);

            // Score the asset
            const stats = simResult.stats;
            const score = calculateScore(stats); // Custom scoring logic

            results.push({
                symbol: asset,
                pnl: stats.netProfit,
                winRate: stats.winRate,
                trades: stats.totalTrades,
                score: score,
                rawStats: stats,
            });
        } catch (e) {
            // Ignore failed assets (e.g. no data)
        }

        completed++;
        const progress = 10 + Math.round((completed / candidates.length) * 60); // 10% to 70%
        if (process.send)
            process.send({
                type: "progress",
                message: `Analyzing ${asset}...`,
                percent: progress,
            });
    }

    // 3. Phase 2: The Ranking
    // Filter out losers and sort by Score
    const winners = results
        .filter((r) => r.pnl > 0 && r.trades > 5) // Must be profitable and active
        .sort((a, b) => b.score - a.score);

    if (winners.length === 0) {
        throw new Error("No profitable assets found with these settings.");
    }

    // Select Top N (e.g., Top 4) for the Portfolio
    const topPicks = winners.slice(0, 4).map((w) => w.symbol);

    // Calculate optimal weights (simplistic: equal weight for now, or weighted by score)
    const optimizedWeights = {};
    topPicks.forEach((sym) => (optimizedWeights[sym] = 25)); // 25% each for Top 4

    // 4. Phase 3: The Portfolio Validation
    if (process.send)
        process.send({
            type: "progress",
            message: `🏆 Phase 3: Validating "Dream Team" Portfolio...`,
            percent: 80,
        });

    const finalConfig = {
        ...userConfig,
        assets: topPicks,
        weights: optimizedWeights,
        balance: userConfig.balance || 1000,
    };

    const finalResult = await runSimulation(db, finalConfig);

    // 5. Send Report
    if (process.send) {
        process.send({
            type: "optimization_complete",
            data: {
                rankedAssets: winners, // The Leaderboard
                optimizedPortfolio: {
                    assets: topPicks,
                    stats: finalResult.stats,
                    equityCurve: finalResult.equityCurve,
                },
                recommendation: `Recommended Portfolio: ${topPicks.join(", ")}`,
            },
        });
    }

    process.exit(0);
}

function calculateScore(stats) {
    // A simple proprietary score: PnL is good, but consistency (Win Rate) matters too.
    // Score = NetProfit * (WinRate / 100)
    // You can make this more complex (Sharpe Ratio) later.
    return stats.netProfit * (stats.winRate / 100);
}

// --- HELPER: Data Fetching (Reused) ---
async function ensureLabData(assets) {
    // Trigger the fetch script passing the assets as args or env vars
    // For now, we assume the fetch script grabs a default list,
    // but in production you'd pass the list to fetch_candles.js

    const dbExists = fs.existsSync(DB_PATH);
    if (!dbExists) {
        await runChildScript(FETCH_SCRIPT, "Fetching Market Data");
        await runChildScript(BUILD_SCRIPT, "Building Database");
    }
}

function runChildScript(scriptPath, actionName) {
    return new Promise((resolve, reject) => {
        const child = spawn("node", [scriptPath]);
        child.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`${actionName} failed`))
        );
    });
}
