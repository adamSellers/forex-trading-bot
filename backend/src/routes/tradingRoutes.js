// backend/src/routes/tradingRoutes.js - Trading API Routes with Engine Support
const express = require("express");
const router = express.Router();
const { listStrategyCatalog, getStrategyDefinition } = require("../strategies");
const { RUNTIME_MODES } = require("../runtime/runtimeConstants");
const logger = require("../utils/logger");

function isLiveSelectionReady(strategyDefinition = {}) {
    return (
        ["baseline", "live_ready"].includes(strategyDefinition.runtimeStatus) ||
        strategyDefinition.metadata?.supportsLive === true
    );
}

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

function getRuntimeCoordinator(req) {
    return req.app.locals.runtimeCoordinator || req.app.locals.signalGenerator;
}

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function parseLimit(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isForexMarketOpen(date = new Date()) {
    const utcDay = date.getUTCDay();
    const utcHour = date.getUTCHours();

    if (utcDay === 6) return false;
    if (utcDay === 0 && utcHour < 21) return false;
    if (utcDay === 5 && utcHour >= 21) return false;

    return true;
}

async function restartTradingEngine(tradingEngine) {
    await tradingEngine.start();
    tradingEngine.startMonitoring();
}

async function liquidateOpenLivePositions(
    tradingEngine,
    dataService,
    exitReason = "STRATEGY_PROMOTION"
) {
    await tradingEngine.syncOpenTrades();

    if (dataService?.fetchAllPrices) {
        await dataService.fetchAllPrices();
    }

    const closedTrades = await tradingEngine.liquidateOpenTrades(exitReason);
    await tradingEngine.syncOpenTrades();

    const remainingOpenTrades = tradingEngine.getOpenTrades();
    if (remainingOpenTrades.length > 0) {
        throw new Error(
            `Unable to liquidate all live positions before switching (${remainingOpenTrades.length} still open)`
        );
    }

    return closedTrades;
}

function normalizeRuntimeQueryFilters(query = {}) {
    const filters = {};
    const mode = normalizeString(query.mode);
    const strategy = normalizeString(query.strategy);
    const status = normalizeString(query.status);
    const runId = normalizeString(query.runId);
    const selectionId = normalizeString(query.selectionId);
    const shadowOfRunId = normalizeString(query.shadowOfRunId);

    if (mode && mode !== "all") {
        filters.mode = mode;
    }
    if (strategy) {
        filters.strategy = strategy;
    }
    if (status) {
        filters.status = status;
    }
    if (runId) {
        filters.runId = runId;
    }
    if (selectionId) {
        filters.selectionId = selectionId;
    }
    if (shadowOfRunId) {
        filters.shadowOfRunId = shadowOfRunId;
    }

    return filters;
}

function normalizeRunResponse(run = {}, latestSignalCount = 0) {
    return {
        runId: run.runId,
        mode: run.mode,
        strategy: run.strategy,
        status: run.status,
        selectionId: run.selectionId || null,
        shadowOfRunId: run.shadowOfRunId || null,
        configHash: run.configHash || null,
        configSnapshot: run.configSnapshot || null,
        startedAt: run.startedAt,
        stoppedAt: run.stoppedAt ?? null,
        metadata: run.metadata || {},
        latestSignalCount,
    };
}

function filterRuntimeRuns(runs = [], filters = {}) {
    const { mode, strategy, status, runId, selectionId, shadowOfRunId } = filters;

    return runs.filter((run) => {
        if (mode && run.mode !== mode) return false;
        if (strategy && run.strategy !== strategy) return false;
        if (status && run.status !== status) return false;
        if (runId && run.runId !== runId) return false;
        if (selectionId && run.selectionId !== selectionId) return false;
        if (shadowOfRunId && run.shadowOfRunId !== shadowOfRunId) return false;
        return true;
    });
}

async function buildRuntimeRunsResponse(req, filters = {}) {
    const runtimeCoordinator = getRuntimeCoordinator(req);
    const paperTradingRuntime = req.app.locals.paperTradingRuntime;
    const strategyRunRepository = req.app.locals.strategyRunRepository;
    const normalizedFilters = normalizeRuntimeQueryFilters(filters);
    const activeRuns = filterRuntimeRuns(
        runtimeCoordinator.listRuns?.() || [],
        normalizedFilters
    );
    const persistedRuns = strategyRunRepository?.list
        ? await strategyRunRepository.list(normalizedFilters)
        : [];
    const mergedRuns = new Map();

    persistedRuns.forEach((run) => {
        mergedRuns.set(run.runId, normalizeRunResponse(run));
    });

    activeRuns.forEach((run) => {
        const session = runtimeCoordinator.getRunSession?.(run.runId);
        if (session?.run) {
            mergedRuns.set(
                run.runId,
                normalizeRunResponse(
                    session.run,
                    session.latestSignals?.length || run.latestSignalCount || 0
                )
            );
            return;
        }

        mergedRuns.set(
            run.runId,
            normalizeRunResponse(run, run.latestSignalCount || 0)
        );
    });

    let runs = Array.from(mergedRuns.values()).sort(
        (left, right) => (right.startedAt || 0) - (left.startedAt || 0)
    );
    runs = paperTradingRuntime?.enrichRuns
        ? await paperTradingRuntime.enrichRuns(runs)
        : runs;

    return {
        runs,
        liveSelection: runtimeCoordinator.getLiveSelection?.() || null,
        timestamp: Date.now(),
    };
}

async function resolveRunForResponse(req, runId) {
    const runtimeCoordinator = getRuntimeCoordinator(req);
    const strategyRunRepository = req.app.locals.strategyRunRepository;

    if (!runId) return null;

    const session = runtimeCoordinator?.getRunSession?.(runId) || null;
    if (session?.run) {
        return normalizeRunResponse(
            session.run,
            session.latestSignals?.length || 0
        );
    }

    const persistedRun = await strategyRunRepository?.getByRunId?.(runId);
    if (!persistedRun) {
        return null;
    }

    return normalizeRunResponse(persistedRun);
}

// ============ HEALTH & STATUS ============

router.get("/strategies/catalog", (req, res) => {
    try {
        res.json({
            strategies: listStrategyCatalog(),
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
            timesFmEnabled: config.timesFmEnabled === true,
            timesFmMode: config.timesFmMode || "disabled",
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
        await signalGenerator?.refreshTimesFmHealth?.();
        const timesFmStatus = signalGenerator?.getTimesFmStatus?.() || {
            enabled: false,
            mode: "disabled",
            configured: false,
            connected: false,
            available: false,
            status: "disabled",
            ready: false,
        };

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
        const candleCache = dataService?.candleCache || {};
        const candleCount = Object.values(candleCache).reduce(
            (total, candles) => total + (Array.isArray(candles) ? candles.length : 0),
            0
        );
        const dataServiceStatus = dataService
            ? {
                  isRunning: dataService.isRunning || false,
                  instruments: dataService.instruments || [],
                  priceCount: Object.keys(dataService.getAllPrices?.() || {})
                      .length,
                  candlesCached: Object.keys(candleCache).length,
                  candleCount,
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

        const coreHealthy =
            oandaStatus.connected &&
            dataServiceStatus.isRunning &&
            signalGenStatus.isActive;
        const timesFmExpected =
            timesFmStatus.enabled === true &&
            timesFmStatus.mode !== "disabled" &&
            timesFmStatus.configured === true;
        const isHealthy =
            coreHealthy && (!timesFmExpected || timesFmStatus.available === true);

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
                timesFm: timesFmStatus,
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
                timesFmEnabled: config.timesFmEnabled === true,
                timesFmMode: config.timesFmMode || "disabled",
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

// Trading signals - current live runtime snapshot, with persisted fallback
router.get("/signals", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        const signalRepository = req.app.locals.signalRepository;

        if (!runtimeCoordinator) {
            return res.json({ signals: [], timestamp: Date.now() });
        }

        const status = runtimeCoordinator.getStatus();
        const limit = parseLimit(req.query.limit, 50);
        let signals = Array.isArray(status.activeSignals)
            ? status.activeSignals
            : [];

        if (signals.length === 0 && signalRepository?.getRecent) {
            const liveSelection = runtimeCoordinator.getLiveSelection?.();
            const liveRunId = liveSelection?.liveRun?.runId || liveSelection?.liveRunId;

            if (liveRunId) {
                signals = await signalRepository.getRecent(limit, {
                    mode: RUNTIME_MODES.LIVE,
                    runId: liveRunId,
                });
            }
        }

        res.json({
            signals: signals.slice(0, limit),
            pendingEntries: status.pendingEntries || [],
            isActive: status.isActive,
            config: {
                minAdx: status.config?.minAdx,
                timeframe: status.config?.timeframe,
                assets: status.config?.assets,
                strategy: status.config?.strategy,
            },
            liveSelection: runtimeCoordinator.getLiveSelection?.() || null,
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

router.get("/runtime/live-selection", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        if (!runtimeCoordinator) {
            return res
                .status(503)
                .json({ error: "Runtime coordinator not available" });
        }

        const liveSelection =
            (await runtimeCoordinator.ensureLiveSelectionInitialized?.()) ||
            runtimeCoordinator.getLiveSelection?.() ||
            null;

        const runtimePayload = await buildRuntimeRunsResponse(req);

        res.json({
            liveSelection,
            runs: runtimePayload.runs,
            timestamp: runtimePayload.timestamp,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/runtime/live-selection", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        const configService = req.app.locals.configService;

        if (!runtimeCoordinator) {
            return res
                .status(503)
                .json({ error: "Runtime coordinator not available" });
        }
        if (!configService) {
            return res
                .status(503)
                .json({ error: "Config service not available" });
        }

        const strategyKey = req.body?.strategyKey || req.body?.strategy;
        if (!strategyKey) {
            return res.status(400).json({
                error: "strategyKey is required",
            });
        }

        const strategyDefinition = getStrategyDefinition(strategyKey);
        const currentLiveStrategyKey =
            runtimeCoordinator.getLiveSelection?.()?.strategy || null;
        const isCurrentLiveStrategy =
            currentLiveStrategyKey === strategyKey;

        if (!isLiveSelectionReady(strategyDefinition) && !isCurrentLiveStrategy) {
            return res.status(400).json({
                error: `${strategyDefinition.label} is not available for live selection yet`,
            });
        }

        const requestedConfig =
            req.body?.configSnapshot || req.body?.config || null;
        const nextConfig = {
            ...configService.get(),
            ...(requestedConfig || {}),
            strategy: strategyKey,
        };
        const liveSelection = await runtimeCoordinator.selectLiveStrategy({
            strategyKey,
            configSnapshot: nextConfig,
            initiatedBy: "ui",
        });
        configService.update(nextConfig);

        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) {
            broadcastEngineStatus();
        }

        const runtimePayload = await buildRuntimeRunsResponse(req);

        res.json({
            success: true,
            liveSelection,
            runs: runtimePayload.runs,
            message: "Live strategy selection updated",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/runtime/runs/:runId/promote", async (req, res) => {
    const runtimeCoordinator = getRuntimeCoordinator(req);
    const configService = req.app.locals.configService;
    const tradingEngine = req.app.locals.tradingEngine;
    const dataService = req.app.locals.dataService;
    const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;

    if (!runtimeCoordinator) {
        return res
            .status(503)
            .json({ error: "Runtime coordinator not available" });
    }
    if (!configService) {
        return res
            .status(503)
            .json({ error: "Config service not available" });
    }
    if (!tradingEngine) {
        return res
            .status(503)
            .json({ error: "Trading engine not available" });
    }

    const run = await resolveRunForResponse(req, req.params.runId);
    if (!run) {
        return res.status(404).json({ error: "Run not found" });
    }
    if (run.mode !== RUNTIME_MODES.PAPER_CANDIDATE) {
        return res.status(400).json({
            error: "Only candidate paper runs can be promoted to live",
        });
    }

    const strategyDefinition = getStrategyDefinition(run.strategy);
    if (
        strategyDefinition.metadata?.supportsLive !== true &&
        !isLiveSelectionReady(strategyDefinition)
    ) {
        return res.status(400).json({
            error: `${strategyDefinition.label} does not support live promotion`,
        });
    }

    const marketOpen = isForexMarketOpen();
    const engineWasRunning = tradingEngine.isRunning === true;
    let engineRestarted = false;
    let engineRestartWarning = null;
    let liquidatedTrades = [];

    try {
        await tradingEngine.syncOpenTrades();
        const openTradesBefore = tradingEngine.getOpenTrades();

        if (!marketOpen && openTradesBefore.length > 0) {
            return res.status(409).json({
                error:
                    "Markets are closed and live positions are still open. Reopen the market or flatten positions before promoting.",
                marketOpen,
                openPositions: openTradesBefore.length,
            });
        }

        if (engineWasRunning) {
            tradingEngine.stop();
            if (broadcastEngineStatus) {
                broadcastEngineStatus();
            }
        }

        try {
            if (openTradesBefore.length > 0) {
                liquidatedTrades = await liquidateOpenLivePositions(
                    tradingEngine,
                    dataService
                );
            }

            const nextConfig = {
                ...configService.get(),
                ...(run.configSnapshot || {}),
                strategy: run.strategy,
            };

            const liveSelection = await runtimeCoordinator.selectLiveStrategy({
                strategyKey: run.strategy,
                configSnapshot: nextConfig,
                initiatedBy: "paper-promotion",
            });

            try {
                await runtimeCoordinator.updateRun?.(run.runId, {
                    metadata: {
                        ...(run.metadata || {}),
                        promotionStatus: "promoted_to_live",
                        promotedAt: Date.now(),
                        promotedToSelectionId:
                            liveSelection?.selectionId || null,
                        promotedToLiveRunId:
                            liveSelection?.liveRun?.runId ||
                            liveSelection?.liveRunId ||
                            null,
                        promotedToShadowRunId:
                            liveSelection?.shadowRun?.runId ||
                            liveSelection?.shadowRunId ||
                            null,
                    },
                });
            } catch (metadataError) {
                logger.warn(
                    `Failed to annotate promoted candidate run ${run.runId}: ${metadataError.message}`
                );
            }

            configService.update(nextConfig);

            if (engineWasRunning) {
                try {
                    await restartTradingEngine(tradingEngine);
                    engineRestarted = true;
                } catch (restartError) {
                    engineRestartWarning = restartError.message;
                }
            }

            if (broadcastEngineStatus) {
                broadcastEngineStatus();
            }

            const runtimePayload = await buildRuntimeRunsResponse(req);

            return res.json({
                success: true,
                liveSelection,
                runs: runtimePayload.runs,
                message: `${strategyDefinition.label} promoted to live`,
                promotion: {
                    marketOpen,
                    engineWasRunning,
                    engineRestarted,
                    engineRestartWarning,
                    liquidatedTrades: liquidatedTrades.map((trade) => ({
                        tradeId: trade.id,
                        instrument: trade.instrument,
                        side: trade.side,
                        exitReason: trade.exitReason,
                    })),
                    promotedFromRunId: run.runId,
                    strategy: run.strategy,
                },
            });
        } catch (error) {
            if (engineWasRunning && !tradingEngine.isRunning) {
                try {
                    await restartTradingEngine(tradingEngine);
                    engineRestarted = true;
                } catch (restartError) {
                    engineRestartWarning = restartError.message;
                }
            }

            if (broadcastEngineStatus) {
                broadcastEngineStatus();
            }

            return res.status(500).json({
                error: error.message,
                promotion: {
                    marketOpen,
                    engineWasRunning,
                    engineRestarted,
                    engineRestartWarning,
                    liquidatedTrades: liquidatedTrades.map((trade) => ({
                        tradeId: trade.id,
                        instrument: trade.instrument,
                        side: trade.side,
                        exitReason: trade.exitReason,
                    })),
                    promotedFromRunId: run.runId,
                    strategy: run.strategy,
                },
            });
        }
    } catch (error) {
        if (broadcastEngineStatus) {
            broadcastEngineStatus();
        }

        return res.status(500).json({ error: error.message });
    }
});

router.post("/runtime/runs", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        const paperTradingRuntime = req.app.locals.paperTradingRuntime;

        if (!runtimeCoordinator) {
            return res
                .status(503)
                .json({ error: "Runtime coordinator not available" });
        }
        if (!paperTradingRuntime) {
            return res
                .status(503)
                .json({ error: "Paper trading runtime not available" });
        }

        const strategyKey = req.body?.strategyKey || req.body?.strategy;
        if (!strategyKey) {
            return res.status(400).json({ error: "strategyKey is required" });
        }

        const run = await runtimeCoordinator.createCandidateRun({
            strategyKey,
            configSnapshot: req.body?.configSnapshot || req.body?.config || null,
            initiatedBy: "ui",
            metadata: {
                displayName: req.body?.label || null,
                notes: req.body?.notes || null,
            },
        });

        await paperTradingRuntime.ensureRunSnapshot(run.runId);

        const runtimePayload = await buildRuntimeRunsResponse(req);
        const createdRun = runtimePayload.runs.find(
            (candidate) => candidate.runId === run.runId
        );

        res.json({
            success: true,
            run: createdRun || run,
            runs: runtimePayload.runs,
            liveSelection: runtimePayload.liveSelection,
            message: "Candidate paper run started",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        if (!runtimeCoordinator) {
            return res
                .status(503)
                .json({ error: "Runtime coordinator not available" });
        }

        await runtimeCoordinator.ensureLiveSelectionInitialized?.();
        const runtimePayload = await buildRuntimeRunsResponse(req, req.query || {});

        res.json(runtimePayload);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs/:runId/trades", async (req, res) => {
    try {
        const tradeRepository = req.app.locals.tradeRepository;
        const run = await resolveRunForResponse(req, req.params.runId);

        if (!run) {
            return res.status(404).json({ error: "Run not found" });
        }

        const limit = parseLimit(req.query.limit, 200);
        const trades = await tradeRepository.getAllTrades({
            mode: run.mode,
            ownerRunId: run.runId,
        });
        const sortedTrades = [...trades]
            .sort(
                (left, right) =>
                    (right.exitTime || right.entryTime || 0) -
                    (left.exitTime || left.entryTime || 0)
            )
            .slice(0, limit);

        res.json({
            run,
            trades: sortedTrades,
            total: trades.length,
            openTrades: trades.filter((trade) => trade.isOpen).length,
            closedTrades: trades.filter((trade) => !trade.isOpen).length,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs/:runId/signals", async (req, res) => {
    try {
        const signalRepository = req.app.locals.signalRepository;
        const run = await resolveRunForResponse(req, req.params.runId);

        if (!run) {
            return res.status(404).json({ error: "Run not found" });
        }

        const limit = parseLimit(req.query.limit, 250);
        const signals = await signalRepository.getRecent(limit, {
            mode: run.mode,
            runId: run.runId,
        });

        res.json({
            run,
            signals,
            total: signals.length,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs/:runId/equity", async (req, res) => {
    try {
        const tradeRepository = req.app.locals.tradeRepository;
        const signalRepository = req.app.locals.signalRepository;
        const entryDecisionRepository = req.app.locals.entryDecisionRepository;
        const portfolioRepository = req.app.locals.portfolioRepository;
        const AnalyticsService = require("../services/analyticsService");
        const analyticsService = new AnalyticsService(
            tradeRepository,
            signalRepository,
            entryDecisionRepository
        );
        const run = await resolveRunForResponse(req, req.params.runId);

        if (!run) {
            return res.status(404).json({ error: "Run not found" });
        }

        const limit = parseLimit(req.query.limit, 300);
        const history = await portfolioRepository.getHistory(limit, {
            mode: run.mode,
            runId: run.runId,
        });
        const ascendingHistory = [...history].reverse();

        if (ascendingHistory.length > 0) {
            const equityCurve = ascendingHistory.map((snapshot) => ({
                timestamp: snapshot.snapshotTime,
                totalValueAud: snapshot.totalValueAud,
                balanceAud: snapshot.balanceAud,
                realizedPnlAud: snapshot.realizedPnlAud,
                unrealizedPnlAud: snapshot.unrealizedPnlAud,
                marginUsedAud: snapshot.marginUsedAud,
                exposurePercent: snapshot.exposurePercent,
                positionCount: snapshot.positionCount,
            }));

            return res.json({
                run,
                source: "portfolio_snapshots",
                equityCurve,
                latestSnapshot: history[0] || null,
                total: equityCurve.length,
                timestamp: Date.now(),
            });
        }

        const trades = await tradeRepository.getAllTrades({
            mode: run.mode,
            ownerRunId: run.runId,
        });
        const closedTrades = trades.filter((trade) => !trade.isOpen);
        const equityData = analyticsService.calculateEquityData(closedTrades);

        res.json({
            run,
            source: "closed_trades",
            equityCurve: equityData.equityCurve || [],
            dailyPnL: equityData.dailyPnL || [],
            latestSnapshot: null,
            total: equityData.equityCurve?.length || 0,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/runtime/runs/:runId/stop", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        const paperTradingRuntime = req.app.locals.paperTradingRuntime;
        const { runId } = req.params;

        if (!runtimeCoordinator) {
            return res
                .status(503)
                .json({ error: "Runtime coordinator not available" });
        }
        if (!paperTradingRuntime) {
            return res
                .status(503)
                .json({ error: "Paper trading runtime not available" });
        }

        const session = runtimeCoordinator.getRunSession?.(runId);
        if (!session) {
            return res.status(404).json({ error: "Run not found" });
        }
        if (session.run.mode !== RUNTIME_MODES.PAPER_CANDIDATE) {
            return res.status(400).json({
                error: "Only candidate paper runs can be stopped manually",
            });
        }

        const stoppedRun = await paperTradingRuntime.stopRun(runId);
        const runtimePayload = await buildRuntimeRunsResponse(req);

        res.json({
            success: true,
            run: stoppedRun,
            runs: runtimePayload.runs,
            liveSelection: runtimePayload.liveSelection,
            message: "Candidate paper run stopped",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/runtime/runs/:runId/reset", async (req, res) => {
    try {
        const runtimeCoordinator = getRuntimeCoordinator(req);
        const paperTradingRuntime = req.app.locals.paperTradingRuntime;
        const { runId } = req.params;

        if (!runtimeCoordinator) {
            return res
                .status(503)
                .json({ error: "Runtime coordinator not available" });
        }
        if (!paperTradingRuntime) {
            return res
                .status(503)
                .json({ error: "Paper trading runtime not available" });
        }

        const session = runtimeCoordinator.getRunSession?.(runId);
        if (!session) {
            return res.status(404).json({ error: "Run not found" });
        }
        if (session.run.mode !== RUNTIME_MODES.PAPER_CANDIDATE) {
            return res.status(400).json({
                error: "Only candidate paper runs can be reset manually",
            });
        }

        const resetRun = await paperTradingRuntime.resetRun(runId);
        const runtimePayload = await buildRuntimeRunsResponse(req);
        const currentRun = runtimePayload.runs.find(
            (candidate) => candidate.runId === runId
        );

        res.json({
            success: true,
            run: currentRun || resetRun,
            runs: runtimePayload.runs,
            liveSelection: runtimePayload.liveSelection,
            message: "Candidate paper run reset",
        });
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

router.post("/engine/start", async (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        if (!tradingEngine.isRunning) {
            await restartTradingEngine(tradingEngine);
        }

        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) {
            broadcastEngineStatus();
        }

        res.json({
            success: true,
            isRunning: tradingEngine.isRunning,
            message: "Trading engine started",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/engine/stop", (req, res) => {
    try {
        const tradingEngine = req.app.locals.tradingEngine;
        if (!tradingEngine) {
            return res
                .status(503)
                .json({ error: "Trading engine not available" });
        }

        if (tradingEngine.isRunning) {
            tradingEngine.stop();
        }

        const broadcastEngineStatus = req.app.locals.broadcastEngineStatus;
        if (broadcastEngineStatus) {
            broadcastEngineStatus();
        }

        res.json({
            success: true,
            isRunning: tradingEngine.isRunning,
            message: "Trading engine stopped",
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ ANALYTICS ============

router.get("/analytics", async (req, res) => {
    try {
        const AnalyticsService = require("../services/analyticsService");
        const tradeRepo = req.app.locals.tradeRepository;
        const signalRepo = req.app.locals.signalRepository;
        const entryDecisionRepo = req.app.locals.entryDecisionRepository;
        const analyticsService = new AnalyticsService(
            tradeRepo,
            signalRepo,
            entryDecisionRepo
        );

        const period = req.query.period || "30d";
        const runtimeFilters = normalizeRuntimeQueryFilters(req.query || {});
        delete runtimeFilters.status;
        delete runtimeFilters.shadowOfRunId;

        const analytics = await analyticsService.getAnalytics(
            period,
            runtimeFilters
        );

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

module.exports = router;
