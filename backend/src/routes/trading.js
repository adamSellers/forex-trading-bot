// backend/src/routes/trading.js - LIVE PRODUCTION (NO PAPER TRADING)
const express = require("express");
const router = express.Router();

// CRYPTO TRADING CONSTANTS
const CRYPTO_TRADING_DAYS_PER_YEAR = 365;

module.exports = (tradingController) => {
    // ================== SYSTEM & STATUS ==================

    // GET /api/trading/status - System Health
    router.get("/status", async (req, res) => {
        try {
            res.json(await tradingController.getStatus());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/trading/account - Binance Account Info (Balances)
    router.get("/account", async (req, res) => {
        try {
            res.json(await tradingController.getAccount());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/trading/balances - Alias for Account
    router.get("/balances", async (req, res) => {
        try {
            const account = await tradingController.getAccount();
            res.json(account.balances || []);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ================== LIVE TRADING OPERATIONS ==================

    // GET /api/trading/portfolio - Live Portfolio Summary
    router.get("/portfolio", async (req, res) => {
        try {
            res.json(await tradingController.getPortfolio());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/trading/trades - Live Trade History
    router.get("/trades", async (req, res) => {
        try {
            res.json(await tradingController.getTrades(req.query));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/trading/signals - Signal History
    router.get("/signals", async (req, res) => {
        try {
            res.json(await tradingController.getSignals(req.query));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/trading/close/:id - Panic Button (Force Sell)
    router.post("/close/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const result = await tradingController.manualCloseTrade(id);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ================== DATA FEED ==================

    // GET /api/trading/prices - Current Market Prices
    router.get("/prices", async (req, res) => {
        try {
            res.json(await tradingController.getPrices());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/trading/candles/:symbol/:timeframe
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
                candles: candles.slice(-300),
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ================== ANALYTICS (FIXED FOR CLOSED TRADES) ==================

    // GET /api/trading/performance - Detailed Stats (Sharpe, Volatility, etc.)
    router.get("/performance", async (req, res) => {
        try {
            const { period = "30d" } = req.query;
            const engine = tradingController.tradingService?.activeEngine;

            if (!engine)
                return res
                    .status(400)
                    .json({ error: "Trading engine not initialized" });

            const periodMs = parsePeriod(period);
            const cutoffTime = new Date(Date.now() - periodMs);

            // Fetch LIVE trades only
            const trades =
                await tradingController.tradingService.tradeRepo.getTradesSince(
                    cutoffTime,
                    "live"
                );
            const portfolio = await engine.getPortfolioSummary();

            // FIX: Filter for completed trades correctly (Status=CLOSED or PnL exists)
            const completedTrades = trades.filter(
                (t) =>
                    t.status === "CLOSED" ||
                    (t.pnl !== null && t.pnl !== undefined)
            );

            const tradeReturns = getTradeReturns(completedTrades);
            const tradingFrequency = calculateTradingFrequency(
                completedTrades,
                period
            );
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
                totalTrades: completedTrades.length,
                avgHoldingPeriod: calculateAvgHoldingPeriod(completedTrades),
                bestTrade: getBestTrade(completedTrades),
                worstTrade: getWorstTrade(completedTrades),
                tradingFrequency,
                calculationNotes: {
                    tradingDaysPerYear: CRYPTO_TRADING_DAYS_PER_YEAR,
                    note: "Crypto markets trade 365 days/year, 24/7",
                },
            };

            res.json(performance);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/trading/analytics - Dashboard Data
    router.get("/analytics", async (req, res) => {
        try {
            const { period = "7d" } = req.query;
            if (!tradingController.tradingService?.activeEngine) {
                return res
                    .status(400)
                    .json({ error: "Services not initialized" });
            }

            const periodMs = parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            const trades =
                await tradingController.tradingService.tradeRepo.getTradesSince(
                    cutoffTime
                );
            const signals =
                await tradingController.tradingService.signalRepo.getSignalsSince(
                    cutoffTime
                );

            // FIX: Identify Completed Trades properly (Status=CLOSED or PnL exists)
            const completedTrades = trades.filter(
                (t) =>
                    t.status === "CLOSED" ||
                    (t.pnl !== null && t.pnl !== undefined && t.pnl !== 0)
            );

            // Analyze
            const assetAnalysis = analyzeByAsset(trades, signals);
            const strategyAnalysis = analyzeByStrategy(signals);
            const timeAnalysis = analyzeByTime(trades, signals);
            const exitReasonAnalysis = analyzeExitReasons(trades);

            const totalPnL = completedTrades.reduce(
                (sum, t) => sum + (t.pnl || 0),
                0
            );
            const winCount = completedTrades.filter((t) => t.pnl > 0).length;

            const analytics = {
                period,
                timeRange: {
                    start: new Date(cutoffTime).toISOString(),
                    end: new Date().toISOString(),
                },
                overview: {
                    totalTrades: completedTrades.length,
                    totalSignals: signals.length,
                    signalToTradeRatio:
                        completedTrades.length / (signals.length || 1),
                    profitableTrades: winCount,
                    totalPnL: totalPnL,
                    winRate:
                        completedTrades.length > 0
                            ? (winCount / completedTrades.length) * 100
                            : 0,
                    avgWin: calculateAvgWin(completedTrades),
                    avgLoss: calculateAvgLoss(completedTrades),
                    profitFactor: calculateProfitFactor(completedTrades),
                },
                assetAnalysis,
                strategyAnalysis,
                timeAnalysis,
                exitReasonAnalysis,
            };

            res.json(analytics);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ================== CONTROL & CONFIG ==================

    router.post("/config", async (req, res) => {
        try {
            await tradingController.updateConfig(req.body);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post("/reset", async (req, res) => {
        try {
            await tradingController.resetTrading();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post("/start", async (req, res) => {
        try {
            await tradingController.startTrading();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post("/stop", async (req, res) => {
        try {
            await tradingController.stopTrading();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/trading/test-signal - DRY RUN ONLY (No Execution)
    router.post("/test-signal", async (req, res) => {
        try {
            const {
                symbol = "BTCUSDT",
                signal = "BUY",
                strength = 1.5,
            } = req.body;
            const engine = tradingController.tradingService?.activeEngine;

            if (!engine)
                return res.status(400).json({ error: "Engine not ready" });

            const priceData =
                tradingController.tradingService.binanceData.getCurrentPrice(
                    symbol
                );
            const currentPrice = priceData ? priceData.price : 60000;

            // Log the test but DO NOT EXECUTE
            const testSignal = {
                symbol,
                signal,
                strength,
                strategy: "manual_test",
                timeframe: "1h",
                currentPrice,
                timestamp: Date.now(),
                isDryRun: true,
            };

            res.json({
                success: true,
                mode: "DRY_RUN",
                message:
                    "Signal generated but NOT executed (Live Mode Safety).",
                signal: testSignal,
                projectedEntry: currentPrice,
                // Calculate hypothetical stop loss for display
                projectedStopLoss:
                    signal === "BUY"
                        ? currentPrice * 0.95
                        : currentPrice * 1.05,
            });
        } catch (error) {
            console.error("Test signal error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // ================== HELPER FUNCTIONS ==================

    function parsePeriod(period) {
        const periods = {
            "1h": 3600000,
            "24h": 86400000,
            "7d": 604800000,
            "30d": 2592000000,
            "90d": 7776000000,
        };
        return periods[period] || periods["7d"];
    }

    function getTradeReturns(trades) {
        return trades.map((t) => t.pnlPercent || 0);
    }

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
        if (tradingFrequency > 0) {
            return (
                perTradeSharpe *
                Math.sqrt(tradingFrequency * CRYPTO_TRADING_DAYS_PER_YEAR)
            );
        }
        return perTradeSharpe;
    }

    function calculateVolatility(returns, tradingFrequency) {
        if (returns.length < 2) return 0;
        const avgReturn =
            returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1);
        const stdDev = Math.sqrt(variance);
        if (tradingFrequency > 0) {
            return (
                stdDev *
                Math.sqrt(tradingFrequency * CRYPTO_TRADING_DAYS_PER_YEAR)
            );
        }
        return stdDev;
    }

    function calculateAvgHoldingPeriod(trades) {
        const validTrades = trades.filter((t) => t.holdingPeriod);
        if (validTrades.length === 0) return 0;
        return (
            validTrades.reduce((sum, t) => sum + t.holdingPeriod, 0) /
            validTrades.length
        );
    }

    function getBestTrade(trades) {
        if (trades.length === 0) return null;
        return trades.reduce((best, t) =>
            t.pnl > (best?.pnl || -Infinity) ? t : best
        );
    }

    function getWorstTrade(trades) {
        if (trades.length === 0) return null;
        return trades.reduce((worst, t) =>
            t.pnl < (worst?.pnl || Infinity) ? t : worst
        );
    }

    function calculateTradingFrequency(trades, period) {
        if (trades.length < 2) return 0;
        const periodMapping = {
            "1h": 1 / 24,
            "24h": 1,
            "7d": 7,
            "30d": 30,
            "90d": 90,
        };
        const days = periodMapping[period] || 30;
        return trades.length / days;
    }

    function calculateProfitFactor(trades) {
        const grossWin = trades
            .filter((t) => t.pnl > 0)
            .reduce((acc, t) => acc + t.pnl, 0);
        const grossLoss = Math.abs(
            trades.filter((t) => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0)
        );
        if (grossLoss === 0) return grossWin > 0 ? 999 : 0;
        return Number((grossWin / grossLoss).toFixed(2));
    }

    function calculateAvgWin(trades) {
        const wins = trades.filter((t) => t.pnl > 0);
        return wins.length
            ? wins.reduce((acc, t) => acc + t.pnl, 0) / wins.length
            : 0;
    }

    function calculateAvgLoss(trades) {
        const losses = trades.filter((t) => t.pnl < 0);
        return losses.length
            ? losses.reduce((acc, t) => acc + t.pnl, 0) / losses.length
            : 0;
    }

    function analyzeByAsset(trades, signals) {
        const assets = [
            ...new Set([
                ...trades.map((t) => t.symbol),
                ...signals.map((s) => s.symbol),
            ]),
        ];
        const analysis = {};

        assets.forEach((asset) => {
            const assetCompletedTrades = trades.filter(
                (t) =>
                    t.symbol === asset &&
                    (t.status === "CLOSED" ||
                        (t.pnl !== null && t.pnl !== undefined))
            );
            const assetSignals = signals.filter((s) => s.symbol === asset);
            const winCount = assetCompletedTrades.filter(
                (t) => t.pnl > 0
            ).length;

            analysis[asset] = {
                totalTrades: assetCompletedTrades.length,
                totalSignals: assetSignals.length,
                pnl: assetCompletedTrades.reduce(
                    (sum, t) => sum + (t.pnl || 0),
                    0
                ),
                winRate:
                    assetCompletedTrades.length > 0
                        ? (winCount / assetCompletedTrades.length) * 100
                        : 0,
                bestTrade: Math.max(
                    ...assetCompletedTrades.map((t) => t.pnl || 0),
                    0
                ),
                worstTrade: Math.min(
                    ...assetCompletedTrades.map((t) => t.pnl || 0),
                    0
                ),
            };
        });
        return analysis;
    }

    function analyzeByStrategy(signals) {
        const strategies = [
            "conservative",
            "balanced",
            "responsive",
            "supertrend_momentum",
        ];
        const analysis = {};
        strategies.forEach((strategy) => {
            const subset = signals.filter(
                (s) =>
                    s.strategy === strategy ||
                    (strategy === "supertrend_momentum" && !s.strategy)
            );
            analysis[strategy] = { count: subset.length };
        });
        return analysis;
    }

    function analyzeExitReasons(trades) {
        const closedTrades = trades.filter(
            (t) =>
                t.status === "CLOSED" || (t.pnl !== null && t.pnl !== undefined)
        );
        const analysis = {};
        closedTrades.forEach((trade) => {
            const reason = trade.exitReason || "UNKNOWN";
            if (!analysis[reason]) analysis[reason] = 0;
            analysis[reason]++;
        });
        return analysis;
    }

    function analyzeByTime(trades, signals) {
        const hourly = new Array(24).fill(0);
        trades.forEach((t) => {
            try {
                hourly[new Date(t.timestamp).getHours()]++;
            } catch (e) {}
        });
        return {
            hourlyDistribution: hourly.map((count, i) => ({
                hour: i,
                trades: count,
            })),
        };
    }

    return router;
};
