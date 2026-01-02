// backend/src/routes/systemRoutes.js - Health and System Info Routes
const express = require("express");
const router = express.Router();
const {
    OANDA_API_KEY,
    OANDA_ACCOUNT_ID,
    oandaRequest,
    formatBytes,
    formatUptime,
} = require("./shared");

/**
 * GET /api/health
 * Basic health check with config summary
 */
router.get("/health", (req, res) => {
    const { dataService, signalGenerator, configService, tradingEngine } =
        req.app.locals;
    const config = configService?.get() || {};

    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
            api: true,
            oanda: !!OANDA_API_KEY,
            dataService: dataService?.isRunning || false,
            signalGenerator: signalGenerator?.isRunning || false,
            tradingEngine: tradingEngine?.isRunning || false,
        },
        config: {
            enableTrading: config.enableTrading || false,
            tradingMode: config.tradingMode || "live",
            assets: config.assets || [],
            strategy: config.strategy || "supertrend_momentum",
            timeframe: config.timeframe || "15m",
            minAdx: config.minAdx || 22,
            rsiOverbought: config.rsiOverbought || 75,
            maxOpenPositions: config.maxOpenPositions || 2,
            leverage: config.leverage || 10,
        },
    });
});

/**
 * GET /api/system/health
 * Comprehensive system health check with Oanda latency
 */
router.get("/system/health", async (req, res) => {
    try {
        const { dataService, signalGenerator, configService, tradingEngine } =
            req.app.locals;
        const config = configService?.get() || {};

        // Test Oanda API connectivity
        let oandaStatus = { connected: false, latencyMs: null, error: null };
        if (OANDA_API_KEY) {
            try {
                const oandaStart = Date.now();
                await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`);
                oandaStatus = {
                    connected: true,
                    latencyMs: Date.now() - oandaStart,
                    environment: process.env.OANDA_ENVIRONMENT || "live",
                };
            } catch (err) {
                oandaStatus = {
                    connected: false,
                    latencyMs: null,
                    error: err.message,
                };
            }
        }

        // Get service statuses
        const dataServiceStatus = dataService
            ? {
                  isRunning: dataService.isRunning || false,
                  instruments: dataService.instruments || [],
                  priceCount: Object.keys(dataService.getAllPrices?.() || {})
                      .length,
                  lastUpdate: dataService.lastUpdate || null,
              }
            : { isRunning: false };

        const signalGenStatus = signalGenerator
            ? {
                  isActive: signalGenerator.isRunning || false,
                  activeSignals: signalGenerator.latestSignals?.length || 0,
                  pendingEntries: signalGenerator._pendingEntries?.size || 0,
                  lastRun: signalGenerator.lastRunTime || null,
              }
            : { isActive: false };

        const engineStatus = tradingEngine
            ? {
                  isRunning: tradingEngine.isRunning || false,
                  openPositions: tradingEngine.openTrades?.size || 0,
                  stats: tradingEngine.stats || {},
              }
            : { isRunning: false };

        // Calculate uptime
        const uptimeSeconds = process.uptime();
        const uptimeFormatted = formatUptime(uptimeSeconds);

        // Overall status
        const isHealthy =
            oandaStatus.connected &&
            dataServiceStatus.isRunning &&
            signalGenStatus.isActive;

        res.json({
            status: isHealthy ? "healthy" : "degraded",
            timestamp: new Date().toISOString(),
            uptime: uptimeSeconds,
            uptimeFormatted,
            services: {
                oanda: oandaStatus,
                dataService: dataServiceStatus,
                signalGenerator: signalGenStatus,
                tradingEngine: engineStatus,
                configService: {
                    loaded: !!configService,
                    tradingEnabled: config.enableTrading || false,
                },
            },
            config: {
                enableTrading: config.enableTrading || false,
                tradingMode: config.tradingMode || "live",
                assets: config.assets || [],
                strategy: config.strategy || "supertrend_momentum",
                timeframe: config.timeframe || "15m",
                maxOpenPositions: config.maxOpenPositions || 2,
            },
            activeSignals: signalGenerator?.latestSignals || [],
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

/**
 * GET /api/system/info
 * Server details, memory usage, environment
 */
router.get("/system/info", (req, res) => {
    try {
        const memoryUsage = process.memoryUsage();
        const tradingEngine = req.app.locals.tradingEngine;

        res.json({
            server: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                pid: process.pid,
                cwd: process.cwd(),
            },
            memory: {
                heapUsed: memoryUsage.heapUsed,
                heapTotal: memoryUsage.heapTotal,
                external: memoryUsage.external,
                rss: memoryUsage.rss,
                formatted: {
                    heapUsed: formatBytes(memoryUsage.heapUsed),
                    heapTotal: formatBytes(memoryUsage.heapTotal),
                    rss: formatBytes(memoryUsage.rss),
                },
            },
            environment: {
                nodeEnv: process.env.NODE_ENV || "development",
                port: process.env.PORT || 3101,
                hasApiKeys: !!OANDA_API_KEY,
                oandaEnvironment: process.env.OANDA_ENVIRONMENT || "live",
                accountId: OANDA_ACCOUNT_ID,
            },
            tradingEngine: tradingEngine
                ? {
                      isRunning: tradingEngine.isRunning,
                      openTrades: tradingEngine.openTrades?.size || 0,
                      stats: tradingEngine.stats,
                  }
                : null,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
