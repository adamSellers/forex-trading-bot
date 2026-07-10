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
const resumeBaselineRoute = tradingRoutes.stack.find(
    (layer) =>
        layer.route?.path === "/trading/resume-baseline" &&
        layer.route?.methods?.post
);
const resumeBaselineHandler = resumeBaselineRoute.route.stack[0].handle;
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

describe("tradingRoutes explicit controlled baseline resume", () => {
    const requiredConfirmation = "RESUME_CONTROLLED_BASELINE";
    const originalFetch = global.fetch;

    function createBaselineResumeContext({
        strategy = "supertrend_momentum",
        metadata = {},
        engineOpenTrades = [],
        brokerOpenTrades = [],
        brokerError = null,
    } = {}) {
        const session = createSession(RUNTIME_MODES.LIVE);
        session.run = {
            ...session.run,
            runId: "legacy-live-1",
            strategy,
            configHash: "legacy-config-hash",
            metadata,
        };
        const { req, res, runtimeCoordinator } = createRouteContext(session);
        const predecessorSelection = {
            selectionId: "legacy-selection-1",
            strategy,
            liveRun: session.run,
            shadowRun: {
                runId: "legacy-shadow-1",
                strategy,
                mode: RUNTIME_MODES.PAPER_SHADOW,
                configHash: "legacy-config-hash",
                metadata: {},
            },
        };
        let config = {
            strategy,
            assets: ["AUD_USD"],
            enableTrading: false,
            referenceCurrency: "AUD",
            accountCurrency: "AUD",
            portfolioRiskEnforcement: false,
            maxOpenPositions: 4,
            riskPerTrade: 0.02,
            maxCapitalAtRisk: 500,
            maxPortfolioExposure: 0.5,
            maxAggregateStopRiskPctNav: 0.05,
            maxNetCurrencyExposurePctNav: 5,
            maxCorrelatedExposurePctNav: 5,
            maxDailyLossPctNav: 0.1,
            maxDrawdownPctNav: 0.2,
            maxConsecutiveLosses: 10,
        };
        const configService = {
            get: jest.fn(() => ({ ...config })),
            update: jest.fn((updates) => {
                config = { ...config, ...updates };
                return { ...config };
            }),
        };
        const tradingEngine = {
            syncOpenTrades: jest.fn(async () => undefined),
            getOpenTrades: jest.fn(() => engineOpenTrades),
        };

        runtimeCoordinator.getLiveSelection = jest.fn(
            () => predecessorSelection
        );
        runtimeCoordinator.resumeControlledBaseline = jest.fn(
            async ({ configSnapshot, metadata: successorMetadata }) => {
                const configHash = computeConfigHash(configSnapshot);
                return {
                    selectionId: "controlled-selection-1",
                    strategy: "supertrend_momentum",
                    configHash,
                    liveRun: {
                        runId: "controlled-live-1",
                        parentRunId: "legacy-live-1",
                        strategy: "supertrend_momentum",
                        configHash,
                        metadata: successorMetadata,
                    },
                    shadowRun: {
                        runId: "controlled-shadow-1",
                        parentRunId: "legacy-shadow-1",
                        shadowOfRunId: "controlled-live-1",
                        strategy: "supertrend_momentum",
                        configHash,
                        metadata: successorMetadata,
                    },
                };
            }
        );

        global.fetch = brokerError
            ? jest.fn(async () => {
                  throw brokerError;
              })
            : jest.fn(async () => ({
                  ok: true,
                  json: async () => ({ trades: brokerOpenTrades }),
              }));

        req.body = { confirm: requiredConfirmation };
        req.app.locals = {
            ...req.app.locals,
            configService,
            runtimeCoordinator,
            tradingEngine,
            broadcastEngineStatus: jest.fn(),
        };

        return {
            req,
            res,
            runtimeCoordinator,
            tradingEngine,
            configService,
        };
    }

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("requires the exact explicit confirmation before preflight", async () => {
        const context = createBaselineResumeContext();
        context.req.body = { confirm: "yes" };

        await resumeBaselineHandler(context.req, context.res);

        expect(context.res.status).toHaveBeenCalledWith(400);
        expect(context.res.body).toEqual({
            error: expect.any(String),
            code: "CONTROLLED_BASELINE_CONFIRMATION_REQUIRED",
            requiredConfirmation,
        });
        expect(context.tradingEngine.syncOpenTrades).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("rejects non-canonical or already-provenanced live selections", async () => {
        const wrongStrategy = createBaselineResumeContext({
            strategy: "timesfm_directional",
        });
        await resumeBaselineHandler(wrongStrategy.req, wrongStrategy.res);

        expect(wrongStrategy.res.status).toHaveBeenCalledWith(409);
        expect(wrongStrategy.res.body).toEqual(
            expect.objectContaining({
                code: "CONTROLLED_BASELINE_RESUME_UNAVAILABLE",
                baselineResume: expect.objectContaining({ eligible: false }),
            })
        );
        expect(
            wrongStrategy.runtimeCoordinator.resumeControlledBaseline
        ).not.toHaveBeenCalled();

        const promoted = createBaselineResumeContext({
            metadata: {
                promotedFromRunId: "candidate-1",
                promotionGate: { passed: true, gateVersion: 2 },
            },
        });
        await resumeBaselineHandler(promoted.req, promoted.res);

        expect(promoted.res.status).toHaveBeenCalledWith(409);
        expect(promoted.res.body.code).toBe(
            "CONTROLLED_BASELINE_RESUME_UNAVAILABLE"
        );
        expect(
            promoted.runtimeCoordinator.resumeControlledBaseline
        ).not.toHaveBeenCalled();
    });

    test("fails closed when engine synchronization cannot be verified", async () => {
        const context = createBaselineResumeContext();
        context.tradingEngine.syncOpenTrades.mockRejectedValueOnce(
            new Error("repository unavailable")
        );

        await resumeBaselineHandler(context.req, context.res);

        expect(context.res.status).toHaveBeenCalledWith(502);
        expect(context.res.body.code).toBe(
            "CONTROLLED_BASELINE_ENGINE_PREFLIGHT_FAILED"
        );
        expect(global.fetch).not.toHaveBeenCalled();
        expect(context.configService.update).not.toHaveBeenCalled();
    });

    test("requires both the engine and broker account to be flat", async () => {
        const engineNotFlat = createBaselineResumeContext({
            engineOpenTrades: [{ id: "engine-trade-1" }],
        });
        await resumeBaselineHandler(engineNotFlat.req, engineNotFlat.res);

        expect(engineNotFlat.res.status).toHaveBeenCalledWith(409);
        expect(engineNotFlat.res.body).toEqual(
            expect.objectContaining({
                code: "CONTROLLED_BASELINE_ENGINE_NOT_FLAT",
                openPositions: 1,
            })
        );
        expect(global.fetch).not.toHaveBeenCalled();

        const brokerNotFlat = createBaselineResumeContext({
            brokerOpenTrades: [{ id: "broker-trade-1" }],
        });
        await resumeBaselineHandler(brokerNotFlat.req, brokerNotFlat.res);

        expect(brokerNotFlat.res.status).toHaveBeenCalledWith(409);
        expect(brokerNotFlat.res.body).toEqual(
            expect.objectContaining({
                code: "CONTROLLED_BASELINE_BROKER_NOT_FLAT",
                openPositions: 1,
            })
        );
        expect(brokerNotFlat.configService.update).not.toHaveBeenCalled();
    });

    test("fails closed when the broker flat-state preflight is unavailable", async () => {
        const context = createBaselineResumeContext({
            brokerError: new Error("broker unavailable"),
        });

        await resumeBaselineHandler(context.req, context.res);

        expect(context.res.status).toHaveBeenCalledWith(502);
        expect(context.res.body.code).toBe(
            "CONTROLLED_BASELINE_BROKER_PREFLIGHT_FAILED"
        );
        expect(context.configService.update).not.toHaveBeenCalled();
    });

    test("creates an honest capped successor lineage and enables only after readiness passes", async () => {
        const context = createBaselineResumeContext();

        await resumeBaselineHandler(context.req, context.res);

        expect(context.runtimeCoordinator.resumeControlledBaseline).toHaveBeenCalledWith(
            expect.objectContaining({
                configSnapshot: expect.objectContaining({
                    strategy: "supertrend_momentum",
                    enableTrading: false,
                    referenceCurrency: "AUD",
                    accountCurrency: "AUD",
                    portfolioRiskEnforcement: true,
                    maxOpenPositions: 1,
                    riskPerTrade: 0.005,
                    maxCapitalAtRisk: 50,
                    maxPortfolioExposure: 0.1,
                }),
                metadata: expect.objectContaining({
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: expect.objectContaining({
                        confirmed: true,
                        predecessorLiveRunId: "legacy-live-1",
                        predecessorShadowRunId: "legacy-shadow-1",
                    }),
                    phase4ControlledLive: expect.objectContaining({
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "legacy-live-1",
                    }),
                }),
            })
        );
        const resumeArguments =
            context.runtimeCoordinator.resumeControlledBaseline.mock.calls[0][0];
        expect(resumeArguments.metadata).not.toHaveProperty("promotionGate");
        expect(resumeArguments.metadata).not.toHaveProperty(
            "promotedFromRunId"
        );
        expect(context.configService.update).toHaveBeenNthCalledWith(
            2,
            { enableTrading: true },
            { allowLiveActivation: true }
        );
        expect(context.res.status).not.toHaveBeenCalled();
        expect(context.res.body).toEqual(
            expect.objectContaining({
                success: true,
                activationBasis: "explicit_user_baseline_resume",
                tradingEnabled: true,
                predecessor: {
                    liveRunId: "legacy-live-1",
                    shadowRunId: "legacy-shadow-1",
                },
                liveReadiness: expect.objectContaining({
                    status: "PASS",
                    activationBasis: "explicit_user_baseline_resume",
                }),
            })
        );
    });

    test("keeps entries paused when the successor fails readiness", async () => {
        const context = createBaselineResumeContext();
        context.runtimeCoordinator.resumeControlledBaseline.mockImplementationOnce(
            async ({ metadata: successorMetadata }) => ({
                selectionId: "controlled-selection-invalid",
                strategy: "supertrend_momentum",
                liveRun: {
                    runId: "controlled-live-invalid",
                    parentRunId: "legacy-live-1",
                    strategy: "supertrend_momentum",
                    configHash: "wrong-live-config-hash",
                    metadata: successorMetadata,
                },
                shadowRun: null,
            })
        );

        await resumeBaselineHandler(context.req, context.res);

        expect(context.res.status).toHaveBeenCalledWith(409);
        expect(context.res.body).toEqual(
            expect.objectContaining({
                code: "CONTROLLED_BASELINE_READINESS_FAILED",
                liveReadiness: expect.objectContaining({
                    status: "FAIL",
                    reasons: expect.arrayContaining([
                        expect.objectContaining({
                            code: "LIVE_CONFIG_IDENTITY_MISMATCH",
                        }),
                    ]),
                }),
            })
        );
        expect(context.configService.update).toHaveBeenCalledTimes(1);
        expect(context.configService.update.mock.calls[0][0]).toEqual(
            expect.objectContaining({ enableTrading: false })
        );
    });
});

describe("tradingRoutes control access", () => {
    test("allows state-changing requests without a control credential", async () => {
        const app = express();
        app.use(express.json());
        app.locals.configService = {
            get: jest.fn(() => ({ enableTrading: false })),
            update: jest.fn(() => ({ enableTrading: false })),
        };
        app.use("/api", tradingRoutes);

        await request(app).post("/api/trading/stop").expect(200);
        expect(app.locals.configService.update).toHaveBeenCalledWith({
            enableTrading: false,
        });
    });
});
