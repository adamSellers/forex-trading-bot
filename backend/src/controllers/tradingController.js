// backend/src/controllers/tradingController.js
const logger = require("../utils/logger");
const { EventEmitter } = require("events");
const SignalGenerator = require("../services/signalGenerator");
const { db } = require("../config/database"); // <--- FIX: Direct DB Import

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

    async getSignals(query = {}) {
        return await this.tradingService.getSignals(query);
    }

    async getPrices() {
        return await this.tradingService.getPrices();
    }

    async getAccount() {
        return await this.tradingService.getAccount();
    }

    // Helper for the "Combined View" widget
    async getCombinedHoldings() {
        const account = await this.getAccount();
        // Paper portfolio is already nested in getAccount response,
        // but we can structure it specifically if the UI expects a certain format
        return {
            real: { balances: account.balances, totalValue: 0 }, // specific value calculated by UI or Service
            paper: account.paperTrading,
            timestamp: Date.now(),
        };
    }

    // --- CONTROL METHODS ---

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

    async updateConfig(config) {
        await this.tradingService.updateConfig(config);
        return { success: true };
    }

    async resetTrading() {
        await this.tradingService.resetTrading();
        this.eventHistory = [];
        return { success: true };
    }

    // --- BACKTESTING ENDPOINT ---

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
            const binanceData = this.tradingService.binanceData;
            if (!binanceData)
                throw new Error("Binance Data Service not available");

            const limit = days * 24;
            const candles =
                (await binanceData.getCandles(symbol, "1h", limit)) || [];

            if (!candles || candles.length < 200) {
                throw new Error("Insufficient historical data for backtest");
            }

            const tempSignalGen = new SignalGenerator({
                strategy: strategy,
                enableAdxFilter: true,
                minAdx: 25,
                enableRsiFilter: true,
                assets: [symbol],
            });

            let balance = 1000;
            let position = 0;
            let tradeCount = 0;
            let wins = 0;
            const trades = [];

            for (let i = 200; i < candles.length; i++) {
                const slice = candles.slice(0, i + 1);
                const currentCandle = candles[i];
                const price = parseFloat(currentCandle.close);

                const signalObj = await tempSignalGen.generateSignal(
                    symbol,
                    slice,
                    price
                );

                if (signalObj.signal === "BUY" && position === 0) {
                    const quantity = (balance / price) * 0.99;
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
                trades: trades,
            };

            logger.success(`🧪 Backtest Complete. ROI: ${result.roi}`);
            return result;
        } catch (error) {
            logger.error("Backtest Failed:", error);
            throw error;
        }
    }

    // --- FACTORY RESET ---

    async factoryReset() {
        logger.warn("☢️ FACTORY RESET INITIATED FROM UI");

        try {
            // 1. Stop Trading to release locks
            await this.tradingService.stopTrading();

            // 2. Clear Engine Memory
            await this.tradingService.resetTrading();

            // 3. Wipe Database Tables using imported DB instance
            await db.transaction(async (trx) => {
                // Delete data from all system tables
                await trx("trades").del();
                await trx("signals").del();
                await trx("portfolio").del();
                await trx("performance").del();
                await trx("live_portfolio_snapshots").del();

                // Reset SQLite autoincrement sequences (if using SQLite)
                // We wrap this in a try-catch in case you switch to Postgres/MySQL later
                try {
                    const tables = [
                        "trades",
                        "signals",
                        "portfolio",
                        "performance",
                        "live_portfolio_snapshots",
                    ];
                    for (const table of tables) {
                        await trx.raw(
                            "DELETE FROM sqlite_sequence WHERE name=?",
                            [table]
                        );
                    }
                } catch (e) {
                    // Ignore sequence reset errors (likely different DB dialect)
                    logger.warn("Skipped sequence reset (non-SQLite DB?)");
                }
            });

            this.eventHistory = []; // Clear log buffer
            logger.success(
                "✅ Factory Reset Complete: Database & Memory Wiped."
            );

            return {
                success: true,
                message: "System fully reset to factory state.",
            };
        } catch (error) {
            logger.error("❌ Factory Reset Failed:", error);
            throw error;
        }
    }
}

module.exports = EnhancedTradingController;
