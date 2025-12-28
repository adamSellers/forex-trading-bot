// backend/server.js - Rebuilt for Production Deployment

// Load environment variables from .env file only in non-production environments.
// In production, variables are injected by PM2 from the ecosystem file.
if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const TradingService = require("./src/services/tradingService");
const { initializeDatabase } = require("./config/database"); // Import the initializer
const TradingController = require("./src/controllers/tradingController"); // This is now the bridge
const tradingRoutes = require("./src/routes/trading");
const managementRoutes = require("./src/routes/management");

// --- CHANGE 1: REMOVED HTTP ROUTE ---
// const backtestRoutes = require("./src/routes/backtestRoutes"); // <--- DELETED (Replaced by Socket)

// --- CHANGE 2: ADDED SOCKET HANDLER ---
const labSocket = require("./src/socket/labSocket"); // <--- NEW IMPORT

const ErrorHandler = require("./src/middleware/errorHandler");
const logger = require("./src/utils/logger");

const app = express();
const server = createServer(app);

// Dynamic CORS configuration for Express and Socket.IO
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
    : ["http://localhost:5173", "http://localhost:3001"];

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    methods: ["GET", "POST"],
};

const io = new Server(server, {
    cors: corsOptions,
});

// Core Middleware
app.use(cors(corsOptions));
app.use(express.json());

// =================================================================
// CORRECT ARCHITECTURE: Instantiate Service, then pass to Controller
// =================================================================
const tradingService = new TradingService(io);
const tradingController = new TradingController(tradingService, io); // Pass service to controller

// API Routes - must be defined before the SPA catch-all
app.use("/api/trading", tradingRoutes(tradingController));
app.use("/api/management", managementRoutes(tradingController));

// --- CHANGE 1: REMOVED HTTP ROUTE ---
// app.use("/api/backtest", backtestRoutes); // <--- DELETED (We use Sockets now)

// In production, serve the built frontend application
if (process.env.NODE_ENV === "production") {
    const frontendBuildPath = path.resolve(__dirname, "..", "frontend", "dist");
    logger.info(`Serving static files from: ${frontendBuildPath}`);

    // Serve static files (e.g., JS, CSS, images) from the React app build directory
    app.use(express.static(frontendBuildPath));

    // The "catchall" handler: for any request that doesn't match an API route or a static file,
    // send back the main index.html file. This is essential for client-side routing in SPAs.
    app.get("*", (req, res) => {
        res.sendFile(path.join(frontendBuildPath, "index.html"));
    });
}

// Error handling middleware - should be last
app.use(ErrorHandler.notFound);
app.use(ErrorHandler.handle);

// Socket.io connection handler
io.on("connection", (socket) => {
    logger.info(
        `Client connected: ${socket.id} from origin: ${socket.handshake.headers.origin}`
    );

    // --- CHANGE 2: REGISTER LAB HANDLER ---
    labSocket(io, socket); // <--- HOOK UP THE NEW MODULE

    socket.on("disconnect", () => {
        logger.info(`Client disconnected: ${socket.id}`);
    });
});

// Start the server
async function startServer() {
    try {
        // CRITICAL FIX: Initialize the database first and wait for it to complete.
        await initializeDatabase();

        // Initialize the CORE SERVICE, not the controller.
        // The service will set up all underlying components (Binance, Signals, etc.).
        await tradingService.initialize();
        await tradingController.initialize(); // Initialize the controller after the service

        const PORT = process.env.PORT || 3001;
        server.listen(PORT, () => {
            logger.success(
                `🚀 Server running in ${
                    process.env.NODE_ENV || "development"
                } mode on port ${PORT}`
            );
        });
        // Note: We do NOT call a `start()` method here. Trading is started/stopped via API calls.
    } catch (error) {
        logger.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

// Graceful shutdown handlers
process.on("SIGTERM", async () => {
    logger.info("🛑 Received SIGTERM, shutting down gracefully...");
    // Cleanup the SERVICE, which in turn cleans up its components.
    await tradingService.cleanup();
    server.close(() => {
        logger.info("All connections closed. Exiting.");
        process.exit(0);
    });
});

startServer();
