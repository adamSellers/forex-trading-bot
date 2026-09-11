const RuntimeCoordinator = require("../runtimeCoordinator");
const { createEngineSupervisor } = require("../engineSupervisor");
const { cloneDefaultConfig, computeConfigHash } = require("../../config/tradingConfig");

describe("first scan after supervised attachment", () => {
    test.each([false, true])("delivers a restored pricing reconsideration to the attached engine (delayed=%s)", async (delayed) => {
        let now = Date.UTC(2026, 8, 11, 4, 4);
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const config = { ...cloneDefaultConfig(), assets: ["EUR_USD"], enableTrading: true };
        const run = {
            runId: "existing-run", strategy: "intraday_momentum", mode: "live", status: "active",
            configSnapshot: config, configHash: computeConfigHash(config), startedAt: now - 3_600_000,
        };
        const signalCandleTime = Date.UTC(2026, 8, 11, 3, 45);
        const setupId = `EUR_USD:LONG:${signalCandleTime}:M15_RANGE_BREAKOUT`;
        const observed = {
            symbol: "EUR_USD", signal: "BUY", intent: "ENTER_LONG", signalClass: "ACTIONABLE",
            entryType: "M15_RANGE_BREAKOUT", setupId, signalCandleTime, currentPrice: 1.10005,
        };
        const entryDecisionRepository = {
            getLatestForSetup: jest.fn(async () => ({
                runId: run.runId, configHash: run.configHash, setupId, signalCandleTime,
                side: "BUY", decisionId: "previous-local-decline", decisionTime: now - 60_000,
                entryReferencePrice: 1.1, outcome: "REJECTED", rejectionCode: "SPREAD_TOO_WIDE",
                canReconsider: true,
            })),
        };
        const dataService = { getCurrentPrice: () => ({ price: observed.currentPrice }), getCandles: () => [] };
        const coordinator = new RuntimeCoordinator({
            configService: { get: () => config }, dataService, entryDecisionRepository,
            tradeRepository: { getOpenTrades: async () => [] },
            strategyRunRepository: { list: async () => [run], retireNonLiveRuns: async () => 0 },
            signalRepository: { saveBatch: async () => {} },
        });
        const received = [];
        const retries = [];
        const engine = {
            isRunning: false,
            start: jest.fn(async () => {
                if (delayed && engine.start.mock.calls.length === 1) throw new Error("Broker unavailable");
                coordinator.on("signalGenerated", (signal) => received.push(signal));
                engine.isRunning = true;
            }),
            startMonitoring: jest.fn(),
        };
        const supervisor = createEngineSupervisor({
            tradingEngine: engine,
            beforeStart: async () => {
                await coordinator.ensureLiveSelectionInitialized();
                // Supply an already-qualified setup; recovery, reservation and
                // delivery use the real generator and coordinator methods.
                coordinator.getActiveLiveSession().generator.generateSignal =
                    jest.fn(async () => ({ ...observed }));
            },
            onStarted: () => coordinator.start(dataService, 60_000),
            setTimeoutFn: (fn) => { const timer = { fn }; retries.push(timer); return timer; },
            clearTimeoutFn: jest.fn(),
        });
        try {
            await supervisor.ensureStarted();
            if (delayed) {
                expect(coordinator.isRunning).toBe(false);
                expect(received).toHaveLength(0);
                expect(entryDecisionRepository.getLatestForSetup).not.toHaveBeenCalled();
                await retries[0].fn();
            }
            expect(engine.isRunning).toBe(true);
            expect(engine.startMonitoring).toHaveBeenCalledTimes(1);
            expect(received).toHaveLength(1);
            expect(received[0]).toMatchObject({
                signal: "BUY", setupId, entryReferencePrice: 1.1,
                entryAttemptId: expect.any(String), currentPrice: 1.10005,
            });
            expect(entryDecisionRepository.getLatestForSetup).toHaveBeenCalledTimes(1);

            now += 60_000;
            await coordinator.runCycle();
            expect(received.filter((signal) => signal.signal === "BUY")).toHaveLength(1);
            expect(received[1]).toMatchObject({ signal: "COOLDOWN", cooldownSuppressed: true });
        } finally {
            coordinator.stop();
            supervisor.cancelPendingRetry();
            jest.restoreAllMocks();
        }
    });
});
