// backend/src/services/backtestingEngine.js
const fs = require("fs");
const path = require("path");
const SignalGenerator = require("./signalGenerator");
const PaperTradingEngine = require("./paperTradingEngine");
const logger = require("../utils/logger");

class BacktestingEngine {
    constructor(config) {
        this.config = {
            ...config,
            // Backtesting specific config
            dataFile: config.dataFile, // e.g., 'BTCUSDT-1h-12m.json'
            strategy: config.strategy || "balanced",
            timeframe: config.timeframe || "1h",
            // Ensure trading is "enabled" for the backtest logic
            enableTrading: true,
        };

        // Instantiate the same components used in live trading
        this.signalGenerator = new SignalGenerator(this.config);
        this.paperTrading = new PaperTradingEngine(this.config);

        this.historicalData = [];
        logger.info("🚀 Backtesting Engine Initialized.");
    }

    loadHistoricalData() {
        const dataPath = path.join(
            __dirname,
            "../../data/historical",
            this.config.dataFile
        );
        logger.info(`Loading historical data from: ${dataPath}`);
        if (!fs.existsSync(dataPath)) {
            throw new Error(`Data file not found: ${dataPath}`);
        }
        const rawData = fs.readFileSync(dataPath, "utf8");
        this.historicalData = JSON.parse(rawData);
        logger.success(
            `✅ Loaded ${this.historicalData.length} historical candles.`
        );
    }

    async run() {
        this.loadHistoricalData();

        if (this.historicalData.length === 0) {
            logger.error("No historical data to process.");
            return;
        }

        logger.info(
            `🔬 Starting backtest for ${this.config.dataFile} with strategy '${this.config.strategy}'...`
        );

        // Initialize paper trading engine (resets portfolio etc.)
        await this.paperTrading.initialize();
        this.paperTrading.start();

        const totalCandles = this.historicalData.length;
        const requiredCandles = this.signalGenerator.getRequiredCandleCount();

        // Simulate the event loop over historical data
        for (let i = requiredCandles; i < totalCandles; i++) {
            const currentCandle = this.historicalData[i];
            const candleHistory = this.historicalData.slice(0, i + 1);
            const currentPrice = currentCandle.close;

            // 1. Generate a signal
            const signal = await this.signalGenerator.generateSignal(
                this.config.symbol,
                candleHistory,
                currentPrice
            );
            const validatedSignal = this.signalGenerator.validateSignal(signal);

            // 2. Update portfolio (checks for stop-loss, etc.)
            const priceData = { [this.config.symbol]: { price: currentPrice } };
            this.paperTrading.updatePortfolioValue(priceData);

            // 3. Process the signal
            if (this.paperTrading.isValidSignal(validatedSignal)) {
                await this.paperTrading.processSignal(
                    validatedSignal,
                    currentPrice,
                    validatedSignal.atr
                );
            }
        }

        logger.success("✅ Backtest run completed.");
        return this.generateReport();
    }

    generateReport() {
        const portfolioSummary = this.paperTrading.getPortfolioSummary();
        const trades = this.paperTrading.getRecentTrades(10000); // Get all trades
        const analytics = this.generateTradeAnalytics(trades);

        const report = {
            config: this.config,
            summary: {
                ...analytics.summary,
                finalPortfolioValue: portfolioSummary.totalValue,
                totalPnLPercent:
                    (portfolioSummary.totalPnL / this.config.startingCapital) *
                    100,
            },
            performance: portfolioSummary.performance,
            trades: trades,
        };

        logger.info("--- BACKTEST REPORT ---");
        console.log(JSON.stringify(report.summary, null, 2));
        logger.info("-----------------------");

        return report;
    }

    generateTradeAnalytics(trades) {
        if (!trades || trades.length === 0)
            return { summary: { total: 0, profitable: 0, winRate: 0 } };
        const sellTrades = trades.filter((t) => t.side === "SELL");
        if (sellTrades.length === 0) return { summary: { total: 0 } };
        const profitable = sellTrades.filter((t) => (t.pnl || 0) > 0);
        const winRate = (profitable.length / sellTrades.length) * 100;
        const totalPnL = sellTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

        return {
            summary: {
                totalTrades: sellTrades.length,
                profitableTrades: profitable.length,
                winRate: Math.round(winRate * 100) / 100,
                totalPnL: Math.round(totalPnL * 100) / 100,
            },
        };
    }
}

module.exports = BacktestingEngine;
