const tradingRoutes = require("../tradingRoutes");
const { cloneDefaultConfig, computeConfigHash } = require("../../config/tradingConfig");
const { evaluateConsecutiveLossCooldown } = require("../../runtime/portfolioRiskPolicy");

function handler(method, path) {
    const layer = tradingRoutes.stack.find(
        (candidate) =>
            candidate.route?.path === path && candidate.route?.methods?.[method]
    );
    if (!layer) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
    return layer.route.stack[0].handle;
}

function response() {
    return {
        statusCode: 200,
        body: null,
        status: jest.fn(function setStatus(code) {
            this.statusCode = code;
            return this;
        }),
        json: jest.fn(function send(body) {
            this.body = body;
            return this;
        }),
    };
}

function liveContext(overrides = {}) {
    const config = { ...cloneDefaultConfig(), enableTrading: false };
    const liveRun = {
        runId: "live-intraday-1",
        mode: "live",
        strategy: "intraday_momentum",
        status: "active",
        selectionId: "selection-1",
        configHash: computeConfigHash(config),
        configSnapshot: config,
        startedAt: Date.now(),
    };
    const liveSelection = {
        selectionId: "selection-1",
        strategy: "intraday_momentum",
        configHash: liveRun.configHash,
        liveRun,
    };
    const runtimeCoordinator = {
        getLiveSelection: jest.fn(() => liveSelection),
        ensureLiveSelectionInitialized: jest.fn(async () => liveSelection),
        listRuns: jest.fn(() => [liveRun]),
        getRunSession: jest.fn(() => ({ run: liveRun, latestSignals: [] })),
    };
    const configService = {
        get: jest.fn(() => config),
        update: jest.fn((updates) => Object.assign(config, updates)),
    };
    const tradingEngine = {
        isRunning: true,
        getEntryRiskState: jest.fn(async () => ({
            status: "READY",
            entryAllowed: true,
            cooldownActive: false,
            consecutiveLosses: 0,
        })),
    };
    return {
        config,
        liveSelection,
        runtimeCoordinator,
        configService,
        tradingEngine,
        req: {
            body: {},
            query: {},
            app: {
                locals: {
                    runtimeCoordinator,
                    configService,
                    tradingEngine,
                    ...overrides,
                },
            },
        },
    };
}

function lossCooldown() {
    const now = Date.now();
    return evaluateConsecutiveLossCooldown({
        closedTrades: [3, 2, 1].map((hours) => ({
            exitTime: now - hours * 3_600_000, pnlAud: -0.1,
        })),
        maxConsecutiveLosses: 3,
        evaluatedAt: now,
    });
}

describe("live-only trading routes", () => {
    test.each(["/health", "/system/health"])("%s reports one position per pair without an account-wide count cap", async (path) => {
        const { req, config } = liveContext();
        // A historical count field must not resurrect a retired current limit.
        config.maxOpenPositions = 1;
        const res = response();

        const fetch = jest.spyOn(global, "fetch").mockRejectedValue(new Error("No broker access in route tests"));
        try {
            await handler("get", path)(req, res);
        } finally {
            fetch.mockRestore();
        }

        expect(res.statusCode).toBe(200);
        expect(res.body.config).toEqual(expect.objectContaining({
            maxOpenPositions: null,
            positionPolicy: { scope: "PER_INSTRUMENT", maxPerInstrument: 1 },
        }));
    });

    test("current configuration exposes the position policy without changing the saved snapshot", () => {
        const { req, config } = liveContext();
        const snapshot = JSON.stringify(config);
        const res = response();

        handler("get", "/config")(req, res);

        expect(res.body.positionPolicy).toEqual({ scope: "PER_INSTRUMENT", maxPerInstrument: 1 });
        expect(JSON.stringify(config)).toBe(snapshot);
        expect(config).not.toHaveProperty("positionPolicy");
    });

    test("analytics distinguishes current run from genuinely all-live history", async () => {
        const AnalyticsService = require("../../services/analyticsService");
        const get = jest.spyOn(AnalyticsService.prototype, "getAnalytics").mockResolvedValue({});
        try {
            const { req } = liveContext();
            await handler("get", "/analytics")(req, response());
            expect(get).toHaveBeenLastCalledWith("30d", expect.objectContaining({ runId: "live-intraday-1", timeBasis: "realized" }));
            req.query = { scope: "all-live", period: "all" };
            await handler("get", "/analytics")(req, response());
            expect(get).toHaveBeenLastCalledWith("all", expect.objectContaining({ strategy: undefined, runId: undefined }));
            req.query = { scope: "run", runId: "missing" };
            req.app.locals.runtimeCoordinator.getRunSession.mockReturnValue(null);
            const res = response();
            await handler("get", "/analytics")(req, res);
            expect(res.statusCode).toBe(404);
        } finally { get.mockRestore(); }
    });

    test("live readiness blocks unresolved account-wide broker intents", async () => {
        const { req, tradingEngine } = liveContext();
        tradingEngine.getStatus = () => ({ isRunning: true });
        tradingEngine.getBrokerEntryBlockReason = async () => "An order outcome is unresolved";
        const res = response();
        await handler("get", "/trading/live-readiness")(req, res);
        expect(res.body.passed).toBe(false);
        expect(res.body.activationAllowed).toBe(false);
        expect(res.body.reasons).toContainEqual(expect.objectContaining({ code: "BROKER_LIFECYCLE_UNRESOLVED" }));
    });

    test("manual broker closes use the serialized engine lifecycle", async () => {
        const { req, tradingEngine } = liveContext();
        req.params = { id: "123" };
        tradingEngine.closeBrokerTrade = jest.fn(async () => ({ orderFillTransaction: { id: "fill" } }));
        const res = response();
        await handler("post", "/trade/close/:id")(req, res);
        expect(tradingEngine.closeBrokerTrade).toHaveBeenCalledWith("123");
        expect(res.body.success).toBe(true);
    });

    test("catalog exposes only the deployed M15 intraday strategy", () => {
        const res = response();
        handler("get", "/strategies/catalog")({}, res);
        expect(res.body.liveOnly).toBe(true);
        expect(res.body.strategies.map((strategy) => strategy.key)).toEqual([
            "intraday_momentum",
        ]);
    });

    test("live readiness passes for the matching release", async () => {
        const { req } = liveContext();
        const res = response();
        await handler("get", "/trading/live-readiness")(req, res);
        expect(res.body).toEqual(
            expect.objectContaining({
                passed: true,
                strategy: "intraday_momentum",
            })
        );
    });

    test("live start enables entries through the readiness path", async () => {
        const { req, configService } = liveContext();
        const res = response();
        await handler("post", "/trading/start")(req, res);
        expect(res.statusCode).toBe(200);
        expect(configService.update).toHaveBeenCalledWith(
            { enableTrading: true },
            { allowLiveActivation: true }
        );
        expect(res.body.message).toBe("Live trading enabled");
    });

    test("live start restores operator intent while the loss cooldown remains in force", async () => {
        const entryRisk = lossCooldown();
        const tradingEngine = {
            isRunning: true,
            getEntryRiskState: jest.fn(async () => entryRisk),
        };
        const { req, config, configService } = liveContext({ tradingEngine });
        const res = response();

        await handler("post", "/trading/start")(req, res);

        expect(res.statusCode).toBe(200);
        expect(config.enableTrading).toBe(true);
        expect(configService.update).toHaveBeenCalledWith(
            { enableTrading: true }, { allowLiveActivation: true }
        );
        expect(res.body.message).toBe("Live trading enabled; new entries remain paused until the loss cooldown ends");
        expect(res.body.liveReadiness.activationAllowed).toBe(true);
        expect(res.body.liveReadiness.passed).toBe(false);
        expect(res.body.liveReadiness.status).toBe("COOLDOWN");
        expect(res.body.liveReadiness.entryRisk).toEqual(entryRisk);
        expect(entryRisk.entryAllowed).toBe(false);
    });

    test.each([
        ["invalid risk configuration", "LIVE_RISK_LIMIT", ({ config }) => { config.riskPerTrade = 0.005; }],
        ["missing runtime", "NO_ACTIVE_LIVE_RUNTIME", ({ liveSelection }) => { liveSelection.liveRun = null; }],
        ["unresolved broker intent", "BROKER_LIFECYCLE_UNRESOLVED", ({ tradingEngine }) => {
            tradingEngine.getStatus = () => ({ pendingOrderIntents: 1 });
        }],
        ["failed persistence", "CONFIG_PERSISTENCE_FAILED", ({ configService }) => {
            configService.getPersistenceStatus = () => ({ durable: false });
        }],
        ["unavailable risk history", "ENTRY_RISK_UNAVAILABLE", ({ tradingEngine }) => {
            tradingEngine.getEntryRiskState.mockRejectedValue(new Error("Risk history unavailable"));
        }],
    ])("cooldown activation preserves the %s blocker", async (_name, code, arrange) => {
        const context = liveContext();
        context.tradingEngine.getEntryRiskState.mockResolvedValue(lossCooldown());
        arrange(context);
        const res = response();
        await handler("post", "/trading/start")(context.req, res);
        expect(res.statusCode).toBe(409);
        expect(res.body.liveReadiness.activationAllowed).toBe(false);
        expect(res.body.liveReadiness.reasons).toContainEqual(expect.objectContaining({ code }));
        expect(context.configService.update).not.toHaveBeenCalled();
        expect(context.config.enableTrading).toBe(false);
    });

    test("a failed engine start cannot enable entries during cooldown", async () => {
        const { req, tradingEngine, configService } = liveContext();
        tradingEngine.isRunning = false;
        tradingEngine.getEntryRiskState.mockResolvedValue(lossCooldown());
        req.app.locals.ensureTradingEngineStarted = jest.fn(async () => ({ running: false }));
        const res = response();
        await handler("post", "/trading/start")(req, res);
        expect(res.statusCode).toBe(503);
        expect(configService.update).not.toHaveBeenCalled();
    });

    test("operator pause during cooldown remains paused after risk eligibility returns", async () => {
        const { req, config, tradingEngine } = liveContext();
        tradingEngine.getEntryRiskState.mockResolvedValue(lossCooldown());
        await handler("post", "/trading/start")(req, response());
        expect(config.enableTrading).toBe(true);
        handler("post", "/trading/stop")(req, response());
        expect(config.enableTrading).toBe(false);
        tradingEngine.getEntryRiskState.mockResolvedValue({
            status: "READY", entryAllowed: true, cooldownActive: false,
        });
        const res = response();
        await handler("get", "/trading/live-readiness")(req, res);
        expect(res.body.passed).toBe(true);
        expect(config.enableTrading).toBe(false);
    });

    test("runtime strategy cannot be changed through the API", () => {
        const res = response();
        handler("post", "/runtime/live-selection")({}, res);
        expect(res.statusCode).toBe(405);
        expect(res.body.code).toBe("LIVE_STRATEGY_FIXED");
    });
});
