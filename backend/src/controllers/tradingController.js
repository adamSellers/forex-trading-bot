// backend/src/controllers/tradingController.js - COMPLETE ENHANCED VERSION
const BinanceDataService = require("../services/binanceDataService");
const SignalGenerator = require("../services/signalGenerator");
const PaperTradingEngine = require("../services/paperTradingEngine");
const logger = require("../utils/logger");
const { EventEmitter } = require("events");

class EnhancedTradingController extends EventEmitter {
    // FIXED: The controller should DEPEND on the service, not recreate it.
    constructor(tradingService, io) {
        super();

        // The controller's job is to bridge the service to the outside world (API/Sockets)
        this.tradingService = tradingService;
        this.socketIO = io;

        // CRITICAL FIX: Remove service instances. The controller should not manage them.
        // this.binanceData = null;
        // this.signalGenerator = null;
        // this.paperTrading = null;

        // State management - The controller only needs to know if it's initialized.
        // The service manages the running state.
        this.isInitialized = false;

        // Event history can remain in the controller as it's for API/UI purposes.
        this.eventHistory = [];

        logger.info(
            "🚀 Trading Controller initialized. It will use the main TradingService."
        );
        this.setupControllerEvents();
    }

    /**
     * Initialize the controller. The service is initialized separately.
     */
    async initialize() {
        try {
            logger.info("🔧 Initializing Trading Controller...");
            // Initialization is now handled by the TradingService.
            // The controller is ready once it's instantiated with a service.
            this.isInitialized = true;
            logger.success(
                "✅ Trading Controller is initialized and listening to TradingService."
            );
        } catch (error) {
            logger.error("❌ Failed to initialize Trading Controller:", error);
            this.emit("initializationError", error);
            throw error;
        }
    }

    /**
     * FIXED: This method now listens to the central TradingService for events
     * and forwards them to the frontend via Socket.IO.
     */
    setupControllerEvents() {
        logger.info(
            "🔗 Setting up controller event listeners to bridge service to clients..."
        );

        // The service handles the logic, the controller just passes it on.
        this.tradingService.on("priceUpdate", (priceData) => {
            this.socketIO.emit("priceUpdate", priceData);
        });

        // THIS IS THE FIX: Listen for the signal from the service, which has already saved it.
        this.tradingService.on("signalGenerated", (signal) => {
            logger.info(
                `📡 Controller received signal for ${signal.symbol} to forward to client.`
            );
            this.logEvent("SIGNAL_FORWARDED", signal);
            this.socketIO.emit("signalGenerated", signal);
        });

        this.tradingService.on("allSignalsGenerated", (signals) => {
            this.socketIO.emit("allSignalsGenerated", signals);
        });

        this.tradingService.on("tradeExecuted", (trade) => {
            logger.info(
                `💼 Controller received executed trade for ${trade.symbol} to forward.`
            );
            this.logEvent("TRADE_EXECUTED", trade);
            this.socketIO.emit("tradeExecuted", trade);
        });

        this.tradingService.on("portfolioUpdated", (portfolio) => {
            this.socketIO.emit("portfolioUpdated", portfolio);
            // this.checkForSignificantEvents(portfolio); // This can be re-implemented if needed
        });

        this.tradingService.on("tradingHalted", (data) => {
            logger.warn(`⚠️ Controller received trading halt: ${data.type}`);
            this.logEvent("RISK_LIMIT_HIT", data);
            this.socketIO.emit("tradingHalted", data);
        });

        logger.success(
            "✅ Controller event listeners configured to use TradingService."
        );
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
     * Start trading by calling the service.
     */
    async start() {
        try {
            logger.info("▶️ Controller received request to start trading...");
            await this.tradingService.startTrading();
            this.logEvent("TRADING_STARTED", { timestamp: Date.now() });
            logger.success("✅ Trading enabled via controller.");
            return { success: true, message: "Trading started" };
        } catch (error) {
            logger.error("❌ Controller error starting trading:", error);
            this.emit("systemError", error);
            throw error;
        }
    }

    /**
     * Stop trading by calling the service.
     */
    async stop() {
        try {
            logger.info("⏹️ Controller received request to stop trading...");
            await this.tradingService.stopTrading();
            this.logEvent("SYSTEM_STOPPED", { timestamp: Date.now() });
            logger.success("✅ Trading disabled via controller.");
            return { success: true, message: "Trading stopped" };
        } catch (error) {
            logger.error("❌ Controller error stopping trading:", error);
            this.emit("systemError", error);
            throw error;
        }
    }

    // ============= API METHODS FOR ROUTES =============

    /**
     * Get system status by calling the service.
     */
    async getStatus() {
        try {
            // Delegate directly to the service
            return await this.tradingService.getStatus();
        } catch (error) {
            logger.error("Error getting status:", error);
            throw error;
        }
    }

    /**
     * Get portfolio by calling the service.
     */
    async getPortfolio() {
        try {
            const portfolio = await this.tradingService.getPortfolio();

            return {
                ...portfolio,
                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting portfolio:", error);
            throw error;
        }
    }

    /**
     * Get trades by calling the service.
     */
    async getTrades(query = {}) {
        try {
            const trades = await this.tradingService.getTrades(query);
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
     * Get trading signals by calling the service.
     */
    async getSignals(query = {}) {
        try {
            const signals = await this.tradingService.getSignals(query);

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
     * Get current prices by calling the service.
     */
    async getPrices() {
        try {
            const prices = await this.tradingService.getPrices();
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
     * Get account info by calling the service.
     */
    async getAccount() {
        try {
            // Delegate directly to the service
            return await this.tradingService.getAccount();
        } catch (error) {
            logger.error("Error getting account:", error);
            throw error;
        }
    }

    /**
     * Get combined holdings (Example of controller-level composition)
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
            const sellTrades = trades.filter((t) => t.side === "SELL");
            if (sellTrades.length === 0) {
                return { summary: { total: 0 } };
            }
            const profitable = sellTrades.filter((t) => (t.pnl || 0) > 0);
            const winRate = (profitable.length / sellTrades.length) * 100;

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
            const totalPnL = sellTrades.reduce(
                (sum, t) => sum + (t.pnl || 0),
                0
            );
            const avgPnL = totalPnL / sellTrades.length;

            return {
                summary: {
                    total: sellTrades.length,
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
     * Update configuration by calling the service.
     */
    async updateConfig(newConfig) {
        return await this.tradingService.updateConfig(newConfig);
    }

    /**
     * Reset trading engine
     */
    async resetTrading() {
        try {
            await this.tradingService.resetTrading();
            this.logEvent("SYSTEM_RESET", { timestamp: Date.now() });
            logger.info("✅ Trading system reset successfully");
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
            logger.info("🧹 Cleaning up Trading Controller...");
            // The service handles its own cleanup. The controller just cleans itself up.
            this.removeAllListeners();
            this.eventHistory = [];
            logger.success("✅ Trading Controller cleanup completed");
        } catch (error) {
            logger.error("❌ Error during cleanup:", error);
            throw error;
        }
    }
}

module.exports = EnhancedTradingController;
