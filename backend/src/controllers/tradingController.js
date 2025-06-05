const EventEmitter = require("events");
const TradingService = require("../services/tradingService");
const PortfolioService = require("../services/portfolioService");
const RiskManagementService = require("../services/riskManagementService");
const AnalyticsService = require("../services/analyticsService");
const ErrorHandler = require("../middleware/errorHandler");
const logger = require("../utils/logger");

class TradingController extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.isInitialized = false;

        // Initialize services
        this.tradingService = new TradingService(io);
        this.portfolioService = new PortfolioService();
        this.riskService = new RiskManagementService();
        this.analyticsService = new AnalyticsService();

        this.setupEventListeners();
        logger.info("TradingController initialized");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Controller...");

            await this.tradingService.initialize();
            await this.portfolioService.initialize();
            await this.riskService.initialize();

            this.isInitialized = true;
            this.emit("controllerReady");

            logger.info("✅ Trading Controller initialized successfully");
        } catch (error) {
            logger.error("❌ Trading Controller initialization failed:", error);
            throw error;
        }
    }

    setupEventListeners() {
        // Trading service events
        this.tradingService.on("signalGenerated", (signal) => {
            this.emit("signalGenerated", signal);
            this.io.emit("signalGenerated", signal);
        });

        this.tradingService.on("tradeExecuted", (trade) => {
            this.emit("tradeExecuted", trade);
            this.io.emit("tradeExecuted", trade);
        });

        // Portfolio service events
        this.portfolioService.on("portfolioUpdated", (portfolio) => {
            this.io.emit("portfolioUpdated", portfolio);
        });

        // Risk management events
        this.riskService.on("tradingHalted", (data) => {
            this.io.emit("tradingHalted", data);
            logger.warn("🚨 Trading halted:", data.reason);
        });
    }

    // Delegate to services
    async getStatus() {
        return this.tradingService.getStatus();
    }

    async getPortfolio() {
        return this.portfolioService.getPortfolio();
    }

    async startTrading() {
        return this.tradingService.startTrading();
    }

    async stopTrading() {
        return this.tradingService.stopTrading();
    }

    async cleanup() {
        logger.info("🧹 Cleaning up Trading Controller...");

        await this.tradingService.cleanup();
        await this.portfolioService.cleanup();
        await this.riskService.cleanup();

        this.isInitialized = false;
        logger.info("✅ Trading Controller cleaned up");
    }
}

module.exports = TradingController;
