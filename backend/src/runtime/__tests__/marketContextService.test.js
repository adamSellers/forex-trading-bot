const MarketContextService = require("../marketContextService");

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
        strategy: "carry_trend",
        config: {
            strategy: "carry_trend",
            assets: ["AUD_USD", "EUR_USD"],
            timeframe: "4h",
        },
    };

    test("requests only the live strategy timeframes", () => {
        const service = new MarketContextService();
        expect(service.getRequiredTimeframesForRun(run).sort()).toEqual([
            "1d",
            "4h",
        ]);
    });

    test("builds one shared broker-data snapshot for the active live run", () => {
        const h4 = candles(100);
        const daily = candles(250);
        const dataService = {
            getCurrentPrice: jest.fn((instrument) => ({
                instrument,
                price: instrument === "AUD_USD" ? 0.65 : 1.1,
                spread: 1.1,
                tradeable: true,
            })),
            getCandles: jest.fn((_instrument, timeframe) =>
                timeframe === "1d" ? daily : h4
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
        expect(context.timeframes["4h"].candles).toHaveLength(100);
        expect(context.timeframes["1d"].candles).toHaveLength(250);
        expect(context.peers.EUR_USD).toEqual(
            expect.objectContaining({ instrument: "EUR_USD" })
        );
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
});
