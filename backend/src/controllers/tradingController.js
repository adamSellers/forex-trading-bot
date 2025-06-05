// backend/src/controllers/tradingController.js - COMPLETE ENHANCED VERSION
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
            useTestnet: false, // LIVE: Use real Binance API
            useRealData: true, // LIVE: Real market data
        };

        this.services = {};
        this.lastUpdate = null;
        this.updateInterval = null;
        this.signalDebugMode = process.env.NODE_ENV === "development";

        console.log(
            "🚀 ENHANCED MODE: Real Binance data with Enhanced Paper Trading"
        );
    }

    /**
     * Initialize all trading services
     */
    async initialize() {
        try {
            console.log("🚀 Initializing Enhanced Trading Controller...");

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
            console.log(
                "✅ Enhanced Trading Controller initialized successfully"
            );

            // Emit initial status
            this.emitSystemStatus();

            // Generate initial test signal if in debug mode
            if (this.signalDebugMode) {
                setTimeout(() => {
                    this.generateTestSignal();
                }, 5000);
            }
        } catch (error) {
            console.error(
                "❌ Failed to initialize Enhanced Trading Controller:",
                error
            );
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
            console.log("🚨 ENHANCED SIGNAL RECEIVED:", {
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

            console.log("📡 EMITTING ENHANCED SIGNAL to frontend:", {
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
            console.error("❌ Error handling enhanced signal:", error);

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
                `📊 ENHANCED BATCH SIGNALS GENERATED: ${signals.length} signals`
            );

            if (this.signalDebugMode) {
                signals.forEach((signal, index) => {
                    console.log(`Enhanced Signal ${index + 1}:`, {
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

            console.log(
                `✅ Enhanced batch signals processed and emitted successfully`
            );
        } catch (error) {
            console.error("❌ Error handling enhanced batch signals:", error);
        }
    }

    /**
     * Handle executed trades
     */
    handleTradeExecuted(trade) {
        // Save trade to database
        this.saveTradeToDatabase(trade);

        // Enhanced trade events
        this.io.emit("tradeExecuted", trade);
        this.io.emit("paperTradeExecuted", trade); // NEW: Paper-specific event

        // Log trade execution with USDT amounts
        const pnlText = trade.pnl
            ? ` (P&L: ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)} USDT)`
            : "";
        const amountText =
            trade.side === "BUY"
                ? `${trade.usdtCost.toFixed(2)} USDT`
                : `${trade.usdtReceived.toFixed(2)} USDT`;

        console.log(
            `💰 Enhanced trade executed: ${trade.side} ${trade.quantity.toFixed(
                8
            )} ${trade.symbol} at ${trade.price} (${amountText})${pnlText}`
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

        console.warn(
            `🛑 ENHANCED STOP LOSS: ${symbol} sold at ${currentPrice}`
        );
    }

    /**
     * Start real-time updates to frontend
     */
    startRealTimeUpdates() {
        this.updateInterval = setInterval(() => {
            try {
                // Emit enhanced system status every 30 seconds
                this.emitSystemStatus();

                // Emit enhanced portfolio summary
                const portfolio =
                    this.services.paperTrading.getPortfolioSummary();
                this.io.emit("portfolioSummary", portfolio);

                // NEW: Emit risk status updates
                if (portfolio.riskStatus) {
                    this.io.emit("riskStatusUpdated", portfolio.riskStatus);
                }

                if (this.signalDebugMode) {
                    console.log("📡 Enhanced real-time update sent:", {
                        connections: this.io.engine.clientsCount,
                        portfolioValue: portfolio.totalValue,
                        riskStatus: portfolio.riskStatus.isHalted
                            ? "HALTED"
                            : "ACTIVE",
                    });
                }
            } catch (error) {
                console.error("Error in enhanced real-time updates:", error);
            }
        }, 30000); // 30 seconds

        console.log("📡 Enhanced real-time updates started");
    }

    /**
     * Emit enhanced system status to frontend
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
            enhanced: true, // Mark as enhanced version
        };

        this.io.emit("systemStatus", status);
    }

    /**
     * Generate test signal for debugging
     */
    async generateTestSignal() {
        if (!this.signalDebugMode) return;

        console.log("🧪 GENERATING ENHANCED TEST SIGNAL");

        const testSignals = [
            {
                symbol: "BTCUSDT",
                signal: "TEST_BUY",
                strength: 2.5,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 67000,
                message: "Enhanced test BUY signal for debugging",
                timestamp: Date.now(),
                atr: 1500,
            },
            {
                symbol: "ETHUSDT",
                signal: "TEST_SELL",
                strength: 1.8,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 3400,
                message: "Enhanced test SELL signal for debugging",
                timestamp: Date.now() + 1000,
                atr: 150,
            },
            {
                symbol: "BNBUSDT",
                signal: "HOLD",
                strength: 0.3,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 600,
                message: "Enhanced test HOLD signal for debugging",
                timestamp: Date.now() + 2000,
                atr: 20,
            },
        ];

        // Emit test signals one by one
        for (const testSignal of testSignals) {
            setTimeout(() => {
                this.io.emit("signalGenerated", testSignal);
                console.log(
                    "📡 Enhanced test signal emitted:",
                    testSignal.symbol,
                    testSignal.signal
                );
            }, testSignals.indexOf(testSignal) * 2000);
        }

        return testSignals;
    }

    // ================== ENHANCED API ROUTE HANDLERS ==================

    /**
     * GET /api/trading/status - Enhanced system status
     */
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
                enhanced: true,
                startTime: Date.now() - (this.lastUpdate || 0),
            };

            res.json(status);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * ENHANCED: getPortfolio method that combines real Binance holdings with paper trading data
     */
    getPortfolio(req, res) {
        try {
            if (!this.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            // Get paper trading portfolio
            const paperPortfolio =
                this.services.paperTrading.getPortfolioSummary();

            // Get current market prices
            const prices = this.services.binanceData?.getAllPrices() || {};

            // Enhanced portfolio object
            const enhancedPortfolio = {
                ...paperPortfolio,
                timestamp: Date.now(),

                // Paper trading specific data
                paper: {
                    usdtBalance: paperPortfolio.usdtBalance,
                    positions: paperPortfolio.positions,
                    totalValue: paperPortfolio.totalValue,
                    totalPnL: paperPortfolio.totalPnL,
                    dailyPnL: paperPortfolio.dailyPnL,
                    weeklyPnL: paperPortfolio.weeklyPnL,
                    performance: paperPortfolio.performance,
                },

                // Market context
                marketData: {
                    prices,
                    lastUpdate: Date.now(),
                    assets: this.config.assets,
                    activeStrategy: this.config.strategy,
                },

                // Trading status
                tradingStatus: {
                    enabled: this.config.enableTrading,
                    mode: "PAPER_TRADING",
                    isActive: this.services.paperTrading.isActive,
                    riskLimits: paperPortfolio.riskStatus,
                },
            };

            res.json(enhancedPortfolio);
        } catch (error) {
            console.error("Error getting enhanced portfolio:", error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * NEW: getCombinedHoldings - Returns real + paper holdings for dashboard
     */
    getCombinedHoldings(req, res) {
        try {
            const holdings = {
                timestamp: Date.now(),
                real: null,
                paper: null,
                combined: null,
            };

            // Get real account info (async)
            this.services.binanceData
                .getAccountInfo()
                .then((realAccount) => {
                    holdings.real = {
                        balances: realAccount.balances || [],
                        accountType: realAccount.accountType,
                        canTrade: realAccount.canTrade,
                        totalValue: 0, // Will be calculated client-side with current prices
                    };

                    // Get paper positions
                    if (this.services.paperTrading) {
                        const paperPortfolio =
                            this.services.paperTrading.getPortfolioSummary();
                        holdings.paper = {
                            usdtBalance: paperPortfolio.usdtBalance,
                            positions: paperPortfolio.positions,
                            totalValue: paperPortfolio.totalValue,
                            totalPnL: paperPortfolio.totalPnL,
                        };
                    }

                    // Get current prices for calculations
                    holdings.prices =
                        this.services.binanceData?.getAllPrices() || {};

                    res.json(holdings);
                })
                .catch((error) => {
                    console.error("Error fetching real account info:", error);

                    // Fallback: Return paper data only
                    if (this.services.paperTrading) {
                        const paperPortfolio =
                            this.services.paperTrading.getPortfolioSummary();
                        holdings.paper = {
                            usdtBalance: paperPortfolio.usdtBalance,
                            positions: paperPortfolio.positions,
                            totalValue: paperPortfolio.totalValue,
                            totalPnL: paperPortfolio.totalPnL,
                        };
                    }

                    holdings.prices =
                        this.services.binanceData?.getAllPrices() || {};
                    holdings.error = "Could not fetch real account data";

                    res.json(holdings);
                });
        } catch (error) {
            console.error("Error in getCombinedHoldings:", error);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * ENHANCED: getAccount method with paper trading context
     */
    getAccount(req, res) {
        try {
            if (!this.services.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not initialized" });
            }

            this.services.binanceData
                .getAccountInfo()
                .then((account) => {
                    // Add paper trading context
                    const enhancedAccount = {
                        ...account,

                        // Trading mode indicators
                        tradingMode: "PAPER_ONLY",
                        paperTradingActive:
                            this.services.paperTrading?.isActive || false,

                        // Paper trading summary
                        paperSummary: this.services.paperTrading
                            ? {
                                  usdtBalance:
                                      this.services.paperTrading.portfolio
                                          .usdtBalance,
                                  positionCount:
                                      this.services.paperTrading.portfolio
                                          .positions.size,
                                  totalPnL:
                                      this.services.paperTrading.portfolio
                                          .totalPnL,
                                  tradingEnabled: this.config.enableTrading,
                              }
                            : null,

                        // Risk status
                        riskManagement: this.services.paperTrading
                            ? this.services.paperTrading.getPortfolioSummary()
                                  .riskStatus
                            : null,
                    };

                    res.json(enhancedAccount);
                })
                .catch((error) => {
                    console.error("Error fetching account info:", error);
                    res.status(500).json({ error: error.message });
                });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * NEW: getPaperTradingStats - Detailed paper trading analytics
     */
    getPaperTradingStats(req, res) {
        try {
            if (!this.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Paper trading engine not initialized" });
            }

            const portfolio = this.services.paperTrading.getPortfolioSummary();
            const recentTrades = this.services.paperTrading.getRecentTrades(50);
            const prices = this.services.binanceData?.getAllPrices() || {};

            // Calculate additional metrics
            const stats = {
                // Portfolio snapshot
                portfolio: {
                    startingCapital: this.config.startingCapital,
                    currentValue: portfolio.totalValue,
                    usdtBalance: portfolio.usdtBalance,
                    cryptoValue: portfolio.cryptoValue,
                    totalReturn: portfolio.totalPnLPercent,
                    absoluteReturn: portfolio.totalPnL,
                },

                // Position analysis
                positions: {
                    active: portfolio.positions.length,
                    totalPositionValue: portfolio.cryptoValue,
                    largestPosition: portfolio.positions.reduce(
                        (max, pos) =>
                            (pos.currentValue || 0) > (max.currentValue || 0)
                                ? pos
                                : max,
                        { currentValue: 0 }
                    ),
                    avgHoldingPeriod:
                        this.calculateAvgHoldingPeriod(recentTrades),
                },

                // Performance metrics
                performance: {
                    ...portfolio.performance,
                    profitableDays: this.calculateProfitableDays(recentTrades),
                    longestWinStreak: this.calculateWinStreak(recentTrades),
                    averageWin: portfolio.performance.avgWin,
                    averageLoss: portfolio.performance.avgLoss,
                    riskRewardRatio:
                        portfolio.performance.avgWin /
                        (portfolio.performance.avgLoss || 1),
                },

                // Risk analysis
                risk: {
                    ...portfolio.riskStatus,
                    riskUtilization: {
                        daily:
                            (portfolio.riskStatus.dailyLossUsed /
                                portfolio.riskStatus.dailyLossLimit) *
                            100,
                        weekly:
                            (portfolio.riskStatus.weeklyLossUsed /
                                portfolio.riskStatus.weeklyLossLimit) *
                            100,
                    },
                    drawdownAnalysis: {
                        current: portfolio.performance.currentDrawdown,
                        maximum: portfolio.performance.maxDrawdown,
                        recovery: this.calculateDrawdownRecovery(portfolio),
                    },
                },

                // Trading activity
                activity: {
                    totalTrades: recentTrades.length,
                    tradesThisWeek: recentTrades.filter(
                        (t) =>
                            Date.now() - t.timestamp < 7 * 24 * 60 * 60 * 1000
                    ).length,
                    tradesToday: recentTrades.filter(
                        (t) =>
                            new Date(t.timestamp).toDateString() ===
                            new Date().toDateString()
                    ).length,
                    avgTradesPerDay:
                        this.calculateAvgTradesPerDay(recentTrades),
                    lastTradeTime:
                        recentTrades.length > 0
                            ? recentTrades[0].timestamp
                            : null,
                },

                // Strategy performance
                strategy: {
                    name: this.config.strategy,
                    timeframe: this.config.timeframe,
                    signalsGenerated:
                        this.services.signalGenerator?.signalHistory?.length ||
                        0,
                    signalToTradeRatio: this.calculateSignalToTradeRatio(),
                    winRateByAsset: this.calculateWinRateByAsset(recentTrades),
                },

                // Market context
                market: {
                    prices,
                    timestamp: Date.now(),
                    portfolioCorrelation: this.calculatePortfolioCorrelation(
                        portfolio.positions,
                        prices
                    ),
                },
            };

            res.json(stats);
        } catch (error) {
            console.error("Error getting paper trading stats:", error);
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/signals - Enhanced signals
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

            console.log(`📊 Enhanced API: Returning ${signals.length} signals`);
            res.json(signals);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // GET /api/trading/trades - Enhanced trades
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

    // GET /api/trading/prices - Enhanced prices
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

    // GET /api/trading/balances
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

    // POST /api/trading/config - Enhanced configuration update
    updateConfig(req, res) {
        try {
            const newConfig = req.body;
            console.log("⚙️ Updating enhanced configuration:", newConfig);

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
            console.log("🔄 Resetting enhanced trading engine...");

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
                message: "Enhanced trading engine reset successfully",
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

            console.log("▶️ Starting enhanced trading...");
            this.config.enableTrading = true;
            this.services.paperTrading.updateConfig({ enableTrading: true });

            this.io.emit("tradingStarted");
            res.json({ success: true, message: "Enhanced trading started" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // POST /api/trading/stop
    stopTrading(req, res) {
        try {
            console.log("⏹️ Stopping enhanced trading...");
            this.config.enableTrading = false;

            if (this.services.paperTrading) {
                this.services.paperTrading.updateConfig({
                    enableTrading: false,
                });
            }

            this.io.emit("tradingStopped");
            res.json({ success: true, message: "Enhanced trading stopped" });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // POST /api/trading/test-signal - Generate enhanced test signal
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
                message: "Enhanced test signals generated",
                signals: testSignal,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // ================== ENHANCED HELPER METHODS ==================

    /**
     * Helper method: Calculate average holding period
     */
    calculateAvgHoldingPeriod(trades) {
        const completedTrades = trades.filter(
            (t) => t.side === "SELL" && t.holdingPeriod
        );
        if (completedTrades.length === 0) return 0;

        const totalTime = completedTrades.reduce(
            (sum, t) => sum + t.holdingPeriod,
            0
        );
        return Math.round(
            totalTime / completedTrades.length / (1000 * 60 * 60)
        ); // Hours
    }

    /**
     * Helper method: Calculate profitable days
     */
    calculateProfitableDays(trades) {
        const dailyPnL = {};

        trades
            .filter((t) => t.side === "SELL")
            .forEach((trade) => {
                const date = new Date(trade.timestamp).toDateString();
                dailyPnL[date] = (dailyPnL[date] || 0) + (trade.pnl || 0);
            });

        const totalDays = Object.keys(dailyPnL).length;
        const profitableDays = Object.values(dailyPnL).filter(
            (pnl) => pnl > 0
        ).length;

        return {
            total: totalDays,
            profitable: profitableDays,
            percentage: totalDays > 0 ? (profitableDays / totalDays) * 100 : 0,
        };
    }

    /**
     * Helper method: Calculate win streak
     */
    calculateWinStreak(trades) {
        const sellTrades = trades.filter((t) => t.side === "SELL").reverse(); // Chronological order

        let currentStreak = 0;
        let maxStreak = 0;

        sellTrades.forEach((trade) => {
            if (trade.pnl > 0) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        });

        return { current: currentStreak, maximum: maxStreak };
    }

    /**
     * Helper method: Calculate drawdown recovery
     */
    calculateDrawdownRecovery(portfolio) {
        const currentDrawdown = portfolio.performance.currentDrawdown;
        const maxDrawdown = portfolio.performance.maxDrawdown;

        return {
            fromPeak: currentDrawdown,
            fromMax: maxDrawdown - currentDrawdown,
            recoveryProgress:
                maxDrawdown > 0
                    ? ((maxDrawdown - currentDrawdown) / maxDrawdown) * 100
                    : 100,
        };
    }

    /**
     * Helper method: Calculate average trades per day
     */
    calculateAvgTradesPerDay(trades) {
        if (trades.length === 0) return 0;

        const firstTrade = trades[trades.length - 1].timestamp;
        const lastTrade = trades[0].timestamp;
        const daysDiff = (lastTrade - firstTrade) / (1000 * 60 * 60 * 24);

        return daysDiff > 0 ? trades.length / daysDiff : 0;
    }

    /**
     * Helper method: Calculate signal to trade ratio
     */
    calculateSignalToTradeRatio() {
        const signalCount =
            this.services.signalGenerator?.signalHistory?.length || 0;
        const tradeCount =
            this.services.paperTrading?.tradeHistory?.length || 0;

        return {
            signals: signalCount,
            trades: tradeCount,
            ratio: signalCount > 0 ? tradeCount / signalCount : 0,
            efficiency:
                signalCount > 0
                    ? ((tradeCount / signalCount) * 100).toFixed(1) + "%"
                    : "0%",
        };
    }

    /**
     * Helper method: Calculate win rate by asset
     */
    calculateWinRateByAsset(trades) {
        const assetStats = {};

        trades
            .filter((t) => t.side === "SELL")
            .forEach((trade) => {
                const asset = trade.symbol;
                if (!assetStats[asset]) {
                    assetStats[asset] = { wins: 0, total: 0, totalPnL: 0 };
                }

                assetStats[asset].total++;
                assetStats[asset].totalPnL += trade.pnl || 0;

                if (trade.pnl > 0) {
                    assetStats[asset].wins++;
                }
            });

        // Calculate win rates
        Object.keys(assetStats).forEach((asset) => {
            const stats = assetStats[asset];
            stats.winRate =
                stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
            stats.avgPnL = stats.total > 0 ? stats.totalPnL / stats.total : 0;
        });

        return assetStats;
    }

    /**
     * Helper method: Calculate portfolio correlation
     */
    calculatePortfolioCorrelation(positions, prices) {
        if (!positions || positions.length === 0)
            return { correlation: 0, diversification: 100 };

        const totalValue = positions.reduce(
            (sum, pos) => sum + (pos.currentValue || 0),
            0
        );
        const weights = positions.map(
            (pos) => (pos.currentValue || 0) / totalValue
        );

        // Simple diversification score (Herfindahl-Hirschman Index)
        const hhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
        const diversificationScore =
            ((1 - hhi) / (1 - 1 / positions.length)) * 100;

        return {
            correlation: Math.round((1 - diversificationScore / 100) * 100),
            diversification: Math.round(diversificationScore),
            dominantAsset: positions.reduce(
                (max, pos) =>
                    (pos.currentValue || 0) > (max.currentValue || 0)
                        ? pos
                        : max,
                { symbol: "NONE", currentValue: 0 }
            ).symbol,
        };
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

            console.log("💾 Saving enhanced trade to database:", {
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

            console.log(`✅ Enhanced trade saved to database: ${trade.id}`);
        } catch (error) {
            console.error(
                "❌ Error saving enhanced trade to database:",
                error.message
            );
            // Don't throw error - continue operation without database
        }
    }

    /**
     * ENHANCED: Save signals to database with comprehensive error handling
     */
    async saveSignalsToDatabase(signals) {
        try {
            console.log("💾 Attempting to save enhanced signals to database:", {
                signalsCount: signals.length,
                firstSignal: signals[0]?.symbol || "none",
            });

            // Check if db is properly initialized
            if (!db || typeof db !== "function") {
                console.warn(
                    "⚠️ Database not available, skipping enhanced signals save"
                );
                return;
            }

            const signalRecords = signals
                .filter((signal) => {
                    const isValid = signal && signal.symbol && signal.signal;
                    if (!isValid) {
                        console.warn(
                            "⚠️ Filtering out invalid enhanced signal:",
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
                        console.log("📝 Enhanced signal record prepared:", {
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
                    `✅ ${signalRecords.length} enhanced signals saved to database successfully`
                );
            } else {
                console.warn("⚠️ No valid enhanced signal records to save");
            }
        } catch (error) {
            console.error(
                "❌ Error saving enhanced signals to database:",
                error.message
            );
            console.error("❌ Error stack:", error.stack);
            // Don't throw error - continue operation without database
        }
    }

    /**
     * Enhanced cleanup method
     */
    async cleanup() {
        console.log("🧹 Cleaning up Enhanced Trading Controller...");

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
        console.log("✅ Enhanced Trading Controller cleaned up");
    }
}

module.exports = TradingController;
