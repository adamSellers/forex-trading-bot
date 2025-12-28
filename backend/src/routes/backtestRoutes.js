// backend/src/routes/backtestRoutes.js
const express = require("express");
const router = express.Router();
const backtestEngine = require("../services/backtestEngine");

router.post("/run", async (req, res) => {
    try {
        // Log the parameters for debugging visibility
        console.log("🧪 Backtest Request Received:", req.body);

        // Run the simulation
        const results = await backtestEngine.runSimulation(req.body);

        // Return the JSON data
        res.json(results);
    } catch (error) {
        console.error("❌ Backtest API Error:", error);
        res.status(500).json({
            error: "Simulation failed",
            details: error.message,
        });
    }
});

module.exports = router;
