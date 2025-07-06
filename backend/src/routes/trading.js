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
            if (!tradingController.tradingService?.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Paper trading not initialized" });
            }

            const paperPortfolio =
                tradingController.tradingService.paperTrading.getPortfolioSummary();
            const paperTrades =
                tradingController.tradingService.paperTrading.getRecentTrades(
                    50
                );

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

            if (!tradingController.tradingService?.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Paper trading not initialized" });
            }

            // Get paper trading performance
            const paperPortfolio =
                tradingController.tradingService.paperTrading.getPortfolioSummary();
            const paperTrades =
                tradingController.tradingService.paperTrading.getRecentTrades(
                    50
                );

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
            if (!tradingController.tradingService?.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Paper trading not initialized" });
            }

            const portfolio =
                tradingController.tradingService.paperTrading.getPortfolioSummary();
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

            // Process the test signal if paper trading is active
            if (tradingController.tradingService?.paperTrading) {
                const result =
                    await tradingController.tradingService.paperTrading.processSignal(
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
            if (!tradingController.tradingService?.paperTrading) {
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });
            }

            const portfolio =
                tradingController.tradingService.paperTrading.getPortfolioSummary();
            const trades =
                tradingController.tradingService.paperTrading.getRecentTrades(
                    100
                );

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

            if (
                !tradingController.tradingService?.paperTrading ||
                !tradingController.tradingService?.signalGenerator
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

    // ================== HELPER FUNCTIONS ==================

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

    // FIXED: Crypto Sharpe Ratio calculation (365 days)
    function calculateSharpeRatio(returns) {
        if (returns.length < 2) return 0;
        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);
        const stdDev = Math.sqrt(variance);
        // FIXED: Use 365 days for crypto markets, not 252
        return stdDev === 0
            ? 0
            : (avgReturn / stdDev) * Math.sqrt(CRYPTO_TRADING_DAYS_PER_YEAR);
    }

    // FIXED: Crypto Volatility calculation (365 days)
    function calculateVolatility(returns) {
        if (returns.length < 2) return 0;
        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);
        // FIXED: Use 365 days for crypto markets, not 252
        return Math.sqrt(variance) * Math.sqrt(CRYPTO_TRADING_DAYS_PER_YEAR);
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
