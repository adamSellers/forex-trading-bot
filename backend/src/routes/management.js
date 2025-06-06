// backend/src/routes/management.js - System Management Routes
const express = require("express");
const router = express.Router();

module.exports = (tradingController) => {
    // GET /api/management/health - System health check
    router.get("/health", (req, res) => {
        try {
            const uptime = process.uptime();
            const memory = process.memoryUsage();

            res.json({
                status: "OK",
                timestamp: new Date().toISOString(),
                uptime: uptime,
                uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor(
                    (uptime % 3600) / 60
                )}m`,
                memory: {
                    used: Math.round(memory.heapUsed / 1024 / 1024) + "MB",
                    total: Math.round(memory.heapTotal / 1024 / 1024) + "MB",
                    rss: Math.round(memory.rss / 1024 / 1024) + "MB",
                },
                environment: process.env.NODE_ENV || "production",
                version: "2.0.0",
                services: {
                    trading: tradingController?.isInitialized || false,
                    database: true,
                    binance:
                        tradingController?.services?.trading?.binanceData
                            ?.isConnected || false,
                    paperTrading:
                        tradingController?.services?.trading?.paperTrading
                            ?.isActive || false,
                },
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
            const systemInfo = {
                timestamp: new Date().toISOString(),
                server: {
                    uptime: process.uptime(),
                    platform: process.platform,
                    nodeVersion: process.version,
                    pid: process.pid,
                    cwd: process.cwd(),
                },
                memory: process.memoryUsage(),
                environment: {
                    nodeEnv: process.env.NODE_ENV,
                    port: process.env.PORT,
                    hasApiKeys: !!(
                        process.env.BINANCE_API_KEY &&
                        process.env.BINANCE_API_SECRET
                    ),
                },
                services: tradingController
                    ? {
                          initialized: tradingController.isInitialized,
                          trading: !!tradingController.services?.trading,
                          portfolio: !!tradingController.services?.portfolio,
                          risk: !!tradingController.services?.risk,
                          analytics: !!tradingController.services?.analytics,
                      }
                    : { initialized: false },
            };

            res.json(systemInfo);
        } catch (error) {
            console.error("System info error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    // GET /api/management/logs - Recent application logs
    router.get("/logs", (req, res) => {
        try {
            const { level = "info", limit = 50 } = req.query;

            // Placeholder for log integration
            const logs = [
                {
                    timestamp: new Date().toISOString(),
                    level: "info",
                    message: "System operational",
                    service: "management",
                },
            ];

            res.json({
                level,
                limit: parseInt(limit),
                count: logs.length,
                logs,
            });
        } catch (error) {
            console.error("Logs error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
