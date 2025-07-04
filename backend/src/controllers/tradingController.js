// backend/src/controllers/tradingController.js - ENHANCED WITH ALL IMPROVEMENTS (COMPLETE)
const BinanceDataService = require("../services/binanceDataService");
const SignalGenerator = require("../services/signalGenerator");
const PaperTradingEngine = require("../services/paperTradingEngine");
const logger = require("../utils/logger");
const { EventEmitter } = require("events");

class EnhancedTradingController extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            // Base configuration
            startingCapital: config.startingCapital || 5000,
            riskPerTrade: config.riskPerTrade || 0.01,
            maxDailyLoss: config.maxDailyLoss || 0.02,
            maxWeeklyLoss: config.maxWeeklyLoss || 0.05,
            allocation: config.allocation || {
                BTCUSDT: 0.35,
                ETHUSDT: 0.35,
                BNBUSDT: 0.2,
                DOGEUSDT: 0.1,
            },
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],
            timeframes: config.timeframes || ["1h", "4h", "1d"],
            strategy: config.strategy || "balanced",
            timeframe: config.timeframe || "1h",
            enableTrading: config.enableTrading || false,

            // NEW: Enhanced features configuration
            enableTrailingStops: config.enableTrailingStops !== false,
            trailingStopPercent: config.trailingStopPercent || 0.02,
            takeProfitATRMultiplier: config.takeProfitATRMultiplier || 2.5,
            enableVolatilityFilter: config.enableVolatilityFilter !== false,
            minVolatilityPercent: config.minVolatilityPercent || 2.0,
            autoFetchExchangeInfo: config.autoFetchExchangeInfo !== false,

            ...config,
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

        // NEW: Enhanced event tracking
        this.eventHistory = [];
        this.performanceSnapshots = [];
        this.lastPerformanceSnapshot = 0;

        logger.info(
            "🚀 ENHANCED Trading Controller initialized with all improvements!"
        );
    }

    /**
     * ENHANCED: Initialize all services with new features
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
     * NEW: Set up enhanced event listeners with comprehensive monitoring
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
        });

        // NEW: Enhanced exit trigger handling
        this.paperTrading.on("exitTriggered", async (exitData) => {
            const { symbol, position, currentPrice, reason } = exitData;

            logger.info(
                `🎯 Exit triggered: ${reason} for ${symbol} at $${currentPrice}`
            );

            // Create exit signal
            const exitSignal = {
                signal: "SELL",
                strength: 1.0,
                reason: reason,
                timestamp: Date.now(),
                triggerType: "AUTOMATIC",
            };

            try {
                // Execute the exit
                const result = await this.paperTrading.executeSellOrder(
                    symbol,
                    currentPrice,
                    exitSignal,
                    position,
                    reason
                );

                if (result.success) {
                    this.logEvent("AUTOMATIC_EXIT", {
                        symbol,
                        reason,
                        price: currentPrice,
                        pnl: result.pnl,
                    });
                }
            } catch (error) {
                logger.error(
                    `❌ Failed to execute automatic exit for ${symbol}:`,
                    error
                );
                this.logEvent("EXIT_ERROR", {
                    symbol,
                    reason,
                    error: error.message,
                });
            }
        });

        this.paperTrading.on("tradingHalted", (data) => {
            logger.error(`🛑 Trading halted: ${data.reason}`);
            this.logEvent("TRADING_HALTED", data);
            this.emit("tradingHalted", data);
        });

        this.paperTrading.on("tradingResumed", (data) => {
            logger.info("✅ Trading resumed");
            this.logEvent("TRADING_RESUMED", data);
            this.emit("tradingResumed", data);
        });

        // Signal Generator events
        this.signalGenerator.on("allSignalsGenerated", (signals) => {
            this.emit("signalsGenerated", signals);
        });

        logger.success("✅ Enhanced event listeners configured");
    }

    /**
     * NEW: Set up performance monitoring and snapshots
     */
    setupPerformanceMonitoring() {
        logger.info("📊 Setting up performance monitoring...");

        // Take performance snapshots every 5 minutes
        this.performanceInterval = setInterval(() => {
            this.takePerformanceSnapshot();
        }, 5 * 60 * 1000);

        // Monitor for significant events
        this.paperTrading.on("portfolioUpdated", (portfolio) => {
            // Check for significant changes
            this.checkForSignificantEvents(portfolio);
        });

        logger.success("✅ Performance monitoring active");
    }

    /**
     * NEW: Take performance snapshot for trend analysis
     */
    takePerformanceSnapshot() {
        if (!this.paperTrading) return;

        const snapshot = {
            timestamp: Date.now(),
            portfolio: this.paperTrading.getPortfolioSummary(),
            performance: this.paperTrading.getEnhancedPerformanceSummary(),
            volatility: this.signalGenerator?.getVolatilityAnalysis() || null,
            signalStats: this.signalGenerator?.getEnhancedSignalStats() || null,
        };

        this.performanceSnapshots.push(snapshot);

        // Keep only last 100 snapshots
        if (this.performanceSnapshots.length > 100) {
            this.performanceSnapshots = this.performanceSnapshots.slice(-50);
        }

        this.lastPerformanceSnapshot = Date.now();

        // Emit snapshot for real-time dashboard updates
        this.emit("performanceSnapshot", snapshot);
    }

    /**
     * NEW: Check for significant events that need attention
     */
    checkForSignificantEvents(portfolio) {
        const events = [];

        // Check drawdown levels
        if (portfolio.performance.currentDrawdown > 15) {
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
        const profitablePositions = portfolio.positions.filter(
            (p) => p.unrealizedPnL > p.entryCost * 0.1
        );
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
     * NEW: Enhanced main trading loop with all improvements
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
     * NEW: Execute enhanced trading cycle with all new features
     */
    async executeEnhancedTradingCycle() {
        if (!this.isRunning || !this.paperTrading.isActive) {
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

            // 3. Process each signal with enhanced features
            for (const signal of signals) {
                if (!this.isRunning) break; // Check if we should stop

                try {
                    const currentPrice = this.binanceData.getCurrentPrice(
                        signal.symbol
                    )?.price;
                    if (!currentPrice) {
                        logger.warn(
                            `⚠️ No price data for ${signal.symbol}, skipping`
                        );
                        continue;
                    }

                    // Get ATR for enhanced position sizing and take-profit calculation
                    const candles = this.binanceData.getCandles(
                        signal.symbol,
                        this.config.timeframe
                    );
                    const atrValue = this.signalGenerator.calculateATR(candles);

                    // Process signal with all enhancements
                    const result = await this.paperTrading.processSignal(
                        signal,
                        currentPrice,
                        atrValue,
                        this.binanceData // Pass for dynamic order minimums
                    );

                    if (result.success && result.action !== "HOLD") {
                        logger.info(
                            `✅ Enhanced ${result.action}: ${signal.symbol} - ${
                                signal.signal
                            } (Strength: ${signal.strength?.toFixed(
                                2
                            )}, Volatility: ${signal.volatilityRating})`
                        );
                    }
                } catch (error) {
                    logger.error(
                        `❌ Error processing signal for ${signal.symbol}:`,
                        error
                    );
                }
            }

            // 4. Update portfolio with current prices (handles trailing stops automatically)
            this.paperTrading.updatePortfolioValue(
                this.binanceData.getAllPrices()
            );

            // 5. Log cycle completion
            this.logEvent("TRADING_CYCLE_COMPLETED", {
                signalsProcessed: signals.length,
                activePositions: this.paperTrading.portfolio.positions.size,
                portfolioValue: this.paperTrading.portfolio.totalValue,
            });
        } catch (error) {
            logger.error("❌ Enhanced trading cycle error:", error);
            throw error;
        }
    }

    /**
     * NEW: Enhanced event logging system
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
            this.emit("systemStarted");
        } catch (error) {
            logger.error(
                "❌ Failed to start Enhanced Trading Controller:",
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
            logger.info("🛑 Stopping ENHANCED Trading Controller...");

            this.isRunning = false;

            // Stop trading intervals
            if (this.tradingInterval) {
                clearInterval(this.tradingInterval);
                this.tradingInterval = null;
            }

            if (this.performanceInterval) {
                clearInterval(this.performanceInterval);
                this.performanceInterval = null;
            }

            // Stop paper trading engine
            if (this.paperTrading) {
                await this.paperTrading.stop();
            }

            // Stop binance data service
            if (this.binanceData) {
                await this.binanceData.stop();
            }

            this.logEvent("SYSTEM_STOPPED", {
                totalUptime:
                    Date.now() -
                    (this.eventHistory.find((e) => e.type === "SYSTEM_STARTED")
                        ?.timestamp || Date.now()),
                totalEvents: this.eventHistory.length,
            });

            logger.success("✅ ENHANCED Trading Controller stopped");
            this.emit("systemStopped");
        } catch (error) {
            logger.error(
                "❌ Error stopping Enhanced Trading Controller:",
                error
            );
            this.emit("systemError", error);
            throw error;
        }
    }

    /**
     * Reset the enhanced trading system
     */
    async reset() {
        try {
            logger.info("🔄 Resetting ENHANCED Trading Controller...");

            const wasRunning = this.isRunning;

            // Stop if running
            if (wasRunning) {
                await this.stop();
            }

            // Reset all services
            if (this.paperTrading) {
                await this.paperTrading.reset();
            }

            if (this.signalGenerator) {
                this.signalGenerator.reset();
            }

            // Clear event history and performance snapshots
            this.eventHistory = [];
            this.performanceSnapshots = [];
            this.lastPerformanceSnapshot = 0;

            this.logEvent("SYSTEM_RESET", {
                resetTime: Date.now(),
                autoRestart: wasRunning,
            });

            // Restart if it was running
            if (wasRunning) {
                await this.start();
            }

            logger.success("✅ ENHANCED Trading Controller reset completed");
            this.emit("systemReset");
        } catch (error) {
            logger.error(
                "❌ Error resetting Enhanced Trading Controller:",
                error
            );
            this.emit("systemError", error);
            throw error;
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
