const tradingRoutes = require("../tradingRoutes");
const { cloneDefaultConfig, computeConfigHash } = require("../../config/tradingConfig");

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

describe("live-only trading routes", () => {
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

    test("live start remains blocked during the loss cooldown", async () => {
        const tradingEngine = {
            isRunning: true,
            getEntryRiskState: jest.fn(async () => ({
                status: "COOLDOWN",
                entryAllowed: false,
                cooldownActive: true,
                consecutiveLosses: 3,
                maxConsecutiveLosses: 3,
                cooldownStartedAt: Date.now(),
                cooldownUntil: Date.now() + 60_000,
                remainingMs: 60_000,
            })),
        };
        const { req, configService } = liveContext({ tradingEngine });
        const res = response();

        await handler("post", "/trading/start")(req, res);

        expect(res.statusCode).toBe(409);
        expect(res.body.liveReadiness.status).toBe("COOLDOWN");
        expect(configService.update).not.toHaveBeenCalled();
    });

    test("runtime strategy cannot be changed through the API", () => {
        const res = response();
        handler("post", "/runtime/live-selection")({}, res);
        expect(res.statusCode).toBe(405);
        expect(res.body.code).toBe("LIVE_STRATEGY_FIXED");
    });
});
