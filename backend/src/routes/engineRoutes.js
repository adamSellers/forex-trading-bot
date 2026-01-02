// backend/src/routes/engineRoutes.js - Trading Engine Control Routes
const express = require("express");
const router = express.Router();
const { requireService } = require("./shared");

/**
 * GET /api/engine/status
 * Get trading engine status and statistics
 */
router.get("/status", requireService("tradingEngine"), (req, res) => {
    try {
        res.json(req.tradingEngine.getStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/engine/trades
 * Get open trades from trading engine
 */
router.get("/trades", requireService("tradingEngine"), (req, res) => {
    try {
        res.json({
            trades: req.tradingEngine.getOpenTrades(),
            count: req.tradingEngine.openTrades?.size || 0,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/engine/close/:tradeId
 * Force close a specific trade via trading engine
 */
router.post(
    "/close/:tradeId",
    requireService("tradingEngine"),
    async (req, res) => {
        try {
            const { tradeId } = req.params;
            await req.tradingEngine.forceCloseTrade(tradeId);

            res.json({
                success: true,
                message: `Trade ${tradeId} closed`,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
);

/**
 * POST /api/engine/sync
 * Sync trading engine with Oanda
 */
router.post("/sync", requireService("tradingEngine"), async (req, res) => {
    try {
        await req.tradingEngine.syncOpenTrades();
        await req.tradingEngine.syncWithOanda();

        res.json({
            success: true,
            message: "Trading engine synced with Oanda",
            openTrades: req.tradingEngine.openTrades?.size || 0,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/engine/reset-stats
 * Reset trading engine statistics
 */
router.post("/reset-stats", requireService("tradingEngine"), (req, res) => {
    try {
        req.tradingEngine.resetStats();

        res.json({
            success: true,
            message: "Trading engine stats reset",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/engine/stats
 * Get detailed trading statistics
 */
router.get("/stats", requireService("tradingEngine"), (req, res) => {
    try {
        const engine = req.tradingEngine;

        res.json({
            isRunning: engine.isRunning,
            stats: engine.stats,
            openPositions: engine.openTrades?.size || 0,
            queueLength: engine.tradeQueue?.length || 0,
            isProcessingQueue: engine.isProcessingQueue || false,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/engine/start
 * Start the trading engine (if not already running)
 */
router.post("/start", requireService("tradingEngine"), async (req, res) => {
    try {
        if (req.tradingEngine.isRunning) {
            return res.json({
                success: true,
                message: "Trading engine already running",
            });
        }

        await req.tradingEngine.start();

        res.json({
            success: true,
            message: "Trading engine started",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/engine/stop
 * Stop the trading engine
 */
router.post("/stop", requireService("tradingEngine"), (req, res) => {
    try {
        req.tradingEngine.stop();

        res.json({
            success: true,
            message: "Trading engine stopped",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
