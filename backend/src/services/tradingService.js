// backend/src/services/tradingService.js - UPDATED FOR MOMENTUM STRATEGY
const EventEmitter = require("events");
const fs = require("fs").promises;
const path = require("path");
const BinanceDataService = require("./binanceDataService");
const SignalGenerator = require("./signalGenerator");
const RiskManagementService = require("./riskManagementService");
const PaperTradingEngine = require("./paperTradingEngine");
const LiveTradingEngine = require("./LiveTradingEngine");
const TradeRepository = require("../repositories/tradeRepository");
const AnalyticsService = require("./analyticsService");
const SignalRepository = require("../repositories/signalRepository");
const emailService = require("./emailService");
const logger = require("../utils/logger");

const CONFIG_FILE = path.join(__dirname, "../../data/trading_config.json");

class TradingService extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.isActive = false;

        this.tradeRepo = new TradeRepository();
        this.signalRepo = new SignalRepository();

        // 1. GOLDEN CONFIG (SuperTrend Momentum 1H)
        this.defaultConfig = {
            strategy: "supertrend_momentum",
            timeframe: "1h",
            tradingMode: "paper", // Default to paper for safety
            enableTrading: false,

            // 🏆 THE WINNING WHITELIST (Strict Enforcement)
            assets: [
                "NEARUSDT",
                "FETUSDT",
                "WIFUSDT",
                "SHIBUSDT",
                "ETHUSDT",
                "PEPEUSDT",
            ],
            timeframes: ["1h"], // Only 1h needed

            // --- RISK & ALLOCATION ---
            maxCapitalAtRisk: 1000,
            riskPerTrade: 0.98, // 98% Compound Mode (Aggressive)
            minOrderSize: 10,

            // Allocation: Set to 100% per asset since we only take one trade at a time per asset
            allocation: {
                NEARUSDT: 1.0,
                FETUSDT: 1.0,
                WIFUSDT: 1.0,
                SHIBUSDT: 1.0,
                ETHUSDT: 1.0,
                PEPEUSDT: 1.0,
            },

            // --- STRATEGY SETTINGS (Verified Backtest 4.4) ---
            // SuperTrend
            atrPeriod: 10,
            factor: 3.0,

            // Filters
            enableAdxFilter: true,
            minAdx: 28, // Strict trend floor

            enableRsiFilter: true,
            rsiOverbought: 75, // Cap tops
            rsiOversold: 30,

            // Exits
            stopLossType: "FIXED", // New Flag
            stopLossPercent: 0.03, // 3% Hard Stop

            takeProfitATRMultiplier: 0, // 0 = Disable TP, let trend run
            enableTrailingStops: false, // Backtest used simple trend flip exit
            trailingStopPercent: 0.03,

            // Notification Defaults
            enableEmailAlerts: false,
            alertEmail: "",

            // S3
            enableS3Analytics: process.env.ENABLE_S3_ANALYTICS === "true",
            enableS3SignalLogging:
                process.env.ENABLE_S3_SIGNAL_LOGGING === "true",
        };

        this.config = { ...this.defaultConfig };
        this.activeEngine = null;
        logger.info("🎯 TradingService initialized (Momentum 1H Config).");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Service...");

            await this.loadConfig();
            this.config.logLevel = logger.getLogLevelName();

            this.binanceData = new BinanceDataService(this.config);
            this.riskService = new RiskManagementService();
            this.signalGenerator = new SignalGenerator(this.config);

            this.activeEngine = this.createTradingEngine(
                this.config.tradingMode
            );

            this.riskService.initialize(this.config);
            this.binanceData.initialize();

            await this.waitForServices();
            await this.activeEngine.initialize();

            // 1 Minute Loop
            this.signalGenerator.start(this.binanceData, 60000);

            this.analyticsService = new AnalyticsService(this.activeEngine);
            this.analyticsService.startS3UploadScheduler();

            this.setupServiceEvents();
            this.isActive = true;

            if (this.config.enableTrading) {
                logger.warn(
                    `▶️ Auto-starting trading in ${this.config.tradingMode} mode.`
                );
                this.activeEngine.start();
            } else {
                logger.info("⏸️ Trading engine paused.");
            }

            logger.success("✅ Trading Service initialized successfully");
        } catch (error) {
            logger.error("❌ Trading Service initialization failed:", error);
            throw error;
        }
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(CONFIG_FILE, "utf8");
            const savedConfig = JSON.parse(data);
            this.config = { ...this.defaultConfig, ...savedConfig };
            logger.success("💾 Loaded persistent configuration.");
        } catch (error) {
            if (error.code === "ENOENT") {
                logger.info("📄 No config file found. Using defaults.");
            } else {
                logger.error("⚠️ Failed to load config file:", error);
            }
        }
    }

    async saveConfig() {
        try {
            await fs.writeFile(
                CONFIG_FILE,
                JSON.stringify(this.config, null, 2)
            );
            logger.debug("💾 Configuration saved to disk.");
        } catch (error) {
            logger.error("❌ Failed to save configuration persistence:", error);
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
                this.emit("tradeExecuted", trade);
                this.io.emit("tradeExecuted", trade);
                if (this.config.enableEmailAlerts) {
                    emailService.sendTradeAlert(trade, this.config.alertEmail);
                }
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
                        signal.atr
                    );
                    if (result.success) {
                        logger.info(
                            `🎯 Action: ${result.action} (${result.reason})`
                        );
                    }
                }
            }
        } catch (error) {
            logger.error("Error handling signal:", error);
        }
    }

    // --- API METHODS ---

    getStatus() {
        const bdStatus = this.binanceData?.getServiceStatus() || {};
        const engineStatus = this.activeEngine?.getStatus() || {};
        const signalStatus = this.signalGenerator?.getStatus() || {};

        return {
            isInitialized: this.isActive,
            config: this.config,
            services: {
                binanceData: bdStatus,
                engine: engineStatus,
                signalGenerator: signalStatus,
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

        const oldAssets = JSON.stringify((this.config.assets || []).sort());
        const newAssetsList = newConfig.assets || this.config.assets;
        const assetsChanged =
            oldAssets !== JSON.stringify(newAssetsList.sort());

        this.config = { ...this.config, ...newConfig };

        if (this.signalGenerator)
            this.signalGenerator.updateConfig(this.config);
        if (this.riskService) this.riskService.updateConfig(this.config);
        if (this.analyticsService)
            this.analyticsService.updateConfig(this.config);

        if (assetsChanged && this.binanceData) {
            logger.warn("🔄 Asset list changed. Restarting Data Service...");
            this.binanceData.removeAllListeners();
            this.binanceData = new BinanceDataService(this.config);
            this.binanceData.initialize();

            this.binanceData.on("priceUpdate", (priceData) => {
                const allPrices = this.binanceData.getAllPrices();
                this.activeEngine.updatePortfolioValue(allPrices);
                this.io.emit("priceUpdate", priceData);
            });
            this.signalGenerator.start(this.binanceData, 60000);
        }

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
            if (this.config.enableTrading) {
                this.activeEngine.start();
            }
        } else if (this.activeEngine) {
            this.activeEngine.updateConfig(this.config);
        }

        await this.saveConfig();
        logger.info("⚙️ Config updated & saved");
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
        await this.saveConfig();
        if (this.activeEngine) await this.activeEngine.start();
        this.emit("tradingStarted");
        this.io.emit("tradingStarted");
    }

    async stopTrading() {
        this.config.enableTrading = false;
        await this.saveConfig();
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
