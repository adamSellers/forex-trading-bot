// backend/server.js - CLEAN VERSION (no legacy redirects)
// ========================================================

const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const TradingController = require("./src/controllers/tradingController");
const tradingRoutes = require("./src/routes/trading");
const managementRoutes = require("./src/routes/management");
const ErrorHandler = require("./src/middleware/errorHandler");
const logger = require("./src/utils/logger");

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST"],
    },
});

// Middleware
app.use(cors());
app.use(express.json());

// Initialize trading controller
const tradingController = new TradingController(io);

// CLEAN ROUTES - No cruft, no legacy endpoints
app.use("/api/trading", tradingRoutes(tradingController));
app.use("/api/management", managementRoutes(tradingController));

// Error handling
app.use(ErrorHandler.notFound);
app.use(ErrorHandler.handle);

// Socket.io
io.on("connection", (socket) => {
    logger.info("Client connected:", socket.id);
    socket.on("disconnect", () => {
        logger.info("Client disconnected:", socket.id);
    });
});

// Initialize and start server
async function startServer() {
    try {
        await tradingController.initialize();

        const PORT = process.env.PORT || 3001;
        server.listen(PORT, () => {
            logger.success(`🚀 Server running on port ${PORT}`);
            logger.info(
                `🏥 Health: http://localhost:${PORT}/api/management/health`
            );
            logger.info(
                `📊 System: http://localhost:${PORT}/api/management/system`
            );
            logger.info(
                `📈 Trading: http://localhost:${PORT}/api/trading/status`
            );
        });
    } catch (error) {
        logger.error("Failed to start server:", error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
    logger.info("🛑 Received SIGTERM, shutting down gracefully...");
    await tradingController.cleanup();
    server.close(() => {
        logger.success("✅ Server closed");
        process.exit(0);
    });
});

process.on("SIGINT", async () => {
    logger.info("🛑 Received SIGINT, shutting down gracefully...");
    await tradingController.cleanup();
    server.close(() => {
        logger.success("✅ Server closed");
        process.exit(0);
    });
});

startServer();

console.log(`
🎯 CLEAN ARCHITECTURE BENEFITS:
===============================

✅ No legacy endpoints cluttering the codebase
✅ Clear separation: trading vs management
✅ Single source of truth for each endpoint
✅ No redirects or proxying complexity
✅ Easy to understand and maintain
✅ RESTful and logical URL structure

📋 ACTION ITEMS:
================

1. Remove all /api/health references from:
    - deploy scripts
    - nginx config  
    - monitoring tools
    - frontend code (if any)

2. Update to use:
    - /api/management/health
    - /api/management/system
    - /api/trading/* for all trading ops

3. Test new endpoints work correctly

4. Deploy and verify health checks pass

🚀 RESULT: Clean, maintainable architecture!
`);
