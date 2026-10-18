const { createStrategyDefinition } = require("./strategyContract");
const { calculateATR, getPipValue } = require("../utils/indicators");
const { evaluateMultiDayEntryFreshness } = require("../runtime/marketDataFreshness");
const { resolveEntryExitWindowReason } = require("../runtime/exitPolicy");
const { exceedsQuoteLimit, priceDistanceError } = require("../runtime/quoteMath");

const H4_MS = 4 * 60 * 60 * 1000;
const MULTI_DAY_TREND_VERSION = "2.0.0";
const ROLLING_CHANNEL_ENTRY_TYPE = "ROLLING_CHANNEL_BREAKOUT";
const DEFAULT_MULTI_DAY_TREND_CONFIG = Object.freeze({
    timeframe: "4h",
    enableHTFFilter: false,
    enableSessionFilter: false,
    enableAdxFilter: false,
    enableShorting: true,
    trendBreakoutBars: 20,
    trendExitBars: 10,
    trendAtrPeriod: 14,
    trendStopAtr: 2,
    trendMaxCostToStopRatio: 0.15,
    expectedSlippagePips: 0.2,
    stopLossType: "ATR",
    stopLossAtrMultiplier: 2,
    minStopLossPips: 6,
    enableTakeProfit: false,
    enableBreakeven: false,
});

function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function candleStartMs(candle) {
    if (typeof candle?.time === "number") {
        return candle.time < 1e12 ? candle.time * 1000 : candle.time;
    }
    return Date.parse(candle?.time);
}

function validOhlc(prices) {
    if (!prices) return false;
    const values = [prices.open, prices.high, prices.low, prices.close].map(finite);
    if (values.some((value) => value === null || value <= 0)) return false;
    const [open, high, low, close] = values;
    return low <= Math.min(open, close) && high >= Math.max(open, close);
}

// Ignore the broker's forming tail; never use it for a channel or ATR. Preserve
// broker timestamps rather than imposing a UTC grid on New York-aligned H4.
function completedHistory(candles, nowMs) {
    if (!Array.isArray(candles) || !Number.isFinite(nowMs)) {
        return { candles: [], code: "H4_DATA_UNAVAILABLE" };
    }
    const completed = [];
    let previousStart = -Infinity;
    let formingSeen = false;
    for (const candle of candles) {
        const startedAt = candleStartMs(candle);
        if (!Number.isFinite(startedAt) || startedAt <= previousStart) {
            return { candles: [], code: "INVALID_H4_HISTORY" };
        }
        previousStart = startedAt;
        const forming = candle.complete === false || startedAt + H4_MS > nowMs;
        if (forming) {
            formingSeen = true;
            continue;
        }
        if (formingSeen || !validOhlc(candle)) {
            return { candles: [], code: "INVALID_H4_HISTORY" };
        }
        completed.push(candle);
    }
    return { candles: completed, code: null };
}

function resolveConfig(config) {
    const resolved = { ...DEFAULT_MULTI_DAY_TREND_CONFIG, ...config };
    const integerKeys = ["trendBreakoutBars", "trendExitBars", "trendAtrPeriod"];
    for (const key of integerKeys) {
        const value = finite(resolved[key]);
        if (!Number.isInteger(value) || value < 2) return null;
        resolved[key] = value;
    }
    for (const key of ["trendStopAtr", "trendMaxCostToStopRatio", "expectedSlippagePips", "minStopLossPips"]) {
        const value = finite(resolved[key]);
        if (value === null || value < 0 || (key === "trendStopAtr" && value === 0)) return null;
        resolved[key] = value;
    }
    return resolved;
}

function resultBase({ currentPrice, candle = null, instrument, atrValue = 0 }) {
    return {
        signalCandleTime: candle?.time ?? null,
        atrVal: atrValue,
        atrPips: atrValue / getPipValue(instrument),
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
            enabled: false,
            timeframe: null,
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason: null,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        metadata: { strategy: "multi_day_trend", version: MULTI_DAY_TREND_VERSION },
    };
}

function hold(base, code, reason, context = {}) {
    return {
        ...base,
        signalType: "HOLD",
        signalClass: "FILTERED",
        intent: "WAIT",
        entryType: null,
        reasonCode: `MULTI_DAY_TREND_${code}`,
        reason,
        strategyContext: context,
    };
}

function inputCandles(candles, marketContext) {
    return marketContext?.timeframes?.["4h"]?.candles ??
        marketContext?.timeframes?.H4?.candles ?? candles ?? [];
}

function channel(candles) {
    return {
        high: Math.max(...candles.map((candle) => Number(candle.high))),
        low: Math.min(...candles.map((candle) => Number(candle.low))),
    };
}

function evaluateMultiDayTrendEntry({
    instrument,
    candles,
    currentPrice,
    config = {},
    marketContext = null,
    ownedOpenTrade = null,
    nowMs = Date.now(),
} = {}) {
    const resolved = resolveConfig(config);
    const history = completedHistory(inputCandles(candles, marketContext), nowMs);
    const h4 = history.candles;
    const latest = h4.at(-1);
    const price = finite(currentPrice);
    const base = resultBase({ currentPrice: price, candle: latest, instrument });
    if (!resolved) return hold(base, "INVALID_CONFIG", "HOLD: H4 channel configuration is invalid");
    if (history.code) return hold(base, history.code, "HOLD: ordered completed H4 history is unavailable");
    const minimumBars = Math.max(resolved.trendBreakoutBars + 2, resolved.trendAtrPeriod + 1);
    if (h4.length < minimumBars) {
        return hold(base, "WARMUP", `HOLD: waiting for ${minimumBars} completed H4 candles`);
    }
    if (price === null || price <= 0) {
        return hold(base, "PRICE_UNAVAILABLE", "HOLD: a positive current market price is unavailable");
    }
    if (ownedOpenTrade?.isOpen === true) {
        return hold(base, "POSITION_OPEN", "HOLD: this pair already has an owned position");
    }
    const freshness = evaluateMultiDayEntryFreshness({ h4Candles: h4, nowMs });
    const context = {
        family: "multi_day_trend",
        version: MULTI_DAY_TREND_VERSION,
        evaluatedAt: nowMs,
        signalCandleCloseTime: candleStartMs(latest) + H4_MS,
        dataFreshness: freshness,
    };
    if (!freshness.fresh) {
        return hold(base, freshness.code, "HOLD: waiting for current completed H4 candles in an open market", context);
    }
    if (resolveEntryExitWindowReason({ policy: { ...resolved, strategy: "multi_day_trend" }, now: nowMs })) {
        return hold(base, "WEEKEND_CLOSE", "HOLD: new entries wait until the market reopens after the Friday cutoff", context);
    }
    if (marketContext?.session?.tradeable !== true) {
        return hold(base, "NOT_TRADEABLE", "HOLD: the broker has not supplied a tradeable quote", context);
    }

    const currentChannel = channel(h4.slice(-(resolved.trendBreakoutBars + 1), -1));
    const previousChannel = channel(h4.slice(-(resolved.trendBreakoutBars + 2), -2));
    const previous = h4.at(-2);
    const longBreakout = latest.close > currentChannel.high;
    const shortBreakout = latest.close < currentChannel.low;
    const freshLong = longBreakout && previous.close <= previousChannel.high;
    const freshShort = shortBreakout && previous.close >= previousChannel.low;
    context.h4 = {
        close: Number(latest.close),
        previousClose: Number(previous.close),
        channelPeriod: resolved.trendBreakoutBars,
        channelHigh: currentChannel.high,
        channelLow: currentChannel.low,
        previousChannelHigh: previousChannel.high,
        previousChannelLow: previousChannel.low,
        longBreakout,
        shortBreakout,
        freshLong,
        freshShort,
    };
    if (!freshLong && !freshShort) {
        return hold(base, "NO_FRESH_BREAKOUT", `HOLD: waiting for a fresh completed H4 close outside the prior ${resolved.trendBreakoutBars}-bar channel`, context);
    }
    if (freshShort && resolved.enableShorting === false) {
        return hold(base, "SHORTING_DISABLED", "HOLD: short entries are disabled", context);
    }
    const atrValues = calculateATR(h4.map((candle) => Number(candle.high)),
        h4.map((candle) => Number(candle.low)), h4.map((candle) => Number(candle.close)), resolved.trendAtrPeriod);
    const atrValue = atrValues.at(-1);
    if (!Number.isFinite(atrValue) || atrValue <= 0) {
        return hold(base, "ATR_UNAVAILABLE", "HOLD: positive completed H4 ATR is unavailable", context);
    }
    const pipValue = getPipValue(instrument);
    const side = freshLong ? "BUY" : "SELL";
    const direction = freshLong ? 1 : -1;
    const atrStopDistance = atrValue * resolved.trendStopAtr;
    const stopDistance = Math.max(atrStopDistance, resolved.minStopLossPips * pipValue);
    const stopLossPrice = price - direction * stopDistance;
    const stopPips = stopDistance / pipValue;
    const bid = finite(marketContext?.price?.bid);
    const ask = finite(marketContext?.price?.ask);
    const spreadPips = bid !== null && ask !== null && bid > 0 && ask >= bid
        ? (ask - bid) / pipValue : finite(marketContext?.session?.spreadPips);
    const totalCostPips = spreadPips !== null && spreadPips >= 0
        ? spreadPips + resolved.expectedSlippagePips : null;
    const costToStopRatio = totalCostPips !== null ? totalCostPips / stopPips : null;
    context.h4.atr = atrValue;
    context.costs = { spreadPips, expectedSlippagePips: resolved.expectedSlippagePips,
        totalCostPips, stopPips, costToStopRatio, maximumRatio: resolved.trendMaxCostToStopRatio };
    const readyBase = { ...base, atrVal: atrValue, atrPips: atrValue / pipValue };
    if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0 ||
        (side === "BUY" ? stopLossPrice >= price : stopLossPrice <= price)) {
        return hold(readyBase, "INVALID_STOP", "HOLD: the ATR stop is not a valid positive price on the protective side", context);
    }
    if (costToStopRatio === null || exceedsQuoteLimit(costToStopRatio, resolved.trendMaxCostToStopRatio,
        priceDistanceError(price, price, pipValue) / stopPips)) {
        return hold(readyBase, "COST_TOO_HIGH", "HOLD: spread and expected slippage exceed the allowed share of initial risk", context);
    }
    return {
        ...readyBase,
        signalType: side,
        signalClass: "ACTIONABLE",
        intent: direction > 0 ? "ENTER_LONG" : "ENTER_SHORT",
        entryType: ROLLING_CHANNEL_ENTRY_TYPE,
        currentDir: direction,
        reasonCode: `MULTI_DAY_TREND_${direction > 0 ? "LONG" : "SHORT"}_ENTRY`,
        reason: `${side}: fresh completed H4 close beyond the prior ${resolved.trendBreakoutBars}-bar channel | initial stop ${resolved.trendStopAtr} ATR`,
        tradePlan: {
            stopPriceMode: "ATR_DISTANCE",
            stopLossPrice,
            stopLossType: "ATR",
            stopPips,
            stopLossPips: stopPips,
            atrStopPips: atrStopDistance / pipValue,
            stopAtrMultiplier: resolved.trendStopAtr,
            riskDistance: stopDistance,
            takeProfit: null,
            takeProfitPrice: null,
            targetRiskMultiple: null,
        },
        strategyContext: context,
    };
}

function evaluateChannelTrail({ instrument, side, candles = [], nowMs = Date.now(), config = {} } = {}) {
    const resolved = resolveConfig(config);
    const history = completedHistory(candles, nowMs);
    const h4 = history.candles;
    const base = { ready: false, signalCandleTime: h4.at(-1)?.time ?? null,
        stopLossPrice: null, stopLossType: "CHANNEL", channelPeriod: resolved?.trendExitBars ?? null,
        takeProfit: null, takeProfitPrice: null, targetRiskMultiple: null };
    const rejected = (code, reason) => ({ ...base, reasonCode: `MULTI_DAY_TREND_${code}`, reason });
    if (!resolved) return rejected("INVALID_CONFIG", "H4 exit-channel configuration is invalid");
    if (!["BUY", "SELL"].includes(side)) return rejected("INVALID_SIDE", "A BUY or SELL position side is required");
    if (history.code) return rejected(history.code, "Ordered completed H4 history is unavailable");
    if (h4.length < resolved.trendExitBars) return rejected("TRAIL_WARMUP", `Waiting for ${resolved.trendExitBars} completed H4 exit-channel candles`);
    const window = h4.slice(-resolved.trendExitBars);
    const component = side === "BUY" ? "bid" : "ask";
    if (window.some((candle) => !validOhlc(candle[component]))) {
        return rejected("TRAIL_SIDE_DATA_UNAVAILABLE", `Completed H4 ${component} OHLC is unavailable`);
    }
    const stopLossPrice = side === "BUY"
        ? Math.min(...window.map((candle) => Number(candle.bid.low)))
        : Math.max(...window.map((candle) => Number(candle.ask.high)));
    return { ...base, ready: true, stopLossPrice, instrument: instrument ?? null,
        reasonCode: "MULTI_DAY_TREND_CHANNEL_TRAIL",
        reason: `${side} protective stop candidate from the latest ${resolved.trendExitBars} completed H4 ${component} candles` };
}

const multiDayTrendStrategy = createStrategyDefinition({
    key: "multi_day_trend",
    label: "H4 Rolling Channel Trend",
    description: "Fresh symmetric completed H4 20-bar channel breakouts, 2 ATR initial risk and a 10-bar protective exit channel.",
    version: MULTI_DAY_TREND_VERSION,
    runtimeStatus: "live_ready",
    requiredData: { timeframes: ["4h"], marketData: ["candles", "price", "spread"], indicators: ["atr"] },
    metadata: { supportsLive: true, entryValidation: { enforceGlobalMinAdx: false },
        exitPolicyKind: "H4_CHANNEL", defaultConfig: DEFAULT_MULTI_DAY_TREND_CONFIG },
    evaluateEntry: evaluateMultiDayTrendEntry,
    evaluateExit: evaluateChannelTrail,
});

module.exports = Object.assign({}, multiDayTrendStrategy, {
    DEFAULT_MULTI_DAY_TREND_CONFIG,
    MULTI_DAY_TREND_VERSION,
    ROLLING_CHANNEL_ENTRY_TYPE,
    evaluateMultiDayTrendEntry,
    evaluateChannelTrail,
});
