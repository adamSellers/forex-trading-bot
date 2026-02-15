// backend/src/routes/tradingRoutes.js - Trading API Routes with Engine Support
const express = require("express");
const router = express.Router();

// Oanda configuration
const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

// Helper: Make Oanda API request
async function oandaRequest(endpoint) {
    const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${OANDA_API_KEY}`,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Oanda API error: ${response.status} - ${error}`);
    }

    return response.json();
}

// Helper: Calculate pip value
function getPipValue(instrument) {
    return instrument.includes("JPY") ? 0.01 : 0.0001;
}

// Helper: Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Helper: Format uptime to human readable
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

// ============ HEALTH & STATUS ============

// Health check - INCLUDES CONFIG for dashboard
router.get("/health", (req, res) => {
    const dataService = req.app.locals.dataService;
    const signalGenerator = req.app.locals.signalGenerator;
    const configService = req.app.locals.configService;
    const tradingEngine = req.app.locals.tradingEngine;

    const config = configService ? configService.get() : {};

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

// Comprehensive system health check
router.get("/system/health", async (req, res) => {
    try {
        const dataService = req.app.locals.dataService;
        const signalGenerator = req.app.locals.signalGenerator;
        const configService = req.app.locals.configService;
        const tradingEngine = req.app.locals.tradingEngine;

        const config = configService ? configService.get() : {};

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

        const uptimeSeconds = process.uptime();
        const uptimeFormatted = formatUptime(uptimeSeconds);

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

// Test email endpoint
router.post("/email/test", async (req, res) => {
    try {
        const emailService = req.app.locals.emailService;
        const configService = req.app.locals.configService;
        const config = configService?.get() || {};

        // Use address from request body, or from config, or from env
        const toAddress = req.body?.email || config.alertEmail || process.env.EMAIL_TO;

        if (!emailService?.initialized) {
            return res.status(400).json({
                success: false,
                error: "Email service not configured. Set EMAIL_USER and EMAIL_PASS environment variables.",
            });
        }

        if (!toAddress) {
            return res.status(400).json({
                success: false,
                error: "No email address provided. Pass email in request body or set alertEmail in config.",
            });
        }

        await emailService.sendTestEmail(toAddress);
        res.json({
            success: true,
            message: `Test email sent to ${toAddress}`,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// System info endpoint
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

// ============ MARKET DATA ============

// Account info - LIVE from Oanda
router.get("/account", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/summary`
        );
        const account = data.account;

        res.json({
            balance: parseFloat(account.balance),
            currency: account.currency,
            marginUsed: parseFloat(account.marginUsed),
            marginAvailable: parseFloat(account.marginAvailable),
            openTrades: account.openTradeCount,
            unrealizedPL: parseFloat(account.unrealizedPL),
            pl: parseFloat(account.pl),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Live prices - Uses config assets
router.get("/prices", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        const configService = req.app.locals.configService;
        const configAssets = configService?.getValue("assets") || [
            "AUD_USD",
            "EUR_USD",
            "GBP_USD",
            "USD_JPY",
        ];
        const instruments = req.query.instruments || configAssets.join(",");

        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${instruments}`
        );

        const prices = data.prices.map((price) => {
            const bid = parseFloat(price.bids?.[0]?.price || 0);
            const ask = parseFloat(price.asks?.[0]?.price || 0);
            const pipValue = getPipValue(price.instrument);
            const spread = (ask - bid) / pipValue;

            return {
                instrument: price.instrument,
                bid,
                ask,
                mid: (bid + ask) / 2,
                spread: parseFloat(spread.toFixed(1)),
                tradeable: price.tradeable,
                time: price.time,
            };
        });

        res.json({
            prices,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get candles for an instrument
router.get("/candles/:instrument", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        const { instrument } = req.params;
        const granularity = req.query.granularity || "M15";
        const count = req.query.count || 100;

        const data = await oandaRequest(
            `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
        );

        const candles = data.candles
            .filter((c) => c.complete)
            .map((c) => ({
                time: c.time,
                open: parseFloat(c.mid.o),
                high: parseFloat(c.mid.h),
                low: parseFloat(c.mid.l),
                close: parseFloat(c.mid.c),
                volume: c.volume,
            }));

        res.json({
            instrument,
            granularity,
            candles,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trading signals - from SignalGenerator
router.get("/signals", async (req, res) => {
    try {
        const signalGenerator = req.app.locals.signalGenerator;

        if (!signalGenerator) {
            return res.json({ signals: [], timestamp: Date.now() });
        }

        const status = signalGenerator.getStatus();

        res.json({
            signals: status.activeSignals || [],
            pendingEntries: status.pendingEntries || [],
            isActive: status.isActive,
            config: {
                minAdx: status.config?.minAdx,
                timeframe: status.config?.timeframe,
                assets: status.config?.assets,
            },
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ PORTFOLIO & TRADES ============

// Portfolio / positions
router.get("/portfolio", async (req, res) => {
    try {
        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        const [accountData, tradesData] = await Promise.all([
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`),
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/openTrades`),
        ]);

        const account = accountData.account;
        const trades = tradesData.trades.map((t) => ({
            id: t.id,
            instrument: t.instrument,
            units: parseFloat(t.currentUnits),
            side: parseFloat(t.currentUnits) > 0 ? "BUY" : "SELL",
            entryPrice: parseFloat(t.price),
            unrealizedPL: parseFloat(t.unrealizedPL),
            marginUsed: parseFloat(t.marginUsed || 0),
            openTime: t.openTime,
        }));

        res.json({
            balance: parseFloat(account.balance),
            currency: account.currency,
            positions: trades,
            totalValue: parseFloat(account.NAV),
            unrealizedPnL: parseFloat(account.unrealizedPL),
            realizedPnL: parseFloat(account.pl),
            marginUsed: parseFloat(account.marginUsed),
            marginAvailable: parseFloat(account.marginAvailable),
            exposure: trades.length > 0 ? "Active" : "None",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trade history from database
router.get("/trades", async (req, res) => {
    try {
        let tradeRepo = req.app.locals.tradeRepository;

        if (!tradeRepo) {
            const TradeRepository = require("../repositories/tradeRepository");
            tradeRepo = new TradeRepository();
        }

        const limit = parseInt(req.query.limit) || 20;
        const trades = await tradeRepo.getRecent(limit);

        res.json({
            trades,
            total: trades.length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Force close a position via Oanda
router.post("/trade/close/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!OANDA_API_KEY) {
            return res
                .status(503)
                .json({ error: "Oanda API key not configured" });
        }

        const response = await fetch(
            `${OANDA_BASE_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${id}/close`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${OANDA_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Failed to close trade: ${error}`);
        }

        const data = await response.json();

        // Sync trading engine after manual close
        const tradingEngine = req.app.locals.tradingEngine;
        if (tradingEngine) {
            await tradingEngine.syncWithOanda();
        }

        res.json({
            success: true,
            message: `Position ${id} closed`,
            orderFillTransaction: data.orderFillTransaction,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TRADING CONTROL ============

router.post("/trading/start", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (configService) {
            configService.update({ enableTrading: true });
        }

        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) broadcastEngineStatus();

        res.json({ success: true, message: "Trading enabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/trading/stop", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (configService) {
            configService.update({ enableTrading: false });
        }

        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) broadcastEngineStatus();

        res.json({ success: true, message: "Trading disabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/trading/reset", (req, res) => {
    try {
        const signalGenerator = req.app.locals.signalGenerator;
        if (signalGenerator) {
            signalGenerator.reset();
        }
        res.json({ success: true, message: "Signal generator reset" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ CONFIG ============

router.get("/config", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!configService) {
            return res
                .status(503)
                .json({ error: "Config service not available" });
        }
        res.json(configService.get());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/config", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!configService) {
            return res
                .status(503)
                .json({ error: "Config service not available" });
        }

        const updatedConfig = configService.update(req.body);

        const broadcastConfig = req.app.locals.broadcastConfig;
        if (broadcastConfig) {
            broadcastConfig(updatedConfig);
        }

        res.json({
            success: true,
            config: updatedConfig,
            message: "Configuration updated and applied to services",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/config/reset", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!configService) {
            return res
                .status(503)
                .json({ error: "Config service not available" });
        }

        const defaultConfig = configService.reset();

        const broadcastConfig = req.app.locals.broadcastConfig;
        if (broadcastConfig) {
            broadcastConfig(defaultConfig);
        }

        res.json({
            success: true,
            config: defaultConfig,
            message: "Configuration reset to defaults",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ TRADING ENGINE ============

// Get engine status
router.get("/engine/status", (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }
        res.json(tradingEngine.getStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get engine stats
router.get("/engine/stats", (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        res.json({
            isRunning: tradingEngine.isRunning,
            stats: tradingEngine.stats,
            openPositions: tradingEngine.openTrades?.size || 0,
            queueLength: tradingEngine.tradeQueue?.length || 0,
            isProcessingQueue: tradingEngine.isProcessingQueue || false,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get open trades from engine
router.get("/engine/trades", (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        res.json({
            trades: tradingEngine.getOpenTrades(),
            count: tradingEngine.openTrades?.size || 0,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Close a trade via engine
router.post("/engine/close/:tradeId", async (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        const { tradeId } = req.params;
        await tradingEngine.forceCloseTrade(tradeId);

        res.json({
            success: true,
            message: `Trade ${tradeId} closed`,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sync engine with Oanda
router.post("/engine/sync", async (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        await tradingEngine.syncOpenTrades();
        await tradingEngine.syncWithOanda();

        res.json({
            success: true,
            message: "Trading engine synced with Oanda",
            openTrades: tradingEngine.openTrades?.size || 0,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset engine stats
router.post("/engine/reset-stats", (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        tradingEngine.resetStats();

        res.json({
            success: true,
            message: "Trading engine stats reset",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ANALYTICS ============

router.get("/analytics", async (req, res) => {
    try {
        const TradeRepository = require("../repositories/tradeRepository");
        const SignalRepository = require("../repositories/signalRepository");
        const AnalyticsService = require("../services/analyticsService");

        const tradeRepo = new TradeRepository();
        const signalRepo = new SignalRepository();
        const analyticsService = new AnalyticsService(tradeRepo, signalRepo);

        const period = req.query.period || "30d";
        const analytics = await analyticsService.getAnalytics(period);

        res.json(analytics);
    } catch (error) {
        console.error("Analytics error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============ S3 REPORTS ============

// Get S3 report scheduler status
router.get("/reports/status", (req, res) => {
    try {
        const s3ReportScheduler = req.app.locals.s3ReportScheduler;
        if (!s3ReportScheduler) {
            return res.status(503).json({ error: "S3 report scheduler not available" });
        }
        res.json(s3ReportScheduler.getStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manually trigger a report upload
router.post("/reports/upload", async (req, res) => {
    try {
        const s3ReportScheduler = req.app.locals.s3ReportScheduler;
        if (!s3ReportScheduler) {
            return res.status(503).json({ error: "S3 report scheduler not available" });
        }

        const period = req.body.period || "24h";
        const result = await s3ReportScheduler.forceUpload(period);

        if (result.success) {
            res.json({
                success: true,
                message: `Report uploaded to S3`,
                key: result.key,
            });
        } else {
            res.status(500).json({
                success: false,
                error: result.error || "Upload failed",
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger daily report upload
router.post("/reports/upload/daily", async (req, res) => {
    try {
        const s3ReportScheduler = req.app.locals.s3ReportScheduler;
        if (!s3ReportScheduler) {
            return res.status(503).json({ error: "S3 report scheduler not available" });
        }

        const success = await s3ReportScheduler.uploadDailyReport();
        res.json({
            success,
            message: success ? "Daily report uploaded" : "Upload failed (check logs)",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger weekly report upload
router.post("/reports/upload/weekly", async (req, res) => {
    try {
        const s3ReportScheduler = req.app.locals.s3ReportScheduler;
        if (!s3ReportScheduler) {
            return res.status(503).json({ error: "S3 report scheduler not available" });
        }

        const success = await s3ReportScheduler.uploadWeeklyReport();
        res.json({
            success,
            message: success ? "Weekly report uploaded" : "Upload failed (check logs)",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ BACKTESTING ============

// Run a backtest on historical data
router.post("/backtest/run", async (req, res) => {
    try {
        const { instrument, from, to, granularity, label, config: configOverrides } = req.body;

        // Validate required fields
        if (!instrument || !from || !to) {
            return res.status(400).json({
                error: "Missing required fields: instrument, from, to",
            });
        }

        // Convert date strings to UNIX timestamps (seconds)
        const fromTimestamp = Math.floor(new Date(from).getTime() / 1000);
        const toTimestamp = Math.floor(new Date(to).getTime() / 1000);

        if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
            return res.status(400).json({
                error: "Invalid date format. Use YYYY-MM-DD.",
            });
        }

        if (fromTimestamp >= toTimestamp) {
            return res.status(400).json({
                error: "'from' must be before 'to'",
            });
        }

        const gran = granularity || "M15";

        // Create services on-demand (stateless, backtests are infrequent)
        const HistoricalDataService = require("../services/historicalDataService");
        const BacktestEngine = require("../services/backtestEngine");
        const BacktestRepository = require("../repositories/backtestRepository");

        const historicalDataService = new HistoricalDataService();
        const engine = new BacktestEngine(historicalDataService);
        const backtestRepo = req.app.locals.backtestRepository || new BacktestRepository();

        // Run backtest (may take 10-30s for large date ranges due to Oanda rate limits)
        const result = await engine.run(instrument, gran, fromTimestamp, toTimestamp, configOverrides || {});

        // Save result to database
        const backtestId = await backtestRepo.save(
            result, instrument, gran, fromTimestamp, toTimestamp, label || null
        );

        // Return summary (not full trade list — use GET /results/:id for that)
        res.json({
            success: true,
            backtestId,
            instrument,
            granularity: gran,
            from,
            to,
            summary: result.summary,
        });
    } catch (error) {
        console.error("Backtest error:", error);
        res.status(500).json({ error: error.message });
    }
});

// List recent backtest results (summary only)
router.get("/backtest/results", async (req, res) => {
    try {
        const BacktestRepository = require("../repositories/backtestRepository");
        const backtestRepo = req.app.locals.backtestRepository || new BacktestRepository();

        const limit = parseInt(req.query.limit) || 20;
        const instrument = req.query.instrument || null;

        const results = await backtestRepo.getRecent(limit, instrument);
        res.json({ results, total: results.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get a specific backtest result (includes full trades and equity curve)
router.get("/backtest/results/:id", async (req, res) => {
    try {
        const BacktestRepository = require("../repositories/backtestRepository");
        const backtestRepo = req.app.locals.backtestRepository || new BacktestRepository();

        const result = await backtestRepo.getById(req.params.id);
        if (!result) {
            return res.status(404).json({ error: "Backtest result not found" });
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a backtest result
router.delete("/backtest/results/:id", async (req, res) => {
    try {
        const BacktestRepository = require("../repositories/backtestRepository");
        const backtestRepo = req.app.locals.backtestRepository || new BacktestRepository();

        const deleted = await backtestRepo.delete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: "Backtest result not found" });
        }

        res.json({ success: true, message: "Backtest result deleted" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
