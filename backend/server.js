// backend/server.js - Rebuilt for Production Deployment
// Load environment variables first
require("dotenv").config();

// Now import the rest
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const TradingController = require("./src/controllers/tradingController");
const tradingRoutes = require("./src/routes/trading");
const managementRoutes = require("./src/routes/management");
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

// Initialize trading controller
const tradingController = new TradingController(io);

// API Routes - must be defined before the SPA catch-all
app.use("/api/trading", tradingRoutes(tradingController));
app.use("/api/management", managementRoutes(tradingController));

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

    socket.on("disconnect", () => {
        logger.info(`Client disconnected: ${socket.id}`);
    });
});

// Start the server
async function startServer() {
    try {
        await tradingController.initialize();
        const PORT = process.env.PORT || 3001;
        server.listen(PORT, () => {
            logger.success(
                `🚀 Server running in ${
                    process.env.NODE_ENV || "development"
                } mode on port ${PORT}`
            );
        });
    } catch (error) {
        logger.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

// Graceful shutdown handlers
process.on("SIGTERM", async () => {
    logger.info("🛑 Received SIGTERM, shutting down gracefully...");
    await tradingController.cleanup();
    server.close(() => {
        logger.info("All connections closed. Exiting.");
        process.exit(0);
    });
});

startServer();
