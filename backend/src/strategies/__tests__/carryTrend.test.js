const {
    evaluateCarryTrendEntry,
} = require("../carryTrend");

function buildDaily(direction = 1, count = 260) {
    const candles = [];
    for (let index = 0; index < count; index += 1) {
        const close =
            direction > 0
                ? 1 + index * 0.001
                : 1.5 - index * 0.001;
        candles.push({
            time: new Date(Date.UTC(2025, 0, 1 + index)).toISOString(),
            open: close - direction * 0.0002,
            high: close + 0.002,
            low: close - 0.002,
            close,
            volume: 100,
        });
    }
    const last = candles[candles.length - 1];
    last.close += direction * 0.01;
    last.high = Math.max(last.high, last.close + 0.0002);
    last.low = Math.min(last.low, last.close - 0.0002);
    return candles;
}

function buildH4() {
    return Array.from({ length: 220 }, (_, index) => {
        const close = 1.1 + index * 0.0001;
        return {
            time: new Date(Date.UTC(2026, 6, 1, index * 4)).toISOString(),
            open: close - 0.0001,
            high: close + 0.0003,
            low: close - 0.0003,
            close,
            volume: 100,
        };
    }).map((candle, index, values) =>
        index === values.length - 1
            ? { ...candle, time: "2026-08-04T08:00:00.000Z" }
            : candle
    );
}

function context(daily) {
    return {
        timeframes: {
            "1d": { candles: daily },
            "4h": { candles: buildH4() },
        },
    };
}

describe("carryTrend", () => {
    test("enters a daily long breakout only when live financing favors long", async () => {
        const daily = buildDaily(1);
        const result = await evaluateCarryTrendEntry({
            instrument: "AUD_USD",
            currentPrice: daily[daily.length - 1].close,
            config: {},
            marketContext: context(daily),
            dataService: {
                getInstrumentFinancing: () => ({
                    status: "MODELED",
                    longRateAnnual: 0.04,
                    shortRateAnnual: -0.02,
                    source: "OANDA_ACCOUNT_INSTRUMENTS",
                }),
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "CARRY_TREND_BREAKOUT",
                reasonCode: "CARRY_TREND_LONG_ENTRY",
                tradePlan: expect.objectContaining({
                    takeProfitPrice: null,
                }),
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeLessThan(
            daily[daily.length - 1].close
        );
        expect(result.strategyContext.financing.longRateAnnual).toBe(0.04);
    });

    test("rejects a valid price breakout when financing favors the other side", async () => {
        const daily = buildDaily(1);
        const result = await evaluateCarryTrendEntry({
            instrument: "AUD_USD",
            currentPrice: daily[daily.length - 1].close,
            config: {},
            marketContext: context(daily),
            dataService: {
                getInstrumentFinancing: () => ({
                    status: "MODELED",
                    longRateAnnual: -0.04,
                    shortRateAnnual: 0.02,
                }),
            },
        });

        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe("CARRY_TREND_CARRY_MISALIGNED");
    });

    test("supports a carry-aligned short breakout with a protective stop above price", async () => {
        const daily = buildDaily(-1);
        const result = await evaluateCarryTrendEntry({
            instrument: "USD_JPY",
            currentPrice: daily[daily.length - 1].close,
            config: {},
            marketContext: context(daily),
            dataService: {
                getInstrumentFinancing: () => ({
                    status: "MODELED",
                    longRateAnnual: -0.03,
                    shortRateAnnual: 0.025,
                }),
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                signalClass: "ACTIONABLE",
                intent: "ENTER_SHORT",
                reasonCode: "CARRY_TREND_SHORT_ENTRY",
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeGreaterThan(
            daily[daily.length - 1].close
        );
    });

    test("emits a symmetric exit-only BUY when a short trend is invalidated", async () => {
        const daily = buildDaily(-1);
        const last = daily[daily.length - 1];
        last.close += 0.2;
        last.high = last.close + 0.001;
        const result = await evaluateCarryTrendEntry({
            instrument: "EUR_USD",
            currentPrice: last.close,
            config: {},
            marketContext: context(daily),
            dataService: {
                getInstrumentFinancing: () => ({
                    status: "MODELED",
                    longRateAnnual: 0,
                    shortRateAnnual: 0,
                }),
            },
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                entryType: "EXIT_ONLY",
                signalClass: "EXIT_ONLY",
                intent: "EXIT_SHORT_ONLY",
                reasonCode: "CARRY_TREND_EXIT_SHORT",
            })
        );
    });

    test("fails closed when broker financing metadata is unavailable", async () => {
        const daily = buildDaily(1);
        const result = await evaluateCarryTrendEntry({
            instrument: "GBP_USD",
            currentPrice: daily[daily.length - 1].close,
            config: {},
            marketContext: context(daily),
            dataService: {
                getInstrumentFinancing: () => ({
                    status: "UNMODELED_STALE_INSTRUMENT_METADATA",
                }),
            },
        });

        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe(
            "CARRY_TREND_FINANCING_UNAVAILABLE"
        );
    });
});
