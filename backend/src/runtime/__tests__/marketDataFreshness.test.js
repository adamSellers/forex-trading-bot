const {
    evaluateCandleFreshness,
    evaluateIntradayEntryFreshness,
    evaluateMultiDayEntryFreshness,
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

describe("completed New York-aligned H4 freshness", () => {
    test.each([
        ["2026-10-13T09:00:00Z", "2026-10-13T13:01:30Z"],
        ["2026-11-09T10:00:00Z", "2026-11-09T14:01:30Z"],
    ])("accepts the broker's %s H4 start in either DST offset", (time, now) => {
        expect(evaluateCandleFreshness(bar(time), "H4", { nowMs: timestamp(now) })).toMatchObject({
            fresh: true, latestCloseAt: timestamp(time) + 4 * 3_600_000 });
        expect(evaluateMultiDayEntryFreshness({ h4Candles: bar(time), nowMs: timestamp(now) }).fresh).toBe(true);
    });

    test("uses the bounded publication grace without assuming UTC multiples of four hours", () => {
        const h4Candles = bar("2026-10-13T05:00:00Z");
        expect(evaluateMultiDayEntryFreshness({ h4Candles, nowMs: timestamp("2026-10-13T13:01:29Z") }).fresh).toBe(true);
        expect(evaluateMultiDayEntryFreshness({ h4Candles, nowMs: timestamp("2026-10-13T13:01:30Z") }).code).toBe("STALE_COMPLETED_CANDLE");
        expect(evaluateCandleFreshness(bar("2026-10-13T08:00:00Z"), "4h",
            { nowMs: timestamp("2026-10-13T13:02:00Z") }).code).toBe("INVALID_H4_ALIGNMENT");
    });

    test.each([
        ["2026-03-06T18:00:00Z", "2026-03-08T21:06:00Z"],
        ["2026-10-30T17:00:00Z", "2026-11-01T22:06:00Z"],
    ])("keeps %s Friday data current across a DST weekend but expires its entry", (time, now) => {
        const nowMs = timestamp(now);
        expect(evaluateCandleFreshness(bar(time), "H4", { nowMs }).fresh).toBe(true);
        expect(evaluateMultiDayEntryFreshness({ h4Candles: bar(time), nowMs }).code).toBe("H4_SIGNAL_EXPIRED");
    });

    test("closed weekend is a normal entry hold with current historical candle data", () => {
        const h4Candles = bar("2026-10-16T17:00:00Z");
        const nowMs = timestamp("2026-10-17T12:00:00Z");
        expect(evaluateCandleFreshness(h4Candles, "4h", { nowMs }).fresh).toBe(true);
        expect(evaluateMultiDayEntryFreshness({ h4Candles, nowMs }).code).toBe("MARKET_CLOSED");
    });

    test("daily reopen accepts the current completed H4 without waiting another four hours", () => {
        expect(evaluateMultiDayEntryFreshness({ h4Candles: bar("2026-10-13T17:00:00Z"),
            nowMs: timestamp("2026-10-13T21:06:00Z") }).fresh).toBe(true);
    });

    test("accepts first new Sunday H4 with Friday history across the normal weekend gap", () => {
        const h4Candles = [
            { time: "2026-10-16T17:00:00Z", complete: true },
            { time: "2026-10-18T21:00:00Z", complete: true },
        ];
        expect(evaluateMultiDayEntryFreshness({ h4Candles,
            nowMs: timestamp("2026-10-19T01:01:31Z") }).fresh).toBe(true);
    });

    test.each([
        { h4Candles: [{ time: "2026-10-13T09:00:00Z", complete: false }] },
        { h4Candles: [{ time: "2026-10-13T13:00:00Z", complete: true }] },
    ])("does not accept incomplete/future H4 history %j", ({ h4Candles }) => {
        expect(evaluateMultiDayEntryFreshness({ h4Candles,
            nowMs: timestamp("2026-10-13T13:00:00Z") }).code).toBe("CANDLE_NOT_COMPLETE");
    });

    test.each([
        { h4Candles: [{ time: "2026-10-13T09:00:00Z" }, { time: "2026-10-13T09:00:00Z" }] },
        { h4Candles: [{ time: "2026-10-13T09:00:00Z" }, { time: "2026-10-13T05:00:00Z" }] },
        { h4Candles: [{ time: "2026-10-13T04:00:00Z" }, { time: "2026-10-13T09:00:00Z" }] },
    ])("rejects unordered or misaligned H4 history %j", ({ h4Candles }) => {
        expect(evaluateMultiDayEntryFreshness({ h4Candles,
            nowMs: timestamp("2026-10-13T13:00:00Z") }).code).toBe("INVALID_H4_HISTORY");
    });
});
