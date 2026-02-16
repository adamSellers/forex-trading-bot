// backend/src/routes/backtestRoutes.js
const express = require("express");
const router = express.Router();
const BacktestEngine = require("../services/backtestEngine");
const HistoricalDataService = require("../services/historicalDataService");

router.post("/run", async (req, res) => {
    try {
        const { instrument, from, to, granularity, config: configOverrides } =
            req.body || {};

        if (!instrument || !from || !to) {
            return res.status(400).json({
                error: "Missing required fields: instrument, from, to",
            });
        }

        const fromTimestamp = Math.floor(new Date(from).getTime() / 1000);
        const toTimestamp = Math.floor(new Date(to).getTime() / 1000);

        if (isNaN(fromTimestamp) || isNaN(toTimestamp) || fromTimestamp >= toTimestamp) {
            return res.status(400).json({
                error: "Invalid date range. Use YYYY-MM-DD and ensure from < to.",
            });
        }

        const historicalDataService = new HistoricalDataService();
        const engine = new BacktestEngine(historicalDataService);
        const results = await engine.run(
            instrument,
            granularity || "M15",
            fromTimestamp,
            toTimestamp,
            configOverrides || {}
        );

        res.json(results);
    } catch (error) {
        res.status(500).json({
            error: "Simulation failed",
            details: error.message,
        });
    }
});

module.exports = router;
