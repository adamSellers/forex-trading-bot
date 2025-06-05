// backend/src/services/paperTradingEngine.js
const EventEmitter = require("events");

class PaperTradingEngine extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            startingCapital: config.startingCapital || 5000,
            riskPerTrade: config.riskPerTrade || 0.01, // 1% = $50
            maxDailyLoss: config.maxDailyLoss || 0.02, // 2% = $100
            maxWeeklyLoss: config.maxWeeklyLoss || 0.05, // 5% = $250
            allocation: config.allocation || {
                BTCUSDT: 0.35,
                ETHUSDT: 0.35,
                BNBUSDT: 0.2,
                DOGEUSDT: 0.1,
            },
            maxPositionsPerAsset: config.maxPositionsPerAsset || 1,
            minOrderSize: config.minOrderSize || 10,
            stopLossATR: config.stopLossATR || 1.5,
            enableTrading: config.enableTrading || false,
            ...config,
        };

        // Portfolio state - USDT-based accounting
        this.portfolio = {
            usdtBalance: this.config.startingCapital, // Available USDT
            totalValue: this.config.startingCapital, // USDT + crypto values
            positions: new Map(), // Active crypto positions
            dailyPnL: 0,
            weeklyPnL: 0,
            totalPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };

        // Trading state
        this.tradeHistory = [];
        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
        };

        // Risk management
        this.riskLimits = {
            dailyLossLimit:
                this.config.startingCapital * this.config.maxDailyLoss,
            weeklyLossLimit:
                this.config.startingCapital * this.config.maxWeeklyLoss,
            isHalted: false,
            haltReason: null,
        };

        this.isActive = false;
        console.log(
            "📊 Paper Trading Engine initialized with " +
                this.config.startingCapital +
                " USDT"
        );
    }

    /**
     * Process a trading signal and execute if conditions are met
     */
    async processSignal(signal, currentPrice, atrValue = null) {
        try {
            if (!this.isActive || !this.config.enableTrading) {
                return {
                    success: false,
                    reason: "Trading engine not active or trading disabled",
                    signal,
                };
            }

            // Check risk limits
            if (this.riskLimits.isHalted) {
                return {
                    success: false,
                    reason: `Trading halted: ${this.riskLimits.haltReason}`,
                    signal,
                };
            }

            // Reset daily/weekly counters if needed
            this.checkAndResetCounters();

            // Validate signal
            if (!this.isValidSignal(signal)) {
                return {
                    success: false,
                    reason: "Invalid or weak signal",
                    signal,
                };
            }

            const { symbol } = signal;
            const currentPosition = this.portfolio.positions.get(symbol);

            // Determine action based on signal and current position
            if (signal.signal.includes("BUY") && !currentPosition) {
                return await this.executeBuyOrder(
                    symbol,
                    currentPrice,
                    signal,
                    atrValue
                );
            } else if (signal.signal.includes("SELL") && currentPosition) {
                return await this.executeSellOrder(
                    symbol,
                    currentPrice,
                    signal,
                    currentPosition
                );
            } else if (signal.signal === "HOLD") {
                return {
                    success: true,
                    action: "HOLD",
                    reason: "Signal indicates hold position",
                    signal,
                };
            }

            return {
                success: false,
                reason: "No action taken - signal does not match current position state",
                signal,
            };
        } catch (error) {
            console.error("Error processing signal:", error);
            return {
                success: false,
                reason: error.message,
                signal,
            };
        }
    }

    /**
     * Execute buy order - Convert USDT to Crypto
     */
    async executeBuyOrder(symbol, currentPrice, signal, atrValue) {
        try {
            // Check if we already have max positions for this asset
            const existingPosition = this.portfolio.positions.get(symbol);
            if (existingPosition) {
                return {
                    success: false,
                    reason: "Maximum positions already held for this asset",
                    signal,
                };
            }

            // Calculate position size based on risk management
            const positionSize = this.calculateBuyPositionSize(
                symbol,
                currentPrice,
                atrValue
            );

            if (positionSize.error) {
                return {
                    success: false,
                    reason: positionSize.error,
                    signal,
                };
            }

            const { quantity, stopLoss, usdtCost } = positionSize;

            // Check if we have enough USDT balance
            if (usdtCost > this.portfolio.usdtBalance) {
                return {
                    success: false,
                    reason: `Insufficient USDT balance. Need: ${usdtCost.toFixed(
                        2
                    )}, Have: ${this.portfolio.usdtBalance.toFixed(2)}`,
                    signal,
                };
            }

            // Execute the trade
            const trade = {
                id: this.generateTradeId(),
                symbol,
                side: "BUY",
                quantity,
                price: currentPrice,
                stopLoss,
                usdtCost,
                timestamp: Date.now(),
                signal: signal.signal,
                signalStrength: signal.strength,
            };

            // Update portfolio - Convert USDT to Crypto
            this.portfolio.usdtBalance -= usdtCost;

            this.portfolio.positions.set(symbol, {
                symbol,
                quantity,
                avgPrice: currentPrice,
                stopLoss,
                unrealizedPnL: 0,
                currentValue: quantity * currentPrice,
                entryTime: trade.timestamp,
                entrySignal: signal,
                entryCost: usdtCost, // Track USDT spent
            });

            // Record trade
            this.tradeHistory.push(trade);
            this.emit("tradeExecuted", trade);

            console.log(
                `📈 BUY executed: ${quantity.toFixed(
                    8
                )} ${symbol} at $${currentPrice} (Cost: ${usdtCost.toFixed(
                    2
                )} USDT)`
            );

            return {
                success: true,
                action: "BUY",
                trade,
                position: this.portfolio.positions.get(symbol),
            };
        } catch (error) {
            console.error("Error executing buy order:", error);
            throw error;
        }
    }

    /**
     * Execute sell order - Convert Crypto to USDT
     */
    async executeSellOrder(symbol, currentPrice, signal, position) {
        try {
            const { quantity, avgPrice, entryCost } = position;
            const usdtReceived = quantity * currentPrice;
            const pnl = usdtReceived - entryCost;
            const pnlPercent = (pnl / entryCost) * 100;

            // Execute the trade
            const trade = {
                id: this.generateTradeId(),
                symbol,
                side: "SELL",
                quantity,
                price: currentPrice,
                usdtReceived,
                pnl,
                pnlPercent,
                timestamp: Date.now(),
                signal: signal.signal,
                signalStrength: signal.strength,
                holdingPeriod: Date.now() - position.entryTime,
                entryCost,
            };

            // Update portfolio - Convert Crypto to USDT
            this.portfolio.usdtBalance += usdtReceived;
            this.portfolio.totalPnL += pnl;
            this.portfolio.dailyPnL += pnl;
            this.portfolio.weeklyPnL += pnl;

            // Remove position
            this.portfolio.positions.delete(symbol);

            // Record trade and update metrics
            this.tradeHistory.push(trade);
            this.updatePerformanceMetrics(trade);
            this.emit("tradeExecuted", trade);

            console.log(
                `📉 SELL executed: ${quantity.toFixed(
                    8
                )} ${symbol} at $${currentPrice} (P&L: ${
                    pnl >= 0 ? "+" : ""
                }${pnl.toFixed(2)} USDT)`
            );

            return {
                success: true,
                action: "SELL",
                trade,
                pnl: {
                    amount: pnl,
                    percent: pnlPercent,
                },
            };
        } catch (error) {
            console.error("Error executing sell order:", error);
            throw error;
        }
    }

    /**
     * Calculate buy position size based on allocation and risk management
     */
    calculateBuyPositionSize(symbol, currentPrice, atrValue) {
        try {
            // Get allocation for this asset (percentage of total portfolio)
            const allocationPercent = this.config.allocation[symbol] || 0.1;
            const maxAllocationUSDT =
                this.config.startingCapital * allocationPercent;

            // Calculate risk-based position size
            const riskAmountUSDT =
                this.config.startingCapital * this.config.riskPerTrade; // $50 max

            // Calculate stop loss price
            let stopLoss;
            if (atrValue) {
                stopLoss = currentPrice - atrValue * this.config.stopLossATR;
            } else {
                // Fallback: 2% stop loss
                stopLoss = currentPrice * 0.98;
            }

            const riskPerUnit = currentPrice - stopLoss;
            if (riskPerUnit <= 0) {
                return {
                    error: "Invalid stop loss calculation - stop loss above current price",
                };
            }

            // Calculate quantity based on risk
            const riskBasedQuantity = riskAmountUSDT / riskPerUnit;
            const riskBasedUSDT = riskBasedQuantity * currentPrice;

            // Use the smaller of risk-based or allocation-based sizing
            const finalUSDT = Math.min(
                riskBasedUSDT,
                maxAllocationUSDT,
                this.portfolio.usdtBalance * 0.95 // Leave 5% USDT buffer
            );
            const finalQuantity = finalUSDT / currentPrice;

            // Check minimum order size
            if (finalUSDT < this.config.minOrderSize) {
                return {
                    error: `Order size ${finalUSDT.toFixed(
                        2
                    )} USDT below minimum ${this.config.minOrderSize} USDT`,
                };
            }

            // Validate we have enough balance
            if (finalUSDT > this.portfolio.usdtBalance) {
                return {
                    error: `Insufficient USDT balance: ${finalUSDT.toFixed(
                        2
                    )} required, ${this.portfolio.usdtBalance.toFixed(
                        2
                    )} available`,
                };
            }

            return {
                quantity: parseFloat(finalQuantity.toFixed(8)),
                stopLoss: parseFloat(stopLoss.toFixed(8)),
                usdtCost: parseFloat(finalUSDT.toFixed(2)),
                riskAmount: parseFloat(
                    (finalQuantity * riskPerUnit).toFixed(2)
                ),
                allocation: allocationPercent,
                maxAllocation: maxAllocationUSDT,
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Update portfolio values with current market prices
     */
    updatePortfolioValue(priceData) {
        let totalCryptoValue = 0;

        this.portfolio.positions.forEach((position, symbol) => {
            const currentPrice = priceData[symbol]?.price;
            if (currentPrice) {
                const currentValue = position.quantity * currentPrice;
                const unrealizedPnL = currentValue - position.entryCost;

                position.unrealizedPnL = unrealizedPnL;
                position.currentPrice = currentPrice;
                position.currentValue = currentValue;

                totalCryptoValue += currentValue;

                // Check stop loss
                if (currentPrice <= position.stopLoss) {
                    console.log(
                        `🛑 Stop loss triggered for ${symbol} at $${currentPrice}`
                    );
                    this.emit("stopLossTriggered", {
                        symbol,
                        position,
                        currentPrice,
                    });
                }
            }
        });

        // Update total portfolio value (USDT + Crypto values)
        this.portfolio.totalValue =
            this.portfolio.usdtBalance + totalCryptoValue;

        // Calculate current drawdown
        const peak = Math.max(
            this.config.startingCapital,
            this.portfolio.totalValue
        );
        this.performanceMetrics.currentDrawdown =
            ((peak - this.portfolio.totalValue) / peak) * 100;
        this.performanceMetrics.maxDrawdown = Math.max(
            this.performanceMetrics.maxDrawdown,
            this.performanceMetrics.currentDrawdown
        );

        // Check risk limits
        this.checkRiskLimits();

        this.emit("portfolioUpdated", this.getPortfolioSummary());
    }

    /**
     * Check and enforce risk limits
     */
    checkRiskLimits() {
        const dailyLoss = Math.abs(Math.min(0, this.portfolio.dailyPnL));
        const weeklyLoss = Math.abs(Math.min(0, this.portfolio.weeklyPnL));

        if (dailyLoss >= this.riskLimits.dailyLossLimit) {
            this.haltTrading(
                `Daily loss limit exceeded: ${dailyLoss.toFixed(2)} USDT`
            );
        } else if (weeklyLoss >= this.riskLimits.weeklyLossLimit) {
            this.haltTrading(
                `Weekly loss limit exceeded: ${weeklyLoss.toFixed(2)} USDT`
            );
        }
    }

    /**
     * Halt all trading
     */
    haltTrading(reason) {
        this.riskLimits.isHalted = true;
        this.riskLimits.haltReason = reason;
        this.config.enableTrading = false;

        console.warn(`🚨 TRADING HALTED: ${reason}`);
        this.emit("tradingHalted", {
            reason,
            portfolio: this.getPortfolioSummary(),
        });
    }

    /**
     * Resume trading
     */
    resumeTrading() {
        this.riskLimits.isHalted = false;
        this.riskLimits.haltReason = null;
        this.config.enableTrading = true;

        console.log("✅ Trading resumed");
        this.emit("tradingResumed");
    }

    /**
     * Check and reset daily/weekly counters
     */
    checkAndResetCounters() {
        const today = new Date().toDateString();
        const thisWeek = this.getWeekStart(new Date());

        // Reset daily counter
        if (this.portfolio.lastResetDate !== today) {
            this.portfolio.dailyPnL = 0;
            this.portfolio.lastResetDate = today;

            // Resume trading if halted due to daily limits
            if (
                this.riskLimits.isHalted &&
                this.riskLimits.haltReason?.includes("Daily")
            ) {
                this.resumeTrading();
            }
        }

        // Reset weekly counter
        if (this.portfolio.lastWeeklyReset !== thisWeek) {
            this.portfolio.weeklyPnL = 0;
            this.portfolio.lastWeeklyReset = thisWeek;

            // Resume trading if halted due to weekly limits
            if (
                this.riskLimits.isHalted &&
                this.riskLimits.haltReason?.includes("Weekly")
            ) {
                this.resumeTrading();
            }
        }
    }

    /**
     * Validate trading signal
     */
    isValidSignal(signal) {
        if (!signal || !signal.symbol || !signal.signal) return false;
        if (signal.signal === "ERROR" || signal.signal === "INSUFFICIENT_DATA")
            return false;
        if (signal.signal === "COOLDOWN" || signal.signal === "WEAK_SIGNAL")
            return false;
        if (signal.strength < 0.5) return false; // Minimum strength threshold

        return true;
    }

    /**
     * Update performance metrics after a trade
     */
    updatePerformanceMetrics(trade) {
        if (trade.side !== "SELL") return;

        this.performanceMetrics.totalTrades++;

        if (trade.pnl > 0) {
            this.performanceMetrics.winningTrades++;
            this.performanceMetrics.avgWin =
                (this.performanceMetrics.avgWin *
                    (this.performanceMetrics.winningTrades - 1) +
                    trade.pnl) /
                this.performanceMetrics.winningTrades;
        } else {
            this.performanceMetrics.losingTrades++;
            this.performanceMetrics.avgLoss =
                (this.performanceMetrics.avgLoss *
                    (this.performanceMetrics.losingTrades - 1) +
                    Math.abs(trade.pnl)) /
                this.performanceMetrics.losingTrades;
        }

        // Update win rate
        this.performanceMetrics.winRate =
            (this.performanceMetrics.winningTrades /
                this.performanceMetrics.totalTrades) *
            100;

        // Update profit factor
        const grossProfit =
            this.performanceMetrics.avgWin *
            this.performanceMetrics.winningTrades;
        const grossLoss =
            this.performanceMetrics.avgLoss *
            this.performanceMetrics.losingTrades;
        this.performanceMetrics.profitFactor =
            grossLoss > 0 ? grossProfit / grossLoss : 0;
    }

    /**
     * Get portfolio summary with proper USDT accounting
     */
    getPortfolioSummary() {
        const totalCryptoValue = Array.from(
            this.portfolio.positions.values()
        ).reduce((sum, pos) => sum + (pos.currentValue || 0), 0);

        const summary = {
            usdtBalance: this.portfolio.usdtBalance,
            totalValue: this.portfolio.totalValue,
            cryptoValue: totalCryptoValue,
            totalPnL: this.portfolio.totalPnL,
            totalPnLPercent:
                (this.portfolio.totalPnL / this.config.startingCapital) * 100,
            dailyPnL: this.portfolio.dailyPnL,
            weeklyPnL: this.portfolio.weeklyPnL,
            positions: Array.from(this.portfolio.positions.values()),
            positionCount: this.portfolio.positions.size,
            performance: this.performanceMetrics,
            riskStatus: {
                isHalted: this.riskLimits.isHalted,
                haltReason: this.riskLimits.haltReason,
                dailyLossUsed: Math.abs(Math.min(0, this.portfolio.dailyPnL)),
                weeklyLossUsed: Math.abs(Math.min(0, this.portfolio.weeklyPnL)),
                dailyLossLimit: this.riskLimits.dailyLossLimit,
                weeklyLossLimit: this.riskLimits.weeklyLossLimit,
            },
            allocation: {
                usdt:
                    (this.portfolio.usdtBalance / this.portfolio.totalValue) *
                    100,
                crypto: (totalCryptoValue / this.portfolio.totalValue) * 100,
            },
        };

        return summary;
    }

    /**
     * Get recent trades
     */
    getRecentTrades(limit = 20) {
        return this.tradeHistory.slice(-limit).reverse();
    }

    /**
     * Utility functions
     */
    generateTradeId() {
        return `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff)).toDateString();
    }

    /**
     * Start the trading engine
     */
    start() {
        this.isActive = true;
        console.log("🚀 Paper Trading Engine started");
        this.emit("engineStarted");
    }

    /**
     * Stop the trading engine
     */
    stop() {
        this.isActive = false;
        console.log("📴 Paper Trading Engine stopped");
        this.emit("engineStopped");
    }

    /**
     * Reset the trading engine with proper USDT initialization
     */
    reset() {
        this.portfolio = {
            usdtBalance: this.config.startingCapital,
            totalValue: this.config.startingCapital,
            positions: new Map(),
            dailyPnL: 0,
            weeklyPnL: 0,
            totalPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };

        this.tradeHistory = [];
        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            profitFactor: 0,
            sharpeRatio: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
        };

        this.riskLimits.isHalted = false;
        this.riskLimits.haltReason = null;

        console.log("🔄 Paper Trading Engine reset with fresh USDT balance");
        this.emit("engineReset");
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };

        // Update risk limits if capital changed
        this.riskLimits.dailyLossLimit =
            this.config.startingCapital * this.config.maxDailyLoss;
        this.riskLimits.weeklyLossLimit =
            this.config.startingCapital * this.config.maxWeeklyLoss;

        this.emit("configUpdated", this.config);
        console.log("⚙️ Paper Trading Engine configuration updated");
    }

    /**
     * Get engine status
     */
    getStatus() {
        return {
            isActive: this.isActive,
            tradingEnabled: this.config.enableTrading,
            totalValue: this.portfolio.totalValue,
            usdtBalance: this.portfolio.usdtBalance,
            totalPnL: this.portfolio.totalPnL,
            totalTrades: this.performanceMetrics.totalTrades,
            openPositions: this.portfolio.positions.size,
            riskStatus: this.riskLimits,
            lastTradeTime:
                this.tradeHistory.length > 0
                    ? this.tradeHistory[this.tradeHistory.length - 1].timestamp
                    : null,
        };
    }
}

module.exports = PaperTradingEngine;
