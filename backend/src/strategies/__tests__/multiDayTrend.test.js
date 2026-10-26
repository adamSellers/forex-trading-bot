const strategy = require("../multiDayTrend");
const { evaluateMultiDayTrendEntry, evaluateChannelTrail, DEFAULT_MULTI_DAY_TREND_CONFIG } = strategy;
const { calculateATR } = require("../../utils/indicators");
const { H4_MS, attachSides, multiDayTrendFixture, appendH4 } = require("./fixtures/multiDayTrendFixture");

describe("H4 rolling channel strategy", () => {
    test("freezes the declared version, data and parameter defaults", () => {
        expect(strategy).toMatchObject({ key: "multi_day_trend", version: "2.1.0",
            requiredData: { timeframes: ["4h"], indicators: ["atr"] } });
        expect(Object.isFrozen(DEFAULT_MULTI_DAY_TREND_CONFIG)).toBe(true);
        expect(DEFAULT_MULTI_DAY_TREND_CONFIG).toMatchObject({ trendBreakoutBars: 20,
            trendExitBars: 10, trendAtrPeriod: 14, trendStopAtr: 2,
            trendMaxCostToStopRatio: 0.15, enableTakeProfit: false, enableBreakeven: false });
    });

    test.each(["BUY", "SELL"])("a fresh %s close produces an ATR-distance plan without a target", (side) => {
        const fixture = multiDayTrendFixture({ side });
        const actual = evaluateMultiDayTrendEntry(fixture);
        const atr = calculateATR(fixture.h4.map((c) => c.high), fixture.h4.map((c) => c.low),
            fixture.h4.map((c) => c.close), 14).at(-1);
        expect(actual).toMatchObject({ signalType: side, entryType: "ROLLING_CHANNEL_BREAKOUT",
            signalClass: "ACTIONABLE", signalCandleTime: fixture.h4.at(-1).time,
            metadata: { strategy: "multi_day_trend", version: "2.1.0" },
            htfContext: { enabled: false }, tradePlan: { stopPriceMode: "ATR_DISTANCE",
                stopLossType: "ATR", takeProfit: null, takeProfitPrice: null, targetRiskMultiple: null } });
        expect(actual.atrVal).toBe(atr);
        expect(actual.tradePlan.riskDistance).toBeCloseTo(2 * atr, 12);
        expect(actual.tradePlan.stopLossPrice).toBeCloseTo(fixture.currentPrice + (side === "BUY" ? -2 : 2) * atr, 12);
        expect(actual.strategyContext.h4.channelHigh).toBe(Math.max(...fixture.h4.slice(-21, -1).map((c) => c.high)));
        expect(actual.strategyContext.h4.channelLow).toBe(Math.min(...fixture.h4.slice(-21, -1).map((c) => c.low)));
    });

    test.each(["BUY", "SELL"])("an intrabar %s channel touch without a closing break stays flat", (side) => {
        const fixture = multiDayTrendFixture({ side });
        fixture.h4.at(-1).close = side === "BUY" ? 1.1005 : 1.2995;
        const actual = evaluateMultiDayTrendEntry(fixture);
        expect(actual).toMatchObject({ signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_NO_FRESH_BREAKOUT", tradePlan: null });
    });

    test.each(["BUY", "SELL"])("a continuing %s breakout does not replay the previous crossing", (side) => {
        const fixture = multiDayTrendFixture({ side });
        appendH4(fixture, side === "BUY"
            ? { open: 1.102, close: 1.103, high: 1.1033, low: 1.1019 }
            : { open: 1.298, close: 1.297, high: 1.2981, low: 1.2967 });
        const actual = evaluateMultiDayTrendEntry(fixture);
        expect(actual).toMatchObject({ signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_NO_FRESH_BREAKOUT" });
        expect(actual.strategyContext.h4[side === "BUY" ? "longBreakout" : "shortBreakout"]).toBe(true);
    });

    test.each(["BUY", "SELL"])("a later fresh %s crossing re-enters without frozen episode or loss-reset state", (side) => {
        const fixture = multiDayTrendFixture({ side, closeAt: "2026-10-13T05:00:00Z" });
        appendH4(fixture, side === "BUY"
            ? { open: 1.102, close: 1.1005, high: 1.1021, low: 1.1002 }
            : { open: 1.298, close: 1.2995, high: 1.2998, low: 1.2979 });
        appendH4(fixture, side === "BUY"
            ? { open: 1.1005, close: 1.103, high: 1.1033, low: 1.1004 }
            : { open: 1.2995, close: 1.297, high: 1.2996, low: 1.2967 });
        const actual = evaluateMultiDayTrendEntry({ ...fixture,
            latestClosedTrade: { side, closeReason: "STOP_LOSS", exitTime: fixture.nowMs - H4_MS },
            buyRetestDecision: { classification: "CONSUMED" }, lossResetDecisions: { blocked: true } });
        expect(actual.signalType).toBe(side);
    });

    test("the 20-bar window renews when an old extreme rolls out", () => {
        const fixture = multiDayTrendFixture({ count: 23 });
        const dropped = fixture.h4.at(-22);
        Object.assign(dropped, { high: 1.2, close: 1.1 });
        attachSides(dropped);
        const actual = evaluateMultiDayTrendEntry(fixture);
        expect(actual.signalType).toBe("BUY");
        expect(actual.strategyContext.h4.previousChannelHigh).toBe(1.2);
        expect(actual.strategyContext.h4.channelHigh).toBe(1.101);
    });

    test("requires 22 completed bars for both contemporaneous 20-bar comparisons", () => {
        expect(evaluateMultiDayTrendEntry(multiDayTrendFixture({ count: 21 }))).toMatchObject({
            signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_WARMUP" });
        expect(evaluateMultiDayTrendEntry(multiDayTrendFixture({ count: 22 })).signalType).toBe("BUY");
    });

    test.each(["BUY", "SELL"])("a close exactly on the %s boundary is not a crossing", (side) => {
        const fixture = multiDayTrendFixture({ side });
        const prior = fixture.h4.slice(-21, -1);
        fixture.h4.at(-1).close = side === "BUY"
            ? Math.max(...prior.map((c) => c.high)) : Math.min(...prior.map((c) => c.low));
        expect(evaluateMultiDayTrendEntry(fixture)).toMatchObject({ signalType: "HOLD",
            reasonCode: "MULTI_DAY_TREND_NO_FRESH_BREAKOUT" });
    });

    test("ignores all OHLC in a forming/future tail", () => {
        const fixture = multiDayTrendFixture();
        const before = evaluateMultiDayTrendEntry(fixture);
        fixture.h4.push({ time: new Date(fixture.nowMs).toISOString(), complete: false,
            open: 5, close: 9, high: 100, low: 0.0001 });
        expect(evaluateMultiDayTrendEntry(fixture)).toEqual(before);
    });

    test.each(["duplicate", "reversed", "malformed"])("rejects %s completed history", (problem) => {
        const fixture = multiDayTrendFixture();
        if (problem === "duplicate") fixture.h4[1].time = fixture.h4[0].time;
        if (problem === "reversed") fixture.h4.reverse();
        if (problem === "malformed") fixture.h4.at(-2).low = fixture.h4.at(-2).high + 0.1;
        expect(evaluateMultiDayTrendEntry(fixture)).toMatchObject({ signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_INVALID_H4_HISTORY" });
    });

    test("does not mutate broker evidence or use an owned position as a reversal signal", () => {
        const fixture = multiDayTrendFixture({ side: "SELL" });
        const retained = JSON.stringify(fixture);
        expect(evaluateMultiDayTrendEntry(fixture).signalType).toBe("SELL");
        expect(evaluateMultiDayTrendEntry({ ...fixture, ownedOpenTrade: { side: "BUY", isOpen: true } })).toMatchObject({
            signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_POSITION_OPEN" });
        expect(JSON.stringify(fixture)).toBe(retained);
    });

    test("retains valid weekend history and trades outside the retired pair session windows", () => {
        const fixture = multiDayTrendFixture({ closeAt: "2026-10-13T01:00:00Z" });
        expect(fixture.h4.some((c, i) => i > 0 && Date.parse(c.time) - Date.parse(fixture.h4[i - 1].time) > H4_MS)).toBe(true);
        expect(evaluateMultiDayTrendEntry(fixture).signalType).toBe("BUY");
    });

    test.each(["BUY", "SELL"])("a current %s quote gap preserves ATR risk distance rather than anchoring to an old candle", (side) => {
        const fixture = multiDayTrendFixture({ side });
        fixture.currentPrice += side === "BUY" ? 0.02 : -0.02;
        fixture.marketContext.price = { price: fixture.currentPrice, bid: fixture.currentPrice - 0.00002,
            ask: fixture.currentPrice + 0.00002, tradeable: true };
        const actual = evaluateMultiDayTrendEntry(fixture);
        expect(actual.signalType).toBe(side);
        expect(Math.abs(actual.tradePlan.stopLossPrice - fixture.currentPrice)).toBeCloseTo(actual.atrVal * 2, 12);
    });

    test("the existing ATR14 calculation includes completed-bar gaps against the prior close", () => {
        const fixture = multiDayTrendFixture();
        const latest = fixture.h4.at(-1);
        Object.assign(latest, { open: 1.103, close: 1.1031, high: 1.1032, low: 1.1029 });
        attachSides(latest);
        const actual = evaluateMultiDayTrendEntry(fixture);
        const expected = calculateATR(fixture.h4.map((c) => c.high), fixture.h4.map((c) => c.low),
            fixture.h4.map((c) => c.close), 14).at(-1);
        expect(actual.signalType).toBe("BUY");
        expect(actual.atrVal).toBe(expected);
    });

    test("a positive-price stop is required even when the quote has gapped", () => {
        const fixture = multiDayTrendFixture();
        fixture.currentPrice = 0.00001;
        expect(evaluateMultiDayTrendEntry(fixture)).toMatchObject({ signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_INVALID_STOP" });
    });

    test("uses the six-pip execution floor for low-ATR cost admission", () => {
        const fixture = multiDayTrendFixture({ scale: 0.01 });
        const actual = evaluateMultiDayTrendEntry(fixture);
        expect(actual.signalType).toBe("BUY");
        expect(actual.tradePlan.atrStopPips).toBeLessThan(6);
        expect(actual.tradePlan.stopPips).toBe(6);
        expect(actual.strategyContext.costs.costToStopRatio).toBeCloseTo((0.004 + 0.2) / 6, 12);
    });

    test.each([{ spread: 0.7, expected: "BUY" }, { spread: 0.70001, expected: "HOLD" }])(
        "preserves the inclusive 15 percent cost boundary at spread $spread", ({ spread, expected }) => {
            const fixture = multiDayTrendFixture({ scale: 0.01 });
            fixture.marketContext.price.bid = fixture.currentPrice - spread * 0.0001 / 2;
            fixture.marketContext.price.ask = fixture.currentPrice + spread * 0.0001 / 2;
            expect(evaluateMultiDayTrendEntry(fixture).signalType).toBe(expected);
        });

    test("JPY prices retain their own pip size in ATR risk and costs", () => {
        const fixture = multiDayTrendFixture({ scale: 100 });
        const actual = evaluateMultiDayTrendEntry({ ...fixture, instrument: "USD_JPY" });
        expect(actual.signalType).toBe("BUY");
        expect(actual.atrPips).toBe(actual.atrVal / 0.01);
        expect(actual.strategyContext.costs.spreadPips).toBeCloseTo(0.4, 10);
    });

    test("prefers broker bid/ask spread over the session summary and rejects unknown costs", () => {
        const fixture = multiDayTrendFixture();
        fixture.marketContext.session.spreadPips = 500;
        expect(evaluateMultiDayTrendEntry(fixture).signalType).toBe("BUY");
        delete fixture.marketContext.price.bid;
        delete fixture.marketContext.price.ask;
        expect(evaluateMultiDayTrendEntry(fixture)).toMatchObject({ reasonCode: "MULTI_DAY_TREND_COST_TOO_HIGH" });
        delete fixture.marketContext.session.spreadPips;
        expect(evaluateMultiDayTrendEntry(fixture)).toMatchObject({ reasonCode: "MULTI_DAY_TREND_COST_TOO_HIGH" });
        fixture.marketContext.session.spreadPips = 0.4;
        expect(evaluateMultiDayTrendEntry(fixture).signalType).toBe("BUY");
    });

    test("H1, M15, RSI, retest and daily-rollover settings do not become feature gates", () => {
        const fixture = multiDayTrendFixture({ closeAt: "2026-10-13T21:00:00Z" });
        // Five minutes after daily reopen, this newly completed H4 is current.
        fixture.nowMs += 6 * 60_000;
        fixture.marketContext.timeframes["1h"] = { candles: [] };
        fixture.marketContext.timeframes["15m"] = { candles: [] };
        const actual = evaluateMultiDayTrendEntry({ ...fixture, config: { enableSessionFilter: true,
            enableHTFFilter: true, intradayMinAdx: 100, sessionCloseLocalHour: 16, sessionCloseLocalMinute: 45 } });
        expect(actual.signalType).toBe("BUY");
    });

    test("weekly cutoff and closed markets do not admit new entries", () => {
        const cutoff = multiDayTrendFixture({ closeAt: "2026-10-16T17:00:00Z" });
        cutoff.nowMs = Date.parse("2026-10-16T20:46:00Z");
        expect(evaluateMultiDayTrendEntry(cutoff)).toMatchObject({ signalType: "HOLD", reasonCode: "MULTI_DAY_TREND_WEEKEND_CLOSE" });
        const closed = multiDayTrendFixture();
        closed.nowMs = Date.parse("2026-10-17T12:00:00Z");
        expect(evaluateMultiDayTrendEntry(closed).signalType).toBe("HOLD");
    });
});

describe("completed H4 executable-side exit channel", () => {
    test.each(["BUY", "SELL"])("%s uses latest ten completed executable-side extrema including the newest bar", (side) => {
        const fixture = multiDayTrendFixture({ side });
        const newest = fixture.h4.at(-1);
        if (side === "BUY") newest.bid.low = 1.05;
        else newest.ask.high = 1.35;
        const actual = evaluateChannelTrail({ ...fixture, side });
        expect(actual).toMatchObject({ ready: true, stopLossType: "CHANNEL", channelPeriod: 10,
            signalCandleTime: newest.time, takeProfit: null, targetRiskMultiple: null,
            stopLossPrice: side === "BUY" ? 1.05 : 1.35 });
    });

    test.each(["BUY", "SELL"])("%s channel rolls away from an old extreme and ignores a forming tail", (side) => {
        const fixture = multiDayTrendFixture({ side });
        if (side === "BUY") fixture.h4.at(-11).bid.low = 0.5;
        else fixture.h4.at(-11).ask.high = 5;
        const before = evaluateChannelTrail({ ...fixture, side });
        expect(before.ready).toBe(true);
        expect(before.stopLossPrice).toBe(side === "BUY"
            ? Math.min(...fixture.h4.slice(-10).map((c) => c.bid.low))
            : Math.max(...fixture.h4.slice(-10).map((c) => c.ask.high)));
        fixture.h4.push({ time: new Date(fixture.nowMs).toISOString(), complete: false,
            open: 1, close: 1, high: 100, low: 0.01, bid: { low: 0.001 }, ask: { high: 1000 } });
        expect(evaluateChannelTrail({ ...fixture, side })).toEqual(before);
    });

    test.each(["BUY", "SELL"])("%s fails closed on missing or malformed retained side OHLC", (side) => {
        const fixture = multiDayTrendFixture({ side });
        const component = side === "BUY" ? "bid" : "ask";
        fixture.h4.at(-1)[component].high = fixture.h4.at(-1)[component].low - 1;
        expect(evaluateChannelTrail({ ...fixture, side })).toMatchObject({ ready: false,
            reasonCode: "MULTI_DAY_TREND_TRAIL_SIDE_DATA_UNAVAILABLE" });
        delete fixture.h4.at(-1)[component];
        expect(evaluateChannelTrail({ ...fixture, side }).ready).toBe(false);
    });

    test("does not round, clamp, or decide whether a channel stop crossed the current quote", () => {
        const fixture = multiDayTrendFixture();
        fixture.h4.slice(-10).forEach((candle) => { candle.bid.low = 1.098123456; });
        const actual = evaluateChannelTrail({ ...fixture, side: "BUY", currentPrice: 1.09 });
        expect(actual).toMatchObject({ ready: true, stopLossPrice: 1.098123456 });
    });

    test("requires ten bars and a known position side", () => {
        const fixture = multiDayTrendFixture({ count: 9 });
        expect(evaluateChannelTrail({ ...fixture, side: "BUY" })).toMatchObject({ ready: false,
            reasonCode: "MULTI_DAY_TREND_TRAIL_WARMUP" });
        expect(evaluateChannelTrail({ ...fixture, side: "LONG" })).toMatchObject({ ready: false,
            reasonCode: "MULTI_DAY_TREND_INVALID_SIDE" });
    });
});
