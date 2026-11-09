// Live-only trading API.
const express = require("express");
const router = express.Router();

const {
    listStrategyCatalog,
} = require("../strategies");
const { RUNTIME_MODES } = require("../runtime/runtimeConstants");
const LiveOperator = require("../runtime/liveOperator");
const { createDashboardSources, observeOperatorChanges, systemStatus, accountView, portfolioView } =
    require("../runtime/operatorDashboardSources");
const { buildOperationalHealth } = require("../services/operationalHealthService");
const { buildOandaApiError } = require("../utils/oandaErrors");
const { performance } = require("node:perf_hooks");
const { normalizeOandaPrice, evaluatePriceAvailability } = require("../runtime/quoteAvailability");
const POSITION_POLICY = require("../constants/positionPolicy");

const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID;
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

function getRuntimeCoordinator(req) {
    return req.app.locals.runtimeCoordinator || req.app.locals.signalGenerator;
}

function getLiveOperator(req) {
    const locals = req.app.locals;
    if (!locals.liveOperator) {
        const dependencies = {
            configService: locals.configService, coordinator: getRuntimeCoordinator(req),
            engine: locals.tradingEngine, dataService: locals.dataService,
            tradeRepository: locals.tradeRepository, signalRepository: locals.signalRepository,
            brokerClient: locals.brokerClient || require("../services/Oandaclient"),
            brokerConfigured: () => Boolean(OANDA_API_KEY && OANDA_ACCOUNT_ID),
        };
        locals.liveOperator = new LiveOperator({ ...dependencies,
            sources: createDashboardSources(dependencies),
            observeChanges: (invalidate) => observeOperatorChanges(dependencies, invalidate),
            ensureEngineStarted: locals.ensureTradingEngineStarted,
            onStatusChange: () => locals.broadcastEngineStatus?.(),
        });
    }
    return locals.liveOperator;
}

async function buildLiveReadiness(req) {
    return getLiveOperator(req).readReadiness();
}

function operatorFailure(res, result) {
    return res.status(result.statusCode || 500).json({ error: result.error || result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.detail ? { detail: result.detail } : {}),
        ...(result.liveReadiness ? { liveReadiness: result.liveReadiness } : {}) });
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

async function oandaRequest(endpoint, options = {}) {
    if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
        const error = new Error("Oanda credentials are not configured");
        error.statusCode = 503;
        throw error;
    }

    const startedAt = performance.now();
    const signal = options.signal || AbortSignal.timeout(10000);
    const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
        ...options,
        signal,
        headers: {
            Authorization: `Bearer ${OANDA_API_KEY}`,
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
    });
    if (!response.ok) throw await buildOandaApiError(response);
    const data = await response.json();
    // Include body receipt: a delayed callback/body cannot revive an expired
    // request merely by acquiring a recent fetchedAt timestamp afterward.
    if (signal.aborted || performance.now() - startedAt > 10000) {
        const error = new Error("Oanda request exceeded 10000ms deadline");
        error.code = "OANDA_TIMEOUT";
        error.statusCode = 503;
        throw error;
    }
    return data;
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
    const strategies = listStrategyCatalog();
    res.json({ strategies, liveOnly: true, timestamp: Date.now() });
});

router.get("/health", (req, res) => {
    res.json(systemStatus({ configService: req.app.locals.configService,
        coordinator: getRuntimeCoordinator(req), engine: req.app.locals.tradingEngine,
        dataService: req.app.locals.dataService, brokerConfigured: () => Boolean(OANDA_API_KEY && OANDA_ACCOUNT_ID) }));
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
        const liveReadiness = await buildLiveReadiness(req);
        const operationalHealth = buildOperationalHealth({
            engineStatus: tradingEngine?.getStatus?.() || {}, dataStatus,
            runtimeStatus: coordinator?.getStatus?.() || { isRunning: coordinator?.isRunning, lastRunTime: coordinator?.lastRunTime },
            config, entryRisk: liveReadiness.entryRisk,
            configPersistence: req.app.locals.configService?.getPersistenceStatus?.(),
        });
        const reasons = operationalHealth.issues.map((issue) => issue.code);
        if (!oanda.connected) reasons.push("OANDA_DISCONNECTED");
        res.json({
            status: reasons.length ? "degraded" : "healthy",
            runtime: "live_only",
            degradedReasons: reasons,
            operationalHealth,
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
                maxOpenPositions: null,
                positionPolicy: POSITION_POLICY,
            },
            liveReadiness,
            entryRisk: liveReadiness.entryRisk,
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
        const data = await oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`);
        res.json(accountView(data.account));
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
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
        const nowMs = Date.now();
        const fresh = cachedRows.every((price) => evaluatePriceAvailability(price, {
            nowMs, maxAgeMs: 15000, requireTradeable: false,
        }).available);
        if (requested.length && cachedRows.length === requested.length && fresh) {
            return res.json({ prices: cachedRows, timestamp: Date.now() });
        }

        const data = await oandaRequest(
            `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${encodeURIComponent(
                requested.join(",")
            )}`
        );
        if (!Array.isArray(data?.prices)) throw new Error("Oanda pricing response did not contain prices");
        const fetchedAt = Date.now();
        const prices = requested.map((instrument) => {
            const matches = data.prices.filter((price) => price?.instrument === instrument);
            const price = normalizeOandaPrice(matches.length === 1 ? matches[0] : null, { instrument, fetchedAt });
            if (matches.length > 1) price.invalidReason = "DUPLICATE_PRICE";
            return price;
        });
        res.json({ prices, timestamp: fetchedAt });
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

router.get("/portfolio", async (req, res) => {
    try {
        const [accountData, tradesData] = await Promise.all([
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/summary`),
            oandaRequest(`/v3/accounts/${OANDA_ACCOUNT_ID}/openTrades`),
        ]);
        res.json(await portfolioView({ account: accountData.account, brokerTrades: tradesData.trades,
            coordinator: getRuntimeCoordinator(req), tradeRepository: req.app.locals.tradeRepository }));
    } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
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
        const engine = req.app.locals.tradingEngine;
        if (!requireService(res, engine?.closeBrokerTrade, "Serialized broker close")) return;
        const data = await engine.closeBrokerTrade(req.params.id);
        res.json({
            success: true,
            message: `Position ${req.params.id} closed`,
            orderFillTransaction: data.orderFillTransaction,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

router.get("/trading/live-readiness", async (req, res) => {
    const configService = req.app.locals.configService;
    const coordinator = getRuntimeCoordinator(req);
    if (!requireService(res, configService, "Config service")) return;
    if (!requireService(res, coordinator, "Runtime coordinator")) return;
    res.json(await buildLiveReadiness(req));
});

router.post("/trading/start", async (req, res) => {
    try {
        if (!requireService(res, req.app.locals.configService, "Config service") ||
            !requireService(res, getRuntimeCoordinator(req), "Runtime coordinator") ||
            !requireService(res, req.app.locals.tradingEngine, "Trading engine")) return;
        const result = await getLiveOperator(req).enableEntries();
        if (result.outcome !== "accepted") return operatorFailure(res, result);
        res.json({ success: true, message: result.message, engineRunning: result.engineRunning,
            liveReadiness: result.liveReadiness });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/trading/stop", async (req, res) => {
    try {
        if (!requireService(res, req.app.locals.configService, "Config service")) return;
        const result = await getLiveOperator(req).pauseEntries();
        if (result.outcome !== "accepted") return operatorFailure(res, result);
        res.json({ success: true, message: result.message });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/operator/dashboard", async (req, res) => {
    try { res.json(await getLiveOperator(req).readDashboard()); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
});

for (const [path, command] of [["/operator/entries/enable", "enableEntries"],
    ["/operator/entries/pause", "pauseEntries"], ["/operator/reconcile", "reconcileBroker"]]) {
    router.post(path, async (req, res) => {
        try {
            const result = await getLiveOperator(req)[command]();
            res.status(result.statusCode || 200).json(result);
        } catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
    });
}

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
    res.json({ ...service.get(), positionPolicy: POSITION_POLICY });
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

router.get("/engine/status", async (req, res) => {
    const engine = req.app.locals.tradingEngine;
    if (!requireService(res, engine, "Trading engine")) return;
    await getLiveOperator(req).readReadiness();
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
        if (!requireService(res, req.app.locals.tradingEngine, "Trading engine")) return;
        const result = await getLiveOperator(req).reconcileBroker();
        if (result.outcome === "failed" || result.outcome === "rejected") return operatorFailure(res, result);
        res.json({ success: result.success, message: result.message,
            openTrades: result.openTrades ?? result.view?.overview?.engineStatus?.openPositions ?? 0 });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
        const result = await getLiveOperator(req).attach({ reason: "engine activation" });
        if (!result?.running && !engine.isRunning) return res.status(503).json({ error: result?.error || "Engine start failed" });
        req.app.locals.broadcastEngineStatus?.();
        res.json({ success: true, isRunning: engine.isRunning });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
        const scope = req.query.scope || (req.query.runId ? "run" : "current");
        if (!["current", "all-live", "run"].includes(scope)) return res.status(400).json({ error: "Invalid analytics scope" });
        const runId = scope === "current" ? getRuntimeCoordinator(req)?.getLiveSelection?.()?.liveRun?.runId : req.query.runId;
        if (scope !== "all-live" && !runId) return res.status(409).json({ error: "Selected analytics run is unavailable" });
        if (scope === "run" && !await resolveLiveRun(req, runId)) return res.status(404).json({ error: "Analytics run not found" });
        if (req.query.timeBasis && !["entry", "realized"].includes(req.query.timeBasis)) return res.status(400).json({ error: "Invalid time basis" });
        if (req.query.period && !["24h", "7d", "30d", "90d", "all"].includes(req.query.period)) return res.status(400).json({ error: "Invalid analytics period" });
        const analytics = await service.getAnalytics(req.query.period || "30d", {
            mode: RUNTIME_MODES.LIVE,
            strategy: scope === "all-live" ? req.query.strategy || undefined : undefined,
            runId: scope === "all-live" ? undefined : runId,
            selectionId: req.query.selectionId || undefined,
            timeBasis: req.query.timeBasis || "realized",
            profile: req.query.profile === "dashboard" ? "dashboard" : "full",
        });
        analytics.scope = scope;
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
