// backend/src/workers/backtestWorker.js - V3.2.6 LIVE PARITY FIX
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const LAB_DIR = path.join(__dirname, "../../backtest_lab");
const DB_PATH = path.join(LAB_DIR, "data/market_data.db");
const FETCH_SCRIPT = path.join(LAB_DIR, "fetch_candles.js");
const BUILD_SCRIPT = path.join(LAB_DIR, "build_15m_dataset.js");
const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

// --- WORKER ENTRY POINT ---
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

            // Run and Wait
            const results = await runSimulation(db, msg.config);

            // Send Results & Exit
            if (process.send) process.send({ type: "result", data: results });
            db.close();
            process.exit(0);
        } catch (error) {
            if (process.send)
                process.send({ type: "error", error: error.message });
            process.exit(1);
        }
    }
});

// --- HELPER: DATA SYNC ---
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

// --- CORE LOGIC: PROMISIFIED ---
function runSimulation(db, config) {
    return new Promise((resolve, reject) => {
        try {
            if (process.send)
                process.send({
                    type: "progress",
                    message: "Initializing...",
                    percent: 10,
                });

            // FIX #6: Strategy config now mirrors LiveTradingEngine defaults exactly
            const STRATEGY = {
                // Entry Filters (match signalGenerator.js defaults)
                min_adx: parseFloat(config.minAdx) || 22,
                rsi_overbought:
                    parseFloat(config.rsiOverbought || config.maxRsi) || 75, // FIX: Was 70!
                rsi_oversold: parseFloat(config.rsiOversold) || 30,

                // Position Sizing (match LiveTradingEngine.js)
                initial_balance: parseFloat(config.balance) || 1000,
                trade_size_pct: parseFloat(config.riskPerTrade) || 0.02,
                max_portfolio_exposure:
                    parseFloat(config.maxPortfolioExposure) || 0.5,

                // Stop Loss (match LiveTradingEngine.js)
                stop_loss_type: config.stopLossType || "ATR",
                stop_loss_pct:
                    (parseFloat(config.stopLoss || config.stopLossPercent) ||
                        2.0) / 100,
                stop_loss_atr: parseFloat(config.stopLossATR) || 2.0,

                // Trailing Stops
                enable_trailing: config.enableTrailingStops === true,
                trailing_pct: parseFloat(config.trailingStopPercent) || 0.03,

                // FIX #6: Continuation Entry settings (match signalGenerator.js)
                enable_continuation: config.enableContinuationEntry !== false, // Default true
                continuation_window_ms:
                    parseInt(config.continuationWindowMs) || 4 * 60 * 60 * 1000,
                continuation_rsi:
                    parseFloat(config.continuationRsiThreshold) || 70,
                continuation_max_deviation:
                    parseFloat(config.continuationMaxPriceDeviation) || 0.02,

                // FIX #6: Realistic fee tiers (Binance spot)
                fee_tier: config.feeTier || "standard", // 'vip0', 'vip1', 'bnb_discount', 'standard'

                // FIX #6: Slippage simulation
                enable_slippage: config.enableSlippage !== false, // Default true
                slippage_pct: parseFloat(config.slippagePct) || 0.0005, // 0.05% default

                // Legacy burst mode
                burst_mode:
                    config.burstMode === true || config.burstMode === "true",

                assets:
                    Array.isArray(config.assets) && config.assets.length > 0
                        ? config.assets
                        : ["AUD_USD", "EUR_USD"],
                days: parseInt(config.days) || 30,
                weights: config.weights || {},
            };

            const startTime = Date.now() - STRATEGY.days * 24 * 60 * 60 * 1000;
            const placeholders = STRATEGY.assets.map(() => "?").join(",");

            // FIX #6: Also fetch ATR for ATR-based stops
            const query = `
                SELECT symbol, timestamp, open, high, low, close as price, 
                       adx, rsi, supertrend_direction, atr
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

            // DB QUERY
            db.all(
                query,
                [...STRATEGY.assets, startTime],
                async (err, rows) => {
                    if (err) return reject(err);

                    if (!rows || rows.length === 0) {
                        return resolve({
                            stats: {
                                netProfit: 0,
                                winRate: 0,
                                totalTrades: 0,
                                finalBalance: STRATEGY.initial_balance,
                                assetStats: [],
                            },
                            trades: [],
                            equityCurve: [],
                        });
                    }

                    if (process.send)
                        process.send({
                            type: "progress",
                            message: `Simulating ${rows.length.toLocaleString()} candles...`,
                            percent: 25,
                        });

                    // Execute Strategy logic
                    const results = await executeStrategy(rows, STRATEGY);
                    resolve(results);
                }
            );
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * FIX #6: Calculate realistic fee based on tier
 */
function calculateFee(amount, tier) {
    const feeRates = {
        vip0: 0.001, // 0.10% - Standard
        vip1: 0.0009, // 0.09%
        vip2: 0.0008, // 0.08%
        bnb_discount: 0.00075, // 0.075% - BNB 25% discount
        standard: 0.001, // 0.10%
    };
    const rate = feeRates[tier] || feeRates["standard"];
    return amount * rate;
}

/**
 * FIX #6: Simulate slippage on entry/exit
 */
function applySlippage(price, isBuy, slippagePct, enableSlippage) {
    if (!enableSlippage) return price;

    // Random slippage between 0 and max slippage
    const randomFactor = Math.random() * slippagePct;

    if (isBuy) {
        // Buys execute slightly higher (worse for us)
        return price * (1 + randomFactor);
    } else {
        // Sells execute slightly lower (worse for us)
        return price * (1 - randomFactor);
    }
}

/**
 * FIX #6: Simulate stop loss gap-through
 * In real markets, price can gap below your stop
 */
function simulateStopExecution(
    stopPrice,
    candleLow,
    enableSlippage,
    slippagePct
) {
    if (!enableSlippage) return stopPrice;

    // If candle low is below stop, we might exit at the low (gap-through)
    if (candleLow < stopPrice) {
        // 50% chance of filling at candle low vs stop price
        if (Math.random() < 0.5) {
            return candleLow;
        }
    }
    return stopPrice;
}

async function executeStrategy(rows, strategy) {
    let balance = strategy.initial_balance;
    let positions = {};
    let tradeHistory = [];
    let equityCurve = [];

    // FIX #6: Track total fees for reporting
    let totalFeesPaid = 0;

    // FIX #6: Pending entries for continuation logic (mirrors signalGenerator.js)
    let pendingEntries = {};

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
        // Throttle progress updates
        if (processedCount % 15000 === 0 && process.send) {
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

            // Update highest price for trailing stop
            if (candle.price > pos.highestPrice) {
                pos.highestPrice = candle.price;
                if (strategy.enable_trailing) {
                    pos.trailingStopPrice =
                        pos.highestPrice * (1 - strategy.trailing_pct);
                }
            }

            // FIX #6: Check stop loss with gap-through simulation
            if (candle.low <= pos.stopLoss) {
                closeReason = "STOP_LOSS";
                exitPrice = simulateStopExecution(
                    pos.stopLoss,
                    candle.low,
                    strategy.enable_slippage,
                    strategy.slippage_pct
                );
            } else if (
                strategy.enable_trailing &&
                candle.low <= pos.trailingStopPrice
            ) {
                closeReason = "TRAILING_STOP";
                exitPrice = simulateStopExecution(
                    pos.trailingStopPrice,
                    candle.low,
                    strategy.enable_slippage,
                    strategy.slippage_pct
                );
            } else if (candle.supertrend_direction === -1) {
                closeReason = "TREND_FLIP";
                // FIX #6: Apply slippage on trend flip exit
                exitPrice = applySlippage(
                    candle.price,
                    false, // isBuy = false (selling)
                    strategy.slippage_pct,
                    strategy.enable_slippage
                );
            }

            if (closeReason) {
                const exitValue = pos.quantity * exitPrice;
                // FIX #6: Realistic fee calculation
                const fee = calculateFee(exitValue, strategy.fee_tier);
                const netReturn = exitValue - fee;
                balance += netReturn;
                totalFeesPaid += fee;

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
                    entryType: pos.entryType, // FIX #6: Track if it was continuation
                    fees: pos.entryFee + fee,
                });
                delete positions[sym];
            }
        }

        // --- ENTRIES ---
        if (!positions[sym]) {
            const trendFlipGreen =
                prevCandle.supertrend_direction === -1 &&
                candle.supertrend_direction === 1;

            const trendIsGreen = candle.supertrend_direction === 1;
            const adxOk = candle.adx >= strategy.min_adx;
            const rsiOkForFresh = candle.rsi <= strategy.rsi_overbought;
            const rsiOkForContinuation =
                candle.rsi <= strategy.continuation_rsi;

            let shouldEnter = false;
            let entryType = null;

            // PRIMARY ENTRY: Fresh SuperTrend Flip
            if (trendFlipGreen) {
                const isStandard = adxOk;
                const isBurst = candle.adx >= 15 && candle.rsi > 50;
                const entrySignal = strategy.burst_mode
                    ? isStandard || isBurst
                    : isStandard;

                if (entrySignal && rsiOkForFresh) {
                    shouldEnter = true;
                    entryType = "FRESH_FLIP";
                    // Clear any pending entry
                    delete pendingEntries[sym];
                } else if (
                    entrySignal &&
                    !rsiOkForFresh &&
                    strategy.enable_continuation
                ) {
                    // ADX good but RSI too high - mark as pending
                    pendingEntries[sym] = {
                        flipTime: candle.timestamp,
                        flipPrice: candle.price,
                        flipAdx: candle.adx,
                        flipRsi: candle.rsi,
                    };
                }
            }
            // FIX #6: CONTINUATION ENTRY
            else if (
                trendIsGreen &&
                strategy.enable_continuation &&
                pendingEntries[sym]
            ) {
                const pending = pendingEntries[sym];
                const ageMs = candle.timestamp - pending.flipTime;

                // Check if window expired
                if (ageMs > strategy.continuation_window_ms) {
                    delete pendingEntries[sym];
                } else {
                    const priceDeviation =
                        (candle.price - pending.flipPrice) / pending.flipPrice;
                    const priceOk =
                        priceDeviation <= strategy.continuation_max_deviation;

                    if (adxOk && rsiOkForContinuation && priceOk) {
                        shouldEnter = true;
                        entryType = "CONTINUATION";
                        delete pendingEntries[sym];
                    } else if (!priceOk) {
                        // Price moved too far, cancel
                        delete pendingEntries[sym];
                    }
                }
            }

            // Clear pending on trend reversal
            if (candle.supertrend_direction === -1) {
                delete pendingEntries[sym];
            }

            if (shouldEnter) {
                // FIX #6: Calculate current exposure BEFORE sizing
                let currentEquity = balance;
                let currentExposure = 0;
                Object.keys(positions).forEach((pKey) => {
                    const p = positions[pKey];
                    const val =
                        p.quantity * (latestPrices[pKey] || p.entryPrice);
                    currentEquity += val;
                    currentExposure += val;
                });

                const exposureRatio =
                    currentEquity > 0 ? currentExposure / currentEquity : 0;
                const remainingExposure = Math.max(
                    0,
                    strategy.max_portfolio_exposure - exposureRatio
                );

                // FIX #6: Skip if exposure cap reached
                if (remainingExposure <= 0.01) {
                    continue; // Can't open more positions
                }

                // Target allocation (capped by remaining exposure)
                const weight = normalizedWeights[sym];
                const targetByAllocation =
                    currentEquity * weight * strategy.trade_size_pct;
                const targetByCapacity = currentEquity * remainingExposure;
                let investAmount = Math.min(
                    targetByAllocation,
                    targetByCapacity
                );

                // Cash constraint
                if (investAmount > balance) {
                    investAmount = balance * 0.99;
                }

                if (investAmount > 10) {
                    // FIX #6: Apply slippage to entry price
                    const entryPrice = applySlippage(
                        candle.price,
                        true, // isBuy = true
                        strategy.slippage_pct,
                        strategy.enable_slippage
                    );

                    // FIX #6: Realistic fee
                    const fee = calculateFee(investAmount, strategy.fee_tier);
                    const netInvest = investAmount - fee;
                    totalFeesPaid += fee;

                    // FIX #6: Calculate stop loss based on type
                    let stopLoss;
                    if (strategy.stop_loss_type === "ATR" && candle.atr) {
                        stopLoss =
                            entryPrice - candle.atr * strategy.stop_loss_atr;
                    } else {
                        stopLoss = entryPrice * (1 - strategy.stop_loss_pct);
                    }

                    positions[sym] = {
                        entryPrice: entryPrice,
                        quantity: netInvest / entryPrice,
                        cost: investAmount,
                        stopLoss: stopLoss,
                        highestPrice: entryPrice,
                        trailingStopPrice:
                            entryPrice * (1 - strategy.trailing_pct),
                        entryType: entryType, // FIX #6: Track entry type
                        entryFee: fee,
                    };
                    balance -= investAmount;
                }
            }
        }

        // Equity sampling for chart
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

    // Close remaining positions at end
    Object.keys(positions).forEach((posSym) => {
        const pos = positions[posSym];
        const finalPrice = latestPrices[posSym];
        const exitValue = pos.quantity * finalPrice;
        const fee = calculateFee(exitValue, strategy.fee_tier);
        balance += exitValue - fee;
        totalFeesPaid += fee;

        tradeHistory.push({
            id: tradeHistory.length,
            symbol: posSym,
            entryPrice: pos.entryPrice,
            exitPrice: finalPrice,
            pnl: exitValue - fee - pos.cost,
            pnlPercent: ((finalPrice - pos.entryPrice) / pos.entryPrice) * 100,
            reason: "END_OF_SIM",
            time: Date.now(),
            entryType: pos.entryType,
            fees: pos.entryFee + fee,
        });
    });

    // Calculate per-asset stats
    const assetStats = {};
    strategy.assets.forEach(
        (a) =>
            (assetStats[a] = {
                symbol: a,
                trades: 0,
                wins: 0,
                pnl: 0,
                continuationTrades: 0,
            })
    );
    tradeHistory.forEach((t) => {
        if (!assetStats[t.symbol])
            assetStats[t.symbol] = {
                symbol: t.symbol,
                trades: 0,
                wins: 0,
                pnl: 0,
                continuationTrades: 0,
            };
        assetStats[t.symbol].trades++;
        assetStats[t.symbol].pnl += t.pnl;
        if (t.pnl > 0) assetStats[t.symbol].wins++;
        if (t.entryType === "CONTINUATION")
            assetStats[t.symbol].continuationTrades++;
    });

    const winningTrades = tradeHistory.filter((t) => t.pnl > 0);
    const winRate =
        tradeHistory.length > 0
            ? (winningTrades.length / tradeHistory.length) * 100
            : 0;

    // FIX #6: Count continuation trades
    const continuationTrades = tradeHistory.filter(
        (t) => t.entryType === "CONTINUATION"
    ).length;
    const freshFlipTrades = tradeHistory.filter(
        (t) => t.entryType === "FRESH_FLIP"
    ).length;

    return {
        stats: {
            initialBalance: strategy.initial_balance,
            finalBalance: balance,
            netProfit: balance - strategy.initial_balance,
            totalTrades: tradeHistory.length,
            winRate,
            // FIX #6: New stats for live parity verification
            totalFees: totalFeesPaid,
            continuationTrades,
            freshFlipTrades,
            avgFeePerTrade:
                tradeHistory.length > 0
                    ? totalFeesPaid / tradeHistory.length
                    : 0,
            assetStats: Object.values(assetStats).sort((a, b) => b.pnl - a.pnl),
        },
        trades: tradeHistory.reverse().slice(0, 500),
        equityCurve,
        // FIX #6: Include config used for verification
        configUsed: {
            feeTier: strategy.fee_tier,
            slippageEnabled: strategy.enable_slippage,
            slippagePct: strategy.slippage_pct,
            continuationEnabled: strategy.enable_continuation,
            maxExposure: strategy.max_portfolio_exposure,
            stopLossType: strategy.stop_loss_type,
            rsiOverbought: strategy.rsi_overbought,
        },
    };
}

module.exports = { runSimulation };
