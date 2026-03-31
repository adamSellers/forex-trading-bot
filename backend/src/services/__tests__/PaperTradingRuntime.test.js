const EventEmitter = require("events");
const PaperTradingRuntime = require("../PaperTradingRuntime");
const { RUNTIME_MODES, RUN_STATUSES } = require("../../runtime/runtimeConstants");

function matchesRuntimeIdentity(record, filters = {}) {
    if (filters.mode !== undefined && filters.mode !== null && record.mode !== filters.mode) {
        return false;
    }
    if (filters.runId && record.runId !== filters.runId) {
        return false;
    }
    if (filters.ownerRunId && record.ownerRunId !== filters.ownerRunId) {
        return false;
    }
    if (filters.selectionId && record.selectionId !== filters.selectionId) {
        return false;
    }
    if (filters.strategy && record.strategy !== filters.strategy) {
        return false;
    }
    return true;
}

function createTradeRepository() {
    const trades = [];

    return {
        trades,
        save: jest.fn(async (trade) => {
            trades.push({ ...trade });
        }),
        getOpenTrades: jest.fn(async (filters = {}) =>
            trades
                .filter((trade) => trade.isOpen !== false)
                .filter((trade) => matchesRuntimeIdentity(trade, filters))
                .map((trade) => ({ ...trade }))
        ),
        getAllTrades: jest.fn(async (filters = {}) =>
            trades
                .filter((trade) => matchesRuntimeIdentity(trade, filters))
                .map((trade) => ({ ...trade }))
        ),
        updateTrade: jest.fn(async (tradeId, updates = {}) => {
            const trade = trades.find((candidate) => candidate.id === tradeId);
            if (!trade) return;
            Object.assign(trade, updates);
        }),
        deleteByRunId: jest.fn(async (runId, filters = {}) => {
            const before = trades.length;
            for (let index = trades.length - 1; index >= 0; index -= 1) {
                if (
                    trades[index].runId === runId &&
                    matchesRuntimeIdentity(trades[index], filters)
                ) {
                    trades.splice(index, 1);
                }
            }
            return before - trades.length;
        }),
    };
}

function createPortfolioRepository() {
    const snapshots = [];

    return {
        snapshots,
        save: jest.fn(async (snapshot) => {
            snapshots.push({ ...snapshot });
        }),
        getCurrent: jest.fn(async (filters = {}) => {
            const match = [...snapshots]
                .reverse()
                .find((snapshot) => matchesRuntimeIdentity(snapshot, filters));

            return (
                match || {
                    totalValueAud: 0,
                    balanceAud: 0,
                    unrealizedPnlAud: 0,
                    realizedPnlAud: 0,
                    marginUsedAud: 0,
                    marginAvailableAud: 0,
                    positions: [],
                    positionCount: 0,
                    exposurePercent: 0,
                    snapshotTime: Date.now(),
                    runId: null,
                    selectionId: null,
                    mode: "live",
                    strategy: null,
                }
            );
        }),
        deleteByRunId: jest.fn(async (runId, filters = {}) => {
            const before = snapshots.length;
            for (let index = snapshots.length - 1; index >= 0; index -= 1) {
                if (
                    snapshots[index].runId === runId &&
                    matchesRuntimeIdentity(snapshots[index], filters)
                ) {
                    snapshots.splice(index, 1);
                }
            }
            return before - snapshots.length;
        }),
    };
}

function createSignalRepository() {
    return {
        getRecent: jest.fn(async () => []),
        deleteByRunId: jest.fn(async () => 0),
    };
}

function createRuntimeCoordinator(session) {
    const emitter = new EventEmitter();

    emitter.getRunSession = jest.fn((runId) =>
        session?.run?.runId === runId ? session : null
    );
    emitter.listRuns = jest.fn(() => [
        {
            runId: session.run.runId,
            mode: session.run.mode,
            strategy: session.run.strategy,
            status: session.run.status,
            selectionId: session.run.selectionId,
            metadata: session.run.metadata,
        },
    ]);
    emitter.resetRun = jest.fn(async (runId, updates = {}) => ({
        ...session.run,
        runId,
        startedAt: updates.startedAt || Date.now(),
        metadata: updates.metadata || session.run.metadata,
    }));
    emitter.stopRun = jest.fn(async (runId, updates = {}) => ({
        ...session.run,
        runId,
        status: updates.status || RUN_STATUSES.STOPPED,
    }));

    return emitter;
}

describe("PaperTradingRuntime", () => {
    let tradeRepository;
    let portfolioRepository;
    let signalRepository;
    let runtimeCoordinator;
    let dataService;
    let session;
    let runtime;

    beforeEach(() => {
        session = {
            run: {
                runId: "run-candidate-1",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                strategy: "mean_reversion",
                status: RUN_STATUSES.ACTIVE,
                selectionId: "selection-1",
                configHash: "cfg-1",
                configSnapshot: {
                    strategy: "mean_reversion",
                    paperStartingBalanceAud: 10000,
                    maxOpenPositions: 2,
                    positionSizeMethod: "FIXED",
                    fixedPositionUnits: 1000,
                    leverage: 20,
                    breakevenAtTpPercent: 0.5,
                    timeStopHours: 8,
                },
                metadata: {},
            },
            generator: {
                config: {
                    strategy: "mean_reversion",
                    paperStartingBalanceAud: 10000,
                    maxOpenPositions: 2,
                    positionSizeMethod: "FIXED",
                    fixedPositionUnits: 1000,
                    leverage: 20,
                    breakevenAtTpPercent: 0.5,
                    timeStopHours: 8,
                },
            },
            latestSignals: [],
        };

        tradeRepository = createTradeRepository();
        portfolioRepository = createPortfolioRepository();
        signalRepository = createSignalRepository();
        runtimeCoordinator = createRuntimeCoordinator(session);
        dataService = {
            getCurrentPrice: jest.fn(() => ({
                price: 1.1,
                spread: 1.1,
            })),
            getPipValue: jest.fn(() => 0.0001),
        };

        runtime = new PaperTradingRuntime({
            runtimeCoordinator,
            tradeRepository,
            signalRepository,
            portfolioRepository,
            dataService,
        });
    });

    test("processRunSession opens paper trades with unified runtime identity", async () => {
        await runtime.processRunSession(session, [
            {
                symbol: "AUD_USD",
                signal: "BUY",
                strength: 28,
                entryType: "MEAN_REVERSION_BAND_FADE",
                atrPips: 12,
                currentPrice: 1.1,
                configHash: "cfg-1",
                tradePlan: {
                    stopLossPrice: 1.098,
                    takeProfitPrice: 1.101,
                },
            },
        ]);

        expect(tradeRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                runId: "run-candidate-1",
                ownerRunId: "run-candidate-1",
                selectionId: "selection-1",
                strategy: "mean_reversion",
                takeProfitPrice: 1.101,
            })
        );
        expect(portfolioRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: "run-candidate-1",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                positionCount: 1,
            })
        );
    });

    test("evaluateOpenTrade closes paper trades when take profit is reached", async () => {
        tradeRepository.trades.push({
            id: "paper-trade-1",
            instrument: "AUD_USD",
            side: "BUY",
            units: 1000,
            entryPrice: 1.1,
            entryCostAud: 1100,
            stopLossPrice: 1.098,
            takeProfitPrice: 1.101,
            entryTime: Date.now(),
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
            runId: "run-candidate-1",
            ownerRunId: "run-candidate-1",
            selectionId: "selection-1",
            strategy: "mean_reversion",
            isOpen: true,
        });
        dataService.getCurrentPrice.mockReturnValue({
            price: 1.1015,
            spread: 1.1,
        });

        const closed = await runtime.evaluateOpenTrade(
            tradeRepository.trades[0],
            session.generator.config
        );

        expect(closed).toBe(true);
        expect(tradeRepository.updateTrade).toHaveBeenCalledWith(
            "paper-trade-1",
            expect.objectContaining({
                exitReason: "TAKE_PROFIT",
                isOpen: false,
            })
        );
    });

    test("resetRun clears telemetry and re-seeds the candidate snapshot", async () => {
        tradeRepository.trades.push({
            id: "paper-trade-2",
            instrument: "AUD_USD",
            side: "BUY",
            units: 1000,
            entryPrice: 1.1,
            entryCostAud: 1100,
            stopLossPrice: 1.098,
            takeProfitPrice: 1.101,
            entryTime: Date.now(),
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
            runId: "run-candidate-1",
            ownerRunId: "run-candidate-1",
            selectionId: "selection-1",
            strategy: "mean_reversion",
            isOpen: true,
        });
        portfolioRepository.snapshots.push({
            runId: "run-candidate-1",
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
            totalValueAud: 10020,
            balanceAud: 10000,
            positions: [],
        });

        const resetRun = await runtime.resetRun("run-candidate-1");

        expect(signalRepository.deleteByRunId).toHaveBeenCalledWith(
            "run-candidate-1",
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
            })
        );
        expect(tradeRepository.deleteByRunId).toHaveBeenCalledWith(
            "run-candidate-1",
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
            })
        );
        expect(portfolioRepository.deleteByRunId).toHaveBeenCalledWith(
            "run-candidate-1",
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
            })
        );
        expect(runtimeCoordinator.resetRun).toHaveBeenCalledWith(
            "run-candidate-1",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    lastResetAt: expect.any(Number),
                }),
            })
        );
        expect(portfolioRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: "run-candidate-1",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                totalValueAud: 10000,
                positionCount: 0,
            })
        );
        expect(resetRun.runId).toBe("run-candidate-1");
    });
});
