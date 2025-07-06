// backend/src/routes/management.js - COMPLETE Management Routes
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

            // Get trading system status
            const tradingStatus = tradingController?.isInitialized || false;
            const binanceStatus =
                tradingController.tradingService?.binanceData?.getServiceStatus();
            const paperTradingStatus =
                tradingController.tradingService?.paperTrading?.getStatus();
            const signalGeneratorStatus =
                tradingController.tradingService?.signalGenerator?.getStatus();

            res.json({
                status: "OK",
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
                    tradingController: tradingStatus,
                    database: true, // SQLite is embedded
                    binanceData: binanceStatus?.connected || false,
                    paperTrading: paperTradingStatus?.isActive || false,
                    signalGenerator: signalGeneratorStatus?.isActive || false,
                },
                api: {
                    endpoints: [
                        "/api/trading/*",
                        "/api/management/*",
                        "/api/health",
                    ],
                    lastRequest: new Date().toISOString(),
                },
            });
        } catch (error) {
            console.error("Health check error:", error);
            res.status(503).json({
                status: "ERROR",
                timestamp: new Date().toISOString(),
                error: error.message,
                services: {
                    tradingController: false,
                    database: false,
                    binanceData: false,
                    paperTrading: false,
                    signalGenerator: false,
                },
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
                    architecture: process.arch,
                    nodeVersion: process.version,
                    pid: process.pid,
                    cwd: process.cwd(),
                    execPath: process.execPath,
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
                        external: `${Math.round(
                            process.memoryUsage().external / 1024 / 1024
                        )}MB`,
                    },
                },
                environment: {
                    nodeEnv: process.env.NODE_ENV || "production",
                    port: process.env.PORT || 3001,
                    hasApiKeys: !!(
                        process.env.BINANCE_API_KEY &&
                        process.env.BINANCE_API_SECRET
                    ),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
                tradingSystem: tradingController
                    ? {
                          initialized: tradingController.isInitialized,
                          status: tradingController.isInitialized
                              ? tradingController.tradingService?.getStatus?.() ||
                                "Running"
                              : "Not Initialized",
                      }
                    : {
                          initialized: false,
                          error: "Trading service not available",
                      },
                binanceData: tradingController?.tradingService?.binanceData
                    ? {
                          ...tradingController.tradingService.binanceData.getServiceStatus(),
                          mode: tradingController.tradingService.binanceData
                              .useFallback
                              ? "FALLBACK"
                              : "LIVE",
                      }
                    : {
                          available: false,
                          error: "Binance data service not available",
                      },
            };

            res.json(systemInfo);
        } catch (error) {
            console.error("System info error:", error);
            res.status(500).json({
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    });

    // GET /api/management/logs - Recent application logs
    router.get("/logs", (req, res) => {
        try {
            const { level = "info", limit = 50, format = "json" } = req.query;

            // Try to read from log files if they exist
            const logDir = path.join(__dirname, "../../logs");
            let logs = [];

            if (fs.existsSync(logDir)) {
                try {
                    const logFiles = fs
                        .readdirSync(logDir)
                        .filter((file) => file.endsWith(".log"))
                        .sort()
                        .slice(-3); // Get last 3 log files

                    logFiles.forEach((file) => {
                        const filePath = path.join(logDir, file);
                        const content = fs.readFileSync(filePath, "utf8");
                        const lines = content
                            .split("\n")
                            .filter((line) => line.trim())
                            .slice(-parseInt(limit) / logFiles.length); // Distribute limit across files

                        lines.forEach((line) => {
                            try {
                                const logEntry = JSON.parse(line);
                                if (
                                    !level ||
                                    logEntry.level?.toLowerCase() ===
                                        level.toLowerCase()
                                ) {
                                    logs.push(logEntry);
                                }
                            } catch (parseError) {
                                // Handle non-JSON log lines
                                logs.push({
                                    timestamp: new Date().toISOString(),
                                    level: "info",
                                    message: line,
                                    source: "file",
                                });
                            }
                        });
                    });
                } catch (fileError) {
                    console.warn("Error reading log files:", fileError);
                }
            }

            // If no file logs, provide recent system logs
            if (logs.length === 0) {
                logs = [
                    {
                        timestamp: new Date().toISOString(),
                        level: "info",
                        message:
                            "System operational - logs available in file system",
                        service: "management",
                    },
                    {
                        timestamp: new Date(Date.now() - 1000).toISOString(),
                        level: "info",
                        message: `Trading controller status: ${
                            tradingController?.isInitialized
                                ? "Initialized"
                                : "Not initialized"
                        }`,
                        service: "trading",
                    },
                    {
                        timestamp: new Date(Date.now() - 2000).toISOString(),
                        level: "info",
                        message: `Memory usage: ${Math.round(
                            process.memoryUsage().heapUsed / 1024 / 1024
                        )}MB`,
                        service: "system",
                    },
                ];
            }

            // Sort by timestamp and limit
            logs = logs
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, parseInt(limit));

            const response = {
                level,
                limit: parseInt(limit),
                count: logs.length,
                logs,
                metadata: {
                    generated: new Date().toISOString(),
                    logDirectory: logDir,
                    hasFileAccess: fs.existsSync(logDir),
                },
            };

            res.json(response);
        } catch (error) {
            console.error("Logs error:", error);
            res.status(500).json({
                error: error.message,
                timestamp: new Date().toISOString(),
                logs: [],
            });
        }
    });

    // GET /api/management/performance - System performance metrics
    router.get("/performance", (req, res) => {
        try {
            const cpuUsage = process.cpuUsage();
            const memUsage = process.memoryUsage();

            const performance = {
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system,
                    usage: `${(
                        (cpuUsage.user + cpuUsage.system) /
                        1000000
                    ).toFixed(2)}s total`,
                },
                memory: {
                    heapUsed: memUsage.heapUsed,
                    heapTotal: memUsage.heapTotal,
                    rss: memUsage.rss,
                    external: memUsage.external,
                    heapUtilization:
                        (
                            (memUsage.heapUsed / memUsage.heapTotal) *
                            100
                        ).toFixed(2) + "%",
                },
                trading: {
                    isActive: tradingController?.isInitialized || false,
                    dataCollectionRate:
                        tradingController?.tradingService?.binanceData?.getServiceStatus()
                            ?.totalCandles || 0,
                    signalsGenerated:
                        tradingController?.tradingService?.signalGenerator
                            ?.signalHistory?.length || 0,
                    tradesExecuted:
                        tradingController?.tradingService?.paperTrading
                            ?.tradeHistory?.length || 0,
                },
                network: {
                    socketConnections: 0, // Would need to track socket.io connections
                    apiRequests: "N/A", // Would need request counter middleware
                },
                alerts: [],
            };

            // Add performance alerts
            if (performance.memory.heapUtilization > 80) {
                performance.alerts.push({
                    type: "warning",
                    message: `High memory usage: ${performance.memory.heapUtilization}`,
                    timestamp: new Date().toISOString(),
                });
            }

            if (!performance.trading.isActive) {
                performance.alerts.push({
                    type: "info",
                    message: "Trading system not initialized",
                    timestamp: new Date().toISOString(),
                });
            }

            res.json(performance);
        } catch (error) {
            console.error("Performance metrics error:", error);
            res.status(500).json({
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    });

    // POST /api/management/restart - Restart trading services (not the server)
    router.post("/restart", async (req, res) => {
        try {
            if (!tradingController) {
                return res.status(400).json({
                    error: "Trading controller not available",
                    timestamp: new Date().toISOString(),
                });
            }

            console.log("🔄 Restarting trading services...");

            // Cleanup current services
            await tradingController.cleanup();

            // Reinitialize
            await tradingController.initialize();

            res.json({
                success: true,
                message: "Trading services restarted successfully",
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            console.error("Restart error:", error);
            res.status(500).json({
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    });

    // GET /api/management/config - Get current system configuration
    router.get("/config", (req, res) => {
        try {
            const config = {
                timestamp: new Date().toISOString(),
                server: {
                    port: process.env.PORT || 3001,
                    nodeEnv: process.env.NODE_ENV || "production",
                },
                trading: tradingController?.tradingService
                    ? {
                          strategy:
                              tradingController.tradingService.config
                                  ?.strategy || "balanced",
                          enableTrading:
                              tradingController.tradingService.config
                                  ?.enableTrading || false,
                          assets:
                              tradingController.tradingService.config?.assets ||
                              [],
                          timeframes:
                              tradingController.tradingService.config
                                  ?.timeframes || [],
                          riskManagement: {
                              riskPerTrade:
                                  tradingController.tradingService.config
                                      ?.riskPerTrade || 0.01,
                              maxDailyLoss:
                                  tradingController.tradingService.config
                                      ?.maxDailyLoss || 0.02,
                              maxWeeklyLoss:
                                  tradingController.tradingService.config
                                      ?.maxWeeklyLoss || 0.05,
                          },
                      }
                    : null,
                binance: {
                    hasCredentials: !!(
                        process.env.BINANCE_API_KEY &&
                        process.env.BINANCE_API_SECRET
                    ),
                    useTestnet:
                        tradingController?.tradingService?.binanceData?.config
                            ?.useTestnet !== false,
                    useFallback:
                        tradingController?.tradingService?.binanceData
                            ?.useFallback || false,
                },
            };

            res.json(config);
        } catch (error) {
            console.error("Config error:", error);
            res.status(500).json({
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    });

    return router;
};
