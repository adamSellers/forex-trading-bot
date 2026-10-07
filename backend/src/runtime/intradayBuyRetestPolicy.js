const { evaluateCandleFreshness, getForexMarketState } = require("./marketDataFreshness");

const BUY_RETEST_POLICY_VERSION = 1;
const BUY_RETEST_STRATEGY_VERSION = "1.4.0";
const BUY_RETEST_ENTRY_TYPE = "M15_BREAK_RETEST_CONFIRMATION";
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

// A later retest/confirmation is still the same breakout episode. Only an
// observed close back through the frozen level ends that episode.
function buyRetestEpisodeId(instrument, breakout) {
    return breakout ? `buy-retest:v${BUY_RETEST_POLICY_VERSION}:${instrument}:${breakout.closedAt}` : null;
}

function consumedBuyRetestEpisodeIds(trades = [], instrument) {
    return (Array.isArray(trades) ? trades : []).filter((trade) =>
        trade.instrument === instrument && trade.side === "BUY" && trade.oandaTradeId &&
        (!trade.mode || trade.mode === "live"))
        .map((trade) => trade.brokerReconciliationPayload?.liveRuntime?.entryTelemetry?.strategyContext?.buyRetest?.episodeId)
        .filter((id) => typeof id === "string" && id);
}

function validStoredState(state, instrument, count, nowMs) {
    if (state?.version !== BUY_RETEST_POLICY_VERSION || state.instrument !== instrument ||
        state.breakoutBars !== count || typeof state.consumed !== "boolean" ||
        !(state.lastProcessedCandleCloseTime === null || Number.isFinite(state.lastProcessedCandleCloseTime)) ||
        state.lastProcessedCandleCloseTime > nowMs || typeof state.bidEvidenceAvailable !== "boolean") return false;
    const { breakout, retest, confirmation, lastProcessedCandleCloseTime: lastClose } = state;
    if (lastClose === null) return !breakout && !retest && !confirmation && !state.consumed;
    if (!breakout) return !retest && !confirmation && !state.consumed;
    if (!(Number.isFinite(breakout.level) && breakout.level > 0 &&
        startTime(breakout) + PERIOD_MS === breakout.closedAt && breakout.closedAt <= lastClose)) return false;
    if (!retest) return !confirmation;
    if (!(Number.isFinite(retest.high) && retest.high > 0 &&
        startTime(retest) + PERIOD_MS === retest.closedAt && retest.closedAt > breakout.closedAt &&
        retest.closedAt <= lastClose && Number.isFinite(Date.parse(retest.firstTime)) &&
        (!state.bidEvidenceAvailable || Number.isFinite(retest.bidLow) && retest.bidLow > 0))) return false;
    return !confirmation || startTime(confirmation) + PERIOD_MS === confirmation.closedAt &&
        confirmation.closedAt > retest.closedAt && confirmation.closedAt === lastClose;
}

function evaluateIntradayBuyRetest({ instrument, candles = [], breakoutBars = 8,
    nowMs = Date.now(), displayPrecision, priorState = null, consumedEpisodeIds = [] } = {}) {
    const count = Math.max(2, Math.floor(Number(breakoutBars) || 8));
    const precision = Number.isInteger(displayPrecision) && displayPrecision >= 0 && displayPrecision <= 10
        ? displayPrecision : String(instrument).endsWith("JPY") ? 3 : 5;
    const emptyState = () => ({ version: BUY_RETEST_POLICY_VERSION, instrument, breakoutBars: count,
        lastProcessedCandleCloseTime: null, breakout: null, retest: null, confirmation: null,
        bidEvidenceAvailable: true, consumed: false });
    const validPrior = validStoredState(priorState, instrument, count, nowMs);
    let state = validPrior ? JSON.parse(JSON.stringify(priorState)) : emptyState();
    let classification = "WAIT_FOR_BREAK";
    let previousInputStart = null;
    let validWindow = [];
    const latestClose = startTime(Array.isArray(candles) ? candles.at(-1) : null) + PERIOD_MS;
    const markConsumed = () => {
        const episodeId = buyRetestEpisodeId(instrument, state.breakout);
        if (episodeId && consumedEpisodeIds.includes(episodeId)) state.consumed = true;
    };
    const finish = (code) => {
        markConsumed();
        const { breakout, retest, confirmation } = state;
        const episodeId = buyRetestEpisodeId(instrument, breakout);
        const fresh = evaluateCandleFreshness(candles, "15m", { nowMs });
        const ready = code === "CONFIRMED" && !state.consumed && fresh.fresh &&
            confirmation?.closedAt === latestClose && state.bidEvidenceAvailable;
        const scale = 10 ** precision;
        const stop = Number.isFinite(retest?.bidLow) && state.bidEvidenceAvailable
            ? (Math.round(retest.bidLow * scale) - 1) / scale : null;
        return { version: BUY_RETEST_POLICY_VERSION, instrument, ready,
            classification: state.consumed ? "EPISODE_ALREADY_TRADED" : !fresh.fresh ? fresh.code : code,
            episodeId, breakout, retest, confirmation, structuralStopLossPrice: stop > 0 ? stop : null,
            displayPrecision: precision, state };
    };
    if (!Array.isArray(candles) || !Number.isFinite(nowMs)) return finish("CANDLE_DATA_UNAVAILABLE");
    if (priorState && !validPrior) return finish("STATE_UNAVAILABLE");
    markConsumed();
    // Recover missing bid data only from every completed retained episode bar.
    // Today's spread and midpoint prices cannot supply liquidation evidence.
    if (state.retest && !state.bidEvidenceAvailable) {
        const firstStart = Date.parse(state.retest.firstTime);
        const episode = candles.filter((candle) => startTime(candle) >= firstStart &&
            startTime(candle) + PERIOD_MS <= state.lastProcessedCandleCloseTime);
        if (episode.length && startTime(episode[0]) === firstStart &&
            startTime(episode.at(-1)) + PERIOD_MS === state.lastProcessedCandleCloseTime &&
            episode.every((candle, index) => candle.complete !== false && validPrices(candle) && validPrices(candle.bid) &&
                (index === 0 || !hasMissingOpenBar(startTime(episode[index - 1]) + PERIOD_MS, startTime(candle))))) {
            state.bidEvidenceAvailable = true;
            state.retest.bidLow = Math.min(...episode.map((candle) => candle.bid.low));
        }
    }
    for (const candle of candles) {
        const start = startTime(candle);
        const close = start + PERIOD_MS;
        const valid = Number.isFinite(start) && candle.complete !== false && close <= nowMs &&
            (previousInputStart === null || start > previousInputStart) && validPrices(candle);
        // An uncertain cache cannot erase a frozen (particularly consumed)
        // episode. A later complete refresh can resume from the same cursor.
        if (!valid) return finish("CANDLE_DATA_UNAVAILABLE");
        if (hasMissingOpenBar(previousInputStart === null ? null : previousInputStart + PERIOD_MS, start)) validWindow = [];
        previousInputStart = start;
        if (state.lastProcessedCandleCloseTime !== null && close <= state.lastProcessedCandleCloseTime) {
            validWindow.push(candle);
            validWindow = validWindow.slice(-count);
            continue;
        }
        if (hasMissingOpenBar(state.lastProcessedCandleCloseTime, start)) {
            validWindow = [];
            state.retest = null;
            state.confirmation = null;
            state.bidEvidenceAvailable = true;
            if (state.breakout && candle.close > state.breakout.level) {
                // Keep the old cursor and frozen episode until a supplied
                // completed close proves cancellation. Later supplied bars
                // may prove it; none can bridge the gap into a confirmation.
                classification = "CANDLE_HISTORY_GAP";
                continue;
            }
            // This observed close proves cancellation even if earlier bars are
            // unavailable. Do not use the old rolling window for a new break.
            state = emptyState();
            validWindow = [];
            classification = "CANDLE_HISTORY_GAP";
        }
        if (state.confirmation) {
            state.retest = null;
            state.confirmation = null;
            state.bidEvidenceAvailable = true;
        }
        if (state.breakout && candle.close <= state.breakout.level) {
            state.breakout = null;
            state.retest = null;
            state.confirmation = null;
            state.bidEvidenceAvailable = true;
            state.consumed = false;
            classification = "BREAK_CANCELLED";
        } else if (state.breakout && state.consumed) {
            classification = "EPISODE_ALREADY_TRADED";
        } else if (state.breakout) {
            const touch = candle.low <= state.breakout.level;
            if (touch || state.retest) {
                const bidAvailable = validPrices(candle.bid);
                state.bidEvidenceAvailable = state.bidEvidenceAvailable && bidAvailable;
                const bidLow = bidAvailable ? candle.bid.low : null;
                if (touch) {
                    state.retest = { time: candle.time, closedAt: close, high: candle.high,
                        firstTime: state.retest?.firstTime || candle.time,
                        bidLow: bidLow === null ? state.retest?.bidLow ?? null
                            : Math.min(state.retest?.bidLow ?? Infinity, bidLow) };
                    classification = "WAIT_FOR_CONFIRMATION";
                } else {
                    if (bidAvailable) state.retest.bidLow = Math.min(state.retest.bidLow ?? Infinity, bidLow);
                    if (candle.close > candle.open && candle.close > state.retest.high) {
                        state.confirmation = { time: candle.time, closedAt: close };
                        classification = "CONFIRMED";
                    } else classification = "WAIT_FOR_CONFIRMATION";
                }
                if (!state.bidEvidenceAvailable) classification = "BID_EVIDENCE_UNAVAILABLE";
            } else classification = "WAIT_FOR_RETEST";
        } else if (validWindow.length >= count && candle.close > candle.open) {
            const level = Math.max(...validWindow.slice(-count).map((bar) => bar.high));
            if (candle.close > level) {
                state.breakout = { time: candle.time, closedAt: close, level };
                markConsumed();
                classification = state.consumed ? "EPISODE_ALREADY_TRADED" : "WAIT_FOR_RETEST";
            }
        }
        state.lastProcessedCandleCloseTime = close;
        validWindow.push(candle);
        validWindow = validWindow.slice(-count);
    }
    if (classification !== "CANDLE_HISTORY_GAP") {
        if (state.confirmation) classification = state.bidEvidenceAvailable ? "CONFIRMED" : "BID_EVIDENCE_UNAVAILABLE";
        else if (state.retest) classification = state.bidEvidenceAvailable ? "WAIT_FOR_CONFIRMATION" : "BID_EVIDENCE_UNAVAILABLE";
        else if (state.breakout) classification = "WAIT_FOR_RETEST";
    }
    return finish(classification);
}

module.exports = { BUY_RETEST_POLICY_VERSION, BUY_RETEST_STRATEGY_VERSION, BUY_RETEST_ENTRY_TYPE,
    evaluateIntradayBuyRetest, buyRetestEpisodeId, consumedBuyRetestEpisodeIds };
