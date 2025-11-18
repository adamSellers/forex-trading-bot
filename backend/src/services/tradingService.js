// backend/src/services/tradingService.js - FIXED VERSION
const EventEmitter = require("events");
const BinanceDataService = require("./binanceDataService");
const SignalGenerator = require("./signalGenerator");
const RiskManagementService = require("./riskManagementService");
const PaperTradingEngine = require("./paperTradingEngine");
const LiveTradingEngine = require("./LiveTradingEngine"); // FIX: Case-sensitive path
const TradeRepository = require("../repositories/tradeRepository");
const AnalyticsService = require("./analyticsService");
const SignalRepository = require("../repositories/signalRepository");
const logger = require("../utils/logger");

class TradingService extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.isActive = false;

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
            // --- NEW: Advanced Filter Config Defaults ---
            enableAdxFilter: true,
            minAdx: 25,
            enableRsiFilter: true,
            rsiOverbought: 70,
            rsiOversold: 30,
        };

        this.config.enableS3Analytics =
            process.env.ENABLE_S3_ANALYTICS === "true";
        this.config.enableS3SignalLogging =
            process.env.ENABLE_S3_SIGNAL_LOGGING === "true";

        this.activeEngine = null;
        logger.info("🎯 TradingService initialized with clean architecture");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Service...");
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

            this.riskService.initialize(this.config);
            this.binanceData.initialize();

            await this.waitForServices();
            await this.activeEngine.initialize();

            this.signalGenerator.start(this.binanceData, 60000);

            this.analyticsService = new AnalyticsService(this.activeEngine);
            this.analyticsService.startS3UploadScheduler();

            this.setupServiceEvents();
            this.isActive = true;
            this.activeEngine.start();

            logger.success("✅ Trading Service initialized successfully");
        } catch (error) {
            logger.error("❌ Trading Service initialization failed:", error);
            throw error;
        }
    }

    async waitForServices() {
        return new Promise((resolve, reject) => {
            let servicesReady = 0;
            const checkReady = () => {
                servicesReady++;
                if (servicesReady >= 1) resolve();
            };
            this.binanceData.once("serviceReady", checkReady);
            this.binanceData.once("serviceError", reject);
            setTimeout(
                () => reject(new Error("BinanceDataService timeout")),
                30000
            );
        });
    }

    setupServiceEvents() {
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

        this.activeEngine.on("tradeExecuted", async (trade) => {
            try {
                // Engine saves to DB, we just emit
                this.emit("tradeExecuted", trade);
                this.io.emit("tradeExecuted", trade);
            } catch (error) {
                logger.error("Error processing trade event:", error);
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

        this.binanceData.on("priceUpdate", (priceData) => {
            const allPrices = this.binanceData.getAllPrices();
            this.activeEngine.updatePortfolioValue(allPrices);
            this.io.emit("priceUpdate", priceData);
        });
    }

    async handleSignal(signal) {
        try {
            await this.signalRepo.save(signal);

            if (this.analyticsService) {
                const priceData = this.binanceData.getCurrentPrice(
                    signal.symbol
                );
                this.analyticsService.bufferSignalForS3(
                    signal,
                    priceData?.price
                );
            }

            if (this.config.enableTrading && this.activeEngine) {
                const priceData = this.binanceData.getCurrentPrice(
                    signal.symbol
                );
                if (priceData) {
                    const result = await this.activeEngine.processSignal(
                        signal,
                        priceData.price,
                        signal.atr // passed from SignalGenerator
                    );

                    if (result.success) {
                        logger.info(
                            `🎯 Action: ${result.action || "NONE"} (${
                                result.reason
                            })`
                        );
                    }
                }
            }
        } catch (error) {
            logger.error("Error handling signal:", error);
        }
    }

    // =================== API METHODS ===================

    getStatus() {
        return {
            isInitialized: this.isActive,
            config: this.config,
            services: {
                binanceData: this.binanceData?.getServiceStatus(),
                engine: this.activeEngine?.getStatus(),
                signalGenerator: this.signalGenerator?.getStatus(),
            },
            timestamp: Date.now(),
        };
    }

    async getSignals(query = {}) {
        const limit = parseInt(query.limit) || 50;
        return query.symbol
            ? await this.signalRepo.getBySymbol(query.symbol, limit)
            : await this.signalRepo.getRecent(limit);
    }

    async getTrades(query = {}) {
        const limit = parseInt(query.limit) || 20;
        const mode = this.config.tradingMode;
        return query.symbol
            ? await this.tradeRepo.getBySymbol(query.symbol, limit, mode)
            : await this.tradeRepo.getRecent(limit, mode);
    }

    async getPrices() {
        if (!this.binanceData) throw new Error("Binance data unavailable");
        return this.binanceData.getAllPrices();
    }

    async getPortfolio() {
        if (!this.activeEngine) throw new Error("Engine not initialized");
        return this.activeEngine.getPortfolioSummary();
    }

    async getAccount() {
        if (!this.binanceData) throw new Error("Binance data unavailable");
        const account = await this.binanceData.getAccountInfo();
        const paperPortfolio = this.activeEngine
            ? await this.activeEngine.getPortfolioSummary()
            : null;

        return {
            ...account,
            paperTrading:
                this.config.tradingMode === "paper" && paperPortfolio
                    ? {
                          enabled: true,
                          totalValue: paperPortfolio.totalValue,
                          positions: paperPortfolio.positions,
                      }
                    : { enabled: false },
            systemStatus: {
                apiConnected: !account.error,
                mode: this.config.tradingMode,
            },
        };
    }

    async updateConfig(newConfig) {
        if (newConfig.logLevel && newConfig.logLevel !== this.config.logLevel) {
            logger.setLogLevel(newConfig.logLevel);
        }

        this.config = { ...this.config, ...newConfig };

        if (this.signalGenerator)
            this.signalGenerator.updateConfig(this.config);
        if (this.riskService) this.riskService.updateConfig(this.config);
        if (this.analyticsService)
            this.analyticsService.updateConfig(this.config);

        if (
            this.activeEngine &&
            this.activeEngine.mode !== newConfig.tradingMode
        ) {
            logger.warn(
                `Trading mode changed to ${newConfig.tradingMode}. Re-initializing.`
            );
            await this.activeEngine.stop();
            this.activeEngine = this.createTradingEngine(newConfig.tradingMode);
            await this.activeEngine.initialize();
            this.activeEngine.start();
        } else if (this.activeEngine) {
            this.activeEngine.updateConfig(this.config);
        }

        logger.info("⚙️ Config updated");
        this.emit("configUpdated", this.config);
        this.io.emit("systemStatus", this.getStatus());
    }

    createTradingEngine(mode) {
        if (mode === "live")
            return new LiveTradingEngine(
                this.config,
                this.binanceData,
                this.riskService
            );
        return new PaperTradingEngine(this.config, this.riskService);
    }

    async startTrading() {
        this.config.enableTrading = true;
        if (this.activeEngine) await this.activeEngine.start();
        this.emit("tradingStarted");
        this.io.emit("tradingStarted");
    }

    async stopTrading() {
        this.config.enableTrading = false;
        if (this.activeEngine) await this.activeEngine.stop();
        this.emit("tradingStopped");
        this.io.emit("tradingStopped");
    }

    async resetTrading() {
        if (this.activeEngine) await this.activeEngine.reset();
        if (this.signalGenerator) this.signalGenerator.reset();
        this.emit("tradingReset");
        this.io.emit("tradingReset");
    }
}

module.exports = TradingService;
