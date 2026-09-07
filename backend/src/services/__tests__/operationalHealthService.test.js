const { buildOperationalHealth, OperationalHealthService } = require("../operationalHealthService");

const OPEN_TIME = Date.parse("2026-08-10T10:00:00Z");
function healthy(nowMs = OPEN_TIME) {
    return {
        nowMs,
        config: { enableTrading: true, enableEmailAlerts: true, assets: ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"], timeStopHours: 6 },
        dataStatus: { isRunning: true, freshness: { pricesFresh: true, candlesFresh: true } },
        runtimeStatus: { isActive: true, lastRun: nowMs - 1000 },
        engineStatus: { isRunning: true, openPositions: 0, openTrades: [], monitoringActive: true,
            lastSuccessfulBrokerSyncAt: nowMs - 1000, lastPositionMonitorAt: nowMs - 1000,
            brokerStateUncertain: false, lastBrokerSyncError: null, quarantinedBrokerPositions: 0 },
    };
}

function withTrade(input, trade = {}) {
    input.engineStatus.openPositions = 1;
    input.engineStatus.openTrades = [{ id: "trade-1", instrument: "EUR_USD", stopLossPrice: 1.1,
        entryTime: input.nowMs - 60_000, ...trade }];
    return input;
}

describe("operational health decisions", () => {
    test("healthy runtime reports backend session clocks and setup watching", () => {
        const result = buildOperationalHealth(healthy());
        expect(result.status).toBe("healthy");
        expect(result.entryState).toBe("WATCHING");
        expect(result.market.sessions.find((session) => session.key === "london")).toMatchObject({ active: true, localTime: "11:00" });
    });

    test("operator pause and bounded loss cooldown are healthy states", () => {
        const input = healthy();
        input.config.enableTrading = false;
        expect(buildOperationalHealth(input)).toMatchObject({ status: "healthy", entryState: "PAUSED" });
        input.config.enableTrading = true;
        input.entryRisk = { cooldownActive: true, cooldownUntil: OPEN_TIME + 86_400_000 };
        expect(buildOperationalHealth(input)).toMatchObject({ status: "healthy", entryState: "COOLDOWN", entriesExpected: false });
    });

    test("weekend frozen prices and no decision activity are expected", () => {
        const input = healthy(Date.parse("2026-09-05T10:00:00Z"));
        input.dataStatus.freshness = { pricesFresh: false, candlesFresh: false };
        input.runtimeStatus.lastRun = OPEN_TIME;
        expect(buildOperationalHealth(input)).toMatchObject({ status: "healthy", entryState: "MARKET_CLOSED" });
    });

    test("a failed pause save is critical even while paused over the weekend", () => {
        const input = healthy(Date.parse("2026-09-05T10:00:00Z"));
        input.config.enableTrading = false;
        input.configPersistence = { durable: false, restartMayResumeTrading: true };
        expect(buildOperationalHealth(input)).toMatchObject({ status: "degraded", entryState: "BLOCKED" });
        expect(buildOperationalHealth(input).issues).toContainEqual(expect.objectContaining({ code: "CONFIG_PERSISTENCE_FAILED", severity: "critical" }));
        input.configPersistence.durable = true;
        expect(buildOperationalHealth(input).status).toBe("healthy");
    });

    test("stale broker sync is unhealthy even while paused or markets are closed", () => {
        const input = healthy(Date.parse("2026-09-05T10:00:00Z"));
        input.config.enableTrading = false;
        input.engineStatus.lastSuccessfulBrokerSyncAt = OPEN_TIME;
        input.engineStatus.lastBrokerSyncError = "network failure";
        const result = buildOperationalHealth(input);
        expect(result.status).toBe("degraded");
        expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["BROKER_SYNC_STALE", "BROKER_SYNC_FAILED"]));
    });

    test("missing protection and a detached management loop are critical", () => {
        const input = withTrade(healthy(), { stopLossPrice: null });
        input.engineStatus.monitoringActive = false;
        expect(buildOperationalHealth(input).issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "PROTECTIVE_STOP_MISSING", severity: "critical" }),
            expect.objectContaining({ code: "POSITION_MONITOR_STOPPED", severity: "critical" }),
        ]));
    });

    test("overdue exits respect owner policy and a two-minute management grace", () => {
        const input = withTrade(healthy(), { entryTime: OPEN_TIME - 6 * 3_600_000 - 60_000 });
        expect(buildOperationalHealth(input).issues.some((issue) => issue.code === "POSITION_EXIT_OVERDUE")).toBe(false);
        input.engineStatus.openTrades[0].entryTime -= 120_000;
        expect(buildOperationalHealth(input).issues.some((issue) => issue.code === "POSITION_EXIT_OVERDUE")).toBe(true);
        input.engineStatus.openTrades[0].ownerExitPolicy = { config: { timeStopHours: 8 } };
        expect(buildOperationalHealth(input).issues.some((issue) => issue.code === "POSITION_EXIT_OVERDUE")).toBe(false);
    });

    test("pending closes and unknown broker trades stay visible", () => {
        const input = withTrade(healthy(), { reconciliationStatus: "CLOSE_RETRY_PENDING" });
        input.engineStatus.quarantinedBrokerPositions = 1;
        expect(buildOperationalHealth(input).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
            "POSITION_CLOSE_PENDING", "BROKER_TRADE_QUARANTINED",
        ]));
    });

    test("unresolved entry intents remain visible when the account appears flat", () => {
        const input = healthy();
        input.engineStatus.pendingOrderIntentCount = 1;
        expect(buildOperationalHealth(input)).toMatchObject({ status: "degraded", entryState: "BLOCKED" });
        expect(buildOperationalHealth(input).issues).toContainEqual(expect.objectContaining({ code: "ORDER_INTENT_PENDING" }));
        input.engineStatus.pendingOrderIntentCount = 0;
        expect(buildOperationalHealth(input).status).toBe("healthy");
    });
});

describe("read-only operational health monitoring", () => {
    test("repeated warnings, critical issues and recoveries only update health snapshots", async () => {
        let now = OPEN_TIME;
        let input = healthy(now);
        // Old caller dependencies must no longer trigger email or incident writes,
        // even with trade emails enabled and a previously announced incident.
        const mail = { isEnabled: jest.fn(() => true), sendOperationalHealthAlert: jest.fn(async () => true) };
        const store = {
            getState: jest.fn(async () => ({ announced: { STALE_PRICE_DATA: { code: "STALE_PRICE_DATA" } } })),
            setState: jest.fn(),
        };
        const service = new OperationalHealthService({
            getInputs: () => input, now: () => now, emailService: mail, stateStore: store,
        });
        for (let cycle = 0; cycle < 20; cycle += 1) {
            input = healthy(now);
            input.dataStatus.freshness.pricesFresh = false;
            expect((await service.check()).issues).toContainEqual(
                expect.objectContaining({ code: "STALE_PRICE_DATA" })
            );
            now += 60_000;
            input = withTrade(healthy(now), { stopLossPrice: null });
            expect((await service.check()).issues).toContainEqual(
                expect.objectContaining({ code: "PROTECTIVE_STOP_MISSING", severity: "critical" })
            );
            now += 60_000;
            input = healthy(now);
            expect(await service.check()).toMatchObject({ status: "healthy", issues: [] });
            now += 60_000;
        }
        expect(service.getStatus().alerting).toBeUndefined();
        expect(mail.isEnabled).not.toHaveBeenCalled();
        expect(mail.sendOperationalHealthAlert).not.toHaveBeenCalled();
        expect(store.getState).not.toHaveBeenCalled();
        expect(store.setState).not.toHaveBeenCalled();
    });

    test("input failures remain visible and subsequent checks recover", async () => {
        const getInputs = jest.fn().mockRejectedValueOnce(new Error("database offline")).mockResolvedValue(healthy());
        const service = new OperationalHealthService({ getInputs, now: () => OPEN_TIME });
        expect((await service.check()).issues).toEqual([expect.objectContaining({ code: "HEALTH_CHECK_FAILED" })]);
        expect((await service.check()).status).toBe("healthy");
    });

    test("overlapping checks share the current input read", async () => {
        let resolveInput;
        const getInputs = jest.fn(() => new Promise((resolve) => { resolveInput = resolve; }));
        const service = new OperationalHealthService({ getInputs, now: () => OPEN_TIME });
        const first = service.check();
        const second = service.check();
        expect(getInputs).toHaveBeenCalledTimes(1);
        resolveInput(healthy());
        const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
        expect(firstSnapshot).toBe(secondSnapshot);
        expect(service.getStatus()).toBe(firstSnapshot);
    });

    test("scheduled monitoring refreshes snapshots and stops cleanly", async () => {
        jest.useFakeTimers({ now: OPEN_TIME });
        const getInputs = jest.fn(() => healthy(Date.now()));
        const service = new OperationalHealthService({ getInputs });
        try {
            service.start();
            await jest.advanceTimersByTimeAsync(60_000);
            expect(getInputs).toHaveBeenCalledTimes(2);
            expect(service.getStatus().status).toBe("healthy");
            service.stop();
            await jest.advanceTimersByTimeAsync(60_000);
            expect(getInputs).toHaveBeenCalledTimes(2);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            service.stop();
            jest.useRealTimers();
        }
    });
});
