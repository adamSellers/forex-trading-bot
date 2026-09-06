const RuntimeCoordinator = require("../runtimeCoordinator");
const { cloneDefaultConfig, computeConfigHash } = require("../../config/tradingConfig");

function dependencies(config = cloneDefaultConfig()) {
    const strategyRunRepository = {
        list: jest.fn(async () => []),
        create: jest.fn(async (run) => run),
        update: jest.fn(async () => true),
        getByRunId: jest.fn(async () => null),
        retireNonLiveRuns: jest.fn(async () => 0),
    };
    const tradeRepository = {
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
                strategy: "intraday_momentum",
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

    test("marks an older live owner managing-only until its broker trade exits", async () => {
        const deps = dependencies();
        const coordinator = new RuntimeCoordinator(deps);
        const first = await coordinator.selectLiveStrategy({
            strategyKey: "intraday_momentum",
            configSnapshot: deps.configService.get(),
        });
        deps.tradeRepository.getOpenTrades.mockImplementation(async (filters) => {
            const trade = {
                id: "trade-1",
                instrument: "EUR_USD",
                ownerRunId: first.liveRun.runId,
                strategy: "intraday_momentum",
            };
            return !filters.ownerRunId || filters.ownerRunId === first.liveRun.runId
                ? [trade]
                : [];
        });

        const nextConfig = {
            ...deps.configService.get(),
            liveReleaseVersion: "m15-intraday-v2",
        };
        await coordinator.selectLiveStrategy({
            strategyKey: "intraday_momentum",
            configSnapshot: nextConfig,
            parentLiveRunId: first.liveRun.runId,
        });

        expect(coordinator.getRunSession(first.liveRun.runId).run.status).toBe(
            "managing_only"
        );
        expect(
            coordinator.getRunSession(first.liveRun.runId).managedInstruments
        ).toContain("EUR_USD");
        expect(coordinator.listRuns().filter((run) => run.status === "active"))
            .toHaveLength(1);
    });
});
