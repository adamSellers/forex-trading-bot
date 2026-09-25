// A single decision shared by signal generation and post-reconciliation entry
// validation. Broker-confirmed trade history is the durable episode state.
const FADE_ENTRY_TYPE = "M15_POST_TP_FADE";
const REENTRY_POLICY_VERSION = 1;
const INTEGRATED_STRATEGY_VERSION = "1.2.0";
const TradeReconciliationService = require("../services/tradeReconciliationService");
const reconciliation = new TradeReconciliationService();

function confirmedCloseTime(trade) {
    const payload = trade?.brokerReconciliationPayload || {};
    const close = payload.close || {};
    const proof = reconciliation.getCloseTimeEvidence(trade, close.closeTimeEvidence);
    if (proof) return proof.confirmedBrokerClosedAt;
    // Older releases retained the broker response before explicit time evidence
    // existed. Read its timestamp with no local-observation-time fallback.
    if (close.trade?.state === "CLOSED" &&
        String(close.trade.id) === String(trade.oandaTradeId)) {
        return reconciliation.getBrokerClosedAt(close, null);
    }
    const fill = (close.directClose || close).orderFillTransaction;
    if (fill?.tradesClosed?.some((effect) => String(effect.tradeID) === String(trade.oandaTradeId))) {
        return reconciliation.parseBrokerTimestamp(fill.time, null);
    }
    return null;
}

function isFadeTrade(trade) {
    return trade?.entryType === FADE_ENTRY_TYPE;
}

function latestClosedTradeForInstrument(trades, instrument) {
    if (!Array.isArray(trades)) throw new Error("Live trade history is unavailable");
    return trades.filter((trade) => trade.instrument === instrument &&
        trade.isOpen === false && (!trade.mode || trade.mode === "live") &&
        trade.oandaTradeId)
        // Fallback timestamps locate the latest local record only. They never
        // establish post-exit freshness or authorize a TP fade.
        .sort((a, b) =>
            (confirmedCloseTime(b) ?? b.brokerClosedAt ?? b.exitTime ?? 0) -
            (confirmedCloseTime(a) ?? a.brokerClosedAt ?? a.exitTime ?? 0) ||
            String(b.id).localeCompare(String(a.id)))[0] || null;
}

function tradeAnchor(trade) {
    if (!trade) return null;
    return {
        tradeId: trade.id,
        brokerTradeId: trade.oandaTradeId,
        side: trade.side,
        exitReason: trade.exitReason,
        closedAt: confirmedCloseTime(trade),
    };
}

function validAnchor(anchor) {
    return Boolean(anchor?.tradeId && anchor.brokerTradeId &&
        ["BUY", "SELL"].includes(anchor.side) &&
        Number.isFinite(anchor.closedAt) && anchor.closedAt > 0 &&
        typeof anchor.exitReason === "string");
}

function evaluateReentryPolicy({
    originalSide, latestClosedTrade = null, pullbackWindow = [],
    signalFastEma, signalCandleTime, historyAvailable = true,
}) {
    const priorFade = isFadeTrade(latestClosedTrade);
    const stored = latestClosedTrade?.brokerReconciliationPayload?.liveRuntime?.entryTelemetry?.strategyContext?.reentry;
    const anchor = priorFade ? stored?.anchor : tradeAnchor(latestClosedTrade);
    const result = {
        version: REENTRY_POLICY_VERSION,
        originalSide,
        executedSide: originalSide,
        latestClosedTradeId: latestClosedTrade?.id || null,
        anchor: anchor || null,
        fadeConsumed: priorFade,
        freshTouch: false,
        freshTouchTimes: [],
        signalFastEma,
        signalCandleTime,
        pullbackWindow,
        classification: "NORMAL",
        allowed: true,
    };
    if (!historyAvailable || (latestClosedTrade && (!anchor?.tradeId ||
        !["BUY", "SELL"].includes(anchor.side) ||
        (priorFade && (!validAnchor(anchor) || stored?.version !== REENTRY_POLICY_VERSION ||
            stored.classification !== "POST_TP_FADE" || anchor.exitReason !== "TAKE_PROFIT"))))) {
        return { ...result, allowed: false, classification: "HISTORY_UNAVAILABLE" };
    }
    if (!anchor || anchor.side !== originalSide ||
        !["TAKE_PROFIT", "BREAKEVEN_STOP"].includes(anchor.exitReason)) return result;

    if (!validAnchor(anchor)) {
        return { ...result, allowed: false, classification: "FRESHNESS_UNAVAILABLE" };
    }

    const candleStart = typeof signalCandleTime === "number"
        ? signalCandleTime : Date.parse(signalCandleTime);
    if (!Number.isFinite(signalFastEma) || !Number.isFinite(candleStart) ||
        !Array.isArray(pullbackWindow) || !pullbackWindow.length) {
        return { ...result, allowed: false, classification: "FRESHNESS_UNAVAILABLE" };
    }
    if (candleStart + 15 * 60_000 <= anchor.closedAt) {
        return { ...result, allowed: false, classification: "WAIT_FOR_POST_EXIT_SIGNAL" };
    }
    result.freshTouchTimes = pullbackWindow.filter((bar) => {
        const start = Date.parse(bar.time);
        return Number.isFinite(start) && start >= anchor.closedAt &&
            start + 15 * 60_000 <= candleStart &&
            (originalSide === "BUY"
                ? Number.isFinite(bar.low) && bar.low <= signalFastEma
                : Number.isFinite(bar.high) && bar.high >= signalFastEma);
    }).map((bar) => bar.time);
    result.freshTouch = result.freshTouchTimes.length > 0;
    if (result.freshTouch) return { ...result, classification: "FRESH_CONTINUATION" };
    if (anchor.exitReason === "BREAKEVEN_STOP") {
        return { ...result, allowed: false, classification: "WAIT_FOR_FRESH_PULLBACK" };
    }
    if (priorFade) return { ...result, allowed: false, classification: "FADE_ALREADY_TAKEN" };
    return {
        ...result, classification: "POST_TP_FADE",
        executedSide: originalSide === "BUY" ? "SELL" : "BUY",
    };
}

function sameReentryDecision(prior, current) {
    return prior?.version === REENTRY_POLICY_VERSION && current.allowed &&
        prior.allowed === true && prior.classification === current.classification &&
        prior.originalSide === current.originalSide && prior.executedSide === current.executedSide &&
        prior.latestClosedTradeId === current.latestClosedTradeId &&
        prior.fadeConsumed === current.fadeConsumed &&
        JSON.stringify(prior.anchor) === JSON.stringify(current.anchor);
}

module.exports = {
    FADE_ENTRY_TYPE, REENTRY_POLICY_VERSION, INTEGRATED_STRATEGY_VERSION,
    evaluateReentryPolicy, latestClosedTradeForInstrument, sameReentryDecision, isFadeTrade,
    confirmedCloseTime,
};
