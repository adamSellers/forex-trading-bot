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

describe("operational alerts with mocked delivery only", () => {
    const email = () => ({ isEnabled: jest.fn(() => true), sendOperationalHealthAlert: jest.fn(async () => true) });

    test("sends each outage once and sends its recovery once", async () => {
        let broken = true;
        const mail = email();
        const service = new OperationalHealthService({ emailService: mail, now: () => OPEN_TIME, alertDelayMs: 0,
            getInputs: () => { const input = healthy(); input.dataStatus.freshness.pricesFresh = !broken; return input; } });
        await service.check();
        await service.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(1);
        broken = false;
        await service.check();
        await service.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(2);
        expect(mail.sendOperationalHealthAlert.mock.calls[1][0]).toMatchObject({ newIssues: [], recoveredIssues: [expect.objectContaining({ code: "STALE_PRICE_DATA" })] });
    });

    test("defers transient warnings but immediately reports critical missing protection", async () => {
        let now = OPEN_TIME;
        const mail = email();
        const service = new OperationalHealthService({ emailService: mail, now: () => now,
            getInputs: () => { const input = healthy(now); input.dataStatus.freshness.pricesFresh = false; return input; } });
        await service.check();
        now += 30_000;
        await service.check();
        expect(mail.sendOperationalHealthAlert).not.toHaveBeenCalled();
        now += 30_000;
        await service.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(1);
        const critical = new OperationalHealthService({ emailService: mail, now: () => now,
            getInputs: () => withTrade(healthy(now), { stopLossPrice: null }) });
        await critical.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(2);
    });

    test("disabled alerts never send; delivery failure is retried without false recovery", async () => {
        const mail = email();
        mail.isEnabled.mockReturnValue(false);
        const service = new OperationalHealthService({ emailService: mail, now: () => OPEN_TIME, alertDelayMs: 0,
            getInputs: () => withTrade(healthy(), { stopLossPrice: null }) });
        await service.check();
        expect(mail.sendOperationalHealthAlert).not.toHaveBeenCalled();
        mail.isEnabled.mockReturnValue(true);
        mail.sendOperationalHealthAlert.mockResolvedValueOnce(false);
        await service.check();
        await service.check();
        await service.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(2);
    });

    test("persists sent incident state so a process restart does not duplicate the outage", async () => {
        let state = null;
        const store = { getState: jest.fn(async () => state), setState: jest.fn(async (_key, value) => { state = JSON.parse(JSON.stringify(value)); }) };
        const mail = email();
        const options = { emailService: mail, stateStore: store, now: () => OPEN_TIME, alertDelayMs: 0,
            getInputs: () => withTrade(healthy(), { stopLossPrice: null }) };
        await new OperationalHealthService(options).check();
        await new OperationalHealthService(options).check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(1);
    });

    test("a weekend pause in feed checks is not falsely reported as outage recovery", async () => {
        let now = Date.parse("2026-09-04T20:00:00Z");
        let fresh = false;
        const mail = email();
        const service = new OperationalHealthService({ emailService: mail, now: () => now, alertDelayMs: 0,
            getInputs: () => { const input = healthy(now); input.dataStatus.freshness.pricesFresh = fresh; return input; } });
        await service.check();
        now = Date.parse("2026-09-05T10:00:00Z");
        await service.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(1);
        now = Date.parse("2026-09-06T22:00:00Z");
        fresh = true;
        await service.check();
        expect(mail.sendOperationalHealthAlert).toHaveBeenCalledTimes(2);
    });

    test("an input or state-store failure is visible and later checks can recover", async () => {
        const getInputs = jest.fn().mockRejectedValueOnce(new Error("database offline")).mockResolvedValue(healthy());
        const service = new OperationalHealthService({ getInputs, now: () => OPEN_TIME, emailService: email() });
        expect((await service.check()).issues).toEqual([expect.objectContaining({ code: "HEALTH_CHECK_FAILED" })]);
        expect((await service.check()).status).toBe("healthy");
    });
});
