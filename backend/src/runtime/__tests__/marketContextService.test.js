const MarketContextService = require("../marketContextService");

function createMockDataService() {
    const candles15m = Array.from({ length: 220 }, (_, index) => {
        const base = 1.05 + index * 0.0004;
        return {
            time: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
            open: base,
            high: base + 0.0005,
            low: base - 0.0005,
            close: base + 0.0002,
            volume: 100 + index,
        };
    });

    const candles1h = Array.from({ length: 80 }, (_, index) => {
        const base = 1.02 + index * 0.001;
        return {
            time: new Date(Date.UTC(2026, 0, 1, index, 0)).toISOString(),
            open: base,
            high: base + 0.001,
            low: base - 0.001,
            close: base + 0.0004,
            volume: 200 + index,
        };
    });

    return {
        getCurrentPrice: jest.fn().mockReturnValue({
            instrument: "AUD_USD",
            price: 1.1365,
            bid: 1.1364,
            ask: 1.1366,
            spread: 2,
            tradeable: true,
            timestamp: Date.now(),
        }),
        getCandles: jest.fn((instrument, timeframe) => {
            if (instrument !== "AUD_USD") return [];
            return timeframe === "1h" ? candles1h : candles15m;
        }),
    };
}

function buildRangeBreakoutDataService() {
    const candles5m = [];
    const start5m = Date.UTC(2026, 0, 1, 7, 0, 0, 0);

    for (let index = 0; index < 12; index += 1) {
        const time = new Date(start5m + index * 5 * 60 * 1000).toISOString();
        candles5m.push({
            time,
            open: 1.1,
            high: 1.1005,
            low: 1.0995,
            close: 1.1 + (index % 2 === 0 ? 0.0001 : -0.0001),
            volume: 120 + index,
        });
    }

    for (let index = 12; index < 30; index += 1) {
        const base = 1.1001 + (index - 12) * 0.00002;
        const time = new Date(start5m + index * 5 * 60 * 1000).toISOString();
        candles5m.push({
            time,
            open: base,
            high: base + 0.0002,
            low: base - 0.0002,
            close: base + 0.00005,
            volume: 120 + index,
        });
    }

    const candles15m = [
        {
            time: "2026-01-01T09:00:00.000Z",
            open: 1.1001,
            high: 1.1003,
            low: 1.0999,
            close: 1.1002,
            volume: 200,
        },
        {
            time: "2026-01-01T09:15:00.000Z",
            open: 1.1002,
            high: 1.1008,
            low: 1.1001,
            close: 1.1007,
            volume: 210,
        },
    ];

    const candles1h = Array.from({ length: 40 }, (_, index) => {
        const base = 1.08 + index * 0.0004;
        return {
            time: new Date(Date.UTC(2026, 0, 1, index, 0)).toISOString(),
            open: base,
            high: base + 0.0006,
            low: base - 0.0006,
            close: base + 0.0002,
            volume: 150 + index,
        };
    });

    return {
        getCurrentPrice: jest.fn().mockReturnValue({
            instrument: "AUD_USD",
            price: 1.1007,
            bid: 1.1006,
            ask: 1.1008,
            spread: 2,
            tradeable: true,
            timestamp: Date.now(),
        }),
        getCandles: jest.fn((instrument, timeframe) => {
            if (instrument !== "AUD_USD") return [];
            if (timeframe === "5m") return candles5m;
            if (timeframe === "1h") return candles1h;
            return candles15m;
        }),
    };
}

describe("MarketContextService", () => {
    let service;
    let dataService;

    beforeEach(() => {
        service = new MarketContextService();
        dataService = createMockDataService();
    });

    test("buildSharedContext precomputes required indicators for shared run contexts", () => {
        const sharedContext = service.buildSharedContext(
            [
                {
                    runId: "live-run-1",
                    strategy: "supertrend_momentum",
                    configHash: "cfg-1",
                    config: {
                        strategy: "supertrend_momentum",
                        assets: ["AUD_USD"],
                        timeframe: "15m",
                        enableHTFFilter: true,
                        htfTimeframe: "1h",
                        atrPeriod: 10,
                        factor: 3,
                    },
                },
                {
                    runId: "shadow-run-1",
                    strategy: "supertrend_momentum",
                    configHash: "cfg-1",
                    config: {
                        strategy: "supertrend_momentum",
                        assets: ["AUD_USD"],
                        timeframe: "15m",
                        enableHTFFilter: true,
                        htfTimeframe: "1h",
                        atrPeriod: 10,
                        factor: 3,
                    },
                },
            ],
            dataService
        );

        expect(sharedContext.instruments.AUD_USD.price.price).toBe(1.1365);
        expect(sharedContext.instruments.AUD_USD.timeframes["15m"].candles).toHaveLength(
            220
        );

        const contextKey = service.getRunContextKey({
            strategy: "supertrend_momentum",
            configHash: "cfg-1",
            config: {
                strategy: "supertrend_momentum",
                timeframe: "15m",
                enableHTFFilter: true,
                htfTimeframe: "1h",
            },
        });

        const bundle =
            sharedContext.precomputed[contextKey].instruments.AUD_USD.timeframes[
                "15m"
            ].indicators;

        expect(bundle.supertrend.direction.length).toBe(220);
        expect(bundle.rsi.length).toBeGreaterThan(0);
        expect(bundle.adx.length).toBeGreaterThan(0);
        expect(bundle.atr.length).toBeGreaterThan(0);
    });

    test("createInstrumentContext returns per-run candles, price, session, and indicators", () => {
        const runDescriptor = {
            runId: "live-run-1",
            strategy: "supertrend_momentum",
            configHash: "cfg-1",
            config: {
                strategy: "supertrend_momentum",
                assets: ["AUD_USD"],
                timeframe: "15m",
                enableHTFFilter: true,
                htfTimeframe: "1h",
                atrPeriod: 10,
                factor: 3,
            },
        };

        const sharedContext = service.buildSharedContext([runDescriptor], dataService);
        const instrumentContext = service.createInstrumentContext(
            sharedContext,
            runDescriptor,
            "AUD_USD"
        );

        expect(instrumentContext.instrument).toBe("AUD_USD");
        expect(instrumentContext.price.price).toBe(1.1365);
        expect(instrumentContext.session.session).toBeTruthy();
        expect(instrumentContext.timeframes["15m"].candles).toHaveLength(220);
        expect(
            instrumentContext.timeframes["15m"].indicators.supertrend.direction
        ).toHaveLength(220);
        expect(
            instrumentContext.timeframes["1h"].indicators.supertrend.direction
        ).toHaveLength(80);
    });

    test("createInstrumentContext includes shared M5 opening-range data for range_breakout", () => {
        const dataService = buildRangeBreakoutDataService();
        const runDescriptor = {
            runId: "candidate-run-1",
            strategy: "range_breakout",
            configHash: "cfg-range-1",
            config: {
                strategy: "range_breakout",
                assets: ["AUD_USD"],
                timeframe: "15m",
                londonOpenHourUTC: 7,
                nyOpenHourUTC: 12,
                entryWindowHours: 4,
            },
        };

        const sharedContext = service.buildSharedContext([runDescriptor], dataService);
        const instrumentContext = service.createInstrumentContext(
            sharedContext,
            runDescriptor,
            "AUD_USD"
        );

        expect(instrumentContext.timeframes["5m"].candles).toHaveLength(30);
        expect(instrumentContext.timeframes["5m"].derived.rangeBreakout).toEqual(
            expect.objectContaining({
                session: "London",
                high: 1.1005,
                low: 1.0995,
            })
        );
    });

    test("createInstrumentContext includes shared squeeze context for squeeze_play", () => {
        const runDescriptor = {
            runId: "candidate-run-squeeze",
            strategy: "squeeze_play",
            configHash: "cfg-squeeze-1",
            config: {
                strategy: "squeeze_play",
                assets: ["AUD_USD"],
                timeframe: "15m",
                minSqueezeBarCount: 6,
                linRegPeriod: 12,
                h1AtrLookback: 50,
            },
        };

        const sharedContext = service.buildSharedContext([runDescriptor], dataService);
        const instrumentContext = service.createInstrumentContext(
            sharedContext,
            runDescriptor,
            "AUD_USD"
        );

        expect(instrumentContext.timeframes["15m"].derived.squeezePlay).toEqual(
            expect.objectContaining({
                priorSqueezeCount: expect.any(Number),
                direction: expect.any(String),
            })
        );
        expect(
            instrumentContext.timeframes["15m"].derived.squeezePlay.h1AtrPercentile
        ).toEqual(expect.any(Number));
    });
});
