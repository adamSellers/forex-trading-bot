const crypto = require("crypto");
const { calculateADX } = require("../utils/indicators");
const { confirmedCloseTime, isFadeTrade } = require("./intradayReentryPolicy");

const LOSS_RESET_POLICY_VERSION = 1;
const LOSS_RESET_STRATEGY_VERSION = "1.2.2";
const LOSS_RESET_STRATEGY_VERSIONS = Object.freeze([LOSS_RESET_STRATEGY_VERSION, "1.3.0", "1.4.0"]);
const HOUR_MS = 60 * 60_000;

function finite(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function periods(config = {}) {
    const fast = Math.max(2, Math.floor(finite(config.intradayFastEmaPeriod, 20)));
    return {
        fast,
        slow: Math.max(fast + 1, Math.floor(finite(config.intradaySlowEmaPeriod, 50))),
        adx: Math.max(2, Math.floor(finite(config.intradayAdxPeriod, 14))),
        minimumAdx: Math.max(0, finite(config.intradayMinAdx, 20)),
    };
}

// Shared with the entry strategy so historical and current H1 regimes use the
// same seed, recurrence, indicator periods and directional predicate.
function emaSeries(values = [], period = 20) {
    const resolvedPeriod = Math.max(2, Math.floor(finite(period, 20)));
    if (values.length < resolvedPeriod) return [];
    const results = Array(values.length).fill(null);
    let current = values.slice(0, resolvedPeriod).reduce((sum, value) => sum + value, 0) / resolvedPeriod;
    results[resolvedPeriod - 1] = current;
    const multiplier = 2 / (resolvedPeriod + 1);
    for (let index = resolvedPeriod; index < values.length; index += 1) {
        current = values[index] * multiplier + current * (1 - multiplier);
        results[index] = current;
    }
    return results;
}

function evaluateH1Regime({ close, fastEma, slowEma, adx, pdi, mdi, minimumAdx }) {
    const valid = [close, fastEma, slowEma, adx, pdi, mdi, minimumAdx].every(Number.isFinite);
    const longStructure = valid && close > fastEma && fastEma > slowEma && pdi > mdi;
    const shortStructure = valid && close < fastEma && fastEma < slowEma && mdi > pdi;
    return {
        valid, close, fastEma, slowEma, adx, pdi, mdi,
        longStructure, shortStructure,
        longRegime: longStructure && adx >= minimumAdx,
        shortRegime: shortStructure && adx >= minimumAdx,
    };
}

function lossResetPredicateSignature(config = {}) {
    return crypto.createHash("sha256").update(JSON.stringify({
        version: LOSS_RESET_POLICY_VERSION, ...periods(config),
    })).digest("hex").slice(0, 20);
}

function selectLossResetAnchor(trades, instrument, side) {
    if (!Array.isArray(trades)) return null;
    const latest = trades.filter((trade) => trade.instrument === instrument && trade.side === side &&
        trade.isOpen === false && (!trade.mode || trade.mode === "live") &&
        trade.oandaTradeId && !isFadeTrade(trade))
        .sort((left, right) =>
            (confirmedCloseTime(right) ?? finite(right.brokerClosedAt, finite(right.exitTime, 0))) -
            (confirmedCloseTime(left) ?? finite(left.brokerClosedAt, finite(left.exitTime, 0))) ||
            String(right.id).localeCompare(String(left.id)))[0];
    if (!latest) return null;
    const activeStopType = String(latest.activeStopType || "").toUpperCase();
    return {
        tradeId: latest.id,
        brokerTradeId: String(latest.oandaTradeId),
        instrument, side,
        exitReason: latest.exitReason,
        closedAt: confirmedCloseTime(latest),
        armed: latest.exitReason === "STOP_LOSS" && !latest.breakevenHit &&
            !["BREAKEVEN", "TRAILING", "PEAK_PROFIT"].includes(activeStopType),
    };
}

function lossResetStateKey({ instrument, side, anchor, config = {} }) {
    if (!anchor?.armed || !anchor.brokerTradeId) return null;
    return `intraday-loss-reset:v${LOSS_RESET_POLICY_VERSION}:${instrument}:${side}:${anchor.brokerTradeId}:${lossResetPredicateSignature(config)}`;
}

function sameAnchor(left, right) {
    return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function candleStart(candle) {
    return typeof candle?.time === "number" ? candle.time : Date.parse(candle?.time);
}

function calculateH1RegimeHistory({ h1Candles = [], config = {}, nowMs = Date.now(), signalCandleCloseTime = null } = {}) {
    if (!Array.isArray(h1Candles) || !Number.isFinite(nowMs)) return [];
    const { fast, slow, adx, minimumAdx } = periods(config);
    const minimumH1 = Math.max(slow + 5, adx * 2 + 5);
    const cutoff = Number.isFinite(signalCandleCloseTime) ? Math.min(nowMs, signalCandleCloseTime) : nowMs;
    const observations = [];
    let segment = [];
    let previousStart = null;
    const flush = () => {
        if (segment.length < minimumH1) { segment = []; return; }
        const closes = segment.map((candle) => candle.close);
        const fastValues = emaSeries(closes, fast);
        const slowValues = emaSeries(closes, slow);
        const adxValues = calculateADX(segment.map((candle) => candle.high), segment.map((candle) => candle.low), closes, adx);
        const adxOffset = segment.length - adxValues.length;
        for (let index = minimumH1 - 1; index < segment.length; index += 1) {
            const indicator = adxValues[index - adxOffset];
            const regime = evaluateH1Regime({
                close: closes[index], fastEma: fastValues[index], slowEma: slowValues[index],
                adx: indicator?.adx, pdi: indicator?.pdi, mdi: indicator?.mdi, minimumAdx,
            });
            if (regime.valid) observations.push({ closedAt: candleStart(segment[index]) + HOUR_MS, ...regime });
        }
        segment = [];
    };
    for (const candle of h1Candles) {
        const start = candleStart(candle);
        const priceValues = [candle?.open, candle?.high, candle?.low, candle?.close];
        const valid = Number.isFinite(start) && (previousStart === null || start > previousStart) &&
            candle.complete !== false && start + HOUR_MS <= cutoff &&
            priceValues.every((value) => Number.isFinite(value) && value > 0) &&
            candle.high >= Math.max(candle.open, candle.close, candle.low) &&
            candle.low <= Math.min(candle.open, candle.close, candle.high);
        if (!valid) {
            // Never bridge missing/invalid indicator inputs or reinterpret an
            // incomplete bar as a neutral regime. Later data must warm up anew.
            flush();
            previousStart = Number.isFinite(start) ? start : previousStart;
            continue;
        }
        segment.push(candle);
        previousStart = start;
    }
    flush();
    return observations;
}

function validPriorState(prior, anchor, signature, nowMs) {
    if (prior?.version !== LOSS_RESET_POLICY_VERSION || !sameAnchor(prior.anchor, anchor) ||
        prior.predicateSignature !== signature) return false;
    const { resetAt, rearmedAt, lastObservedCloseAt } = prior;
    if (lastObservedCloseAt !== null && (!Number.isFinite(lastObservedCloseAt) ||
        lastObservedCloseAt <= anchor.closedAt || lastObservedCloseAt > nowMs)) return false;
    if (resetAt !== null && (!Number.isFinite(resetAt) || resetAt <= anchor.closedAt ||
        !Number.isFinite(lastObservedCloseAt) || resetAt > lastObservedCloseAt)) return false;
    return rearmedAt === null || (Number.isFinite(rearmedAt) && Number.isFinite(resetAt) &&
        rearmedAt > resetAt && rearmedAt <= lastObservedCloseAt);
}

function advanceLossResetState({ anchor, predicateSignature, observations = [], priorState = null,
    nowMs = Date.now(), signalCandleCloseTime = null } = {}) {
    if (!anchor?.armed || !Number.isFinite(anchor.closedAt) || !["BUY", "SELL"].includes(anchor.side) ||
        !Number.isFinite(nowMs) || anchor.closedAt > nowMs || typeof predicateSignature !== "string") return null;
    const state = validPriorState(priorState, anchor, predicateSignature, nowMs)
        ? { ...priorState }
        : { version: LOSS_RESET_POLICY_VERSION, anchor, predicateSignature,
            resetAt: null, rearmedAt: null, lastObservedCloseAt: null };
    const cutoff = Number.isFinite(signalCandleCloseTime) ? Math.min(nowMs, signalCandleCloseTime) : nowMs;
    const ordered = (Array.isArray(observations) ? observations : []).filter((observation) => observation?.valid === true &&
        Number.isFinite(observation.closedAt) && observation.closedAt > anchor.closedAt &&
        observation.closedAt <= cutoff && typeof observation.longRegime === "boolean" &&
        typeof observation.shortRegime === "boolean")
        .sort((left, right) => left.closedAt - right.closedAt);
    for (const observation of ordered) {
        if (state.lastObservedCloseAt !== null && observation.closedAt <= state.lastObservedCloseAt) continue;
        const matching = anchor.side === "BUY" ? observation.longRegime : observation.shortRegime;
        if (!matching && state.resetAt === null) state.resetAt = observation.closedAt;
        if (matching && state.resetAt !== null && observation.closedAt > state.resetAt && state.rearmedAt === null) {
            state.rearmedAt = observation.closedAt;
        }
        state.lastObservedCloseAt = observation.closedAt;
    }
    return state;
}

function evaluateLossResetPolicy({ instrument, side, trades = [], historyAvailable = true,
    h1Candles = [], config = {}, nowMs = Date.now(), signalCandleCloseTime = null, priorState = null } = {}) {
    const anchor = selectLossResetAnchor(trades, instrument, side);
    const predicateSignature = lossResetPredicateSignature(config);
    const result = { version: LOSS_RESET_POLICY_VERSION, instrument, side, anchor, predicateSignature,
        classification: "NO_LOSS_RESET_REQUIRED", allowed: true, state: null };
    if (!historyAvailable || !Array.isArray(trades) || !["BUY", "SELL"].includes(side)) {
        return { ...result, classification: "LOSS_RESET_EVIDENCE_UNAVAILABLE", allowed: false };
    }
    if (!anchor?.armed) return result;
    if (!anchor.tradeId || !Number.isFinite(anchor.closedAt) || !Number.isFinite(nowMs) || anchor.closedAt > nowMs) {
        return { ...result, classification: "LOSS_RESET_EVIDENCE_UNAVAILABLE", allowed: false };
    }
    const observations = calculateH1RegimeHistory({ h1Candles, config, nowMs, signalCandleCloseTime });
    const state = advanceLossResetState({ anchor, predicateSignature, observations, priorState, nowMs, signalCandleCloseTime });
    const signalValid = Number.isFinite(signalCandleCloseTime) && signalCandleCloseTime <= nowMs &&
        signalCandleCloseTime > anchor.closedAt;
    const rearmed = state.rearmedAt !== null && signalValid && state.rearmedAt <= signalCandleCloseTime;
    const current = observations[observations.length - 1];
    const cutoff = Number.isFinite(signalCandleCloseTime) ? Math.min(nowMs, signalCandleCloseTime) : nowMs;
    const lastAvailable = Array.isArray(h1Candles) ? h1Candles.filter((bar) =>
        !Number.isFinite(candleStart(bar)) || candleStart(bar) + HOUR_MS <= cutoff).slice(-1)[0] : null;
    const currentAvailable = current?.valid === true && current.closedAt === candleStart(lastAvailable) + HOUR_MS;
    const currentMatches = currentAvailable && (side === "BUY" ? current.longRegime : current.shortRegime);
    return { ...result, state, allowed: Boolean(rearmed && currentMatches),
        classification: !currentAvailable || !signalValid ? "LOSS_RESET_EVIDENCE_UNAVAILABLE"
            : rearmed && currentMatches ? "H1_RESET_REARMED"
                : state.resetAt === null ? "WAIT_FOR_H1_RESET" : "WAIT_FOR_H1_REQUALIFICATION" };
}

function sameLossResetDecision(prior, current) {
    return prior?.version === LOSS_RESET_POLICY_VERSION && current?.version === LOSS_RESET_POLICY_VERSION &&
        prior.allowed === true && current.allowed === true && prior.instrument === current.instrument &&
        prior.side === current.side && prior.predicateSignature === current.predicateSignature &&
        sameAnchor(prior.anchor, current.anchor) && prior.state?.resetAt === current.state?.resetAt &&
        prior.state?.rearmedAt === current.state?.rearmedAt;
}

module.exports = {
    LOSS_RESET_POLICY_VERSION, LOSS_RESET_STRATEGY_VERSION, LOSS_RESET_STRATEGY_VERSIONS,
    emaSeries, evaluateH1Regime, calculateH1RegimeHistory,
    selectLossResetAnchor, lossResetPredicateSignature, lossResetStateKey,
    advanceLossResetState, evaluateLossResetPolicy, sameLossResetDecision,
};
