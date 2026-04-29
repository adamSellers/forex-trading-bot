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
        getTradeSummary: jest.fn(async (filters = {}) => {
            const matchingTrades = trades.filter((trade) =>
                matchesRuntimeIdentity(trade, filters)
            );
            const closedTrades = matchingTrades.filter(
                (trade) => trade.isOpen === false
            );
            const winningTrades = closedTrades.filter(
                (trade) => Number(trade.pnlAud || 0) > 0
            );
            const losingTrades = closedTrades.filter(
                (trade) => Number(trade.pnlAud || 0) < 0
            );

            return {
                totalTrades: matchingTrades.length,
                openTradeCount: matchingTrades.filter(
                    (trade) => trade.isOpen !== false
                ).length,
                closedTradeCount: closedTrades.length,
                winningTrades: winningTrades.length,
                losingTrades: losingTrades.length,
                flatTrades:
                    closedTrades.length -
                    winningTrades.length -
                    losingTrades.length,
                realizedPnlAud: closedTrades.reduce(
                    (sum, trade) => sum + Number(trade.pnlAud || 0),
                    0
                ),
            };
        }),
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
                    assets: ["AUD_USD", "EUR_USD", "USD_JPY"],
                    paperStartingBalanceAud: 10000,
                    maxOpenPositions: 2,
                    positionSizeMethod: "FIXED",
                    fixedPositionUnits: 1000,
                    leverage: 20,
                    maxPortfolioExposure: 0.5,
                    maxSpreadPips: 2,
                    maxPriceAgeMs: 15000,
                    enableShorting: true,
                    enableSessionFilter: false,
                    breakevenAtTpPercent: 0.5,
                    timeStopHours: 8,
                },
                metadata: {},
            },
            generator: {
                config: {
                    strategy: "mean_reversion",
                    assets: ["AUD_USD", "EUR_USD", "USD_JPY"],
                    paperStartingBalanceAud: 10000,
                    maxOpenPositions: 2,
                    positionSizeMethod: "FIXED",
                    fixedPositionUnits: 1000,
                    leverage: 20,
                    maxPortfolioExposure: 0.5,
                    maxSpreadPips: 2,
                    maxPriceAgeMs: 15000,
                    enableShorting: true,
                    enableSessionFilter: false,
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
                tradeable: true,
                timestamp: Date.now(),
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

    test("processRunSession rejects paper entries when spread is too wide for live gates", async () => {
        dataService.getCurrentPrice.mockReturnValue({
            price: 1.1,
            spread: 2.5,
            tradeable: true,
            timestamp: Date.now(),
        });

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

        expect(tradeRepository.save).not.toHaveBeenCalled();
        expect(portfolioRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: "run-candidate-1",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                positionCount: 0,
            })
        );
    });

    test("processRunSession rejects stale paper entries before they inflate candidate results", async () => {
        dataService.getCurrentPrice.mockReturnValue({
            price: 1.1,
            spread: 1.1,
            tradeable: true,
            timestamp: Date.now() - 30000,
        });

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

        expect(tradeRepository.save).not.toHaveBeenCalled();
    });

    test("processRunSession rejects paper shorts when live shorting is disabled", async () => {
        session.run.configSnapshot.enableShorting = false;
        session.generator.config.enableShorting = false;

        await runtime.processRunSession(session, [
            {
                symbol: "AUD_USD",
                signal: "SELL",
                strength: 28,
                entryType: "MEAN_REVERSION_BAND_FADE",
                atrPips: 12,
                currentPrice: 1.1,
                configHash: "cfg-1",
                tradePlan: {
                    stopLossPrice: 1.102,
                    takeProfitPrice: 1.099,
                },
            },
        ]);

        expect(tradeRepository.save).not.toHaveBeenCalled();
    });

    test("processRunSession rejects paper entries that breach projected exposure", async () => {
        session.run.configSnapshot.fixedPositionUnits = 100000;
        session.run.configSnapshot.maxPortfolioExposure = 0.05;
        session.generator.config.fixedPositionUnits = 100000;
        session.generator.config.maxPortfolioExposure = 0.05;

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

        expect(tradeRepository.save).not.toHaveBeenCalled();
    });

    test("risk sizing uses max capital at risk instead of the whole paper balance", async () => {
        session.run.configSnapshot.positionSizeMethod = "RISK";
        session.run.configSnapshot.maxCapitalAtRisk = 100;
        session.run.configSnapshot.riskPerTrade = 0.01;
        session.generator.config.positionSizeMethod = "RISK";
        session.generator.config.maxCapitalAtRisk = 100;
        session.generator.config.riskPerTrade = 0.01;

        const units = await runtime.calculatePositionUnits(
            session.run,
            runtime.getResolvedRunConfig(session.run, session.generator.config),
            {
                symbol: "AUD_USD",
                signal: "BUY",
                currentPrice: 1.1,
            },
            1.098
        );

        expect(units).toBe(499);
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

    test("buildRunSummary reports flat closed trades separately from wins and losses", async () => {
        tradeRepository.trades.push(
            {
                id: "paper-win-1",
                instrument: "AUD_USD",
                side: "BUY",
                units: 1000,
                entryPrice: 1.1,
                exitPrice: 1.102,
                pnlAud: 20,
                entryTime: Date.now() - 3000,
                exitTime: Date.now() - 2000,
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                runId: "run-candidate-1",
                ownerRunId: "run-candidate-1",
                selectionId: "selection-1",
                strategy: "mean_reversion",
                isOpen: false,
            },
            {
                id: "paper-flat-1",
                instrument: "EUR_USD",
                side: "SELL",
                units: 1000,
                entryPrice: 1.08,
                exitPrice: 1.08,
                pnlAud: 0,
                entryTime: Date.now() - 2000,
                exitTime: Date.now() - 1000,
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                runId: "run-candidate-1",
                ownerRunId: "run-candidate-1",
                selectionId: "selection-1",
                strategy: "mean_reversion",
                isOpen: false,
            },
            {
                id: "paper-loss-1",
                instrument: "USD_JPY",
                side: "BUY",
                units: 1000,
                entryPrice: 150,
                exitPrice: 149.8,
                pnlAud: -20,
                entryTime: Date.now() - 1000,
                exitTime: Date.now(),
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                runId: "run-candidate-1",
                ownerRunId: "run-candidate-1",
                selectionId: "selection-1",
                strategy: "mean_reversion",
                isOpen: false,
            }
        );

        const summary = await runtime.buildRunSummary(session.run);

        expect(summary).toEqual(
            expect.objectContaining({
                closedTradeCount: 3,
                winningTrades: 1,
                losingTrades: 1,
                flatTrades: 1,
            })
        );
    });
});
