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
        deleteByRuntimeFilters: jest.fn(async (filters = {}) => {
            const before = trades.length;
            for (let index = trades.length - 1; index >= 0; index -= 1) {
                if (matchesRuntimeIdentity(trades[index], filters)) {
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
        deleteByRuntimeFilters: jest.fn(async (filters = {}) => {
            const before = snapshots.length;
            for (let index = snapshots.length - 1; index >= 0; index -= 1) {
                if (matchesRuntimeIdentity(snapshots[index], filters)) {
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
        deleteByRuntimeFilters: jest.fn(async () => 0),
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

function setRunConfig(session, updates = {}) {
    Object.assign(session.run.configSnapshot, updates);
    Object.assign(session.generator.config, updates);
}

describe("PaperTradingRuntime", () => {
    let tradeRepository;
    let portfolioRepository;
    let signalRepository;
    let entryDecisionRepository;
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
        entryDecisionRepository = {
            decisions: [],
            save: jest.fn(async (decision) => {
                entryDecisionRepository.decisions.push({ ...decision });
            }),
            updateDecision: jest.fn(async (decisionId, updates) => {
                const decision = entryDecisionRepository.decisions.find(
                    (candidate) => candidate.decisionId === decisionId
                );
                if (decision) Object.assign(decision, updates);
            }),
            deleteByRuntimeFilters: jest.fn(async () => 0),
        };
        runtimeCoordinator = createRuntimeCoordinator(session);
        dataService = {
            getCurrentPrice: jest.fn(() => ({
                price: 1.1,
                bid: 1.09995,
                ask: 1.10005,
                spread: 1.1,
                tradeable: true,
                timestamp: Date.now(),
            })),
            getPipValue: jest.fn((instrument) =>
                instrument?.includes("JPY") ? 0.01 : 0.0001
            ),
        };

        runtime = new PaperTradingRuntime({
            runtimeCoordinator,
            tradeRepository,
            signalRepository,
            entryDecisionRepository,
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

    test("paper entries persist received-to-filled decisions with runtime identity", async () => {
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

        expect(entryDecisionRepository.save).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: "run-candidate-1",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                strategy: "mean_reversion",
                stage: "RECEIVED",
                outcome: "PENDING",
            })
        );
        expect(entryDecisionRepository.decisions[0]).toEqual(
            expect.objectContaining({
                stage: "FILLED",
                outcome: "FILLED",
                tradeId: expect.any(String),
            })
        );
    });

    test("processRunSession fills paper BUY entries at ask instead of mid", async () => {
        setRunConfig(session, { paperEntrySlippagePips: 0 });

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
                    takeProfitPrice: 1.105,
                },
            },
        ]);

        const savedTrade = tradeRepository.save.mock.calls[0][0];
        expect(savedTrade.entryPrice).toBeCloseTo(1.10005, 5);
        expect(savedTrade.entryCostAud).toBeCloseTo(1000, 2);
        expect(savedTrade.marginUsedAud).toBeCloseTo(50, 2);
        expect(savedTrade.brokerReconciliationPayload.paperRuntime).toEqual(
            expect.objectContaining({
                entryPriceSource: "PAPER_ASK",
                entrySlippagePips: 0,
                accountCurrency: "AUD",
                baseToAccountRate: 1,
                quoteToAccountRate: expect.any(Number),
            })
        );
        expect(
            savedTrade.brokerReconciliationPayload.paperRuntime
                .quoteToAccountRate
        ).toBeCloseTo(1 / 1.10005, 8);
    });

    test("processRunSession falls back when strategy tradePlan has invalid stop direction", async () => {
        setRunConfig(session, { paperEntrySlippagePips: 0 });

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
                    stopLossPrice: 1.102,
                    takeProfitPrice: 1.099,
                },
            },
        ]);

        const savedTrade = tradeRepository.save.mock.calls[0][0];
        expect(savedTrade.entryPrice).toBeCloseTo(1.10005, 5);
        expect(savedTrade.stopLossPrice).toBeLessThan(savedTrade.entryPrice);
        expect(savedTrade.stopLossPrice).not.toBe(1.102);
        expect(savedTrade.takeProfitPrice).toBeNull();
    });

    test("processRunSession closes paper BUY trades at bid on reversal", async () => {
        setRunConfig(session, {
            paperEntrySlippagePips: 0,
            paperExitSlippagePips: 0,
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
                    takeProfitPrice: 1.105,
                },
            },
        ]);

        const openedTrade = tradeRepository.trades[0];
        dataService.getCurrentPrice.mockReturnValue({
            price: 1.101,
            bid: 1.1009,
            ask: 1.1011,
            spread: 2,
            tradeable: true,
            timestamp: Date.now(),
        });

        await runtime.processRunSession(session, [
            {
                symbol: "AUD_USD",
                signal: "SELL",
                strength: 28,
                entryType: "EXIT_ONLY",
                currentPrice: 1.101,
                configHash: "cfg-1",
            },
        ]);

        expect(tradeRepository.updateTrade).toHaveBeenCalledWith(
            openedTrade.id,
            expect.objectContaining({
                exitPrice: 1.1009,
                closePriceSource: "PAPER_BID",
                isOpen: false,
            })
        );
    });

    test("processRunSession applies optional paper slippage against the fill", async () => {
        setRunConfig(session, { paperSlippagePips: 1 });

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
                    takeProfitPrice: 1.105,
                },
            },
        ]);

        const savedTrade = tradeRepository.save.mock.calls[0][0];
        expect(savedTrade.entryPrice).toBeCloseTo(1.10015, 5);
        expect(savedTrade.brokerReconciliationPayload.paperRuntime).toEqual(
            expect.objectContaining({
                entryPriceSource: "PAPER_ASK_WITH_SLIPPAGE",
                entrySlippagePips: 1,
            })
        );
    });

    test("paper execution applies default non-zero entry and exit slippage", () => {
        const entryExecution = runtime.getPaperEntryPrice(
            {
                symbol: "AUD_USD",
                signal: "BUY",
                currentPrice: 1.1,
            },
            {}
        );
        const exitExecution = runtime.getPaperExitPrice(
            {
                instrument: "AUD_USD",
                side: "BUY",
                entryPrice: 1.1,
            },
            {}
        );

        expect(entryExecution.price).toBeCloseTo(1.100075, 6);
        expect(entryExecution.priceSource).toBe("PAPER_ASK_WITH_SLIPPAGE");
        expect(entryExecution.slippagePips).toBe(0.25);
        expect(exitExecution.price).toBeCloseTo(1.099925, 6);
        expect(exitExecution.priceSource).toBe("PAPER_BID_WITH_SLIPPAGE");
        expect(exitExecution.slippagePips).toBe(0.25);
    });

    test("getStopResult fills worse than stop for BUY and SELL paper exits", () => {
        const isolatedRuntime = new PaperTradingRuntime();

        const buyResult = isolatedRuntime.getStopResult(
            {
                side: "BUY",
                instrument: "EUR_USD",
                stopLossPrice: 1.098,
            },
            1.0979,
            {}
        );
        const sellResult = isolatedRuntime.getStopResult(
            {
                side: "SELL",
                instrument: "EUR_USD",
                stopLossPrice: 1.102,
            },
            1.1021,
            {}
        );

        expect(buyResult).toEqual(
            expect.objectContaining({
                exitReason: "STOP_LOSS",
                stopSlippagePips: 0.5,
            })
        );
        expect(buyResult.exitPrice).toBeCloseTo(1.09785, 5);
        expect(buyResult.gapPips).toBeCloseTo(1, 5);
        expect(sellResult).toEqual(
            expect.objectContaining({
                exitReason: "STOP_LOSS",
                stopSlippagePips: 0.5,
            })
        );
        expect(sellResult.exitPrice).toBeCloseTo(1.10215, 5);
        expect(sellResult.gapPips).toBeCloseTo(1, 5);
    });

    test("getPaperStopSlippagePips uses default unless explicitly overridden", () => {
        expect(runtime.getPaperStopSlippagePips({})).toBe(0.5);
        expect(
            runtime.getPaperStopSlippagePips({ paperStopSlippagePips: 0 })
        ).toBe(0);
        expect(
            runtime.getPaperStopSlippagePips({ paperStopSlippagePips: 0.75 })
        ).toBe(0.75);
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
        expect(entryDecisionRepository.decisions[0]).toEqual(
            expect.objectContaining({
                stage: "REJECTED",
                outcome: "REJECTED",
                rejectionCode: "SPREAD_TOO_WIDE",
            })
        );
    });

    test("paper entries fail closed when an AUD conversion path is unavailable", async () => {
        setRunConfig(session, { assets: ["CHF_NZD"] });
        dataService.getCurrentPrice.mockImplementation((instrument) =>
            instrument === "CHF_NZD"
                ? {
                      price: 1.9,
                      bid: 1.8999,
                      ask: 1.9001,
                      spread: 2,
                      tradeable: true,
                      timestamp: Date.now(),
                  }
                : null
        );

        await runtime.processRunSession(session, [
            {
                symbol: "CHF_NZD",
                signal: "BUY",
                strength: 30,
                currentPrice: 1.9,
                atrPips: 10,
                tradePlan: { stopLossPrice: 1.898 },
            },
        ]);

        expect(tradeRepository.save).not.toHaveBeenCalled();
        expect(entryDecisionRepository.decisions[0]).toEqual(
            expect.objectContaining({
                outcome: "REJECTED",
                rejectionCode: "CURRENCY_CONVERSION_UNAVAILABLE",
            })
        );
    });

    test("within-cycle exposure includes a trade opened earlier in the same signal batch", async () => {
        setRunConfig(session, {
            maxPortfolioExposure: 0.009,
            fixedPositionUnits: 1000,
            paperEntrySlippagePips: 0,
        });

        await runtime.processRunSession(session, [
            {
                symbol: "AUD_USD",
                signal: "BUY",
                currentPrice: 1.1,
                atrPips: 12,
                tradePlan: { stopLossPrice: 1.098 },
            },
            {
                symbol: "EUR_USD",
                signal: "BUY",
                currentPrice: 1.1,
                atrPips: 12,
                tradePlan: { stopLossPrice: 1.098 },
            },
        ]);

        expect(tradeRepository.save).toHaveBeenCalledTimes(1);
        expect(entryDecisionRepository.decisions[1]).toEqual(
            expect.objectContaining({
                outcome: "REJECTED",
                rejectionCode: "EXPOSURE_LIMIT",
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

        expect(units).toBe(549);
    });

    test("risk sizing applies fresh-flip and TimesFM multipliers", async () => {
        setRunConfig(session, {
            positionSizeMethod: "RISK",
            maxCapitalAtRisk: 100,
            riskPerTrade: 0.01,
            freshFlipRiskMultiplier: 0.5,
            timesFmEnabled: true,
            timesFmMode: "size",
        });

        const baseline = await runtime.calculatePositionUnits(
            session.run,
            runtime.getResolvedRunConfig(session.run, session.generator.config),
            {
                symbol: "AUD_USD",
                signal: "BUY",
                currentPrice: 1.1,
            },
            1.098
        );
        const adjusted = await runtime.calculatePositionUnits(
            session.run,
            runtime.getResolvedRunConfig(session.run, session.generator.config),
            {
                symbol: "AUD_USD",
                signal: "BUY",
                entryType: "FRESH_FLIP",
                currentPrice: 1.1,
                timesFm: { positionSizeMultiplier: 0.5 },
            },
            1.098
        );

        expect(adjusted).toBe(Math.floor(baseline * 0.25));
    });

    test("strategy trade plans receive the same minimum stop floor as fallback stops", () => {
        const plan = runtime.resolveTradePlan(
            {
                symbol: "AUD_USD",
                signal: "BUY",
                currentPrice: 1.1,
                tradePlan: {
                    stopLossPrice: 1.0995,
                    takeProfitPrice: 1.103,
                },
            },
            { minStopLossPips: 15 }
        );

        expect(plan.floored).toBe(true);
        expect(plan.stopLossPips).toBe(15);
        expect(plan.stopLossPrice).toBeCloseTo(1.0985, 8);
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

    test("paper breakeven can wait for an initial-risk multiple", async () => {
        const trade = {
            id: "paper-risk-breakeven",
            instrument: "AUD_USD",
            side: "BUY",
            entryPrice: 1.1,
            stopLossPrice: 1.098,
            atrPips: 12.5,
            breakevenHit: false,
            brokerReconciliationPayload: {
                paperRuntime: {
                    initialStopLossPrice: 1.098,
                    initialStopDistance: 0.002,
                    atrDistance: 0.00125,
                },
            },
        };
        const config = {
            enableBreakeven: true,
            breakevenTriggerPips: 5,
            breakevenTriggerRiskMultiple: 1,
        };

        await runtime.applyBreakeven(trade, 1.1015, config);
        expect(tradeRepository.updateTrade).not.toHaveBeenCalled();

        await runtime.applyBreakeven(trade, 1.1021, config);
        expect(tradeRepository.updateTrade).toHaveBeenCalledWith(
            "paper-risk-breakeven",
            expect.objectContaining({
                stopLossPrice: 1.1,
                activeStopType: "BREAKEVEN",
            })
        );
    });

    test("paper trailing stop can use initial-risk multiples", async () => {
        const trade = {
            id: "paper-risk-trailing",
            instrument: "AUD_USD",
            side: "BUY",
            entryPrice: 1.1,
            stopLossPrice: 1.098,
            atrPips: 12.5,
            highestPrice: 1.1,
            brokerReconciliationPayload: {
                paperRuntime: {
                    initialStopLossPrice: 1.098,
                    initialStopDistance: 0.002,
                    atrDistance: 0.00125,
                },
            },
        };
        const config = {
            enableTrailingStops: true,
            trailingStopActivationPips: 5,
            trailingStopPips: 5,
            trailingStopActivationRiskMultiple: 1.5,
            trailingStopRiskMultiple: 1,
        };

        await runtime.applyTrailingStop(trade, 1.1025, config);
        expect(tradeRepository.updateTrade).not.toHaveBeenCalled();

        await runtime.applyTrailingStop(trade, 1.1035, config);
        expect(tradeRepository.updateTrade).toHaveBeenCalledWith(
            "paper-risk-trailing",
            expect.objectContaining({
                stopLossPrice: 1.1015,
                trailingStopPrice: 1.1015,
                activeStopType: "TRAILING",
            })
        );
    });

    test("closeTrade converts USD quote PnL into AUD account currency", async () => {
        const trade = {
            id: "paper-aud-usd-pnl",
            instrument: "AUD_USD",
            side: "BUY",
            units: 1000,
            entryPrice: 0.65,
            entryCostAud: 1000,
            entryTime: Date.now() - 1000,
            brokerReconciliationPayload: {
                paperRuntime: {
                    accountCurrency: "AUD",
                },
            },
        };

        const closedTrade = await runtime.closeTrade(
            trade,
            0.651,
            "MANUAL"
        );

        const expectedPnlAud = 1000 * 0.001 * (1 / 0.651);
        expect(closedTrade.pnlPips).toBeCloseTo(10, 5);
        expect(closedTrade.pnlAud).toBeCloseTo(expectedPnlAud, 5);
        expect(tradeRepository.updateTrade).toHaveBeenCalledWith(
            "paper-aud-usd-pnl",
            expect.objectContaining({
                pnlAud: expect.any(Number),
                exitValueAud: 1000,
                brokerReconciliationPayload: expect.objectContaining({
                    paperRuntime: expect.objectContaining({
                        accountCurrency: "AUD",
                        quoteCurrency: "USD",
                        quoteToAccountRate: expect.any(Number),
                        pnlQuote: expect.any(Number),
                    }),
                }),
            })
        );
        expect(
            tradeRepository.updateTrade.mock.calls[0][1]
                .brokerReconciliationPayload.paperRuntime.quoteToAccountRate
        ).toBeCloseTo(1 / 0.651, 8);
    });

    test("closeTrade bridges JPY quote PnL through USD into AUD", async () => {
        dataService.getCurrentPrice.mockImplementation((instrument) => {
            if (instrument === "AUD_USD") {
                return {
                    price: 0.65,
                    bid: 0.64995,
                    ask: 0.65005,
                    spread: 1,
                    tradeable: true,
                    timestamp: Date.now(),
                };
            }
            if (instrument === "USD_JPY") {
                return {
                    price: 150.1,
                    bid: 150.095,
                    ask: 150.105,
                    spread: 1,
                    tradeable: true,
                    timestamp: Date.now(),
                };
            }
            return null;
        });

        const trade = {
            id: "paper-usd-jpy-pnl",
            instrument: "USD_JPY",
            side: "BUY",
            units: 1000,
            entryPrice: 150,
            entryCostAud: 1000 / 0.65,
            entryTime: Date.now() - 1000,
        };

        const closedTrade = await runtime.closeTrade(
            trade,
            150.1,
            "MANUAL"
        );

        const expectedQuoteToAud = (1 / 150.1) * (1 / 0.65);
        const expectedPnlAud = 100 * expectedQuoteToAud;
        expect(closedTrade.pnlPips).toBeCloseTo(10, 5);
        expect(closedTrade.pnlAud).toBeCloseTo(expectedPnlAud, 5);
        expect(
            tradeRepository.updateTrade.mock.calls[0][1]
                .brokerReconciliationPayload.paperRuntime.quoteToAccountRate
        ).toBeCloseTo(expectedQuoteToAud, 8);
    });

    test("closeTrade records commission, financing, spread and slippage costs", async () => {
        const entryTime = Date.UTC(2026, 6, 8, 20, 0, 0);
        const trade = {
            id: "paper-costs",
            instrument: "AUD_USD",
            side: "BUY",
            units: 1000,
            entryPrice: 0.65,
            entryCostAud: 1000,
            entryNotionalAud: 1000,
            entryTime,
            strategy: "mean_reversion",
            brokerReconciliationPayload: {
                paperRuntime: {
                    accountCurrency: "AUD",
                    quoteToAccountRate: 1 / 0.65,
                    entrySpreadPips: 1,
                    entrySlippagePips: 0.25,
                    ownerExitPolicy: {
                        version: 1,
                        strategy: "mean_reversion",
                        config: {
                            paperCommissionPerTradeAud: 1,
                            paperFinancingRates: {
                                AUD_USD: { longRateAnnual: -0.365 },
                            },
                            paperFinancingCutoffHourUtc: 21,
                            paperTripleRolloverWeekday: 3,
                        },
                    },
                },
            },
        };
        const nowSpy = jest
            .spyOn(Date, "now")
            .mockReturnValue(Date.UTC(2026, 6, 8, 22, 0, 0));

        const closedTrade = await runtime.closeTrade(trade, 0.651, "MANUAL", {
            spreadPips: 1,
            slippagePips: 0.25,
        });
        nowSpy.mockRestore();

        expect(closedTrade.commissionAud).toBe(1);
        expect(closedTrade.swapAud).toBeCloseTo(-3, 8);
        expect(closedTrade.pnlAud).toBeLessThan(
            1000 * 0.001 * (1 / 0.651)
        );
        expect(
            closedTrade.brokerReconciliationPayload.paperRuntime
        ).toEqual(
            expect.objectContaining({
                spreadCostAud: expect.any(Number),
                slippageCostAud: expect.any(Number),
                totalCostAud: expect.any(Number),
                costModelVersion: 1,
                financingMode: "MODELED",
                financingStatus: "MODELED",
            })
        );
    });

    test("paper costs consume fresh OANDA financing metadata when available", async () => {
        dataService.getInstrumentFinancing = jest.fn(() => ({
            status: "MODELED",
            longRateAnnual: -0.365,
            shortRateAnnual: 0.1,
            financingDaysOfWeek: [
                { dayOfWeek: "WEDNESDAY", daysCharged: 3 },
            ],
            updatedAt: Date.UTC(2026, 6, 8, 20),
            source: "OANDA_ACCOUNT_INSTRUMENTS",
        }));
        const trade = {
            id: "paper-oanda-financing",
            instrument: "AUD_USD",
            side: "BUY",
            units: 1000,
            entryPrice: 0.65,
            entryCostAud: 1000,
            entryTime: Date.UTC(2026, 6, 8, 20),
            brokerReconciliationPayload: {
                paperRuntime: {
                    accountCurrency: "AUD",
                    quoteToAccountRate: 1 / 0.65,
                },
            },
        };
        const nowSpy = jest
            .spyOn(Date, "now")
            .mockReturnValue(Date.UTC(2026, 6, 8, 22));

        const closed = await runtime.closeTrade(trade, 0.651, "MANUAL");
        nowSpy.mockRestore();

        expect(closed.swapAud).toBeCloseTo(-3, 8);
        expect(
            closed.brokerReconciliationPayload.paperRuntime
        ).toEqual(
            expect.objectContaining({
                financingMode: "MODELED",
                financingStatus: "MODELED",
                financingSource: "OANDA_ACCOUNT_INSTRUMENTS",
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

    test("resetAllPaper clears paper modes and re-seeds active paper snapshots", async () => {
        tradeRepository.trades.push(
            {
                id: "paper-shadow-trade",
                mode: RUNTIME_MODES.PAPER_SHADOW,
                runId: "run-shadow-1",
                ownerRunId: "run-shadow-1",
                isOpen: false,
            },
            {
                id: "paper-candidate-trade",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                runId: "run-candidate-1",
                ownerRunId: "run-candidate-1",
                isOpen: false,
            },
            {
                id: "live-trade",
                mode: RUNTIME_MODES.LIVE,
                runId: "run-live-1",
                ownerRunId: "run-live-1",
                isOpen: false,
            }
        );
        portfolioRepository.snapshots.push(
            {
                runId: "run-candidate-1",
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                totalValueAud: 9990,
                balanceAud: 9990,
            },
            {
                runId: "run-live-1",
                mode: RUNTIME_MODES.LIVE,
                totalValueAud: 10000,
                balanceAud: 10000,
            }
        );

        const result = await runtime.resetAllPaper();

        expect(tradeRepository.deleteByRuntimeFilters).toHaveBeenCalledWith({
            mode: RUNTIME_MODES.PAPER_SHADOW,
        });
        expect(tradeRepository.deleteByRuntimeFilters).toHaveBeenCalledWith({
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
        });
        expect(signalRepository.deleteByRuntimeFilters).toHaveBeenCalledTimes(2);
        expect(entryDecisionRepository.deleteByRuntimeFilters).toHaveBeenCalledTimes(2);
        expect(portfolioRepository.deleteByRuntimeFilters).toHaveBeenCalledTimes(2);
        expect(tradeRepository.trades).toEqual([
            expect.objectContaining({
                id: "live-trade",
                mode: RUNTIME_MODES.LIVE,
            }),
        ]);
        expect(runtimeCoordinator.resetRun).toHaveBeenCalledWith(
            "run-candidate-1",
            expect.objectContaining({
                metadata: expect.objectContaining({
                    lastGlobalPaperResetAt: expect.any(Number),
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
        expect(result.counts.tradesDeleted).toBe(2);
        expect(result.runs).toHaveLength(1);
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
