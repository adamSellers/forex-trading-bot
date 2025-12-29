// backend/src/workers/backtestWorker.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// --- DEBUG PATH LOGIC ---
// We define the target relative to this worker file
// Trying to go from backend/src/workers -> backend/backtest_lab/data/market_data.db
const RELATIVE_PATH = "../../../backtest_lab/data/market_data.db";
const DB_PATH = path.resolve(__dirname, RELATIVE_PATH);

console.log(`\n👷 WORKER DIAGNOSTICS:`);
console.log(`   1. Worker Location: ${__dirname}`);
console.log(`   2. Target DB Path:  ${DB_PATH}`);
console.log(
    `   3. File Exists?     ${fs.existsSync(DB_PATH) ? "✅ YES" : "❌ NO"}`
);

// Check parent folder contents if file is missing to help debug
if (!fs.existsSync(DB_PATH)) {
    const parentDir = path.dirname(DB_PATH);
    console.log(`   4. Parent Dir (${parentDir}) contents:`);
    if (fs.existsSync(parentDir)) {
        console.log(`      ${fs.readdirSync(parentDir).join("\n      ")}`);
    } else {
        console.log(`      ❌ Parent directory does not exist!`);
    }
}

// Open DB Connection inside the worker process
const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        // Send explicit error payload back to parent
        const errorMsg = `Worker DB Error: ${err.message} (Tried: ${DB_PATH})`;
        console.error(`   ❌ ${errorMsg}`);

        if (process.send) {
            process.send({ type: "error", error: errorMsg });
        }
        process.exit(1);
    }
});

// Listen for the command to start
process.on("message", (msg) => {
    if (msg.command === "start") {
        runSimulation(msg.config);
    }
});

async function runSimulation(config) {
    try {
        if (process.send)
            process.send({
                type: "progress",
                message: "Initializing Worker...",
                percent: 5,
            });

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
                message: "Fetching Data...",
                percent: 10,
            });

        db.all(query, STRATEGY.assets, async (err, rows) => {
            if (err) {
                if (process.send)
                    process.send({ type: "error", error: err.message });
                process.exit(1);
            }

            if (!rows || rows.length === 0) {
                if (process.send)
                    process.send({
                        type: "error",
                        error: "No historical data found. Have you run the fetch scripts?",
                    });
                process.exit(0);
            }

            if (process.send)
                process.send({
                    type: "progress",
                    message: `Processing ${rows.length} candles...`,
                    percent: 20,
                });

            // Run Logic
            const results = await executeStrategy(rows, STRATEGY);

            // Send final results
            if (process.send) process.send({ type: "result", data: results });
            process.exit(0); // Mission complete
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
    const previousStates = {};

    const totalCandles = rows.length;
    let processedCount = 0;

    for (const candle of rows) {
        processedCount++;

        // Report progress back to parent every ~5000 candles
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
            // Important: Yield to event loop to allow IPC message sending
            await new Promise((r) => setImmediate(r));
        }

        const sym = candle.symbol;
        const prevCandle = previousStates[sym];
        previousStates[sym] = candle;

        if (!prevCandle) continue;

        // 1. MANAGE EXITS
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

        // 2. MANAGE ENTRIES
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
