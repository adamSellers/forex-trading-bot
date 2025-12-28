// backend/src/services/backtestEngine.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// SAFETY: Point explicitly to the LAB data
const DB_PATH = path.join(__dirname, "../../backtest_lab/data/market_data.db");

class BacktestEngine {
    constructor() {
        this.db = new sqlite3.Database(
            DB_PATH,
            sqlite3.OPEN_READONLY,
            (err) => {
                if (err)
                    console.error(
                        "❌ Backtest Engine: Connection Error:",
                        err.message
                    );
            }
        );
    }

    async runSimulation(config, notifyProgress = () => {}) {
        return new Promise((resolve, reject) => {
            notifyProgress({ message: "Initializing...", percent: 5 });

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

            const placeholders = STRATEGY.assets.map(() => "?").join(",");
            const query = `SELECT * FROM market_state_15m WHERE symbol IN (${placeholders}) ORDER BY timestamp ASC`;

            notifyProgress({
                message: "Fetching Historical Data...",
                percent: 10,
            });

            this.db.all(query, STRATEGY.assets, async (err, rows) => {
                if (err) return reject(err);
                if (!rows || rows.length === 0)
                    return resolve({ error: "No historical data found." });

                notifyProgress({
                    message: `Loaded ${rows.length} candles. Starting Simulation...`,
                    percent: 20,
                });

                try {
                    // Use await here to allow the async loop to report progress
                    const results = await this.executeStrategyAsync(
                        rows,
                        STRATEGY,
                        notifyProgress
                    );
                    resolve(results);
                } catch (simError) {
                    reject(simError);
                }
            });
        });
    }

    // UPDATED: Async version that yields to Event Loop to allow socket emissions
    async executeStrategyAsync(rows, strategy, notifyProgress) {
        let balance = strategy.initial_balance;
        let positions = {};
        let tradeHistory = [];
        let equityCurve = [];
        const previousStates = {};

        const totalCandles = rows.length;
        let processedCount = 0;

        for (const candle of rows) {
            processedCount++;

            // YIELD: Every 2000 candles, pause for 0ms to let Node.js handle I/O (Socket emits)
            if (processedCount % 2000 === 0) {
                const pct =
                    20 + Math.round((processedCount / totalCandles) * 70); // Map 0-100% to 20-90% range
                notifyProgress({
                    message: `Simulating... (${Math.round(
                        (processedCount / totalCandles) * 100
                    )}%)`,
                    percent: pct,
                });
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

            // 3. SAMPLE EQUITY CURVE
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

        notifyProgress({ message: "Compiling Results...", percent: 95 });

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
}

module.exports = new BacktestEngine();
