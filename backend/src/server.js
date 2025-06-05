const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Debug - add temporarily
console.log("🔑 Debug - API Key exists:", !!process.env.BINANCE_API_KEY);
console.log("🔑 Debug - Secret exists:", !!process.env.BINANCE_API_SECRET);
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import db from "./config/database.js";

// FIXED: Import from correct current location
import TradingController from "./src/controllers/tradingController.js";
import tradingRoutes from "./src/routes/trading.js";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173", // Vite dev server
        methods: ["GET", "POST"],
    },
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json());

// Test database connection
db.raw("SELECT 1")
    .then(() => console.log("✅ Database connected"))
    .catch((err) => console.error("❌ Database connection failed:", err));

// Basic health check
app.get("/api/health", (req, res) => {
    res.json({
        status: "OK",
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
    });
});

// Initialize trading controller
const tradingController = new TradingController(io);

// STEP 1: Use existing routes while we prepare migration
app.use("/api/trading", tradingRoutes(tradingController));

// Socket.io connection
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

// Initialize trading system
async function startServer() {
    try {
        console.log("🚀 Initializing Trading System...");
        await tradingController.initialize();

        const PORT = process.env.PORT || 3001;
        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📊 Dashboard: http://localhost:5173`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`🛑 Received ${signal}, shutting down gracefully...`);

    try {
        await tradingController.cleanup();
        server.close(() => {
            console.log("✅ Server closed successfully");
            process.exit(0);
        });
    } catch (error) {
        console.error("❌ Error during shutdown:", error);
        process.exit(1);
    }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start the server
startServer();

export { app, io };
