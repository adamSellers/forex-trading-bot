// backend/src/services/tradingService.js - LIVE ONLY EDITION
const EventEmitter = require("events");
const fs = require("fs").promises;
const path = require("path");
const BinanceDataService = require("./binanceDataService");
const SignalGenerator = require("./signalGenerator");
const RiskManagementService = require("./riskManagementService");
const LiveTradingEngine = require("./LiveTradingEngine"); // Only one engine remains
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

        // 🏆 PRODUCTION CONFIG (Live Only)
        this.defaultConfig = {
            strategy: "supertrend_momentum",
            tradingMode: "live",
            timeframe: "15m", // Keep for Strategy logic
            timeframes: ["15m", "1h", "4h"], // <--- ADD THIS for Data Service
            enableTrading: false, // Master Kill Switch

            // Asset Mix (Default to the Winners)
            assets: ["ETHUSDT", "XRPUSDT", "BNBUSDT", "NEARUSDT"],
            allocation: {
                ETHUSDT: 0.3,
                XRPUSDT: 0.3,
                NEARUSDT: 0.2,
                BNBUSDT: 0.2,
            },

            // --- RISK ---
            maxCapitalAtRisk: 1000,
            riskPerTrade: 0.98, // 98% (Aggressive compounding)
            minOrderSize: 10,

            // --- STRATEGY SETTINGS ---
            atrPeriod: 10,
            factor: 3.0,
            enableAdxFilter: true,
            minAdx: 25,
            enableRsiFilter: true,
            rsiOverbought: 75,
            rsiOversold: 30,

            // --- EXITS ---
            stopLossType: "FIXED",
            stopLossPercent: 0.02, // 2% Hard Stop
            enableTrailingStops: false,

            // --- NOTIFICATIONS ---
            enableEmailAlerts: false,
            alertEmail: "",
            enableS3Analytics: process.env.ENABLE_S3_ANALYTICS === "true",
            enableS3SignalLogging:
                process.env.ENABLE_S3_SIGNAL_LOGGING === "true",
        };

        this.config = { ...this.defaultConfig };
        this.activeEngine = null;
        logger.info("🎯 TradingService initialized (LIVE MODE ONLY).");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Live Trading Service...");

            await this.loadConfig();
            this.config.logLevel = logger.getLogLevelName();

            this.binanceData = new BinanceDataService(this.config);
            this.riskService = new RiskManagementService();
            this.signalGenerator = new SignalGenerator(this.config);

            // DIRECT INSTANTIATION - No switching logic
            this.activeEngine = new LiveTradingEngine(
                this.config,
                this.binanceData,
                this.riskService
            );

            this.riskService.initialize(this.config);
            this.binanceData.initialize();

            await this.waitForServices();
            await this.activeEngine.initialize();

            // 1 Minute Signal Loop
            this.signalGenerator.start(this.binanceData, 60000);

            this.analyticsService = new AnalyticsService(this.activeEngine);
            this.analyticsService.startS3UploadScheduler();

            this.setupServiceEvents();
            this.isActive = true;

            if (this.config.enableTrading) {
                logger.warn(
                    `▶️ Auto-starting LIVE TRADING based on saved config.`
                );
                this.activeEngine.start();
            } else {
                logger.info("⏸️ Trading engine ready but paused.");
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

    async manualCloseTrade(tradeId) {
        if (!this.activeEngine) {
            throw new Error("Trading Engine is not active.");
        }
        return await this.activeEngine.forceClosePosition(tradeId);
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
                this.emit("signalGenerated", signal); // emit to backend
                this.io.emit("signalGenerated", signal); // emit to frontend
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
        return query.symbol
            ? await this.tradeRepo.getBySymbol(query.symbol, limit, "live")
            : await this.tradeRepo.getRecent(limit, "live");
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

        return {
            ...account,
            systemStatus: {
                apiConnected: !account.error,
                mode: "live",
            },
        };
    }

    async updateConfig(newConfig) {
        if (newConfig.logLevel && newConfig.logLevel !== this.config.logLevel) {
            logger.setLogLevel(newConfig.logLevel);
        }

        // Asset Swapping Logic
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
            this.signalGenerator.stop();
            this.signalGenerator.start(this.binanceData, 60000);
        }

        // Direct update to live engine
        if (this.activeEngine) {
            this.activeEngine.updateConfig(this.config);
        }

        await this.saveConfig();
        logger.info("⚙️ Config updated & saved");
        this.emit("configUpdated", this.config);
        this.io.emit("systemStatus", this.getStatus());
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
        // Reset logic handled internally by engine if needed,
        // usually 'reset' implies clearing memory state in live engine
        // We will assume LiveTradingEngine has no 'reset' method that clears DB,
        // so we just emit the event.
        this.emit("tradingReset");
        this.io.emit("tradingReset");
    }
}

module.exports = TradingService;
