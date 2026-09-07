// Real parsing -> operational health -> API handlers, with broker traffic mocked.
jest.mock("node:perf_hooks", () => ({ performance: { now: jest.fn(() => 0) } }));
const { performance } = require("node:perf_hooks");
const originalApiKey = process.env.OANDA_API_KEY;
const originalAccountId = process.env.OANDA_ACCOUNT_ID;
process.env.OANDA_API_KEY = "isolated-pricing-test-key";
process.env.OANDA_ACCOUNT_ID = "isolated-pricing-test-account";
const routes = require("../tradingRoutes");
const OandaDataService = require("../../services/OandaDataService");
if (originalApiKey === undefined) delete process.env.OANDA_API_KEY;
else process.env.OANDA_API_KEY = originalApiKey;
if (originalAccountId === undefined) delete process.env.OANDA_ACCOUNT_ID;
else process.env.OANDA_ACCOUNT_ID = originalAccountId;
const { cloneDefaultConfig, computeConfigHash } = require("../../config/tradingConfig");

const NOW = Date.parse("2026-09-08T10:02:00Z");
const symbols = ["EUR_USD", "USD_JPY"];
function rawPrice(instrument, overrides = {}) {
    const bid = instrument === "USD_JPY" ? "155.000" : "1.16000";
    const ask = instrument === "USD_JPY" ? "155.010" : "1.16010";
    return { instrument, bids: [{ price: bid, liquidity: 1000000 }],
        asks: [{ price: ask, liquidity: 1000000 }], tradeable: true,
        time: new Date(NOW - 60000).toISOString(), ...overrides };
}
function response() {
    return { statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; } };
}
function handler(path) {
    return routes.stack.find((layer) => layer.route?.path === path && layer.route.methods.get).route.stack[0].handle;
}
function context() {
    const config = { ...cloneDefaultConfig(), assets: symbols, enableTrading: true };
    const dataService = new OandaDataService(symbols);
    dataService.isRunning = true;
    dataService.runtimeGranularities = new Set(["M15", "H1"]);
    dataService.primaryTimeframe = "15m";
    for (const symbol of symbols) {
        for (const [granularity, minutes] of [["M15", 15], ["H1", 60]]) {
            const key = `${symbol}_${granularity}`;
            dataService.candleCache[key] = [{ time: new Date(Date.parse("2026-09-08T10:00:00Z") - minutes * 60000).toISOString(), complete: true }];
            dataService.candleCacheUpdatedAt[key] = NOW;
        }
    }
    const engineStatus = { isRunning: true, lastSuccessfulBrokerSyncAt: NOW - 1000,
        brokerStateUncertain: false, openPositions: 0, openTrades: [] };
    const req = { query: {}, app: { locals: {
        configService: { get: () => config, getValue: (key) => config[key] },
        dataService,
        tradingEngine: { getStatus: () => engineStatus,
            getEntryRiskState: async () => ({ status: "READY", entryAllowed: true }) },
        runtimeCoordinator: {
            isRunning: true, lastRunTime: NOW - 1000,
            getStatus: () => ({ isRunning: true, lastRunTime: NOW - 1000 }),
            getLiveSelection: () => ({ strategy: config.strategy,
                liveRun: { runId: "pricing-fixture", strategy: config.strategy, mode: "live", status: "active", configHash: computeConfigHash(config) } }),
        },
    } } };
    return { req, dataService };
}

describe("pricing delivery through API health and price endpoints", () => {
    const originalFetch = global.fetch;
    let now;
    let priceRows;
    beforeEach(() => {
        now = NOW;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        performance.now.mockReturnValue(0);
        priceRows = [...symbols, "AUD_USD"].map((symbol) => rawPrice(symbol));
        global.fetch = jest.fn(async (url) => ({ ok: true,
            json: async () => String(url).includes("/pricing?") ? { prices: priceRows } : { account: {} } }));
    });
    afterEach(() => { jest.restoreAllMocks(); global.fetch = originalFetch; });

    test("successful repeated old events remain healthy and reuse the recent price cache", async () => {
        const { req, dataService } = context();
        await dataService.fetchAllPrices();
        now += 5000;
        await dataService.fetchAllPrices();
        const res = response();
        await handler("/system/health")(req, res);
        expect(res.body).toMatchObject({ status: "healthy",
            operationalHealth: { status: "healthy", entryState: "WATCHING", issues: [] },
            services: { dataService: { freshness: { pricesFresh: true, oldestPriceAgeMs: 65000, oldestPriceReceiptAgeMs: 0 } } } });
        const fetchCount = global.fetch.mock.calls.length;
        const prices = response();
        await handler("/prices")(req, prices);
        expect(global.fetch).toHaveBeenCalledTimes(fetchCount);
        expect(prices.body.prices[0]).toMatchObject({ instrument: "EUR_USD", timestamp: NOW - 60000, fetchedAt: now, tradeable: true });
    });

    test("expired polling degrades health and a new receipt recovers without a new event", async () => {
        const { req, dataService } = context();
        await dataService.fetchAllPrices();
        now += 20001;
        const stale = response();
        await handler("/system/health")(req, stale);
        expect(stale.body.status).toBe("degraded");
        expect(stale.body.operationalHealth).toMatchObject({ entryState: "WATCHING",
            issues: expect.arrayContaining([expect.objectContaining({ instrument: "EUR_USD",
                message: "EUR_USD: last validated pricing response 21 seconds ago (20-second delivery limit)" })]) });
        await dataService.fetchAllPrices();
        const recovered = response();
        await handler("/system/health")(req, recovered);
        expect(recovered.body.status).toBe("healthy");
        expect(recovered.body.services.dataService.freshness.oldestPriceAgeMs).toBe(80001);
    });

    test("missing one requested pair is visible while another pair remains available", async () => {
        const { req, dataService } = context();
        await dataService.fetchAllPrices();
        priceRows = priceRows.filter((price) => price.instrument !== "EUR_USD");
        now += 5000;
        await dataService.fetchAllPrices();
        const res = response();
        await handler("/system/health")(req, res);
        expect(res.body.status).toBe("degraded");
        expect(res.body.operationalHealth.issues).toEqual([expect.objectContaining({ instrument: "EUR_USD",
            message: "EUR_USD: the requested price was missing from the broker response" })]);
        expect(res.body.operationalHealth.priceAvailability).toContainEqual(expect.objectContaining({ instrument: "USD_JPY", available: true }));
    });

    test("a failed poll remains degraded even when the separate account probe succeeds", async () => {
        const { req, dataService } = context();
        await dataService.fetchAllPrices();
        now += 5000;
        global.fetch.mockRejectedValueOnce(new Error("fetch failed"));
        await dataService.fetchAllPrices();
        const res = response();
        await handler("/system/health")(req, res);
        expect(res.body).toMatchObject({ status: "degraded", services: { oanda: { connected: true } } });
        expect(res.body.operationalHealth.issues).toEqual(dataService.getPricingInstruments().map((instrument) => expect.objectContaining({
            instrument, code: "STALE_PRICE_DATA", message: `${instrument}: the latest pricing request failed`,
        })));
    });

    test("broker nontradeable state remains distinct from delivery failure", async () => {
        const { req, dataService } = context();
        priceRows[0].tradeable = false;
        await dataService.fetchAllPrices();
        const res = response();
        await handler("/system/health")(req, res);
        expect(res.body.status).toBe("healthy");
        expect(res.body.operationalHealth.unavailablePrices).toEqual([expect.objectContaining({ instrument: "EUR_USD", reason: "PRICE_NOT_TRADEABLE" })]);
        const fetchCount = global.fetch.mock.calls.length;
        const prices = response();
        await handler("/prices")(req, prices);
        expect(global.fetch).toHaveBeenCalledTimes(fetchCount);
        expect(prices.body.prices[0].tradeable).toBe(false);
    });

    test("broker fallback returns exactly the same quote fields as the cache", async () => {
        const { req, dataService } = context();
        const fallback = response();
        await handler("/prices")(req, fallback);
        await dataService.fetchAllPrices();
        const cached = response();
        await handler("/prices")(req, cached);
        expect(fallback.body).toEqual(cached.body);
    });

    test("fallback does not refresh a stale cache and marks omitted prices unavailable", async () => {
        const { req, dataService } = context();
        await dataService.fetchAllPrices();
        const oldReceipt = dataService.getCurrentPrice("EUR_USD").fetchedAt;
        now += 15001;
        priceRows = [];
        const res = response();
        await handler("/prices")(req, res);
        expect(res.body.prices).toEqual(symbols.map((instrument) => expect.objectContaining({
            instrument, tradeable: false, fetchedAt: null, invalidReason: "PRICE_MISSING",
        })));
        expect(dataService.getCurrentPrice("EUR_USD").fetchedAt).toBe(oldReceipt);
    });

    test.each([
        ["crossed prices", (prices) => { prices[0].asks[0].price = "1.0"; }, "INVALID_BID_ASK"],
        ["invalid event time", (prices) => { prices[0].time = "invalid"; }, "INVALID_BROKER_TIME"],
        ["duplicate rows", (prices) => { prices.push(prices[0]); }, "DUPLICATE_PRICE"],
    ])("fallback rejects %s without freshening it", async (_label, mutate, reason) => {
        const { req } = context();
        mutate(priceRows);
        const res = response();
        await handler("/prices")(req, res);
        expect(res.body.prices[0]).toMatchObject({ instrument: "EUR_USD", tradeable: false, fetchedAt: null, invalidReason: reason });
    });

    test("a delayed response body cannot become a fresh fallback receipt", async () => {
        const { req } = context();
        global.fetch.mockResolvedValue({ ok: true, json: async () => {
            performance.now.mockReturnValue(10001);
            return { prices: priceRows };
        } });
        const res = response();
        await handler("/prices")(req, res);
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ error: "Oanda request exceeded 10000ms deadline" });
    });
});
