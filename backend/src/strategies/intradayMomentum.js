const { createStrategyDefinition } = require("./strategyContract");
const { evaluateIntradayEntryFreshness } = require("../runtime/marketDataFreshness");
const { resolveTimedExitReason } = require("../runtime/exitPolicy");
const { evaluateReentryPolicy, FADE_ENTRY_TYPE } = require("../runtime/intradayReentryPolicy");
const { priceDistanceError, exceedsQuoteLimit } = require("../runtime/quoteMath");
const {
    calculateADX,
    calculateATR,
    calculateRSI,
    getPipValue,
} = require("../utils/indicators");

const DEFAULT_INTRADAY_MOMENTUM_CONFIG = Object.freeze({
    timeframe: "15m",
    enableHTFFilter: false,
    enableSessionFilter: false,
    enableAdxFilter: false,
    enableShorting: true,
    intradayFastEmaPeriod: 20,
    intradaySlowEmaPeriod: 50,
    intradayAdxPeriod: 14,
    intradayMinAdx: 20,
    intradayAtrPeriod: 14,
    intradayRsiPeriod: 14,
    intradayBreakoutBars: 8,
    intradayPullbackBars: 4,
    intradayStopAtr: 1.25,
    intradayTargetRiskMultiple: 1.5,
    intradayMinBodyRatio: 0.35,
    intradayMinRangeAtr: 0.35,
    intradayMaxRangeAtr: 2.5,
    intradayLongRsiMinimum: 52,
    intradayLongRsiMaximum: 72,
    intradayShortRsiMinimum: 28,
    intradayShortRsiMaximum: 48,
    intradayMaxCostToStopRatio: 0.15,
    expectedSlippagePips: 0.2,
    stopLossType: "ATR",
    stopLossAtrMultiplier: 1.25,
    minStopLossPips: 6,
    enableTakeProfit: true,
    timeStopHours: 6,
    enableBreakeven: true,
    breakevenTriggerRiskMultiple: 1,
    enableTrailingStops: false,
    sessionCloseTimeZone: "America/New_York",
    sessionCloseLocalHour: 16,
    sessionCloseLocalMinute: 45,
    sessionCloseWindowMinutes: 30,
});

const SESSION_DEFINITIONS = Object.freeze({
    sydney: {
        label: "Sydney",
        timeZone: "Australia/Sydney",
        startHour: 8,
        endHour: 17,
    },
    tokyo: {
        label: "Tokyo",
        timeZone: "Asia/Tokyo",
        startHour: 8,
        endHour: 17,
    },
    london: {
        label: "London",
        timeZone: "Europe/London",
        startHour: 8,
        endHour: 17,
    },
    new_york: {
        label: "New York",
        timeZone: "America/New_York",
        startHour: 8,
        endHour: 16,
    },
});

const PAIR_SESSIONS = Object.freeze({
    AUD_USD: ["sydney", "tokyo", "new_york"],
    EUR_USD: ["london", "new_york"],
    GBP_USD: ["london", "new_york"],
    USD_JPY: ["tokyo", "london", "new_york"],
});

function finite(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, minimum = 1) {
    return Math.max(minimum, Math.floor(finite(value, fallback)));
}

function emaSeries(values = [], period = 20) {
    const resolvedPeriod = integer(period, 20, 2);
    if (values.length < resolvedPeriod) return [];

    const results = Array(values.length).fill(null);
    let current =
        values
            .slice(0, resolvedPeriod)
            .reduce((sum, value) => sum + value, 0) / resolvedPeriod;
    results[resolvedPeriod - 1] = current;
    const multiplier = 2 / (resolvedPeriod + 1);
    for (let index = resolvedPeriod; index < values.length; index += 1) {
        current = values[index] * multiplier + current * (1 - multiplier);
        results[index] = current;
    }
    return results;
}

function zonedClock(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(
        parts
            .filter((part) => part.type !== "literal")
            .map((part) => [part.type, Number(part.value)])
    );
    return { hour: values.hour, minute: values.minute };
}

function getActivePairSessions(instrument, timestamp) {
    const sessionKeys = PAIR_SESSIONS[instrument] || [];
    return sessionKeys
        .map((key) => SESSION_DEFINITIONS[key])
        .filter(Boolean)
        .filter((session) => {
            const { hour } = zonedClock(timestamp, session.timeZone);
            return hour >= session.startHour && hour < session.endHour;
        })
        .map((session) => session.label);
}

function candleCloseTimeMs(candle, timeframeMinutes = 15) {
    const startedAt = Date.parse(candle?.time);
    return Number.isFinite(startedAt)
        ? startedAt + timeframeMinutes * 60 * 1000
        : null;
}

function resultBase({ currentPrice, candle, atrValue, instrument }) {
    const pipValue = getPipValue(instrument);
    return {
        signalCandleTime: candle?.time || null,
        atrVal: atrValue || 0,
        atrPips:
            Number.isFinite(atrValue) && atrValue > 0
                ? atrValue / pipValue
                : 0,
        currentPrice,
        rsiVal: null,
        adxVal: 0,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir: 0,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "1h",
            direction: 0,
            longAllowed: false,
            shortAllowed: false,
            reason: "H1 trend regime is not ready",
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
    };
}

function hold(base, reasonCode, reason, context = {}) {
    return {
        ...base,
        signalType: "HOLD",
        reason,
        reasonCode,
        signalClass: "FILTERED",
        intent: "WAIT",
        entryType: null,
        strategyContext: context,
    };
}

function describeRegime({ direction, fastEma, slowEma, adx }) {
    const label = direction > 0 ? "long" : direction < 0 ? "short" : "neutral";
    return `H1 ${label} regime | EMA20 ${fastEma.toFixed(5)} | EMA50 ${slowEma.toFixed(5)} | ADX ${adx.toFixed(1)}`;
}

async function evaluateIntradayMomentumEntry({
    instrument,
    currentPrice,
    config = {},
    marketContext = null,
    nowMs = Date.now(),
    latestClosedTrade = null,
    reentryHistoryAvailable = true,
}) {
    const resolved = { ...DEFAULT_INTRADAY_MOMENTUM_CONFIG, ...config };
    const m15 = marketContext?.timeframes?.["15m"]?.candles || [];
    const h1 = marketContext?.timeframes?.["1h"]?.candles || [];
    const fastPeriod = integer(resolved.intradayFastEmaPeriod, 20, 2);
    const slowPeriod = integer(resolved.intradaySlowEmaPeriod, 50, fastPeriod + 1);
    const adxPeriod = integer(resolved.intradayAdxPeriod, 14, 2);
    const atrPeriod = integer(resolved.intradayAtrPeriod, 14, 2);
    const rsiPeriod = integer(resolved.intradayRsiPeriod, 14, 2);
    const breakoutBars = integer(resolved.intradayBreakoutBars, 8, 2);
    const pullbackBars = integer(resolved.intradayPullbackBars, 4, 2);
    const currentM15 = m15[m15.length - 1] || null;
    const currentH1 = h1[h1.length - 1] || null;
    const price = finite(currentPrice);
    const m15Highs = m15.map((candle) => candle.high);
    const m15Lows = m15.map((candle) => candle.low);
    const m15Closes = m15.map((candle) => candle.close);
    const h1Highs = h1.map((candle) => candle.high);
    const h1Lows = h1.map((candle) => candle.low);
    const h1Closes = h1.map((candle) => candle.close);
    const atrResults = calculateATR(m15Highs, m15Lows, m15Closes, atrPeriod);
    const atrValue = atrResults[atrResults.length - 1] || null;
    const base = resultBase({
        currentPrice: price,
        candle: currentM15,
        atrValue,
        instrument,
    });

    const minimumM15 = Math.max(slowPeriod + 5, breakoutBars + 5, atrPeriod + 5);
    const minimumH1 = Math.max(slowPeriod + 5, adxPeriod * 2 + 5);
    if (
        m15.length < minimumM15 ||
        h1.length < minimumH1 ||
        !Number.isFinite(price) || price <= 0
    ) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_WARMUP",
            "HOLD: waiting for complete M15 and H1 history"
        );
    }

    const freshness = evaluateIntradayEntryFreshness({ m15Candles: m15, h1Candles: h1, nowMs });
    if (!freshness.fresh) {
        return hold(base, `INTRADAY_MOMENTUM_${freshness.code}`,
            "HOLD: waiting for current completed M15/H1 candles in an open market",
            { dataFreshness: freshness });
    }
    if (resolveTimedExitReason({ trade: { entryTime: nowMs }, policy: resolved, now: nowMs }) === "SESSION_CLOSE") {
        return hold(base, "INTRADAY_MOMENTUM_ROLLOVER_WINDOW",
            "HOLD: new entries are blocked during the pre-rollover closure window",
            { dataFreshness: freshness });
    }
    if (marketContext?.session?.tradeable !== true) {
        return hold(base, "INTRADAY_MOMENTUM_NOT_TRADEABLE",
            "HOLD: the broker has not supplied a tradeable quote");
    }
    const signalCloseTime = candleCloseTimeMs(currentM15);
    const activeSessions = Number.isFinite(nowMs)
        ? getActivePairSessions(instrument, nowMs)
        : [];
    const h1FastSeries = emaSeries(h1Closes, fastPeriod);
    const h1SlowSeries = emaSeries(h1Closes, slowPeriod);
    const m15FastSeries = emaSeries(m15Closes, fastPeriod);
    const m15SlowSeries = emaSeries(m15Closes, slowPeriod);
    const h1Fast = h1FastSeries[h1FastSeries.length - 1];
    const h1Slow = h1SlowSeries[h1SlowSeries.length - 1];
    const m15Fast = m15FastSeries[m15FastSeries.length - 1];
    const m15Slow = m15SlowSeries[m15SlowSeries.length - 1];
    const adxResults = calculateADX(h1Highs, h1Lows, h1Closes, adxPeriod);
    const currentAdx = adxResults[adxResults.length - 1] || {};
    const previousAdx = adxResults[adxResults.length - 2] || currentAdx;
    const adx = finite(currentAdx.adx, 0);
    const pdi = finite(currentAdx.pdi, 0);
    const mdi = finite(currentAdx.mdi, 0);
    const rsiResults = calculateRSI(m15Closes, rsiPeriod);
    const rsi = finite(rsiResults[rsiResults.length - 1], 50);
    const minimumAdx = Math.max(0, finite(resolved.intradayMinAdx, 20));
    const longStructure = currentH1.close > h1Fast && h1Fast > h1Slow && pdi > mdi;
    const shortStructure = currentH1.close < h1Fast && h1Fast < h1Slow && mdi > pdi;
    const longRegime = longStructure && adx >= minimumAdx;
    const shortRegime = shortStructure && adx >= minimumAdx;
    const direction = longRegime ? 1 : shortRegime ? -1 : 0;
    const observedSpread = finite(marketContext?.session?.spreadPips, null);
    const spreadPips = Number.isFinite(observedSpread) && observedSpread >= 0 ? observedSpread : null;
    const expectedSlippagePips = Math.max(
        0,
        finite(resolved.expectedSlippagePips, 0.2)
    );
    const context = {
        family: "intraday_momentum",
        signalCandleCloseTime: signalCloseTime,
        evaluatedAt: nowMs,
        dataFreshness: freshness,
        activeSessions,
        h1: {
            close: currentH1.close,
            fastEma: h1Fast,
            slowEma: h1Slow,
            adx,
            pdi,
            mdi,
            longStructure,
            shortStructure,
            longRegime,
            shortRegime,
        },
        m15: {
            close: currentM15.close,
            fastEma: m15Fast,
            slowEma: m15Slow,
            atr: atrValue,
            rsi,
        },
        costs: {
            spreadPips,
            expectedSlippagePips,
            totalCostPips: Number.isFinite(spreadPips)
                ? spreadPips + expectedSlippagePips
                : null,
        },
    };

    base.rsiVal = rsi;
    base.adxVal = adx;
    base.pdiVal = pdi;
    base.mdiVal = mdi;
    base.adxRising = adx > finite(previousAdx.adx, adx);
    base.prevAdxVal = finite(previousAdx.adx, adx);
    base.currentDir = direction;
    base.htfContext = {
        enabled: true,
        timeframe: "1h",
        direction,
        longAllowed: longRegime,
        shortAllowed: shortRegime,
        reason: describeRegime({ direction, fastEma: h1Fast, slowEma: h1Slow, adx }),
    };

    if (!activeSessions.length) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_OUTSIDE_SESSION",
            "HOLD: outside this pair's liquid trading sessions",
            context
        );
    }
    if (!Number.isFinite(atrValue) || atrValue <= 0) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_ATR_UNAVAILABLE",
            "HOLD: M15 ATR is unavailable",
            context
        );
    }
    if (!longRegime && !shortRegime) {
        const reasonCode =
            (longStructure || shortStructure) && adx < minimumAdx
                ? "INTRADAY_MOMENTUM_ADX_WEAK"
                : "INTRADAY_MOMENTUM_REGIME_NEUTRAL";
        return hold(
            base,
            reasonCode,
            adx < minimumAdx
                ? `HOLD: H1 ADX ${adx.toFixed(1)} is below ${minimumAdx.toFixed(1)}`
                : "HOLD: H1 trend structure is neutral",
            context
        );
    }

    const candleRange = currentM15.high - currentM15.low;
    const bodyRatio =
        candleRange > 0
            ? Math.abs(currentM15.close - currentM15.open) / candleRange
            : 0;
    const rangeAtr = candleRange / atrValue;
    context.m15.bodyRatio = bodyRatio;
    context.m15.rangeAtr = rangeAtr;
    const minBodyRatio = Math.max(0, finite(resolved.intradayMinBodyRatio, 0.35));
    const minRangeAtr = Math.max(0, finite(resolved.intradayMinRangeAtr, 0.35));
    const maxRangeAtr = Math.max(
        minRangeAtr,
        finite(resolved.intradayMaxRangeAtr, 2.5)
    );
    if (
        bodyRatio < minBodyRatio ||
        rangeAtr < minRangeAtr ||
        rangeAtr > maxRangeAtr
    ) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_CANDLE_QUALITY",
            "HOLD: M15 signal candle is too weak or too extended",
            context
        );
    }

    const longRsiMinimum = finite(resolved.intradayLongRsiMinimum, 52);
    const longRsiMaximum = finite(resolved.intradayLongRsiMaximum, 72);
    const shortRsiMinimum = finite(resolved.intradayShortRsiMinimum, 28);
    const shortRsiMaximum = finite(resolved.intradayShortRsiMaximum, 48);
    const rsiAligned =
        direction > 0
            ? rsi >= longRsiMinimum && rsi <= longRsiMaximum
            : rsi >= shortRsiMinimum && rsi <= shortRsiMaximum;
    const m15Aligned =
        direction > 0
            ? currentM15.close > m15Fast && m15Fast > m15Slow
            : currentM15.close < m15Fast && m15Fast < m15Slow;
    if (!m15Aligned || !rsiAligned) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_CONFIRMATION_MISSING",
            "HOLD: M15 trend or RSI does not confirm the H1 regime",
            context
        );
    }

    const breakoutWindow = m15.slice(-(breakoutBars + 1), -1);
    const breakoutHigh = Math.max(...breakoutWindow.map((candle) => candle.high));
    const breakoutLow = Math.min(...breakoutWindow.map((candle) => candle.low));
    const pullbackWindow = m15.slice(-(pullbackBars + 1), -1);
    const resumptionWindow = m15.slice(-3, -1);
    const resumptionHigh = Math.max(...resumptionWindow.map((candle) => candle.high));
    const resumptionLow = Math.min(...resumptionWindow.map((candle) => candle.low));
    const bullishCandle = currentM15.close > currentM15.open;
    const bearishCandle = currentM15.close < currentM15.open;
    const longBreakout = direction > 0 && bullishCandle && currentM15.close > breakoutHigh;
    const shortBreakout = direction < 0 && bearishCandle && currentM15.close < breakoutLow;
    // Retain the old interpretation as evidence, not as an alternative entry
    // rule. Historical candles now use the EMA available at their own close.
    const legacyLongPullback =
        direction > 0 &&
        bullishCandle &&
        Math.min(...pullbackWindow.map((candle) => candle.low)) <= m15Fast &&
        Math.min(...pullbackWindow.map((candle) => candle.close)) > m15Slow &&
        currentM15.close > resumptionHigh;
    const legacyShortPullback =
        direction < 0 &&
        bearishCandle &&
        Math.max(...pullbackWindow.map((candle) => candle.high)) >= m15Fast &&
        Math.max(...pullbackWindow.map((candle) => candle.close)) < m15Slow &&
        currentM15.close < resumptionLow;
    const pullbackStartIndex = m15.length - pullbackWindow.length - 1;
    const pullbackEvidence = pullbackWindow.map((candle, index) => {
        const candleIndex = pullbackStartIndex + index;
        const fastEma = m15FastSeries[candleIndex];
        const slowEma = m15SlowSeries[candleIndex];
        return {
            time: candle.time,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            fastEma,
            slowEma,
            longTouch: Number.isFinite(fastEma) && candle.low <= fastEma,
            shortTouch: Number.isFinite(fastEma) && candle.high >= fastEma,
            longStructure: Number.isFinite(slowEma) && candle.close > slowEma,
            shortStructure: Number.isFinite(slowEma) && candle.close < slowEma,
        };
    });
    const evaluatePullbackSequence = (side) => {
        const long = side === "long";
        const touchIndices = pullbackEvidence.flatMap((candle, index) =>
            candle[`${side}Touch`] ? [index] : []);
        const latestTouchIndex = touchIndices.length
            ? touchIndices[touchIndices.length - 1]
            : null;
        // Keep the existing two-bar confirmation, extending it back to the
        // latest touch when that touch is older than the confirmation window.
        const resumptionStartIndex = latestTouchIndex === null
            ? Math.max(0, pullbackEvidence.length - 2)
            : Math.min(latestTouchIndex, Math.max(0, pullbackEvidence.length - 2));
        const sequence = pullbackEvidence.slice(resumptionStartIndex);
        const boundary = long
            ? Math.max(...sequence.map((candle) => candle.high))
            : Math.min(...sequence.map((candle) => candle.low));
        const structureHeld = pullbackEvidence.every((candle) => candle[`${side}Structure`]);
        const resumed = long ? currentM15.close > boundary : currentM15.close < boundary;
        return {
            touchTimes: touchIndices.map((index) => pullbackEvidence[index].time),
            latestTouchTime: latestTouchIndex === null ? null : pullbackEvidence[latestTouchIndex].time,
            resumptionStartTime: pullbackEvidence[resumptionStartIndex]?.time || null,
            resumptionBoundary: boundary,
            structureHeld,
            resumed,
            qualifies: (long ? direction > 0 && bullishCandle : direction < 0 && bearishCandle)
                && latestTouchIndex !== null && structureHeld && resumed,
        };
    };
    const longSequence = evaluatePullbackSequence("long");
    const shortSequence = evaluatePullbackSequence("short");
    const longPullback = longSequence.qualifies;
    const shortPullback = shortSequence.qualifies;
    const isBreakout = longBreakout || shortBreakout;
    const isPullback = longPullback || shortPullback;
    context.m15.pullbackWindow = pullbackWindow.map(({ time, high, low }) => ({ time, high, low }));
    context.m15.pullbackSequence = {
        definition: "bar-aligned-pullback-resumption-v1",
        bars: pullbackEvidence,
        long: longSequence,
        short: shortSequence,
        legacy: {
            longPullback: legacyLongPullback,
            shortPullback: legacyShortPullback,
            fastEmaAtSignal: m15Fast,
            slowEmaAtSignal: m15Slow,
            resumptionHigh,
            resumptionLow,
        },
    };
    context.m15.triggerCombination = isBreakout && isPullback
        ? "breakout_and_pullback"
        : isBreakout ? "breakout_only" : isPullback ? "pullback_only" : "none";
    context.m15.trigger = {
        breakoutHigh,
        breakoutLow,
        longBreakout,
        shortBreakout,
        longPullback,
        shortPullback,
    };
    if (!isBreakout && !isPullback) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_NO_TRIGGER",
            "HOLD: no fresh M15 breakout or pullback resumption",
            context
        );
    }

    const pipValue = getPipValue(instrument);
    const stopAtr = Math.max(0.5, finite(resolved.intradayStopAtr, 1.25));
    const minimumStopPips = Math.max(1, finite(resolved.minStopLossPips, 6));
    const stopPips = Math.max((atrValue * stopAtr) / pipValue, minimumStopPips);
    const totalCostPips = Number.isFinite(spreadPips)
        ? spreadPips + expectedSlippagePips
        : null;
    const costToStopRatio = Number.isFinite(totalCostPips)
        ? totalCostPips / stopPips
        : null;
    context.costs.stopPips = stopPips;
    context.costs.costToStopRatio = costToStopRatio;
    const maxCostToStopRatio = Math.max(
        0,
        finite(resolved.intradayMaxCostToStopRatio, 0.15)
    );
    if (
        !Number.isFinite(costToStopRatio) ||
        exceedsQuoteLimit(costToStopRatio, maxCostToStopRatio,
            priceDistanceError(price, price, pipValue) / stopPips)
    ) {
        return hold(
            base,
            "INTRADAY_MOMENTUM_COST_TOO_HIGH",
            "HOLD: spread and expected slippage are too large for the M15 stop",
            context
        );
    }

    const originalSide = direction > 0 ? "BUY" : "SELL";
    const originalEntryType = isPullback ? "M15_PULLBACK_RESUMPTION" : "M15_RANGE_BREAKOUT";
    const reentry = evaluateReentryPolicy({
        originalSide, latestClosedTrade,
        pullbackWindow: context.m15.pullbackWindow,
        signalFastEma: m15Fast,
        signalCandleTime: currentM15.time,
        historyAvailable: reentryHistoryAvailable,
    });
    context.reentry = { ...reentry, originalEntryType };
    if (!reentry.allowed) {
        return hold(base, `INTRADAY_MOMENTUM_${reentry.classification}`,
            reentry.classification === "FADE_ALREADY_TAKEN"
                ? "HOLD: this target episode already filled a fade; wait for a fresh pullback"
                : reentry.classification === "WAIT_FOR_FRESH_PULLBACK"
                  ? "HOLD: same-direction continuation after breakeven needs a fresh post-exit pullback"
                  : reentry.classification === "WAIT_FOR_POST_EXIT_SIGNAL"
                    ? "HOLD: wait for a new M15 signal to complete after the protected exit"
                  : "HOLD: protected-exit evidence is unavailable", context);
    }
    const isFade = reentry.classification === "POST_TP_FADE";
    const side = reentry.executedSide;
    const executionDirection = side === "BUY" ? 1 : -1;
    const entryType = isFade ? FADE_ENTRY_TYPE : originalEntryType;
    const targetRiskMultiple = Math.max(
        1,
        finite(resolved.intradayTargetRiskMultiple, 1.5)
    );
    const stopDistance = stopPips * pipValue;
    const stopLossPrice = price - executionDirection * stopDistance;
    const takeProfitPrice = price + executionDirection * stopDistance * targetRiskMultiple;

    return {
        ...base,
        signalType: side,
        reason:
            `${side}: ${isFade ? `fade of ${originalSide} re-entry after TP without a fresh pullback` : entryType === "M15_PULLBACK_RESUMPTION" ? "M15 pullback resumption" : `${breakoutBars}-bar M15 breakout`} | ` +
            `H1 ADX ${adx.toFixed(1)} | RSI ${rsi.toFixed(1)} | cost/stop ${(costToStopRatio * 100).toFixed(1)}%`,
        reasonCode:
            isFade ? "INTRADAY_MOMENTUM_POST_TP_FADE" : direction > 0
                ? "INTRADAY_MOMENTUM_LONG_ENTRY"
                : "INTRADAY_MOMENTUM_SHORT_ENTRY",
        signalClass: "ACTIONABLE",
        intent: executionDirection > 0 ? "ENTER_LONG" : "ENTER_SHORT",
        entryType,
        currentDir: direction,
        htfContext: {
            ...base.htfContext,
            direction,
            longAllowed: direction > 0,
            shortAllowed: direction < 0,
        },
        tradePlan: {
            stopLossPrice,
            stopPips,
            takeProfitPrice,
            targetRiskMultiple,
            timeStopHours: finite(resolved.timeStopHours, 6),
        },
        strategyContext: context,
    };
}

const intradayMomentumStrategy = createStrategyDefinition({
    key: "intraday_momentum",
    label: "M15 Intraday Momentum",
    description:
        "Completed-M15 trend entries with fresh protected-exit continuations and a defined post-target countertrend fade.",
    version: "1.2.1",
    runtimeStatus: "live_ready",
    requiredData: {
        timeframes: ["15m", "1h"],
        marketData: ["candles", "price", "spread"],
        indicators: ["ema", "adx", "atr", "rsi"],
    },
    metadata: {
        supportsLive: true,
        entryValidation: { enforceGlobalMinAdx: false },
        defaultConfig: DEFAULT_INTRADAY_MOMENTUM_CONFIG,
    },
    evaluateEntry: evaluateIntradayMomentumEntry,
});

module.exports = Object.assign({}, intradayMomentumStrategy, {
    DEFAULT_INTRADAY_MOMENTUM_CONFIG,
    PAIR_SESSIONS,
    SESSION_DEFINITIONS,
    candleCloseTimeMs,
    emaSeries,
    evaluateIntradayMomentumEntry,
    getActivePairSessions,
    zonedClock,
});
