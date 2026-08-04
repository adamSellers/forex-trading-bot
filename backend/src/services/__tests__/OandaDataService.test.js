const OandaDataService = require("../OandaDataService");

describe("OandaDataService required granularities", () => {
    let service;

    beforeEach(() => {
        service = new OandaDataService(["AUD_USD"]);
        // Never hit the network from these tests.
        service.fetchAllCandles = jest.fn().mockResolvedValue(undefined);
    });

    test("defaults to the primary timeframe only", () => {
        expect(service.getRequiredGranularities()).toEqual(["M15"]);
    });

    test("global HTF config adds the HTF granularity", () => {
        service.updateCandleConfig({
            timeframe: "15m",
            enableHTFFilter: true,
            htfTimeframe: "1h",
        });

        expect(service.getRequiredGranularities().sort()).toEqual(["H1", "M15"]);
    });

    test("runtime timeframes are unioned with the global-config granularities", () => {
        // Global config: HTF off. A runtime run (e.g. paper candidate) still
        // needs 1h + 4h candles; before this existed, those were never fetched
        // and the run's HTF filter failed closed ("HTF unavailable").
        service.updateRuntimeTimeframes(["15m", "1h", "4h"]);

        expect(service.getRequiredGranularities().sort()).toEqual([
            "H1",
            "H4",
            "M15",
        ]);
    });

    test("runtime timeframes are replaced wholesale on each sync", () => {
        service.updateRuntimeTimeframes(["4h"]);
        expect(service.getRequiredGranularities()).toContain("H4");

        // Run stopped: the coordinator syncs the remaining (empty) union.
        service.updateRuntimeTimeframes([]);
        expect(service.getRequiredGranularities()).toEqual(["M15"]);
    });

    test("triggers an immediate candle fetch when a new granularity is required while running", () => {
        service.isRunning = true;

        service.updateRuntimeTimeframes(["1h"]);
        expect(service.fetchAllCandles).toHaveBeenCalledTimes(1);

        // Re-syncing an unchanged requirement set must not refetch.
        service.updateRuntimeTimeframes(["1h"]);
        expect(service.fetchAllCandles).toHaveBeenCalledTimes(1);

        // A timeframe already covered by the global config adds nothing new.
        service.updateRuntimeTimeframes(["1h", "15m"]);
        expect(service.fetchAllCandles).toHaveBeenCalledTimes(1);
    });

    test("does not fetch when the service is not running", () => {
        service.updateRuntimeTimeframes(["1h"]);
        expect(service.fetchAllCandles).not.toHaveBeenCalled();
    });

    test("ignores falsy entries and tolerates non-array input", () => {
        service.updateRuntimeTimeframes([null, undefined, "", "1h"]);
        expect(service.getRequiredGranularities().sort()).toEqual(["H1", "M15"]);

        service.updateRuntimeTimeframes(null);
        expect(service.getRequiredGranularities()).toEqual(["M15"]);
    });

    test("reports price and candle refresh freshness without using candle market time", () => {
        service.isRunning = true;
        service.priceCache.AUD_USD = { timestamp: 99_000 };
        service.candleCache.AUD_USD_M15 = [{ time: "2026-01-01T00:00:00Z" }];
        service.candleCacheUpdatedAt.AUD_USD_M15 = 98_000;

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
        service.candleCacheUpdatedAt.AUD_USD_M15 = 1_000;

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
                staleCandles: ["AUD_USD_M15", "AUD_USD_H1"],
            })
        );
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
