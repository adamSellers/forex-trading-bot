// backend/server.js - Forex Trading Bot Express Server with Socket.IO
require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const logger = require("./src/utils/logger");
const tradingRoutes = require("./src/routes/tradingRoutes");
const OandaDataService = require("./src/services/OandaDataService");
const SignalGenerator = require("./src/services/signalGenerator");
const ConfigService = require("./src/services/configService");
const LiveTradingEngine = require("./src/services/LiveTradingEngine");
const TradeRepository = require("./src/repositories/tradeRepository");
const SignalRepository = require("./src/repositories/signalRepository");
const emailService = require("./src/services/emailService");
const S3ReportScheduler = require("./src/services/s3ReportScheduler");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3101;

// Increase max listeners to prevent warning during shutdown
server.setMaxListeners(20);

// Initialize Socket.IO with CORS for frontend
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:3100",
            "http://localhost:3101", // Same-origin in production
            "http://localhost:5173", // Vite dev port
        ],
        methods: ["GET", "POST"],
        credentials: true,
    },
    transports: ["websocket", "polling"],
});

// Initialize ConfigService first (loads from file or creates defaults)
const configService = new ConfigService();

// Get initial instruments from config
const initialConfig = configService.get();
const INSTRUMENTS = initialConfig.assets || [
    "AUD_USD",
    "EUR_USD",
    "GBP_USD",
    "USD_JPY",
];

// Initialize services with config
const dataService = new OandaDataService(INSTRUMENTS);
const signalGenerator = new SignalGenerator({
    assets: INSTRUMENTS,
    timeframe: initialConfig.timeframe || "15m",
    minAdx: initialConfig.minAdx || 22,
    rsiOverbought: initialConfig.rsiOverbought || 75,
    enableContinuationEntry: initialConfig.enableContinuationEntry ?? true,
    continuationWindowMs:
        initialConfig.continuationWindowMs || 4 * 60 * 60 * 1000,
    continuationRsiThreshold: initialConfig.continuationRsiThreshold || 70,
    continuationMaxPriceDeviation:
        initialConfig.continuationMaxPriceDeviation || 0.02,
});

// Initialize repositories
const tradeRepository = new TradeRepository();
const signalRepository = new SignalRepository();

// Initialize S3 report scheduler
const s3ReportScheduler = new S3ReportScheduler(tradeRepository, signalRepository);

// Initialize LiveTradingEngine
const tradingEngine = new LiveTradingEngine({
    monitorIntervalMs: 10000, // Check positions every 10 seconds
});

// Wire up ConfigService to services
configService.init(dataService, signalGenerator);

// Initialize trading engine with all dependencies
tradingEngine.init(
    configService,
    dataService,
    tradeRepository,
    signalGenerator,
    io
);

// Initialize email service (will log status)
emailService.initialize();

// Make services available to routes
app.locals.dataService = dataService;
app.locals.signalGenerator = signalGenerator;
app.locals.configService = configService;
app.locals.tradingEngine = tradingEngine;
app.locals.tradeRepository = tradeRepository;
app.locals.signalRepository = signalRepository;
app.locals.emailService = emailService;
app.locals.s3ReportScheduler = s3ReportScheduler;
app.locals.io = io;

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

// ============================================
// Production: Serve Frontend Static Files
// ============================================
const frontendPath = path.join(__dirname, "../frontend/dist");

// Serve static files from frontend build
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for any non-API routes
app.get("*", (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(frontendPath, "index.html"));
});

// ============================================
// Socket.IO Connection Handling
// ============================================
io.on("connection", (socket) => {
    logger.info(`Ã°Å¸â€Å’ Client connected: ${socket.id}`);

    // Send initial data on connect
    socket.emit("connected", {
        message: "Connected to Forex Trading Bot",
        instruments: INSTRUMENTS,
        timestamp: new Date().toISOString(),
    });

    // Send current prices immediately on connect
    const currentPrices = dataService.getAllPrices();
    if (Object.keys(currentPrices).length > 0) {
        socket.emit("priceUpdate", currentPrices);
    }

    // Send current signals immediately on connect
    if (
        signalGenerator.latestSignals &&
        signalGenerator.latestSignals.length > 0
    ) {
        socket.emit("signalUpdate", signalGenerator.latestSignals);
    }

    // Send trading engine status
    socket.emit("engineStatus", tradingEngine.getStatus());

    // Handle client requesting current prices
    socket.on("getPrices", () => {
        const prices = dataService.getAllPrices();
        socket.emit("priceUpdate", prices);
    });

    // Handle client requesting current signals
    socket.on("getSignals", () => {
        socket.emit("signalUpdate", signalGenerator.latestSignals || []);
    });

    // Handle client requesting engine status
    socket.on("getEngineStatus", () => {
        socket.emit("engineStatus", tradingEngine.getStatus());
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
        logger.info(`Ã°Å¸â€Å’ Client disconnected: ${socket.id} (${reason})`);
    });

    // Handle errors
    socket.on("error", (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
    });
});

// ============================================
// Real-time Event Broadcasting
// ============================================

// Broadcast price updates to all connected clients
const broadcastPrices = (prices) => {
    io.emit("priceUpdate", prices);
};

// Broadcast signal updates to all connected clients
const broadcastSignals = (signals) => {
    io.emit("signalUpdate", signals);
};

// Broadcast individual signal (for alerts)
const broadcastSignal = (signal) => {
    if (signal.signal === "BUY" || signal.signal === "SELL") {
        io.emit("tradeSignal", signal);
        logger.info(
            `Ã°Å¸â€œÂ¡ Broadcasted trade signal: ${signal.symbol} - ${signal.signal}`
        );
    }
};

// Broadcast trade updates
const broadcastTrade = (trade) => {
    io.emit("tradeUpdate", trade);
    logger.info(
        `Ã°Å¸â€œÂ¡ Broadcasted trade: ${trade.instrument} - ${trade.side}`
    );
};

// Broadcast engine status
const broadcastEngineStatus = () => {
    io.emit("engineStatus", tradingEngine.getStatus());
};

// Make broadcast functions available to routes
app.locals.broadcastPrices = broadcastPrices;
app.locals.broadcastSignals = broadcastSignals;
app.locals.broadcastSignal = broadcastSignal;
app.locals.broadcastTrade = broadcastTrade;
app.locals.broadcastEngineStatus = broadcastEngineStatus;

// Broadcast config changes
const broadcastConfig = (config) => {
    io.emit("configUpdate", config);
    logger.info("Ã°Å¸â€œÂ¡ Broadcasted config update");
};
app.locals.broadcastConfig = broadcastConfig;

// Listen for config changes from ConfigService
configService.on("configChanged", broadcastConfig);

// Listen for trading engine events
tradingEngine.on("tradeOpened", (trade) => {
    logger.info(`Ã°Å¸â€â€ Trade opened event: ${trade.instrument}`);
    broadcastEngineStatus();
});

tradingEngine.on("tradeClosed", (trade) => {
    logger.info(`Ã°Å¸â€â€ Trade closed event: ${trade.instrument}`);
    broadcastEngineStatus();
});

tradingEngine.on("entryRejected", ({ signal, reason }) => {
    logger.debug(`Ã¢ÂÂ¸Ã¯Â¸Â Entry rejected: ${signal.symbol} - ${reason}`);
});

// ============================================
// Start Server
// ============================================
server.listen(PORT, async () => {
    logger.success(`Ã°Å¸Å¡â‚¬ Forex Trading Bot API running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/api/health`);
    logger.info(`   Socket.IO: ws://localhost:${PORT}`);

    if (!process.env.OANDA_API_KEY) {
        logger.warn(
            "Ã¢Å¡Â Ã¯Â¸Â  OANDA_API_KEY not set - trading features disabled"
        );
    } else {
        const keyPreview = process.env.OANDA_API_KEY.substring(0, 4) + "...";
        logger.info(`   Oanda API Key: ${keyPreview}`);

        // Wire up price updates from data service to socket broadcast
        dataService.on("priceUpdate", broadcastPrices);
        await dataService.start();

        // Start signal generator after data service has initial data
        setTimeout(async () => {
            // Wire up signal updates from generator to socket broadcast
            signalGenerator.on("allSignalsGenerated", broadcastSignals);
            signalGenerator.on("signalGenerated", broadcastSignal);

            signalGenerator.start(dataService, 60000); // Generate signals every 60s

            // Start trading engine (will subscribe to signals)
            // Note: Trading is controlled by config.enableTrading flag
            try {
                await tradingEngine.start();
                logger.success(
                    "Ã¢Å“â€¦ Trading engine started and listening for signals"
                );

                const config = configService.get();

                // Broadcast updated engine status to all connected clients
                broadcastEngineStatus();

                if (config.enableTrading) {
                    logger.success("Ã¢Å“â€¦ Live trading is ENABLED");
                } else {
                    logger.info(
                        "Ã¢â€žÂ¹Ã¯Â¸Â  Trading is DISABLED - enable in settings to start trading"
                    );
                }
            } catch (error) {
                logger.error(
                    "Ã¢ÂÅ’ Failed to start trading engine:",
                    error.message
                );
            }
            // Start S3 report scheduler (non-blocking, won't affect trading)
            s3ReportScheduler.start();
        }, 5000); // Wait 5s for initial candle data
    }
});

// Graceful shutdown handler
let isShuttingDown = false;

const gracefulShutdown = (signal) => {
    if (isShuttingDown) {
        logger.warn(
            "Ã¢Å¡Â Ã¯Â¸Â Shutdown already in progress, forcing exit..."
        );
        process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`${signal} received - shutting down gracefully`);

    // Remove event listeners to prevent memory leaks
    try {
        dataService.removeListener("priceUpdate", broadcastPrices);
        signalGenerator.removeListener("allSignalsGenerated", broadcastSignals);
        signalGenerator.removeListener("signalGenerated", broadcastSignal);
        configService.removeListener("configChanged", broadcastConfig);
        tradingEngine.removeAllListeners();
    } catch (err) {
        // Ignore errors from removing listeners
    }

    // Stop services
    try {
        if (tradingEngine) tradingEngine.stop();
        if (dataService) dataService.stop();
        if (signalGenerator) signalGenerator.stop();
        if (s3ReportScheduler) s3ReportScheduler.stop();
    } catch (err) {
        logger.error("Error stopping services:", err.message);
    }

    // Close HTTP server with timeout
    const forceExitTimeout = setTimeout(() => {
        logger.warn("Ã¢Å¡Â Ã¯Â¸Â Graceful shutdown timeout - forcing exit");
        process.exit(1);
    }, 5000); // 5 second timeout

    // Close all socket connections first
    io.close(() => {
        logger.info("Socket.IO closed");
    });

    server.close((err) => {
        clearTimeout(forceExitTimeout);
        if (err) {
            logger.error("Error closing server:", err.message);
            process.exit(1);
        }
        logger.info("Server closed");
        process.exit(0);
    });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Export for testing
module.exports = { app, server, io };
