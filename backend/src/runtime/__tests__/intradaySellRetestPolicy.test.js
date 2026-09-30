const {
    evaluateIntradaySellRetest, consumedSellRetestPatternIds,
} = require("../intradaySellRetestPolicy");

const PERIOD = 900_000;
const START = Date.parse("2026-08-10T07:00:00Z");

function bar(index, prices = {}) {
    const mid = { open: 1.1010, high: 1.1015, low: 1.1000, close: 1.1008, ...prices };
    return { time: new Date(START + index * PERIOD).toISOString(), ...mid,
        ask: Object.fromEntries(Object.entries(mid).map(([key, value]) => [key, Number((value + 0.00004).toFixed(5))])) };
}

function fixture() {
    const range = Array.from({ length: 8 }, (_, index) => bar(index));
    return [...range,
        bar(8, { open: 1.1003, high: 1.1004, low: 1.0994, close: 1.0995 }),
        bar(9, { open: 1.0996, high: 1.1002, low: 1.0995, close: 1.0997 }),
        bar(10, { open: 1.0996, high: 1.0999, low: 1.0990, close: 1.0992 })];
}

function evaluate(candles, options = {}) {
    return evaluateIntradaySellRetest({ instrument: "EUR_USD", candles,
        nowMs: Date.parse(candles.at(-1).time) + PERIOD, ...options });
}

describe("completed M15 SELL break/retest/rejection policy", () => {
    test("requires three distinct candles and freezes the eight-bar boundary", () => {
        const candles = fixture();
        const broken = evaluate(candles.slice(0, -2));
        expect(broken).toMatchObject({ ready: false, classification: "WAIT_FOR_RETEST",
            breakout: { level: 1.1000 }, retest: null });
        const retested = evaluate(candles.slice(0, -1));
        expect(retested).toMatchObject({ ready: false, classification: "WAIT_FOR_REJECTION",
            breakout: { level: 1.1000 }, retest: { low: 1.0995, askHigh: 1.10024 } });
        const confirmed = evaluate(candles);
        expect(confirmed).toMatchObject({ ready: true, classification: "CONFIRMED",
            structuralStopLossPrice: 1.10025, confirmation: { time: candles.at(-1).time } });
        expect(confirmed.patternId).toContain("EUR_USD");
    });

    test("a later touch updates the retest low and requires another distinct candle", () => {
        const candles = fixture();
        candles[10] = bar(10, { open: 1.0998, high: 1.1001, low: 1.0991, close: 1.0992 });
        const retouched = evaluate(candles);
        expect(retouched).toMatchObject({ ready: false, retest: { low: 1.0991, time: candles[10].time, askHigh: 1.10024 } });
        candles.push(bar(11, { open: 1.0993, high: 1.0998, low: 1.0988, close: 1.0990 }));
        expect(evaluate(candles)).toMatchObject({ ready: true, structuralStopLossPrice: 1.10025 });
    });

    test("the complete ask high includes intervening and confirmation candles", () => {
        const candles = fixture();
        candles[10].ask.high = 1.10040;
        expect(evaluate(candles)).toMatchObject({ ready: true, structuralStopLossPrice: 1.10041,
            retest: { askHigh: 1.10040 } });
    });

    test.each([1.1000, 1.1001])("a close %s at/above the frozen level cancels the episode", (close) => {
        const candles = fixture();
        candles[10] = bar(10, { open: 1.0995, high: 1.1002, low: 1.0990, close });
        expect(evaluate(candles)).toMatchObject({ ready: false, classification: "BREAK_CANCELLED", breakout: null });
    });

    test("a bullish candle below the retest low cannot confirm", () => {
        const candles = fixture();
        candles[10].open = 1.0991;
        expect(evaluate(candles)).toMatchObject({ ready: false, classification: "WAIT_FOR_REJECTION" });
    });

    test.each([9, 10])("missing ask on episode candle %s waits without midpoint substitution", (index) => {
        const candles = fixture();
        delete candles[index].ask;
        expect(evaluate(candles)).toMatchObject({ ready: false, classification: "ASK_EVIDENCE_UNAVAILABLE",
            structuralStopLossPrice: null, breakout: { level: 1.1000 } });
    });

    test("a normal broker refresh can restore ask evidence on the same confirmation", () => {
        const candles = fixture();
        const complete = structuredClone(candles);
        delete candles[9].ask;
        const missing = evaluate(candles);
        expect(evaluate(complete, { priorState: missing.state })).toMatchObject({ ready: true,
            structuralStopLossPrice: 1.10025, patternId: missing.patternId });
        expect(missing.state.askEvidenceAvailable).toBe(false);
    });

    test("same confirmation can retry locally but a persisted filled pattern cannot repeat", () => {
        const candles = fixture();
        const first = evaluate(candles);
        expect(evaluate(candles, { priorState: first.state })).toMatchObject({ ready: true, patternId: first.patternId });
        expect(evaluate(candles, { priorState: first.state, consumedPatternIds: [first.patternId] }))
            .toMatchObject({ ready: false, classification: "PATTERN_ALREADY_TRADED" });
    });

    test("the next completed bar cannot reuse a prior confirmation", () => {
        const candles = fixture();
        const prior = evaluate(candles);
        candles.push(bar(11, { open: 1.0992, high: 1.0994, low: 1.0990, close: 1.0993 }));
        expect(evaluate(candles, { priorState: prior.state })).toMatchObject({ ready: false,
            confirmation: null, patternId: null });
    });

    test("cache rollover and a restart retain the original breakout level", () => {
        const candles = fixture();
        const armed = evaluate(candles.slice(0, 9));
        const result = evaluate(candles.slice(8), { priorState: JSON.parse(JSON.stringify(armed.state)) });
        expect(result).toMatchObject({ ready: true, breakout: { level: 1.1000 }, structuralStopLossPrice: 1.10025 });
        expect(armed.state.retest).toBeNull();
    });

    test("a persisted empty startup cache recovers on the first complete broker history", () => {
        const candles = fixture();
        const empty = evaluateIntradaySellRetest({ instrument: "EUR_USD", candles: [], nowMs: START });
        expect(empty.state.lastProcessedCandleCloseTime).toBeNull();
        expect(evaluate(candles, { priorState: JSON.parse(JSON.stringify(empty.state)) }))
            .toMatchObject({ ready: true, classification: "CONFIRMED", structuralStopLossPrice: 1.10025 });
    });

    test("an open-market gap cannot bridge the frozen pattern", () => {
        const candles = fixture();
        const armed = evaluate(candles.slice(0, 9));
        const later = candles.slice(9).map((candle) => ({ ...candle,
            time: new Date(Date.parse(candle.time) + PERIOD).toISOString() }));
        expect(evaluate(later, { priorState: armed.state }).ready).toBe(false);
    });

    test.each(["future", "incomplete", "duplicate", "invalid prices", "stale"])("%s evidence never authorizes entry", (kind) => {
        const candles = fixture();
        const options = {};
        if (kind === "future") options.nowMs = Date.parse(candles[10].time);
        if (kind === "incomplete") candles[10].complete = false;
        if (kind === "duplicate") candles[10].time = candles[9].time;
        if (kind === "invalid prices") candles[9].low = 2;
        if (kind === "stale") options.nowMs = Date.parse(candles[10].time) + 3 * PERIOD;
        expect(evaluate(candles, options).ready).toBe(false);
    });

    test("JPY structural stops use one broker price tick", () => {
        const candles = fixture().map((candle) => ({ ...candle,
            ...Object.fromEntries(["open", "high", "low", "close"].map((key) => [key, candle[key] * 100])),
            ask: Object.fromEntries(Object.entries(candle.ask).map(([key, value]) => [key, value * 100])) }));
        expect(evaluate(candles, { instrument: "USD_JPY" }).structuralStopLossPrice).toBe(110.025);
    });

    test("broker-confirmed trade telemetry identifies consumed patterns across newer opposite closes", () => {
        const pattern = evaluate(fixture()).patternId;
        const trade = { instrument: "EUR_USD", side: "SELL", oandaTradeId: "1",
            brokerReconciliationPayload: { liveRuntime: { entryTelemetry: { strategyContext: { sellRetest: { patternId: pattern } } } } } };
        expect(consumedSellRetestPatternIds([trade, { ...trade, instrument: "GBP_USD" }, { ...trade, side: "BUY" }], "EUR_USD"))
            .toEqual([pattern]);
    });
});
