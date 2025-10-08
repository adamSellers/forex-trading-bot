// backend/src/services/tradingService.js - FIXED VERSION
const EventEmitter = require("events");
const BinanceDataService = require("./binanceDataService");
const SignalGenerator = require("./signalGenerator");
const RiskManagementService = require("./riskManagementService");
const PaperTradingEngine = require("./paperTradingEngine");
const LiveTradingEngine = require("./LiveTradingEngine"); // FIX: Case-sensitive path for Linux
const TradeRepository = require("../repositories/tradeRepository");
const AnalyticsService = require("./analyticsService");
const SignalRepository = require("../repositories/signalRepository");
const logger = require("../utils/logger");

class TradingService extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.isActive = false;

        // Initialize repositories
        this.tradeRepo = new TradeRepository();
        this.signalRepo = new SignalRepository();

        // Default configuration
        this.config = {
            strategy: "balanced",
            timeframe: "1h",
            tradingMode: "paper", // 'paper' or 'live'
            enableTrading: false,
            assets: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT", "TRUMPUSDT"],
            timeframes: ["1h", "4h", "1d"],
            maxCapitalAtRisk: 5000,
            riskPerTrade: 0.01,
            maxDailyLoss: 0.02,
            maxWeeklyLoss: 0.05,
            allocation: {
                BTCUSDT: 0.3,
                ETHUSDT: 0.3,
                BNBUSDT: 0.15,
                DOGEUSDT: 0.1,
                TRUMPUSDT: 0.15,
            },
        };
        // NEW: Initialize S3 settings from environment variables
        this.config.enableS3SignalLogging =
            process.env.ENABLE_S3_SIGNAL_LOGGING === "true";

        // The active trading engine (either paper or live)
        this.activeEngine = null;

        logger.info("🎯 TradingService initialized with clean architecture");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Service...");

            // NEW: Set initial log level in config from the logger's current state
            this.config.logLevel = logger.getLogLevelName();

            // Initialize core services
            this.binanceData = new BinanceDataService(this.config);
            this.riskService = new RiskManagementService();
            this.signalGenerator = new SignalGenerator(this.config);

            // ** THE ENGINE SWITCH **
            if (this.config.tradingMode === "live") {
                logger.warn(
                    "🚨 TRADING MODE IS SET TO 'LIVE'. INITIALIZING LIVE ENGINE. 🚨"
                );
                this.activeEngine = new LiveTradingEngine(
                    this.config,
                    this.binanceData,
                    this.riskService
                );
            } else {
                logger.info(
                    "Trading mode is 'paper'. Initializing paper trading engine."
                );
                this.activeEngine = new PaperTradingEngine(
                    this.config,
                    this.riskService
                );
            }

            // CRITICAL FIX: Initialize the risk service *before* any service that might trigger a risk check.
            // The Binance data service starts emitting price updates immediately, which triggers portfolio/risk updates.
            // If the risk limits aren't set first, it defaults to 0 and halts trading instantly.
            this.riskService.initialize(this.config);

            // Start the data service initialization, which runs in the background
            this.binanceData.initialize();

            // Wait for services to be ready
            await this.waitForServices();
            await this.activeEngine.initialize();

            // Start services
            this.signalGenerator.start(this.binanceData, 60000);

            // Initialize analytics service
            // FIX: Initialize analytics AFTER the engine is initialized.
            this.analyticsService = new AnalyticsService(this.activeEngine);

            // NEW: Start the S3 upload scheduler
            this.analyticsService.startS3UploadScheduler();

            this.setupServiceEvents();
            this.isActive = true;

            // Start the engine last, after all event listeners are set up.
            this.activeEngine.start();

            logger.success("✅ Trading Service initialized successfully");
        } catch (error) {
            // Change this line to pass the full error object to the logger
            logger.error("❌ Trading Service initialization failed:", error);
            throw error;
        }
    }

    async waitForServices() {
        return new Promise((resolve, reject) => {
            let servicesReady = 0;
            const totalServices = 1; // Just waiting for binanceData

            const checkReady = () => {
                servicesReady++;
                if (servicesReady >= totalServices) {
                    resolve();
                }
            };

            this.binanceData.once("serviceReady", checkReady);
            this.binanceData.once("serviceError", reject);

            // Timeout after 30 seconds
            setTimeout(
                () =>
                    reject(
                        new Error(
                            "Service initialization timeout: BinanceDataService did not become ready in 30s."
                        )
                    ),
                30000
            );
        });
    }

    setupServiceEvents() {
        // Signal generation events
        this.signalGenerator.on("signalGenerated", async (signal) => {
            try {
                await this.handleSignal(signal);
                this.emit("signalGenerated", signal);
            } catch (error) {
                logger.error("Error handling signal:", error);
            }
        });

        this.signalGenerator.on("allSignalsGenerated", (signals) => {
            this.emit("allSignalsGenerated", signals);
            this.io.emit("allSignalsGenerated", signals);
        });

        // Trade execution events
        this.activeEngine.on("tradeExecuted", async (trade) => {
            try {
                await this.tradeRepo.save(trade);
                this.emit("tradeExecuted", trade);
                this.io.emit("tradeExecuted", trade);
            } catch (error) {
                logger.error("Error saving trade:", error);
            }
        });

        this.activeEngine.on("portfolioUpdated", (portfolio) => {
            this.emit("portfolioUpdated", portfolio);
            this.io.emit("portfolioUpdated", portfolio);
        });

        this.activeEngine.on("tradingHalted", (data) => {
            this.emit("tradingHalted", data);
            this.io.emit("tradingHalted", data);
        });

        // Price update events
        this.binanceData.on("priceUpdate", (priceData) => {
            const allPrices = this.binanceData.getAllPrices();
            this.activeEngine.updatePortfolioValue(allPrices);
            this.io.emit("priceUpdate", priceData);
        });
    }

    async handleSignal(signal) {
        try {
            // Save signal to database
            await this.signalRepo.save(signal);

            // NEW: Log the raw signal to S3 for backtesting dataset creation.
            // This is done before any trading logic is applied.
            if (this.analyticsService) {
                const priceData = this.binanceData.getCurrentPrice(
                    signal.symbol
                );
                await this.analyticsService.logSignalToS3(
                    signal,
                    priceData.price
                );
            }

            // Process signal if trading enabled
            if (this.config.enableTrading && this.activeEngine) {
                const priceData = this.binanceData.getCurrentPrice(
                    signal.symbol
                );
                if (priceData) {
                    const result = await this.activeEngine.processSignal(
                        signal,
                        priceData.price,
                        signal.atr
                    );

                    if (result.success) {
                        // FIX: Log the actual action taken by the engine, not just the initial signal.
                        logger.info(
                            `🎯 Signal processed: ${signal.symbol} -> Action: ${
                                result.action || "NONE"
                            }. Reason: ${result.reason}`
                        ); // The reason is provided by the engine.
                    }
                }
            }
        } catch (error) {
            logger.error("Error handling signal:", error);
        }
    }

    // =================== API METHODS ===================

    getStatus() {
        try {
            const binanceStatus = this.binanceData
                ? this.binanceData.getServiceStatus()
                : null;
            const engineStatus = this.activeEngine
                ? this.activeEngine.getStatus()
                : null;
            const signalStatus = this.signalGenerator
                ? this.signalGenerator.getStatus()
                : null;

            return {
                isInitialized: this.isActive,
                config: this.config,
                services: {
                    binanceData: binanceStatus,
                    engine: engineStatus,
                    signalGenerator: signalStatus,
                },
                requirements: {
                    minCandles:
                        this.signalGenerator?.getRequiredCandleCount() || 50,
                },
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting status:", error);
            throw error;
        }
    }

    async getSignals(query = {}) {
        try {
            const limit = parseInt(query.limit) || 50;
            const symbol = query.symbol;

            if (symbol) {
                return await this.signalRepo.getBySymbol(symbol, limit);
            } else {
                return await this.signalRepo.getRecent(limit);
            }
        } catch (error) {
            logger.error("Error getting signals:", error);
            throw error;
        }
    }

    async getTrades(query = {}) {
        try {
            const limit = parseInt(query.limit) || 20;
            const symbol = query.symbol;
            const currentMode = this.config.tradingMode; // Get the current mode

            if (symbol) {
                return await this.tradeRepo.getBySymbol(
                    symbol,
                    limit,
                    currentMode
                );
            } else {
                return await this.tradeRepo.getRecent(limit, currentMode);
            }
        } catch (error) {
            logger.error("Error getting trades:", error);
            throw error;
        }
    }

    async getPrices() {
        try {
            if (!this.binanceData) {
                throw new Error("Binance data service not available");
            }
            return this.binanceData.getAllPrices();
        } catch (error) {
            logger.error("Error getting prices:", error);
            throw error;
        }
    }

    async getPortfolio() {
        try {
            if (!this.activeEngine) {
                throw new Error("Trading engine not initialized");
            }
            // The active engine is the source of truth for the portfolio
            return this.activeEngine.getPortfolioSummary();
        } catch (error) {
            logger.error("Error getting portfolio from service:", error);
            throw error;
        }
    }

    // backend/src/services/tradingService.js - UPDATE getAccount method

    async getAccount() {
        try {
            logger.debug("🔄 Getting account information...");

            if (!this.binanceData) {
                throw new Error("Binance data service not available");
            }

            // FIXED: Better error handling for account info
            const account = await this.binanceData.getAccountInfo();

            // Get paper trading context
            const paperPortfolio = this.activeEngine
                ? this.activeEngine.getPortfolioSummary()
                : null;

            // CRITICAL FIX: Enhanced response with error handling
            const response = {
                ...account,
                paperTrading:
                    this.config.tradingMode === "paper" && paperPortfolio
                        ? {
                              enabled: this.config.enableTrading,
                              totalValue: paperPortfolio.totalValue,
                              totalPnL: paperPortfolio.totalPnL,
                              positions: paperPortfolio.positions,
                          }
                        : { enabled: false },

                // Add system status context
                systemStatus: {
                    apiConnected: !account.error,
                    lastUpdate: new Date().toISOString(),
                    mode: this.config.tradingMode,
                },
            };

            // Log appropriate success/warning message
            if (account.error) {
                logger.warn(
                    `⚠️ Account API using fallback: ${account.error.message}`
                );
            } else {
                logger.success("✅ Account information retrieved successfully");
            }

            return response;
        } catch (error) {
            // FIXED: Better error logging and context
            logger.error("❌ Account service error:", {
                error: error.message,
                service: "tradingService.getAccount",
                timestamp: new Date().toISOString(),
            });

            // Re-throw with better error context
            throw new Error(`Account service unavailable: ${error.message}`);
        }
    }

    async updateConfig(newConfig) {
        try {
            // NEW: Handle log level changes
            if (
                newConfig.logLevel &&
                newConfig.logLevel !== this.config.logLevel
            ) {
                logger.setLogLevel(newConfig.logLevel);
            }

            // Merge with existing config
            this.config = { ...this.config, ...newConfig };

            // Update service configurations
            if (this.signalGenerator) {
                this.signalGenerator.updateConfig(this.config);
            }

            // --- CRITICAL FIX: Re-initialize active engine if trading mode changed ---
            if (
                this.activeEngine &&
                this.activeEngine.mode !== newConfig.tradingMode
            ) {
                logger.warn(
                    `Trading mode changed to ${newConfig.tradingMode}. Re-initializing engine.`
                );
                await this.activeEngine.stop();
                this.activeEngine = this.createTradingEngine(
                    newConfig.tradingMode
                );
                await this.activeEngine.initialize();
                this.activeEngine.start();
                logger.success(
                    `Trading engine re-initialized to ${newConfig.tradingMode} mode.`
                );
            }

            if (this.activeEngine) {
                this.activeEngine.updateConfig(this.config);
            }
            if (this.riskService) {
                this.riskService.updateConfig(this.config);
            }
            // NEW: Pass the updated config to the analytics service
            if (this.analyticsService) {
                this.riskService.updateConfig(this.config);
            }

            logger.info("⚙️ Trading service configuration updated");
            this.emit("configUpdated", this.config);

            // CRITICAL FIX: Push the new system status to all clients
            this.io.emit("systemStatus", this.getStatus());
        } catch (error) {
            logger.error("Error updating config:", error);
            throw error;
        }
    }

    /**
     * FIX: Add the missing helper method to create a trading engine instance.
     * This resolves the "this.createTradingEngine is not a function" error.
     * @param {string} tradingMode - The mode ('paper' or 'live') for the new engine.
     * @returns {PaperTradingEngine|LiveTradingEngine}
     */
    createTradingEngine(tradingMode) {
        if (tradingMode === "live") {
            logger.warn(
                "🚨 TRADING MODE IS SET TO 'LIVE'. CREATING NEW LIVE ENGINE. 🚨"
            );
            return new LiveTradingEngine(
                this.config,
                this.binanceData,
                this.riskService
            );
        } else {
            logger.info(
                "Trading mode is 'paper'. Creating new paper trading engine."
            );
            return new PaperTradingEngine(this.config, this.riskService);
        }
    }

    async startTrading() {
        try {
            this.config.enableTrading = true;
            if (this.activeEngine) {
                await this.activeEngine.start();
            }
            logger.info("▶️ Trading started");
            this.emit("tradingStarted");
            this.io.emit("tradingStarted");
        } catch (error) {
            logger.error("Error starting trading:", error);
            throw error;
        }
    }
    async stopTrading() {
        try {
            this.config.enableTrading = false;
            if (this.activeEngine) {
                await this.activeEngine.stop();
            }
            logger.info("⏹️ Trading stopped");
            this.emit("tradingStopped");
            this.io.emit("tradingStopped");
        } catch (error) {
            logger.error("Error stopping trading:", error);
            throw error;
        }
    }

    async resetTrading() {
        try {
            // Reset active trading engine
            if (
                this.activeEngine &&
                typeof this.activeEngine.reset === "function"
            ) {
                await this.activeEngine.reset();
            }

            // Reset signal generator
            if (this.signalGenerator) {
                this.signalGenerator.reset();
            }

            logger.info("🔄 Trading engine reset");
            this.emit("tradingReset");
            this.io.emit("tradingReset");
        } catch (error) {
            logger.error("Error resetting trading:", error);
            throw error;
        }
    }

    async cleanup() {
        logger.info("🧹 Cleaning up Trading Service...");

        try {
            // Stop services
            if (this.signalGenerator) {
                this.signalGenerator.stop();
            }
            if (this.activeEngine) {
                this.activeEngine.stop();
            }
            if (this.binanceData) {
                await this.binanceData.stop();
            }

            this.isActive = false;
            logger.success("✅ Trading Service cleaned up successfully");
        } catch (error) {
            logger.error("Error during cleanup:", error);
        }
    }
}

module.exports = TradingService;
