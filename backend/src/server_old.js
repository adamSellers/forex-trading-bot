// backend/server.js - FIXED Complete Route Setup
// Load environment variables first
require("dotenv").config();

// Now import the rest
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const TradingController = require("./src/controllers/tradingController");
const tradingRoutes = require("./src/routes/trading");
const managementRoutes = require("./src/routes/management");
const ErrorHandler = require("./src/middleware/errorHandler");
const ValidationMiddleware = require("./src/middleware/validation");
const logger = require("./src/utils/logger");

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
        ],
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true,
    },
});

// Middleware
app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
        ],
        credentials: true,
    })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Security and validation middleware
app.use(ValidationMiddleware.sanitizeInput);

// Initialize trading controller
const tradingController = new TradingController(io);

// FIXED: Proper route mounting with correct prefixes
app.use(
    "/api/trading",
    ValidationMiddleware.validateQueryParams([
        "limit",
        "symbol",
        "period",
        "timeframe",
        "strategy",
    ]),
    tradingRoutes(tradingController)
);

app.use("/api/management", managementRoutes(tradingController));

// Health check route (standalone)
app.get("/api/health", (req, res) => {
    res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: "2.0.0",
    });
});

// Root endpoint
app.get("/", (req, res) => {
    res.json({
        name: "Crypto Trend Trading Bot",
        version: "2.0.0",
        status: "running",
        endpoints: {
            trading: "/api/trading/*",
            management: "/api/management/*",
            health: "/api/health",
        },
    });
});

// FIXED: Error handling middleware (must be last)
app.use(ErrorHandler.notFound);
app.use(ErrorHandler.handle);

// Enhanced Socket.io connection handling
io.on("connection", (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    // Send initial system status when client connects
    if (tradingController.isInitialized) {
        socket.emit("systemStatus", {
            isInitialized: true,
            timestamp: Date.now(),
        });
    }

    // Handle client requests
    socket.on("requestStatus", async () => {
        try {
            const status = await tradingController.getStatus();
            socket.emit("systemStatus", status);
        } catch (error) {
            logger.error("Error getting status for client:", error);
            socket.emit("error", { message: "Failed to get system status" });
        }
    });

    socket.on("disconnect", (reason) => {
        logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    socket.on("error", (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
    });
});

// Initialize and start server
async function startServer() {
    try {
        logger.info("🚀 Starting Crypto Trend Trading Bot Server...");

        // Initialize trading controller
        await tradingController.initialize();

        const PORT = process.env.PORT || 3001;
        server.listen(PORT, () => {
            logger.success(`✅ Server running on port ${PORT}`);
            logger.info(`🌐 API available at: http://localhost:${PORT}/api`);
            logger.info(`📊 Health check: http://localhost:${PORT}/api/health`);
            logger.info(`🔌 WebSocket: ws://localhost:${PORT}`);
        });
    } catch (error) {
        logger.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

// Enhanced graceful shutdown
const shutdown = async (signal) => {
    logger.info(`🛑 Received ${signal}, shutting down gracefully...`);

    try {
        // Close socket connections
        io.close();

        // Cleanup trading controller
        await tradingController.cleanup();

        // Close HTTP server
        server.close(() => {
            logger.success("✅ Server closed successfully");
            process.exit(0);
        });

        // Force exit after 10 seconds
        setTimeout(() => {
            logger.error("⚠️ Forced shutdown after timeout");
            process.exit(1);
        }, 10000);
    } catch (error) {
        logger.error("❌ Error during shutdown:", error);
        process.exit(1);
    }
};

// Signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Unhandled error handlers
process.on("uncaughtException", (error) => {
    logger.error("🚨 Uncaught Exception:", error);
    shutdown("UNCAUGHT_EXCEPTION");
});

process.on("unhandledRejection", (reason, promise) => {
    logger.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
    shutdown("UNHANDLED_REJECTION");
});

// Start the server
startServer();
