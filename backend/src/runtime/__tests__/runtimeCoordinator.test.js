const RuntimeCoordinator = require("../runtimeCoordinator");
const { RUNTIME_MODES, RUN_STATUSES } = require("../runtimeConstants");

function createMockDataService() {
    const instruments = {
        AUD_USD: {
            price: {
                instrument: "AUD_USD",
                price: 1.125,
                bid: 1.1249,
                ask: 1.1251,
                spread: 2,
                tradeable: true,
                timestamp: Date.now(),
            },
        },
        EUR_USD: {
            price: {
                instrument: "EUR_USD",
                price: 1.0815,
                bid: 1.0814,
                ask: 1.0816,
                spread: 2,
                tradeable: true,
                timestamp: Date.now(),
            },
        },
    };

    const buildCandles = (start = 1.05) =>
        Array.from({ length: 220 }, (_, index) => {
            const base = start + index * 0.0003;
            return {
                time: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
                open: base,
                high: base + 0.0005,
                low: base - 0.0005,
                close: base + 0.0001,
                volume: 100,
            };
        });

    const candlesByInstrument = {
        AUD_USD: buildCandles(1.04),
        EUR_USD: buildCandles(1.02),
    };

    return {
        getCurrentPrice: jest.fn((instrument) => instruments[instrument]?.price || null),
        getCandles: jest.fn((instrument) => candlesByInstrument[instrument] || []),
        getPipValue: jest.fn((instrument) =>
            instrument.includes("JPY") ? 0.01 : 0.0001
        ),
    };
}

describe("RuntimeCoordinator", () => {
    let coordinator;
    let dataService;
    let signalRepository;
    let strategyRunRepository;
    let tradeRepository;
    let configService;
    let openTrades;
    let timesFmSignalService;

    beforeEach(() => {
        dataService = createMockDataService();
        signalRepository = {
            saveBatch: jest.fn().mockResolvedValue(undefined),
        };
        openTrades = [];
        tradeRepository = {
            getOpenTrades: jest.fn(async (filters = {}) =>
                openTrades.filter((trade) => {
                    if (filters.mode && trade.mode !== filters.mode) return false;
                    if (filters.ownerRunId && trade.ownerRunId !== filters.ownerRunId) {
                        return false;
                    }
                    return trade.isOpen !== false;
                })
            ),
            updateTrade: jest.fn().mockResolvedValue(undefined),
        };
        strategyRunRepository = {
            create: jest.fn(async (run) => run),
            getByRunId: jest.fn().mockResolvedValue(null),
            update: jest.fn(async (_runId, updates) => updates),
            list: jest.fn().mockResolvedValue([]),
        };
        configService = {
            get: jest.fn(() => ({
                strategy: 'supertrend_momentum',
                assets: ['AUD_USD'],
                timeframe: '15m',
                enableHTFFilter: true,
                htfTimeframe: '1h',
                timesFmEnabled: true,
                timesFmMode: 'observe',
            })),
        };
        timesFmSignalService = {
            getForecastContext: jest.fn(async () => ({
                available: true,
                direction: "BULLISH",
                confidence: 0.82,
                returnBps: 14.4,
                volatilityRegime: "NORMAL",
                neutral: false,
            })),
            enrichSignal: jest.fn(async (signal) => ({
                ...signal,
                timesFm: {
                    available: false,
                    reason: signal.signal === 'HOLD' ? 'not_actionable' : 'disabled',
                    mode: 'observe',
                    positionSizeMultiplier: 1,
                },
            })),
            refreshHealth: jest.fn().mockResolvedValue({
                ok: true,
                connected: true,
                status: 'ok',
                ready: true,
            }),
            getStatus: jest.fn(() => ({
                enabled: true,
                mode: 'observe',
                configured: true,
                connected: true,
                available: true,
                status: 'ok',
                ready: true,
            })),
        };

        coordinator = new RuntimeCoordinator({
            dataService,
            signalRepository,
            strategyRunRepository,
            tradeRepository,
            configService,
            timesFmSignalService,
            pollIntervalMs: 50,
        });
    });

    afterEach(() => {
        coordinator.stop();
    });

    test("startRun persists and registers runtime sessions", async () => {
        const run = await coordinator.startRun({
            runId: "run-live-1",
            mode: RUNTIME_MODES.LIVE,
            strategy: "supertrend_momentum",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-1",
            configSnapshot: {
                strategy: "supertrend_momentum",
                assets: ["AUD_USD"],
                timeframe: "15m",
                enableHTFFilter: true,
                htfTimeframe: "1h",
            },
        });

        expect(strategyRunRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: "run-live-1",
                mode: RUNTIME_MODES.LIVE,
                strategy: "supertrend_momentum",
            })
        );
        expect(run.runId).toBe("run-live-1");
        expect(coordinator.getRunSession("run-live-1")).toBeTruthy();
    });

    test("runCycle enriches and persists signals with runtime identity", async () => {
        await coordinator.startRun({
            runId: "run-shadow-1",
            mode: RUNTIME_MODES.PAPER_SHADOW,
            strategy: "mean_reversion",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-1",
            configSnapshot: {
                strategy: "mean_reversion",
                assets: ["AUD_USD"],
                timeframe: "15m",
                enableHTFFilter: true,
                htfTimeframe: "1h",
            },
        });

        const signals = await coordinator.runCycle();

        expect(signals).toHaveLength(1);
        expect(signals[0]).toEqual(
            expect.objectContaining({
                symbol: "AUD_USD",
                signal: "HOLD",
                runId: "run-shadow-1",
                selectionId: "selection-1",
                mode: RUNTIME_MODES.PAPER_SHADOW,
                strategy: "mean_reversion",
                runtimeStatus: RUN_STATUSES.ACTIVE,
                entryEnabled: false,
                timesFm: expect.objectContaining({
                    reason: "not_actionable",
                    mode: "observe",
                }),
            })
        );
        expect(signalRepository.saveBatch).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    runId: "run-shadow-1",
                    mode: RUNTIME_MODES.PAPER_SHADOW,
                    timesFm: expect.objectContaining({
                        reason: "not_actionable",
                    }),
                }),
            ])
        );
        expect(timesFmSignalService.enrichSignal).toHaveBeenCalled();
    });

    test("runCycle prefetched TimesFM context for the native TimesFM candidate strategy", async () => {
        await coordinator.startRun({
            runId: "run-timesfm-1",
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
            strategy: "timesfm_directional",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-timesfm",
            configSnapshot: {
                strategy: "timesfm_directional",
                assets: ["AUD_USD"],
                timeframe: "15m",
                timesFmEnabled: true,
                timesFmMode: "observe",
            },
        });

        const signals = await coordinator.runCycle();

        expect(timesFmSignalService.getForecastContext).toHaveBeenCalledWith(
            expect.objectContaining({
                instrument: "AUD_USD",
                timeframe: "15m",
                config: expect.objectContaining({
                    strategy: "timesfm_directional",
                }),
            })
        );
        expect(signals).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    runId: "run-timesfm-1",
                    strategy: "timesfm_directional",
                    signal: "BUY",
                    reasonCode: "TIMESFM_DIRECTIONAL_LONG_ACTIONABLE",
                    timesFm: expect.objectContaining({
                        available: true,
                        direction: "BULLISH",
                        returnBps: 14.4,
                    }),
                }),
            ])
        );
        expect(timesFmSignalService.enrichSignal).not.toHaveBeenCalled();
    });

    test("runCycle prefetched TimesFM context for a promoted live TimesFM strategy", async () => {
        await coordinator.startRun({
            runId: "run-timesfm-live-1",
            mode: RUNTIME_MODES.LIVE,
            strategy: "timesfm_directional",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-timesfm-live",
            configSnapshot: {
                strategy: "timesfm_directional",
                assets: ["AUD_USD"],
                timeframe: "15m",
                timesFmEnabled: true,
                timesFmMode: "observe",
            },
        });

        const signals = await coordinator.runCycle();

        expect(timesFmSignalService.getForecastContext).toHaveBeenCalledWith(
            expect.objectContaining({
                instrument: "AUD_USD",
                timeframe: "15m",
                config: expect.objectContaining({
                    strategy: "timesfm_directional",
                }),
            })
        );
        expect(signals).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    runId: "run-timesfm-live-1",
                    mode: RUNTIME_MODES.LIVE,
                    strategy: "timesfm_directional",
                    entryEnabled: true,
                    signal: "BUY",
                    reasonCode: "TIMESFM_DIRECTIONAL_LONG_ACTIONABLE",
                    timesFm: expect.objectContaining({
                        available: true,
                        direction: "BULLISH",
                        returnBps: 14.4,
                    }),
                }),
            ])
        );
        expect(timesFmSignalService.enrichSignal).not.toHaveBeenCalled();
    });

    test("native TimesFM HOLD signals retain forecast context", async () => {
        timesFmSignalService.getForecastContext.mockResolvedValueOnce({
            available: false,
            reason: "sidecar_unavailable",
            mode: "observe",
            direction: null,
            confidence: 0,
            returnBps: 0,
        });

        await coordinator.startRun({
            runId: "run-timesfm-live-hold",
            mode: RUNTIME_MODES.LIVE,
            strategy: "timesfm_directional",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-timesfm-live",
            configSnapshot: {
                strategy: "timesfm_directional",
                assets: ["AUD_USD"],
                timeframe: "15m",
                timesFmEnabled: true,
                timesFmMode: "observe",
            },
        });

        const signals = await coordinator.runCycle();

        expect(signals).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    runId: "run-timesfm-live-hold",
                    mode: RUNTIME_MODES.LIVE,
                    strategy: "timesfm_directional",
                    entryEnabled: true,
                    signal: "HOLD",
                    reasonCode: "TIMESFM_DIRECTIONAL_NO_FORECAST",
                    timesFm: expect.objectContaining({
                        available: false,
                        reason: "sidecar_unavailable",
                    }),
                }),
            ])
        );
        expect(timesFmSignalService.enrichSignal).not.toHaveBeenCalled();
    });

    test("managing-only live runs evaluate only managed instruments", async () => {
        await coordinator.startRun({
            runId: "run-live-old",
            mode: RUNTIME_MODES.LIVE,
            strategy: "mean_reversion",
            status: RUN_STATUSES.MANAGING_ONLY,
            selectionId: "selection-old",
            configSnapshot: {
                strategy: "mean_reversion",
                assets: ["AUD_USD", "EUR_USD"],
                timeframe: "15m",
            },
        });

        openTrades = [
            {
                id: 'trade-managed-1',
                instrument: 'EUR_USD',
                ownerRunId: 'run-live-old',
                runId: 'run-live-old',
                selectionId: 'selection-old',
                strategy: 'mean_reversion',
                configHash: 'cfg-old',
                mode: RUNTIME_MODES.LIVE,
                isOpen: true,
            },
        ];
        coordinator.setManagedInstruments("run-live-old", ["EUR_USD"]);
        const signals = await coordinator.runCycle();

        expect(signals).toHaveLength(1);
        expect(signals[0].symbol).toBe("EUR_USD");
    });

    test("stopRun updates persistence and removes the session", async () => {
        await coordinator.startRun({
            runId: "run-live-2",
            mode: RUNTIME_MODES.LIVE,
            strategy: "supertrend_momentum",
            status: RUN_STATUSES.ACTIVE,
            configSnapshot: {
                strategy: "supertrend_momentum",
                assets: ["AUD_USD"],
                timeframe: "15m",
            },
        });

        const stopped = await coordinator.stopRun("run-live-2", {
            metadata: { reason: "manual-stop" },
        });

        expect(strategyRunRepository.update).toHaveBeenCalledWith(
            "run-live-2",
            expect.objectContaining({
                status: RUN_STATUSES.STOPPED,
            })
        );
        expect(stopped.status).toBe(RUN_STATUSES.STOPPED);
        expect(coordinator.getRunSession("run-live-2")).toBeNull();
    });

    test("ensureLiveSelectionInitialized creates an active live run with a paired shadow run", async () => {
        const selection = await coordinator.ensureLiveSelectionInitialized();

        expect(selection).toEqual(
            expect.objectContaining({
                strategy: 'supertrend_momentum',
                liveRun: expect.objectContaining({
                    mode: RUNTIME_MODES.LIVE,
                    status: RUN_STATUSES.ACTIVE,
                }),
                shadowRun: expect.objectContaining({
                    mode: RUNTIME_MODES.PAPER_SHADOW,
                    status: RUN_STATUSES.ACTIVE,
                }),
            })
        );
        expect(coordinator.listRuns()).toHaveLength(2);
    });

    test("selectLiveStrategy demotes the previous live run to managing-only when it still owns open trades", async () => {
        const initialSelection = await coordinator.ensureLiveSelectionInitialized();
        openTrades = [
            {
                id: 'trade-open-1',
                instrument: 'AUD_USD',
                ownerRunId: initialSelection.liveRun.runId,
                runId: initialSelection.liveRun.runId,
                selectionId: initialSelection.selectionId,
                strategy: 'supertrend_momentum',
                configHash: initialSelection.configHash,
                mode: RUNTIME_MODES.LIVE,
                isOpen: true,
            },
        ];

        const nextSelection = await coordinator.selectLiveStrategy({
            strategyKey: 'supertrend_momentum',
            configSnapshot: {
                strategy: 'supertrend_momentum',
                assets: ['AUD_USD'],
                timeframe: '15m',
                enableHTFFilter: true,
                htfTimeframe: '1h',
            },
            initiatedBy: 'ui',
        });

        const previousLiveRun = coordinator.getRunSession(initialSelection.liveRun.runId);

        expect(previousLiveRun.run.status).toBe(RUN_STATUSES.MANAGING_ONLY);
        expect(nextSelection.liveRun.runId).not.toBe(initialSelection.liveRun.runId);
        expect(nextSelection.shadowRun).toEqual(
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_SHADOW,
                status: RUN_STATUSES.ACTIVE,
            })
        );
    });

    test("createCandidateRun attaches the candidate session to the active live selection", async () => {
        const liveSelection = await coordinator.ensureLiveSelectionInitialized();

        const candidateRun = await coordinator.createCandidateRun({
            strategyKey: "supertrend_momentum",
            configSnapshot: {
                strategy: "supertrend_momentum",
                assets: ["AUD_USD"],
                timeframe: "15m",
            },
            initiatedBy: "ui",
            metadata: {
                displayName: "Shadow Challenger",
            },
        });

        expect(candidateRun).toEqual(
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                strategy: "supertrend_momentum",
                status: RUN_STATUSES.ACTIVE,
                selectionId: liveSelection.selectionId,
                metadata: expect.objectContaining({
                    initiatedBy: "ui",
                    pairedLiveRunId: liveSelection.liveRun.runId,
                    displayName: "Shadow Challenger",
                }),
            })
        );
        expect(strategyRunRepository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: RUNTIME_MODES.PAPER_CANDIDATE,
                selectionId: liveSelection.selectionId,
            })
        );
    });

    test("resetRun clears session state and persists the restarted timestamp", async () => {
        await coordinator.startRun({
            runId: "run-candidate-reset",
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
            strategy: "supertrend_momentum",
            status: RUN_STATUSES.ACTIVE,
            selectionId: "selection-reset",
            configSnapshot: {
                strategy: "supertrend_momentum",
                assets: ["AUD_USD"],
                timeframe: "15m",
            },
        });

        const session = coordinator.getRunSession("run-candidate-reset");
        session.latestSignals = [{ symbol: "AUD_USD", signal: "BUY" }];
        session.managedInstruments.add("AUD_USD");

        const resetRun = await coordinator.resetRun("run-candidate-reset", {
            startedAt: 1710001234567,
            metadata: {
                reason: "manual-reset",
            },
        });

        expect(resetRun.startedAt).toBe(1710001234567);
        expect(session.latestSignals).toEqual([]);
        expect(session.managedInstruments.size).toBe(0);
        expect(strategyRunRepository.update).toHaveBeenCalledWith(
            "run-candidate-reset",
            expect.objectContaining({
                startedAt: 1710001234567,
                stoppedAt: null,
                metadata: {
                    reason: "manual-reset",
                },
            })
        );
    });
});
