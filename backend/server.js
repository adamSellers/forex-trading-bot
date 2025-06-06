// backend/server.js - Clean Production Server
// Load environment variables first
require("dotenv").config();

// Now import the rest
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const TradingController = require("./src/controllers/tradingController");
const tradingRoutes = require("./src/routes/trading");
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

// Routes
app.use("/api/trading", tradingRoutes(tradingController));

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
            logger.success(
                `🚀 Server running on port ${PORT} with clean architecture!`
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
