// =====================================================
// 5. backend/src/routes/tradingRoutes.js
// CLEAN ROUTES WITH VALIDATION
// =====================================================

const express = require("express");
const ErrorHandler = require("../middleware/errorHandler");
const ValidationMiddleware = require("../middleware/validation");

module.exports = (tradingController) => {
    const router = express.Router();

    // Apply input sanitization to all routes
    router.use(ValidationMiddleware.sanitizeInput);

    // ================== BASIC ROUTES ==================

    // GET /api/trading/status
    router.get(
        "/status",
        ErrorHandler.asyncWrapper(async (req, res) => {
            const status = await tradingController.getStatus();
            res.json(status);
        })
    );

    // GET /api/trading/portfolio
    router.get(
        "/portfolio",
        ErrorHandler.asyncWrapper(async (req, res) => {
            const portfolio = await tradingController.getPortfolio();
            res.json(portfolio);
        })
    );

    // GET /api/trading/signals
    router.get(
        "/signals",
        ValidationMiddleware.validateQueryParams(["limit", "symbol"]),
        ErrorHandler.asyncWrapper(async (req, res) => {
            const signals = await tradingController.getSignals(req.query);
            res.json(signals);
        })
    );

    // GET /api/trading/trades
    router.get(
        "/trades",
        ValidationMiddleware.validateQueryParams(["limit", "symbol"]),
        ErrorHandler.asyncWrapper(async (req, res) => {
            const trades = await tradingController.getTrades(req.query);
            res.json(trades);
        })
    );

    // GET /api/trading/prices
    router.get(
        "/prices",
        ErrorHandler.asyncWrapper(async (req, res) => {
            const prices = await tradingController.getPrices();
            res.json(prices);
        })
    );

    // GET /api/trading/account
    router.get(
        "/account",
        ErrorHandler.asyncWrapper(async (req, res) => {
            const account = await tradingController.getAccount();
            res.json(account);
        })
    );

    // ================== ENHANCED ROUTES ==================

    // GET /api/trading/holdings
    router.get(
        "/holdings",
        ErrorHandler.asyncWrapper(async (req, res) => {
            const holdings = await tradingController.getCombinedHoldings();
            res.json(holdings);
        })
    );

    // GET /api/trading/analytics
    router.get(
        "/analytics",
        ValidationMiddleware.validateQueryParams(["period"]),
        ErrorHandler.asyncWrapper(async (req, res) => {
            const analytics = await tradingController.getAnalytics(req.query);
            res.json(analytics);
        })
    );

    // GET /api/trading/risk-status
    router.get(
        "/risk-status",
        ErrorHandler.asyncWrapper(async (req, res) => {
            const riskStatus = await tradingController.getRiskStatus();
            res.json(riskStatus);
        })
    );

    // ================== CONFIGURATION ROUTES ==================

    // POST /api/trading/config
    router.post(
        "/config",
        ValidationMiddleware.validateTradingConfig,
        ErrorHandler.asyncWrapper(async (req, res) => {
            await tradingController.updateConfig(req.body);
            res.json({ success: true, message: "Configuration updated" });
        })
    );

    // POST /api/trading/start
    router.post(
        "/start",
        ErrorHandler.asyncWrapper(async (req, res) => {
            await tradingController.startTrading();
            res.json({ success: true, message: "Trading started" });
        })
    );

    // POST /api/trading/stop
    router.post(
        "/stop",
        ErrorHandler.asyncWrapper(async (req, res) => {
            await tradingController.stopTrading();
            res.json({ success: true, message: "Trading stopped" });
        })
    );

    // POST /api/trading/reset
    router.post(
        "/reset",
        ErrorHandler.asyncWrapper(async (req, res) => {
            await tradingController.resetTrading();
            res.json({ success: true, message: "Trading engine reset" });
        })
    );
    // GET Health Check endpoint
    router.get("/health", (req, res) => {
        res.json({
            status: "OK",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            trading: {
                initialized: tradingController.isInitialized,
                servicesReady: !!tradingController.services.trading,
            },
        });
    });

    return router;
};
