// backend/src/routes/trading.js - Complete Enhanced Trading Routes
const express = require("express");
const router = express.Router();

module.exports = (tradingController) => {
    // ================== BASIC ROUTES ==================

    // GET /api/trading/status - Get system status
    router.get("/status", (req, res) => {
        tradingController.getStatus(req, res);
    });

    // GET /api/trading/portfolio - Get enhanced portfolio summary
    router.get("/portfolio", (req, res) => {
        tradingController.getPortfolio(req, res);
    });

    // GET /api/trading/signals - Get trading signals
    router.get("/signals", (req, res) => {
        tradingController.getSignals(req, res);
    });

    // GET /api/trading/trades - Get trade history
    router.get("/trades", (req, res) => {
        tradingController.getTrades(req, res);
    });

    // GET /api/trading/prices - Get current prices
    router.get("/prices", (req, res) => {
        tradingController.getPrices(req, res);
    });

    // GET /api/trading/candles/:symbol/:timeframe - Get candle data
    router.get("/candles/:symbol/:timeframe", (req, res) => {
        tradingController.getCandles(req, res);
    });

    // GET /api/trading/account - Get enhanced account info with paper context
    router.get("/account", (req, res) => {
        tradingController.getAccount(req, res);
    });

    // GET /api/trading/balances - Get crypto balances
    router.get("/balances", (req, res) => {
        tradingController.getBalances(req, res);
    });

    // ================== ENHANCED ROUTES ==================

    // NEW: Get combined real + paper holdings
    router.get("/holdings", (req, res) => {
        tradingController.getCombinedHoldings(req, res);
    });

    // NEW: Get detailed paper trading statistics
    router.get("/paper-stats", (req, res) => {
        tradingController.getPaperTradingStats(req, res);
    });

    // NEW: Real-time portfolio comparison
    router.get("/comparison", async (req, res) => {
        try {
            const { period = "7d" } = req.query;

            if (!tradingController.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Paper trading not initialized" });
            }

            // Get paper trading performance
            const paperPortfolio =
                tradingController.services.paperTrading.getPortfolioSummary();
            const paperTrades =
                tradingController.services.paperTrading.getRecentTrades(50);

            // Get real account value (calculated with current prices)
            const account =
                await tradingController.services.binanceData.getAccountInfo();
            const prices =
                tradingController.services.binanceData.getAllPrices();

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
                        // USDT Balance
                        {
                            asset: "USDT",
                            quantity: paperPortfolio.usdtBalance,
                            value: paperPortfolio.usdtBalance,
                            percentage:
                                (paperPortfolio.usdtBalance /
                                    paperPortfolio.totalValue) *
                                100,
                        },
                        // Crypto Positions
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
                    paperOutperformance: paperPortfolio.totalPnLPercent, // vs 0% for real (no tracking)
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

    // NEW: Historical performance tracking
    router.get("/history/:type", async (req, res) => {
        try {
            const { type } = req.params; // 'portfolio', 'trades', 'signals', 'performance'
            const { period = "30d", limit = 100 } = req.query;

            const periodMs = parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            let data = [];

            switch (type) {
                case "portfolio":
                    // Get portfolio snapshots from database
                    try {
                        const db = require("../../config/database");
                        data = await db("portfolio")
                            .where("snapshot_time", ">=", new Date(cutoffTime))
                            .orderBy("snapshot_time", "desc")
                            .limit(limit);
                    } catch (dbError) {
                        console.warn(
                            "Database not available for portfolio history"
                        );
                        data = [];
                    }
                    break;

                case "trades":
                    data = tradingController.services.paperTrading.tradeHistory
                        .filter((trade) => trade.timestamp >= cutoffTime)
                        .slice(-limit);
                    break;

                case "signals":
                    data =
                        tradingController.services.signalGenerator.signalHistory
                            .filter((signal) => signal.timestamp >= cutoffTime)
                            .slice(-limit);
                    break;

                case "performance":
                    // Get performance metrics over time
                    try {
                        const db = require("../../config/database");
                        data = await db("performance")
                            .where("calculated_at", ">=", new Date(cutoffTime))
                            .orderBy("calculated_at", "desc")
                            .limit(limit);
                    } catch (dbError) {
                        console.warn(
                            "Database not available for performance history"
                        );
                        data = [];
                    }
                    break;

                default:
                    return res
                        .status(400)
                        .json({ error: "Invalid history type" });
            }

            res.json({
                type,
                period,
                count: data.length,
                data: data.reverse(), // Return chronological order
            });
        } catch (error) {
            console.error("History API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // NEW: Risk management status
    router.get("/risk-status", (req, res) => {
        try {
            if (!tradingController.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Paper trading not initialized" });
            }

            const portfolio =
                tradingController.services.paperTrading.getPortfolioSummary();
            const riskStatus = portfolio.riskStatus;

            const enhancedRiskStatus = {
                ...riskStatus,

                // Risk utilization metrics
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

                // Portfolio risk metrics
                portfolio: {
                    totalValue: portfolio.totalValue,
                    maxDrawdown: portfolio.performance.maxDrawdown,
                    currentDrawdown: portfolio.performance.currentDrawdown,
                    exposurePercentage:
                        (portfolio.cryptoValue / portfolio.totalValue) * 100,
                },

                // Position risk
                positions: portfolio.positions.map((pos) => ({
                    symbol: pos.symbol,
                    riskAmount: (pos.entryCost || 0) * 0.01, // 1% of entry cost
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

                // Risk alerts
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
    router.post("/config", (req, res) => {
        tradingController.updateConfig(req, res);
    });

    // POST /api/trading/reset - Reset trading engine
    router.post("/reset", (req, res) => {
        tradingController.resetTrading(req, res);
    });

    // POST /api/trading/start - Start trading
    router.post("/start", (req, res) => {
        tradingController.startTrading(req, res);
    });

    // POST /api/trading/stop - Stop trading
    router.post("/stop", (req, res) => {
        tradingController.stopTrading(req, res);
    });

    // POST /api/trading/test-signal - Generate test signal
    router.post("/test-signal", (req, res) => {
        tradingController.generateTestSignalAPI(req, res);
    });

    // ================== ANALYTICS ROUTES ==================

    // GET /api/trading/performance - Get detailed performance metrics
    router.get("/performance", async (req, res) => {
        try {
            if (!tradingController.services.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            const portfolio =
                tradingController.services.paperTrading.getPortfolioSummary();
            const trades =
                tradingController.services.paperTrading.getRecentTrades(100);

            // Calculate additional metrics
            const dailyReturns = calculateDailyReturns(trades);
            const sharpeRatio = calculateSharpeRatio(dailyReturns);
            const volatility = calculateVolatility(dailyReturns);

            const performance = {
                ...portfolio.performance,
                sharpeRatio,
                volatility,
                totalReturn: portfolio.totalPnLPercent,
                totalTrades: trades.length,
                avgHoldingPeriod: calculateAvgHoldingPeriod(trades),
                bestTrade: getBestTrade(trades),
                worstTrade: getWorstTrade(trades),
                tradingFrequency: calculateTradingFrequency(trades),
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

            if (
                !tradingController.services.paperTrading ||
                !tradingController.services.signalGenerator
            ) {
                return res
                    .status(400)
                    .json({ error: "Services not initialized" });
            }

            const periodMs = parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            // Get data for the specified period
            const trades =
                tradingController.services.paperTrading.tradeHistory.filter(
                    (trade) => trade.timestamp >= cutoffTime
                );

            const signals =
                tradingController.services.signalGenerator.signalHistory.filter(
                    (signal) => signal.timestamp >= cutoffTime
                );

            // Analyze by asset
            const assetAnalysis = analyzeByAsset(trades, signals);

            // Analyze by strategy
            const strategyAnalysis = analyzeByStrategy(signals);

            // Time-based analysis
            const timeAnalysis = analyzeByTime(trades, signals);

            const analytics = {
                period,
                timeRange: {
                    start: new Date(cutoffTime).toISOString(),
                    end: new Date().toISOString(),
                },
                overview: {
                    totalTrades: trades.length,
                    totalSignals: signals.length,
                    signalToTradeRatio: trades.length / (signals.length || 1),
                    profitableTrades: trades.filter((t) => t.pnl > 0).length,
                    totalPnL: trades.reduce((sum, t) => sum + (t.pnl || 0), 0),
                },
                assetAnalysis,
                strategyAnalysis,
                timeAnalysis,
            };

            res.json(analytics);
        } catch (error) {
            console.error("Analytics API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/test-candles - Test candle data loading
    router.get("/test-candles", async (req, res) => {
        try {
            if (!tradingController.services.binanceData) {
                return res
                    .status(400)
                    .json({ error: "Binance service not initialized" });
            }

            const testResults = {};
            const assets = ["BTCUSDT"];
            const timeframes = ["1h"];

            for (const asset of assets) {
                for (const timeframe of timeframes) {
                    try {
                        console.log(`🧪 Testing ${asset} ${timeframe}...`);

                        const candles =
                            await tradingController.services.binanceData.getHistoricalCandles(
                                asset,
                                timeframe,
                                10
                            );

                        testResults[`${asset}_${timeframe}`] = {
                            success: true,
                            candleCount: candles.length,
                            firstCandle: candles[0],
                            lastCandle: candles[candles.length - 1],
                        };
                    } catch (error) {
                        testResults[`${asset}_${timeframe}`] = {
                            success: false,
                            error: error.message,
                        };
                    }
                }
            }

            res.json({
                message: "Candle loading test complete",
                results: testResults,
                cacheStatus: {
                    totalCandleDatasets:
                        tradingController.services.binanceData.candleCache.size,
                    priceCache:
                        tradingController.services.binanceData.priceCache.size,
                },
            });
        } catch (error) {
            console.error("Test candles API error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // ================== HELPER FUNCTIONS ==================

    // Helper function for parsing period
    function parsePeriod(period) {
        const periods = {
            "1h": 60 * 60 * 1000,
            "4h": 4 * 60 * 60 * 1000,
            "1d": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000,
            "90d": 90 * 24 * 60 * 60 * 1000,
        };
        return periods[period] || periods["7d"];
    }

    function calculateDailyReturns(trades) {
        const sellTrades = trades.filter(
            (t) => t.side === "SELL" && t.pnl !== undefined
        );
        return sellTrades.map((t) => t.pnlPercent || 0);
    }

    function calculateSharpeRatio(returns) {
        if (returns.length < 2) return 0;

        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);
        const stdDev = Math.sqrt(variance);

        return stdDev === 0 ? 0 : (avgReturn / stdDev) * Math.sqrt(252); // Annualized
    }

    function calculateVolatility(returns) {
        if (returns.length < 2) return 0;

        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);

        return Math.sqrt(variance) * Math.sqrt(252); // Annualized
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

    function calculateTradingFrequency(trades) {
        if (trades.length < 2) return 0;

        const timeSpan =
            trades[trades.length - 1].timestamp - trades[0].timestamp;
        const days = timeSpan / (24 * 60 * 60 * 1000);

        return trades.length / (days || 1);
    }

    function analyzeByAsset(trades, signals) {
        const assets = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"];
        const analysis = {};

        assets.forEach((asset) => {
            const assetTrades = trades.filter((t) => t.symbol === asset);
            const assetSignals = signals.filter((s) => s.symbol === asset);
            const sellTrades = assetTrades.filter((t) => t.side === "SELL");

            analysis[asset] = {
                totalTrades: assetTrades.length,
                totalSignals: assetSignals.length,
                pnl: sellTrades.reduce((sum, t) => sum + (t.pnl || 0), 0),
                winRate:
                    sellTrades.length > 0
                        ? (sellTrades.filter((t) => t.pnl > 0).length /
                              sellTrades.length) *
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

    function analyzeByTime(trades, signals) {
        const hourlyDistribution = new Array(24).fill(0);
        const dailyDistribution = new Array(7).fill(0);

        [...trades, ...signals].forEach((item) => {
            const date = new Date(item.timestamp);
            const hour = date.getHours();
            const day = date.getDay();

            hourlyDistribution[hour]++;
            dailyDistribution[day]++;
        });

        return {
            hourlyDistribution: hourlyDistribution.map((count, hour) => ({
                hour,
                count,
                label: `${hour}:00`,
            })),
            dailyDistribution: dailyDistribution.map((count, day) => ({
                day,
                count,
                label: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day],
            })),
            peakHour: hourlyDistribution.indexOf(
                Math.max(...hourlyDistribution)
            ),
            peakDay: dailyDistribution.indexOf(Math.max(...dailyDistribution)),
        };
    }

    // Helper middleware for error handling
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
