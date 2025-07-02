// backend/src/services/paperTradingEngine.js - COMPLETE WITH PERSISTENCE
const EventEmitter = require("events");
const db = require("../../config/database");
const logger = require("../utils/logger");

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
        this.lastStateSave = 0;

        logger.info(
            "📊 Paper Trading Engine initialized with persistence - $" +
                this.config.startingCapital +
                " USDT"
        );
    }

    /**
     * Initialize engine and load state from database
     */
    async initialize() {
        try {
            logger.info(
                "🔄 Initializing Paper Trading Engine with persistence..."
            );

            // Load previous state from database
            await this.loadStateFromDatabase();

            // Load trade history
            await this.loadTradeHistory();

            // Recalculate performance metrics from trade history
            this.recalculatePerformanceMetrics();

            logger.success(
                `✅ Paper Trading Engine loaded: $${this.portfolio.totalValue.toFixed(
                    2
                )} portfolio value`
            );
        } catch (error) {
            logger.error("❌ Failed to load previous state:", error);
            logger.info("🔄 Starting with fresh state...");

            // Save initial fresh state
            await this.saveStateToDatabase();
        }
    }

    /**
     * Load portfolio state from database
     */
    async loadStateFromDatabase() {
        try {
            // Get the latest portfolio snapshot
            const latestPortfolio = await db("portfolio")
                .orderBy("snapshot_time", "desc")
                .first();

            if (latestPortfolio) {
                // Restore portfolio values
                this.portfolio.usdtBalance =
                    latestPortfolio.usdt_balance || this.config.startingCapital;
                this.portfolio.totalValue =
                    latestPortfolio.total_value || this.config.startingCapital;
                this.portfolio.dailyPnL = latestPortfolio.daily_pnl || 0;
                this.portfolio.weeklyPnL = latestPortfolio.weekly_pnl || 0;
                this.portfolio.totalPnL = latestPortfolio.total_pnl || 0;

                // Restore positions from JSON
                if (latestPortfolio.positions) {
                    try {
                        const savedPositions = JSON.parse(
                            latestPortfolio.positions
                        );
                        this.portfolio.positions = new Map();

                        // Convert array back to Map and restore position objects
                        savedPositions.forEach((pos) => {
                            this.portfolio.positions.set(pos.symbol, {
                                ...pos,
                                entryTime: pos.entryTime || Date.now(),
                                unrealizedPnL: 0, // Will be recalculated with current prices
                            });
                        });

                        logger.info(
                            `📍 Restored ${savedPositions.length} positions from database`
                        );
                    } catch (parseError) {
                        logger.warn(
                            "⚠️ Failed to parse saved positions:",
                            parseError.message
                        );
                        this.portfolio.positions = new Map();
                    }
                }

                // Check if we need to reset daily/weekly counters
                this.checkAndResetCounters();

                logger.success("✅ Portfolio state restored from database");
            } else {
                logger.info(
                    "ℹ️ No previous portfolio state found, starting fresh"
                );
            }
        } catch (error) {
            logger.error("Error loading state from database:", error);
            throw error;
        }
    }

    /**
     * Load trade history from database
     */
    async loadTradeHistory() {
        try {
            const dbTrades = await db("trades")
                .orderBy("timestamp", "desc")
                .limit(1000); // Load last 1000 trades

            this.tradeHistory = dbTrades.map((trade) => ({
                id: trade.trade_id,
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                usdtCost: trade.side === "BUY" ? trade.total_value : undefined,
                usdtReceived:
                    trade.side === "SELL" ? trade.total_value : undefined,
                pnl: trade.pnl,
                pnlPercent: trade.pnl_percent,
                timestamp: new Date(trade.timestamp).getTime(),
                signal: trade.signal,
                signalStrength: trade.signal_strength,
                stopLoss: trade.stop_loss,
                entryCost: trade.entry_cost,
                holdingPeriod: trade.holding_period,
            }));

            logger.info(
                `📚 Loaded ${this.tradeHistory.length} trades from database`
            );
        } catch (error) {
            logger.error("Error loading trade history:", error);
            this.tradeHistory = [];
        }
    }

    /**
     * Save current state to database
     */
    async saveStateToDatabase() {
        try {
            // Convert positions Map to array for JSON storage
            const positionsArray = Array.from(
                this.portfolio.positions.values()
            );

            const portfolioData = {
                total_value: this.portfolio.totalValue,
                usdt_balance: this.portfolio.usdtBalance,
                crypto_value:
                    this.portfolio.totalValue - this.portfolio.usdtBalance,
                total_pnl: this.portfolio.totalPnL,
                daily_pnl: this.portfolio.dailyPnL,
                weekly_pnl: this.portfolio.weeklyPnL,
                positions: JSON.stringify(positionsArray),
                position_count: this.portfolio.positions.size,
                allocation_usdt_percent:
                    this.portfolio.totalValue > 0
                        ? (this.portfolio.usdtBalance /
                              this.portfolio.totalValue) *
                          100
                        : 100,
                allocation_crypto_percent:
                    this.portfolio.totalValue > 0
                        ? ((this.portfolio.totalValue -
                              this.portfolio.usdtBalance) /
                              this.portfolio.totalValue) *
                          100
                        : 0,
                snapshot_time: new Date(),
            };

            await db("portfolio").insert(portfolioData);

            // Clean up old snapshots (keep last 100)
            const countResult = await db("portfolio")
                .count("id as total")
                .first();
            if (countResult.total > 100) {
                const cutoffSnapshot = await db("portfolio")
                    .orderBy("snapshot_time", "desc")
                    .limit(1)
                    .offset(99)
                    .first();

                if (cutoffSnapshot) {
                    await db("portfolio")
                        .where(
                            "snapshot_time",
                            "<",
                            cutoffSnapshot.snapshot_time
                        )
                        .del();
                }
            }

            logger.debug("💾 Portfolio state saved to database");
        } catch (error) {
            logger.error("Error saving state to database:", error);
            // Don't throw - continue operation even if save fails
        }
    }

    /**
     * Recalculate performance metrics from trade history
     */
    recalculatePerformanceMetrics() {
        const sellTrades = this.tradeHistory.filter(
            (t) => t.side === "SELL" && t.pnl !== undefined
        );

        if (sellTrades.length === 0) {
            return;
        }

        this.performanceMetrics.totalTrades = sellTrades.length;
        this.performanceMetrics.winningTrades = sellTrades.filter(
            (t) => t.pnl > 0
        ).length;
        this.performanceMetrics.losingTrades = sellTrades.filter(
            (t) => t.pnl <= 0
        ).length;

        this.performanceMetrics.winRate =
            this.performanceMetrics.totalTrades > 0
                ? (this.performanceMetrics.winningTrades /
                      this.performanceMetrics.totalTrades) *
                  100
                : 0;

        // Calculate average win/loss
        const winningTrades = sellTrades.filter((t) => t.pnl > 0);
        const losingTrades = sellTrades.filter((t) => t.pnl <= 0);

        this.performanceMetrics.avgWin =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) /
                  winningTrades.length
                : 0;

        this.performanceMetrics.avgLoss =
            losingTrades.length > 0
                ? Math.abs(
                      losingTrades.reduce((sum, t) => sum + t.pnl, 0) /
                          losingTrades.length
                  )
                : 0;

        // Calculate profit factor
        const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
        const grossLoss = Math.abs(
            losingTrades.reduce((sum, t) => sum + t.pnl, 0)
        );
        this.performanceMetrics.profitFactor =
            grossLoss > 0 ? grossProfit / grossLoss : 0;

        logger.debug("📊 Performance metrics recalculated from trade history");
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
            logger.error("Error processing signal:", error);
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

            // Save state immediately after trade
            await this.saveStateToDatabase();

            logger.info(
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
            logger.error("Error executing buy order:", error);
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

            // Save state immediately after trade
            await this.saveStateToDatabase();

            logger.info(
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
            logger.error("Error executing sell order:", error);
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
                    logger.warn(
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

        // Save state periodically (every 5 minutes)
        const now = Date.now();
        if (!this.lastStateSave || now - this.lastStateSave > 5 * 60 * 1000) {
            this.saveStateToDatabase();
            this.lastStateSave = now;
        }
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

        logger.warn(`🚨 TRADING HALTED: ${reason}`);
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

        logger.info("✅ Trading resumed");
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
                    this.portfolio.totalValue > 0
                        ? (this.portfolio.usdtBalance /
                              this.portfolio.totalValue) *
                          100
                        : 100,
                crypto:
                    this.portfolio.totalValue > 0
                        ? (totalCryptoValue / this.portfolio.totalValue) * 100
                        : 0,
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
    async start() {
        // Initialize if not already done
        if (!this.lastStateSave) {
            await this.initialize();
        }

        this.isActive = true;
        logger.info("🚀 Paper Trading Engine started");
        this.emit("engineStarted");

        // Save state on start
        await this.saveStateToDatabase();
    }

    /**
     * Stop the trading engine
     */
    async stop() {
        this.isActive = false;

        // Save final state before stopping
        await this.saveStateToDatabase();

        logger.info("📴 Paper Trading Engine stopped");
        this.emit("engineStopped");
    }

    /**
     * Reset the trading engine with proper USDT initialization
     */
    async reset() {
        try {
            logger.info("🔄 Resetting Paper Trading Engine...");

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

            // Save fresh state to database
            await this.saveStateToDatabase();

            logger.success(
                "✅ Paper Trading Engine reset with fresh USDT balance"
            );
            this.emit("engineReset");
        } catch (error) {
            logger.error("Error resetting Paper Trading Engine:", error);
            throw error;
        }
    }

    /**
     * Update configuration
     */
    async updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };

        // Update risk limits if capital changed
        if (newConfig.startingCapital) {
            this.riskLimits.dailyLossLimit =
                this.config.startingCapital * this.config.maxDailyLoss;
            this.riskLimits.weeklyLossLimit =
                this.config.startingCapital * this.config.maxWeeklyLoss;
        }

        // Save updated config state
        await this.saveStateToDatabase();

        this.emit("configUpdated", this.config);
        logger.info("⚙️ Paper Trading Engine configuration updated");
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
            lastStateSave: this.lastStateSave,
            persistenceEnabled: true,
        };
    }

    /**
     * Manual state save (for external triggers)
     */
    async forceSaveState() {
        try {
            await this.saveStateToDatabase();
            logger.info("💾 Manual state save completed");
            return true;
        } catch (error) {
            logger.error("Error in manual state save:", error);
            return false;
        }
    }

    /**
     * Get detailed persistence status
     */
    async getPersistenceStatus() {
        try {
            // Check if we have recent snapshots
            const recentSnapshots = await db("portfolio")
                .orderBy("snapshot_time", "desc")
                .limit(5);

            // Check trade count in database
            const tradeCount = await db("trades").count("id as total").first();

            return {
                enabled: true,
                lastSave: this.lastStateSave,
                lastSaveFormatted: this.lastStateSave
                    ? new Date(this.lastStateSave).toLocaleString()
                    : "Never",
                recentSnapshots: recentSnapshots.length,
                totalTradesInDB: tradeCount.total,
                memoryTrades: this.tradeHistory.length,
                memoryPositions: this.portfolio.positions.size,
            };
        } catch (error) {
            logger.error("Error getting persistence status:", error);
            return {
                enabled: false,
                error: error.message,
            };
        }
    }

    /**
     * Validate data integrity between memory and database
     */
    async validateDataIntegrity() {
        try {
            // Compare memory vs database trade counts
            const dbTradeCount = await db("trades")
                .count("id as total")
                .first();
            const memoryTradeCount = this.tradeHistory.length;

            // Get latest portfolio snapshot
            const latestSnapshot = await db("portfolio")
                .orderBy("snapshot_time", "desc")
                .first();

            const integrity = {
                isValid: true,
                issues: [],
                memory: {
                    trades: memoryTradeCount,
                    positions: this.portfolio.positions.size,
                    totalValue: this.portfolio.totalValue,
                    totalPnL: this.portfolio.totalPnL,
                },
                database: {
                    trades: dbTradeCount.total,
                    latestSnapshot: latestSnapshot
                        ? {
                              totalValue: latestSnapshot.total_value,
                              totalPnL: latestSnapshot.total_pnl,
                              positions: latestSnapshot.position_count,
                              timestamp: latestSnapshot.snapshot_time,
                          }
                        : null,
                },
            };

            // Check for major discrepancies
            if (Math.abs(memoryTradeCount - dbTradeCount.total) > 10) {
                integrity.isValid = false;
                integrity.issues.push(
                    "Large trade count discrepancy between memory and database"
                );
            }

            if (latestSnapshot) {
                const valueDiff = Math.abs(
                    this.portfolio.totalValue - latestSnapshot.total_value
                );
                if (valueDiff > 100) {
                    // More than $100 difference
                    integrity.isValid = false;
                    integrity.issues.push(
                        "Large total value discrepancy between memory and database"
                    );
                }
            }

            return integrity;
        } catch (error) {
            logger.error("Error validating data integrity:", error);
            return {
                isValid: false,
                error: error.message,
            };
        }
    }

    /**
     * Emergency backup current state
     */
    async emergencyBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const backupData = {
                timestamp,
                portfolio: this.portfolio,
                tradeHistory: this.tradeHistory,
                performanceMetrics: this.performanceMetrics,
                riskLimits: this.riskLimits,
                config: this.config,
            };

            // Convert positions Map to array for JSON serialization
            backupData.portfolio.positions = Array.from(
                this.portfolio.positions.entries()
            );

            // Save as JSON file (if filesystem access available)
            const backupPath = `./backend/backups/emergency_paper_trading_${timestamp}.json`;

            try {
                const fs = require("fs");
                fs.writeFileSync(
                    backupPath,
                    JSON.stringify(backupData, null, 2)
                );
                logger.info(`💾 Emergency backup saved to ${backupPath}`);
            } catch (fsError) {
                logger.warn(
                    "Could not save to filesystem, storing in database only"
                );
            }

            // Also save to database with special marker
            await this.saveStateToDatabase();

            return {
                success: true,
                timestamp,
                backupPath: backupPath,
                portfolioValue: this.portfolio.totalValue,
            };
        } catch (error) {
            logger.error("Error creating emergency backup:", error);
            return {
                success: false,
                error: error.message,
            };
        }
    }
}

module.exports = PaperTradingEngine;
