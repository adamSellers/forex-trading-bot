// backend/src/services/tradingService.js - FIXED VERSION
const EventEmitter = require("events");
const BinanceDataService = require("./binanceDataService");
const SignalGenerator = require("./signalGenerator");
const PaperTradingEngine = require("./paperTradingEngine");
const TradeRepository = require("../repositories/tradeRepository");
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
            enableTrading: false,
            assets: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"],
            timeframes: ["1h", "4h", "1d"],
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
        };

        logger.info("🎯 TradingService initialized with clean architecture");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Service...");

            // Initialize core services
            this.binanceData = new BinanceDataService(this.config);
            this.signalGenerator = new SignalGenerator(this.config);
            this.paperTrading = new PaperTradingEngine(this.config);

            // Start the data service initialization, which runs in the background
            this.binanceData.initialize();

            // Wait for services to be ready
            await this.waitForServices();
            await this.paperTrading.initialize();

            // Start services
            this.paperTrading.start();
            this.signalGenerator.start(this.binanceData, 60000);

            this.setupServiceEvents();
            this.isActive = true;

            logger.success("✅ Trading Service initialized successfully");
        } catch (error) {
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
        this.paperTrading.on("tradeExecuted", async (trade) => {
            try {
                await this.tradeRepo.save(trade);
                this.emit("tradeExecuted", trade);
                this.io.emit("tradeExecuted", trade);
            } catch (error) {
                logger.error("Error saving trade:", error);
            }
        });

        this.paperTrading.on("portfolioUpdated", (portfolio) => {
            this.emit("portfolioUpdated", portfolio);
            this.io.emit("portfolioUpdated", portfolio);
        });

        this.paperTrading.on("tradingHalted", (data) => {
            this.emit("tradingHalted", data);
            this.io.emit("tradingHalted", data);
        });

        // Price update events
        this.binanceData.on("priceUpdate", (priceData) => {
            const allPrices = this.binanceData.getAllPrices();
            this.paperTrading.updatePortfolioValue(allPrices);
            this.io.emit("priceUpdate", priceData);
        });
    }

    async handleSignal(signal) {
        try {
            // Save signal to database
            await this.signalRepo.save(signal);

            // Process signal if trading enabled
            if (this.config.enableTrading && this.paperTrading) {
                const priceData = this.binanceData.getCurrentPrice(
                    signal.symbol
                );
                if (priceData) {
                    const result = await this.paperTrading.processSignal(
                        signal,
                        priceData.price,
                        signal.atr
                    );

                    if (result.success) {
                        logger.info(
                            `🎯 Signal processed: ${signal.symbol} ${signal.signal}`
                        );
                    }
                }
            }
        } catch (error) {
            logger.error("Error handling signal:", error);
        }
    }

    // =================== API METHODS ===================

    async getStatus() {
        try {
            const binanceStatus = this.binanceData
                ? this.binanceData.getServiceStatus()
                : null;
            const paperStatus = this.paperTrading
                ? this.paperTrading.getStatus()
                : null;
            const signalStatus = this.signalGenerator
                ? this.signalGenerator.getStatus()
                : null;

            return {
                isInitialized: this.isActive,
                config: this.config,
                services: {
                    binanceData: binanceStatus,
                    paperTrading: paperStatus,
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

            if (symbol) {
                return await this.tradeRepo.getBySymbol(symbol, limit);
            } else {
                return await this.tradeRepo.getRecent(limit);
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
            if (!this.paperTrading) {
                throw new Error("Paper trading service not initialized");
            }
            // The paper trading engine is the source of truth for the portfolio
            return this.paperTrading.getPortfolioSummary();
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
            const paperPortfolio = this.paperTrading
                ? this.paperTrading.getPortfolioSummary()
                : null;

            // CRITICAL FIX: Enhanced response with error handling
            const response = {
                ...account,
                paperTrading: paperPortfolio
                    ? {
                          enabled: true,
                          totalValue: paperPortfolio.totalValue,
                          totalPnL: paperPortfolio.totalPnL,
                          positions: paperPortfolio.positions,
                      }
                    : { enabled: false },

                // Add system status context
                systemStatus: {
                    apiConnected: !account.error,
                    lastUpdate: new Date().toISOString(),
                    mode: account.error ? "FALLBACK" : "LIVE",
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
            // Merge with existing config
            this.config = { ...this.config, ...newConfig };

            // Update service configurations
            if (this.signalGenerator) {
                this.signalGenerator.updateConfig(this.config);
            }
            if (this.paperTrading) {
                this.paperTrading.updateConfig(this.config);
            }

            logger.info("⚙️ Trading service configuration updated");
            this.emit("configUpdated", this.config);
        } catch (error) {
            logger.error("Error updating config:", error);
            throw error;
        }
    }

    async startTrading() {
        try {
            this.config.enableTrading = true;

            if (this.paperTrading) {
                this.paperTrading.updateConfig({ enableTrading: true });
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

            if (this.paperTrading) {
                this.paperTrading.updateConfig({ enableTrading: false });
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
            // Reset paper trading engine
            if (this.paperTrading) {
                this.paperTrading.reset();
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
            if (this.paperTrading) {
                this.paperTrading.stop();
            }
            if (this.binanceData) {
                this.binanceData.cleanup();
            }

            this.isActive = false;
            logger.success("✅ Trading Service cleaned up successfully");
        } catch (error) {
            logger.error("Error during cleanup:", error);
        }
    }
}

module.exports = TradingService;
