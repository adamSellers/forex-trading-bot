// backend/src/routes/management.js - FIXED FOR DASHBOARD COMPATIBILITY
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

module.exports = (tradingController) => {
    // GET /api/management/health - The Source of Truth
    router.get("/health", (req, res) => {
        try {
            const uptime = process.uptime();
            const memory = process.memoryUsage();

            // Access the core service directly
            const ts = tradingController.tradingService;

            // 1. Get Real Status from Sub-Services
            const binanceStatus = ts?.binanceData?.getServiceStatus();
            const engineStatus = ts?.activeEngine?.getStatus();
            const signalStatus = ts?.signalGenerator?.getStatus();

            // 2. Determine "Ready" States
            const isBinanceReady = binanceStatus?.ready || false;
            const isEngineActive = engineStatus?.isActive || false;
            const isSignalsActive = signalStatus?.isActive || false;

            res.json({
                status: "OK",
                isInitialized: tradingController.isInitialized,
                timestamp: new Date().toISOString(),
                uptime: uptime,
                uptimeFormatted: formatUptime(uptime),

                // System Resources
                memory: {
                    used: formatBytes(memory.heapUsed),
                    total: formatBytes(memory.heapTotal),
                    rss: formatBytes(memory.rss),
                    external: formatBytes(memory.external),
                },
                environment: process.env.NODE_ENV || "production",
                version: "2.0.0",

                // Detailed Service Status (Formatted as Objects for Frontend)
                services: {
                    tradingController: {
                        isActive: tradingController.isInitialized,
                    },
                    database: { isActive: true }, // If we are here, DB is up
                    binanceData: {
                        ready: isBinanceReady,
                        prices: binanceStatus?.prices || 0,
                    },
                    engine: { isActive: isEngineActive },
                    signalGenerator: { isActive: isSignalsActive },
                },

                // Metrics for the Dashboard Banner
                candleCount: binanceStatus?.candleCount || 0,
                activeSignals: signalStatus?.activeSignals || [],
                config: ts?.config || {},
            });
        } catch (error) {
            console.error("Health check error:", error);
            res.status(503).json({
                status: "ERROR",
                timestamp: new Date().toISOString(),
                error: error.message,
            });
        }
    });

    // GET /api/management/system - Info Card Data
    router.get("/system", (req, res) => {
        try {
            const ts = tradingController?.tradingService;

            res.json({
                timestamp: new Date().toISOString(),
                server: {
                    uptime: process.uptime(),
                    platform: process.platform,
                    nodeVersion: process.version,
                    pid: process.pid,
                },
                memory: {
                    ...process.memoryUsage(),
                    formatted: {
                        heapUsed: formatBytes(process.memoryUsage().heapUsed),
                        heapTotal: formatBytes(process.memoryUsage().heapTotal),
                        rss: formatBytes(process.memoryUsage().rss),
                    },
                },
                environment: {
                    nodeEnv: process.env.NODE_ENV || "production",
                    // Check if keys are actually loaded in memory
                    hasApiKeys: !!(
                        process.env.BINANCE_API_KEY &&
                        process.env.BINANCE_API_SECRET
                    ),
                },
                tradingSystem: {
                    status: ts?.getStatus() || {},
                    mode: ts?.config?.tradingMode || "Unknown",
                },
                binanceData: ts?.binanceData?.getServiceStatus() || {},
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/management/logs - Recent application logs
    router.get("/logs", (req, res) => {
        try {
            const { level = "info", limit = 50 } = req.query;
            const logDir = path.join(__dirname, "../../logs");
            let logs = [];

            if (fs.existsSync(logDir)) {
                // Read last 2 log files to ensure we catch recent events
                const logFiles = fs
                    .readdirSync(logDir)
                    .filter((f) => f.endsWith(".log"))
                    .sort()
                    .slice(-2);

                logFiles.forEach((file) => {
                    const content = fs.readFileSync(
                        path.join(logDir, file),
                        "utf8"
                    );
                    const lines = content
                        .split("\n")
                        .filter((l) => l.trim())
                        .slice(-parseInt(limit));
                    lines.forEach((line) => {
                        try {
                            logs.push(JSON.parse(line));
                        } catch (e) {
                            /* ignore raw text */
                        }
                    });
                });
            }

            // Filter and Sort descending
            logs = logs
                .filter(
                    (l) =>
                        !level ||
                        (l.level &&
                            l.level.toLowerCase() === level.toLowerCase())
                )
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, parseInt(limit));

            res.json({ logs });
        } catch (error) {
            res.status(500).json({ error: error.message, logs: [] });
        }
    });

    // POST /api/management/restart - Soft Restart
    router.post("/restart", async (req, res) => {
        try {
            await tradingController.resetTrading();
            await tradingController.startTrading();
            res.json({ success: true, message: "System services restarted" });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/management/config
    router.get("/config", (req, res) => {
        res.json(tradingController?.tradingService?.config || {});
    });

    // --- Helpers ---
    function formatUptime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h}h ${m}m ${s}s`;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return "0 B";
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (
            parseFloat((bytes / Math.pow(1024, i)).toFixed(0)) + " " + sizes[i]
        );
    }

    return router;
};
