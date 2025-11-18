// backend/src/controllers/tradingController.js
const logger = require("../utils/logger");
const { EventEmitter } = require("events");
const SignalGenerator = require("../services/signalGenerator");

class EnhancedTradingController extends EventEmitter {
    constructor(tradingService, io) {
        super();
        this.tradingService = tradingService;
        this.socketIO = io;
        this.eventHistory = [];
        this.isInitialized = false;

        logger.info("🚀 Trading Controller initialized.");
        this.setupControllerEvents();
    }

    async initialize() {
        this.isInitialized = true;
        logger.success("✅ Trading Controller ready.");
    }

    setupControllerEvents() {
        // Forwarding events from Service to Frontend
        this.tradingService.on("priceUpdate", (data) =>
            this.socketIO.emit("priceUpdate", data)
        );

        this.tradingService.on("signalGenerated", (signal) => {
            this.logEvent("SIGNAL", signal);
            this.socketIO.emit("signalGenerated", signal);
        });

        this.tradingService.on("tradeExecuted", (trade) => {
            this.logEvent("TRADE", trade);
            this.socketIO.emit("tradeExecuted", trade);
        });

        this.tradingService.on("portfolioUpdated", (portfolio) => {
            this.socketIO.emit("portfolioUpdated", portfolio);
        });

        this.tradingService.on("tradingHalted", (data) => {
            this.logEvent("HALT", data);
            this.socketIO.emit("tradingHalted", data);
        });
    }

    logEvent(type, data) {
        const event = { type, timestamp: Date.now(), data };
        this.eventHistory.unshift(event); // Add to start
        if (this.eventHistory.length > 500) this.eventHistory.pop();
        this.emit("eventLogged", event);
    }

    // --- API METHODS ---

    async getStatus() {
        return await this.tradingService.getStatus();
    }

    async getPortfolio() {
        return await this.tradingService.getPortfolio();
    }

    async getTrades(query = {}) {
        return await this.tradingService.getTrades(query);
    }

    async startTrading() {
        logger.info("▶️ Controller: Start Trading requested");
        await this.tradingService.startTrading();
        return { success: true, message: "Trading started" };
    }

    async stopTrading() {
        logger.info("⏹️ Controller: Stop Trading requested");
        await this.tradingService.stopTrading();
        return { success: true, message: "Trading stopped" };
    }

    async getAccount() {
        return await this.tradingService.getAccount();
    }

    async updateConfig(config) {
        await this.tradingService.updateConfig(config);
        return { success: true };
    }

    async resetTrading() {
        await this.tradingService.resetTrading();
        this.eventHistory = [];
        return { success: true };
    }

    // --- NEW: BACKTESTING ENDPOINT ---

    /**
     * Runs a simulation using the EXACT logic from SignalGenerator.
     * This proves if the strategy is profitable before going live.
     */
    async runBacktest(reqBody) {
        const {
            symbol = "BTCUSDT",
            days = 30,
            strategy = "balanced",
        } = reqBody;
        logger.info(
            `🧪 Starting Backtest: ${symbol} (${days} days, ${strategy})`
        );

        try {
            // 1. Fetch History directly from Binance Service
            // We access the service instance from tradingService
            const binanceData = this.tradingService.binanceData;
            if (!binanceData)
                throw new Error("Binance Data Service not available");

            // Fetch 1h candles for the requested duration
            // Note: binanceData.fetchHistoricalCandles needs to be available or we use a public method
            // Assuming standard method signature or adding fallback
            const limit = days * 24;
            const candles = await binanceData.getBacktestCandles(
                symbol,
                "1h",
                limit
            );

            if (!candles || candles.length < 200) {
                throw new Error("Insufficient historical data for backtest");
            }

            // 2. Initialize a temporary Signal Generator with the REQUESTED config
            // This isolates the test from the live running bot
            const tempSignalGen = new SignalGenerator({
                strategy: strategy,
                enableAdxFilter: true, // Force enable our new filters
                minAdx: 25,
                enableRsiFilter: true,
                assets: [symbol],
            });

            // 3. Simulate Iteration
            let balance = 1000; // Start with $1000 fake
            let position = 0;
            let tradeCount = 0;
            let wins = 0;
            const trades = [];

            // We need at least 200 candles to start generating valid signals
            for (let i = 200; i < candles.length; i++) {
                const slice = candles.slice(0, i + 1);
                const currentCandle = candles[i];
                const price = parseFloat(currentCandle.close);

                // Generate Signal
                const signalObj = await tempSignalGen.generateSignal(
                    symbol,
                    slice,
                    price
                );

                // Basic Execution Logic for Backtest
                if (signalObj.signal === "BUY" && position === 0) {
                    const quantity = (balance / price) * 0.99; // 99% allocation
                    position = quantity;
                    balance = 0;
                    trades.push({
                        type: "BUY",
                        price,
                        time: currentCandle.closeTime,
                        reason: signalObj.message,
                    });
                } else if (signalObj.signal === "SELL" && position > 0) {
                    const value = position * price;
                    const profit =
                        value - trades[trades.length - 1].price * position;
                    if (profit > 0) wins++;

                    balance = value;
                    position = 0;
                    tradeCount++;
                    trades.push({
                        type: "SELL",
                        price,
                        time: currentCandle.closeTime,
                        profit,
                        reason: signalObj.message,
                    });
                }
            }

            // Close final position
            if (position > 0) {
                const finalPrice = parseFloat(
                    candles[candles.length - 1].close
                );
                balance = position * finalPrice;
            }

            const result = {
                symbol,
                days,
                finalBalance: balance.toFixed(2),
                roi: (((balance - 1000) / 1000) * 100).toFixed(2) + "%",
                totalTrades: tradeCount,
                winRate:
                    tradeCount > 0
                        ? ((wins / tradeCount) * 100).toFixed(1) + "%"
                        : "0%",
                trades: trades, // detailed log
            };

            logger.success(`🧪 Backtest Complete. ROI: ${result.roi}`);
            return result;
        } catch (error) {
            logger.error("Backtest Failed:", error);
            throw error;
        }
    }
}

module.exports = EnhancedTradingController;
