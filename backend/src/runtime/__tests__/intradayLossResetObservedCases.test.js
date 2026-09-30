const retained = require("../../../../docs/reviews/evidence/2026-09-30/repeated-usdjpy.json");
const {
    evaluateLossResetPolicy,
    advanceLossResetState,
    evaluateH1Regime,
    selectLossResetAnchor,
    lossResetPredicateSignature,
} = require("../intradayLossResetPolicy");

const HOUR = 60 * 60_000;
const M15 = 15 * 60_000;
const instrument = "USD_JPY";
const side = "SELL";
const config = retained.trades.find((trade) => trade.brokerTradeId === "3475").configuredThresholds;

// This fixture replays saved evaluated H1 observations through the shared reset
// transition. It does not recreate historical candles, orders, alternate fills,
// portfolio exposure or returns. The source capture has H1 indicator values but
// no H1 candle timestamp/OHLC history, so use only observations whose M15 close
// falls on an hourly boundary, was observed within that same hour, and has the
// same H1/M15 closing price. That excludes a retained previous-hour H1 context
// at an hourly refresh boundary. Repeated M15 evaluations cannot become extra
// H1 reset transitions.
function hourlyObservationsBefore(entry) {
    const cutoff = Date.parse(entry.signalCloseAEST);
    const observedBy = Date.parse(entry.entryAEST);
    const hourly = new Map();
    for (const observation of retained.signalObservations) {
        const closedAt = observation.signal_candle_time + M15;
        if (!observation.h1 || closedAt % HOUR !== 0 || closedAt > cutoff ||
            observation.timestamp > observedBy || observation.timestamp < closedAt ||
            observation.timestamp >= closedAt + HOUR ||
            observation.h1.close !== observation.m15?.close) continue;
        const h1 = observation.h1;
        const previous = hourly.get(closedAt);
        if (previous) {
            expect(previous.longRegime).toBe(h1.longRegime);
            expect(previous.shortRegime).toBe(h1.shortRegime);
            continue;
        }
        hourly.set(closedAt, {
            closedAt,
            valid: true,
            longRegime: h1.longRegime,
            shortRegime: h1.shortRegime,
        });
    }
    return [...hourly.values()].sort((left, right) => left.closedAt - right.closedAt);
}

function closedTrade(brokerTradeId) {
    const analysis = retained.trades.find((trade) => trade.brokerTradeId === brokerTradeId);
    const broker = retained.brokerTrades.find(({ trade }) => trade.id === brokerTradeId).trade;
    return {
        id: `observed-${brokerTradeId}`,
        oandaTradeId: brokerTradeId,
        instrument,
        side,
        mode: "live",
        isOpen: false,
        entryType: analysis.entryType,
        exitReason: analysis.exitReason,
        // Use retained broker truth; the human-readable summary rounds broker
        // nanosecond timestamps to milliseconds and is not close-time proof.
        brokerReconciliationPayload: { close: { trade: broker } },
    };
}

describe("retained September 2026 USD/JPY evaluated-observation cases", () => {
    test("saved H1 eligibility matches the complete configured directional predicate", () => {
        const observations = retained.signalObservations.filter(({ h1 }) => h1);
        expect(observations).toHaveLength(161);
        for (const { h1 } of observations) {
            expect(evaluateH1Regime({ ...h1, minimumAdx: config.intradayMinAdx }))
                .toMatchObject({ valid: true, longRegime: h1.longRegime, shortRegime: h1.shortRegime });
        }
    });

    test.each([
        ["3455", "3445", true, "2026-09-28T01:00:00Z", "2026-09-28T07:00:00Z"],
        ["3465", "3455", false, null, null],
        ["3475", "3465", true, "2026-09-28T15:00:00Z", "2026-09-28T17:00:00Z"],
    ])("recorded candidate %s after %s has reset eligibility %s", (tradeId, priorTradeId, eligible, reset, rearmed) => {
        const entry = retained.trades.find((trade) => trade.brokerTradeId === tradeId);
        const anchor = selectLossResetAnchor([closedTrade(priorTradeId)], instrument, side);
        const signalCandleCloseTime = Date.parse(entry.signalCloseAEST);
        expect(anchor).toMatchObject({ brokerTradeId: priorTradeId, armed: true, exitReason: "STOP_LOSS" });
        const observations = hourlyObservationsBefore(entry);
        expect(observations.length).toBeGreaterThan(0);
        expect(new Set(observations.map(({ closedAt }) => closedAt)).size).toBe(observations.length);
        const state = advanceLossResetState({
            anchor,
            predicateSignature: lossResetPredicateSignature(config),
            observations,
            nowMs: Date.parse(entry.entryAEST),
            signalCandleCloseTime,
        });
        expect(state.resetAt).toBe(reset === null ? null : Date.parse(reset));
        expect(state.rearmedAt).toBe(rearmed === null ? null : Date.parse(rearmed));
        // Eligibility here is conditional on the saved normal entry already
        // qualifying. The full candle/runtime path has separate integration
        // coverage; this fixture makes no alternate-execution/P&L claim.
        expect(entry.h1.shortRegime).toBe(true);
        const completedResetBeforeCandidate = state.rearmedAt !== null &&
            state.rearmedAt <= signalCandleCloseTime;
        expect(completedResetBeforeCandidate).toBe(eligible);
        if (eligible) {
            expect(state.resetAt).toBeGreaterThan(anchor.closedAt);
            expect(state.rearmedAt).toBeGreaterThan(state.resetAt);
        } else {
            expect(observations.filter(({ closedAt }) => closedAt > anchor.closedAt)
                .every(({ shortRegime }) => shortRegime)).toBe(true);
        }
    });

    test("3475's broker-confirmed breakeven close does not arm another loss reset", () => {
        const entry = retained.trades.find((trade) => trade.brokerTradeId === "3475");
        expect(entry.exitReason).toBe("BREAKEVEN_STOP");
        expect(entry.mfeR).toBeGreaterThan(1);
        expect(entry.pnlAud).toBeLessThan(0);
        expect(entry.brokerStopOrder.price).toBe(entry.brokerTradeClose.price);
        const trades = ["3445", "3455", "3465", "3475"].map(closedTrade);
        expect(evaluateLossResetPolicy({
            instrument, side, trades, config,
            nowMs: Date.parse("2026-09-29T12:30:00Z"),
            signalCandleCloseTime: Date.parse("2026-09-29T12:30:00Z"),
        })).toMatchObject({
            allowed: true,
            classification: "NO_LOSS_RESET_REQUIRED",
            anchor: { brokerTradeId: "3475", armed: false, exitReason: "BREAKEVEN_STOP" },
            state: null,
        });
    });
});
