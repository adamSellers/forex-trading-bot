const {
    selectLossResetAnchor, lossResetPredicateSignature, lossResetStateKey,
    advanceLossResetState, evaluateLossResetPolicy, calculateH1RegimeHistory,
    emaSeries, sameLossResetDecision,
} = require("../intradayLossResetPolicy");
const { calculateADX } = require("../../utils/indicators");

const HOUR = 3_600_000;
const end = Date.parse("2026-09-29T12:00:00Z");
const instrument = "EUR_USD";
const signature = lossResetPredicateSignature({});

function closedTrade(overrides = {}) {
    const trade = { id: "local-stop", oandaTradeId: "broker-stop", instrument,
        side: "SELL", isOpen: false, mode: "live", exitReason: "STOP_LOSS",
        entryType: "M15_RANGE_BREAKOUT", exitTime: end - 5 * HOUR, ...overrides };
    if (!Object.hasOwn(overrides, "brokerReconciliationPayload")) {
        trade.brokerReconciliationPayload = { close: { trade: {
            id: trade.oandaTradeId, state: "CLOSED", closeTime: new Date(trade.exitTime).toISOString(),
        } } };
    }
    return trade;
}

function observation(closedAt, side, matching) {
    return { closedAt, valid: true,
        longRegime: side === "BUY" && matching,
        shortRegime: side === "SELL" && matching };
}

function candles(side = "BUY", reset = true) {
    return Array.from({ length: 200 }, (_, index) => {
        let close = 1.1 + index * 0.001;
        if (reset && index >= 120 && index < 150) close = 1.22 - (index - 120) * 0.002;
        if (reset && index >= 150) close = 1.16 + (index - 150) * 0.003;
        if (side === "SELL") close = 3 - close;
        return { time: new Date(end - (200 - index) * HOUR).toISOString(),
            open: close, high: close + 0.001, low: close - 0.001, close, complete: true };
    });
}

describe("initial-stop H1 reset evidence", () => {
    test.each(["BUY", "SELL"])("latest normal %s close spans cohorts and ignores opposite/fade trades", (side) => {
        const stop = closedTrade({ side, ownerRunId: "old-run" });
        const opposite = closedTrade({ id: "opposite", side: side === "BUY" ? "SELL" : "BUY", exitTime: end - HOUR });
        const fade = closedTrade({ id: "fade", side, entryType: "M15_POST_TP_FADE", exitTime: end - HOUR });
        expect(selectLossResetAnchor([fade, opposite, stop], instrument, side)).toMatchObject({
            tradeId: stop.id, armed: true, closedAt: stop.exitTime,
        });
        const breakeven = closedTrade({ id: "be", side, exitReason: "BREAKEVEN_STOP", pnlAud: -0.0011, exitTime: end - HOUR });
        expect(selectLossResetAnchor([stop, breakeven], instrument, side)).toMatchObject({ tradeId: "be", armed: false });
    });

    test.each([
        { exitReason: "BREAKEVEN_STOP", pnlAud: -0.0011 },
        { exitReason: "STOP_LOSS", breakevenHit: true },
        { exitReason: "STOP_LOSS", activeStopType: "BREAKEVEN" },
        { exitReason: "STOP_LOSS", activeStopType: "TRAILING" },
        { exitReason: "STOP_LOSS", activeStopType: "PEAK_PROFIT" },
        { exitReason: "TRAILING_STOP" }, { exitReason: "SESSION_CLOSE" }, { exitReason: "TAKE_PROFIT" },
    ])("does not arm for a noninitial-stop result %j", (fields) => {
        expect(evaluateLossResetPolicy({ instrument, side: "SELL", trades: [closedTrade(fields)] }))
            .toMatchObject({ allowed: true, classification: "NO_LOSS_RESET_REQUIRED", state: null });
    });

    test("normal first entry stays eligible, while unavailable history cannot authorize it", () => {
        expect(evaluateLossResetPolicy({ instrument, side: "SELL", trades: [] }).allowed).toBe(true);
        expect(evaluateLossResetPolicy({ instrument, side: "SELL", trades: null }).allowed).toBe(false);
        expect(evaluateLossResetPolicy({ instrument, side: "SELL", historyAvailable: false }).allowed).toBe(false);
    });

    test("unconfirmed local exit time cannot establish the stop reset boundary", () => {
        const trade = closedTrade({ brokerReconciliationPayload: {}, brokerClosedAt: end - HOUR });
        expect(evaluateLossResetPolicy({ instrument, side: "SELL", trades: [trade], nowMs: end }))
            .toMatchObject({ allowed: false, classification: "LOSS_RESET_EVIDENCE_UNAVAILABLE" });
    });

    test.each(["BUY", "SELL"])("requires ordered distinct post-stop H1 bars for %s, not a same-time reset", (side) => {
        const anchor = selectLossResetAnchor([closedTrade({ side })], instrument, side);
        const args = { anchor, predicateSignature: signature, nowMs: end, signalCandleCloseTime: end };
        let state = advanceLossResetState({ ...args, observations: [
            observation(anchor.closedAt, side, false), observation(anchor.closedAt + HOUR, side, true),
        ] });
        expect(state.resetAt).toBeNull();
        state = advanceLossResetState({ ...args, priorState: state, observations: [
            observation(anchor.closedAt + 2 * HOUR, side, false),
            observation(anchor.closedAt + 2 * HOUR, side, true),
        ] });
        expect(state).toMatchObject({ resetAt: anchor.closedAt + 2 * HOUR, rearmedAt: null });
        state = advanceLossResetState({ ...args, priorState: state,
            observations: [observation(anchor.closedAt + 3 * HOUR, side, true)] });
        expect(state.rearmedAt).toBe(anchor.closedAt + 3 * HOUR);
    });

    test("missing, incomplete, future and malformed observations do not create neutrality", () => {
        const anchor = selectLossResetAnchor([closedTrade()], instrument, "SELL");
        const state = advanceLossResetState({ anchor, predicateSignature: signature, nowMs: end,
            signalCandleCloseTime: end, observations: [
                { closedAt: end - HOUR, valid: false, shortRegime: false, longRegime: false },
                { closedAt: end - HOUR, valid: true }, observation(end + HOUR, "SELL", false),
                observation(end, "SELL", true),
            ] });
        expect(state.resetAt).toBeNull();
        expect(advanceLossResetState({ anchor: null, predicateSignature: signature, nowMs: end })).toBeNull();
    });

    test.each(["BUY", "SELL"])("actual shared indicator history rearms %s and matches every prefix calculation", (side) => {
        const h1Candles = candles(side);
        const trade = closedTrade({ side, exitTime: end - 82 * HOUR });
        const observations = calculateH1RegimeHistory({ h1Candles, nowMs: end });
        for (const sample of observations) {
            const prefix = h1Candles.filter((bar) => Date.parse(bar.time) + HOUR <= sample.closedAt);
            const closes = prefix.map((bar) => bar.close);
            const fast = emaSeries(closes, 20).at(-1);
            const slow = emaSeries(closes, 50).at(-1);
            const adx = calculateADX(prefix.map((bar) => bar.high), prefix.map((bar) => bar.low), closes, 14).at(-1);
            expect(sample).toMatchObject({ fastEma: fast, slowEma: slow, adx: adx.adx, pdi: adx.pdi, mdi: adx.mdi,
                longRegime: closes.at(-1) > fast && fast > slow && adx.pdi > adx.mdi && adx.adx >= 20,
                shortRegime: closes.at(-1) < fast && fast < slow && adx.mdi > adx.pdi && adx.adx >= 20 });
        }
        const decision = evaluateLossResetPolicy({ instrument, side, trades: [trade], h1Candles,
            nowMs: end, signalCandleCloseTime: end });
        expect(decision).toMatchObject({ allowed: true, classification: "H1_RESET_REARMED" });
        expect(decision.state.resetAt).toBeGreaterThan(trade.exitTime);
        expect(decision.state.rearmedAt).toBeGreaterThan(decision.state.resetAt);
    });

    test("a continuous valid trend stays blocked and short warmup/invalid bars cannot invent a reset", () => {
        const h1Candles = candles("SELL", false);
        const args = { instrument, side: "SELL", trades: [closedTrade()], nowMs: end, signalCandleCloseTime: end };
        expect(evaluateLossResetPolicy({ ...args, h1Candles })).toMatchObject({ allowed: false, classification: "WAIT_FOR_H1_RESET" });
        for (const invalid of [h1Candles.slice(-20), [], h1Candles.map((bar) => ({ ...bar, complete: false })),
            h1Candles.map((bar) => ({ ...bar, high: NaN }))]) {
            expect(evaluateLossResetPolicy({ ...args, h1Candles: invalid })).toMatchObject({
                allowed: false, classification: "LOSS_RESET_EVIDENCE_UNAVAILABLE", state: { resetAt: null },
            });
        }
    });

    test("saved proof survives cache rollover, but cannot authorize an earlier signal or a new stop/config", () => {
        const h1Candles = candles("SELL");
        const trade = closedTrade({ exitTime: end - 82 * HOUR });
        const args = { instrument, side: "SELL", trades: [trade], nowMs: end, signalCandleCloseTime: end };
        const original = evaluateLossResetPolicy({ ...args, h1Candles });
        expect(original.allowed).toBe(true);
        const restored = evaluateLossResetPolicy({ ...args, h1Candles: candles("SELL", false), priorState: original.state });
        expect(restored.allowed).toBe(true);
        expect(sameLossResetDecision(original, restored)).toBe(true);
        expect(evaluateLossResetPolicy({ ...args, h1Candles, priorState: original.state,
            signalCandleCloseTime: original.state.rearmedAt - 1 }).allowed).toBe(false);
        expect(evaluateLossResetPolicy({ ...args, h1Candles: candles("SELL", false), priorState: original.state,
            config: { intradayMinAdx: 21 } }).allowed).toBe(false);
        expect(evaluateLossResetPolicy({ ...args, h1Candles: candles("SELL", false), priorState: original.state,
            trades: [closedTrade({ id: "new-stop", oandaTradeId: "new-broker" })] }).allowed).toBe(false);
        expect(evaluateLossResetPolicy({ ...args, h1Candles: [], priorState: original.state }).allowed).toBe(false);
        const badLatest = candles("SELL", false); badLatest.at(-1).close = NaN;
        expect(evaluateLossResetPolicy({ ...args, h1Candles: badLatest, priorState: original.state }).allowed).toBe(false);
    });

    test("missing M15 retains observed reset proof but does not authorize an entry", () => {
        const result = evaluateLossResetPolicy({ instrument, side: "SELL", trades: [closedTrade({ exitTime: end - 82 * HOUR })],
            h1Candles: candles("SELL"), nowMs: end });
        expect(result.allowed).toBe(false);
        expect(Number.isFinite(result.state.rearmedAt)).toBe(true);
    });

    test("M15 may complete with the requalifying H1 bar; later H1 evidence cannot authorize an older signal", () => {
        const args = { instrument, side: "SELL", trades: [closedTrade({ exitTime: end - 82 * HOUR })],
            h1Candles: candles("SELL"), nowMs: end, signalCandleCloseTime: end };
        const original = evaluateLossResetPolicy(args);
        const rearmedAt = original.state.rearmedAt;
        expect(evaluateLossResetPolicy({ ...args, nowMs: rearmedAt, signalCandleCloseTime: rearmedAt }))
            .toMatchObject({ allowed: true, state: { rearmedAt } });
        expect(evaluateLossResetPolicy({ ...args, signalCandleCloseTime: rearmedAt - 15 * 60_000 }))
            .toMatchObject({ allowed: false, state: { rearmedAt: null } });
        expect(evaluateLossResetPolicy({ ...args, nowMs: rearmedAt - 1, signalCandleCloseTime: rearmedAt }))
            .toMatchObject({ allowed: false, state: { rearmedAt: null } });
    });

    test("corrupt or unbound durable proof cannot authorize a continuously matching trend", () => {
        const args = { instrument, side: "SELL", trades: [closedTrade()], nowMs: end,
            signalCandleCloseTime: end, h1Candles: candles("SELL", false) };
        const baseline = evaluateLossResetPolicy(args);
        for (const priorState of [
            { ...baseline.state, resetAt: baseline.anchor.closedAt, rearmedAt: end },
            { ...baseline.state, resetAt: end, rearmedAt: end },
            { ...baseline.state, resetAt: end - HOUR, rearmedAt: end, lastObservedCloseAt: end + HOUR },
            { ...baseline.state, version: 2, resetAt: end - HOUR, rearmedAt: end },
            { ...baseline.state, anchor: { ...baseline.anchor, closedAt: end - 6 * HOUR }, resetAt: end - HOUR, rearmedAt: end },
        ]) {
            expect(evaluateLossResetPolicy({ ...args, priorState })).toMatchObject({
                allowed: false, classification: "WAIT_FOR_H1_RESET", state: { resetAt: null, rearmedAt: null },
            });
        }
    });

    test("state keys isolate side, stop and regime configuration", () => {
        const anchor = selectLossResetAnchor([closedTrade()], instrument, "SELL");
        const args = { instrument, side: "SELL", anchor };
        const key = lossResetStateKey(args);
        expect(lossResetStateKey({ ...args, anchor: { ...anchor, brokerTradeId: "another" } })).not.toBe(key);
        expect(lossResetStateKey({ ...args, side: "BUY" })).not.toBe(key);
        expect(lossResetStateKey({ ...args, config: { intradayMinAdx: 21 } })).not.toBe(key);
        expect(lossResetStateKey({ ...args, config: { riskPerTrade: 0.001 } })).toBe(key);
    });
});
