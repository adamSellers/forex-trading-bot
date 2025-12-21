// backend/src/routes/trading.js - LIVE PRODUCTION (NO PAPER)
const express = require("express");
const router = express.Router();

const CRYPTO_TRADING_DAYS_PER_YEAR = 365;

module.exports = (tradingController) => {
    // --- SYSTEM & STATUS ---
    router.get("/status", async (req, res) => {
        try {
            res.json(await tradingController.getStatus());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get("/account", async (req, res) => {
        try {
            res.json(await tradingController.getAccount());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get("/balances", async (req, res) => {
        try {
            const account = await tradingController.getAccount();
            res.json(account.balances || []);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- LIVE TRADING OPERATIONS ---
    router.get("/portfolio", async (req, res) => {
        try {
            res.json(await tradingController.getPortfolio());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get("/trades", async (req, res) => {
        try {
            res.json(await tradingController.getTrades(req.query));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get("/signals", async (req, res) => {
        try {
            res.json(await tradingController.getSignals(req.query));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post("/close/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const result = await tradingController.manualCloseTrade(id);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- DATA FEED ---
    router.get("/prices", async (req, res) => {
        try {
            res.json(await tradingController.getPrices());
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

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

    // --- ANALYTICS (FIXED) ---
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

            const trades =
                await tradingController.tradingService.tradeRepo.getTradesSince(
                    cutoffTime,
                    "live"
                );
            const portfolio = await engine.getPortfolioSummary();

            // FIX: Filter for completed trades
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

            const performance = {
                ...portfolio.performance,
                sharpeRatio: calculateSharpeRatio(
                    tradeReturns,
                    tradingFrequency
                ),
                volatility: calculateVolatility(tradeReturns, tradingFrequency),
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

    router.get("/analytics", async (req, res) => {
        try {
            const { period = "30d" } = req.query;
            const analyticsService =
                tradingController.tradingService?.analyticsService;

            if (!analyticsService) {
                return res
                    .status(503)
                    .json({ error: "Analytics Service not ready" });
            }

            // Delegate to the trade repository
            const report = await analyticsService.getPerformanceAnalytics(
                period
            );

            // Add asset breakdown which the service also provides
            const assets = await analyticsService.getAssetAnalytics();

            res.json({
                ...report,
                summary: {
                    trading: report.trading,
                    efficiency: report.efficiency,
                },
                assets: assets,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- CONTROL ---
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

    // DRY RUN TEST
    router.post("/test-signal", async (req, res) => {
        try {
            const {
                symbol = "BTCUSDT",
                signal = "BUY",
                strength = 1.5,
            } = req.body;
            const priceData =
                tradingController.tradingService?.binanceData?.getCurrentPrice(
                    symbol
                );
            const currentPrice = priceData ? priceData.price : 60000;

            const testSignal = {
                symbol,
                signal,
                strength,
                strategy: "manual_test",
                currentPrice,
                timestamp: Date.now(),
                isDryRun: true,
            };

            res.json({
                success: true,
                mode: "DRY_RUN",
                message: "Signal generated but NOT executed.",
                signal: testSignal,
                projectedEntry: currentPrice,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // --- HELPERS (Collapsed for brevity - use standard logic) ---
    function parsePeriod(p) {
        const m = {
            "1h": 3600000,
            "24h": 86400000,
            "7d": 604800000,
            "30d": 2592000000,
        };
        return m[p] || m["7d"];
    }
    function getTradeReturns(t) {
        return t.map((x) => x.pnlPercent || 0);
    }
    function calculateTradingFrequency(t, p) {
        if (t.length < 2) return 0;
        const d = { "1h": 1 / 24, "24h": 1, "7d": 7, "30d": 30 }[p] || 30;
        return t.length / d;
    }
    function calculateSharpeRatio(r, f) {
        if (r.length < 2) return 0;
        const avg = r.reduce((a, b) => a + b, 0) / r.length;
        const std = Math.sqrt(
            r.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / (r.length - 1)
        );
        return std === 0 ? 0 : (avg / std) * Math.sqrt(f * 365);
    }
    function calculateVolatility(r, f) {
        if (r.length < 2) return 0;
        const avg = r.reduce((a, b) => a + b, 0) / r.length;
        const std = Math.sqrt(
            r.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / (r.length - 1)
        );
        return std * Math.sqrt(f * 365);
    }
    function calculateAvgHoldingPeriod(t) {
        const v = t.filter((x) => x.holdingPeriod);
        return v.length
            ? v.reduce((a, b) => a + b.holdingPeriod, 0) / v.length
            : 0;
    }
    function getBestTrade(t) {
        return t.length
            ? t.reduce((a, b) => (b.pnl > (a.pnl || -Infinity) ? b : a), {})
            : null;
    }
    function getWorstTrade(t) {
        return t.length
            ? t.reduce((a, b) => (b.pnl < (a.pnl || Infinity) ? b : a), {})
            : null;
    }
    function calculateProfitFactor(t) {
        const w = t.filter((x) => x.pnl > 0).reduce((a, b) => a + b.pnl, 0);
        const l = Math.abs(
            t.filter((x) => x.pnl < 0).reduce((a, b) => a + b.pnl, 0)
        );
        return l === 0 ? (w > 0 ? 999 : 0) : Number((w / l).toFixed(2));
    }
    function calculateAvgWin(t) {
        const w = t.filter((x) => x.pnl > 0);
        return w.length ? w.reduce((a, b) => a + b.pnl, 0) / w.length : 0;
    }
    function calculateAvgLoss(t) {
        const l = t.filter((x) => x.pnl < 0);
        return l.length ? l.reduce((a, b) => a + b.pnl, 0) / l.length : 0;
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
            const completed = trades.filter(
                (t) =>
                    t.symbol === asset &&
                    (t.status === "CLOSED" ||
                        (t.pnl !== null && t.pnl !== undefined))
            );
            const sigs = signals.filter((s) => s.symbol === asset);
            const wins = completed.filter((t) => t.pnl > 0).length;
            analysis[asset] = {
                totalTrades: completed.length,
                totalSignals: sigs.length,
                pnl: completed.reduce((a, b) => a + (b.pnl || 0), 0),
                winRate: completed.length ? (wins / completed.length) * 100 : 0,
                bestTrade: Math.max(...completed.map((t) => t.pnl || 0), 0),
                worstTrade: Math.min(...completed.map((t) => t.pnl || 0), 0),
            };
        });
        return analysis;
    }
    function analyzeByStrategy(s) {
        return {};
    } // Simplified
    function analyzeExitReasons(t) {
        const c = t.filter((x) => x.status === "CLOSED" || x.pnl !== null);
        const a = {};
        c.forEach((x) => {
            const r = x.exitReason || "UNKNOWN";
            a[r] = (a[r] || 0) + 1;
        });
        return a;
    }
    function analyzeByTime(t, s) {
        return { hourlyDistribution: [], dailyDistribution: [] };
    } // Simplified

    return router;
};
