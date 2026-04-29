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
            liveRun: { runId: "run-live", strategy: "supertrend_momentum" },
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
