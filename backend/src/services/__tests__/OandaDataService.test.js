const OandaDataService = require("../OandaDataService");

describe("OandaDataService completed M15 historical bid and ask candles", () => {
    const completed = {
        time: "2026-09-30T13:30:00.000000000Z",
        complete: true,
        volume: 247,
        mid: { o: "0.69636", h: "0.69656", l: "0.69568", c: "0.69578" },
        bid: { o: "0.69630", h: "0.69650", l: "0.69561", c: "0.69572" },
        ask: { o: "0.69642", h: "0.69662", l: "0.69575", c: "0.69584" },
    };

    test("requests broker midpoint/bid/ask M15 data and retains independent completed side OHLC", async () => {
        const service = new OandaDataService(["AUD_USD"]);
        service.oandaRequest = jest.fn().mockResolvedValue({ candles: [
            completed,
            { ...completed, time: "2026-09-30T13:45:00.000000000Z", complete: false },
        ] });

        const result = await service.fetchCandles("AUD_USD", "M15", 500);

        expect(service.oandaRequest).toHaveBeenCalledWith(
            "/v3/instruments/AUD_USD/candles?granularity=M15&count=500&price=MBA"
        );
        expect(result).toEqual([{
            time: completed.time,
            open: 0.69636, high: 0.69656, low: 0.69568, close: 0.69578, volume: 247,
            ask: { open: 0.69642, high: 0.69662, low: 0.69575, close: 0.69584 },
            bid: { open: 0.69630, high: 0.69650, low: 0.69561, close: 0.69572 },
        }]);
        expect(service.getCandles("AUD_USD", "15m")).toBe(result);
    });

    test.each([
        undefined, null, {},
        { o: "0.69630", h: "", l: "0.69561", c: "0.69572" },
        { o: "0.69630", h: "0.69650bad", l: "0.69561", c: "0.69572" },
        { o: "0.69630", h: "0.69650", l: "0", c: "0.69572" },
        { o: "0.69630", h: "0.69600", l: "0.69561", c: "0.69572" },
        { o: "0.69630", h: "0.69650", l: "0.69620", c: "0.69572" },
    ])("unavailable bid %p preserves midpoint and valid ask without using today's spread", async (bid) => {
        const service = new OandaDataService(["AUD_USD"]);
        service.priceCache.AUD_USD = { bid: 0.69559, ask: 0.69568, spread: 0.9 };
        service.oandaRequest = jest.fn().mockResolvedValue({ candles: [{ ...completed, bid }] });
        const failure = jest.spyOn(service, "logFailureThrottled");
        const result = await service.fetchCandles("AUD_USD", "M15");
        expect(result[0]).toMatchObject({ high: 0.69656, close: 0.69578, bid: null,
            ask: { high: 0.69662, low: 0.69575 } });
        expect(failure).not.toHaveBeenCalled();
    });

    test.each([
        undefined,
        null,
        {},
        { o: "0.69642", h: "", l: "0.69575", c: "0.69584" },
        { o: "0.69642", h: "0.69662bad", l: "0.69575", c: "0.69584" },
        { o: "0.69642", h: "0.69662", l: "0", c: "0.69584" },
        { o: "0.69642", h: "0.69600", l: "0.69575", c: "0.69584" },
        { o: "0.69642", h: "0.69662", l: "0.69630", c: "0.69584" },
    ])("keeps valid midpoint history when broker ask is unavailable or malformed: %p", async (ask) => {
        const service = new OandaDataService(["AUD_USD"]);
        service.priceCache.AUD_USD = { bid: 0.69559, ask: 0.69568, spread: 0.9 };
        service.oandaRequest = jest.fn().mockResolvedValue({ candles: [{ ...completed, ask }] });
        const failure = jest.spyOn(service, "logFailureThrottled");

        const result = await service.fetchCandles("AUD_USD", "M15");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ time: completed.time, high: 0.69656, close: 0.69578, ask: null });
        expect(service.getCandles("AUD_USD", "15m")).toBe(result);
        expect(service.candleCacheUpdatedAt.AUD_USD_M15).toEqual(expect.any(Number));
        expect(failure).not.toHaveBeenCalled();
    });

    test("keeps H1 and other existing candle requests and shapes midpoint-only", async () => {
        const service = new OandaDataService(["AUD_USD"]);
        service.oandaRequest = jest.fn().mockResolvedValue({ candles: [completed] });
        for (const granularity of ["H1", "H4"]) {
            const result = await service.fetchCandles("AUD_USD", granularity, 100);
            expect(service.oandaRequest).toHaveBeenLastCalledWith(
                `/v3/instruments/AUD_USD/candles?granularity=${granularity}&count=100&price=M`
            );
            expect(result[0]).toEqual({
                time: completed.time,
                open: 0.69636, high: 0.69656, low: 0.69568, close: 0.69578, volume: 247,
            });
        }
    });
});

describe("OandaDataService required granularities", () => {
    let service;

    beforeEach(() => {
        service = new OandaDataService(["AUD_USD"]);
        // Never hit the network from these tests.
        service.fetchAllCandles = jest.fn().mockResolvedValue(undefined);
    });

    test("defaults to the primary timeframe only", () => {
        expect(service.getRequiredGranularities()).toEqual(["H4"]);
    });

    test("global HTF config adds the HTF granularity", () => {
        service.updateCandleConfig({
            timeframe: "4h",
            enableHTFFilter: true,
            htfTimeframe: "1h",
        });

        expect(service.getRequiredGranularities().sort()).toEqual(["H1", "H4"]);
    });

    test("runtime timeframes are unioned with the global-config granularities", () => {
        service.updateRuntimeTimeframes(["4h", "1d"]);

        expect(service.getRequiredGranularities().sort()).toEqual(["D", "H4"]);
    });

    test("runtime timeframes are replaced wholesale on each sync", () => {
        service.updateRuntimeTimeframes(["4h"]);
        expect(service.getRequiredGranularities()).toContain("H4");

        // Run stopped: the coordinator syncs the remaining (empty) union.
        service.updateRuntimeTimeframes([]);
        expect(service.getRequiredGranularities()).toEqual(["H4"]);
    });

    test("triggers an immediate candle fetch when a new granularity is required while running", () => {
        service.isRunning = true;

        service.updateRuntimeTimeframes(["1h"]);
        expect(service.fetchAllCandles).toHaveBeenCalledTimes(1);

        // Re-syncing an unchanged requirement set must not refetch.
        service.updateRuntimeTimeframes(["1h"]);
        expect(service.fetchAllCandles).toHaveBeenCalledTimes(1);

        // A timeframe already covered by the global config adds nothing new.
        service.updateRuntimeTimeframes(["1h", "4h"]);
        expect(service.fetchAllCandles).toHaveBeenCalledTimes(1);
    });

    test("does not fetch when the service is not running", () => {
        service.updateRuntimeTimeframes(["1h"]);
        expect(service.fetchAllCandles).not.toHaveBeenCalled();
    });

    test("ignores falsy entries and tolerates non-array input", () => {
        service.updateRuntimeTimeframes([null, undefined, "", "1h"]);
        expect(service.getRequiredGranularities().sort()).toEqual(["H1", "H4"]);

        service.updateRuntimeTimeframes(null);
        expect(service.getRequiredGranularities()).toEqual(["H4"]);
    });

    test("retains refresh diagnostics for legacy timeframes outside the intraday entry contract", () => {
        service.isRunning = true;
        service.priceCache.AUD_USD = { bid: 0.66, ask: 0.6601, tradeable: true, timestamp: 99_000, fetchedAt: 99_000 };
        service.candleCache.AUD_USD_H4 = [{ time: "2026-01-01T00:00:00Z" }];
        service.candleCacheUpdatedAt.AUD_USD_H4 = 98_000;

        expect(service.getFreshnessStatus({ nowMs: 100_000 })).toEqual(
            expect.objectContaining({
                pricesFresh: true,
                candlesFresh: true,
                oldestPriceAgeMs: 1_000,
                oldestCandleRefreshAgeMs: 2_000,
                stalePrices: [],
                staleCandles: [],
            })
        );
    });

    test("identifies the exact stale or missing price and candle caches", () => {
        service.updateRuntimeTimeframes(["1h"]);
        service.priceCache.AUD_USD = { timestamp: 1_000 };
        service.candleCacheUpdatedAt.AUD_USD_H4 = 1_000;

        expect(
            service.getFreshnessStatus({
                nowMs: 200_000,
                maxPriceAgeMs: 20_000,
                maxCandleRefreshAgeMs: 180_000,
            })
        ).toEqual(
            expect.objectContaining({
                pricesFresh: false,
                candlesFresh: false,
                stalePrices: ["AUD_USD"],
                staleCandles: ["AUD_USD_H4", "AUD_USD_H1"],
            })
        );
    });
});

describe("OandaDataService broker event integrity", () => {
    const nowMs = Date.parse("2026-08-10T10:02:00Z");
    let service;
    beforeEach(() => {
        service = new OandaDataService(["AUD_USD"], { requestTimeoutMs: 25 });
        jest.spyOn(Date, "now").mockReturnValue(nowMs);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    const quote = (overrides = {}) => ({ instrument: "AUD_USD", time: new Date(nowMs - 1000).toISOString(),
        bids: [{ price: "0.65996" }], asks: [{ price: "0.66004" }], tradeable: true, ...overrides });

    test("a validated current response keeps its old event identity and confirms fresh delivery", async () => {
        service.oandaRequest = jest.fn().mockResolvedValue({ prices: [quote({ time: new Date(nowMs - 60_000).toISOString() })] });
        await service.fetchAllPrices();
        expect(service.getCurrentPrice("AUD_USD")).toMatchObject({ timestamp: nowMs - 60_000, fetchedAt: nowMs });
        expect(service.getFreshnessStatus({ nowMs })).toMatchObject({
            pricesFresh: true, oldestPriceAgeMs: 60_000, oldestPriceReceiptAgeMs: 0,
        });
        expect(service.getFreshnessStatus({ nowMs: nowMs + 20_001 })).toMatchObject({
            pricesFresh: false, stalePrices: ["AUD_USD"],
            priceAvailability: [expect.objectContaining({ reason: "STALE_PRICE", receiptAgeMs: 20_001 })],
        });
    });

    test.each([
        { bids: [] }, { asks: [] }, { bids: [{ price: "garbage" }] },
        { asks: [{ price: "0.659" }] }, { time: null },
        { time: new Date(nowMs + 60_000).toISOString() },
    ])("invalid broker quote %j overwrites availability rather than exposing old tradeable prices", async (overrides) => {
        service.priceCache.AUD_USD = { price: 0.66, spread: 0.8, tradeable: true, timestamp: nowMs };
        service.oandaRequest = jest.fn().mockResolvedValue({ prices: [quote(overrides)] });
        await service.fetchAllPrices();
        expect(service.getCurrentPrice("AUD_USD").tradeable).toBe(false);
        expect(service.getCurrentPrice("AUD_USD").invalidReason).toBeTruthy();
        expect(service.getFreshnessStatus({ nowMs }).pricesFresh).toBe(false);
    });

    test("preserves unrounded spread so the cost boundary cannot round down", async () => {
        service.oandaRequest = jest.fn().mockResolvedValue({ prices: [quote({
            bids: [{ price: "0.660000" }], asks: [{ price: "0.660074" }],
        })] });
        await service.fetchAllPrices();
        expect(service.getCurrentPrice("AUD_USD").spread).toBeCloseTo(0.74, 8);
    });

    test.each([{ prices: [] }, { prices: [quote({ instrument: "EUR_USD" })] }, { prices: [quote(), quote()] }])(
        "missing, mismatched or duplicate instrument rows cannot leave a previous quote executable", async ({ prices }) => {
            service.oandaRequest = jest.fn().mockResolvedValueOnce({ prices: [quote()] }).mockResolvedValueOnce({ prices });
            await service.fetchAllPrices();
            expect(service.getCurrentPrice("AUD_USD").tradeable).toBe(true);
            await service.fetchAllPrices();
            expect(service.getCurrentPrice("AUD_USD")).toMatchObject({ tradeable: false, fetchedAt: null });
            expect(service.getFreshnessStatus({ nowMs }).pricesFresh).toBe(false);
        }
    );

    test("one pair's success cannot refresh another pair omitted from the response", async () => {
        service.instruments = ["AUD_USD", "EUR_USD"];
        service.oandaRequest = jest.fn().mockResolvedValue({ prices: [quote()] });
        await service.fetchAllPrices();
        expect(service.getFreshnessStatus({ nowMs })).toMatchObject({
            stalePrices: ["EUR_USD"],
            priceAvailability: [
                expect.objectContaining({ instrument: "AUD_USD", available: true }),
                expect.objectContaining({ instrument: "EUR_USD", reason: "PRICE_MISSING", fetchedAt: null }),
            ],
        });
    });

    test("pricing health includes a requested conversion bridge outside the trading assets", async () => {
        service.instruments = ["EUR_USD"];
        service.oandaRequest = jest.fn().mockResolvedValue({ prices: [quote({ instrument: "EUR_USD" })] });
        await service.fetchAllPrices();
        expect(service.getFreshnessStatus({ nowMs })).toMatchObject({
            pricesFresh: false, stalePrices: ["AUD_USD"],
            priceAvailability: [
                expect.objectContaining({ instrument: "EUR_USD", available: true }),
                expect.objectContaining({ instrument: "AUD_USD", reason: "PRICE_MISSING" }),
            ],
        });
    });

    test("valid nontradeable broker state confirms communication but not execution availability", async () => {
        service.oandaRequest = jest.fn().mockResolvedValue({ prices: [quote({ tradeable: false })] });
        await service.fetchAllPrices();
        expect(service.getFreshnessStatus({ nowMs })).toMatchObject({
            pricesFresh: true, stalePrices: [],
            unavailablePrices: [expect.objectContaining({ instrument: "AUD_USD", reason: "PRICE_NOT_TRADEABLE" })],
        });
    });

    test.each([null, {}, { prices: {} }])("malformed response %j invalidates old availability", async (payload) => {
        service.oandaRequest = jest.fn().mockResolvedValueOnce({ prices: [quote()] }).mockResolvedValueOnce(payload);
        await service.fetchAllPrices();
        await service.fetchAllPrices();
        expect(service.getCurrentPrice("AUD_USD")).toMatchObject({
            fetchedAt: nowMs, tradeable: false, invalidReason: "INVALID_PRICING_RESPONSE",
        });
        expect(service.getFreshnessStatus({ nowMs }).pricesFresh).toBe(false);
    });

    test("a failed poll invalidates the last executable quote and a valid repeated event recovers it", async () => {
        const priceUpdates = jest.fn();
        service.on("priceUpdate", priceUpdates);
        service.oandaRequest = jest.fn()
            .mockResolvedValueOnce({ prices: [quote()] })
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce({ prices: [quote()] });
        await service.fetchAllPrices();
        const eventTime = service.getCurrentPrice("AUD_USD").timestamp;
        await service.fetchAllPrices();
        expect(service.getCurrentPrice("AUD_USD")).toMatchObject({
            timestamp: eventTime, fetchedAt: nowMs, invalidReason: "PRICE_REQUEST_FAILED", tradeable: false,
        });
        expect(service.getFreshnessStatus({ nowMs }).pricesFresh).toBe(false);
        await service.fetchAllPrices();
        expect(service.getCurrentPrice("AUD_USD")).toMatchObject({ timestamp: eventTime, tradeable: true, invalidReason: null });
        expect(service.getFreshnessStatus({ nowMs }).pricesFresh).toBe(true);
        expect(priceUpdates).toHaveBeenCalledTimes(3);
    });

    test("rejects a late body even when it resolves after ignoring the abort signal", async () => {
        jest.useFakeTimers({ now: nowMs });
        jest.spyOn(global, "fetch").mockResolvedValue({
            ok: true,
            json: () => new Promise((resolve) => setTimeout(() => resolve({ prices: [quote()] }), 26)),
        });
        const pending = service.fetchAllPrices();
        await jest.advanceTimersByTimeAsync(26);
        await pending;
        expect(service.getCurrentPrice("AUD_USD")).toMatchObject({
            fetchedAt: null, invalidReason: "PRICE_REQUEST_TIMEOUT", tradeable: false,
        });
        expect(service.isFetchingPrices).toBe(false);
    });

    test("current cache timestamps cannot hide stale completed M15/H1 bars", () => {
        service.updateCandleConfig({ timeframe: "15m" });
        service.updateRuntimeTimeframes(["15m", "1h"]);
        service.candleCache.AUD_USD_M15 = [{ time: "2026-08-10T09:30:00Z" }];
        service.candleCache.AUD_USD_H1 = [{ time: "2026-08-10T08:00:00Z" }];
        service.candleCacheUpdatedAt.AUD_USD_M15 = nowMs;
        service.candleCacheUpdatedAt.AUD_USD_H1 = nowMs;
        const status = service.getFreshnessStatus({ nowMs });
        expect(status.candlesFresh).toBe(false);
        expect(status.staleCandles).toEqual(["AUD_USD_M15", "AUD_USD_H1"]);
        expect(service.getEntryFreshness("AUD_USD", { nowMs }).fresh).toBe(false);
    });

    test("aborts a hung HTTP request and releases the price polling latch", async () => {
        jest.useFakeTimers();
        jest.spyOn(global, "fetch").mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }));
        const pending = service.fetchAllPrices();
        expect(service.isFetchingPrices).toBe(true);
        await jest.advanceTimersByTimeAsync(25);
        await pending;
        expect(service.isFetchingPrices).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    test("the request deadline also covers a stalled response body", async () => {
        jest.useFakeTimers();
        jest.spyOn(global, "fetch").mockImplementation(async (_url, { signal }) => ({
            ok: true,
            json: () => new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
            }),
        }));
        const pending = service.fetchAllPrices();
        await jest.advanceTimersByTimeAsync(25);
        await pending;
        expect(service.isFetchingPrices).toBe(false);
    });

    test("labels a deadline abort without reporting an exact elapsed time", async () => {
        jest.useFakeTimers();
        const abortError = new DOMException("This operation was aborted", "AbortError");
        jest.spyOn(global, "fetch").mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(abortError), { once: true });
        }));
        const pending = service.oandaRequest("/isolated-test");
        const rejection = expect(pending).rejects.toMatchObject({
            name: "OandaTimeoutError",
            code: "OANDA_TIMEOUT",
            message: "Oanda request exceeded 25ms deadline",
            cause: abortError,
        });
        await jest.advanceTimersByTimeAsync(25);
        await rejection;
        expect(jest.getTimerCount()).toBe(0);
    });

    test("preserves broker maintenance errors instead of labelling them as local timeouts", async () => {
        jest.useFakeTimers();
        jest.spyOn(global, "fetch").mockResolvedValue({
            ok: false,
            status: 503,
            headers: { get: () => "application/json" },
            text: async () => JSON.stringify({ errorMessage: "Service maintenance" }),
        });
        await expect(service.oandaRequest("/isolated-test")).rejects.toThrow(
            "Oanda API Error (503): Service maintenance"
        );
        expect(jest.getTimerCount()).toBe(0);
    });

    test("a timed-out candle read preserves its cache and recovers on the next poll with independent deadlines", async () => {
        jest.useFakeTimers({ now: nowMs });
        service.updateCandleConfig({ timeframe: "15m" });
        service.updateRuntimeTimeframes(["1h"]);
        const prior = [{ time: "2026-08-10T09:30:00Z", open: 0.66, high: 0.661, low: 0.659, close: 0.66 }];
        service.candleCache.AUD_USD_M15 = prior;
        service.candleCacheUpdatedAt.AUD_USD_M15 = nowMs - 60_000;
        const freshResponse = () => ({
            ok: true,
            json: async () => ({ candles: [{
                time: "2026-08-10T09:45:00Z", complete: true,
                mid: { o: "0.66", h: "0.661", l: "0.659", c: "0.6605" }, volume: 10,
            }] }),
        });
        const fetch = jest.spyOn(global, "fetch")
            .mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), { once: true });
            }))
            .mockImplementation(async () => freshResponse());
        const log = jest.spyOn(service, "logFailureThrottled").mockImplementation(() => {});
        const firstPoll = service.fetchAllCandles();
        await jest.advanceTimersByTimeAsync(25);
        await firstPoll;
        expect(log).toHaveBeenCalledWith(
            "candles:AUD_USD:M15", "❌ Candle fetch error for AUD_USD (M15):",
            "Oanda request exceeded 25ms deadline"
        );
        expect(service.candleCache.AUD_USD_M15).toBe(prior);
        expect(service.candleCacheUpdatedAt.AUD_USD_M15).toBe(nowMs - 60_000);
        expect(service.candleCacheUpdatedAt.AUD_USD_H1).toBe(nowMs + 25);
        expect(service.isFetchingCandles).toBe(false);
        const [firstSignal, secondSignal] = fetch.mock.calls.map(([, options]) => options.signal);
        expect(firstSignal).not.toBe(secondSignal);
        expect(firstSignal.aborted).toBe(true);
        expect(secondSignal.aborted).toBe(false);

        await service.fetchAllCandles();
        expect(fetch).toHaveBeenCalledTimes(4);
        expect(service.candleCache.AUD_USD_M15).not.toBe(prior);
        expect(service.candleCacheUpdatedAt.AUD_USD_M15).toBe(nowMs + 25);
        expect(service.isFetchingCandles).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    test("invalid candle payloads do not replace valid cached history or freshen its receipt time", async () => {
        const prior = [{ time: "2026-08-10T09:30:00Z", open: 0.66, close: 0.66, high: 0.661, low: 0.659 }];
        service.candleCache.AUD_USD_M15 = prior;
        service.candleCacheUpdatedAt.AUD_USD_M15 = nowMs - 60_000;
        service.oandaRequest = jest.fn().mockResolvedValue({ candles: [
            { time: "2026-08-10T09:45:00Z", complete: true, mid: { o: "0.66", c: "broken", h: "0.661", l: "0.659" } },
        ] });
        await service.fetchCandles("AUD_USD", "M15");
        expect(service.candleCache.AUD_USD_M15).toBe(prior);
        expect(service.candleCacheUpdatedAt.AUD_USD_M15).toBe(nowMs - 60_000);
    });
});

describe("OandaDataService AUD home conversions", () => {
    let service;

    beforeEach(() => {
        service = new OandaDataService(["EUR_USD"]);
    });

    test("requests OANDA home conversions and retains AUD_USD as a pricing bridge", async () => {
        service.oandaRequest = jest.fn().mockResolvedValue({
            prices: [
                {
                    instrument: "EUR_USD",
                    bids: [{ price: "1.0999" }],
                    asks: [{ price: "1.1001" }],
                    tradeable: true,
                    time: "2026-07-10T00:00:00Z",
                },
                {
                    instrument: "AUD_USD",
                    bids: [{ price: "0.6499" }],
                    asks: [{ price: "0.6501" }],
                    tradeable: true,
                    time: "2026-07-10T00:00:00Z",
                },
            ],
            homeConversions: [
                {
                    currency: "USD",
                    accountGain: "1.51",
                    accountLoss: "1.53",
                    positionValue: "1.52",
                },
            ],
        });

        await service.fetchAllPrices();

        expect(service.oandaRequest).toHaveBeenCalledWith(
            expect.stringContaining(
                "instruments=EUR_USD,AUD_USD&includeHomeConversions=true"
            )
        );
        expect(service.getCurrentPrice("AUD_USD")).toEqual(
            expect.objectContaining({ instrument: "AUD_USD", price: 0.65 })
        );
        expect(
            service.getHomeConversionRate("USD", {
                purpose: "pnl",
                amount: 10,
            })
        ).toBe(1.51);
        expect(
            service.getHomeConversionRate("USD", {
                purpose: "pnl",
                amount: -10,
            })
        ).toBe(1.53);
        expect(
            service.getHomeConversionRate("USD", { purpose: "margin" })
        ).toBe(1.52);
    });

    test("keeps the AUD bridge price when AUD_USD is removed from tradable assets", () => {
        service.priceCache.AUD_USD = { price: 0.65 };
        service.instruments = ["AUD_USD", "EUR_USD"];

        service.updateInstruments(["EUR_USD"]);

        expect(service.instruments).toEqual(["EUR_USD"]);
        expect(service.getCurrentPrice("AUD_USD")).toEqual({ price: 0.65 });
        expect(service.getPricingInstruments()).toEqual([
            "EUR_USD",
            "AUD_USD",
        ]);
    });

    test("does not expose stale home conversion factors", () => {
        service.homeConversionMaxAgeMs = 1000;
        service.seedHomeConversions(
            [
                {
                    currency: "USD",
                    accountGain: 1.51,
                    accountLoss: 1.53,
                    positionValue: 1.52,
                },
            ],
            1000
        );
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(3000);

        expect(service.getHomeConversionRate("USD")).toBeNull();
        nowSpy.mockRestore();
    });

    test("refreshes and exposes OANDA instrument financing metadata", async () => {
        const updatedAt = Date.now();
        service.instrumentMetadataProvider = jest.fn().mockResolvedValue([
            {
                name: "EUR_USD",
                financing: {
                    longRate: "-0.031",
                    shortRate: "0.012",
                    financingDaysOfWeek: [
                        { dayOfWeek: "WEDNESDAY", daysCharged: 3 },
                    ],
                },
            },
        ]);

        await service.refreshInstrumentMetadata();

        expect(service.instrumentMetadataProvider).toHaveBeenCalledWith([
            "EUR_USD",
            "AUD_USD",
        ]);
        expect(service.getInstrumentFinancing("EUR_USD")).toEqual({
            status: "MODELED",
            longRateAnnual: -0.031,
            shortRateAnnual: 0.012,
            financingDaysOfWeek: [
                { dayOfWeek: "WEDNESDAY", daysCharged: 3 },
            ],
            updatedAt: expect.any(Number),
            source: "OANDA_ACCOUNT_INSTRUMENTS",
        });
        expect(
            service.instrumentMetadataCache.EUR_USD.updatedAt
        ).toBeGreaterThanOrEqual(updatedAt);
    });

    test("marks missing and stale instrument financing as unmodelled", () => {
        expect(service.getInstrumentFinancing("EUR_USD")).toEqual({
            status: "UNMODELED_MISSING_INSTRUMENT_METADATA",
        });

        service.instrumentMetadataMaxAgeMs = 1000;
        service.instrumentMetadataCache.EUR_USD = {
            name: "EUR_USD",
            updatedAt: 1000,
            financing: { longRate: "-0.03", shortRate: "0.01" },
        };
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(3000);
        expect(service.getInstrumentFinancing("EUR_USD")).toEqual(
            expect.objectContaining({
                status: "UNMODELED_STALE_INSTRUMENT_METADATA",
                updatedAt: 1000,
            })
        );
        nowSpy.mockRestore();
    });
});
