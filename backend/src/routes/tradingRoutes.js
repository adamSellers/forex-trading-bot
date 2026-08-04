// Live-only trading API.
const express = require("express");
const router = express.Router();

const {
    getStrategyDefinition,
    listStrategyCatalog,
} = require("../strategies");
const { RUNTIME_MODES } = require("../runtime/runtimeConstants");
const { evaluateLiveReadiness } = require("../runtime/liveReadiness");
const { buildOandaApiError } = require("../utils/oandaErrors");

const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID;
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

function getRuntimeCoordinator(req) {
    return req.app.locals.runtimeCoordinator || req.app.locals.signalGenerator;
}

function parseLimit(value, fallback, maximum = null) {
    const parsed = Number.parseInt(value, 10);
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    return maximum ? Math.min(limit, maximum) : limit;
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );
    return `${(bytes / 1024 ** index).toFixed(2)} ${units[index]}`;
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days) return `${days}d ${hours}h ${minutes}m`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function getPipValue(instrument) {
    return instrument.includes("JPY") ? 0.01 : 0.0001;
}

async function oandaRequest(endpoint, options = {}) {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        const error = new Error("Oanda credentials are not configured");
        error.statusCode = 503;
        throw error;
    }

    const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${OANDA_API_KEY}`,
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
    });
    if (!response.ok) throw await buildOandaApiError(response);
    return response.json();
}

function normalizeRun(run = {}, latestSignalCount = 0) {
    return {
        runId: run.runId,
        mode: RUNTIME_MODES.LIVE,
        strategy: run.strategy,
        status: run.status,
        selectionId: run.selectionId || null,
        parentRunId: run.parentRunId || null,
        configHash: run.configHash || null,
        configSnapshot: run.configSnapshot || null,
        metadata: run.metadata || {},
        startedAt: run.startedAt,
        stoppedAt: run.stoppedAt ?? null,
        latestSignalCount,
    };
}

async function resolveLiveRun(req, runId) {
    if (!runId) return null;
    const coordinator = getRuntimeCoordinator(req);
    const session = coordinator?.getRunSession?.(runId);
    if (session?.run?.mode === RUNTIME_MODES.LIVE) {
        return normalizeRun(session.run, session.latestSignals?.length || 0);
    }
    const persisted = await req.app.locals.strategyRunRepository?.getByRunId?.(
        runId
    );
    return persisted?.mode === RUNTIME_MODES.LIVE
        ? normalizeRun(persisted)
        : null;
}

async function buildLiveRuns(req, query = {}) {
    const coordinator = getRuntimeCoordinator(req);
    const repository = req.app.locals.strategyRunRepository;
    const limit = parseLimit(query.limit, 80, 200);
    const filters = { mode: RUNTIME_MODES.LIVE };
    if (query.strategy) filters.strategy = String(query.strategy);
    if (query.status) filters.status = String(query.status);
    if (query.runId) filters.runId = String(query.runId);
    if (query.selectionId) filters.selectionId = String(query.selectionId);

    const active = (coordinator?.listRuns?.() || []).filter(
        (run) => run.mode === RUNTIME_MODES.LIVE
    );
    const persisted = repository?.list ? await repository.list(filters) : [];
    const merged = new Map();
    persisted.forEach((run) => merged.set(run.runId, normalizeRun(run)));
    active.forEach((run) => {
        const session = coordinator?.getRunSession?.(run.runId);
        merged.set(
            run.runId,
            normalizeRun(session?.run || run, session?.latestSignals?.length || 0)
        );
    });

    return Array.from(merged.values())
        .filter((run) => !filters.strategy || run.strategy === filters.strategy)
        .filter((run) => !filters.status || run.status === filters.status)
        .filter((run) => !filters.runId || run.runId === filters.runId)
        .filter(
            (run) =>
                !filters.selectionId || run.selectionId === filters.selectionId
        )
        .sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0))
        .slice(0, limit);
}

function requireService(res, service, label) {
    if (service) return true;
    res.status(503).json({ error: `${label} not available` });
    return false;
}

router.get("/strategies/catalog", (_req, res) => {
    const strategies = listStrategyCatalog().filter(
        (strategy) => strategy.key === "carry_trend"
    );
    res.json({ strategies, liveOnly: true, timestamp: Date.now() });
});

router.get("/health", (req, res) => {
    const config = req.app.locals.configService?.get?.() || {};
    const coordinator = getRuntimeCoordinator(req);
    const strategy = getStrategyDefinition(config.strategy || "carry_trend");
    res.json({
        status: "ok",
        runtime: "live_only",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
            api: true,
            oanda: Boolean(OANDA_API_KEY && OANDA_ACCOUNT_ID),
            dataService: req.app.locals.dataService?.isRunning === true,
            signalGenerator: coordinator?.isRunning === true,
            tradingEngine: req.app.locals.tradingEngine?.isRunning === true,
        },
        config: {
            enableTrading: config.enableTrading === true,
            assets: config.assets || [],
            strategy: strategy.key,
            strategyLabel: strategy.label,
            strategyVersion: strategy.version,
            timeframe: config.timeframe || "4h",
            maxOpenPositions: config.maxOpenPositions || 1,
            riskPerTrade: config.riskPerTrade || 0,
        },
    });
});

router.get("/system/health", async (req, res) => {
    try {
        const dataService = req.app.locals.dataService;
        const coordinator = getRuntimeCoordinator(req);
        const tradingEngine = req.app.locals.tradingEngine;
        const config = req.app.locals.configService?.get?.() || {};
        let oanda = { connected: false, latencyMs: null };
        try {
            const startedAt = Date.now();
            await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`);
            oanda = {
                connected: true,
                latencyMs: Date.now() - startedAt,
                environment: process.env.OANDA_ENVIRONMENT || "live",
            };
        } catch (error) {
            oanda.error = error.message;
        }

        const dataStatus = dataService?.getStatus?.() || {};
        const reasons = [];
        if (!oanda.connected) reasons.push("OANDA_DISCONNECTED");
        if (dataService?.isRunning !== true) reasons.push("DATA_SERVICE_STOPPED");
        if (dataStatus.freshness?.pricesFresh === false)
            reasons.push("STALE_PRICE_DATA");
        if (dataStatus.freshness?.candlesFresh === false)
            reasons.push("STALE_CANDLE_DATA");
        if (coordinator?.isRunning !== true)
            reasons.push("LIVE_STRATEGY_RUNTIME_STOPPED");
        if (tradingEngine?.isRunning !== true)
            reasons.push(
                config.enableTrading
                    ? "TRADING_ENGINE_DETACHED_WHILE_TRADING_ENABLED"
                    : "TRADING_ENGINE_STOPPED"
            );

        res.json({
            status: reasons.length ? "degraded" : "healthy",
            runtime: "live_only",
            degradedReasons: reasons,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            uptimeFormatted: formatUptime(process.uptime()),
            services: {
                oanda,
                dataService: {
                    ...dataStatus,
                    isRunning: dataService?.isRunning === true,
                    instruments: dataService?.instruments || [],
                    priceCount: Object.keys(dataService?.getAllPrices?.() || {})
                        .length,
                    candleCount: Object.values(dataService?.candleCache || {}).reduce(
                        (total, candles) =>
                            total + (Array.isArray(candles) ? candles.length : 0),
                        0
                    ),
                },
                liveStrategy: {
                    isRunning: coordinator?.isRunning === true,
                    lastRun: coordinator?.lastRunTime || null,
                    activeSignals: coordinator?.latestSignals?.length || 0,
                },
                tradingEngine: tradingEngine?.getStatus?.() || {
                    isRunning: false,
                },
                configService: {
                    loaded: Boolean(req.app.locals.configService),
                    tradingEnabled: config.enableTrading === true,
                },
            },
            config: {
                enableTrading: config.enableTrading === true,
                strategy: config.strategy,
                timeframe: config.timeframe,
                assets: config.assets || [],
            },
            liveSelection: coordinator?.getLiveSelection?.() || null,
        });
    } catch (error) {
        res.status(500).json({ status: "error", error: error.message });
    }
});

router.get("/system/info", (req, res) => {
    const memory = process.memoryUsage();
    res.json({
        server: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            pid: process.pid,
            cwd: process.cwd(),
        },
        memory: {
            ...memory,
            formatted: {
                heapUsed: formatBytes(memory.heapUsed),
                heapTotal: formatBytes(memory.heapTotal),
                rss: formatBytes(memory.rss),
            },
        },
        environment: {
            nodeEnv: process.env.NODE_ENV || "development",
            oandaEnvironment: process.env.OANDA_ENVIRONMENT || "live",
            credentialsConfigured: Boolean(OANDA_API_KEY && OANDA_ACCOUNT_ID),
        },
        runtime: "live_only",
        timestamp: new Date().toISOString(),
    });
});

router.post("/email/test", async (req, res) => {
    try {
        const emailService = req.app.locals.emailService;
        const config = req.app.locals.configService?.get?.() || {};
        const address = req.body?.email || config.alertEmail || process.env.EMAIL_TO;
        if (!emailService?.initialized)
            return res.status(400).json({ error: "Email service not configured" });
        if (!address)
            return res.status(400).json({ error: "No email address provided" });
        await emailService.sendTestEmail(address);
        res.json({ success: true, message: `Test email sent to ${address}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/account", async (_req, res) => {
    try {
        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/summary`
        );
        const account = data.account;
        res.json({
            balance: Number(account.balance),
            currency: account.currency,
            marginUsed: Number(account.marginUsed),
            marginAvailable: Number(account.marginAvailable),
            openTrades: Number(account.openTradeCount),
            unrealizedPL: Number(account.unrealizedPL),
            pl: Number(account.pl),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get("/prices", async (req, res) => {
    try {
        const assets = req.app.locals.configService?.getValue?.("assets") || [];
        const requested = String(req.query.instruments || assets.join(","))
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
        const cached = req.app.locals.dataService?.getAllPrices?.() || {};
        const cachedRows = requested.map((symbol) => cached[symbol]).filter(Boolean);
        const fresh = cachedRows.every(
            (price) => Date.now() - Number(price.timestamp || 0) <= 15000
        );
        if (requested.length && cachedRows.length === requested.length && fresh) {
            return res.json({ prices: cachedRows, timestamp: Date.now() });
        }

        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${encodeURIComponent(
                requested.join(",")
            )}`
        );
        const prices = data.prices.map((price) => {
            const bid = Number(price.bids?.[0]?.price || 0);
            const ask = Number(price.asks?.[0]?.price || 0);
            return {
                instrument: price.instrument,
                bid,
                ask,
                mid: (bid + ask) / 2,
                spread: Number(
                    ((ask - bid) / getPipValue(price.instrument)).toFixed(1)
                ),
                tradeable: price.tradeable,
                time: price.time,
            };
        });
        res.json({ prices, timestamp: Date.now() });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get("/candles/:instrument", async (req, res) => {
    try {
        const instrument = req.params.instrument;
        const granularity = req.query.granularity || "H4";
        const count = parseLimit(req.query.count, 100, 5000);
        const key = `${instrument}_${granularity}`;
        const dataService = req.app.locals.dataService;
        const cached = dataService?.candleCache?.[key];
        const updatedAt = Number(dataService?.candleCacheUpdatedAt?.[key] || 0);
        if (
            Array.isArray(cached) &&
            cached.length >= count &&
            Date.now() - updatedAt <= 120000
        ) {
            return res.json({
                instrument,
                granularity,
                candles: cached.slice(-count),
            });
        }
        const data = await oandaRequest(
            `/v3/instruments/${instrument}/candles?granularity=${encodeURIComponent(
                granularity
            )}&count=${count}&price=M`
        );
        res.json({
            instrument,
            granularity,
            candles: data.candles
                .filter((candle) => candle.complete)
                .map((candle) => ({
                    time: candle.time,
                    open: Number(candle.mid.o),
                    high: Number(candle.mid.h),
                    low: Number(candle.mid.l),
                    close: Number(candle.mid.c),
                    volume: candle.volume,
                })),
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get("/signals", async (req, res) => {
    try {
        const coordinator = getRuntimeCoordinator(req);
        const status = coordinator?.getStatus?.() || {};
        const limit = parseLimit(req.query.limit, 50, 500);
        let signals = Array.isArray(status.activeSignals)
            ? status.activeSignals
            : [];
        if (!signals.length) {
            const runId = coordinator?.getLiveSelection?.()?.liveRun?.runId;
            if (runId && req.app.locals.signalRepository?.getRecent) {
                signals = await req.app.locals.signalRepository.getRecent(limit, {
                    mode: RUNTIME_MODES.LIVE,
                    runId,
                });
            }
        }
        res.json({
            signals: signals.slice(0, limit),
            pendingEntries: status.pendingEntries || [],
            isActive: status.isActive ?? coordinator?.isRunning ?? false,
            liveSelection: coordinator?.getLiveSelection?.() || null,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/portfolio", async (_req, res) => {
    try {
        const [accountData, tradesData] = await Promise.all([
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`),
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/openTrades`),
        ]);
        const account = accountData.account;
        const positions = tradesData.trades.map((trade) => ({
            id: trade.id,
            instrument: trade.instrument,
            units: Number(trade.currentUnits),
            side: Number(trade.currentUnits) > 0 ? "BUY" : "SELL",
            entryPrice: Number(trade.price),
            unrealizedPL: Number(trade.unrealizedPL),
            marginUsed: Number(trade.marginUsed || 0),
            openTime: trade.openTime,
        }));
        res.json({
            balance: Number(account.balance),
            currency: account.currency,
            positions,
            totalValue: Number(account.NAV),
            unrealizedPnL: Number(account.unrealizedPL),
            realizedPnL: Number(account.pl),
            marginUsed: Number(account.marginUsed),
            marginAvailable: Number(account.marginAvailable),
            exposure: positions.length ? "Active" : "None",
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get("/trades", async (req, res) => {
    try {
        const repository = req.app.locals.tradeRepository;
        if (!requireService(res, repository, "Trade repository")) return;
        const limit = parseLimit(req.query.limit, 20, 500);
        const trades = await repository.getRecent(limit, {
            mode: RUNTIME_MODES.LIVE,
        });
        res.json({ trades, total: trades.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/trade/close/:id", async (req, res) => {
    try {
        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/trades/${req.params.id}/close`,
            { method: "PUT" }
        );
        await req.app.locals.tradingEngine?.syncWithOanda?.();
        res.json({
            success: true,
            message: `Position ${req.params.id} closed`,
            orderFillTransaction: data.orderFillTransaction,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get("/trading/live-readiness", (req, res) => {
    const configService = req.app.locals.configService;
    const coordinator = getRuntimeCoordinator(req);
    if (!requireService(res, configService, "Config service")) return;
    if (!requireService(res, coordinator, "Runtime coordinator")) return;
    res.json(
        evaluateLiveReadiness({
            liveSelection: coordinator.getLiveSelection?.() || null,
            config: configService.get(),
        })
    );
});

router.post("/trading/start", async (req, res) => {
    try {
        const configService = req.app.locals.configService;
        const coordinator = getRuntimeCoordinator(req);
        const engine = req.app.locals.tradingEngine;
        if (!requireService(res, configService, "Config service")) return;
        if (!requireService(res, coordinator, "Runtime coordinator")) return;
        if (!requireService(res, engine, "Trading engine")) return;

        await coordinator.ensureLiveSelectionInitialized?.();
        const readiness = evaluateLiveReadiness({
            liveSelection: coordinator.getLiveSelection?.() || null,
            config: configService.get(),
        });
        if (!readiness.passed) {
            return res.status(409).json({
                error: "Live strategy readiness failed",
                liveReadiness: readiness,
            });
        }

        if (!engine.isRunning) {
            const supervisor = req.app.locals.ensureTradingEngineStarted;
            const result = supervisor
                ? await supervisor({ reason: "live activation" })
                : (await engine.start(), engine.startMonitoring?.(), {
                      running: engine.isRunning,
                  });
            if (!result?.running && !engine.isRunning) {
                return res.status(503).json({
                    error: "Trading engine is not running",
                    detail: result?.error || "Engine start failed",
                    liveReadiness: readiness,
                });
            }
        }

        configService.update(
            { enableTrading: true },
            { allowLiveActivation: true }
        );
        req.app.locals.broadcastEngineStatus?.();
        res.json({
            success: true,
            message: "Live trading enabled",
            engineRunning: engine.isRunning,
            liveReadiness: readiness,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/trading/stop", (req, res) => {
    try {
        const configService = req.app.locals.configService;
        if (!requireService(res, configService, "Config service")) return;
        configService.update({ enableTrading: false });
        req.app.locals.broadcastEngineStatus?.();
        res.json({ success: true, message: "Live entries disabled" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/trading/reset", (req, res) => {
    try {
        getRuntimeCoordinator(req)?.reset?.();
        res.json({ success: true, message: "Live signal state reset" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/live-selection", async (req, res) => {
    try {
        const coordinator = getRuntimeCoordinator(req);
        if (!requireService(res, coordinator, "Runtime coordinator")) return;
        await coordinator.ensureLiveSelectionInitialized?.();
        res.json({
            liveSelection: coordinator.getLiveSelection?.() || null,
            runs:
                req.query.includeRuns === "false"
                    ? []
                    : await buildLiveRuns(req, req.query),
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/runtime/live-selection", (_req, res) => {
    res.status(405).json({
        error: "The deployed live strategy is release-managed",
        code: "LIVE_STRATEGY_FIXED",
    });
});

router.get("/runtime/runs", async (req, res) => {
    try {
        const coordinator = getRuntimeCoordinator(req);
        if (!requireService(res, coordinator, "Runtime coordinator")) return;
        await coordinator.ensureLiveSelectionInitialized?.();
        res.json({
            runs: await buildLiveRuns(req, req.query),
            liveSelection: coordinator.getLiveSelection?.() || null,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs/:runId/trades", async (req, res) => {
    try {
        const run = await resolveLiveRun(req, req.params.runId);
        if (!run) return res.status(404).json({ error: "Live run not found" });
        const repository = req.app.locals.tradeRepository;
        if (!requireService(res, repository, "Trade repository")) return;
        const limit = parseLimit(req.query.limit, 200, 1000);
        const filters = { mode: RUNTIME_MODES.LIVE, ownerRunId: run.runId };
        const trades = repository.getRecentByActivity
            ? await repository.getRecentByActivity(limit, filters)
            : await repository.getRecent(limit, filters);
        const summary = repository.getTradeSummary
            ? await repository.getTradeSummary(filters)
            : null;
        res.json({ run, trades, summary, total: summary?.totalTrades ?? trades.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs/:runId/signals", async (req, res) => {
    try {
        const run = await resolveLiveRun(req, req.params.runId);
        if (!run) return res.status(404).json({ error: "Live run not found" });
        const repository = req.app.locals.signalRepository;
        if (!requireService(res, repository, "Signal repository")) return;
        const signals = await repository.getRecent(
            parseLimit(req.query.limit, 250, 1000),
            { mode: RUNTIME_MODES.LIVE, runId: run.runId }
        );
        res.json({ run, signals, total: signals.length, timestamp: Date.now() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/runtime/runs/:runId/equity", async (req, res) => {
    try {
        const run = await resolveLiveRun(req, req.params.runId);
        if (!run) return res.status(404).json({ error: "Live run not found" });
        const repository = req.app.locals.portfolioRepository;
        if (!requireService(res, repository, "Portfolio repository")) return;
        const history = await repository.getHistory(
            parseLimit(req.query.limit, 300, 1000),
            { mode: RUNTIME_MODES.LIVE, runId: run.runId }
        );
        const equityCurve = [...history].reverse().map((snapshot) => ({
            timestamp: snapshot.snapshotTime,
            totalValueAud: snapshot.totalValueAud,
            balanceAud: snapshot.balanceAud,
            realizedPnlAud: snapshot.realizedPnlAud,
            unrealizedPnlAud: snapshot.unrealizedPnlAud,
            marginUsedAud: snapshot.marginUsedAud,
            exposurePercent: snapshot.exposurePercent,
            positionCount: snapshot.positionCount,
        }));
        res.json({
            run,
            source: "live_portfolio_snapshots",
            equityCurve,
            latestSnapshot: history[0] || null,
            total: equityCurve.length,
            timestamp: Date.now(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/config", (req, res) => {
    const service = req.app.locals.configService;
    if (!requireService(res, service, "Config service")) return;
    res.json(service.get());
});

router.post("/config", (req, res) => {
    try {
        const service = req.app.locals.configService;
        if (!requireService(res, service, "Config service")) return;
        const config = service.update(req.body);
        req.app.locals.broadcastConfig?.(config);
        res.json({ success: true, config, message: "Live configuration updated" });
    } catch (error) {
        res.status(error.code === "CONFIG_FREEZE_VIOLATION" ? 409 : 500).json({
            error: error.message,
            code: error.code,
        });
    }
});

router.post("/config/reset", (req, res) => {
    try {
        const service = req.app.locals.configService;
        if (!requireService(res, service, "Config service")) return;
        const config = service.reset();
        req.app.locals.broadcastConfig?.(config);
        res.json({ success: true, config, message: "Configuration reset" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/engine/status", (req, res) => {
    const engine = req.app.locals.tradingEngine;
    if (!requireService(res, engine, "Trading engine")) return;
    res.json(engine.getStatus());
});

router.get("/engine/stats", (req, res) => {
    const engine = req.app.locals.tradingEngine;
    if (!requireService(res, engine, "Trading engine")) return;
    res.json({
        isRunning: engine.isRunning,
        stats: engine.stats,
        openPositions: engine.openTrades?.size || 0,
        queueLength: engine.tradeQueue?.length || 0,
        isProcessingQueue: engine.isProcessingQueue || false,
    });
});

router.get("/engine/trades", (req, res) => {
    const engine = req.app.locals.tradingEngine;
    if (!requireService(res, engine, "Trading engine")) return;
    const trades = engine.getOpenTrades();
    res.json({ trades, count: trades.length });
});

router.post("/engine/close/:tradeId", async (req, res) => {
    try {
        const engine = req.app.locals.tradingEngine;
        if (!requireService(res, engine, "Trading engine")) return;
        await engine.forceCloseTrade(req.params.tradeId);
        res.json({ success: true, message: `Trade ${req.params.tradeId} closed` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/engine/sync", async (req, res) => {
    try {
        const engine = req.app.locals.tradingEngine;
        if (!requireService(res, engine, "Trading engine")) return;
        await engine.syncOpenTrades();
        await engine.syncWithOanda();
        res.json({
            success: true,
            message: "Trading engine synced with Oanda",
            openTrades: engine.openTrades?.size || 0,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/engine/reset-stats", (req, res) => {
    const engine = req.app.locals.tradingEngine;
    if (!requireService(res, engine, "Trading engine")) return;
    engine.resetStats();
    res.json({ success: true, message: "Trading engine stats reset" });
});

router.post("/engine/start", async (req, res) => {
    try {
        const engine = req.app.locals.tradingEngine;
        if (!requireService(res, engine, "Trading engine")) return;
        if (!engine.isRunning) {
            await engine.start();
            engine.startMonitoring?.();
        }
        req.app.locals.broadcastEngineStatus?.();
        res.json({ success: true, isRunning: engine.isRunning });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/engine/stop", (req, res) => {
    try {
        const engine = req.app.locals.tradingEngine;
        if (!requireService(res, engine, "Trading engine")) return;
        if (engine.isRunning) engine.stop();
        req.app.locals.broadcastEngineStatus?.();
        res.json({ success: true, isRunning: engine.isRunning });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/analytics", async (req, res) => {
    try {
        const AnalyticsService = require("../services/analyticsService");
        const service = new AnalyticsService(
            req.app.locals.tradeRepository,
            req.app.locals.signalRepository,
            req.app.locals.entryDecisionRepository
        );
        const analytics = await service.getAnalytics(req.query.period || "30d", {
            mode: RUNTIME_MODES.LIVE,
            strategy: "carry_trend",
            runId: req.query.runId || undefined,
            selectionId: req.query.selectionId || undefined,
            profile: req.query.profile === "dashboard" ? "dashboard" : "full",
        });
        res.json(analytics);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/reports/status", (req, res) => {
    const scheduler = req.app.locals.s3ReportScheduler;
    if (!requireService(res, scheduler, "S3 report scheduler")) return;
    res.json(scheduler.getStatus());
});

router.post("/reports/upload", async (req, res) => {
    try {
        const scheduler = req.app.locals.s3ReportScheduler;
        if (!requireService(res, scheduler, "S3 report scheduler")) return;
        const result = await scheduler.forceUpload(req.body.period || "24h");
        res.status(result.success ? 200 : 500).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/reports/upload/daily", async (req, res) => {
    try {
        const scheduler = req.app.locals.s3ReportScheduler;
        if (!requireService(res, scheduler, "S3 report scheduler")) return;
        const success = await scheduler.uploadDailyReport();
        res.status(success ? 200 : 500).json({ success });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/reports/upload/weekly", async (req, res) => {
    try {
        const scheduler = req.app.locals.s3ReportScheduler;
        if (!requireService(res, scheduler, "S3 report scheduler")) return;
        const success = await scheduler.uploadWeeklyReport();
        res.status(success ? 200 : 500).json({ success });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
