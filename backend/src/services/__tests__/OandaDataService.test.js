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
});
