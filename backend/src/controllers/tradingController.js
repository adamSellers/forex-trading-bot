// =====================================================
// 1. backend/src/controllers/tradingController.js
// CLEAN 200-LINE CONTROLLER (was 1300+ lines)
// =====================================================

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
        this.services = {
            trading: new TradingService(io),
            portfolio: new PortfolioService(),
            risk: new RiskManagementService(),
            analytics: new AnalyticsService(),
        };

        this.setupEventListeners();
        logger.info("🎯 TradingController initialized with clean architecture");
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Controller...");

            // Initialize all services
            await Promise.all([
                this.services.trading.initialize(),
                this.services.portfolio.initialize(),
                this.services.risk.initialize(),
            ]);

            this.isInitialized = true;
            this.emit("controllerReady");

            logger.success("✅ Trading Controller initialized successfully");
        } catch (error) {
            logger.error("❌ Trading Controller initialization failed:", error);
            throw error;
        }
    }

    setupEventListeners() {
        // Trading service events
        this.services.trading.on("signalGenerated", (signal) => {
            this.emit("signalGenerated", signal);
            this.io.emit("signalGenerated", signal);
        });

        this.services.trading.on("tradeExecuted", (trade) => {
            this.emit("tradeExecuted", trade);
            this.io.emit("tradeExecuted", trade);
        });

        // Portfolio service events
        this.services.portfolio.on("portfolioUpdated", (portfolio) => {
            this.io.emit("portfolioUpdated", portfolio);
        });

        // Risk management events
        this.services.risk.on("tradingHalted", (data) => {
            this.io.emit("tradingHalted", data);
            logger.warn("🚨 Trading halted:", data.reason);
        });
    }

    // =================== API ENDPOINTS ===================

    // GET /api/trading/status
    async getStatus() {
        try {
            return await this.services.trading.getStatus();
        } catch (error) {
            logger.error("Error getting status:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Status service unavailable"
            );
        }
    }

    // GET /api/trading/portfolio
    async getPortfolio() {
        try {
            return await this.services.portfolio.getPortfolio();
        } catch (error) {
            logger.error("Error getting portfolio:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Portfolio service unavailable"
            );
        }
    }

    // GET /api/trading/signals
    async getSignals(query = {}) {
        try {
            return await this.services.trading.getSignals(query);
        } catch (error) {
            logger.error("Error getting signals:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Signals service unavailable"
            );
        }
    }

    // GET /api/trading/trades
    async getTrades(query = {}) {
        try {
            return await this.services.trading.getTrades(query);
        } catch (error) {
            logger.error("Error getting trades:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Trades service unavailable"
            );
        }
    }

    // GET /api/trading/prices
    async getPrices() {
        try {
            return await this.services.trading.getPrices();
        } catch (error) {
            logger.error("Error getting prices:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Price service unavailable"
            );
        }
    }

    // GET /api/trading/account
    async getAccount() {
        try {
            return await this.services.trading.getAccount();
        } catch (error) {
            logger.error("Error getting account:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Account service unavailable"
            );
        }
    }

    // GET /api/trading/holdings
    async getCombinedHoldings() {
        try {
            const account = await this.services.trading.getAccount();
            const portfolio = await this.services.portfolio.getPortfolio();
            return await this.services.portfolio.getCombinedHoldings(
                account,
                portfolio
            );
        } catch (error) {
            logger.error("Error getting combined holdings:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Holdings service unavailable"
            );
        }
    }

    // GET /api/trading/analytics
    async getAnalytics(query = {}) {
        try {
            return await this.services.analytics.getPerformanceAnalytics(
                query.period
            );
        } catch (error) {
            logger.error("Error getting analytics:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Analytics service unavailable"
            );
        }
    }

    // GET /api/trading/risk-status
    async getRiskStatus() {
        try {
            return this.services.risk.getRiskStatus();
        } catch (error) {
            logger.error("Error getting risk status:", error);
            throw ErrorHandler.serviceUnavailableError(
                "Risk service unavailable"
            );
        }
    }

    // POST /api/trading/config
    async updateConfig(config) {
        try {
            await this.services.trading.updateConfig(config);
            logger.info("⚙️ Configuration updated successfully");
        } catch (error) {
            logger.error("Error updating config:", error);
            throw ErrorHandler.validationError("Invalid configuration");
        }
    }

    // POST /api/trading/start
    async startTrading() {
        try {
            await this.services.trading.startTrading();
            logger.info("▶️ Trading started successfully");
        } catch (error) {
            logger.error("Error starting trading:", error);
            throw ErrorHandler.serviceUnavailableError("Cannot start trading");
        }
    }

    // POST /api/trading/stop
    async stopTrading() {
        try {
            await this.services.trading.stopTrading();
            logger.info("⏹️ Trading stopped successfully");
        } catch (error) {
            logger.error("Error stopping trading:", error);
            throw ErrorHandler.serviceUnavailableError("Cannot stop trading");
        }
    }

    // POST /api/trading/reset
    async resetTrading() {
        try {
            await this.services.trading.resetTrading();
            logger.info("🔄 Trading reset successfully");
        } catch (error) {
            logger.error("Error resetting trading:", error);
            throw ErrorHandler.serviceUnavailableError("Cannot reset trading");
        }
    }

    async cleanup() {
        logger.info("🧹 Cleaning up Trading Controller...");

        try {
            await Promise.all([
                this.services.trading.cleanup(),
                this.services.portfolio.cleanup(),
                this.services.risk.cleanup(),
            ]);

            this.isInitialized = false;
            logger.success("✅ Trading Controller cleaned up successfully");
        } catch (error) {
            logger.error("Error during cleanup:", error);
        }
    }
}

module.exports = TradingController;
