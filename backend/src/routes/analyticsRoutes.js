// backend/src/routes/analyticsRoutes.js - Analytics and Performance Routes
const express = require("express");
const router = express.Router();

/**
 * GET /api/analytics
 * Comprehensive performance metrics
 */
router.get("/analytics", async (req, res) => {
    try {
        const TradeRepository = require("../repositories/tradeRepository");
        const SignalRepository = require("../repositories/signalRepository");
        const AnalyticsService = require("../services/analyticsService");

        const tradeRepo = new TradeRepository();
        const signalRepo = new SignalRepository();
        const analyticsService = new AnalyticsService(tradeRepo, signalRepo);

        const period = req.query.period || "30d";
        const mode = req.query.mode || "live";

        const analytics = await analyticsService.getAnalytics(period, mode);

        res.json(analytics);
    } catch (error) {
        console.error("Analytics error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/analytics/summary
 * Quick performance summary
 */
router.get("/analytics/summary", async (req, res) => {
    try {
        const TradeRepository = require("../repositories/tradeRepository");
        const tradeRepo = new TradeRepository();

        const period = req.query.period || "30d";
        const mode = req.query.mode || "live";

        const metrics = await tradeRepo.getPerformanceMetrics(period, mode);

        if (!metrics) {
            return res.json({
                message: "No completed trades in this period",
                period,
                mode,
            });
        }

        res.json({
            period,
            mode,
            ...metrics,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/analytics/equity
 * Equity curve data
 */
router.get("/analytics/equity", async (req, res) => {
    try {
        const TradeRepository = require("../repositories/tradeRepository");
        const tradeRepo = new TradeRepository();

        const period = req.query.period || "30d";
        const mode = req.query.mode || "live";

        // Get all trades in period
        const periodMs = parsePeriod(period);
        const cutoffTime = Date.now() - periodMs;
        const trades = await tradeRepo.getTradesSince(cutoffTime, mode);

        // Build equity curve
        let equity = 0;
        const equityCurve = trades
            .filter((t) => !t.isOpen && t.pnlAud !== null)
            .sort((a, b) => a.exitTime - b.exitTime)
            .map((t) => {
                equity += t.pnlAud;
                return {
                    time: t.exitTime,
                    equity,
                    pnl: t.pnlAud,
                    instrument: t.instrument,
                };
            });

        res.json({
            period,
            mode,
            equityCurve,
            totalPnL: equity,
            tradeCount: equityCurve.length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/analytics/instruments
 * Performance by instrument
 */
router.get("/analytics/instruments", async (req, res) => {
    try {
        const TradeRepository = require("../repositories/tradeRepository");
        const tradeRepo = new TradeRepository();

        const period = req.query.period || "30d";
        const mode = req.query.mode || "live";

        // Get all trades in period
        const periodMs = parsePeriod(period);
        const cutoffTime = Date.now() - periodMs;
        const trades = await tradeRepo.getTradesSince(cutoffTime, mode);

        // Group by instrument
        const byInstrument = {};
        trades
            .filter((t) => !t.isOpen && t.pnlAud !== null)
            .forEach((t) => {
                if (!byInstrument[t.instrument]) {
                    byInstrument[t.instrument] = {
                        instrument: t.instrument,
                        trades: 0,
                        wins: 0,
                        losses: 0,
                        totalPnL: 0,
                        totalPips: 0,
                    };
                }
                const stats = byInstrument[t.instrument];
                stats.trades++;
                stats.totalPnL += t.pnlAud;
                stats.totalPips += t.pnlPips || 0;
                if (t.pnlAud > 0) stats.wins++;
                else if (t.pnlAud < 0) stats.losses++;
            });

        // Calculate win rates
        const instruments = Object.values(byInstrument).map((stats) => ({
            ...stats,
            winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
            avgPnL: stats.trades > 0 ? stats.totalPnL / stats.trades : 0,
        }));

        res.json({
            period,
            mode,
            instruments,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Helper: Parse period string to milliseconds
 */
function parsePeriod(period) {
    const periods = {
        "1d": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        "90d": 90 * 24 * 60 * 60 * 1000,
        "1y": 365 * 24 * 60 * 60 * 1000,
    };
    return periods[period] || periods["30d"];
}

module.exports = router;
