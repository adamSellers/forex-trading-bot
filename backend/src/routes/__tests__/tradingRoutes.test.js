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
        runId: "live-carry-1",
        mode: "live",
        strategy: "carry_trend",
        status: "active",
        selectionId: "selection-1",
        configHash: computeConfigHash(config),
        configSnapshot: config,
        startedAt: Date.now(),
    };
    const liveSelection = {
        selectionId: "selection-1",
        strategy: "carry_trend",
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
    const tradingEngine = { isRunning: true };
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
    test("catalog exposes only the deployed carry-trend strategy", () => {
        const res = response();
        handler("get", "/strategies/catalog")({}, res);
        expect(res.body.liveOnly).toBe(true);
        expect(res.body.strategies.map((strategy) => strategy.key)).toEqual([
            "carry_trend",
        ]);
    });

    test("live readiness passes for the matching release", () => {
        const { req } = liveContext();
        const res = response();
        handler("get", "/trading/live-readiness")(req, res);
        expect(res.body).toEqual(
            expect.objectContaining({ passed: true, strategy: "carry_trend" })
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

    test("runtime strategy cannot be changed through the API", () => {
        const res = response();
        handler("post", "/runtime/live-selection")({}, res);
        expect(res.statusCode).toBe(405);
        expect(res.body.code).toBe("LIVE_STRATEGY_FIXED");
    });
});
