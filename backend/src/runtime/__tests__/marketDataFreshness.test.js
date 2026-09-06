const {
    evaluateCandleFreshness,
    evaluateIntradayEntryFreshness,
    getForexMarketState,
} = require("../marketDataFreshness");

const timestamp = (value) => Date.parse(value);
const bar = (time) => [{ time }];

describe("completed intraday candle freshness", () => {
    test("allows a bounded publication grace then requires the newly completed bar", () => {
        const candles = bar("2026-08-10T09:30:00Z");
        expect(evaluateCandleFreshness(candles, "15m", { nowMs: timestamp("2026-08-10T10:01:29Z") }).fresh).toBe(true);
        expect(evaluateCandleFreshness(candles, "15m", { nowMs: timestamp("2026-08-10T10:01:30Z") }).code).toBe("STALE_COMPLETED_CANDLE");
        expect(evaluateCandleFreshness(bar("2026-08-10T09:45:00Z"), "15m", { nowMs: timestamp("2026-08-10T10:01:30Z") }).fresh).toBe(true);
    });

    test("does not accept an unfinished or future candle", () => {
        expect(evaluateCandleFreshness(bar("2026-08-10T10:00:00Z"), "15m", { nowMs: timestamp("2026-08-10T10:01:30Z") }).code).toBe("CANDLE_NOT_COMPLETE");
        expect(evaluateCandleFreshness([{ time: "2026-08-10T09:45:00Z", complete: false }], "15m", { nowMs: timestamp("2026-08-10T10:01:30Z") }).code).toBe("CANDLE_NOT_COMPLETE");
    });

    test.each([
        ["2026-09-06T10:00:00Z", "2026-09-04T20:45:00Z", "2026-09-04T20:00:00Z"],
        // The autumn clock change occurs while FX is closed.
        ["2026-11-01T21:59:00Z", "2026-10-30T20:45:00Z", "2026-10-30T20:00:00Z"],
    ])("keeps final Friday candles current through the weekend at %s", (now, m15, h1) => {
        const nowMs = timestamp(now);
        expect(evaluateCandleFreshness(bar(m15), "15m", { nowMs }).fresh).toBe(true);
        expect(evaluateCandleFreshness(bar(h1), "1h", { nowMs }).fresh).toBe(true);
        expect(evaluateIntradayEntryFreshness({ m15Candles: bar(m15), h1Candles: bar(h1), nowMs }).code).toBe("MARKET_CLOSED");
    });

    test("does not treat Friday's trigger as a new Sunday entry", () => {
        expect(evaluateIntradayEntryFreshness({
            m15Candles: bar("2026-09-04T20:45:00Z"),
            h1Candles: bar("2026-09-04T20:00:00Z"),
            nowMs: timestamp("2026-09-06T21:06:00Z"),
        }).code).toBe("WAITING_FOR_POST_REOPEN_CANDLE");
    });

    test("accepts the first Sunday M15 bar with the most recent traded H1 bar", () => {
        expect(evaluateIntradayEntryFreshness({
            m15Candles: bar("2026-09-06T21:00:00Z"),
            h1Candles: bar("2026-09-04T20:00:00Z"),
            nowMs: timestamp("2026-09-06T21:16:31Z"),
        }).fresh).toBe(true);
    });

    test("waits for a new M15 candle after the daily maintenance break", () => {
        const context = { m15Candles: bar("2026-08-10T20:45:00Z"), h1Candles: bar("2026-08-10T20:00:00Z") };
        expect(evaluateIntradayEntryFreshness({ ...context, nowMs: timestamp("2026-08-10T21:02:00Z") }).code).toBe("MARKET_CLOSED");
        expect(evaluateIntradayEntryFreshness({ ...context, nowMs: timestamp("2026-08-10T21:06:00Z") }).code).toBe("WAITING_FOR_POST_REOPEN_CANDLE");
        expect(evaluateIntradayEntryFreshness({ ...context,
            m15Candles: bar("2026-08-10T21:00:00Z"), nowMs: timestamp("2026-08-10T21:16:31Z") }).fresh).toBe(true);
    });

    test.each([
        ["2026-08-10T20:58:59Z", true],
        ["2026-08-10T20:59:00Z", false],
        ["2026-08-10T21:04:59Z", false],
        ["2026-08-10T21:05:00Z", true],
        ["2026-11-09T21:59:00Z", false],
        ["2026-11-09T22:05:00Z", true],
        ["2026-09-04T21:05:00Z", false],
        ["2026-09-06T21:04:59Z", false],
        ["2026-09-06T21:05:00Z", true],
    ])("OANDA NY clock at %s has open=%s", (time, open) => {
        expect(getForexMarketState(timestamp(time)).open).toBe(open);
    });
});
