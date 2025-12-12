// backend/src/routes/management.js - FIXED HEALTH CHECK
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

module.exports = (tradingController) => {
    // GET /api/management/health - Comprehensive health check
    router.get("/health", (req, res) => {
        try {
            const uptime = process.uptime();
            const memory = process.memoryUsage();

            // Access the core service
            const ts = tradingController.tradingService;

            // 1. Get Binance Status (Fix: Check 'ready', not 'connected')
            const binanceStatus = ts?.binanceData?.getServiceStatus();
            const isBinanceReady = binanceStatus?.ready || false;

            // 2. Get Engine Status (Fix: Check 'activeEngine', works for both Live & Paper)
            const engineStatus = ts?.activeEngine?.getStatus();
            const isEngineActive = engineStatus?.isActive || false;

            // 3. Get Signal Status
            const signalStatus = ts?.signalGenerator?.getStatus();

            res.json({
                status: "OK",
                isInitialized: tradingController.isInitialized, // Critical for Banner
                timestamp: new Date().toISOString(),
                uptime: uptime,
                uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor(
                    (uptime % 3600) / 60
                )}m ${Math.floor(uptime % 60)}s`,
                memory: {
                    used: Math.round(memory.heapUsed / 1024 / 1024) + "MB",
                    total: Math.round(memory.heapTotal / 1024 / 1024) + "MB",
                    rss: Math.round(memory.rss / 1024 / 1024) + "MB",
                    external: Math.round(memory.external / 1024 / 1024) + "MB",
                },
                environment: process.env.NODE_ENV || "production",
                version: "2.0.0",
                services: {
                    tradingController: tradingController.isInitialized,
                    database: true,
                    binanceData: isBinanceReady, // Green Light!
                    engine: isEngineActive, // Green Light!
                    signalGenerator: signalStatus?.isActive || false,
                },
                // Pass through stats for the banner
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

    // GET /api/management/system - Detailed system information
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
                        heapUsed: `${Math.round(
                            process.memoryUsage().heapUsed / 1024 / 1024
                        )}MB`,
                        heapTotal: `${Math.round(
                            process.memoryUsage().heapTotal / 1024 / 1024
                        )}MB`,
                        rss: `${Math.round(
                            process.memoryUsage().rss / 1024 / 1024
                        )}MB`,
                    },
                },
                environment: {
                    nodeEnv: process.env.NODE_ENV || "production",
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

            // Filter and Sort
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

    // POST /api/management/restart
    router.post("/restart", async (req, res) => {
        try {
            await tradingController.resetTrading();
            await tradingController.startTrading();
            res.json({ success: true, message: "System restarted" });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/management/config
    router.get("/config", (req, res) => {
        res.json(tradingController?.tradingService?.config || {});
    });

    return router;
};
