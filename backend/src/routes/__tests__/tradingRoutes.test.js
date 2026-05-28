const tradingRoutes = require("../tradingRoutes");
const {
    RUNTIME_MODES,
    RUN_STATUSES,
} = require("../../runtime/runtimeConstants");

const resetRoute = tradingRoutes.stack.find(
    (layer) =>
        layer.route?.path === "/runtime/runs/:runId/reset" &&
        layer.route?.methods?.post
);
const resetHandler = resetRoute.route.stack[0].handle;
const promoteRoute = tradingRoutes.stack.find(
    (layer) =>
        layer.route?.path === "/runtime/runs/:runId/promote" &&
        layer.route?.methods?.post
);
const promoteHandler = promoteRoute.route.stack[0].handle;
const startRoute = tradingRoutes.stack.find(
    (layer) => layer.route?.path === "/trading/start" && layer.route?.methods?.post
);
const startHandler = startRoute.route.stack[0].handle;

function createSession(mode) {
    return {
        run: {
            runId: `run-${mode}`,
            mode,
            strategy: "supertrend_momentum",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-1",
            startedAt: 1710000000000,
            stoppedAt: null,
            metadata: {},
        },
        latestSignals: [],
    };
}

function createRouteContext(session) {
    const runtimeCoordinator = {
        getRunSession: jest.fn((runId) =>
            runId === session.run.runId ? session : null
        ),
        listRuns: jest.fn(() => [session.run]),
        getLiveSelection: jest.fn(() => ({
            selectionId: "selection-1",
            liveRun:
                session.run.mode === RUNTIME_MODES.LIVE
                    ? session.run
                    : { runId: "run-live", strategy: "supertrend_momentum" },
            shadowRun:
                session.run.mode === RUNTIME_MODES.PAPER_SHADOW
                    ? session.run
                    : null,
        })),
    };
    const paperTradingRuntime = {
        resetRun: jest.fn(async (runId) => {
            session.run = {
                ...session.run,
                runId,
                startedAt: 1710001234567,
                metadata: {
                    ...session.run.metadata,
                    lastResetAt: 1710001234567,
                },
            };
            return session.run;
        }),
        enrichRuns: jest.fn(async (runs) => runs),
    };
    const strategyRunRepository = {
        list: jest.fn(async () => []),
    };

    const req = {
        params: {
            runId: session.run.runId,
        },
        app: {
            locals: {
                runtimeCoordinator,
                paperTradingRuntime,
                strategyRunRepository,
            },
        },
    };
    const res = {
        statusCode: 200,
        body: null,
        status: jest.fn(function status(code) {
            this.statusCode = code;
            return this;
        }),
        json: jest.fn(function json(payload) {
            this.body = payload;
            return this;
        }),
    };

    return { req, res, runtimeCoordinator, paperTradingRuntime };
}

function createClosedPaperTrade(overrides = {}) {
    return {
        id: overrides.id || "paper-trade-1",
        instrument: "EUR_USD",
        side: "BUY",
        entryType: "FRESH_FLIP",
        entryPrice: 1.1,
        stopLossPrice: 1.098,
        pnlAud: 1,
        pnlPips: 10,
        entryTime: Date.UTC(2026, 0, 1, 13, 0, 0),
        exitTime: Date.UTC(2026, 0, 1, 14, 0, 0),
        mode: RUNTIME_MODES.PAPER_CANDIDATE,
        strategy: "timesfm_directional",
        ownerRunId: "run-paper_candidate",
        isOpen: false,
        brokerReconciliationPayload: {
            paperRuntime: {
                initialStopDistance: 0.002,
            },
        },
        ...overrides,
    };
}

function createPromoteRouteContext({ trades }) {
    const session = createSession(RUNTIME_MODES.PAPER_CANDIDATE);
    session.run = {
        ...session.run,
        strategy: "timesfm_directional",
        configSnapshot: {
            strategy: "timesfm_directional",
            enableShorting: false,
            assets: ["EUR_USD"],
        },
    };

    const { req, res, runtimeCoordinator, paperTradingRuntime } =
        createRouteContext(session);
    const tradingEngine = {
        isRunning: false,
        syncOpenTrades: jest.fn(async () => undefined),
        getOpenTrades: jest.fn(() => []),
        stop: jest.fn(),
        start: jest.fn(async () => undefined),
        startMonitoring: jest.fn(),
    };
    const configService = {
        get: jest.fn(() => ({
            strategy: "supertrend_momentum",
            assets: ["AUD_USD"],
            maxOpenPositions: 2,
            riskPerTrade: 0.01,
            maxCapitalAtRisk: 100,
            maxPortfolioExposure: 0.5,
        })),
        update: jest.fn(),
    };

    runtimeCoordinator.selectLiveStrategy = jest.fn(async () => ({
        selectionId: "selection-live",
        liveRun: {
            runId: "run-live",
            strategy: "timesfm_directional",
        },
        shadowRun: {
            runId: "run-shadow",
            strategy: "timesfm_directional",
        },
    }));
    runtimeCoordinator.updateRun = jest.fn(async (_runId, updates) => updates);

    req.body = {};
    req.app.locals = {
        ...req.app.locals,
        configService,
        tradingEngine,
        dataService: {},
        tradeRepository: {
            getTradesSince: jest.fn(async () => trades),
        },
        signalRepository: {
            getSignalsSince: jest.fn(async () => []),
        },
        entryDecisionRepository: {
            getDecisionsSince: jest.fn(async () => []),
        },
    };

    return {
        req,
        res,
        runtimeCoordinator,
        paperTradingRuntime,
        tradingEngine,
        configService,
    };
}

describe("tradingRoutes runtime run reset", () => {
    test("allows the active shadow baseline to be reset manually", async () => {
        const session = createSession(RUNTIME_MODES.PAPER_SHADOW);
        const { req, res, paperTradingRuntime } = createRouteContext(session);

        await resetHandler(req, res);

        expect(paperTradingRuntime.resetRun).toHaveBeenCalledWith(
            session.run.runId
        );
        expect(res.status).not.toHaveBeenCalled();
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                message: "Shadow baseline reset",
            })
        );
        expect(res.body.run).toEqual(
            expect.objectContaining({
                runId: session.run.runId,
                mode: RUNTIME_MODES.PAPER_SHADOW,
                startedAt: 1710001234567,
                metadata: expect.objectContaining({
                    lastResetAt: 1710001234567,
                }),
            })
        );
    });

    test("keeps candidate paper run reset behavior", async () => {
        const session = createSession(RUNTIME_MODES.PAPER_CANDIDATE);
        const { req, res, paperTradingRuntime } = createRouteContext(session);

        await resetHandler(req, res);

        expect(paperTradingRuntime.resetRun).toHaveBeenCalledWith(
            session.run.runId
        );
        expect(res.status).not.toHaveBeenCalled();
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                message: "Candidate paper run reset",
            })
        );
        expect(res.body.run).toEqual(
            expect.objectContaining({
                runId: session.run.runId,
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
            })
        );
    });

    test("rejects live run manual resets", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const { req, res, paperTradingRuntime } = createRouteContext(session);

        await resetHandler(req, res);

        expect(paperTradingRuntime.resetRun).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toEqual({
            error: "Only shadow baseline and candidate paper runs can be reset manually",
        });
    });
});

describe("tradingRoutes runtime run promotion gate", () => {
    test("blocks promotion before live side effects when the gate fails", async () => {
        const trades = Array.from({ length: 49 }, (_, index) =>
            createClosedPaperTrade({
                id: `trade-${index}`,
                pnlAud: 1,
                pnlPips: 10,
            })
        );
        const { req, res, runtimeCoordinator, tradingEngine } =
            createPromoteRouteContext({ trades });

        await promoteHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.body).toEqual(
            expect.objectContaining({
                error: "Promotion gate failed",
                promotionGate: expect.objectContaining({
                    status: "FAIL",
                    reasons: expect.arrayContaining([
                        expect.objectContaining({
                            code: "MIN_CLOSED_TRADES",
                        }),
                    ]),
                }),
            })
        );
        expect(tradingEngine.syncOpenTrades).not.toHaveBeenCalled();
        expect(runtimeCoordinator.selectLiveStrategy).not.toHaveBeenCalled();
    });

    test("records the passing gate when a candidate is promoted", async () => {
        const trades = Array.from({ length: 60 }, (_, index) =>
            createClosedPaperTrade({
                id: `trade-${index}`,
                pnlAud: 1,
                pnlPips: 10,
            })
        );
        const { req, res, runtimeCoordinator, tradingEngine, configService } =
            createPromoteRouteContext({ trades });

        await promoteHandler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(tradingEngine.syncOpenTrades).toHaveBeenCalled();
        expect(runtimeCoordinator.selectLiveStrategy).toHaveBeenCalledWith(
            expect.objectContaining({
                strategyKey: "timesfm_directional",
                initiatedBy: "paper-promotion",
                metadata: expect.objectContaining({
                    promotedFromRunId: "run-paper_candidate",
                    promotionGate: expect.objectContaining({
                        status: "PASS",
                    }),
                    phase4ControlledLive: expect.objectContaining({
                        promotedFromRunId: "run-paper_candidate",
                    }),
                }),
            })
        );
        expect(runtimeCoordinator.updateRun).toHaveBeenCalledWith(
            "run-paper_candidate",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    promotionStatus: "promoted_to_live",
                    promotionGate: expect.objectContaining({
                        status: "PASS",
                        requirements: expect.objectContaining({
                            requiredSides: ["BUY"],
                        }),
                    }),
                    phase4ControlledLive: expect.objectContaining({
                        riskLimits: expect.objectContaining({
                            maxOpenPositions: 1,
                            riskPerTrade: 0.005,
                            maxCapitalAtRisk: 50,
                            maxPortfolioExposure: 0.1,
                        }),
                    }),
                }),
            })
        );
        expect(configService.update).toHaveBeenCalledWith(
            expect.objectContaining({
                strategy: "timesfm_directional",
                enableShorting: false,
                enableTrading: false,
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
                liveActivationPhase: "phase4_controlled",
            })
        );
        expect(res.body.promotion.promotionGate).toEqual(
            expect.objectContaining({
                status: "PASS",
                summary: expect.objectContaining({
                    closedTrades: 60,
                    netExpectancyPips: 10,
                }),
            })
        );
    });
});

describe("tradingRoutes controlled live start", () => {
    test("blocks live start without gate-passing promotion evidence", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const { req, res } = createRouteContext(session);
        const configService = {
            get: jest.fn(() => ({
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
            })),
            update: jest.fn(),
        };
        req.app.locals.configService = configService;

        await startHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.body).toEqual(
            expect.objectContaining({
                error: "Controlled live readiness failed",
                liveReadiness: expect.objectContaining({
                    status: "FAIL",
                    reasons: expect.arrayContaining([
                        expect.objectContaining({
                            code: "PROMOTION_GATE_NOT_PASSED",
                        }),
                    ]),
                }),
            })
        );
        expect(configService.update).not.toHaveBeenCalled();
    });

    test("allows a dashboard manual override when live readiness fails", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const { req, res } = createRouteContext(session);
        const configService = {
            get: jest.fn(() => ({
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
            })),
            update: jest.fn(),
        };
        req.body = {
            manualOverride: true,
            source: "dashboard",
        };
        req.app.locals.configService = configService;

        await startHandler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(configService.update).toHaveBeenCalledWith({
            enableTrading: true,
        });
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                manualOverride: true,
                warning:
                    "Live entries enabled by manual dashboard override despite readiness failure",
                liveReadiness: expect.objectContaining({
                    status: "FAIL",
                }),
            })
        );
    });

    test("allows live start only when promotion evidence and risk caps pass", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        session.run = {
            ...session.run,
            strategy: "timesfm_directional",
            metadata: {
                promotionGate: {
                    passed: true,
                    status: "PASS",
                },
            },
        };
        const { req, res } = createRouteContext(session);
        const configService = {
            get: jest.fn(() => ({
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
            })),
            update: jest.fn(),
        };
        req.app.locals.configService = configService;

        await startHandler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(configService.update).toHaveBeenCalledWith({
            enableTrading: true,
        });
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                liveReadiness: expect.objectContaining({
                    status: "PASS",
                }),
            })
        );
    });
});
