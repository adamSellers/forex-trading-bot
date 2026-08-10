const fs = require("fs");
const os = require("os");
const path = require("path");
const ConfigService = require("../configService");

describe("ConfigService governance", () => {
    let directory;
    let configPath;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "forex-config-"));
        configPath = path.join(directory, "trading.json");
    });

    afterEach(() => {
        fs.rmSync(directory, { recursive: true, force: true });
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
                liveReleaseVersion: "m15-intraday-v1",
                strategy: "intraday_momentum",
                timeframe: "15m",
            })
        );
        expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(
            expect.objectContaining({
                enableTrading: true,
                strategy: "intraday_momentum",
            })
        );
    });

    test("rejects direct activation outside the readiness-gated path", () => {
        const service = new ConfigService(configPath).init();

        expect(() => service.update({ enableTrading: true })).toThrow(
            "readiness-gated activation endpoint"
        );
    });

    test("allows internal activation only within live release risk caps", () => {
        const service = new ConfigService(configPath).init();
        service.update({ enforceConfigFreeze: false });

        expect(() =>
            service.update(
                {
                    enableTrading: true,
                    maxOpenPositions: 2,
                },
                { allowLiveActivation: true }
            )
        ).toThrow("release caps");

        const activated = service.update(
            {
                enableTrading: true,
                maxOpenPositions: 1,
                riskPerTrade: 0.0025,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
                maxAggregateStopRiskPctNav: 0.005,
                maxDailyLossPctNav: 0.01,
                maxDrawdownPctNav: 0.05,
                maxConsecutiveLosses: 3,
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
});
