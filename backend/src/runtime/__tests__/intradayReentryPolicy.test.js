const {
    evaluateReentryPolicy, latestClosedTradeForInstrument, sameReentryDecision, FADE_ENTRY_TYPE, confirmedCloseTime,
} = require("../intradayReentryPolicy");

const end = Date.parse("2026-09-23T14:30:00Z");
function brokerTrade(overrides = {}) {
    const trade = {
    id: "normal-3381", oandaTradeId: "3381", instrument: "EUR_USD", mode: "live",
    isOpen: false, side: "SELL", exitReason: "TAKE_PROFIT", brokerClosedAt: end - 167120, ...overrides,
    };
    trade.brokerReconciliationPayload = { close: { trade: { id: trade.oandaTradeId, state: "CLOSED",
        closeTime: new Date(trade.brokerClosedAt).toISOString() } } };
    return trade;
}
const parent = brokerTrade();
const bars = [4, 3, 2, 1].map((i) => ({
    time: new Date(end - (i + 1) * 900_000).toISOString(), high: 1.14, low: 1.138,
}));
const args = { originalSide: "SELL", latestClosedTrade: parent,
    pullbackWindow: bars, signalFastEma: 1.139, signalCandleTime: end - 900_000 };

describe("protected-exit episodes", () => {
    test.each(["BUY", "SELL"])("reverses only an otherwise-valid %s repeat after TP", (side) => {
        const decision = evaluateReentryPolicy({ ...args, originalSide: side,
            latestClosedTrade: brokerTrade({ side }) });
        expect(decision).toMatchObject({ classification: "POST_TP_FADE", allowed: true,
            originalSide: side, executedSide: side === "BUY" ? "SELL" : "BUY", freshTouch: false });
    });

    test("requires a fully post-exit prior candle, including exact boundary semantics", () => {
        const touchStart = Date.parse(bars.at(-1).time);
        const touching = { ...args, latestClosedTrade: brokerTrade({ brokerClosedAt: touchStart }) };
        expect(evaluateReentryPolicy(touching)).toMatchObject({ classification: "FRESH_CONTINUATION" });
        expect(evaluateReentryPolicy({ ...touching,
            latestClosedTrade: brokerTrade({ brokerClosedAt: touchStart + 1 }) }))
            .toMatchObject({ classification: "POST_TP_FADE" });
        expect(evaluateReentryPolicy({ ...touching, pullbackWindow: [
            { ...bars.at(-1), time: new Date(end - 900_000).toISOString() },
        ] })).toMatchObject({ classification: "POST_TP_FADE" });
    });

    test("BE without freshness waits; fresh BE, opposite and unprotected exits retain normal entries", () => {
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: { ...parent, exitReason: "BREAKEVEN_STOP" } }))
            .toMatchObject({ allowed: false, classification: "WAIT_FOR_FRESH_PULLBACK" });
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: brokerTrade({
            exitReason: "BREAKEVEN_STOP", brokerClosedAt: end - 6 * 900_000 }) }))
            .toMatchObject({ allowed: true, classification: "FRESH_CONTINUATION" });
        for (const exitReason of ["STOP_LOSS", "SESSION_CLOSE", "MANUAL"]) {
            expect(evaluateReentryPolicy({ ...args, latestClosedTrade: { ...parent, exitReason } }))
                .toMatchObject({ allowed: true, classification: "NORMAL", executedSide: "SELL" });
        }
        expect(evaluateReentryPolicy({ ...args, originalSide: "BUY" }))
            .toMatchObject({ allowed: true, classification: "NORMAL", executedSide: "BUY" });
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: null }))
            .toMatchObject({ allowed: true, classification: "NORMAL" });
    });

    test.each(["TAKE_PROFIT", "BREAKEVEN_STOP", "STOP_LOSS"])("a closed fade's %s cannot rearm or erase its parent", (exitReason) => {
        const provenance = evaluateReentryPolicy(args);
        const fade = { ...parent, id: "fade", side: "BUY", brokerClosedAt: end, exitReason,
            entryType: FADE_ENTRY_TYPE, brokerReconciliationPayload: {
                liveRuntime: { entryTelemetry: { strategyContext: { reentry: provenance } } },
            } };
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: fade }))
            .toMatchObject({ allowed: false, classification: "FADE_ALREADY_TAKEN", anchor: provenance.anchor });
        const freshBars = [ { time: new Date(end + 900_000).toISOString(), high: 1.14, low: 1.138 } ];
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: fade, pullbackWindow: freshBars,
            signalCandleTime: end + 2 * 900_000 }))
            .toMatchObject({ allowed: true, classification: "FRESH_CONTINUATION", executedSide: "SELL" });
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: fade, originalSide: "BUY" }))
            .toMatchObject({ allowed: true, classification: "NORMAL", executedSide: "BUY" });
    });

    test("missing fade provenance/history prevents accidental fresh authorization", () => {
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: { ...parent, entryType: FADE_ENTRY_TYPE } }))
            .toMatchObject({ allowed: false, classification: "HISTORY_UNAVAILABLE" });
        expect(evaluateReentryPolicy({ ...args, historyAvailable: false }))
            .toMatchObject({ allowed: false, classification: "HISTORY_UNAVAILABLE" });
    });

    test("latest broker close is pair-specific, survives releases, and ignores local/unconfirmed/open records", () => {
        const later = brokerTrade({ id: "later", brokerClosedAt: end - 1, runId: "old-run" });
        const rows = [later, parent, { ...later, id: "open", isOpen: true },
            { ...later, id: "local", oandaTradeId: null, brokerClosedAt: null, exitTime: end },
            { ...later, id: "other", instrument: "AUD_USD", brokerClosedAt: end }];
        expect(latestClosedTradeForInstrument(rows, "EUR_USD", end)).toEqual(later);
        expect(latestClosedTradeForInstrument(rows, "GBP_USD", end)).toBeNull();
        expect(() => latestClosedTradeForInstrument(null, "EUR_USD", end)).toThrow();
    });

    test("revalidation detects changed anchors even when the new decision has the same direction", () => {
        const before = evaluateReentryPolicy(args);
        expect(sameReentryDecision(before, evaluateReentryPolicy(args))).toBe(true);
        const after = evaluateReentryPolicy({ ...args, latestClosedTrade: { ...parent, id: "another" } });
        expect(sameReentryDecision(before, after)).toBe(false);
    });

    test("a candle already completed at the TP cannot be reused as a new fade signal", () => {
        expect(evaluateReentryPolicy({ ...args,
            latestClosedTrade: brokerTrade({ brokerClosedAt: end }) }))
            .toMatchObject({ allowed: false, classification: "WAIT_FOR_POST_EXIT_SIGNAL" });
        expect(evaluateReentryPolicy({ ...args,
            latestClosedTrade: brokerTrade({ brokerClosedAt: end - 1 }) }))
            .toMatchObject({ allowed: true, classification: "POST_TP_FADE" });
    });

    test("fallback observation times cannot authorize freshness or a fade", () => {
        const unproven = { ...parent, brokerReconciliationPayload: {}, exitTime: end - 1,
            brokerClosedAt: end - 1 };
        expect(confirmedCloseTime(unproven)).toBeNull();
        expect(latestClosedTradeForInstrument([parent, unproven], "EUR_USD")).toBe(unproven);
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: unproven }))
            .toMatchObject({ allowed: false, classification: "FRESHNESS_UNAVAILABLE" });
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: unproven, originalSide: "BUY" }))
            .toMatchObject({ allowed: true, classification: "NORMAL" });
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: { ...unproven, exitReason: "STOP_LOSS" } }))
            .toMatchObject({ allowed: true, classification: "NORMAL" });
    });

    test("proven broker close overrides a later observation timestamp, including legacy UNIX responses", () => {
        const trade = brokerTrade({ brokerClosedAt: end - 30_000 });
        trade.brokerClosedAt = end + 300_000;
        trade.brokerReconciliationPayload.close.trade.closeTime = String((end - 30_000) / 1000);
        expect(confirmedCloseTime(trade)).toBe(end - 30_000);
        expect(evaluateReentryPolicy({ ...args, latestClosedTrade: trade }).anchor.closedAt).toBe(end - 30_000);
        trade.brokerReconciliationPayload.close.trade.id = "different-trade";
        expect(confirmedCloseTime(trade)).toBeNull();
    });
});
