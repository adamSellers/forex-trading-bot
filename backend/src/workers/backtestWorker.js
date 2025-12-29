// backend/src/workers/backtestWorker.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// PATHS
const LAB_DIR = path.join(__dirname, "../../backtest_lab");
const DB_PATH = path.join(LAB_DIR, "data/market_data.db");
const FETCH_SCRIPT = path.join(LAB_DIR, "fetch_candles.js");
const BUILD_SCRIPT = path.join(LAB_DIR, "build_15m_dataset.js");

const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

process.on("message", async (msg) => {
    if (msg.command === "start") {
        try {
            await ensureLabData();

            const db = new sqlite3.Database(
                DB_PATH,
                sqlite3.OPEN_READONLY,
                (err) => {
                    if (err)
                        throw new Error(`DB Connection Failed: ${err.message}`);
                }
            );

            runSimulation(db, msg.config);
        } catch (error) {
            if (process.send)
                process.send({ type: "error", error: error.message });
            process.exit(1);
        }
    }
});

async function ensureLabData() {
    const dbExists = fs.existsSync(DB_PATH);
    let isStale = false;

    if (dbExists) {
        const stats = fs.statSync(DB_PATH);
        if (Date.now() - stats.mtimeMs > STALE_THRESHOLD) isStale = true;
    }

    if (!dbExists || isStale) {
        if (process.send)
            process.send({
                type: "progress",
                message: `⚠️ Data Missing/Stale. Auto-Initializing...`,
                percent: 0,
            });
        await runChildScript(FETCH_SCRIPT, "Downloading Candles");
        await runChildScript(BUILD_SCRIPT, "Building Database");
        if (process.send)
            process.send({
                type: "progress",
                message: "✅ Lab Ready. Starting Simulation...",
                percent: 10,
            });
    }
}

function runChildScript(scriptPath, actionName) {
    return new Promise((resolve, reject) => {
        const child = spawn("node", [scriptPath]);
        child.stdout.on("data", (data) => {
            const line = data.toString().trim();
            if (
                line &&
                process.send &&
                (line.includes("Downloading") || line.includes("Processing"))
            ) {
                process.send({
                    type: "progress",
                    message: `${actionName}: ${line.substring(0, 30)}...`,
                    percent: 5,
                });
            }
        });
        child.on("close", (code) =>
            code === 0
                ? resolve()
                : reject(new Error(`${actionName} failed: ${code}`))
        );
    });
}

async function runSimulation(db, config) {
    try {
        if (process.send)
            process.send({
                type: "progress",
                message: "Initializing...",
                percent: 5,
            });

        // CONFIG DEFAULTS
        const STRATEGY = {
            min_adx: parseFloat(config.minAdx) || 25,
            max_rsi: parseFloat(config.maxRsi) || 70,
            stop_loss_pct: (parseFloat(config.stopLoss) || 2.0) / 100,
            initial_balance: parseFloat(config.balance) || 1000,
            trade_size_pct: parseFloat(config.riskPerTrade) || 0.95,
            assets:
                Array.isArray(config.assets) && config.assets.length > 0
                    ? config.assets
                    : ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "NEARUSDT"],
            days: parseInt(config.days) || 30, // Default 30 days
        };

        // TIME FILTER
        const startTime = Date.now() - STRATEGY.days * 24 * 60 * 60 * 1000;

        const placeholders = STRATEGY.assets.map(() => "?").join(",");
        const query = `
            SELECT * FROM market_state_15m 
            WHERE symbol IN (${placeholders}) 
            AND timestamp > ?
            ORDER BY timestamp ASC
        `;

        if (process.send)
            process.send({
                type: "progress",
                message: "Fetching Data...",
                percent: 10,
            });

        db.all(query, [...STRATEGY.assets, startTime], async (err, rows) => {
            if (err) {
                if (process.send)
                    process.send({ type: "error", error: err.message });
                process.exit(1);
            }

            if (!rows || rows.length === 0) {
                if (process.send)
                    process.send({
                        type: "error",
                        error: "No data found for this period/asset selection.",
                    });
                process.exit(0);
            }

            if (process.send)
                process.send({
                    type: "progress",
                    message: `Simulating ${rows.length} candles...`,
                    percent: 20,
                });

            const results = await executeStrategy(rows, STRATEGY);
            if (process.send) process.send({ type: "result", data: results });
            process.exit(0);
        });
    } catch (error) {
        if (process.send) process.send({ type: "error", error: error.message });
        process.exit(1);
    }
}

async function executeStrategy(rows, strategy) {
    let balance = strategy.initial_balance;
    let positions = {};
    let tradeHistory = [];
    let equityCurve = [];

    // Tracks the latest price for EVERY asset to ensure accurate equity calculation
    const latestPrices = {};
    const previousStates = {};

    const totalCandles = rows.length;
    let processedCount = 0;

    for (const candle of rows) {
        processedCount++;

        // Progress Updates
        if (processedCount % 5000 === 0) {
            const pct = 20 + Math.round((processedCount / totalCandles) * 70);
            if (process.send)
                process.send({
                    type: "progress",
                    message: `Simulating... (${Math.round(
                        (processedCount / totalCandles) * 100
                    )}%)`,
                    percent: pct,
                });
            await new Promise((r) => setImmediate(r));
        }

        const sym = candle.symbol;

        // UPDATE PRICE MAP (Critical Fix)
        latestPrices[sym] = candle.price;

        const prevCandle = previousStates[sym];
        previousStates[sym] = candle;

        if (!prevCandle) continue;

        // --- 1. EXITS ---
        if (positions[sym]) {
            const pos = positions[sym];
            let closeReason = null;
            let exitPrice = candle.price;

            if (candle.price <= pos.stopLoss) {
                closeReason = "STOP_LOSS";
                exitPrice = pos.stopLoss;
            } else if (candle.supertrend_direction === -1) {
                closeReason = "TREND_FLIP";
            }

            if (closeReason) {
                const exitValue = pos.quantity * exitPrice;
                const fee = exitValue * 0.001;
                const netReturn = exitValue - fee;
                const pnl = netReturn - pos.cost;
                balance += netReturn;

                tradeHistory.push({
                    id: tradeHistory.length + 1,
                    symbol: sym,
                    entryPrice: pos.entryPrice,
                    exitPrice: exitPrice,
                    pnl: pnl,
                    pnlPercent:
                        ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100, // Normalized
                    reason: closeReason,
                    time: candle.timestamp,
                });
                delete positions[sym];
            }
        }

        // --- 2. ENTRIES ---
        if (!positions[sym]) {
            const trendFlipGreen =
                prevCandle.supertrend_direction === -1 &&
                candle.supertrend_direction === 1;

            if (trendFlipGreen) {
                if (
                    candle.adx >= strategy.min_adx &&
                    candle.rsi <= strategy.max_rsi
                ) {
                    // ALLOCATION LOGIC:
                    // Divide trade size by number of active assets to prevent 100% allocation on first coin
                    // e.g. 95% Risk / 5 Assets = ~19% per trade
                    const assetCount = strategy.assets.length || 1;
                    const allocationFactor =
                        strategy.trade_size_pct / assetCount;

                    // Base calculation on INITIAL balance to simulate fixed portfolio segments
                    // OR current balance? Current is safer for compounding, but limits concurrent trades if cash low.
                    // Let's use Current Balance * Allocation Factor
                    const investAmount = balance * allocationFactor;

                    if (investAmount > 10) {
                        const fee = investAmount * 0.001;
                        const netInvest = investAmount - fee;
                        positions[sym] = {
                            entryPrice: candle.price,
                            quantity: netInvest / candle.price,
                            cost: investAmount,
                            stopLoss:
                                candle.price * (1 - strategy.stop_loss_pct),
                        };
                        balance -= investAmount;
                    }
                }
            }
        }

        // --- 3. EQUITY CURVE (FIXED) ---
        // Sample occasionally
        if (Math.random() > 0.98) {
            let unrealized = 0;
            Object.keys(positions).forEach((posSym) => {
                const pos = positions[posSym];
                const currentPrice = latestPrices[posSym] || pos.entryPrice; // Use LATEST known price
                unrealized += pos.quantity * currentPrice;
            });
            equityCurve.push({
                time: candle.timestamp,
                value: balance + unrealized,
            });
        }
    }

    if (process.send)
        process.send({
            type: "progress",
            message: "Compiling Results...",
            percent: 95,
        });

    // --- COMPILE ASSET STATS ---
    const assetStats = {};
    strategy.assets.forEach((a) => {
        assetStats[a] = { symbol: a, trades: 0, wins: 0, pnl: 0 };
    });

    tradeHistory.forEach((t) => {
        if (!assetStats[t.symbol])
            assetStats[t.symbol] = {
                symbol: t.symbol,
                trades: 0,
                wins: 0,
                pnl: 0,
            };
        assetStats[t.symbol].trades++;
        assetStats[t.symbol].pnl += t.pnl;
        if (t.pnl > 0) assetStats[t.symbol].wins++;
    });

    const winningTrades = tradeHistory.filter((t) => t.pnl > 0);
    const winRate =
        tradeHistory.length > 0
            ? (winningTrades.length / tradeHistory.length) * 100
            : 0;

    return {
        stats: {
            initialBalance: strategy.initial_balance,
            finalBalance: balance,
            netProfit: balance - strategy.initial_balance,
            totalTrades: tradeHistory.length,
            winRate: winRate,
            assetStats: Object.values(assetStats), // Send array for easy table rendering
        },
        trades: tradeHistory.reverse().slice(0, 500),
        equityCurve,
    };
}
