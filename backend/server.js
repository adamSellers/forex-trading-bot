// backend/server.js - Forex Trading Bot Express Server with Socket.IO
require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const logger = require("./src/utils/logger");
const { db } = require("./config/database");
const tradingRoutes = require("./src/routes/tradingRoutes");
const OandaDataService = require("./src/services/OandaDataService");
const ConfigService = require("./src/services/configService");
const LiveTradingEngine = require("./src/services/LiveTradingEngine");
const TradeRepository = require("./src/repositories/tradeRepository");
const SignalRepository = require("./src/repositories/signalRepository");
const EntryDecisionRepository = require("./src/repositories/entryDecisionRepository");
const StrategyRunRepository = require("./src/repositories/strategyRunRepository");
const PortfolioRepository = require("./src/repositories/portfolioRepository");
const emailService = require("./src/services/emailService");
const S3ReportScheduler = require("./src/services/s3ReportScheduler");
const RuntimeCoordinator = require("./src/runtime/runtimeCoordinator");
const PaperTradingRuntime = require("./src/services/PaperTradingRuntime");
const TimesFmClient = require("./src/services/timesFmClient");
const TimesFmSignalService = require("./src/services/timesFmSignalService");

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
configService.init();

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

// Initialize repositories (before SignalGenerator so we can pass signalRepository)
const tradeRepository = new TradeRepository();
const signalRepository = new SignalRepository();
const entryDecisionRepository = new EntryDecisionRepository();
const strategyRunRepository = new StrategyRunRepository();
const portfolioRepository = new PortfolioRepository();

// Initialize shared runtime coordinator
const timesFmClient = new TimesFmClient();
const timesFmSignalService = new TimesFmSignalService({
    client: timesFmClient,
    dataService,
});

const runtimeCoordinator = new RuntimeCoordinator({
    dataService,
    signalRepository,
    strategyRunRepository,
    tradeRepository,
    configService,
    timesFmSignalService,
    pollIntervalMs: 60000,
});
const paperTradingRuntime = new PaperTradingRuntime({
    runtimeCoordinator,
    tradeRepository,
    signalRepository,
    entryDecisionRepository,
    portfolioRepository,
    dataService,
    io,
});

// Initialize S3 report scheduler
const s3ReportScheduler = new S3ReportScheduler(
    tradeRepository,
    signalRepository,
    entryDecisionRepository
);

// Initialize LiveTradingEngine
const tradingEngine = new LiveTradingEngine({
    monitorIntervalMs: 10000, // Check positions every 10 seconds
});

// Wire up ConfigService to services
configService.init(dataService, runtimeCoordinator);
runtimeCoordinator.init({
    dataService,
    signalRepository,
    strategyRunRepository,
    tradeRepository,
    configService,
    timesFmSignalService,
});
paperTradingRuntime.init({
    runtimeCoordinator,
    tradeRepository,
    signalRepository,
    entryDecisionRepository,
    portfolioRepository,
    dataService,
    io,
});

// Initialize trading engine with all dependencies
tradingEngine.init(
    configService,
    dataService,
    tradeRepository,
    runtimeCoordinator,
    io,
    entryDecisionRepository
);

// Initialize email service (will log status)
emailService.initialize();

// Make services available to routes
app.locals.dataService = dataService;
app.locals.signalGenerator = runtimeCoordinator;
app.locals.runtimeCoordinator = runtimeCoordinator;
app.locals.configService = configService;
app.locals.tradingEngine = tradingEngine;
app.locals.tradeRepository = tradeRepository;
app.locals.signalRepository = signalRepository;
app.locals.entryDecisionRepository = entryDecisionRepository;
app.locals.strategyRunRepository = strategyRunRepository;
app.locals.portfolioRepository = portfolioRepository;
app.locals.paperTradingRuntime = paperTradingRuntime;
app.locals.emailService = emailService;
app.locals.s3ReportScheduler = s3ReportScheduler;
app.locals.timesFmClient = timesFmClient;
app.locals.timesFmSignalService = timesFmSignalService;
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
    logger.info(`Client connected: ${socket.id}`);

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
        runtimeCoordinator.latestSignals &&
        runtimeCoordinator.latestSignals.length > 0
    ) {
        socket.emit("signalUpdate", runtimeCoordinator.latestSignals);
    }

    // Send trading engine status
    socket.emit("engineStatus", tradingEngine.getStatus());
    socket.emit("liveSelectionUpdated", runtimeCoordinator.getLiveSelection());
    socket.emit("runtimeRunsChanged", runtimeCoordinator.listRuns());

    // Handle client requesting current prices
    socket.on("getPrices", () => {
        const prices = dataService.getAllPrices();
        socket.emit("priceUpdate", prices);
    });

    // Handle client requesting current signals
    socket.on("getSignals", () => {
        socket.emit("signalUpdate", runtimeCoordinator.latestSignals || []);
    });

    // Handle client requesting engine status
    socket.on("getEngineStatus", () => {
        socket.emit("engineStatus", tradingEngine.getStatus());
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
        logger.info(`Client disconnected: ${socket.id} (${reason})`);
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
        logger.info(`Broadcasted trade signal: ${signal.symbol} - ${signal.signal}`);
    }
};

// Broadcast trade updates
const broadcastTrade = (trade) => {
    io.emit("tradeUpdate", trade);
    logger.info(`Broadcasted trade: ${trade.instrument} - ${trade.side}`);
};

// Broadcast engine status
const broadcastEngineStatus = () => {
    io.emit("engineStatus", tradingEngine.getStatus());
};

const broadcastLiveSelection = (selection) => {
    io.emit("liveSelectionUpdated", selection);
};

const broadcastRuntimeRuns = (runs) => {
    io.emit("runtimeRunsChanged", runs);
};

// Make broadcast functions available to routes
app.locals.broadcastPrices = broadcastPrices;
app.locals.broadcastSignals = broadcastSignals;
app.locals.broadcastSignal = broadcastSignal;
app.locals.broadcastTrade = broadcastTrade;
app.locals.broadcastEngineStatus = broadcastEngineStatus;
app.locals.broadcastLiveSelection = broadcastLiveSelection;
app.locals.broadcastRuntimeRuns = broadcastRuntimeRuns;

// Broadcast config changes
const broadcastConfig = (config) => {
    io.emit("configUpdate", config);
    broadcastEngineStatus();
    logger.info("Broadcasted config update");
};
app.locals.broadcastConfig = broadcastConfig;

// Listen for config changes from ConfigService
configService.on("configChanged", broadcastConfig);

// Listen for trading engine events
tradingEngine.on("tradeOpened", (trade) => {
    logger.info(`Trade opened event: ${trade.instrument}`);
    broadcastEngineStatus();
});

tradingEngine.on("tradeClosed", (trade) => {
    logger.info(`Trade closed event: ${trade.instrument}`);
    broadcastEngineStatus();
});

tradingEngine.on("entryRejected", ({ signal, reason }) => {
    logger.debug(`Entry rejected: ${signal.symbol} - ${reason}`);
});

// ============================================
// Data Retention Scheduler (daily at midnight)
// ============================================
// Storage policy only — never touches trades (the permanent record) or any
// trading logic. Sizing context from the 2026-06-10 production audit:
// signals dominate growth (~13k rows/day across live + shadow + candidate
// runs, amplified by 13 indexes), timesfm_context JSON averages ~600B/row,
// and portfolio_snapshots previously had no retention at all.
const SIGNAL_RETENTION_DAYS = Number(process.env.SIGNAL_RETENTION_DAYS) || 30;
const TIMESFM_CONTEXT_RETENTION_DAYS =
    Number(process.env.TIMESFM_CONTEXT_RETENTION_DAYS) || 7;
const ENTRY_DECISION_RETENTION_DAYS =
    Number(process.env.ENTRY_DECISION_RETENTION_DAYS) || 90;
const PORTFOLIO_SNAPSHOT_RETENTION_DAYS =
    Number(process.env.PORTFOLIO_SNAPSHOT_RETENTION_DAYS) || 90;

const runDataRetention = async () => {
    // Each repository method catches its own errors and returns 0, so one
    // failed step never aborts the rest of the sweep.
    await signalRepository.deleteOlderThan(SIGNAL_RETENTION_DAYS);
    await signalRepository.clearTimesFmContextOlderThan(
        TIMESFM_CONTEXT_RETENTION_DAYS
    );
    await entryDecisionRepository.deleteOlderThan(ENTRY_DECISION_RETENTION_DAYS);
    await portfolioRepository.deleteOlderThan(PORTFOLIO_SNAPSHOT_RETENTION_DAYS);

    // Passive autocheckpoints (wal_autocheckpoint=1000) copy WAL pages into
    // the main db but can only RESET the WAL file when no reader is active —
    // and this process reads constantly, so the production WAL grew to 1.6GB
    // unchecked. TRUNCATE forces a full checkpoint + WAL reset; busy_timeout
    // (30s) bounds how long it waits for in-flight readers.
    try {
        const rows = await db.raw("PRAGMA wal_checkpoint(TRUNCATE)");
        const result = Array.isArray(rows) ? rows[0] : rows;
        if (result && result.busy) {
            logger.warn(
                "WAL checkpoint (TRUNCATE) could not complete (readers/writers busy); will retry on next sweep"
            );
        } else {
            logger.info("WAL checkpoint (TRUNCATE) completed after retention sweep");
        }
    } catch (error) {
        logger.error("WAL checkpoint after retention sweep failed:", error);
    }
};

const scheduleDataRetention = () => {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Run retention immediately on startup
    runDataRetention().catch((error) =>
        logger.error("Startup retention sweep failed:", error)
    );

    // Calculate ms until next midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow - now;

    // Schedule first sweep at midnight, then daily
    setTimeout(() => {
        runDataRetention().catch((error) =>
            logger.error("Retention sweep failed:", error)
        );
        setInterval(() => {
            runDataRetention().catch((error) =>
                logger.error("Retention sweep failed:", error)
            );
        }, ONE_DAY_MS);
    }, msUntilMidnight);

    logger.info(
        `🗓️ Data retention scheduled (midnight daily): signals ${SIGNAL_RETENTION_DAYS}d, ` +
            `TimesFM context ${TIMESFM_CONTEXT_RETENTION_DAYS}d, entry decisions ${ENTRY_DECISION_RETENTION_DAYS}d, ` +
            `portfolio snapshots ${PORTFOLIO_SNAPSHOT_RETENTION_DAYS}d, WAL checkpoint after each sweep`
    );
};

// ============================================
// Start Server
// ============================================
server.listen(PORT, async () => {
    logger.success(`Forex Trading Bot API running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/api/health`);
    logger.info(`   Socket.IO: ws://localhost:${PORT}`);

    if (!process.env.OANDA_API_KEY) {
        logger.warn("OANDA_API_KEY not set - trading features disabled");
        timesFmSignalService.refreshHealth(true).catch((error) => {
            logger.warn(`TimesFM health bootstrap failed: ${error.message}`);
        });
    } else {
        const keyPreview = process.env.OANDA_API_KEY.substring(0, 4) + "...";
        logger.info(`   Oanda API Key: ${keyPreview}`);

        // Wire up price updates from data service to socket broadcast
        dataService.on("priceUpdate", broadcastPrices);
        await dataService.start();
        await timesFmSignalService.refreshHealth(true);

        // Start signal generator after data service has initial data
        setTimeout(async () => {
            // Wire up signal updates from generator to socket broadcast
            runtimeCoordinator.on("allSignalsGenerated", broadcastSignals);
            runtimeCoordinator.on("signalGenerated", broadcastSignal);
            runtimeCoordinator.on("liveSelectionChanged", broadcastLiveSelection);
            runtimeCoordinator.on("runtimeRunsChanged", broadcastRuntimeRuns);

            await runtimeCoordinator.start(dataService, 60000);
            await paperTradingRuntime.start();

            // Start trading engine (will subscribe to signals)
            // Note: Trading is controlled by config.enableTrading flag
            try {
                await tradingEngine.start();
                logger.success("Trading engine started and listening for signals");

                // Start position monitoring loop (reconciles with Oanda every 10s)
                tradingEngine.startMonitoring();

                const config = configService.get();

                // Broadcast updated engine status to all connected clients
                broadcastEngineStatus();

                if (config.enableTrading) {
                    logger.success("Live trading is ENABLED");
                } else {
                    logger.info("Trading is DISABLED - enable in settings to start trading");
                }
            } catch (error) {
                logger.error("Failed to start trading engine:", error.message);
            }
            // Start S3 report scheduler (non-blocking, won't affect trading)
            s3ReportScheduler.start();

            // Schedule daily signal cleanup (90-day retention)
            scheduleDataRetention();
        }, 5000); // Wait 5s for initial candle data
    }
});

// Graceful shutdown handler
let isShuttingDown = false;

const gracefulShutdown = (signal) => {
    if (isShuttingDown) {
        logger.warn("Shutdown already in progress, forcing exit...");
        process.exit(1);
    }

    isShuttingDown = true;
    logger.info(`${signal} received - shutting down gracefully`);

    // Remove event listeners to prevent memory leaks
    try {
        dataService.removeListener("priceUpdate", broadcastPrices);
        runtimeCoordinator.removeListener("allSignalsGenerated", broadcastSignals);
        runtimeCoordinator.removeListener("signalGenerated", broadcastSignal);
        runtimeCoordinator.removeListener("liveSelectionChanged", broadcastLiveSelection);
        runtimeCoordinator.removeListener("runtimeRunsChanged", broadcastRuntimeRuns);
        configService.removeListener("configChanged", broadcastConfig);
        tradingEngine.removeAllListeners();
    } catch (err) {
        // Ignore errors from removing listeners
    }

    // Stop services
    try {
        if (tradingEngine) tradingEngine.stop();
        if (dataService) dataService.stop();
        if (runtimeCoordinator) runtimeCoordinator.stop();
        if (paperTradingRuntime) paperTradingRuntime.stop();
        if (s3ReportScheduler) s3ReportScheduler.stop();
    } catch (err) {
        logger.error("Error stopping services:", err.message);
    }

    // Close HTTP server with timeout
    const forceExitTimeout = setTimeout(() => {
        logger.warn("Graceful shutdown timeout - forcing exit");
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
