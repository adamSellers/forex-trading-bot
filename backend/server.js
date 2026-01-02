// backend/server.js - Forex Trading Bot Express Server with Socket.IO
require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const logger = require("./src/utils/logger");
const tradingRoutes = require("./src/routes/tradingRoutes");
const OandaDataService = require("./src/services/OandaDataService");
const SignalGenerator = require("./src/services/signalGenerator");
const ConfigService = require("./src/services/configService");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3101;

// Initialize Socket.IO with CORS for frontend
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:3100", "http://localhost:5173"], // Vite dev ports
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

// Wire up ConfigService to services
configService.init(dataService, signalGenerator);

// Make services available to routes
app.locals.dataService = dataService;
app.locals.signalGenerator = signalGenerator;
app.locals.configService = configService;
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
// Socket.IO Connection Handling
// ============================================
io.on("connection", (socket) => {
    logger.info(`🔌 Client connected: ${socket.id}`);

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

    // Handle client requesting current prices
    socket.on("getPrices", () => {
        const prices = dataService.getAllPrices();
        socket.emit("priceUpdate", prices);
    });

    // Handle client requesting current signals
    socket.on("getSignals", () => {
        socket.emit("signalUpdate", signalGenerator.latestSignals || []);
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
        logger.info(`🔌 Client disconnected: ${socket.id} (${reason})`);
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
            `📡 Broadcasted trade signal: ${signal.symbol} - ${signal.signal}`
        );
    }
};

// Broadcast trade updates
const broadcastTrade = (trade) => {
    io.emit("tradeUpdate", trade);
    logger.info(`📡 Broadcasted trade: ${trade.instrument} - ${trade.side}`);
};

// Make broadcast functions available to routes
app.locals.broadcastPrices = broadcastPrices;
app.locals.broadcastSignals = broadcastSignals;
app.locals.broadcastSignal = broadcastSignal;
app.locals.broadcastTrade = broadcastTrade;

// Broadcast config changes
const broadcastConfig = (config) => {
    io.emit("configUpdate", config);
    logger.info("📡 Broadcasted config update");
};
app.locals.broadcastConfig = broadcastConfig;

// Listen for config changes from ConfigService
configService.on("configChanged", broadcastConfig);

// ============================================
// Start Server
// ============================================
server.listen(PORT, async () => {
    logger.success(`🚀 Forex Trading Bot API running on port ${PORT}`);
    logger.info(`   Health: http://localhost:${PORT}/api/health`);
    logger.info(`   Socket.IO: ws://localhost:${PORT}`);

    if (!process.env.OANDA_API_KEY) {
        logger.warn("⚠️  OANDA_API_KEY not set - trading features disabled");
    } else {
        const keyPreview = process.env.OANDA_API_KEY.substring(0, 4) + "...";
        logger.info(`   Oanda API Key: ${keyPreview}`);

        // Wire up price updates from data service to socket broadcast
        dataService.on("priceUpdate", broadcastPrices);
        await dataService.start();

        // Start signal generator after data service has initial data
        setTimeout(() => {
            // Wire up signal updates from generator to socket broadcast
            signalGenerator.on("allSignalsGenerated", broadcastSignals);
            signalGenerator.on("signalGenerated", broadcastSignal);

            signalGenerator.start(dataService, 60000); // Generate signals every 60s
        }, 5000); // Wait 5s for initial candle data
    }
});

// Export for testing
module.exports = { app, server, io };
