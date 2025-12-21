// backend/src/routes/trading.js - COMPLETE & CLEANED
const express = require("express");
const router = express.Router();

module.exports = (tradingController) => {
    // --- HELPER TO GET SERVICE ---
    const getAnalytics = () => {
        const service = tradingController.tradingService?.analyticsService;
        if (!service) throw new Error("Analytics Service not ready");
        return service;
    };

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

    // --- ANALYTICS (UNIFIED) ---

    // 1. Detailed Performance Stats (Sharpe, Volatility, etc.)
    router.get("/performance", async (req, res) => {
        try {
            const { period = "30d" } = req.query;
            const stats = await getAnalytics().getDetailedPerformance(period);
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 2. General Analytics Dashboard (Summary + Assets)
    router.get("/analytics", async (req, res) => {
        try {
            const { period = "30d" } = req.query;
            const service = getAnalytics();

            // Delegate all logic to service
            const report = await service.getPerformanceAnalytics(period);
            const assets = await service.getAssetAnalytics();

            res.json({
                date: new Date().toISOString().split("T")[0],
                period: report.period,
                summary: {
                    trading: report.trading,
                    efficiency: report.efficiency,
                    signals: report.signals,
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

    return router;
};
