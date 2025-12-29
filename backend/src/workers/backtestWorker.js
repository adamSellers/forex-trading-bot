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

// 24 Hours in ms
const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

process.on("message", async (msg) => {
    if (msg.command === "start") {
        try {
            // STEP 1: Auto-Initialize Data if needed
            await ensureLabData();

            // STEP 2: Connect to DB (Now guaranteed to exist)
            const db = new sqlite3.Database(
                DB_PATH,
                sqlite3.OPEN_READONLY,
                (err) => {
                    if (err)
                        throw new Error(`DB Connection Failed: ${err.message}`);
                }
            );

            // STEP 3: Run Simulation
            runSimulation(db, msg.config);
        } catch (error) {
            if (process.send)
                process.send({ type: "error", error: error.message });
            process.exit(1);
        }
    }
});

/**
 * Checks if data exists and is fresh. If not, runs the setup scripts.
 */
async function ensureLabData() {
    const dbExists = fs.existsSync(DB_PATH);
    let isStale = false;

    if (dbExists) {
        const stats = fs.statSync(DB_PATH);
        const age = Date.now() - stats.mtimeMs;
        if (age > STALE_THRESHOLD) isStale = true;
    }

    if (!dbExists || isStale) {
        const reason = !dbExists ? "Missing Data" : "Stale Data (>24h)";
        if (process.send)
            process.send({
                type: "progress",
                message: `⚠️ ${reason} Detected. Auto-Initializing Lab...`,
                percent: 0,
            });

        // 1. Run Fetch
        await runChildScript(FETCH_SCRIPT, "Downloading Candles");

        // 2. Run Build
        await runChildScript(BUILD_SCRIPT, "Building Database");

        if (process.send)
            process.send({
                type: "progress",
                message: "✅ Lab Ready. Starting Simulation...",
                percent: 10,
            });
    }
}

/**
 * Helper to spawn a script and pipe output to the UI
 */
function runChildScript(scriptPath, actionName) {
    return new Promise((resolve, reject) => {
        const child = spawn("node", [scriptPath]);

        child.stdout.on("data", (data) => {
            const line = data.toString().trim();
            if (line && process.send) {
                // Send specific progress updates based on script output
                if (line.includes("Downloading")) {
                    process.send({
                        type: "progress",
                        message: `${actionName}: ${line.substring(0, 30)}...`,
                        percent: 5,
                    });
                } else if (line.includes("Processing")) {
                    process.send({
                        type: "progress",
                        message: `${actionName}: Processing Data...`,
                        percent: 8,
                    });
                }
            }
        });

        child.stderr.on("data", (data) => {
            console.error(`[${actionName} Error]: ${data}`);
        });

        child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${actionName} failed with code ${code}`));
        });
    });
}

// ... EXISTING LOGIC BELOW (Slightly modified to accept DB instance) ...

async function runSimulation(db, config) {
    // ... [Same logic as before, just using the passed 'db' instance] ...
    // Note: I will include the full function below for copy-paste safety

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
    };

    const placeholders = STRATEGY.assets.map(() => "?").join(",");
    const query = `SELECT * FROM market_state_15m WHERE symbol IN (${placeholders}) ORDER BY timestamp ASC`;

    if (process.send)
        process.send({
            type: "progress",
            message: "Loading Market Data...",
            percent: 15,
        });

    db.all(query, STRATEGY.assets, async (err, rows) => {
        if (err) {
            if (process.send)
                process.send({ type: "error", error: err.message });
            process.exit(1);
        }

        // Final sanity check
        if (!rows || rows.length === 0) {
            if (process.send)
                process.send({
                    type: "error",
                    error: "Lab Initialization failed (No rows). Check logs.",
                });
            process.exit(1);
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
}

async function executeStrategy(rows, strategy) {
    let balance = strategy.initial_balance;
    let positions = {};
    let tradeHistory = [];
    let equityCurve = [];
    const previousStates = {};

    const totalCandles = rows.length;
    let processedCount = 0;

    for (const candle of rows) {
        processedCount++;

        if (processedCount % 5000 === 0) {
            const pct = 20 + Math.round((processedCount / totalCandles) * 70);
            if (process.send) {
                process.send({
                    type: "progress",
                    message: `Simulating... (${Math.round(
                        (processedCount / totalCandles) * 100
                    )}%)`,
                    percent: pct,
                });
            }
            await new Promise((r) => setImmediate(r));
        }

        const sym = candle.symbol;
        const prevCandle = previousStates[sym];
        previousStates[sym] = candle;

        if (!prevCandle) continue;

        // 1. EXITS
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
                    reason: closeReason,
                    time: candle.timestamp,
                });
                delete positions[sym];
            }
        }

        // 2. ENTRIES
        if (!positions[sym]) {
            const trendFlipGreen =
                prevCandle.supertrend_direction === -1 &&
                candle.supertrend_direction === 1;

            if (trendFlipGreen) {
                if (
                    candle.adx >= strategy.min_adx &&
                    candle.rsi <= strategy.max_rsi
                ) {
                    const investAmount = balance * strategy.trade_size_pct;
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

        if (Math.random() > 0.95) {
            let unrealized = 0;
            Object.values(positions).forEach(
                (p) => (unrealized += p.quantity * candle.price)
            );
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
        },
        trades: tradeHistory.reverse().slice(0, 500),
        equityCurve,
    };
}
