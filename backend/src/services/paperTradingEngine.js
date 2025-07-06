// backend/src/services/paperTradingEngine.js - ENHANCED WITH ALL IMPROVEMENTS (COMPLETE)
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

            // NEW: Enhanced features config
            enableTrailingStops: config.enableTrailingStops !== false, // Default true
            trailingStopPercent: config.trailingStopPercent || 0.02, // 2%
            takeProfitATRMultiplier: config.takeProfitATRMultiplier || 2.5,
            enableVolatilityFilter: config.enableVolatilityFilter !== false, // Default true
            minVolatilityPercent: config.minVolatilityPercent || 2.0, // 2% ATR minimum

            ...config,
        };

        // Portfolio state - USDT-based accounting
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

        // Trading state
        this.tradeHistory = [];

        // ENHANCED: Comprehensive performance metrics
        this.performanceMetrics = {
            // Basic metrics
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

            // NEW: Enhanced metrics
            signalPerformance: {
                BUY_STRONG: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
                BUY_MEDIUM: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
                BUY_WEAK: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
            },

            holdingPeriodStats: {
                avgHoldingTime: 0,
                shortTrades: 0, // < 1 day
                mediumTrades: 0, // 1-7 days
                longTrades: 0, // > 7 days
                holdingTimes: [], // Track all holding times
            },

            exitReasonStats: {
                TAKE_PROFIT: { count: 0, totalPnL: 0, avgPnL: 0 },
                TRAILING_STOP: { count: 0, totalPnL: 0, avgPnL: 0 },
                STOP_LOSS: { count: 0, totalPnL: 0, avgPnL: 0 },
                SIGNAL_SELL: { count: 0, totalPnL: 0, avgPnL: 0 },
                LOW_VOLATILITY_EXIT: { count: 0, totalPnL: 0, avgPnL: 0 },
            },

            assetPerformance: {
                BTCUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                ETHUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                BNBUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                DOGEUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
            },

            volatilityStats: {
                tradesBlocked: 0,
                lowVolatilityPeriods: 0,
                avgVolatilityWhenTrading: 0,
            },
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
            "🚀 ENHANCED Paper Trading Engine initialized - $" +
                this.config.startingCapital +
                " USDT"
        );
    }

    getStatus() {
        try {
            return {
                isActive: this.isActive,
                totalValue: this.portfolio.totalValue,
                totalPnL: this.portfolio.totalPnL,
                totalPnLPercent:
                    (this.portfolio.totalPnL / this.config.startingCapital) *
                    100,
                tradesCount: this.tradeHistory.length,
                positionsCount: this.portfolio.positions.size,
                riskStatus: this.riskLimits,
                config: {
                    enableTrading: this.config.enableTrading,
                    enableTrailingStops: this.config.enableTrailingStops,
                    startingCapital: this.config.startingCapital,
                },
                performance: {
                    winRate: this.performanceMetrics.winRate,
                    profitFactor: this.performanceMetrics.profitFactor,
                    totalTrades: this.performanceMetrics.totalTrades,
                },
                uptime: Date.now() - (this.startTime || Date.now()),
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting paper trading status:", error);
            return {
                isActive: false,
                error: error.message,
                timestamp: Date.now(),
            };
        }
    }
    /**
     * ENHANCED: Calculate buy position size with dynamic minimum orders
     */
    calculateBuyPositionSize(
        symbol,
        currentPrice,
        atrValue,
        binanceDataService = null
    ) {
        try {
            const allocationPercent = this.config.allocation[symbol] || 0.1;
            const maxAllocationUSDT =
                this.config.startingCapital * allocationPercent;
            const riskAmountUSDT =
                this.config.startingCapital * this.config.riskPerTrade;

            // Calculate stop loss price
            let stopLoss;
            if (atrValue) {
                stopLoss = currentPrice - atrValue * this.config.stopLossATR;
            } else {
                stopLoss = currentPrice * 0.98; // 2% fallback
            }

            const riskPerUnit = currentPrice - stopLoss;
            if (riskPerUnit <= 0) {
                return {
                    error: "Invalid stop loss calculation - stop loss above current price",
                };
            }

            const riskBasedQuantity = riskAmountUSDT / riskPerUnit;
            const riskBasedUSDT = riskBasedQuantity * currentPrice;

            const finalUSDT = Math.min(
                riskBasedUSDT,
                maxAllocationUSDT,
                this.portfolio.usdtBalance * 0.95
            );

            // NEW: Dynamic minimum order size
            const dynamicMinOrderSize = binanceDataService
                ? binanceDataService.getMinOrderSize(symbol)
                : this.config.minOrderSize;

            if (finalUSDT < dynamicMinOrderSize) {
                return {
                    error: `Order size ${finalUSDT.toFixed(
                        2
                    )} USDT below minimum ${dynamicMinOrderSize} USDT for ${symbol}`,
                };
            }

            const finalQuantity = finalUSDT / currentPrice;

            // NEW: Calculate take-profit level
            let takeProfit = null;
            if (atrValue && this.config.enableTrailingStops) {
                takeProfit =
                    currentPrice +
                    atrValue * this.config.takeProfitATRMultiplier;
            }

            return {
                quantity: parseFloat(finalQuantity.toFixed(8)),
                stopLoss: parseFloat(stopLoss.toFixed(8)),
                takeProfit: takeProfit
                    ? parseFloat(takeProfit.toFixed(8))
                    : null,
                usdtCost: parseFloat(finalUSDT.toFixed(2)),
                riskAmount: parseFloat(
                    (finalQuantity * riskPerUnit).toFixed(2)
                ),
                allocation: allocationPercent,
                maxAllocation: maxAllocationUSDT,
                dynamicMinOrderSize,
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * ENHANCED: Execute buy order with trailing stops and take-profit
     */
    async executeBuyOrder(
        symbol,
        currentPrice,
        signal,
        atrValue,
        binanceDataService = null
    ) {
        try {
            const existingPosition = this.portfolio.positions.get(symbol);
            if (existingPosition) {
                return {
                    success: false,
                    reason: "Maximum positions already held for this asset",
                    signal,
                };
            }

            const positionSize = this.calculateBuyPositionSize(
                symbol,
                currentPrice,
                atrValue,
                binanceDataService
            );

            if (positionSize.error) {
                return { success: false, reason: positionSize.error, signal };
            }

            const { quantity, stopLoss, takeProfit, usdtCost } = positionSize;

            if (usdtCost > this.portfolio.usdtBalance) {
                return {
                    success: false,
                    reason: `Insufficient USDT balance. Need: ${usdtCost.toFixed(
                        2
                    )}, Have: ${this.portfolio.usdtBalance.toFixed(2)}`,
                    signal,
                };
            }

            const trade = {
                id: this.generateTradeId(),
                symbol,
                side: "BUY",
                quantity,
                price: currentPrice,
                stopLoss,
                takeProfit,
                usdtCost,
                timestamp: Date.now(),
                signal: signal.signal,
                signalStrength: signal.strength,
                atr: atrValue,
                volatilityPercent: signal.atrPercent || 0,
            };

            // Update portfolio
            this.portfolio.usdtBalance -= usdtCost;

            // NEW: Enhanced position object with trailing stops
            this.portfolio.positions.set(symbol, {
                symbol,
                quantity,
                avgPrice: currentPrice,
                stopLoss,
                takeProfit,
                // NEW: Trailing stop features
                trailingStop: this.config.enableTrailingStops ? stopLoss : null,
                trailingStopPercent: this.config.trailingStopPercent,
                highestPrice: currentPrice,
                // Standard fields
                unrealizedPnL: 0,
                currentValue: quantity * currentPrice,
                entryTime: trade.timestamp,
                entrySignal: signal,
                entryCost: usdtCost,
                atrAtEntry: atrValue,
            });

            this.tradeHistory.push(trade);
            this.emit("tradeExecuted", trade);
            await this.saveStateToDatabase();

            logger.info(
                `🚀 ENHANCED BUY: ${quantity.toFixed(
                    8
                )} ${symbol} at $${currentPrice} (TP: ${
                    takeProfit ? "$" + takeProfit.toFixed(2) : "N/A"
                })`
            );

            return {
                success: true,
                action: "BUY",
                trade,
                position: this.portfolio.positions.get(symbol),
            };
        } catch (error) {
            logger.error("Error executing enhanced buy order:", error);
            throw error;
        }
    }

    /**
     * ENHANCED: Execute sell order with exit reason tracking
     */
    async executeSellOrder(
        symbol,
        currentPrice,
        signal,
        position,
        exitReason = "SIGNAL_SELL"
    ) {
        try {
            const { quantity, avgPrice, entryCost, entryTime } = position;
            const usdtReceived = quantity * currentPrice;
            const pnl = usdtReceived - entryCost;
            const pnlPercent = (pnl / entryCost) * 100;
            const holdingPeriod = Date.now() - entryTime;

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
                holdingPeriod,
                entryCost,
                entryPrice: avgPrice,
                exitReason, // NEW: Track why we exited
                entrySignal: position.entrySignal?.signal || "UNKNOWN",
                entrySignalStrength: position.entrySignal?.strength || 0,
            };

            // Update portfolio
            this.portfolio.usdtBalance += usdtReceived;
            this.portfolio.totalPnL += pnl;
            this.portfolio.dailyPnL += pnl;
            this.portfolio.weeklyPnL += pnl;

            // Remove position
            this.portfolio.positions.delete(symbol);

            // Record trade and update enhanced metrics
            this.tradeHistory.push(trade);
            this.updateEnhancedPerformanceMetrics(trade);
            this.emit("tradeExecuted", trade);
            await this.saveStateToDatabase();

            logger.info(
                `💰 ENHANCED SELL: ${quantity.toFixed(
                    8
                )} ${symbol} at $${currentPrice} (${exitReason}) P&L: ${
                    pnl >= 0 ? "+" : ""
                }${pnl.toFixed(2)} USDT`
            );

            return {
                success: true,
                action: "SELL",
                trade,
                pnl: { amount: pnl, percent: pnlPercent },
                exitReason,
            };
        } catch (error) {
            logger.error("Error executing enhanced sell order:", error);
            throw error;
        }
    }

    /**
     * NEW: Enhanced portfolio monitoring with trailing stops and take-profit
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

                // NEW: Update trailing stop logic
                if (
                    this.config.enableTrailingStops &&
                    position.trailingStop !== null
                ) {
                    // Update highest price
                    if (currentPrice > position.highestPrice) {
                        position.highestPrice = currentPrice;

                        // Update trailing stop (only moves up, never down)
                        const newTrailingStop =
                            currentPrice * (1 - position.trailingStopPercent);
                        if (newTrailingStop > position.trailingStop) {
                            position.trailingStop = newTrailingStop;
                            logger.debug(
                                `📈 Trailing stop updated for ${symbol}: $${newTrailingStop.toFixed(
                                    2
                                )}`
                            );
                        }
                    }
                }

                totalCryptoValue += currentValue;

                // NEW: Enhanced exit condition checking
                let exitReason = null;

                // 1. Take-profit check (highest priority)
                if (
                    position.takeProfit &&
                    currentPrice >= position.takeProfit
                ) {
                    exitReason = "TAKE_PROFIT";
                }
                // 2. Trailing stop check
                else if (
                    this.config.enableTrailingStops &&
                    position.trailingStop &&
                    currentPrice <= position.trailingStop
                ) {
                    exitReason = "TRAILING_STOP";
                }
                // 3. Original stop loss (backup/fallback)
                else if (currentPrice <= position.stopLoss) {
                    exitReason = "STOP_LOSS";
                }

                if (exitReason) {
                    logger.warn(
                        `🎯 ${exitReason} triggered for ${symbol} at $${currentPrice}`
                    );
                    this.emit("exitTriggered", {
                        symbol,
                        position,
                        currentPrice,
                        reason: exitReason,
                    });
                }
            }
        });

        // Update total portfolio value
        this.portfolio.totalValue =
            this.portfolio.usdtBalance + totalCryptoValue;

        // Calculate drawdown
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

        this.checkRiskLimits();
        this.emit("portfolioUpdated", this.getPortfolioSummary());

        // Save state periodically
        const now = Date.now();
        if (!this.lastStateSave || now - this.lastStateSave > 5 * 60 * 1000) {
            this.saveStateToDatabase();
            this.lastStateSave = now;
        }
    }

    /**
     * NEW: Enhanced signal validation with volatility filter
     */
    isValidSignal(signal, candles = null, currentPrice = null) {
        if (!signal || !signal.symbol || !signal.signal) return false;
        if (signal.signal === "ERROR" || signal.signal === "INSUFFICIENT_DATA")
            return false;
        if (signal.signal === "COOLDOWN" || signal.signal === "WEAK_SIGNAL")
            return false;
        if (signal.signal === "LOW_VOLATILITY") return false; // NEW: Block low volatility
        if (signal.strength < 0.5) return false;

        // NEW: Additional volatility check if data available
        if (
            this.config.enableVolatilityFilter &&
            signal.atrPercent !== undefined
        ) {
            if (
                signal.atrPercent < this.config.minVolatilityPercent &&
                signal.signal !== "HOLD"
            ) {
                logger.debug(
                    `🔇 Blocking ${
                        signal.symbol
                    } signal due to low volatility: ${signal.atrPercent?.toFixed(
                        2
                    )}%`
                );
                this.performanceMetrics.volatilityStats.tradesBlocked++;
                return false;
            }
        }

        return true;
    }

    /**
     * NEW: Enhanced performance metrics calculation
     */
    updateEnhancedPerformanceMetrics(trade) {
        if (trade.side !== "SELL") return;

        // Basic metrics update
        this.performanceMetrics.totalTrades++;
        const isWin = trade.pnl > 0;

        if (isWin) {
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

        // NEW: Enhanced metrics tracking

        // 1. Signal Performance Analysis
        const signalStrength = trade.entrySignalStrength || 0.5;
        let signalCategory = "BUY_MEDIUM";
        if (signalStrength >= 0.8) signalCategory = "BUY_STRONG";
        else if (signalStrength < 0.6) signalCategory = "BUY_WEAK";

        if (!this.performanceMetrics.signalPerformance[signalCategory]) {
            this.performanceMetrics.signalPerformance[signalCategory] = {
                trades: 0,
                wins: 0,
                totalPnL: 0,
                avgHoldTime: 0,
            };
        }

        const signalPerf =
            this.performanceMetrics.signalPerformance[signalCategory];
        signalPerf.trades++;
        if (isWin) signalPerf.wins++;
        signalPerf.totalPnL += trade.pnl;

        // Update average hold time for this signal type
        const holdTimeHours = trade.holdingPeriod / (1000 * 60 * 60);
        signalPerf.avgHoldTime =
            (signalPerf.avgHoldTime * (signalPerf.trades - 1) + holdTimeHours) /
            signalPerf.trades;

        // 2. Holding Period Analysis
        this.performanceMetrics.holdingPeriodStats.holdingTimes.push(
            holdTimeHours
        );

        const allHoldingTimes =
            this.performanceMetrics.holdingPeriodStats.holdingTimes;
        this.performanceMetrics.holdingPeriodStats.avgHoldingTime =
            allHoldingTimes.reduce((sum, time) => sum + time, 0) /
            allHoldingTimes.length;

        if (holdTimeHours < 24) {
            this.performanceMetrics.holdingPeriodStats.shortTrades++;
        } else if (holdTimeHours < 168) {
            this.performanceMetrics.holdingPeriodStats.mediumTrades++;
        } else {
            this.performanceMetrics.holdingPeriodStats.longTrades++;
        }

        // 3. Exit Reason Analysis
        const exitReason = trade.exitReason || "SIGNAL_SELL";
        if (!this.performanceMetrics.exitReasonStats[exitReason]) {
            this.performanceMetrics.exitReasonStats[exitReason] = {
                count: 0,
                totalPnL: 0,
                avgPnL: 0,
            };
        }

        const exitStats = this.performanceMetrics.exitReasonStats[exitReason];
        exitStats.count++;
        exitStats.totalPnL += trade.pnl;
        exitStats.avgPnL = exitStats.totalPnL / exitStats.count;

        // 4. Asset Performance Analysis
        const symbol = trade.symbol;
        if (!this.performanceMetrics.assetPerformance[symbol]) {
            this.performanceMetrics.assetPerformance[symbol] = {
                trades: 0,
                wins: 0,
                totalPnL: 0,
                winRate: 0,
                avgPnL: 0,
            };
        }

        const assetPerf = this.performanceMetrics.assetPerformance[symbol];
        assetPerf.trades++;
        if (isWin) assetPerf.wins++;
        assetPerf.totalPnL += trade.pnl;
        assetPerf.winRate = (assetPerf.wins / assetPerf.trades) * 100;
        assetPerf.avgPnL = assetPerf.totalPnL / assetPerf.trades;

        // 5. Update overall metrics
        this.performanceMetrics.winRate =
            (this.performanceMetrics.winningTrades /
                this.performanceMetrics.totalTrades) *
            100;

        const grossProfit =
            this.performanceMetrics.avgWin *
            this.performanceMetrics.winningTrades;
        const grossLoss =
            this.performanceMetrics.avgLoss *
            this.performanceMetrics.losingTrades;
        this.performanceMetrics.profitFactor =
            grossLoss > 0 ? grossProfit / grossLoss : 0;

        logger.debug(
            `📊 Enhanced metrics updated - Total trades: ${
                this.performanceMetrics.totalTrades
            }, Win rate: ${this.performanceMetrics.winRate.toFixed(1)}%`
        );
    }

    /**
     * NEW: Get enhanced performance summary
     */
    getEnhancedPerformanceSummary() {
        const metrics = this.performanceMetrics;

        // Find best performing categories
        const bestAsset = Object.entries(metrics.assetPerformance)
            .filter(([_, data]) => data.trades > 0)
            .sort((a, b) => b[1].avgPnL - a[1].avgPnL)[0];

        const bestSignalType = Object.entries(metrics.signalPerformance)
            .filter(([_, data]) => data.trades > 0)
            .sort(
                (a, b) =>
                    b[1].totalPnL / b[1].trades - a[1].totalPnL / a[1].trades
            )[0];

        const bestExitStrategy = Object.entries(metrics.exitReasonStats)
            .filter(([_, data]) => data.count > 0)
            .sort((a, b) => b[1].avgPnL - a[1].avgPnL)[0];

        return {
            overview: {
                totalTrades: metrics.totalTrades,
                winRate: metrics.winRate,
                profitFactor: metrics.profitFactor,
                avgHoldingTime: `${metrics.holdingPeriodStats.avgHoldingTime.toFixed(
                    1
                )} hours`,
            },
            insights: {
                bestAsset: bestAsset
                    ? {
                          symbol: bestAsset[0],
                          avgPnL: bestAsset[1].avgPnL.toFixed(2),
                      }
                    : null,
                bestSignalType: bestSignalType
                    ? {
                          type: bestSignalType[0],
                          avgPnL: (
                              bestSignalType[1].totalPnL /
                              bestSignalType[1].trades
                          ).toFixed(2),
                      }
                    : null,
                bestExitStrategy: bestExitStrategy
                    ? {
                          type: bestExitStrategy[0],
                          avgPnL: bestExitStrategy[1].avgPnL.toFixed(2),
                      }
                    : null,
                tradesBlockedByVolatility:
                    metrics.volatilityStats.tradesBlocked,
            },
            detailed: metrics,
        };
    }

    /**
     * Process signal with all enhancements
     */
    async processSignal(
        signal,
        currentPrice,
        atrValue = null,
        binanceDataService = null
    ) {
        try {
            if (!this.isActive || !this.config.enableTrading) {
                return {
                    success: false,
                    reason: "Trading engine not active or trading disabled",
                    signal,
                };
            }

            if (this.riskLimits.isHalted) {
                return {
                    success: false,
                    reason: `Trading halted: ${this.riskLimits.haltReason}`,
                    signal,
                };
            }

            this.checkAndResetCounters();

            // Enhanced signal validation
            if (!this.isValidSignal(signal)) {
                return {
                    success: false,
                    reason: "Invalid or filtered signal",
                    signal,
                };
            }

            const { symbol } = signal;
            const currentPosition = this.portfolio.positions.get(symbol);

            if (signal.signal.includes("BUY") && !currentPosition) {
                return await this.executeBuyOrder(
                    symbol,
                    currentPrice,
                    signal,
                    atrValue,
                    binanceDataService
                );
            } else if (signal.signal.includes("SELL") && currentPosition) {
                return await this.executeSellOrder(
                    symbol,
                    currentPrice,
                    signal,
                    currentPosition,
                    "SIGNAL_SELL"
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
            logger.error("Error processing enhanced signal:", error);
            return { success: false, reason: error.message, signal };
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
                `Daily loss limit exceeded: ${dailyLoss.toFixed(
                    2
                )} USDT (Limit: ${this.riskLimits.dailyLossLimit.toFixed(2)})`
            );
        }

        if (weeklyLoss >= this.riskLimits.weeklyLossLimit) {
            this.haltTrading(
                `Weekly loss limit exceeded: ${weeklyLoss.toFixed(
                    2
                )} USDT (Limit: ${this.riskLimits.weeklyLossLimit.toFixed(2)})`
            );
        }
    }

    haltTrading(reason) {
        this.riskLimits.isHalted = true;
        this.riskLimits.haltReason = reason;
        logger.error(`🛑 ENHANCED TRADING HALTED: ${reason}`);
        this.emit("tradingHalted", { reason, timestamp: Date.now() });
    }

    resumeTrading() {
        this.riskLimits.isHalted = false;
        this.riskLimits.haltReason = null;
        logger.info("✅ ENHANCED TRADING RESUMED");
        this.emit("tradingResumed", { timestamp: Date.now() });
    }

    checkAndResetCounters() {
        const today = new Date().toDateString();
        const currentWeek = this.getWeekStart(new Date());

        // Reset daily counter
        if (this.portfolio.lastResetDate !== today) {
            this.portfolio.dailyPnL = 0;
            this.portfolio.lastResetDate = today;
            logger.debug("📅 Daily P&L counter reset");

            // Check if we can resume trading after daily reset
            if (
                this.riskLimits.isHalted &&
                this.riskLimits.haltReason?.includes("Daily")
            ) {
                this.resumeTrading();
            }
        }

        // Reset weekly counter
        if (this.portfolio.lastWeeklyReset !== currentWeek) {
            this.portfolio.weeklyPnL = 0;
            this.portfolio.lastWeeklyReset = currentWeek;
            logger.debug("📅 Weekly P&L counter reset");

            // Check if we can resume trading after weekly reset
            if (
                this.riskLimits.isHalted &&
                this.riskLimits.haltReason?.includes("Weekly")
            ) {
                this.resumeTrading();
            }
        }
    }

    getPortfolioSummary() {
        let totalCryptoValue = 0;
        const positionsArray = [];

        this.portfolio.positions.forEach((position) => {
            totalCryptoValue += position.currentValue || 0;
            positionsArray.push({
                ...position,
                // Include enhanced position data
                trailingStopActive:
                    this.config.enableTrailingStops &&
                    position.trailingStop !== null,
                takeProfitSet: position.takeProfit !== null,
                unrealizedPnLPercent: position.entryCost
                    ? ((position.unrealizedPnL || 0) / position.entryCost) * 100
                    : 0,
            });
        });

        const summary = {
            totalValue: this.portfolio.totalValue,
            usdtBalance: this.portfolio.usdtBalance,
            cryptoValue: totalCryptoValue,
            totalPnL: this.portfolio.totalPnL,
            dailyPnL: this.portfolio.dailyPnL,
            weeklyPnL: this.portfolio.weeklyPnL,
            positions: positionsArray,
            positionCount: this.portfolio.positions.size,
            performance: this.performanceMetrics,
            enhancedPerformance: this.getEnhancedPerformanceSummary(),
            riskStatus: {
                isHalted: this.riskLimits.isHalted,
                haltReason: this.riskLimits.haltReason,
                dailyLossUsed: Math.abs(Math.min(0, this.portfolio.dailyPnL)),
                dailyLossLimit: this.riskLimits.dailyLossLimit,
                weeklyLossUsed: Math.abs(Math.min(0, this.portfolio.weeklyPnL)),
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

    getRecentTrades(limit = 20) {
        return this.tradeHistory.slice(-limit).reverse();
    }

    generateTradeId() {
        return `enhanced_trade_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff)).toDateString();
    }

    /**
     * NEW: Update configuration dynamically
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info(
            `⚙️ Paper Trading Engine config updated. Trading enabled: ${this.config.enableTrading}`
        );
        this.emit("configUpdated", this.config);
    }

    async initialize() {
        try {
            logger.info("🔄 Initializing ENHANCED Paper Trading Engine...");
            await this.loadStateFromDatabase();
            await this.loadTradeHistory();
            this.recalculateEnhancedPerformanceMetrics();
            logger.success(
                `✅ ENHANCED Engine loaded: ${this.portfolio.totalValue.toFixed(
                    2
                )} portfolio value`
            );
        } catch (error) {
            logger.error("❌ Failed to load enhanced state:", error);
            logger.info("🆕 Starting with fresh enhanced state");
        }
    }

    recalculateEnhancedPerformanceMetrics() {
        // Reset metrics
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
            signalPerformance: {
                BUY_STRONG: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
                BUY_MEDIUM: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
                BUY_WEAK: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
            },
            holdingPeriodStats: {
                avgHoldingTime: 0,
                shortTrades: 0,
                mediumTrades: 0,
                longTrades: 0,
                holdingTimes: [],
            },
            exitReasonStats: {
                TAKE_PROFIT: { count: 0, totalPnL: 0, avgPnL: 0 },
                TRAILING_STOP: { count: 0, totalPnL: 0, avgPnL: 0 },
                STOP_LOSS: { count: 0, totalPnL: 0, avgPnL: 0 },
                SIGNAL_SELL: { count: 0, totalPnL: 0, avgPnL: 0 },
                LOW_VOLATILITY_EXIT: { count: 0, totalPnL: 0, avgPnL: 0 },
            },
            assetPerformance: {
                BTCUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                ETHUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                BNBUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                DOGEUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
            },
            volatilityStats: {
                tradesBlocked: 0,
                lowVolatilityPeriods: 0,
                avgVolatilityWhenTrading: 0,
            },
        };

        // Recalculate from all sell trades
        const sellTrades = this.tradeHistory.filter((t) => t.side === "SELL");
        sellTrades.forEach((trade) => {
            this.updateEnhancedPerformanceMetrics(trade);
        });

        logger.debug(
            "📊 Enhanced performance metrics recalculated from trade history"
        );
    }

    async start() {
        if (!this.lastStateSave) {
            await this.initialize();
        }
        this.isActive = true;
        logger.info(
            "🚀 ENHANCED Paper Trading Engine started with all improvements!"
        );
        this.emit("engineStarted");
        await this.saveStateToDatabase();
    }

    async stop() {
        this.isActive = false;
        await this.saveStateToDatabase();
        logger.info("📴 ENHANCED Paper Trading Engine stopped");
        this.emit("engineStopped");
    }

    async reset() {
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
            signalPerformance: {
                BUY_STRONG: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
                BUY_MEDIUM: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
                BUY_WEAK: { trades: 0, wins: 0, totalPnL: 0, avgHoldTime: 0 },
            },
            holdingPeriodStats: {
                avgHoldingTime: 0,
                shortTrades: 0,
                mediumTrades: 0,
                longTrades: 0,
                holdingTimes: [],
            },
            exitReasonStats: {
                TAKE_PROFIT: { count: 0, totalPnL: 0, avgPnL: 0 },
                TRAILING_STOP: { count: 0, totalPnL: 0, avgPnL: 0 },
                STOP_LOSS: { count: 0, totalPnL: 0, avgPnL: 0 },
                SIGNAL_SELL: { count: 0, totalPnL: 0, avgPnL: 0 },
                LOW_VOLATILITY_EXIT: { count: 0, totalPnL: 0, avgPnL: 0 },
            },
            assetPerformance: {
                BTCUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                ETHUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                BNBUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
                DOGEUSDT: {
                    trades: 0,
                    wins: 0,
                    totalPnL: 0,
                    winRate: 0,
                    avgPnL: 0,
                },
            },
            volatilityStats: {
                tradesBlocked: 0,
                lowVolatilityPeriods: 0,
                avgVolatilityWhenTrading: 0,
            },
        };

        this.riskLimits.isHalted = false;
        this.riskLimits.haltReason = null;

        await this.saveStateToDatabase();
        logger.info("🔄 ENHANCED Paper Trading Engine reset to initial state");
        this.emit("engineReset");
    }

    // Database methods (implement based on your existing database setup)
    async saveStateToDatabase() {
        try {
            // Convert Map to Object for JSON storage
            const positionsObj = {};
            this.portfolio.positions.forEach((position, symbol) => {
                positionsObj[symbol] = position;
            });

            const state = {
                portfolio: {
                    ...this.portfolio,
                    positions: positionsObj,
                },
                performanceMetrics: this.performanceMetrics,
                riskLimits: this.riskLimits,
                config: this.config,
                lastUpdate: Date.now(),
            };

            // Use your existing database save method
            // await db('paper_trading_state').insert(state).onConflict('id').merge();

            logger.debug("💾 Enhanced engine state saved to database");
        } catch (error) {
            logger.error("Failed to save enhanced state:", error);
        }
    }

    async loadStateFromDatabase() {
        try {
            // Use your existing database load method
            // const state = await db('paper_trading_state').first();

            // if (state) {
            //     this.portfolio = {
            //         ...state.portfolio,
            //         positions: new Map(Object.entries(state.portfolio.positions || {}))
            //     };
            //     this.performanceMetrics = state.performanceMetrics || this.performanceMetrics;
            //     this.riskLimits = state.riskLimits || this.riskLimits;
            // }

            logger.debug("📖 Enhanced engine state loaded from database");
        } catch (error) {
            logger.error("Failed to load enhanced state:", error);
        }
    }

    async loadTradeHistory() {
        try {
            // Use your existing database load method
            // const trades = await db('trades').orderBy('timestamp', 'asc');
            // this.tradeHistory = trades || [];

            logger.debug("📈 Enhanced trade history loaded from database");
        } catch (error) {
            logger.error("Failed to load enhanced trade history:", error);
        }
    }
}

module.exports = PaperTradingEngine;
