// backend/src/routes/management.js - FIXED LOG RETRIEVAL
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

module.exports = (tradingController) => {
    // GET /api/management/health - (Preserved from previous step)
    router.get("/health", (req, res) => {
        try {
            const uptime = process.uptime();
            const memory = process.memoryUsage();
            const ts = tradingController.tradingService;

            const binanceStatus = ts?.binanceData?.getServiceStatus();
            const engineStatus = ts?.activeEngine?.getStatus();
            const signalStatus = ts?.signalGenerator?.getStatus();

            const isBinanceReady = binanceStatus?.ready || false;
            const isEngineActive = engineStatus?.isActive || false;
            const isSignalsActive = signalStatus?.isActive || false;

            res.json({
                status: "OK",
                isInitialized: tradingController.isInitialized,
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
                    tradingController: {
                        isActive: tradingController.isInitialized,
                    },
                    database: { isActive: true },
                    binanceData: {
                        ready: isBinanceReady,
                        prices: binanceStatus?.prices || 0,
                    },
                    engine: { isActive: isEngineActive },
                    signalGenerator: { isActive: isSignalsActive },
                },
                candleCount: binanceStatus?.candleCount || 0,
                activeSignals: signalStatus?.activeSignals || [],
                config: ts?.config || {},
            });
        } catch (error) {
            console.error("Health check error:", error);
            res.status(503).json({ status: "ERROR", error: error.message });
        }
    });

    // GET /api/management/system - (Preserved)
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

    // --- FIXED LOGS ROUTE ---
    router.get("/logs", (req, res) => {
        try {
            // FIX: Ignore 'level' parameter here. Return ALL logs so frontend can filter.
            const { limit = 100 } = req.query;
            let combinedLogs = [];

            // 1. Source: In-Memory Event History (Reliable fallback)
            // This ensures we see trades/signals even if file logging fails
            if (tradingController.eventHistory) {
                const memoryLogs = tradingController.eventHistory.map((e) => ({
                    timestamp: new Date(e.timestamp).toISOString(),
                    level: e.type === "ERROR" ? "error" : "info",
                    message: `${e.type}: ${JSON.stringify(e.data)}`,
                    source: "memory",
                }));
                combinedLogs.push(...memoryLogs);
            }

            // 2. Source: Log Files (Persistent)
            const logDir = path.join(__dirname, "../../logs");
            if (fs.existsSync(logDir)) {
                try {
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
                            .trim()
                            .split("\n")
                            .slice(-parseInt(limit));
                        lines.forEach((line) => {
                            try {
                                const json = JSON.parse(line);
                                combinedLogs.push(json);
                            } catch (e) {
                                // Handle plain text logs
                                combinedLogs.push({
                                    timestamp: new Date().toISOString(),
                                    level: "info",
                                    message: line,
                                    source: "file",
                                });
                            }
                        });
                    });
                } catch (err) {
                    console.error("Error reading log files:", err);
                }
            }

            // 3. Sort Descending (Newest First) & Slice
            combinedLogs.sort(
                (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
            );
            const finalLogs = combinedLogs.slice(0, parseInt(limit));

            res.json({ logs: finalLogs });
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

    // POST /api/management/factory-reset
    router.post("/factory-reset", async (req, res) => {
        try {
            const result = await tradingController.factoryReset();
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
