// backend/server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const TradingController = require("./src/controllers/tradingController");
const tradingRoutes = require("./src/routes/trading");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin:
            process.env.NODE_ENV === "production"
                ? false
                : ["http://localhost:3000", "http://localhost:5173"],
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend/dist")));

// Initialize Trading Controller
const tradingController = new TradingController(io);

// API Routes
app.use("/api/trading", tradingRoutes(tradingController));

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
            trading: tradingController.isInitialized,
            websocket: io.engine.clientsCount > 0,
        },
    });
});

// Serve React app for any non-API routes
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/dist/index.html"));
});

// Socket.io connection handling
io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
    });

    // Send current system status to new clients
    if (tradingController.isInitialized) {
        tradingController.emitSystemStatus();
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error("Server Error:", error);
    res.status(500).json({
        error: "Internal server error",
        message:
            process.env.NODE_ENV === "development"
                ? error.message
                : "Something went wrong",
    });
});

// Graceful shutdown handling
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function gracefulShutdown(signal) {
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    try {
        // Stop accepting new connections
        server.close(() => {
            console.log("HTTP server closed");
        });

        // Cleanup trading controller
        if (tradingController) {
            await tradingController.cleanup();
        }

        // Close socket connections
        io.close(() => {
            console.log("Socket.io server closed");
        });

        console.log("Graceful shutdown completed");
        process.exit(0);
    } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(1);
    }
}

// Start server
async function startServer() {
    try {
        console.log("🚀 Starting Crypto Trend Trading Bot Server...");

        // Initialize trading controller
        await tradingController.initialize();

        // Start HTTP server
        server.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`📊 Trading Dashboard: http://localhost:${PORT}`);
            console.log(`🔌 WebSocket connections: ${io.engine.clientsCount}`);

            if (process.env.NODE_ENV === "development") {
                console.log("\n📋 Available API Endpoints:");
                console.log(
                    "  GET  /api/health                     - Health check"
                );
                console.log(
                    "  GET  /api/trading/status              - System status"
                );
                console.log(
                    "  GET  /api/trading/portfolio           - Portfolio summary"
                );
                console.log(
                    "  GET  /api/trading/signals             - Recent signals"
                );
                console.log(
                    "  GET  /api/trading/trades              - Trade history"
                );
                console.log(
                    "  GET  /api/trading/prices              - Current prices"
                );
                console.log(
                    "  GET  /api/trading/performance         - Performance metrics"
                );
                console.log(
                    "  GET  /api/trading/analytics           - Detailed analytics"
                );
                console.log(
                    "  POST /api/trading/start               - Start trading"
                );
                console.log(
                    "  POST /api/trading/stop                - Stop trading"
                );
                console.log(
                    "  POST /api/trading/reset               - Reset engine"
                );
                console.log(
                    "  POST /api/trading/config              - Update config"
                );
            }
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

// Start the server
startServer();
