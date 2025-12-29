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

// Default weights if none provided
const ASSET_WEIGHTS = { ETHUSDT: 0.3, XRPUSDT: 0.3, BNBUSDT: 0.2 };

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
                    ? `⚠️ Force Rebuild Requested...`
                    : `⚠️ Data Auto-Initializing...`,
                percent: 0,
            });

        if (force && dbExists) {
            try {
                fs.unlinkSync(DB_PATH);
            } catch (e) {}
        }

        await runChildScript(FETCH_SCRIPT, "Downloading Candles");
        await runChildScript(BUILD_SCRIPT, "Building Database");

        if (process.send)
            process.send({
                type: "progress",
                message: "✅ Lab Ready.",
                percent: 10,
            });
    }
}

function runChildScript(scriptPath, actionName) {
    return new Promise((resolve, reject) => {
        const child = spawn("node", [scriptPath]);

        // Log stdout to help debug
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

        // FIXED: Catch Signals (like OOM Kill)
        child.on("close", (code, signal) => {
            if (code === 0) return resolve();
            if (signal)
                return reject(
                    new Error(
                        `${actionName} killed by signal: ${signal} (Likely Out of Memory)`
                    )
                );
            reject(new Error(`${actionName} failed with code: ${code}`));
        });
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
            assets:
                Array.isArray(config.assets) && config.assets.length > 0
                    ? config.assets
                    : ["BTCUSDT", "ETHUSDT"],
            days: parseInt(config.days) || 30,
            weights: config.weights || {},
        };

        const startTime = Date.now() - STRATEGY.days * 24 * 60 * 60 * 1000;
        const placeholders = STRATEGY.assets.map(() => "?").join(",");

        const query = `
            SELECT symbol, timestamp, open, high, low, close as price, 
                   adx, rsi, supertrend_direction 
            FROM market_state_15m 
            WHERE symbol IN (${placeholders}) 
            AND timestamp > ?
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
                if (err.message.includes("no such column")) {
                    if (process.send)
                        process.send({
                            type: "error",
                            error: "⚠️ Schema Error. Please click 'Restore'.",
                        });
                    process.exit(0);
                    return;
                }
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
                    message: `Simulating...`,
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

    // --- DYNAMIC ALLOCATION WEIGHTS ---
    let totalWeightInput = 0;
    strategy.assets.forEach((asset) => {
        totalWeightInput += strategy.weights[asset] || 0;
    });
    if (totalWeightInput === 0) {
        strategy.assets.forEach((asset) => {
            strategy.weights[asset] = 100 / strategy.assets.length;
            totalWeightInput += strategy.weights[asset];
        });
    }
    const normalizedWeights = {};
    strategy.assets.forEach((asset) => {
        normalizedWeights[asset] =
            (strategy.weights[asset] || 0) / totalWeightInput;
    });

    const latestPrices = {};
    strategy.assets.forEach((asset) => (latestPrices[asset] = 0));

    const previousStates = {};
    const totalCandles = rows.length;
    let processedCount = 0;

    for (const candle of rows) {
        processedCount++;
        if (processedCount % 5000 === 0 && process.send) {
            const pct = 25 + Math.round((processedCount / totalCandles) * 70);
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
        latestPrices[sym] = candle.price;
        const prevCandle = previousStates[sym];
        previousStates[sym] = candle;

        if (!prevCandle) continue;

        // --- EXITS ---
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

        // --- ENTRIES ---
        if (!positions[sym]) {
            const trendFlipGreen =
                prevCandle.supertrend_direction === -1 &&
                candle.supertrend_direction === 1;

            if (trendFlipGreen) {
                if (
                    candle.adx >= strategy.min_adx &&
                    candle.rsi <= strategy.max_rsi
                ) {
                    const weight = normalizedWeights[sym];
                    const investAmount =
                        balance * weight * strategy.trade_size_pct;

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

        // --- EQUITY ---
        if (Math.random() > 0.95) {
            let unrealized = 0;
            Object.keys(positions).forEach((posSym) => {
                const pos = positions[posSym];
                const currentMarketPrice =
                    latestPrices[posSym] || pos.entryPrice;
                unrealized += pos.quantity * currentMarketPrice;
            });
            equityCurve.push({
                time: candle.timestamp,
                value: balance + unrealized,
            });
        }
    }

    // --- FORCE CLOSE ---
    Object.keys(positions).forEach((posSym) => {
        const pos = positions[posSym];
        const finalPrice = latestPrices[posSym];
        const exitValue = pos.quantity * finalPrice;
        const fee = exitValue * 0.001;
        const netReturn = exitValue - fee;
        balance += netReturn;

        tradeHistory.push({
            id: tradeHistory.length + 1,
            symbol: posSym,
            entryPrice: pos.entryPrice,
            exitPrice: finalPrice,
            pnl: netReturn - pos.cost,
            pnlPercent: ((finalPrice - pos.entryPrice) / pos.entryPrice) * 100,
            reason: "END_OF_SIM",
            time: Date.now(),
        });
    });

    // --- STATS ---
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
            assetStats: Object.values(assetStats).sort((a, b) => b.pnl - a.pnl),
        },
        trades: tradeHistory.reverse().slice(0, 500),
        equityCurve,
    };
}
