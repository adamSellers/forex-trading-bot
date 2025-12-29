// backend/src/workers/backtestWorker.js - FIXED POSITION SIZING
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const LAB_DIR = path.join(__dirname, "../../backtest_lab");
const DB_PATH = path.join(LAB_DIR, "data/market_data.db");
const FETCH_SCRIPT = path.join(LAB_DIR, "fetch_candles.js");
const BUILD_SCRIPT = path.join(LAB_DIR, "build_15m_dataset.js");
const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

process.on("message", async (msg) => {
    if (msg.command === "start") {
        try {
            const forceRebuild = msg.config && msg.config.forceRebuild === true;
            await ensureLabData(forceRebuild);
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

async function ensureLabData(force = false) {
    const dbExists = fs.existsSync(DB_PATH);
    let isStale = false;
    if (dbExists) {
        const stats = fs.statSync(DB_PATH);
        if (Date.now() - stats.mtimeMs > STALE_THRESHOLD) isStale = true;
    }
    if (!dbExists || isStale || force) {
        if (process.send)
            process.send({
                type: "progress",
                message: force
                    ? `⚠️ Force Rebuild...`
                    : `⚠️ Auto-Initializing...`,
                percent: 0,
            });
        if (force && dbExists) {
            try {
                fs.unlinkSync(DB_PATH);
            } catch (e) {}
        }
        await runChildScript(FETCH_SCRIPT, "Downloading Candles");
        await runChildScript(BUILD_SCRIPT, "Building Database");
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
                percent: 10,
            });

        const STRATEGY = {
            min_adx: parseFloat(config.minAdx) || 25,
            max_rsi: parseFloat(config.maxRsi) || 70,
            stop_loss_pct: (parseFloat(config.stopLoss) || 2.0) / 100,
            initial_balance: parseFloat(config.balance) || 1000,
            trade_size_pct: parseFloat(config.riskPerTrade) || 0.95,

            // Burst Mode Logic
            burst_mode:
                config.burstMode === true || config.burstMode === "true",

            // Trailing Stop Logic
            enable_trailing: config.enableTrailingStops === true,
            trailing_pct: (parseFloat(config.trailingStopPercent) || 3.0) / 100,

            assets:
                Array.isArray(config.assets) && config.assets.length > 0
                    ? config.assets
                    : ["BTCUSDT"],
            days: parseInt(config.days) || 30,
            weights: config.weights || {},
        };

        const startTime = Date.now() - STRATEGY.days * 24 * 60 * 60 * 1000;
        const placeholders = STRATEGY.assets.map(() => "?").join(",");
        const query = `
            SELECT symbol, timestamp, open, high, low, close as price, 
                   adx, rsi, supertrend_direction 
            FROM market_state_15m 
            WHERE symbol IN (${placeholders}) AND timestamp > ?
            ORDER BY timestamp ASC
        `;

        if (process.send)
            process.send({
                type: "progress",
                message: "Fetching Data...",
                percent: 15,
            });

        db.all(query, [...STRATEGY.assets, startTime], async (err, rows) => {
            if (err) {
                if (process.send)
                    process.send({ type: "error", error: err.message });
                process.exit(1);
            }
            if (!rows || rows.length === 0) {
                if (process.send)
                    process.send({ type: "error", error: "No data found." });
                process.exit(0);
            }
            if (process.send)
                process.send({
                    type: "progress",
                    message: `Simulating... (Burst:${STRATEGY.burst_mode}, Trail:${STRATEGY.enable_trailing})`,
                    percent: 25,
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

    // Normalize weights
    let totalWeightInput = 0;
    strategy.assets.forEach((asset) => {
        totalWeightInput += strategy.weights[asset] || 0;
    });
    if (totalWeightInput === 0) {
        strategy.assets.forEach(
            (asset) => (strategy.weights[asset] = 100 / strategy.assets.length)
        );
        totalWeightInput = 100;
    }
    const normalizedWeights = {};
    strategy.assets.forEach((asset) => {
        normalizedWeights[asset] =
            (strategy.weights[asset] || 0) / totalWeightInput;
    });

    const latestPrices = {};
    const previousStates = {};
    const totalCandles = rows.length;
    let processedCount = 0;

    for (const candle of rows) {
        processedCount++;
        if (processedCount % 10000 === 0 && process.send) {
            process.send({
                type: "progress",
                message: `Simulating...`,
                percent: 25 + Math.round((processedCount / totalCandles) * 70),
            });
            await new Promise((r) => setImmediate(r));
        }

        const sym = candle.symbol;
        latestPrices[sym] = candle.price;
        const prevCandle = previousStates[sym];
        previousStates[sym] = candle;

        if (!prevCandle) continue;

        // --- EXITS ---
        if (positions[sym]) {
            const pos = positions[sym];
            let closeReason = null;
            let exitPrice = candle.price;

            if (candle.price > pos.highestPrice) {
                pos.highestPrice = candle.price;
                if (strategy.enable_trailing) {
                    pos.trailingStopPrice =
                        pos.highestPrice * (1 - strategy.trailing_pct);
                }
            }

            if (candle.price <= pos.stopLoss) {
                closeReason = "STOP_LOSS";
                exitPrice = pos.stopLoss;
            } else if (
                strategy.enable_trailing &&
                candle.price <= pos.trailingStopPrice
            ) {
                closeReason = "TRAILING_STOP";
                exitPrice = pos.trailingStopPrice;
            } else if (candle.supertrend_direction === -1) {
                closeReason = "TREND_FLIP";
            }

            if (closeReason) {
                const exitValue = pos.quantity * exitPrice;
                const fee = exitValue * 0.001;
                const netReturn = exitValue - fee;
                balance += netReturn;

                tradeHistory.push({
                    id: tradeHistory.length + 1,
                    symbol: sym,
                    entryPrice: pos.entryPrice,
                    exitPrice: exitPrice,
                    pnl: netReturn - pos.cost,
                    pnlPercent:
                        ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100,
                    reason: closeReason,
                    time: candle.timestamp,
                });
                delete positions[sym];
            }
        }

        // --- ENTRIES (FIXED SIZING) ---
        if (!positions[sym]) {
            const trendFlipGreen =
                prevCandle.supertrend_direction === -1 &&
                candle.supertrend_direction === 1;

            if (trendFlipGreen) {
                const isStandard = candle.adx >= strategy.min_adx;
                const isBurst = candle.adx >= 15 && candle.rsi > 50;
                const entrySignal = strategy.burst_mode
                    ? isStandard || isBurst
                    : isStandard;
                const isSafeRsi = candle.rsi <= strategy.max_rsi;

                if (entrySignal && isSafeRsi) {
                    // --- 🐛 SIZING FIX START ---

                    // 1. Calculate Total Equity (Cash + Value of all open positions)
                    let currentEquity = balance;
                    Object.keys(positions).forEach((pKey) => {
                        const p = positions[pKey];
                        // Use latest known price for that asset, or entry if price missing
                        const val =
                            p.quantity * (latestPrices[pKey] || p.entryPrice);
                        currentEquity += val;
                    });

                    // 2. Calculate Target Allocation based on EQUITY, not just Cash
                    const weight = normalizedWeights[sym];
                    let investAmount =
                        currentEquity * weight * strategy.trade_size_pct;

                    // 3. Cap at available cash (cannot spend what we don't have)
                    if (investAmount > balance) {
                        investAmount = balance * 0.99; // 99% of cash to leave dust room
                    }

                    // --- 🐛 SIZING FIX END ---

                    if (investAmount > 10) {
                        const fee = investAmount * 0.001;
                        const netInvest = investAmount - fee;
                        positions[sym] = {
                            entryPrice: candle.price,
                            quantity: netInvest / candle.price,
                            cost: investAmount,
                            stopLoss:
                                candle.price * (1 - strategy.stop_loss_pct),
                            highestPrice: candle.price,
                            trailingStopPrice:
                                candle.price * (1 - strategy.trailing_pct),
                        };
                        balance -= investAmount;
                    }
                }
            }
        }

        if (Math.random() > 0.95) {
            let unrealized = 0;
            Object.keys(positions).forEach(
                (p) =>
                    (unrealized +=
                        positions[p].quantity *
                        (latestPrices[p] || positions[p].entryPrice))
            );
            equityCurve.push({
                time: candle.timestamp,
                value: balance + unrealized,
            });
        }
    }

    Object.keys(positions).forEach((posSym) => {
        const pos = positions[posSym];
        const finalPrice = latestPrices[posSym];
        const exitValue = pos.quantity * finalPrice;
        balance += exitValue - exitValue * 0.001;
        tradeHistory.push({
            id: tradeHistory.length,
            symbol: posSym,
            entryPrice: pos.entryPrice,
            exitPrice: finalPrice,
            pnl: exitValue - exitValue * 0.001 - pos.cost,
            pnlPercent: ((finalPrice - pos.entryPrice) / pos.entryPrice) * 100,
            reason: "END_OF_SIM",
            time: Date.now(),
        });
    });

    const assetStats = {};
    strategy.assets.forEach(
        (a) => (assetStats[a] = { symbol: a, trades: 0, wins: 0, pnl: 0 })
    );
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
            winRate,
            assetStats: Object.values(assetStats).sort((a, b) => b.pnl - a.pnl),
        },
        trades: tradeHistory.reverse().slice(0, 500),
        equityCurve,
    };
}

module.exports = { runSimulation };
