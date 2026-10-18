const fs = require("fs");
const os = require("os");
const path = require("path");
const ConfigService = require("../configService");
const legacyDefaults = require("../../../../shared/legacyIntradayConfigDefaults.json");
const { evaluateLiveReadiness } = require("../../runtime/liveReadiness");
jest.mock("../Oandaclient", () => ({}));
const LiveTradingEngine = require("../LiveTradingEngine");

describe("ConfigService governance", () => {
    let directory;
    let configPath;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "forex-config-"));
        configPath = path.join(directory, "trading.json");
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test("identifies per-pair capacity without increasing the retained risk defaults", () => {
        expect(ConfigService.DEFAULT_CONFIG).toMatchObject({
            strategy: "multi_day_trend",
            timeframe: "4h",
            liveReleaseVersion: "h4-channel-v1",
            executionPolicyVersion: "h4-channel-risk-v1",
            pricingModelVersion: "broker-liquidity-v3.1",
            riskPerTrade: 0.0025,
            maxCapitalAtRisk: 100,
            trendBreakoutBars: 20,
            trendExitBars: 10,
            enableTakeProfit: false,
            enableBreakeven: false,
        });
        expect(ConfigService.DEFAULT_CONFIG).not.toHaveProperty("maxOpenPositions");
    });

    test("migrates the deployed strategy release without disabling live trading", () => {
        fs.writeFileSync(
            configPath,
            JSON.stringify({ enableTrading: true, referenceCurrency: "AUD" })
        );
        const service = new ConfigService(configPath).init();

        expect(service.get()).toEqual(
            expect.objectContaining({
                enableTrading: true,
                liveReleaseVersion: ConfigService.DEFAULT_CONFIG.liveReleaseVersion,
                executionPolicyVersion: ConfigService.DEFAULT_CONFIG.executionPolicyVersion,
                strategy: "multi_day_trend",
                timeframe: "4h",
            })
        );
        expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(
            expect.objectContaining({
                enableTrading: true,
                strategy: "multi_day_trend",
            })
        );
    });

    test.each([
        ["m15-intraday-v3", "intraday-risk-v3", "broker-liquidity-v2", false],
        ["m15-intraday-v3", "intraday-risk-v3", "broker-liquidity-v2", true],
        ["m15-intraday-v3.1", "intraday-risk-v3.1", "broker-liquidity-v3", false],
        ["m15-intraday-v3.1", "intraday-risk-v3.1", "broker-liquidity-v3", true],
        ["m15-intraday-v3.2", "intraday-risk-v3.2", "broker-liquidity-v3.1", false],
        ["m15-intraday-v3.2", "intraday-risk-v3.2", "broker-liquidity-v3.1", true],
        ["m15-intraday-v3.3", "intraday-risk-v3.3", "broker-liquidity-v3.1", false],
        ["m15-intraday-v3.3", "intraday-risk-v3.3", "broker-liquidity-v3.1", true],
        ["m15-intraday-v4", "intraday-risk-v4", "broker-liquidity-v3.1", false],
        ["m15-intraday-v4", "intraday-risk-v4", "broker-liquidity-v3.1", true],
        ["m15-intraday-v4.1", "intraday-risk-v4.1", "broker-liquidity-v3.1", false],
        ["m15-intraday-v4.1", "intraday-risk-v4.1", "broker-liquidity-v3.1", true],
        ["m15-intraday-v4.2", "intraday-risk-v4.2", "broker-liquidity-v3.1", false],
        ["m15-intraday-v4.2", "intraday-risk-v4.2", "broker-liquidity-v3.1", true],
        ["m15-intraday-v5", "intraday-risk-v5", "broker-liquidity-v3.1", false],
        ["m15-intraday-v5", "intraday-risk-v5", "broker-liquidity-v3.1", true],
        ["m15-intraday-v6", "intraday-risk-v6", "broker-liquidity-v3.1", false],
        ["m15-intraday-v6", "intraday-risk-v6", "broker-liquidity-v3.1", true],
    ])("integrated upgrade from %s preserves settings (%s/%s, enabled=%s) across restart", (liveReleaseVersion, executionPolicyVersion, pricingModelVersion, enableTrading) => {
        const prior = {
            ...legacyDefaults,
            liveReleaseVersion,
            executionPolicyVersion,
            pricingModelVersion,
            enableTrading,
            maxOpenPositions: 1,
            assets: ["EUR_USD", "USD_JPY"],
            riskPerTrade: 0.001,
            maxCapitalAtRisk: 75,
            signalCooldown: 120000,
            maxPriceAgeMs: 12000,
            maxSpreadPips: 1,
            intradayMinAdx: 22,
            intradayTargetRiskMultiple: 1.8,
            timeStopHours: 4,
            breakevenTriggerRiskMultiple: 1.2,
            enableBreakeven: false,
            sessionCloseLocalMinute: 40,
            logLevel: "debug",
            enableEmailAlerts: true,
            alertEmail: "test@example.invalid",
        };
        fs.writeFileSync(configPath, JSON.stringify(prior));
        const expected = {
            ...ConfigService.DEFAULT_CONFIG,
            enableTrading,
            assets: ["EUR_USD", "USD_JPY"],
            riskPerTrade: 0.001,
            maxCapitalAtRisk: 75,
            signalCooldown: 120000,
            maxPriceAgeMs: 12000,
            maxSpreadPips: 1,
            logLevel: "debug",
            enableEmailAlerts: true,
            alertEmail: "test@example.invalid",
        };

        const service = new ConfigService(configPath).init();
        const { configHash, ...loaded } = service.get();
        // Shared operator settings survive; the new release supplies its own
        // entry and exit rules instead of inheriting a prior intraday variant.
        expect(loaded).toEqual(expected);
        expect(loaded).not.toHaveProperty("intradayTargetRiskMultiple");
        expect(loaded.timeStopHours).toBe(0);
        expect(prior.intradayTargetRiskMultiple).toBe(1.8);
        expect(prior.timeStopHours).toBe(4);
        expect(configHash).not.toBe(ConfigService.computeConfigHash(prior));
        expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(expected);

        const restarted = new ConfigService(configPath);
        const save = jest.spyOn(restarted, "save");
        restarted.init();
        expect(restarted.get()).toEqual(service.get());
        expect(save).not.toHaveBeenCalled();
    });

    test("removes a stale account-wide cap even on an already-current release", () => {
        fs.writeFileSync(configPath, JSON.stringify({
            ...ConfigService.DEFAULT_CONFIG, enableTrading: true, maxOpenPositions: 1,
        }));
        const service = new ConfigService(configPath).init();
        expect(service.get()).not.toHaveProperty("maxOpenPositions");
        expect(service.get().enableTrading).toBe(true);
        expect(JSON.parse(fs.readFileSync(configPath, "utf8")))
            .not.toHaveProperty("maxOpenPositions");
        expect(() => service.update({ maxOpenPositions: 1 })).toThrow("freeze active");
    });

    test("older releases retain shared risk settings while adopting H4 rules and remain blocked by live caps", () => {
        fs.writeFileSync(configPath, JSON.stringify({
            liveReleaseVersion: "m15-intraday-v2",
            enableTrading: true,
            riskPerTrade: 0.01,
            maxCapitalAtRisk: 500,
            intradayTargetRiskMultiple: 3,
            logLevel: "debug",
            enableEmailAlerts: true,
            alertEmail: "test@example.invalid",
        }));
        const service = new ConfigService(configPath).init();
        const { configHash, ...loaded } = service.get();
        expect(loaded).toEqual({
            ...ConfigService.DEFAULT_CONFIG,
            enableTrading: true,
            riskPerTrade: 0.01,
            maxCapitalAtRisk: 500,
            logLevel: "debug",
            enableEmailAlerts: true,
            alertEmail: "test@example.invalid",
        });
        const readiness = evaluateLiveReadiness({
            config: service.get(),
            liveSelection: { liveRun: { strategy: "multi_day_trend", configHash } },
        });
        expect(readiness.activationAllowed).toBe(false);
        expect(readiness.reasons).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "LIVE_RISK_LIMIT", key: "riskPerTrade" }),
            expect.objectContaining({ code: "LIVE_RISK_LIMIT", key: "maxCapitalAtRisk" }),
        ]));
    });

    test("rejects direct activation outside the readiness-gated path", () => {
        const service = new ConfigService(configPath).init();

        expect(() => service.update({ enableTrading: true })).toThrow(
            "readiness-gated activation endpoint"
        );
    });

    test("allows internal activation only within live release risk caps", () => {
        const service = new ConfigService(configPath).init();
        // A reviewed release may change defaults; simulate an unsafe persisted
        // release value without creating an API path around the freeze.
        service.config.riskPerTrade = 0.005;

        expect(() =>
            service.update(
                {
                    enableTrading: true,
                },
                { allowLiveActivation: true }
            )
        ).toThrow("release caps");

        service.config.riskPerTrade = ConfigService.DEFAULT_CONFIG.riskPerTrade;

        const activated = service.update(
            {
                enableTrading: true,
            },
            { allowLiveActivation: true }
        );

        expect(activated.enableTrading).toBe(true);
    });

    test("rejects a non-AUD reference currency", () => {
        const service = new ConfigService(configPath).init();
        expect(() => service.update({ referenceCurrency: "USD" })).toThrow(
            "AUD is the fixed"
        );
    });

    test("release protection cannot be disabled, including through a stale false flag", () => {
        const service = new ConfigService(configPath).init();
        expect(() => service.update({ enforceConfigFreeze: false })).toThrow("freeze active");
        expect(() => service.update({ enforceConfigFreeze: "false" })).toThrow("freeze active");
        service.config.enforceConfigFreeze = false;
        expect(() => service.update({ trendBreakoutBars: 99 })).toThrow("freeze active");
    });

    test.each(["writeFileSync", "fsyncSync", "renameSync"])("failed %s pauses immediately, invalidates entries and blocks activation until repaired", (operation) => {
        const service = new ConfigService(configPath).init();
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        const engine = new LiveTradingEngine().init(service);
        engine.engineStopped = false;
        const generation = engine.activationGeneration;
        expect(() => engine.assertEntryActivation(generation)).not.toThrow();
        const before = fs.readFileSync(configPath, "utf8");
        const changed = jest.fn();
        const apply = jest.spyOn(service, "applyToServices");
        service.on("configChanged", changed);
        const write = jest.spyOn(fs, operation).mockImplementation(() => { throw new Error("disk failure"); });
        expect(() => service.update({ enableTrading: false })).toThrow("durably saved");
        expect(service.get().enableTrading).toBe(false);
        expect(fs.readFileSync(configPath, "utf8")).toBe(before);
        expect(fs.readdirSync(directory)).toEqual(["trading.json"]);
        expect(apply).toHaveBeenCalledTimes(1);
        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ enableTrading: false }));
        expect(engine.activationGeneration).toBeGreaterThan(generation);
        expect(() => engine.assertEntryActivation(generation)).toThrow("activation changed");
        expect(service.getPersistenceStatus()).toEqual({
            durable: false, forcedPause: true, restartMayResumeTrading: true,
            fault: expect.objectContaining({ code: "CONFIG_PERSISTENCE_FAILED", failedAt: expect.any(Number) }),
        });
        expect(() => service.update({ enableTrading: true }, { allowLiveActivation: true })).toThrow("Durably save paused entries");
        expect(() => service.update({ enableTrading: false })).toThrow("durably saved");
        write.mockRestore();
        // Merely repairing the filesystem does not acknowledge a durable pause.
        expect(() => service.update({ enableTrading: true }, { allowLiveActivation: true })).toThrow("Durably save paused entries");
        service.update({ enableTrading: false });
        expect(service.getPersistenceStatus()).toEqual({ durable: true, forcedPause: false, restartMayResumeTrading: false, fault: null });
        expect(new ConfigService(configPath).init().get().enableTrading).toBe(false);
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        expect(() => engine.assertEntryActivation(engine.activationGeneration)).not.toThrow();
    });

    test("failed ordinary update preserves its prior values while forcing a pause", () => {
        const service = new ConfigService(configPath).init();
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        const before = service.get();
        jest.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("rename denied"); });
        expect(() => service.update({ logLevel: "debug" })).toThrow("durably saved");
        expect(service.get()).toEqual({ ...before, enableTrading: false });
        expect(service.getPersistenceStatus().durable).toBe(false);
    });

    test("directory flush failure remains a fault even when rename wrote the paused file", () => {
        const service = new ConfigService(configPath).init();
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        const flush = fs.fsyncSync;
        jest.spyOn(fs, "fsyncSync").mockImplementationOnce(flush)
            .mockImplementationOnce(() => { throw new Error("directory flush failed"); });
        expect(() => service.update({ enableTrading: false })).toThrow("durably saved");
        expect(JSON.parse(fs.readFileSync(configPath, "utf8")).enableTrading).toBe(false);
        expect(service.get().enableTrading).toBe(false);
        expect(service.getPersistenceStatus().durable).toBe(false);
    });

    test("reload cannot restore an enabled file over an unresolved persistence fault", () => {
        const service = new ConfigService(configPath).init();
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        const rename = jest.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("rename denied"); });
        expect(() => service.update({ enableTrading: false })).toThrow("durably saved");
        expect(() => service.load()).toThrow("durably saved");
        expect(service.get().enableTrading).toBe(false);
        rename.mockRestore();
        service.load();
        expect(service.get().enableTrading).toBe(false);
        expect(service.getPersistenceStatus().durable).toBe(true);
        expect(JSON.parse(fs.readFileSync(configPath, "utf8")).enableTrading).toBe(false);
    });

    test("a successful pause survives restart and publishes only after persistence", () => {
        const service = new ConfigService(configPath).init();
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        service.on("configChanged", (value) => {
            expect(JSON.parse(fs.readFileSync(configPath, "utf8")).enableTrading).toBe(value.enableTrading);
        });
        service.update({ enableTrading: false });
        expect(new ConfigService(configPath).init().get().enableTrading).toBe(false);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    });

    test("failed reset and failed initial persistence propagate without acknowledging defaults", () => {
        const service = new ConfigService(configPath).init();
        service.update({ enableTrading: true }, { allowLiveActivation: true });
        jest.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("rename denied"); });
        expect(() => service.reset()).toThrow("durably saved");
        expect(service.get().enableTrading).toBe(false);
        expect(() => new ConfigService(path.join(directory, "new.json")).init()).toThrow("durably saved");
    });
});
