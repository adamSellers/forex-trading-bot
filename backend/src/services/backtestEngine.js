// backend/src/services/backtestEngine.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// SAFETY: Point explicitly to the LAB data, distinct from live trading DB
const DB_PATH = path.join(__dirname, "../../backtest_lab/data/market_data.db");

class BacktestEngine {
    constructor() {
        // Open in Read-Only mode for extra safety
        this.db = new sqlite3.Database(
            DB_PATH,
            sqlite3.OPEN_READONLY,
            (err) => {
                if (err) {
                    console.error(
                        "❌ Backtest Engine: Could not connect to Lab DB:",
                        err.message
                    );
                } else {
                    console.log(
                        "🧪 Backtest Engine connected to historical data."
                    );
                }
            }
        );
    }

    /**
     * Main entry point called by the API.
     * Parses the frontend config and runs the simulation.
     */
    async runSimulation(config) {
        return new Promise((resolve, reject) => {
            // 1. Parse & Sanitize Config
            const STRATEGY = {
                min_adx: parseFloat(config.minAdx) || 25,
                max_rsi: parseFloat(config.maxRsi) || 70,
                stop_loss_pct: (parseFloat(config.stopLoss) || 2.0) / 100,
                initial_balance: parseFloat(config.balance) || 1000,
                trade_size_pct: parseFloat(config.riskPerTrade) || 0.95,
                assets:
                    Array.isArray(config.assets) && config.assets.length > 0
                        ? config.assets
                        : [
                              "BTCUSDT",
                              "ETHUSDT",
                              "BNBUSDT",
                              "XRPUSDT",
                              "NEARUSDT",
                          ],
            };

            // 2. Fetch Historical Data
            // We select only the assets requested to keep it fast
            const placeholders = STRATEGY.assets.map(() => "?").join(",");
            const query = `
                SELECT * FROM market_state_15m 
                WHERE symbol IN (${placeholders}) 
                ORDER BY timestamp ASC
            `;

            this.db.all(query, STRATEGY.assets, (err, rows) => {
                if (err)
                    return reject(new Error("DB Query Error: " + err.message));

                if (!rows || rows.length === 0) {
                    return resolve({
                        error: "No historical data found. Have you run 'node build_15m_dataset.js'?",
                    });
                }

                // 3. Execute Core Logic (In-Memory)
                try {
                    const results = this.executeStrategy(rows, STRATEGY);
                    resolve(results);
                } catch (simError) {
                    reject(simError);
                }
            });
        });
    }

    /**
     * The Mathematical Core.
     * Simulates the strategy candle-by-candle.
     */
    executeStrategy(rows, strategy) {
        let balance = strategy.initial_balance;
        let positions = {}; // Active positions: { "BTCUSDT": { entryPrice, quantity, ... } }
        let tradeHistory = []; // Completed trades
        let equityCurve = []; // For charting { time, value }

        // We need to track the "previous" candle for every symbol to detect crossovers
        const previousStates = {};

        // Loop through every 15m candle in chronological order
        for (const candle of rows) {
            const sym = candle.symbol;
            const prevCandle = previousStates[sym];
            previousStates[sym] = candle;

            // Cannot trade without a previous candle for comparison
            if (!prevCandle) continue;

            // --- 1. MANAGE ACTIVE POSITIONS (EXITS) ---
            if (positions[sym]) {
                const pos = positions[sym];
                let closeReason = null;
                let exitPrice = candle.price;

                // A. Check Stop Loss
                if (candle.price <= pos.stopLoss) {
                    closeReason = "STOP_LOSS";
                    exitPrice = pos.stopLoss; // Assume worst-case fill
                }
                // B. Check Trend Reversal (SuperTrend flips to Bearish/Red)
                // Note: -1 = Bearish, 1 = Bullish
                else if (candle.supertrend_direction === -1) {
                    closeReason = "TREND_FLIP";
                }

                if (closeReason) {
                    // Execute Sell
                    const exitValue = pos.quantity * exitPrice;
                    const fee = exitValue * 0.001; // 0.1% Exchange Fee
                    const netReturn = exitValue - fee;
                    const pnl = netReturn - pos.cost; // Net Profit/Loss ($)
                    const pnlPercent = (netReturn / pos.cost - 1) * 100;

                    balance += netReturn;

                    tradeHistory.push({
                        id: tradeHistory.length + 1,
                        symbol: sym,
                        entryPrice: pos.entryPrice,
                        exitPrice: exitPrice,
                        pnl: pnl,
                        pnlPercent: pnlPercent,
                        reason: closeReason,
                        time: candle.timestamp,
                        isWin: pnl > 0,
                    });

                    delete positions[sym];
                }
            }

            // --- 2. CHECK NEW ENTRIES (BUYS) ---
            if (!positions[sym]) {
                // Logic: SuperTrend flips from Red (-1) to Green (1)
                const trendFlipGreen =
                    prevCandle.supertrend_direction === -1 &&
                    candle.supertrend_direction === 1;

                if (trendFlipGreen) {
                    // Filter: ADX Strength & RSI Overbought
                    if (
                        candle.adx >= strategy.min_adx &&
                        candle.rsi <= strategy.max_rsi
                    ) {
                        // Sizing: Use X% of current balance
                        const investAmount = balance * strategy.trade_size_pct;

                        // Min trade size safety (e.g. $10)
                        if (investAmount > 10) {
                            const fee = investAmount * 0.001; // 0.1% Entry Fee
                            const netInvest = investAmount - fee;
                            const quantity = netInvest / candle.price;

                            positions[sym] = {
                                entryPrice: candle.price,
                                quantity: quantity,
                                cost: investAmount, // Cost basis includes the fee paid
                                stopLoss:
                                    candle.price * (1 - strategy.stop_loss_pct),
                            };

                            balance -= investAmount;
                        }
                    }
                }
            }

            // --- 3. RECORD EQUITY CURVE ---
            // To keep the chart performant, we don't record every single 15m candle.
            // We sample roughly every 4 hours (1 in 16 candles) or on trade events.
            if (Math.random() > 0.94) {
                let unrealizedValue = 0;
                Object.values(positions).forEach((p) => {
                    unrealizedValue += p.quantity * candle.price;
                });

                equityCurve.push({
                    time: candle.timestamp,
                    value: balance + unrealizedValue,
                });
            }
        }

        // --- 4. COMPILE RESULTS ---
        const winningTrades = tradeHistory.filter((t) => t.pnl > 0);
        const winRate =
            tradeHistory.length > 0
                ? (winningTrades.length / tradeHistory.length) * 100
                : 0;
        const netProfit = balance - strategy.initial_balance;
        const profitPercent = (netProfit / strategy.initial_balance) * 100;

        return {
            stats: {
                initialBalance: strategy.initial_balance,
                finalBalance: balance,
                netProfit: netProfit,
                profitPercent: profitPercent,
                totalTrades: tradeHistory.length,
                winRate: winRate,
                avgTrade:
                    tradeHistory.length > 0
                        ? netProfit / tradeHistory.length
                        : 0,
            },
            // Return the most recent 500 trades to keep payload light
            trades: tradeHistory.reverse().slice(0, 500),
            equityCurve,
        };
    }
}

module.exports = new BacktestEngine();
