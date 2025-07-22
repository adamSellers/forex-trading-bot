// backend/src/routes/trading.js - Complete Enhanced Trading Routes
const express = require("express");
const router = express.Router();

// CRYPTO TRADING CONSTANTS - FIXED FOR 365 DAYS
const CRYPTO_TRADING_DAYS_PER_YEAR = 365; // Crypto trades 24/7/365

module.exports = (tradingController) => {
    // GET /api/trading/status - Get system status
    router.get("/status", async (req, res) => {
        try {
            const status = await tradingController.getStatus();
            res.json(status);
        } catch (error) {
            console.error("Status API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/portfolio - Get enhanced portfolio summary
    router.get("/portfolio", async (req, res) => {
        try {
            const portfolio = await tradingController.getPortfolio();
            res.json(portfolio);
        } catch (error) {
            console.error("Portfolio API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/signals - Get trading signals
    router.get("/signals", async (req, res) => {
        try {
            const signals = await tradingController.getSignals(req.query);
            res.json(signals);
        } catch (error) {
            console.error("Signals API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/trades - Get trade history
    router.get("/trades", async (req, res) => {
        try {
            const trades = await tradingController.getTrades(req.query); // This returns an array
            res.json(trades); // Directly send the array
        } catch (error) {
            console.error("Trades API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/prices - Get current prices
    router.get("/prices", async (req, res) => {
        try {
            const prices = await tradingController.getPrices();
            res.json(prices);
        } catch (error) {
            console.error("Prices API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/candles/:symbol/:timeframe - Get candle data
    router.get("/candles/:symbol/:timeframe", async (req, res) => {
        try {
            const { symbol, timeframe } = req.params;

            if (!tradingController.tradingService?.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not available" });
            }

            const candles =
                tradingController.tradingService.binanceData.getCandles(
                    symbol,
                    timeframe
                );
            res.json({
                symbol,
                timeframe,
                count: candles.length,
                candles: candles.slice(-300), // Return last 300 candles for better analysis
            });
        } catch (error) {
            console.error("Candles API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/account - Get enhanced account info with paper context
    router.get("/account", async (req, res) => {
        try {
            const account = await tradingController.getAccount();
            res.json(account);
        } catch (error) {
            console.error("Account API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/balances - Get crypto balances (alias for account)
    router.get("/balances", async (req, res) => {
        try {
            const account = await tradingController.getAccount();
            res.json(account.balances || []);
        } catch (error) {
            console.error("Balances API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // ================== ENHANCED ROUTES ==================

    // GET /api/trading/holdings - Get combined real + paper holdings
    router.get("/holdings", async (req, res) => {
        try {
            const holdings = await tradingController.getCombinedHoldings();
            res.json(holdings);
        } catch (error) {
            console.error("Holdings API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/paper-stats - Get detailed paper trading statistics
    router.get("/paper-stats", async (req, res) => {
        try {
            // FIX: Check if the active engine is in paper mode, not for a 'paperTrading' property.
            const engine = tradingController.tradingService?.activeEngine;
            if (!engine || engine.mode !== "paper") {
                return res
                    .status(400)
                    .json({ error: "Paper trading is not the active mode." });
            }

            // FIX: Access methods directly from the active engine.
            const paperPortfolio = engine.getPortfolioSummary();
            const paperTrades = engine.getRecentTrades(50);

            const stats = {
                portfolio: paperPortfolio,
                recentTrades: paperTrades,
                performance: paperPortfolio.performance,
                riskStatus: paperPortfolio.riskStatus,
                timestamp: Date.now(),
            };

            res.json(stats);
        } catch (error) {
            console.error("Paper stats API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/comparison - Real-time portfolio comparison
    router.get("/comparison", async (req, res) => {
        try {
            const { period = "7d" } = req.query;

            // FIX: Check if the active engine is in paper mode.
            const engine = tradingController.tradingService?.activeEngine;
            if (!engine || engine.mode !== "paper") {
                return res
                    .status(400)
                    .json({
                        error: "Paper trading is not the active mode for comparison.",
                    });
            }

            // Get paper trading performance
            // FIX: Access methods directly from the active engine.
            const paperPortfolio = engine.getPortfolioSummary();
            const paperTrades = engine.getRecentTrades(50);

            // Get real account value (calculated with current prices)
            const account =
                await tradingController.tradingService.binanceData.getAccountInfo();
            const prices =
                tradingController.tradingService.binanceData.getAllPrices();

            let realPortfolioValue = 0;
            const realAllocation = [];

            account.balances.forEach((balance) => {
                if (balance.total > 0) {
                    let value = 0;
                    if (balance.asset === "USDT") {
                        value = balance.total;
                    } else {
                        const symbol = `${balance.asset}USDT`;
                        const price = prices[symbol]?.price || 0;
                        value = balance.total * price;
                    }

                    realPortfolioValue += value;
                    realAllocation.push({
                        asset: balance.asset,
                        quantity: balance.total,
                        value: value,
                        percentage: 0, // Calculate after totals
                    });
                }
            });

            // Calculate real allocation percentages
            realAllocation.forEach((item) => {
                item.percentage =
                    realPortfolioValue > 0
                        ? (item.value / realPortfolioValue) * 100
                        : 0;
            });

            const comparison = {
                period,
                timestamp: Date.now(),
                real: {
                    value: realPortfolioValue,
                    change: 0, // Would need historical data to calculate
                    allocation: realAllocation,
                    description: "Your actual Binance holdings",
                },
                paper: {
                    value: paperPortfolio.totalValue,
                    change: paperPortfolio.totalPnLPercent,
                    allocation: [
                        {
                            asset: "USDT",
                            quantity: paperPortfolio.usdtBalance,
                            value: paperPortfolio.usdtBalance,
                            percentage:
                                (paperPortfolio.usdtBalance /
                                    paperPortfolio.totalValue) *
                                100,
                        },
                        ...paperPortfolio.positions.map((pos) => ({
                            asset: pos.symbol.replace("USDT", ""),
                            quantity: pos.quantity,
                            value: pos.currentValue || 0,
                            percentage:
                                ((pos.currentValue || 0) /
                                    paperPortfolio.totalValue) *
                                100,
                            unrealizedPnL: pos.unrealizedPnL || 0,
                            entryPrice: pos.avgPrice,
                        })),
                    ],
                    performance: paperPortfolio.performance,
                    description: "Virtual paper trading results",
                },
                analysis: {
                    paperOutperformance: paperPortfolio.totalPnLPercent,
                    riskTaken: {
                        daily:
                            (paperPortfolio.riskStatus.dailyLossUsed /
                                paperPortfolio.riskStatus.dailyLossLimit) *
                            100,
                        weekly:
                            (paperPortfolio.riskStatus.weeklyLossUsed /
                                paperPortfolio.riskStatus.weeklyLossLimit) *
                            100,
                    },
                    tradesExecuted: paperTrades.length,
                    winRate: paperPortfolio.performance.winRate,
                    profitFactor: paperPortfolio.performance.profitFactor,
                },
            };

            res.json(comparison);
        } catch (error) {
            console.error("Comparison API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/risk-status - Risk management status
    router.get("/risk-status", async (req, res) => {
        try {
            // FIX: Check for an active engine, as risk status applies to both modes.
            const engine = tradingController.tradingService?.activeEngine;
            if (!engine) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            const portfolio = await engine.getPortfolioSummary();
            const riskStatus = portfolio.riskStatus;

            const enhancedRiskStatus = {
                ...riskStatus,
                utilization: {
                    daily: {
                        used: riskStatus.dailyLossUsed,
                        limit: riskStatus.dailyLossLimit,
                        percentage:
                            (riskStatus.dailyLossUsed /
                                riskStatus.dailyLossLimit) *
                            100,
                        remaining:
                            riskStatus.dailyLossLimit -
                            riskStatus.dailyLossUsed,
                    },
                    weekly: {
                        used: riskStatus.weeklyLossUsed,
                        limit: riskStatus.weeklyLossLimit,
                        percentage:
                            (riskStatus.weeklyLossUsed /
                                riskStatus.weeklyLossLimit) *
                            100,
                        remaining:
                            riskStatus.weeklyLossLimit -
                            riskStatus.weeklyLossUsed,
                    },
                },
                portfolio: {
                    totalValue: portfolio.totalValue,
                    maxDrawdown: portfolio.performance.maxDrawdown,
                    currentDrawdown: portfolio.performance.currentDrawdown,
                    exposurePercentage:
                        (portfolio.cryptoValue / portfolio.totalValue) * 100,
                },
                positions: portfolio.positions.map((pos) => ({
                    symbol: pos.symbol,
                    riskAmount: (pos.entryCost || 0) * 0.01,
                    currentRisk: Math.max(
                        0,
                        (pos.entryCost || 0) - (pos.currentValue || 0)
                    ),
                    stopLossDistance:
                        pos.currentPrice && pos.stopLoss
                            ? ((pos.currentPrice - pos.stopLoss) /
                                  pos.currentPrice) *
                              100
                            : 0,
                })),
                alerts: {
                    nearDailyLimit:
                        riskStatus.dailyLossUsed / riskStatus.dailyLossLimit >
                        0.8,
                    nearWeeklyLimit:
                        riskStatus.weeklyLossUsed / riskStatus.weeklyLossLimit >
                        0.8,
                    highDrawdown: portfolio.performance.currentDrawdown > 15,
                    isHalted: riskStatus.isHalted,
                },
                timestamp: Date.now(),
            };

            res.json(enhancedRiskStatus);
        } catch (error) {
            console.error("Risk status API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // ================== CONFIGURATION ROUTES ==================

    // POST /api/trading/config - Update configuration
    router.post("/config", async (req, res) => {
        try {
            await tradingController.updateConfig(req.body);
            res.json({ success: true, message: "Configuration updated" });
        } catch (error) {
            console.error("Config update error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/trading/reset - Reset trading engine
    router.post("/reset", async (req, res) => {
        try {
            await tradingController.resetTrading();
            res.json({ success: true, message: "Trading engine reset" });
        } catch (error) {
            console.error("Reset error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/trading/start - Start trading
    router.post("/start", async (req, res) => {
        try {
            await tradingController.startTrading();
            res.json({ success: true, message: "Trading started" });
        } catch (error) {
            console.error("Start trading error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/trading/stop - Stop trading
    router.post("/stop", async (req, res) => {
        try {
            await tradingController.stopTrading();
            res.json({ success: true, message: "Trading stopped" });
        } catch (error) {
            console.error("Stop trading error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // POST /api/trading/test-signal - Generate test signal
    router.post("/test-signal", async (req, res) => {
        try {
            const {
                symbol = "BTCUSDT",
                signal = "BUY",
                strength = 1.5,
            } = req.body;

            const testSignal = {
                symbol,
                signal,
                strength,
                strategy: "test",
                timeframe: "1h",
                currentPrice: 67000,
                message: "Test signal generated via API",
                timestamp: Date.now(),
            };

            // FIX: Check if the active engine is in paper mode.
            const engine = tradingController.tradingService?.activeEngine;
            if (engine && engine.mode === "paper") {
                const result = await engine.processSignal(
                    testSignal,
                    67000,
                    500
                );
                res.json({ success: true, signal: testSignal, result });
            } else {
                res.json({
                    success: true,
                    signal: testSignal,
                    result: { message: "Paper trading not active" },
                });
            }
        } catch (error) {
            console.error("Test signal error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // ================== ANALYTICS ROUTES ==================

    // GET /api/trading/performance - Get detailed performance metrics
    router.get("/performance", async (req, res) => {
        try {
            const { period = "30d" } = req.query; // Default to 30d for better stats

            // FIX: Check for an active engine, as performance applies to both modes.
            const engine = tradingController.tradingService?.activeEngine;
            if (!engine) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            // FIX: Fetch trades for the currently active mode.
            const periodMs = parsePeriod(period);
            const cutoffTime = new Date(Date.now() - periodMs);
            const trades =
                await tradingController.tradingService.tradeRepo.getTradesSince(
                    cutoffTime,
                    engine.mode // Use the engine's current mode ('paper' or 'live')
                );
            const portfolio = await engine.getPortfolioSummary();

            // Calculate additional metrics
            const tradeReturns = getTradeReturns(trades);
            const tradingFrequency = calculateTradingFrequency(trades, period); // FIX: Pass period
            const sharpeRatio = calculateSharpeRatio(
                tradeReturns,
                tradingFrequency
            );
            const volatility = calculateVolatility(
                tradeReturns,
                tradingFrequency
            );

            const performance = {
                ...portfolio.performance,
                sharpeRatio,
                volatility,
                totalReturn: portfolio.totalPnLPercent,
                totalTrades: trades.length,
                avgHoldingPeriod: calculateAvgHoldingPeriod(trades),
                bestTrade: getBestTrade(trades),
                worstTrade: getWorstTrade(trades),
                tradingFrequency: tradingFrequency, // Use the calculated frequency

                // Metadata about the calculation
                calculationNotes: {
                    tradingDaysPerYear: CRYPTO_TRADING_DAYS_PER_YEAR,
                    note: "Crypto markets trade 365 days/year, 24/7",
                },
            };

            res.json(performance);
        } catch (error) {
            console.error("Performance API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/analytics - Get detailed analytics
    router.get("/analytics", async (req, res) => {
        try {
            const { period = "7d" } = req.query;

            // FIX: Check for the existence of the core services, not just paperTrading.
            // This makes the route work in both 'live' and 'paper' modes.
            if (
                !tradingController.tradingService?.activeEngine ||
                !tradingController.tradingService?.signalGenerator ||
                !tradingController.tradingService?.binanceData
            ) {
                return res
                    .status(400)
                    .json({ error: "Services not initialized" });
            }

            const periodMs = parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            // FIXED: Fetch data directly from the database repositories to ensure persistence
            const trades =
                await tradingController.tradingService.tradeRepo.getTradesSince(
                    cutoffTime
                );
            const signals =
                await tradingController.tradingService.signalRepo.getSignalsSince(
                    cutoffTime
                );

            // A "trade" for analytics purposes is a completed round trip, represented by a SELL order.
            // Filter for sell trades to get accurate metrics for the overview.
            const sellTrades = trades.filter((t) => t.side === "SELL");

            // Analyze by asset
            const assetAnalysis = analyzeByAsset(trades, signals); // The helper function will handle its own filtering

            // Analyze by strategy
            const strategyAnalysis = analyzeByStrategy(signals);

            // Time-based analysis
            const timeAnalysis = analyzeByTime(trades, signals); // This correctly shows all activity (BUY/SELL)

            // Exit reason analysis
            const exitReasonAnalysis = analyzeExitReasons(trades);

            const analytics = {
                period,
                timeRange: {
                    start: new Date(cutoffTime).toISOString(),
                    end: new Date().toISOString(),
                },
                overview: {
                    totalTrades: sellTrades.length,
                    totalSignals: signals.length,
                    signalToTradeRatio:
                        sellTrades.length / (signals.length || 1),
                    profitableTrades: sellTrades.filter((t) => t.pnl > 0)
                        .length,
                    totalPnL: sellTrades.reduce(
                        (sum, t) => sum + (t.pnl || 0),
                        0
                    ),
                },
                assetAnalysis,
                strategyAnalysis,
                timeAnalysis,
                exitReasonAnalysis,
            };

            res.json(analytics);
        } catch (error) {
            console.error("Analytics API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // ================== HELPER FUNCTIONS ==================

    function parsePeriod(period) {
        const periods = {
            "1h": 3600000,
            "4h": 14400000,
            "1d": 86400000,
            "7d": 604800000,
            "30d": 2592000000,
            "90d": 7776000000,
        };
        return periods[period] || periods["7d"];
    }

    function getTradeReturns(trades) {
        const sellTrades = trades.filter(
            (t) => t.side === "SELL" && t.pnl !== undefined
        );
        return sellTrades.map((t) => t.pnlPercent || 0);
    }

    /**
     * Calculates the annualized Sharpe Ratio from a series of trade returns.
     * It's annualized using the trading frequency.
     * @param {number[]} returns - Array of percentage returns per trade.
     * @param {number} tradingFrequency - Trades per day.
     * @returns {number} The annualized Sharpe Ratio.
     */
    function calculateSharpeRatio(returns, tradingFrequency) {
        if (returns.length < 2) return 0;

        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return 0;

        const perTradeSharpe = avgReturn / stdDev;

        // Only annualize if we have a valid trading frequency.
        if (tradingFrequency > 0) {
            const tradesPerYear =
                tradingFrequency * CRYPTO_TRADING_DAYS_PER_YEAR;
            const annualizationFactor = Math.sqrt(tradesPerYear);
            return perTradeSharpe * annualizationFactor;
        }

        // Return the raw, per-trade Sharpe ratio if frequency is not available.
        return perTradeSharpe;
    }

    /**
     * Calculates the annualized volatility from a series of trade returns.
     * @param {number[]} returns - Array of percentage returns per trade.
     * @param {number} tradingFrequency - Trades per day.
     * @returns {number} The annualized volatility.
     */
    function calculateVolatility(returns, tradingFrequency) {
        if (returns.length < 2) return 0;
        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);
        const stdDev = Math.sqrt(variance);

        // Only annualize if we have a valid trading frequency.
        if (tradingFrequency > 0) {
            const tradesPerYear =
                tradingFrequency * CRYPTO_TRADING_DAYS_PER_YEAR;
            return stdDev * Math.sqrt(tradesPerYear);
        }

        // Return the raw, per-trade standard deviation if frequency is not available.
        return stdDev;
    }

    function calculateAvgHoldingPeriod(trades) {
        const sellTrades = trades.filter(
            (t) => t.side === "SELL" && t.holdingPeriod
        );
        if (sellTrades.length === 0) return 0;
        const totalTime = sellTrades.reduce(
            (sum, t) => sum + t.holdingPeriod,
            0
        );
        return totalTime / sellTrades.length;
    }

    function getBestTrade(trades) {
        const sellTrades = trades.filter(
            (t) => t.side === "SELL" && t.pnl !== undefined
        );
        if (sellTrades.length === 0) return null;
        return sellTrades.reduce((best, trade) =>
            trade.pnl > (best?.pnl || -Infinity) ? trade : best
        );
    }

    function getWorstTrade(trades) {
        const sellTrades = trades.filter(
            (t) => t.side === "SELL" && t.pnl !== undefined
        );
        if (sellTrades.length === 0) return null;
        return sellTrades.reduce((worst, trade) =>
            trade.pnl < (worst?.pnl || Infinity) ? trade : worst
        );
    }

    function calculateTradingFrequency(trades, period) {
        // BUG FIX: Frequency should be based on completed (SELL) trades, not all transactions.
        const sellTrades = trades.filter((t) => t.side === "SELL");
        if (sellTrades.length < 2) return 0;

        // FIX: Use the full period duration for a more accurate frequency calculation,
        // instead of just the time between the first and last trade.
        const periodMapping = {
            "1h": 1 / 24, // Add smaller periods
            "4h": 4 / 24,
            "1d": 1,
            "7d": 7,
            "30d": 30,
            "90d": 90,
        };
        const days = periodMapping[period] || 30; // Default to 30 days
        if (days <= 0) return 0;

        // Return trades per day.
        return sellTrades.length / days;
    }

    function analyzeByAsset(trades, signals) {
        const assets = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"];
        const analysis = {};

        assets.forEach((asset) => {
            const assetSellTrades = trades.filter(
                (t) => t.symbol === asset && t.side === "SELL"
            );
            const assetSignals = signals.filter((s) => s.symbol === asset);

            analysis[asset] = {
                totalTrades: assetSellTrades.length, // FIX: Count only completed (sell) trades
                totalSignals: assetSignals.length,
                pnl: assetSellTrades.reduce((sum, t) => sum + (t.pnl || 0), 0),
                winRate:
                    assetSellTrades.length > 0
                        ? (assetSellTrades.filter((t) => t.pnl > 0).length /
                              assetSellTrades.length) *
                          100
                        : 0,
                avgSignalStrength:
                    assetSignals.length > 0
                        ? assetSignals.reduce(
                              (sum, s) => sum + (s.strength || 0),
                              0
                          ) / assetSignals.length
                        : 0,
            };
        });

        return analysis;
    }

    function analyzeByStrategy(signals) {
        const strategies = ["conservative", "balanced", "responsive"];
        const analysis = {};

        strategies.forEach((strategy) => {
            const strategySignals = signals.filter(
                (s) => s.strategy === strategy
            );
            const buySignals = strategySignals.filter((s) =>
                s.signal.includes("BUY")
            );
            const sellSignals = strategySignals.filter((s) =>
                s.signal.includes("SELL")
            );

            analysis[strategy] = {
                totalSignals: strategySignals.length,
                buySignals: buySignals.length,
                sellSignals: sellSignals.length,
                avgStrength:
                    strategySignals.length > 0
                        ? strategySignals.reduce(
                              (sum, s) => sum + (s.strength || 0),
                              0
                          ) / strategySignals.length
                        : 0,
                strongSignals: strategySignals.filter((s) => s.strength > 2)
                    .length,
            };
        });

        return analysis;
    }

    function analyzeExitReasons(trades) {
        const sellTrades = trades.filter((t) => t.side === "SELL");
        const analysis = {};

        sellTrades.forEach((trade) => {
            const reason = trade.exitReason || "UNKNOWN";
            if (!analysis[reason]) {
                analysis[reason] = { count: 0, totalPnL: 0 };
            }
            analysis[reason].count++;
            analysis[reason].totalPnL += trade.pnl || 0;
        });

        // Calculate average PnL
        for (const reason in analysis) {
            analysis[reason].avgPnL =
                analysis[reason].count > 0
                    ? analysis[reason].totalPnL / analysis[reason].count
                    : 0;
        }

        return analysis;
    }

    function analyzeByTime(trades, signals) {
        // Initialize separate counters
        const hourlyTrades = new Array(24).fill(0);
        const hourlySignals = new Array(24).fill(0);
        const dailyTrades = new Array(7).fill(0);
        const dailySignals = new Array(7).fill(0);

        trades.forEach((item) => {
            const date = new Date(item.timestamp);
            const hour = date.getUTCHours(); // Use UTC for consistency
            const day = date.getUTCDay();
            hourlyTrades[hour]++;
            dailyTrades[day]++;
        });

        signals.forEach((item) => {
            const date = new Date(item.timestamp);
            const hour = date.getUTCHours(); // Use UTC for consistency
            const day = date.getUTCDay();
            hourlySignals[hour]++;
            dailySignals[day]++;
        });

        // Combine into a single structure for the frontend
        const hourlyDistribution = hourlyTrades.map((tradeCount, hour) => ({
            hour,
            label: `${hour}:00`,
            trades: tradeCount,
            signals: hourlySignals[hour],
        }));

        const dailyDistribution = dailyTrades.map((tradeCount, day) => ({
            day,
            label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day],
            trades: tradeCount,
            signals: dailySignals[day],
        }));

        return {
            hourlyDistribution,
            dailyDistribution,
            peakHour: hourlyDistribution
                .map((h) => h.trades + h.signals)
                .indexOf(
                    Math.max(
                        ...hourlyDistribution.map((h) => h.trades + h.signals)
                    )
                ),
            peakDay: dailyDistribution
                .map((d) => d.trades + d.signals)
                .indexOf(
                    Math.max(
                        ...dailyDistribution.map((d) => d.trades + d.signals)
                    )
                ),
        };
    }

    // Error handling middleware
    router.use((error, req, res, next) => {
        console.error("Trading API Error:", error);
        res.status(500).json({
            error: "Internal server error",
            message: error.message,
            timestamp: new Date().toISOString(),
        });
    });

    return router;
};
