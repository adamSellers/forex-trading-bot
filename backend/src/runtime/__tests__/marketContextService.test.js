const MarketContextService = require("../marketContextService");
const OandaDataService = require("../../services/OandaDataService");

function candles(count, start = 0.65) {
    return Array.from({ length: count }, (_, index) => ({
        time: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
        open: start + index * 0.001,
        high: start + index * 0.001 + 0.002,
        low: start + index * 0.001 - 0.002,
        close: start + index * 0.001 + 0.001,
        volume: 100,
    }));
}

describe("live MarketContextService", () => {
    const run = {
        runId: "live-1",
        strategy: "intraday_momentum",
        config: {
            strategy: "intraday_momentum",
            assets: ["AUD_USD", "EUR_USD"],
            timeframe: "15m",
        },
    };

    test("requests only the live strategy timeframes", () => {
        const service = new MarketContextService();
        expect(service.getRequiredTimeframesForRun(run).sort()).toEqual([
            "15m",
            "1h",
        ]);
    });

    test("builds one shared broker-data snapshot for the active live run", () => {
        const m15 = candles(100);
        const h1 = candles(250);
        const dataService = {
            getCurrentPrice: jest.fn((instrument) => ({
                instrument,
                price: instrument === "AUD_USD" ? 0.65 : 1.1,
                spread: 1.1,
                tradeable: true,
            })),
            getCandles: jest.fn((_instrument, timeframe) =>
                timeframe === "1h" ? h1 : m15
            ),
        };
        const service = new MarketContextService();
        const shared = service.buildSharedContext([run], dataService);
        const context = service.createInstrumentContext(shared, run, "AUD_USD");

        expect(context).toEqual(
            expect.objectContaining({
                instrument: "AUD_USD",
                price: expect.objectContaining({ price: 0.65 }),
                session: expect.objectContaining({
                    spreadPips: 1.1,
                    tradeable: true,
                }),
            })
        );
        expect(context.timeframes["15m"].candles).toHaveLength(100);
        expect(context.timeframes["1h"].candles).toHaveLength(250);
        expect(context.peers.EUR_USD).toEqual(
            expect.objectContaining({ instrument: "EUR_USD" })
        );
    });

    test("carries historical ask OHLC and unavailable ask through broker fetch, cache and run context", async () => {
        const dataService = new OandaDataService(["AUD_USD"]);
        dataService.priceCache.AUD_USD = { price: 0.695645, spread: 0.9, tradeable: true };
        dataService.oandaRequest = jest.fn().mockResolvedValue({ candles: [
            {
                time: "2026-09-30T13:15:00.000000000Z", complete: true, volume: 89,
                mid: { o: "0.69653", h: "0.69684", l: "0.69619", c: "0.69633" },
                ask: { o: "0.69660", h: "0.69690", l: "0.69626", c: "0.69640" },
            },
            {
                time: "2026-09-30T13:30:00.000000000Z", complete: true, volume: 92,
                mid: { o: "0.69636", h: "0.69656", l: "0.69568", c: "0.69578" },
            },
            {
                time: "2026-09-30T13:45:00.000000000Z", complete: false, volume: 2,
                mid: { o: "0.69572", h: "0.69578", l: "0.69568", c: "0.69575" },
                ask: { o: "0.69578", h: "0.69584", l: "0.69574", c: "0.69581" },
            },
        ] });
        const fetched = await dataService.fetchCandles("AUD_USD", "M15");
        const service = new MarketContextService();
        const shared = service.buildSharedContext([run], dataService);
        const context = service.createInstrumentContext(shared, run, "AUD_USD");

        expect(context.timeframes["15m"].candles).toBe(fetched);
        expect(context.timeframes["15m"].candles).toHaveLength(2);
        expect(context.timeframes["15m"].candles[0]).toMatchObject({
            high: 0.69684,
            ask: { open: 0.69660, high: 0.69690, low: 0.69626, close: 0.69640 },
        });
        expect(context.timeframes["15m"].candles[1]).toMatchObject({
            high: 0.69656, close: 0.69578, ask: null,
        });
        expect(context.session.spreadPips).toBe(0.9);
    });

    test("returns configured timeframes while recovering an unknown owner run", () => {
        const service = new MarketContextService();
        expect(
            service
                .getRequiredTimeframesForRun({
                    strategy: "retired_strategy",
                    config: {
                        timeframe: "4h",
                        enableHTFFilter: true,
                        htfTimeframe: "1d",
                    },
                })
                .sort()
        ).toEqual(["1d", "4h"]);
    });

    test.each([null, undefined, "", -1, NaN])("does not turn invalid spread %s into a free quote", (spread) => {
        const service = new MarketContextService();
        const shared = service.buildSharedContext([run], {
            getCurrentPrice: () => ({ price: 0.66, spread, tradeable: true }),
        });
        expect(service.createInstrumentContext(shared, run, "AUD_USD").session.spreadPips).toBeNull();
    });
});
