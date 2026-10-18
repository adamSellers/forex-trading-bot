const RuntimeCoordinator = require("../runtimeCoordinator");
const LiveTradingEngine = require("../../services/LiveTradingEngine");
const { computeConfigHash } = require("../../config/tradingConfig");
const cloneDefaultConfig = () => JSON.parse(JSON.stringify(require("../../../../shared/legacyIntradayConfigDefaults.json")));
const { CONSECUTIVE_LOSS_COOLDOWN_MS } = require("../portfolioRiskPolicy");

jest.mock("../../services/Oandaclient", () => {
    const client = jest.requireActual("../../services/Oandaclient");
    return {
    getAccountSummary: jest.fn(async () => ({
        account: { currency: "AUD", NAV: "1000", balance: "1000", marginAvailable: "1000" },
    })),
    getPipValue: jest.fn(() => 0.0001),
    formatPrice: client.formatPrice.bind(client),
    formatPriceBound: client.formatPriceBound.bind(client),
    placeMarketOrder: jest.fn(),
    };
});
jest.mock("../../services/emailService", () => ({}));

const copy = (value) => JSON.parse(JSON.stringify(value));
const now = Date.UTC(2026, 8, 10, 6);
const finalExit = now - 3_600_000;
const deadline = finalExit + CONSECUTIVE_LOSS_COOLDOWN_MS;

function fixture({ losses = 3, exitTime = finalExit, ownerRunId = "prior-run" } = {}) {
    const config = {
        ...cloneDefaultConfig(),
        enableTrading: true,
        enableSessionFilter: false,
        maxPortfolioExposure: 0,
    };
    const priorConfig = { ...config, liveReleaseVersion: "prior-release" };
    const priorRun = {
        runId: "prior-run",
        mode: "live",
        status: "active",
        strategy: "intraday_momentum",
        selectionId: "prior-selection",
        configSnapshot: priorConfig,
        configHash: computeConfigHash(priorConfig),
        metadata: { entryEnabled: true },
        startedAt: exitTime - 10_000,
    };
    const records = new Map([[priorRun.runId, copy(priorRun)]]);
    const trades = Array.from({ length: losses }, (_, index) => ({
        id: `loss-${index}`,
        isOpen: false,
        pnlAud: -0.1,
        exitTime: exitTime - (losses - index - 1) * 1000,
        ownerRunId,
        runId: ownerRunId,
        configHash: priorRun.configHash,
    }));
    const strategyRunRepository = {
        list: jest.fn(async ({ statuses }) => [...records.values()]
            .filter((run) => statuses.includes(run.status)).map(copy)),
        create: jest.fn(async (run) => { records.set(run.runId, copy(run)); return copy(run); }),
        update: jest.fn(async (runId, updates) => {
            records.set(runId, copy({ ...records.get(runId), ...updates }));
        }),
        replaceActiveRun: jest.fn(async (runId, updates, run) => {
            records.set(runId, copy({ ...records.get(runId), ...updates }));
            records.set(run.runId, copy(run));
            return copy(run);
        }),
        getByRunId: jest.fn(async (runId) => copy(records.get(runId))),
        retireNonLiveRuns: jest.fn(async () => 0),
    };
    const tradeRepository = {
        getAllTrades: jest.fn(async () => copy(trades)),
        getOpenTrades: jest.fn(async () => []),
        updateTrade: jest.fn(),
    };
    const configService = { get: () => config };
    const dataService = {
        updateRuntimeTimeframes: jest.fn(),
        getCurrentPrice: () => ({
            instrument: "AUD_USD", price: 0.7, bid: 0.69995, ask: 0.70005,
            spread: 1, tradeable: true, timestamp: Date.now(), fetchedAt: Date.now(),
        }),
    };
    const boot = async () => {
        const coordinator = new RuntimeCoordinator({
            configService, dataService, tradeRepository, strategyRunRepository,
        });
        await coordinator.ensureLiveSelectionInitialized();
        const engine = new LiveTradingEngine().init(
            configService, dataService, tradeRepository, coordinator
        );
        engine.brokerStateUncertain = false;
        // Size is immaterial here; retain the real entry and portfolio-risk gates.
        engine.calculatePositionSize = jest.fn(async () => 10);
        const validate = () => engine.validateEntry({
            symbol: "AUD_USD", signal: "BUY", strategy: "intraday_momentum",
            strategyVersion: "1.4.0",
            runId: coordinator.getActiveLiveSession().run.runId,
            currentPrice: 0.7, atr: 0.001, atrPips: 10, strength: 30,
            entryType: "M15_BREAK_RETEST_CONFIRMATION", timeframe: "M15",
            tradePlan: { stopPriceMode: "STRUCTURAL", structuralStopLossPrice: 0.698,
                stopLossPrice: 0.698, targetRiskMultiple: 1.5 },
        }, config);
        return { coordinator, engine, validate };
    };
    return { config, priorRun, records, trades, strategyRunRepository, tradeRepository, boot };
}

describe("active cooldown across a behavioral release", () => {
    beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(now));
    afterEach(() => jest.restoreAllMocks());

    test("startup, restart and another release preserve the original deadline through the real entry gate", async () => {
        const fixtureState = fixture();
        const originalTrades = copy(fixtureState.trades);
        let runtime = await fixtureState.boot();
        const firstRun = runtime.coordinator.getActiveLiveSession().run;
        const expectedCarryover = {
            sourceRunId: fixtureState.priorRun.runId,
            cooldownStartedAt: finalExit,
            cooldownUntil: deadline,
            consecutiveLosses: 3,
            maxConsecutiveLosses: 3,
        };
        expect(firstRun.metadata.entryCooldownCarryover).toEqual(expectedCarryover);
        expect(firstRun.runId).not.toBe(fixtureState.priorRun.runId);
        expect(firstRun.parentRunId).toBe(fixtureState.priorRun.runId);

        const expectBlocked = async () => {
            await expect(runtime.validate()).resolves.toMatchObject({
                valid: false,
                reason: "Portfolio risk rejected entry: CONSECUTIVE_LOSS_COOLDOWN",
            });
            expect(runtime.engine.entryRiskState).toMatchObject({
                cooldownUntil: deadline, cooldownSourceRunId: fixtureState.priorRun.runId,
            });
        };
        await expectBlocked();
        Date.now.mockReturnValue(now + 60_000);
        runtime = await fixtureState.boot();
        expect(runtime.coordinator.getActiveLiveSession().run.runId).toBe(firstRun.runId);
        await expectBlocked();

        fixtureState.config.liveReleaseVersion = "next-release";
        await runtime.coordinator.ensureLiveSelectionInitialized();
        expect(runtime.coordinator.getActiveLiveSession().run.runId).not.toBe(firstRun.runId);
        expect(runtime.coordinator.getActiveLiveSession().run.metadata.entryCooldownCarryover)
            .toEqual(expectedCarryover);
        await expectBlocked();

        Date.now.mockReturnValue(deadline - 1);
        await expectBlocked();
        Date.now.mockReturnValue(deadline);
        await expect(runtime.validate()).resolves.toMatchObject({ valid: true });
        expect(runtime.engine.entryRiskState).toMatchObject({
            cooldownActive: false, consecutiveLosses: 0,
        });
        runtime = await fixtureState.boot();
        await expect(runtime.validate()).resolves.toMatchObject({ valid: true });

        expect(fixtureState.trades).toEqual(originalTrades);
        expect(fixtureState.tradeRepository.updateTrade).not.toHaveBeenCalled();
        expect(fixtureState.records.get(fixtureState.priorRun.runId)).toMatchObject({
            configSnapshot: fixtureState.priorRun.configSnapshot,
            configHash: fixtureState.priorRun.configHash,
        });
        fixtureState.trades.push({
            id: "new-cohort-loss", isOpen: false, pnlAud: -0.1,
            exitTime: deadline + 1000,
            ownerRunId: runtime.coordinator.getActiveLiveSession().run.runId,
        });
        Date.now.mockReturnValue(deadline + 2000);
        await expect(runtime.validate()).resolves.toMatchObject({ valid: true });
        expect(runtime.engine.entryRiskState.consecutiveLosses).toBe(1);
        expect(require("../../services/Oandaclient").placeMarketOrder).not.toHaveBeenCalled();
    });

    test.each([
        ["one loss", { losses: 1 }],
        ["two losses", { losses: 2 }],
        ["expired cooldown", { exitTime: now - CONSECUTIVE_LOSS_COOLDOWN_MS }],
        ["unrelated cohort", { ownerRunId: "unrelated-run" }],
    ])("does not carry a prior streak for %s", async (_, options) => {
        const runtime = await fixture(options).boot();
        expect(runtime.coordinator.getActiveLiveSession().run.metadata.entryCooldownCarryover)
            .toBeNull();
        await expect(runtime.validate()).resolves.toMatchObject({ valid: true });
        expect(runtime.engine.entryRiskState.consecutiveLosses).toBe(0);
    });

    test("failed replacement leaves the old cohort active and restart retains its cooldown", async () => {
        const fixtureState = fixture();
        const releaseVersion = fixtureState.config.liveReleaseVersion;
        fixtureState.config.liveReleaseVersion = fixtureState.priorRun.configSnapshot.liveReleaseVersion;
        const runtime = await fixtureState.boot();
        const runStarted = jest.fn();
        const runStopped = jest.fn();
        const runsChanged = jest.fn();
        runtime.coordinator.on("runStarted", runStarted);
        runtime.coordinator.on("runStopped", runStopped);
        runtime.coordinator.on("runtimeRunsChanged", runsChanged);
        fixtureState.config.liveReleaseVersion = releaseVersion;
        fixtureState.strategyRunRepository.replaceActiveRun.mockRejectedValueOnce(
            new Error("Successor insertion failed")
        );

        await expect(runtime.coordinator.ensureLiveSelectionInitialized())
            .rejects.toThrow("Successor insertion failed");
        expect(fixtureState.records.get(fixtureState.priorRun.runId).status).toBe("active");
        expect(runtime.coordinator.getActiveLiveSession().run.runId).toBe(fixtureState.priorRun.runId);
        expect(runStarted).not.toHaveBeenCalled();
        expect(runStopped).not.toHaveBeenCalled();
        expect(runsChanged).not.toHaveBeenCalled();
        await expect(runtime.validate()).resolves.toMatchObject({
            valid: false, reason: "Portfolio risk rejected entry: CONSECUTIVE_LOSS_COOLDOWN",
        });

        const restarted = await fixtureState.boot();
        expect(restarted.coordinator.getActiveLiveSession().run.runId).not.toBe(fixtureState.priorRun.runId);
        await expect(restarted.validate()).resolves.toMatchObject({
            valid: false, reason: "Portfolio risk rejected entry: CONSECUTIVE_LOSS_COOLDOWN",
        });
        expect(restarted.engine.entryRiskState.cooldownUntil).toBe(deadline);
    });

    test.each(["unavailable", "incomplete"])("does not retire the owner when history is %s", async (failure) => {
        const fixtureState = fixture();
        if (failure === "unavailable") fixtureState.tradeRepository.getAllTrades.mockResolvedValue(null);
        else fixtureState.trades[0].pnlAud = null;
        await expect(fixtureState.boot()).rejects.toThrow(/Closed trade.*history/);
        expect(fixtureState.records.get(fixtureState.priorRun.runId).status).toBe("active");
        expect(fixtureState.strategyRunRepository.update).not.toHaveBeenCalled();
        expect(fixtureState.strategyRunRepository.replaceActiveRun).not.toHaveBeenCalled();
        expect(fixtureState.strategyRunRepository.create).not.toHaveBeenCalled();
    });
});
