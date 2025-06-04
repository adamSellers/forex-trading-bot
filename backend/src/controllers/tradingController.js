// backend/src/controllers/tradingController.js
const BinanceDataService = require("../services/binanceDataService");
const SignalGenerator = require("../services/signalGenerator");
const PaperTradingEngine = require("../services/paperTradingEngine");
const db = require("../../config/database");

class TradingController {
    constructor(io) {
        this.io = io;
        this.isInitialized = false;

        // Trading configuration
        this.config = {
            startingCapital: 5000,
            riskPerTrade: 0.01, // 1% = $50
            maxDailyLoss: 0.02, // 2% = $100
            maxWeeklyLoss: 0.05, // 5% = $250
            strategy: "balanced", // conservative, balanced, responsive
            timeframe: "1h",
            stopLossATR: 1.5,
            allocation: {
                BTCUSDT: 0.35,
                ETHUSDT: 0.35,
                BNBUSDT: 0.2,
                DOGEUSDT: 0.1,
            },
            enableTrading: false, // Start in paper mode
            maxPositionsPerAsset: 1,
            minOrderSize: 10,
            assets: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"],
            timeframes: ["1h", "4h", "1d"],
            useTestnet: true,
        };

        this.services = {};
        this.lastUpdate = null;
        this.updateInterval = null;
    }

    /**
     * Initialize all trading services
     */
    async initialize() {
        try {
            console.log("🚀 Initializing Trading Controller...");

            // Initialize Binance Data Service
            this.services.binanceData = new BinanceDataService({
                useTestnet: this.config.useTestnet,
                assets: this.config.assets,
                timeframes: this.config.timeframes,
            });

            // Initialize Signal Generator
            this.services.signalGenerator = new SignalGenerator({
                strategy: this.config.strategy,
                timeframe: this.config.timeframe,
                assets: this.config.assets,
                signalCooldown: 60000, // 1 minute
                minStrength: 0.5,
            });

            // Initialize Paper Trading Engine
            this.services.paperTrading = new PaperTradingEngine(this.config);

            // Set up event listeners
            this.setupEventListeners();

            // Wait for Binance service to be ready
            await new Promise((resolve, reject) => {
                this.services.binanceData.once("serviceReady", resolve);
                this.services.binanceData.once("serviceError", reject);

                // Timeout after 30 seconds
                setTimeout(
                    () =>
                        reject(
                            new Error("Binance service initialization timeout")
                        ),
                    30000
                );
            });

            // Start services
            this.services.paperTrading.start();
            this.services.signalGenerator.start(
                this.services.binanceData,
                60000
            ); // 1 minute intervals

            // Start real-time updates
            this.startRealTimeUpdates();

            this.isInitialized = true;
            console.log("✅ Trading Controller initialized successfully");

            // Emit initial status
            this.emitSystemStatus();
        } catch (error) {
            console.error("❌ Failed to initialize Trading Controller:", error);
            throw error;
        }
    }

    /**
     * Set up event listeners for all services
     */
    setupEventListeners() {
        // Binance Data Service Events
        this.services.binanceData.on("priceUpdate", (priceData) => {
            this.handlePriceUpdate(priceData);
        });

        this.services.binanceData.on("candlesUpdated", (data) => {
            this.io.emit("candlesUpdated", data);
        });

        // Signal Generator Events
        this.services.signalGenerator.on("signalGenerated", (signal) => {
            this.handleNewSignal(signal);
        });

        this.services.signalGenerator.on("allSignalsGenerated", (signals) => {
            this.io.emit("allSignalsGenerated", signals);
            this.saveSignalsToDatabase(signals);
        });

        // Paper Trading Events
        this.services.paperTrading.on("tradeExecuted", (trade) => {
            this.handleTradeExecuted(trade);
        });

        this.services.paperTrading.on("portfolioUpdated", (portfolio) => {
            this.io.emit("portfolioUpdated", portfolio);
        });

        this.services.paperTrading.on("stopLossTriggered", (data) => {
            this.handleStopLossTriggered(data);
        });

        this.services.paperTrading.on("tradingHalted", (data) => {
            this.io.emit("tradingHalted", data);
            console.warn("🚨 Trading halted:", data.reason);
        });
    }

    /**
     * Handle real-time price updates
     */
    handlePriceUpdate(priceData) {
        // Update portfolio values with current prices
        const allPrices = this.services.binanceData.getAllPrices();
        this.services.paperTrading.updatePortfolioValue(allPrices);

        // Emit price update to frontend
        this.io.emit("priceUpdate", priceData);

        this.lastUpdate = Date.now();
    }

    /**
     * Handle new trading signals
     */
    async handleNewSignal(signal) {
        try {
            // Get current price and ATR for the asset
            const priceData = this.services.binanceData.getCurrentPrice(
                signal.symbol
            );

            if (!priceData) {
                console.warn(`No price data available for ${signal.symbol}`);
                return;
            }

            // Process signal through paper trading engine
            const result = await this.services.paperTrading.processSignal(
                signal,
                priceData.price,
                signal.atr
            );

            // Emit signal and result to frontend
            this.io.emit("signalGenerated", {
                signal,
                result,
                timestamp: Date.now(),
            });

            // Log significant signals
            if (result.success && result.action !== "HOLD") {
                console.log(
                    `📊 Signal processed: ${signal.symbol} ${result.action} - ${
                        result.trade ? "EXECUTED" : "NO ACTION"
                    }`
                );
            }
        } catch (error) {
            console.error("Error handling signal:", error);
        }
    }

    /**
     * Handle executed trades
     */
    handleTradeExecuted(trade) {
        // Save trade to database
        this.saveTradeToDatabase(trade);

        // Emit to frontend
        this.io.emit("tradeExecuted", trade);

        // Log trade execution
        const pnlText = trade.pnl
            ? ` (P&L: ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)})`
            : "";
        console.log(
            `💰 Trade executed: ${trade.side} ${trade.quantity} ${trade.symbol} at $${trade.price}${pnlText}`
        );
    }

    /**
     * Handle stop loss triggers
     */
    async handleStopLossTriggered(data) {
        const { symbol, position, currentPrice } = data;

        // Create emergency sell signal
        const emergencySignal = {
            symbol,
            signal: "EMERGENCY_SELL",
            strength: 10,
            message: "Stop loss triggered",
            timestamp: Date.now(),
        };

        // Execute emergency sell
        const result = await this.services.paperTrading.executeSellOrder(
            symbol,
            currentPrice,
            emergencySignal,
            position
        );

        this.io.emit("emergencyTrade", {
            reason: "STOP_LOSS",
            result,
            position,
            triggerPrice: currentPrice,
        });

        console.warn(`🛑 STOP LOSS: ${symbol} sold at $${currentPrice}`);
    }

    /**
     * Start real-time updates to frontend
     */
    startRealTimeUpdates() {
        this.updateInterval = setInterval(() => {
            try {
                // Emit system status every 30 seconds
                this.emitSystemStatus();

                // Emit portfolio summary
                const portfolio =
                    this.services.paperTrading.getPortfolioSummary();
                this.io.emit("portfolioSummary", portfolio);
            } catch (error) {
                console.error("Error in real-time updates:", error);
            }
        }, 30000); // 30 seconds

        console.log("📡 Real-time updates started");
    }

    /**
     * Emit system status to frontend
     */
    emitSystemStatus() {
        const status = {
            isInitialized: this.isInitialized,
            lastUpdate: this.lastUpdate,
            services: {
                binanceData: this.services.binanceData?.getServiceStatus(),
                signalGenerator: this.services.signalGenerator?.getStatus(),
                paperTrading: this.services.paperTrading?.getStatus(),
            },
            config: this.config,
        };

        this.io.emit("systemStatus", status);
    }

    /**
     * API route handlers
     */

    // GET /api/trading/status
    getStatus(req, res) {
        try {
            const status = {
                isInitialized: this.isInitialized,
                lastUpdate: this.lastUpdate,
                services: {
                    binanceData: this.services.binanceData?.getServiceStatus(),
                    signalGenerator: this.services.signalGenerator?.getStatus(),
                    paperTrading: this.services.paperTrading?.getStatus(),
                },
                config: this.config,
            };

            res.json(status);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/portfolio
    getPortfolio(req, res) {
        try {
            if (!this.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            const portfolio = this.services.paperTrading.getPortfolioSummary();
            res.json(portfolio);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/signals
    getSignals(req, res) {
        try {
            const { symbol, limit = 20 } = req.query;

            if (!this.services.signalGenerator) {
                return res
                    .status(400)
                    .json({ error: "Signal generator not initialized" });
            }

            let signals;
            if (symbol) {
                signals = this.services.signalGenerator.getAssetSignals(
                    symbol,
                    parseInt(limit)
                );
            } else {
                signals = this.services.signalGenerator.signalHistory
                    .slice(-parseInt(limit))
                    .reverse();
            }

            res.json(signals);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/trades
    getTrades(req, res) {
        try {
            const { limit = 20 } = req.query;

            if (!this.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            const trades = this.services.paperTrading.getRecentTrades(
                parseInt(limit)
            );
            res.json(trades);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/prices
    getPrices(req, res) {
        try {
            if (!this.services.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not initialized" });
            }

            const prices = this.services.binanceData.getAllPrices();
            res.json(prices);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/candles/:symbol/:timeframe
    getCandles(req, res) {
        try {
            const { symbol, timeframe } = req.params;
            const { limit = 100 } = req.query;

            if (!this.services.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not initialized" });
            }

            const candles = this.services.binanceData.getCandles(
                symbol,
                timeframe
            );
            const limitedCandles = candles.slice(-parseInt(limit));

            res.json(limitedCandles);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/account - Get account balances
    getAccount(req, res) {
        try {
            if (!this.services.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not initialized" });
            }

            this.services.binanceData
                .getAccountInfo()
                .then((account) => res.json(account))
                .catch((error) => {
                    console.error("Error fetching account info:", error);
                    res.status(500).json({ error: error.message });
                });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/balances - Get crypto balances
    getBalances(req, res) {
        try {
            if (!this.services.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not initialized" });
            }

            this.services.binanceData
                .getAccountInfo()
                .then((account) => {
                    const balances = account.balances.reduce((acc, balance) => {
                        acc[balance.asset] = balance;
                        return acc;
                    }, {});
                    res.json(balances);
                })
                .catch((error) => {
                    console.error("Error fetching balances:", error);
                    res.status(500).json({ error: error.message });
                });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
    updateConfig(req, res) {
        try {
            const newConfig = req.body;

            // Update main config
            this.config = { ...this.config, ...newConfig };

            // Update service configs
            if (this.services.signalGenerator) {
                this.services.signalGenerator.updateConfig({
                    strategy: this.config.strategy,
                    timeframe: this.config.timeframe,
                });
            }

            if (this.services.paperTrading) {
                this.services.paperTrading.updateConfig(this.config);
            }

            this.io.emit("configUpdated", this.config);
            res.json({ success: true, config: this.config });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // POST /api/trading/reset
    resetTrading(req, res) {
        try {
            if (!this.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            this.services.paperTrading.reset();

            if (this.services.signalGenerator) {
                this.services.signalGenerator.reset();
            }

            this.io.emit("tradingReset");
            res.json({
                success: true,
                message: "Trading engine reset successfully",
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // POST /api/trading/start
    startTrading(req, res) {
        try {
            if (!this.isInitialized) {
                return res
                    .status(400)
                    .json({ error: "Trading controller not initialized" });
            }

            this.config.enableTrading = true;
            this.services.paperTrading.updateConfig({ enableTrading: true });

            this.io.emit("tradingStarted");
            res.json({ success: true, message: "Trading started" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // POST /api/trading/stop
    stopTrading(req, res) {
        try {
            this.config.enableTrading = false;

            if (this.services.paperTrading) {
                this.services.paperTrading.updateConfig({
                    enableTrading: false,
                });
            }

            this.io.emit("tradingStopped");
            res.json({ success: true, message: "Trading stopped" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Database operations
     */
    async saveTradeToDatabase(trade) {
        try {
            // Check if db is properly initialized
            if (!db || typeof db !== "function") {
                console.warn("Database not available, skipping trade save");
                return;
            }

            await db("trades").insert({
                trade_id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                total_value: trade.totalValue || trade.totalCost,
                pnl: trade.pnl || 0,
                signal: trade.signal,
                signal_strength: trade.signalStrength,
                timestamp: new Date(trade.timestamp),
                created_at: new Date(),
            });

            console.log(`💾 Trade saved to database: ${trade.id}`);
        } catch (error) {
            console.error("Error saving trade to database:", error.message);
            // Don't throw error - continue operation without database
        }
    }

    async saveSignalsToDatabase(signals) {
        try {
            // Check if db is properly initialized
            if (!db || typeof db !== "function") {
                console.warn("Database not available, skipping signals save");
                return;
            }

            const signalRecords = signals
                .filter((signal) => signal && signal.symbol && signal.signal) // Filter valid signals
                .map((signal) => ({
                    symbol: signal.symbol,
                    signal: signal.signal,
                    strength: signal.strength || 0,
                    strategy: signal.strategy || "unknown",
                    timeframe: signal.timeframe || "1h",
                    current_price: signal.currentPrice || null,
                    message: signal.message || "",
                    timestamp: new Date(signal.timestamp || Date.now()),
                    created_at: new Date(),
                }));

            if (signalRecords.length > 0) {
                await db("signals").insert(signalRecords);
                console.log(
                    `💾 ${signalRecords.length} signals saved to database`
                );
            }
        } catch (error) {
            console.error("Error saving signals to database:", error.message);
            // Don't throw error - continue operation without database
        }
    }

    /**
     * Cleanup method
     */
    async cleanup() {
        console.log("🧹 Cleaning up Trading Controller...");

        // Stop real-time updates
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Stop services
        if (this.services.signalGenerator) {
            this.services.signalGenerator.stop();
        }

        if (this.services.paperTrading) {
            this.services.paperTrading.stop();
        }

        if (this.services.binanceData) {
            this.services.binanceData.cleanup();
        }

        this.isInitialized = false;
        console.log("✅ Trading Controller cleaned up");
    }
}

module.exports = TradingController;
