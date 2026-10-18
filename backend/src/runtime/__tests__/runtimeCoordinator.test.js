const RuntimeCoordinator = require("../runtimeCoordinator");
const { cloneDefaultConfig, computeConfigHash } = require("../../config/tradingConfig");

function dependencies(config = cloneDefaultConfig()) {
    const strategyRunRepository = {
        list: jest.fn(async () => []),
        create: jest.fn(async (run) => run),
        replaceActiveRun: jest.fn(async (runId, updates, run) => run),
        update: jest.fn(async () => true),
        getByRunId: jest.fn(async () => null),
        retireNonLiveRuns: jest.fn(async () => 0),
    };
    const tradeRepository = {
        getAllTrades: jest.fn(async () => []),
        getOpenTrades: jest.fn(async () => []),
        updateTrade: jest.fn(async () => true),
    };
    const dataService = {
        updateRuntimeTimeframes: jest.fn(),
        getCurrentPrice: jest.fn(() => ({ price: 1.1, spread: 0.8 })),
        getCandles: jest.fn(() => [
            { time: "2026-08-03T00:00:00Z", open: 1, high: 1.2, low: 0.9, close: 1.1 },
            { time: "2026-08-03T04:00:00Z", open: 1.1, high: 1.2, low: 1, close: 1.15 },
        ]),
    };
    const configService = { get: jest.fn(() => config) };
    return {
        strategyRunRepository,
        tradeRepository,
        dataService,
        configService,
    };
}

describe("RuntimeCoordinator live-only release", () => {
    test("records a no-data decision for each configured pair instead of silently skipping the cycle", async () => {
        const deps = dependencies();
        deps.dataService.getCurrentPrice.mockReturnValue(null);
        deps.dataService.getCandles.mockReturnValue([]);
        const coordinator = new RuntimeCoordinator(deps);
        await coordinator.ensureLiveSelectionInitialized();
        const signals = await coordinator.runCycle();
        expect(signals).toHaveLength(deps.configService.get().assets.length);
        expect(signals.every((signal) => signal.reasonCode === "INSUFFICIENT_DATA")).toBe(true);
    });

    test("bootstraps exactly one active live release", async () => {
        const deps = dependencies();
        const coordinator = new RuntimeCoordinator(deps);
        const selection = await coordinator.ensureLiveSelectionInitialized();

        expect(selection).toEqual(
            expect.objectContaining({
                strategy: "multi_day_trend",
                liveRun: expect.objectContaining({
                    mode: "live",
                    status: "active",
                    configHash: computeConfigHash(deps.configService.get()),
                }),
            })
        );
        expect(coordinator.listRuns()).toHaveLength(1);
        expect(deps.strategyRunRepository.retireNonLiveRuns).toHaveBeenCalledTimes(1);
        expect(deps.strategyRunRepository.create).toHaveBeenCalledTimes(1);

        await coordinator.ensureLiveSelectionInitialized();
        expect(deps.strategyRunRepository.create).toHaveBeenCalledTimes(1);
    });

    test("rejects every non-live run", async () => {
        const coordinator = new RuntimeCoordinator(dependencies());
        await expect(
            coordinator.startRun({
                mode: "simulated",
                strategy: "intraday_momentum",
            })
        ).rejects.toMatchObject({ code: "LIVE_ONLY_RUNTIME" });
    });

    test("allows supervised retry when the initial scan fails", async () => {
        const coordinator = new RuntimeCoordinator(dependencies());
        const cycle = jest.spyOn(coordinator, "runCycle")
            .mockRejectedValueOnce(new Error("Decision history unavailable"))
            .mockResolvedValue([]);
        try {
            await expect(coordinator.start()).rejects.toThrow("Decision history unavailable");
            expect(coordinator.isRunning).toBe(false);
            expect(coordinator.runInterval).toBeNull();
            await coordinator.start();
            expect(coordinator.isRunning).toBe(true);
            expect(coordinator.runInterval).not.toBeNull();
            expect(cycle).toHaveBeenCalledTimes(2);
        } finally {
            coordinator.stop();
        }
    });

    test("H4 startup creates one new cohort and preserves a prior owner's attribution and exit config", async () => {
        const deployed = cloneDefaultConfig();
        const priorConfig = {
            ...require("../../../../shared/legacyIntradayConfigDefaults.json"),
            liveReleaseVersion: "m15-intraday-v3",
            executionPolicyVersion: "intraday-risk-v3",
            pricingModelVersion: "broker-liquidity-v2",
            intradayTargetRiskMultiple: 1.8,
            timeStopHours: 4,
        };
        const priorRun = {
            runId: "live_previous_quote_policy",
            mode: "live",
            status: "active",
            strategy: "intraday_momentum",
            selectionId: "selection_previous_quote_policy",
            configSnapshot: priorConfig,
            configHash: computeConfigHash(priorConfig),
            metadata: { entryEnabled: true, releaseVersion: priorConfig.liveReleaseVersion },
            startedAt: 1000,
        };
        const deps = dependencies(deployed);
        deps.strategyRunRepository.list.mockResolvedValue([priorRun]);
        const trade = {
            id: "trade-1",
            instrument: "EUR_USD",
            ownerRunId: priorRun.runId,
            runId: priorRun.runId,
            configHash: priorRun.configHash,
            selectionId: priorRun.selectionId,
            strategy: "intraday_momentum",
        };
        deps.tradeRepository.getOpenTrades.mockImplementation(async (filters) =>
            !filters.ownerRunId || filters.ownerRunId === priorRun.runId ? [trade] : []
        );
        const coordinator = new RuntimeCoordinator(deps);
        const selection = await coordinator.ensureLiveSelectionInitialized();
        const priorOwner = coordinator.getRunSession(priorRun.runId);

        expect(selection.liveRun).toEqual(expect.objectContaining({
            status: "active",
            parentRunId: priorRun.runId,
            configHash: computeConfigHash(deps.configService.get()),
        }));
        expect(selection.liveRun.configHash).not.toBe(priorRun.configHash);
        expect(priorOwner.run).toEqual({
            ...priorRun,
            parentRunId: null,
            stoppedAt: null,
            status: "managing_only",
            metadata: { ...priorRun.metadata, entryEnabled: false },
        });
        expect(priorOwner.generator.config).toEqual(priorConfig);
        expect(priorOwner.managedInstruments).toContain("EUR_USD");
        expect(deps.tradeRepository.updateTrade).not.toHaveBeenCalled();
        expect(coordinator.listRuns().filter((run) => run.status === "active"))
            .toHaveLength(1);

        await coordinator.ensureLiveSelectionInitialized();
        expect(deps.strategyRunRepository.replaceActiveRun).toHaveBeenCalledTimes(1);
        expect(deps.strategyRunRepository.create).not.toHaveBeenCalled();
        deps.tradeRepository.getOpenTrades.mockResolvedValue([]);
        await coordinator.syncLiveTradeOwnership();
        expect(coordinator.getRunSession(priorRun.runId)).toBeNull();
        expect(deps.strategyRunRepository.update).toHaveBeenLastCalledWith(priorRun.runId,
            expect.objectContaining({ status: "stopped" }));
        // Run history is retired through status/metadata; its snapshot/hash and
        // the trade record are never rewritten to the new pricing identity.
        for (const [, updates] of deps.strategyRunRepository.update.mock.calls) {
            expect(updates).not.toHaveProperty("configSnapshot");
            expect(updates).not.toHaveProperty("configHash");
        }
    });
});
