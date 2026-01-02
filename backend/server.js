// backend/server.js - Forex Trading Bot Express Server
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const logger = require("./src/utils/logger");
const tradingRoutes = require("./src/routes/tradingRoutes");
const OandaDataService = require("./src/services/OandaDataService");
const SignalGenerator = require("./src/services/signalGenerator");

const app = express();
const PORT = process.env.PORT || 3101;

// Initialize services
const INSTRUMENTS = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"];
const dataService = new OandaDataService(INSTRUMENTS);
const signalGenerator = new SignalGenerator({
    assets: INSTRUMENTS,
    timeframe: "15m",
    minAdx: 22,
});

// Make services available to routes
app.locals.dataService = dataService;
app.locals.signalGenerator = signalGenerator;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging (skip health checks)
app.use((req, res, next) => {
    if (!req.path.includes("/health")) {
        logger.debug(`${req.method} ${req.path}`);
    }
    next();
});

// Mount API routes
app.use("/api", tradingRoutes);

// Start server
app.listen(PORT, async () => {
    logger.success(`🚀 Forex Trading Bot API running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/api/health`);

    if (!process.env.OANDA_API_KEY) {
        logger.warn("⚠️  OANDA_API_KEY not set - trading features disabled");
    } else {
        const keyPreview = process.env.OANDA_API_KEY.substring(0, 4) + "...";
        logger.info(`   Oanda API Key: ${keyPreview}`);

        // Start data service
        await dataService.start();

        // Start signal generator after data service has initial data
        setTimeout(() => {
            signalGenerator.start(dataService, 60000); // Generate signals every 60s
        }, 5000); // Wait 5s for initial candle data
    }
});

module.exports = app;
