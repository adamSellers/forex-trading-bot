const { evaluateCandleFreshness, getForexMarketState } = require("./marketDataFreshness");

const SELL_RETEST_POLICY_VERSION = 1;
const SELL_RETEST_STRATEGY_VERSION = "1.3.0";
const SELL_RETEST_ENTRY_TYPE = "M15_BREAK_RETEST_REJECTION";
const PERIOD_MS = 15 * 60_000;

function startTime(candle) {
    return typeof candle?.time === "number" ? candle.time : Date.parse(candle?.time);
}

function validPrices(prices) {
    return Boolean(prices) && [prices.open, prices.high, prices.low, prices.close]
        .every((value) => Number.isFinite(value) && value > 0) &&
        prices.high >= Math.max(prices.open, prices.close, prices.low) &&
        prices.low <= Math.min(prices.open, prices.close, prices.high);
}

function hasMissingOpenBar(previousClose, nextStart) {
    if (!Number.isFinite(previousClose)) return false;
    for (let start = previousClose; start < nextStart; start += PERIOD_MS) {
        if (getForexMarketState(start + PERIOD_MS - 2 * 60_000).open) return true;
    }
    return false;
}

function sellRetestPatternId(instrument, breakout, retest, confirmation) {
    return breakout && retest && confirmation
        ? `sell-retest:v${SELL_RETEST_POLICY_VERSION}:${instrument}:${breakout.closedAt}:${retest.closedAt}:${confirmation.closedAt}`
        : null;
}

function consumedSellRetestPatternIds(trades = [], instrument) {
    return (Array.isArray(trades) ? trades : []).filter((trade) =>
        trade.instrument === instrument && trade.side === "SELL" && trade.oandaTradeId)
        .map((trade) => trade.brokerReconciliationPayload?.liveRuntime?.entryTelemetry?.strategyContext?.sellRetest?.patternId)
        .filter((id) => typeof id === "string");
}

function validStoredState(state, instrument, count, nowMs) {
    if (state?.version !== SELL_RETEST_POLICY_VERSION || state.instrument !== instrument ||
        state.breakoutBars !== count ||
        !(state.lastProcessedCandleCloseTime === null || Number.isFinite(state.lastProcessedCandleCloseTime)) ||
        state.lastProcessedCandleCloseTime > nowMs || typeof state.askEvidenceAvailable !== "boolean") return false;
    const { breakout, retest, confirmation, lastProcessedCandleCloseTime: lastClose } = state;
    if (lastClose === null) return !breakout && !retest && !confirmation && state.askEvidenceAvailable === true;
    if (!breakout) return !retest && !confirmation;
    if (!(Number.isFinite(breakout.level) && breakout.level > 0 &&
        startTime(breakout) + PERIOD_MS === breakout.closedAt && breakout.closedAt <= lastClose)) return false;
    if (!retest) return !confirmation;
    if (!(Number.isFinite(retest.low) && retest.low > 0 &&
        startTime(retest) + PERIOD_MS === retest.closedAt && retest.closedAt > breakout.closedAt &&
        retest.closedAt <= lastClose && Number.isFinite(Date.parse(retest.firstTime)) &&
        (!state.askEvidenceAvailable || Number.isFinite(retest.askHigh) && retest.askHigh > 0))) return false;
    return !confirmation || startTime(confirmation) + PERIOD_MS === confirmation.closedAt &&
        confirmation.closedAt > retest.closedAt && confirmation.closedAt === lastClose;
}

// Replay only advances on a distinct completed M15 candle. Persisting the
// returned state retains the frozen breakout when the rolling cache advances;
// it does not introduce an independent timer or infer missing market prices.
function evaluateIntradaySellRetest({ instrument, candles = [], breakoutBars = 8,
    nowMs = Date.now(), displayPrecision, priorState = null, consumedPatternIds = [] } = {}) {
    const count = Math.max(2, Math.floor(Number(breakoutBars) || 8));
    const precision = Number.isInteger(displayPrecision) && displayPrecision >= 0 && displayPrecision <= 10
        ? displayPrecision : String(instrument).includes("JPY") ? 3 : 5;
    const emptyState = () => ({ version: SELL_RETEST_POLICY_VERSION, instrument, breakoutBars: count,
        lastProcessedCandleCloseTime: null, breakout: null, retest: null, confirmation: null,
        askEvidenceAvailable: true });
    const validPrior = validStoredState(priorState, instrument, count, nowMs);
    let state = validPrior ? JSON.parse(JSON.stringify(priorState)) : emptyState();
    let classification = "WAIT_FOR_BREAK";
    let previousInputStart = null;
    let validWindow = [];
    const latest = Array.isArray(candles) ? candles.at(-1) : null;
    const latestClose = startTime(latest) + PERIOD_MS;
    const finish = (code) => {
        const { breakout, retest, confirmation } = state;
        const patternId = sellRetestPatternId(instrument, breakout, retest, confirmation);
        const consumed = patternId && consumedPatternIds.includes(patternId);
        const fresh = evaluateCandleFreshness(candles, "15m", { nowMs });
        const ready = code === "CONFIRMED" && !consumed && fresh.fresh &&
            confirmation?.closedAt === latestClose && state.askEvidenceAvailable;
        const scale = 10 ** precision;
        const structuralStopLossPrice = Number.isFinite(retest?.askHigh) && state.askEvidenceAvailable
            ? (Math.round(retest.askHigh * scale) + 1) / scale : null;
        return { version: SELL_RETEST_POLICY_VERSION, instrument, ready,
            classification: consumed ? "PATTERN_ALREADY_TRADED" : !fresh.fresh ? fresh.code : code,
            patternId, breakout, retest, confirmation, structuralStopLossPrice,
            displayPrecision: precision, state };
    };
    if (!Array.isArray(candles) || !Number.isFinite(nowMs)) return finish("CANDLE_DATA_UNAVAILABLE");
    if (priorState && !validPrior) return finish("STATE_UNAVAILABLE");
    // A normal MBA refresh can fill ask data missing from a persisted older
    // midpoint cache. Recover only with the complete retained episode, never by
    // substituting today's spread or silently forgetting an unavailable bar.
    if (state.retest && !state.askEvidenceAvailable) {
        const firstStart = Date.parse(state.retest.firstTime);
        const episode = candles.filter((candle) => startTime(candle) >= firstStart &&
            startTime(candle) + PERIOD_MS <= state.lastProcessedCandleCloseTime);
        if (episode.length && startTime(episode[0]) === firstStart &&
            startTime(episode.at(-1)) + PERIOD_MS === state.lastProcessedCandleCloseTime &&
            episode.every((candle, index) => candle.complete !== false && validPrices(candle) && validPrices(candle.ask) &&
                (index === 0 || !hasMissingOpenBar(startTime(episode[index - 1]) + PERIOD_MS, startTime(candle))))) {
            state.askEvidenceAvailable = true;
            state.retest.askHigh = Math.max(...episode.map((candle) => candle.ask.high));
        }
    }
    for (const candle of candles) {
        const start = startTime(candle);
        const close = start + PERIOD_MS;
        const valid = Number.isFinite(start) && candle.complete !== false && close <= nowMs &&
            (previousInputStart === null || start > previousInputStart) && validPrices(candle);
        if (!valid) {
            // Do not bridge invalid evidence, including duplicate/out-of-order
            // candles. A later valid sequence must establish a new range.
            state = emptyState();
            validWindow = [];
            classification = "CANDLE_DATA_UNAVAILABLE";
            previousInputStart = Number.isFinite(start) ? start : previousInputStart;
            continue;
        }
        if (hasMissingOpenBar(previousInputStart === null ? null : previousInputStart + PERIOD_MS, start)) {
            validWindow = [];
        }
        previousInputStart = start;
        if (state.lastProcessedCandleCloseTime !== null && close <= state.lastProcessedCandleCloseTime) {
            validWindow.push(candle);
            validWindow = validWindow.slice(-count);
            continue;
        }
        if (hasMissingOpenBar(state.lastProcessedCandleCloseTime, start)) {
            state = emptyState();
            validWindow = [];
            classification = "CANDLE_HISTORY_GAP";
        }
        if (state.confirmation) {
            state.breakout = null;
            state.retest = null;
            state.confirmation = null;
            state.askEvidenceAvailable = true;
        }
        if (state.breakout && candle.close >= state.breakout.level) {
            state.breakout = null;
            state.retest = null;
            state.askEvidenceAvailable = true;
            classification = "BREAK_CANCELLED";
        } else if (state.breakout) {
            const touch = candle.high >= state.breakout.level;
            if (touch || state.retest) {
                const askAvailable = validPrices(candle.ask);
                state.askEvidenceAvailable = state.askEvidenceAvailable && askAvailable;
                const askHigh = askAvailable ? candle.ask.high : null;
                if (touch) {
                    state.retest = { time: candle.time, closedAt: close, low: candle.low,
                        firstTime: state.retest?.firstTime || candle.time,
                        askHigh: Math.max(state.retest?.askHigh || 0, askHigh || 0) || null };
                    classification = "WAIT_FOR_REJECTION";
                } else {
                    if (askAvailable) state.retest.askHigh = Math.max(state.retest.askHigh || 0, askHigh);
                    if (candle.close < candle.open && candle.close < state.retest.low) {
                        state.confirmation = { time: candle.time, closedAt: close };
                        classification = "CONFIRMED";
                    } else classification = "WAIT_FOR_REJECTION";
                }
                if (!state.askEvidenceAvailable) classification = "ASK_EVIDENCE_UNAVAILABLE";
            } else classification = "WAIT_FOR_RETEST";
        } else if (validWindow.length >= count && candle.close < candle.open) {
            const level = Math.min(...validWindow.slice(-count).map((bar) => bar.low));
            if (candle.close < level) {
                state.breakout = { time: candle.time, closedAt: close, level };
                classification = "WAIT_FOR_RETEST";
            }
        }
        state.lastProcessedCandleCloseTime = close;
        validWindow.push(candle);
        validWindow = validWindow.slice(-count);
    }
    if (state.confirmation) classification = state.askEvidenceAvailable ? "CONFIRMED" : "ASK_EVIDENCE_UNAVAILABLE";
    else if (state.retest) classification = state.askEvidenceAvailable ? "WAIT_FOR_REJECTION" : "ASK_EVIDENCE_UNAVAILABLE";
    else if (state.breakout) classification = "WAIT_FOR_RETEST";
    return finish(classification);
}

module.exports = { SELL_RETEST_POLICY_VERSION, SELL_RETEST_STRATEGY_VERSION, SELL_RETEST_ENTRY_TYPE,
    evaluateIntradaySellRetest, sellRetestPatternId, consumedSellRetestPatternIds };
