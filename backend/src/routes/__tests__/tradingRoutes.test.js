const tradingRoutes = require("../tradingRoutes");
const express = require("express");
const request = require("supertest");
const { computeConfigHash } = require("../../config/tradingConfig");
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
const paperResetRoute = tradingRoutes.stack.find(
    (layer) =>
        layer.route?.path === "/runtime/paper/reset" && layer.route?.methods?.post
);
const paperResetHandler = paperResetRoute.route.stack[0].handle;

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
        closeOpenTradesForRun: jest.fn(async () => []),
        ensureRunSnapshot: jest.fn(async () => null),
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
        resetAllPaper: jest.fn(async () => ({
            resetAt: 1710001234567,
            counts: {
                tradesDeleted: 4,
                signalsDeleted: 8,
                entryDecisionsDeleted: 2,
                portfolioSnapshotsDeleted: 3,
            },
            runs: [session.run],
        })),
        enrichRuns: jest.fn(async (runs) => runs),
    };
    runtimeCoordinator.resetRun = jest.fn(async (runId, updates = {}) => {
        const previousRun = session.run;
        session.run = {
            ...previousRun,
            runId: `${runId}-successor`,
            parentRunId: runId,
            startedAt: updates.startedAt || 1710001234567,
            metadata: {
                ...previousRun.metadata,
                ...(updates.metadata || {}),
                restartedFromRunId: runId,
                evidencePreserved: true,
            },
        };
        return session.run;
    });
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
        configHash: "candidate-config",
        brokerReconciliationPayload: {
            paperRuntime: {
                initialStopDistance: 0.002,
            },
        },
        ...overrides,
    };
}

function createPromotionTrades(count = 120, options = {}) {
    const now = Date.now();
    const nowDate = new Date(now);
    const todayUtc = Date.UTC(
        nowDate.getUTCFullYear(),
        nowDate.getUTCMonth(),
        nowDate.getUTCDate()
    );
    return Array.from({ length: count }, (_, index) => {
        const winning = index % 4 !== 0;
        const london = index % 2 === 0;
        const dayOffset = index % 40;
        return createClosedPaperTrade({
            id: `${options.prefix || "candidate"}-${index}`,
            instrument: london ? "EUR_USD" : "GBP_USD",
            pnlAud:
                options.pnlAud === undefined
                    ? winning
                        ? 2
                        : -1
                    : options.pnlAud,
            pnlPips:
                options.pnlPips === undefined
                    ? winning
                        ? 10
                        : -5
                    : options.pnlPips,
            entryTime:
                todayUtc - (40 - dayOffset) * 86400000 +
                (london ? 8 : 13) * 3600000,
            exitTime:
                todayUtc - (40 - dayOffset) * 86400000 +
                (london ? 9 : 14) * 3600000,
            configHash: options.configHash || "candidate-config",
            brokerReconciliationPayload: {
                paperRuntime: {
                    volatilityRegime: index % 3 === 0 ? "high" : "normal",
                    commissionStatus: "MODELED",
                    spreadStatus: "MODELED",
                    slippageStatus: "MODELED",
                    financingMode: "NOT_APPLICABLE",
                    financingStatus: "NO_ROLLOVER",
                    costModelVersion: 1,
                },
            },
        });
    });
}

function createPromoteRouteContext({
    trades,
    shadowTrades = createPromotionTrades(80, {
        prefix: "shadow",
        pnlAud: 0.1,
        pnlPips: 1,
        configHash: "shadow-config",
    }),
}) {
    const session = createSession(RUNTIME_MODES.PAPER_CANDIDATE);
    session.run = {
        ...session.run,
        strategy: "timesfm_directional",
        configHash: "candidate-config",
        startedAt: Date.now() - 40 * 86400000,
        configSnapshot: {
            strategy: "timesfm_directional",
            enableShorting: false,
            assets: ["EUR_USD", "GBP_USD"],
            paperStartingBalanceAud: 10000,
            executionPolicyVersion: "unified-execution-v1",
        },
        metadata: {
            executionParity: {
                passed: true,
                configHash: "candidate-config",
                executionPolicyVersion: "unified-execution-v1",
            },
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
    runtimeCoordinator.getLiveSelection = jest.fn(() => ({
        selectionId: "selection-1",
        liveRun: { runId: "run-live", strategy: "supertrend_momentum" },
        shadowRun: {
            runId: "run-shadow",
            mode: RUNTIME_MODES.PAPER_SHADOW,
            startedAt: Date.now() - 40 * 86400000,
            configHash: "shadow-config",
        },
    }));

    req.body = {};
    req.app.locals = {
        ...req.app.locals,
        configService,
        tradingEngine,
        dataService: {},
        tradeRepository: {
            getTradesSince: jest.fn(async (_cutoff, filters = {}) =>
                filters.mode === RUNTIME_MODES.PAPER_SHADOW
                    ? shadowTrades
                    : trades
            ),
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
        const { req, res, paperTradingRuntime, runtimeCoordinator } =
            createRouteContext(session);

        await resetHandler(req, res);

        expect(paperTradingRuntime.resetRun).not.toHaveBeenCalled();
        expect(runtimeCoordinator.resetRun).toHaveBeenCalledWith(
            "run-paper_shadow",
            expect.objectContaining({ reason: "manual-paper-restart" })
        );
        expect(res.status).not.toHaveBeenCalled();
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                message:
                    "Fresh shadow baseline run started; prior evidence was preserved",
                previousRunId: "run-paper_shadow",
                newRunId: "run-paper_shadow-successor",
                evidencePreserved: true,
            })
        );
        expect(res.body.run).toEqual(
            expect.objectContaining({
                runId: "run-paper_shadow-successor",
                mode: RUNTIME_MODES.PAPER_SHADOW,
                parentRunId: "run-paper_shadow",
                metadata: expect.objectContaining({
                    restartReason: "manual-paper-restart",
                    evidencePreserved: true,
                }),
            })
        );
    });

    test("keeps candidate paper run reset behavior", async () => {
        const session = createSession(RUNTIME_MODES.PAPER_CANDIDATE);
        const { req, res, paperTradingRuntime, runtimeCoordinator } =
            createRouteContext(session);

        await resetHandler(req, res);

        expect(paperTradingRuntime.resetRun).not.toHaveBeenCalled();
        expect(runtimeCoordinator.resetRun).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                message:
                    "Fresh candidate paper run started; prior evidence was preserved",
                evidencePreserved: true,
            })
        );
        expect(res.body.run).toEqual(
            expect.objectContaining({
                runId: "run-paper_candidate-successor",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
            })
        );
    });

    test("rejects live run manual resets", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const { req, res, runtimeCoordinator } = createRouteContext(session);

        await resetHandler(req, res);

        expect(runtimeCoordinator.resetRun).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toEqual({
            error: "Only shadow baseline and candidate paper runs can be reset manually",
        });
    });
});

describe("tradingRoutes runtime run promotion gate", () => {
    test("blocks promotion before live side effects when the gate fails", async () => {
        const trades = createPromotionTrades(99);
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
        const trades = createPromotionTrades(120);
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
                            maxAggregateStopRiskPctNav: 0.01,
                            maxDailyLossPctNav: 0.02,
                            maxDrawdownPctNav: 0.08,
                            maxConsecutiveLosses: 3,
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
                portfolioRiskEnforcement: true,
                referenceCurrency: "AUD",
                accountCurrency: "AUD",
                liveActivationPhase: "phase4_controlled",
            })
        );
        expect(res.body.promotion.promotionGate).toEqual(
            expect.objectContaining({
                status: "PASS",
                summary: expect.objectContaining({
                    closedTrades: 120,
                    netExpectancyPips: 6.25,
                }),
            })
        );
    });
});

describe("tradingRoutes paper runtime reset", () => {
    test("requires explicit confirmation before resetting all paper state", async () => {
        const session = createSession(RUNTIME_MODES.PAPER_SHADOW);
        const { req, res, paperTradingRuntime } = createRouteContext(session);
        req.body = {};

        await paperResetHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.body).toEqual({
            error: "Paper reset confirmation required",
            requiredConfirm: "RESET_PAPER",
        });
        expect(paperTradingRuntime.resetAllPaper).not.toHaveBeenCalled();
    });

    test("starts fresh paper runs without deleting prior evidence", async () => {
        const session = createSession(RUNTIME_MODES.PAPER_SHADOW);
        const { req, res, paperTradingRuntime, runtimeCoordinator } =
            createRouteContext(session);
        req.body = {
            confirm: "RESET_PAPER",
        };

        await paperResetHandler(req, res);

        expect(paperTradingRuntime.resetAllPaper).not.toHaveBeenCalled();
        expect(runtimeCoordinator.resetRun).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.body).toEqual(
            expect.objectContaining({
                success: true,
                message:
                    "Fresh paper runs started; all prior evidence was preserved",
                reset: expect.objectContaining({
                    evidencePreserved: true,
                    deletedCounts: expect.objectContaining({
                        trades: 0,
                        signals: 0,
                    }),
                }),
                runs: expect.arrayContaining([
                    expect.objectContaining({
                        runId: "run-paper_shadow-successor",
                        mode: RUNTIME_MODES.PAPER_SHADOW,
                    }),
                ]),
            })
        );
    });
});

describe("tradingRoutes controlled live start", () => {
    const controlledConfig = () => ({
        referenceCurrency: "AUD",
        accountCurrency: "AUD",
        portfolioRiskEnforcement: true,
        maxOpenPositions: 1,
        riskPerTrade: 0.005,
        maxCapitalAtRisk: 50,
        maxPortfolioExposure: 0.1,
        maxAggregateStopRiskPctNav: 0.01,
        maxNetCurrencyExposurePctNav: 2,
        maxCorrelatedExposurePctNav: 2,
        maxDailyLossPctNav: 0.02,
        maxDrawdownPctNav: 0.08,
        maxConsecutiveLosses: 3,
    });

    test("blocks live start without gate-passing promotion evidence", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const { req, res } = createRouteContext(session);
        const configService = {
            get: jest.fn(controlledConfig),
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

    test("ignores dashboard override fields and remains fail-closed", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const { req, res } = createRouteContext(session);
        const configService = {
            get: jest.fn(controlledConfig),
            update: jest.fn(),
        };
        req.body = {
            manualOverride: true,
            source: "dashboard",
        };
        req.app.locals.configService = configService;

        await startHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(configService.update).not.toHaveBeenCalled();
        expect(res.body).toEqual(
            expect.objectContaining({
                error: "Controlled live readiness failed",
                liveReadiness: expect.objectContaining({
                    status: "FAIL",
                }),
            })
        );
    });

    test("allows live start only when promotion evidence and risk caps pass", async () => {
        const session = createSession(RUNTIME_MODES.LIVE);
        const config = controlledConfig();
        const liveConfigHash = computeConfigHash(config);
        session.run = {
            ...session.run,
            strategy: "timesfm_directional",
            configHash: liveConfigHash,
            metadata: {
                promotedFromRunId: "candidate-1",
                promotionGate: {
                    passed: true,
                    status: "PASS",
                    gateVersion: 2,
                    configHash: "candidate-config",
                },
                phase4ControlledLive: {
                    sourceConfigHash: "candidate-config",
                    liveConfigHash,
                },
            },
        };
        const { req, res } = createRouteContext(session);
        const configService = {
            get: jest.fn(() => config),
            update: jest.fn(),
        };
        req.app.locals.configService = configService;

        await startHandler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(configService.update).toHaveBeenCalledWith(
            { enableTrading: true },
            { allowLiveActivation: true }
        );
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

describe("tradingRoutes control authentication", () => {
    const originalToken = process.env.CONTROL_API_ADMIN_TOKEN;

    afterEach(() => {
        if (originalToken === undefined) {
            delete process.env.CONTROL_API_ADMIN_TOKEN;
        } else {
            process.env.CONTROL_API_ADMIN_TOKEN = originalToken;
        }
    });

    test("protects mutations while leaving health reads public", async () => {
        const token = "route-test-admin-token-with-32-characters";
        process.env.CONTROL_API_ADMIN_TOKEN = token;
        const app = express();
        app.use(express.json());
        app.locals.configService = {
            get: jest.fn(() => ({ enableTrading: false })),
            update: jest.fn(() => ({ enableTrading: false })),
        };
        app.use("/api", tradingRoutes);

        await request(app).get("/api/health").expect(200);
        const unauthorized = await request(app).post("/api/trading/stop");
        expect(unauthorized.status).toBe(401);
        expect(unauthorized.body.code).toBe("CONTROL_AUTH_REQUIRED");

        await request(app)
            .post("/api/trading/stop")
            .set("Authorization", `Bearer ${token}`)
            .expect(200);
        expect(app.locals.configService.update).toHaveBeenCalledWith({
            enableTrading: false,
        });
    });
});
