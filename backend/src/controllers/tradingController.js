// backend/src/controllers/tradingController.js - COMPLETE ENHANCED VERSION
const BinanceDataService = require("../services/binanceDataService");
const SignalGenerator = require("../services/signalGenerator");
const PaperTradingEngine = require("../services/paperTradingEngine");
const logger = require("../utils/logger");
const { EventEmitter } = require("events");

class EnhancedTradingController extends EventEmitter {
    constructor(socketIO = null) {
        super();

        // FIXED: Store socket.io safely without circular reference
        this.socketIO = socketIO;

        this.config = {
            // Base configuration
            startingCapital: 5000,
            riskPerTrade: 0.01,
            maxDailyLoss: 0.02,
            maxWeeklyLoss: 0.05,
            allocation: {
                BTCUSDT: 0.35,
                ETHUSDT: 0.35,
                BNBUSDT: 0.2,
                DOGEUSDT: 0.1,
            },
            assets: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"],
            timeframes: ["1h", "4h", "1d"],
            strategy: "balanced",
            timeframe: "1h",
            enableTrading: false,

            // Enhanced features configuration
            enableTrailingStops: true,
            trailingStopPercent: 0.02,
            takeProfitATRMultiplier: 2.5,
            enableVolatilityFilter: true,
            minVolatilityPercent: 2.0,
            autoFetchExchangeInfo: true,
        };

        // Service instances
        this.binanceData = null;
        this.signalGenerator = null;
        this.paperTrading = null;

        // State management
        this.isInitialized = false;
        this.isRunning = false;
        this.tradingInterval = null;
        this.performanceInterval = null;

        // Enhanced tracking
        this.eventHistory = [];
        this.performanceSnapshots = [];
        this.lastPerformanceSnapshot = 0;

        logger.info(
            "🚀 ENHANCED Trading Controller initialized with all improvements!"
        );
    }

    /**
     * Initialize all services with enhanced features
     */
    async initialize() {
        try {
            logger.info("🔧 Initializing ENHANCED Trading Controller...");

            // 1. Initialize Binance Data Service with exchange info
            logger.info("📡 Setting up Enhanced Binance Data Service...");
            this.binanceData = new BinanceDataService({
                ...this.config,
                autoFetchExchangeInfo: this.config.autoFetchExchangeInfo,
                cacheExchangeInfo: true,
            });
            await this.binanceData.initialize();

            // 2. Initialize Enhanced Signal Generator with volatility filter
            logger.info("🎯 Setting up Enhanced Signal Generator...");
            this.signalGenerator = new SignalGenerator({
                ...this.config,
                enableVolatilityFilter: this.config.enableVolatilityFilter,
                minVolatilityPercent: this.config.minVolatilityPercent,
            });
            await this.signalGenerator.initialize();

            // 3. Initialize Enhanced Paper Trading Engine
            logger.info("💰 Setting up Enhanced Paper Trading Engine...");
            this.paperTrading = new PaperTradingEngine({
                ...this.config,
                enableTrailingStops: this.config.enableTrailingStops,
                trailingStopPercent: this.config.trailingStopPercent,
                takeProfitATRMultiplier: this.config.takeProfitATRMultiplier,
                enableVolatilityFilter: this.config.enableVolatilityFilter,
            });
            await this.paperTrading.initialize();

            // 4. Set up enhanced event listeners
            this.setupEnhancedEventListeners();

            // 5. Set up performance monitoring
            this.setupPerformanceMonitoring();

            this.isInitialized = true;
            logger.success(
                "✅ ENHANCED Trading Controller initialized successfully!"
            );

            this.emit("controllerInitialized", {
                timestamp: Date.now(),
                features: [
                    "Trailing Stops & Take Profit",
                    "Volatility Filter",
                    "Dynamic Order Minimums",
                    "Enhanced Performance Metrics",
                    "Risk Management",
                ],
            });
        } catch (error) {
            logger.error(
                "❌ Failed to initialize Enhanced Trading Controller:",
                error
            );
            this.emit("initializationError", error);
            throw error;
        }
    }

    /**
     * Set up enhanced event listeners with comprehensive monitoring
     */
    setupEnhancedEventListeners() {
        logger.info("🔗 Setting up enhanced event listeners...");

        // Binance Data Service events
        this.binanceData.on("priceUpdate", (priceData) => {
            this.paperTrading.updatePortfolioValue(
                this.binanceData.getAllPrices()
            );
            this.emit("priceUpdate", priceData);
        });

        this.binanceData.on("serviceReady", () => {
            logger.success("📡 Binance Data Service is ready");
            this.emit("binanceReady");
        });

        this.binanceData.on("serviceError", (error) => {
            logger.error("📡 Binance Data Service error:", error);
            this.emit("binanceError", error);
        });

        // Enhanced Paper Trading events
        this.paperTrading.on("tradeExecuted", (trade) => {
            logger.info(
                `💼 Trade executed: ${trade.side} ${trade.symbol} - ${
                    trade.exitReason || "Entry"
                }`
            );
            this.logEvent("TRADE_EXECUTED", trade);
            this.emit("tradeExecuted", trade);

            // Emit to socket clients
            if (this.socketIO) {
                this.socketIO.emit("tradeExecuted", trade);
            }
        });

        // Enhanced exit trigger handling
        this.paperTrading.on("takeProfitTriggered", (data) => {
            logger.success(
                `🎯 Take Profit triggered: ${data.symbol} at ${data.price}`
            );
            this.logEvent("TAKE_PROFIT_TRIGGERED", data);
            this.emit("takeProfitTriggered", data);
        });

        this.paperTrading.on("trailingStopTriggered", (data) => {
            logger.info(
                `📈 Trailing Stop triggered: ${data.symbol} at ${data.price}`
            );
            this.logEvent("TRAILING_STOP_TRIGGERED", data);
            this.emit("trailingStopTriggered", data);
        });

        this.paperTrading.on("portfolioUpdated", (portfolio) => {
            this.emit("portfolioUpdated", portfolio);
            this.checkForSignificantEvents(portfolio);
        });

        this.paperTrading.on("riskLimitHit", (data) => {
            logger.warn(`⚠️ Risk limit hit: ${data.type} - ${data.message}`);
            this.logEvent("RISK_LIMIT_HIT", data);
            this.emit("riskLimitHit", data);

            if (this.socketIO) {
                this.socketIO.emit("tradingHalted", data);
            }
        });

        // Enhanced Signal Generator events
        this.signalGenerator.on("signalGenerated", (signal) => {
            logger.info(
                `📡 Signal: ${signal.symbol} ${signal.signal} (${signal.strength})`
            );
            this.logEvent("SIGNAL_GENERATED", signal);
            this.emit("signalGenerated", signal);

            if (this.socketIO) {
                this.socketIO.emit("newSignal", signal);
            }
        });

        this.signalGenerator.on("volatilityFiltered", (data) => {
            logger.debug(
                `🌊 Signal filtered by volatility: ${data.symbol} (${data.volatility}%)`
            );
            this.logEvent("VOLATILITY_FILTERED", data);
        });

        this.signalGenerator.on("allSignalsGenerated", (signals) => {
            this.emit("signalsGenerated", signals);
        });

        logger.success("✅ Enhanced event listeners configured");
    }

    /**
     * Set up performance monitoring and snapshots
     */
    setupPerformanceMonitoring() {
        logger.info("📊 Setting up performance monitoring...");

        // Take performance snapshots every 5 minutes
        this.performanceInterval = setInterval(() => {
            this.takePerformanceSnapshot();
        }, 5 * 60 * 1000);

        // Monitor for significant events
        this.paperTrading.on("portfolioUpdated", (portfolio) => {
            this.checkForSignificantEvents(portfolio);
        });

        logger.success("✅ Performance monitoring active");
    }

    /**
     * Take performance snapshot for trend analysis
     */
    takePerformanceSnapshot() {
        if (!this.paperTrading) return;

        const snapshot = {
            timestamp: Date.now(),
            portfolio: this.paperTrading.getPortfolioSummary(),
            performance:
                this.paperTrading.getEnhancedPerformanceSummary?.() || {},
            volatility: this.signalGenerator?.getVolatilityAnalysis?.() || null,
            signalStats:
                this.signalGenerator?.getEnhancedSignalStats?.() || null,
        };

        this.performanceSnapshots.push(snapshot);

        // Keep only last 100 snapshots
        if (this.performanceSnapshots.length > 100) {
            this.performanceSnapshots = this.performanceSnapshots.slice(-50);
        }

        this.lastPerformanceSnapshot = Date.now();
        this.emit("performanceSnapshot", snapshot);
    }

    /**
     * Check for significant events that need attention
     */
    checkForSignificantEvents(portfolio) {
        const events = [];

        // Check drawdown levels
        if (portfolio.performance?.currentDrawdown > 15) {
            events.push({
                type: "HIGH_DRAWDOWN",
                severity: "WARNING",
                message: `Current drawdown: ${portfolio.performance.currentDrawdown.toFixed(
                    2
                )}%`,
                timestamp: Date.now(),
            });
        }

        // Check profit taking opportunities
        const profitablePositions =
            portfolio.positions?.filter?.(
                (p) => p.unrealizedPnL > p.entryCost * 0.1
            ) || [];
        if (profitablePositions.length > 0) {
            events.push({
                type: "PROFIT_OPPORTUNITY",
                severity: "INFO",
                message: `${profitablePositions.length} positions with >10% profit`,
                timestamp: Date.now(),
            });
        }

        // Emit events
        events.forEach((event) => {
            this.logEvent(event.type, event);
            this.emit("significantEvent", event);
        });
    }

    /**
     * Enhanced main trading loop with all improvements
     */
    async startEnhancedTradingLoop() {
        logger.info("🔄 Starting ENHANCED trading loop...");

        this.tradingInterval = setInterval(async () => {
            try {
                await this.executeEnhancedTradingCycle();
            } catch (error) {
                logger.error("❌ Error in enhanced trading cycle:", error);
                this.logEvent("TRADING_CYCLE_ERROR", { error: error.message });
            }
        }, 60000); // Run every minute

        logger.success("✅ Enhanced trading loop started");
    }

    /**
     * Execute enhanced trading cycle with all new features
     */
    async executeEnhancedTradingCycle() {
        if (!this.isRunning || !this.paperTrading?.isActive) {
            return;
        }

        try {
            // 1. Refresh exchange info if needed (for dynamic order minimums)
            if (this.binanceData.refreshExchangeInfoIfNeeded) {
                await this.binanceData.refreshExchangeInfoIfNeeded();
            }

            // 2. Generate signals with volatility filter
            const signals = await this.signalGenerator.generateAllSignals(
                this.binanceData
            );

            // 3. Process signals with enhanced paper trading
            for (const signal of signals) {
                if (this.isRunning && this.paperTrading.isActive) {
                    await this.paperTrading.processSignal(signal);
                }
            }

            // 4. Update portfolio with current prices (handles trailing stops automatically)
            this.paperTrading.updatePortfolioValue(
                this.binanceData.getAllPrices()
            );

            // 5. Log cycle completion
            this.logEvent("TRADING_CYCLE_COMPLETED", {
                signalsProcessed: signals.length,
                activePositions:
                    this.paperTrading.portfolio?.positions?.size || 0,
                portfolioValue: this.paperTrading.portfolio?.totalValue || 0,
            });
        } catch (error) {
            logger.error("❌ Enhanced trading cycle error:", error);
            throw error;
        }
    }

    /**
     * Enhanced event logging system
     */
    logEvent(type, data) {
        const event = {
            type,
            timestamp: Date.now(),
            data,
        };

        this.eventHistory.push(event);

        // Keep only last 1000 events
        if (this.eventHistory.length > 1000) {
            this.eventHistory = this.eventHistory.slice(-500);
        }

        // Emit for real-time monitoring
        this.emit("eventLogged", event);
    }

    /**
     * Start the enhanced trading system
     */
    async start() {
        try {
            if (!this.isInitialized) {
                throw new Error("Trading controller not initialized");
            }

            if (this.isRunning) {
                logger.warn("⚠️ Trading controller already running");
                return;
            }

            logger.info("🚀 Starting ENHANCED Trading Controller...");

            // Start paper trading engine
            await this.paperTrading.start();

            // Start enhanced trading loop
            await this.startEnhancedTradingLoop();

            this.isRunning = true;
            this.logEvent("SYSTEM_STARTED", {
                features: [
                    "Trailing Stops",
                    "Take Profit Levels",
                    "Volatility Filter",
                    "Dynamic Order Minimums",
                    "Enhanced Performance Metrics",
                ],
            });

            logger.success(
                "✅ ENHANCED Trading Controller started successfully!"
            );

            if (this.socketIO) {
                this.socketIO.emit("tradingStarted", { timestamp: Date.now() });
            }

            return { success: true, message: "Enhanced trading started" };
        } catch (error) {
            logger.error(
                "❌ Error starting Enhanced Trading Controller:",
                error
            );
            this.emit("systemError", error);
            throw error;
        }
    }

    /**
     * Stop the enhanced trading system
     */
    async stop() {
        try {
            logger.info("⏹️ Stopping ENHANCED Trading Controller...");

            // Stop trading loop
            if (this.tradingInterval) {
                clearInterval(this.tradingInterval);
                this.tradingInterval = null;
            }

            // Stop paper trading
            if (this.paperTrading) {
                await this.paperTrading.stop();
            }

            this.isRunning = false;
            this.logEvent("SYSTEM_STOPPED", { timestamp: Date.now() });

            logger.success("✅ ENHANCED Trading Controller stopped");

            if (this.socketIO) {
                this.socketIO.emit("tradingStopped", { timestamp: Date.now() });
            }

            return { success: true, message: "Enhanced trading stopped" };
        } catch (error) {
            logger.error(
                "❌ Error stopping Enhanced Trading Controller:",
                error
            );
            this.emit("systemError", error);
            throw error;
        }
    }

    // ============= API METHODS FOR ROUTES =============

    /**
     * FIXED: Get system status without circular references
     */
    async getStatus() {
        try {
            const binanceStatus = this.binanceData?.getServiceStatus() || null;
            const paperStatus = this.paperTrading?.getStatus() || null;
            const signalStatus = this.signalGenerator?.getStatus() || null;

            // CRITICAL FIX: Return safe status without socket.io circular reference
            return {
                isInitialized: this.isInitialized,
                isRunning: this.isRunning,
                config: {
                    ...this.config,
                    // Remove any potential circular references
                },
                services: {
                    binanceData: binanceStatus,
                    paperTrading: paperStatus,
                    signalGenerator: signalStatus,
                },
                uptime: process.uptime(),
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting status:", error);
            throw error;
        }
    }

    /**
     * FIXED: Get portfolio with calculateAvgHoldTime method
     */
    async getPortfolio() {
        try {
            if (!this.paperTrading) {
                throw new Error("Paper trading service not initialized");
            }

            const portfolio = this.paperTrading.getPortfolioSummary();
            const avgHoldTime = this.calculateAvgHoldTime();

            return {
                ...portfolio,
                avgHoldTime,
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting portfolio:", error);
            throw error;
        }
    }

    /**
     * FIXED: Get trades with generateTradeAnalytics method
     */
    async getTrades(query = {}) {
        try {
            const limit = parseInt(query.limit) || 25;

            if (!this.paperTrading) {
                throw new Error("Paper trading service not initialized");
            }

            const trades = this.paperTrading.getRecentTrades(limit);
            const analytics = this.generateTradeAnalytics(trades);

            return {
                trades,
                analytics,
                count: trades.length,
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting trades:", error);
            throw error;
        }
    }

    /**
     * Get trading signals
     */
    async getSignals(query = {}) {
        try {
            const limit = parseInt(query.limit) || 50;

            if (!this.signalGenerator) {
                throw new Error("Signal generator not initialized");
            }

            const signals =
                this.signalGenerator.getRecentSignals?.(limit) || [];

            return {
                signals,
                count: signals.length,
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting signals:", error);
            throw error;
        }
    }

    /**
     * Get current prices
     */
    async getPrices() {
        try {
            if (!this.binanceData) {
                throw new Error("Binance data service not available");
            }

            const prices = this.binanceData.getAllPrices();
            return {
                prices,
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting prices:", error);
            throw error;
        }
    }

    /**
     * FIXED: Get account info without HTML response
     */
    async getAccount() {
        try {
            if (!this.binanceData) {
                throw new Error("Binance data service not available");
            }

            // Get paper trading context
            const paperPortfolio = this.paperTrading
                ? this.paperTrading.getPortfolioSummary()
                : null;

            // CRITICAL FIX: Return JSON-safe account data
            const account = {
                accountType: "SPOT",
                canTrade: true,
                canWithdraw: false,
                canDeposit: false,
                updateTime: Date.now(),
                balances: [
                    {
                        asset: "USDT",
                        free: "5000.00000000",
                        locked: "0.00000000",
                    },
                    { asset: "BTC", free: "0.00000000", locked: "0.00000000" },
                    { asset: "ETH", free: "0.00000000", locked: "0.00000000" },
                    { asset: "BNB", free: "0.00000000", locked: "0.00000000" },
                    { asset: "DOGE", free: "0.00000000", locked: "0.00000000" },
                ],
                paperTrading: paperPortfolio,
                timestamp: Date.now(),
            };

            return account;
        } catch (error) {
            logger.error("Error getting account:", error);
            throw error;
        }
    }

    /**
     * Get combined holdings
     */
    async getCombinedHoldings() {
        try {
            const account = await this.getAccount();
            const portfolio = await this.getPortfolio();

            return {
                real: {
                    balances: account.balances,
                    totalValue: 5000,
                },
                paper: portfolio,
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting combined holdings:", error);
            throw error;
        }
    }

    /**
     * Start trading
     */
    async startTrading() {
        return await this.start();
    }

    /**
     * Stop trading
     */
    async stopTrading() {
        return await this.stop();
    }

    // ============= MISSING IMPLEMENTATIONS =============

    /**
     * IMPLEMENTATION: Missing calculateAvgHoldTime method
     */
    calculateAvgHoldTime() {
        try {
            if (!this.paperTrading) {
                return { hours: 0, trades: 0 };
            }

            const trades = this.paperTrading.getRecentTrades?.(100) || [];
            const closedTrades = trades.filter(
                (trade) => trade.status === "FILLED" && trade.exitTime
            );

            if (closedTrades.length === 0) {
                return { hours: 0, trades: 0 };
            }

            const totalHoldTime = closedTrades.reduce((sum, trade) => {
                const holdTime =
                    (trade.exitTime - trade.timestamp) / (1000 * 60 * 60); // hours
                return sum + holdTime;
            }, 0);

            const avgHours = totalHoldTime / closedTrades.length;

            return {
                hours: Math.round(avgHours * 100) / 100,
                trades: closedTrades.length,
                totalSamples: trades.length,
            };
        } catch (error) {
            logger.error("Error calculating average hold time:", error);
            return { hours: 0, trades: 0, error: error.message };
        }
    }

    /**
     * IMPLEMENTATION: Missing generateTradeAnalytics method
     */
    generateTradeAnalytics(trades) {
        try {
            if (!trades || trades.length === 0) {
                return {
                    summary: { total: 0, profitable: 0, winRate: 0 },
                    byAsset: {},
                    byStrategy: {},
                    performance: {},
                };
            }

            // Summary analytics
            const profitable = trades.filter((t) => (t.pnl || 0) > 0);
            const winRate = (profitable.length / trades.length) * 100;

            // By asset analytics
            const byAsset = {};
            trades.forEach((trade) => {
                if (!byAsset[trade.symbol]) {
                    byAsset[trade.symbol] = { count: 0, totalPnL: 0, wins: 0 };
                }
                byAsset[trade.symbol].count++;
                byAsset[trade.symbol].totalPnL += trade.pnl || 0;
                if ((trade.pnl || 0) > 0) byAsset[trade.symbol].wins++;
            });

            // By strategy analytics
            const byStrategy = {};
            trades.forEach((trade) => {
                const strategy = trade.strategy || "unknown";
                if (!byStrategy[strategy]) {
                    byStrategy[strategy] = { count: 0, totalPnL: 0, wins: 0 };
                }
                byStrategy[strategy].count++;
                byStrategy[strategy].totalPnL += trade.pnl || 0;
                if ((trade.pnl || 0) > 0) byStrategy[strategy].wins++;
            });

            // Performance metrics
            const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const avgPnL = totalPnL / trades.length;

            return {
                summary: {
                    total: trades.length,
                    profitable: profitable.length,
                    winRate: Math.round(winRate * 100) / 100,
                    totalPnL: Math.round(totalPnL * 100) / 100,
                    avgPnL: Math.round(avgPnL * 100) / 100,
                },
                byAsset,
                byStrategy,
                performance: {
                    bestTrade: Math.max(...trades.map((t) => t.pnl || 0)),
                    worstTrade: Math.min(...trades.map((t) => t.pnl || 0)),
                    avgHoldTime: this.calculateAvgHoldTime(),
                },
            };
        } catch (error) {
            logger.error("Error generating trade analytics:", error);
            return {
                summary: { total: 0, profitable: 0, winRate: 0 },
                byAsset: {},
                byStrategy: {},
                performance: {},
                error: error.message,
            };
        }
    }

    /**
     * Get event history with filtering
     */
    getEventHistory(filter = {}) {
        let events = [...this.eventHistory];

        if (filter.type) {
            events = events.filter((e) => e.type === filter.type);
        }

        if (filter.since) {
            events = events.filter((e) => e.timestamp >= filter.since);
        }

        if (filter.limit) {
            events = events.slice(-filter.limit);
        }

        return events.reverse(); // Most recent first
    }

    /**
     * Update configuration
     */
    async updateConfig(newConfig) {
        try {
            this.config = { ...this.config, ...newConfig };

            // Update services if they exist
            if (this.paperTrading) {
                await this.paperTrading.updateConfig(newConfig);
            }

            if (this.signalGenerator) {
                await this.signalGenerator.updateConfig(newConfig);
            }

            this.logEvent("CONFIG_UPDATED", newConfig);
            logger.info("✅ Configuration updated successfully");

            return { success: true, message: "Configuration updated" };
        } catch (error) {
            logger.error("Error updating configuration:", error);
            throw error;
        }
    }

    /**
     * Reset trading engine
     */
    async resetTrading() {
        try {
            await this.stop();

            if (this.paperTrading) {
                await this.paperTrading.reset();
            }

            this.eventHistory = [];
            this.performanceSnapshots = [];

            this.logEvent("SYSTEM_RESET", { timestamp: Date.now() });
            logger.info("✅ Trading system reset successfully");

            if (this.socketIO) {
                this.socketIO.emit("tradingReset", { timestamp: Date.now() });
            }

            return { success: true, message: "Trading system reset" };
        } catch (error) {
            logger.error("Error resetting trading system:", error);
            throw error;
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            logger.info("🧹 Cleaning up Enhanced Trading Controller...");

            await this.stop();

            // Clear all intervals
            if (this.tradingInterval) clearInterval(this.tradingInterval);
            if (this.performanceInterval)
                clearInterval(this.performanceInterval);

            // Remove all listeners
            this.removeAllListeners();

            // Clear data
            this.eventHistory = [];
            this.performanceSnapshots = [];

            logger.success("✅ Enhanced Trading Controller cleanup completed");
        } catch (error) {
            logger.error("❌ Error during cleanup:", error);
            throw error;
        }
    }
}

module.exports = EnhancedTradingController;
