// backend/src/controllers/tradingController.js - COMPLETE WITH ALL FIXES
const BinanceDataService = require("../services/binanceDataService_Testnet");
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
            useTestnet: false, // LIVE: Use real Binance API
            useRealData: true, // LIVE: Real market data
        };

        this.services = {};
        this.lastUpdate = null;
        this.updateInterval = null;
        this.signalDebugMode = process.env.NODE_ENV === "development";

        console.log("🚀 LIVE MODE: Real Binance data with Paper Trading");
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

            // Generate initial test signal if in debug mode
            if (this.signalDebugMode) {
                setTimeout(() => {
                    this.generateTestSignal();
                }, 5000);
            }
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
            this.handleAllSignalsGenerated(signals);
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
     * ENHANCED: Handle new trading signals with comprehensive debugging
     */
    async handleNewSignal(signal) {
        try {
            console.log("🚨 NEW SIGNAL RECEIVED:", {
                symbol: signal.symbol,
                signal: signal.signal,
                strength: signal.strength,
                timestamp: new Date(signal.timestamp).toISOString(),
                strategy: signal.strategy,
                message: signal.message,
            });

            // Get current price and ATR for the asset
            const priceData = this.services.binanceData.getCurrentPrice(
                signal.symbol
            );

            if (!priceData) {
                console.warn(`⚠️ No price data available for ${signal.symbol}`);
                return;
            }

            if (this.signalDebugMode) {
                console.log("💱 Current price data:", {
                    symbol: signal.symbol,
                    price: priceData.price,
                    change: priceData.priceChange,
                });
            }

            // Process signal through paper trading engine
            const result = await this.services.paperTrading.processSignal(
                signal,
                priceData.price,
                signal.atr
            );

            if (this.signalDebugMode) {
                console.log("⚙️ Signal processing result:", {
                    success: result.success,
                    action: result.action,
                    reason: result.reason,
                });
            }

            // Enhanced signal payload for frontend
            const signalPayload = {
                ...signal,
                processingResult: result,
                currentPrice: priceData.price,
                priceChange: priceData.priceChange,
            };

            console.log("📡 EMITTING SIGNAL to frontend:", {
                symbol: signalPayload.symbol,
                signal: signalPayload.signal,
                strength: signalPayload.strength,
                socketConnections: this.io.engine.clientsCount,
            });

            // Emit to frontend - Multiple formats for compatibility
            this.io.emit("signalGenerated", signalPayload);
            this.io.emit("signalGenerated", { signal: signalPayload });

            // Log significant signals
            if (result.success && result.action !== "HOLD") {
                console.log(
                    `📊 ACTIONABLE SIGNAL: ${signal.symbol} ${
                        result.action
                    } - ${result.trade ? "EXECUTED" : "NO ACTION"}`
                );
            }
        } catch (error) {
            console.error("❌ Error handling signal:", error);

            // Emit error signal for debugging
            const errorSignal = {
                symbol: signal?.symbol || "UNKNOWN",
                signal: "ERROR",
                strength: 0,
                message: error.message,
                timestamp: Date.now(),
                strategy: "error",
            };

            this.io.emit("signalGenerated", errorSignal);
        }
    }

    /**
     * ENHANCED: Handle batch signals generation
     */
    async handleAllSignalsGenerated(signals) {
        try {
            console.log(
                `📊 BATCH SIGNALS GENERATED: ${signals.length} signals`
            );

            if (this.signalDebugMode) {
                signals.forEach((signal, index) => {
                    console.log(`Signal ${index + 1}:`, {
                        symbol: signal.symbol,
                        signal: signal.signal,
                        strength: signal.strength,
                        message: signal.message,
                    });
                });
            }

            // Emit batch signals to frontend
            this.io.emit("allSignalsGenerated", signals);

            // Also emit individual signals for immediate processing
            signals.forEach((signal) => {
                this.io.emit("signalGenerated", signal);
            });

            // Save to database
            await this.saveSignalsToDatabase(signals);

            console.log(`✅ Batch signals processed and emitted successfully`);
        } catch (error) {
            console.error("❌ Error handling batch signals:", error);
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

        // Log trade execution with USDT amounts
        const pnlText = trade.pnl
            ? ` (P&L: ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)} USDT)`
            : "";
        const amountText =
            trade.side === "BUY"
                ? `${trade.usdtCost.toFixed(2)} USDT`
                : `${trade.usdtReceived.toFixed(2)} USDT`;

        console.log(
            `💰 Trade executed: ${trade.side} ${trade.quantity.toFixed(8)} ${
                trade.symbol
            } at ${trade.price} (${amountText})${pnlText}`
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

        console.warn(`🛑 STOP LOSS: ${symbol} sold at ${currentPrice}`);
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

                if (this.signalDebugMode) {
                    console.log("📡 Real-time update sent:", {
                        connections: this.io.engine.clientsCount,
                        portfolioValue: portfolio.totalValue,
                    });
                }
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
            socketConnections: this.io.engine.clientsCount,
            debugMode: this.signalDebugMode,
        };

        this.io.emit("systemStatus", status);
    }

    /**
     * ADDED: Generate test signal for debugging
     */
    async generateTestSignal() {
        if (!this.signalDebugMode) return;

        console.log("🧪 GENERATING TEST SIGNAL");

        const testSignals = [
            {
                symbol: "BTCUSDT",
                signal: "TEST_BUY",
                strength: 2.5,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 50000,
                message: "Test BUY signal for debugging",
                timestamp: Date.now(),
                atr: 1500,
            },
            {
                symbol: "ETHUSDT",
                signal: "TEST_SELL",
                strength: 1.8,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 3000,
                message: "Test SELL signal for debugging",
                timestamp: Date.now() + 1000,
                atr: 150,
            },
            {
                symbol: "BNBUSDT",
                signal: "HOLD",
                strength: 0.3,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 400,
                message: "Test HOLD signal for debugging",
                timestamp: Date.now() + 2000,
                atr: 20,
            },
        ];

        // Emit test signals one by one
        for (const testSignal of testSignals) {
            setTimeout(() => {
                this.io.emit("signalGenerated", testSignal);
                console.log(
                    "📡 Test signal emitted:",
                    testSignal.symbol,
                    testSignal.signal
                );
            }, testSignals.indexOf(testSignal) * 2000);
        }

        return testSignals;
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
                socketConnections: this.io.engine.clientsCount,
                debugMode: this.signalDebugMode,
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
            const { symbol, limit = 50 } = req.query;

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

            console.log(`📊 API: Returning ${signals.length} signals`);
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

    // POST /api/trading/config - Update configuration
    updateConfig(req, res) {
        try {
            const newConfig = req.body;
            console.log("⚙️ Updating configuration:", newConfig);

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
            console.log("🔄 Resetting trading engine...");

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

            console.log("▶️ Starting trading...");
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
            console.log("⏹️ Stopping trading...");
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

    // ADDED: POST /api/trading/test-signal - Generate test signal
    generateTestSignalAPI(req, res) {
        try {
            if (!this.signalDebugMode) {
                return res.status(400).json({
                    error: "Test signals only available in development mode",
                });
            }

            const testSignal = this.generateTestSignal();
            res.json({
                success: true,
                message: "Test signals generated",
                signals: testSignal,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * ENHANCED: Database operations with better error handling
     */
    async saveTradeToDatabase(trade) {
        try {
            // Check if db is properly initialized
            if (!db || typeof db !== "function") {
                console.warn("⚠️ Database not available, skipping trade save");
                return;
            }

            console.log("💾 Saving trade to database:", {
                id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                price: trade.price,
            });

            // Updated to use USDT-based fields
            await db("trades").insert({
                trade_id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                total_value: trade.usdtCost || trade.usdtReceived || 0,
                pnl: trade.pnl || 0,
                pnl_percent: trade.pnlPercent || 0,
                signal: trade.signal,
                signal_strength: trade.signalStrength,
                stop_loss: trade.stopLoss || null,
                entry_cost: trade.entryCost || null,
                holding_period: trade.holdingPeriod || null,
                timestamp: new Date(trade.timestamp),
                created_at: new Date(),
            });

            console.log(`✅ Trade saved to database: ${trade.id}`);
        } catch (error) {
            console.error("❌ Error saving trade to database:", error.message);
            // Don't throw error - continue operation without database
        }
    }

    /**
     * ENHANCED: Save signals to database with comprehensive error handling
     */
    async saveSignalsToDatabase(signals) {
        try {
            console.log("💾 Attempting to save signals to database:", {
                signalsCount: signals.length,
                firstSignal: signals[0]?.symbol || "none",
            });

            // Check if db is properly initialized
            if (!db || typeof db !== "function") {
                console.warn(
                    "⚠️ Database not available, skipping signals save"
                );
                return;
            }

            const signalRecords = signals
                .filter((signal) => {
                    const isValid = signal && signal.symbol && signal.signal;
                    if (!isValid) {
                        console.warn(
                            "⚠️ Filtering out invalid signal:",
                            signal
                        );
                    }
                    return isValid;
                })
                .map((signal) => {
                    const record = {
                        symbol: signal.symbol,
                        signal: signal.signal,
                        strength: signal.strength || 0,
                        strategy: signal.strategy || "unknown",
                        timeframe: signal.timeframe || "1h",
                        current_price: signal.currentPrice || null,
                        message: signal.message || "",
                        atr: signal.atr || null,
                        trend_data: signal.trend
                            ? JSON.stringify(signal.trend)
                            : null,
                        timestamp: new Date(signal.timestamp || Date.now()),
                        created_at: new Date(),
                    };

                    if (this.signalDebugMode) {
                        console.log("📝 Signal record prepared:", {
                            symbol: record.symbol,
                            signal: record.signal,
                            strength: record.strength,
                        });
                    }

                    return record;
                });

            if (signalRecords.length > 0) {
                await db("signals").insert(signalRecords);
                console.log(
                    `✅ ${signalRecords.length} signals saved to database successfully`
                );
            } else {
                console.warn("⚠️ No valid signal records to save");
            }
        } catch (error) {
            console.error(
                "❌ Error saving signals to database:",
                error.message
            );
            console.error("❌ Error stack:", error.stack);
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
