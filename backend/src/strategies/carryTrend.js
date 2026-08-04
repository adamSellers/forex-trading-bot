const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_CARRY_TREND_CONFIG = Object.freeze({
    timeframe: "4h",
    enableHTFFilter: false,
    enableSessionFilter: false,
    enableShorting: true,
    carryTrendFastDays: 50,
    carryTrendSlowDays: 200,
    carryTrendMomentumDays: 60,
    carryTrendBreakoutDays: 20,
    carryTrendAtrDays: 20,
    carryTrendStopAtr: 2.5,
    carryTrendMinimumMomentum: 0.01,
    carryTrendMinimumAdvantageAnnual: 0.005,
    carryTrendMinimumDirectionalRateAnnual: -0.03,
    stopLossType: "ATR",
    minStopLossPips: 20,
    enableTakeProfit: false,
    timeStopHours: 0,
});

function finite(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values = []) {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ema(values = [], period = 20) {
    const safePeriod = Math.max(2, Math.floor(finite(period, 20)));
    if (values.length < safePeriod) return null;
    const multiplier = 2 / (safePeriod + 1);
    let result = average(values.slice(0, safePeriod));
    for (let index = safePeriod; index < values.length; index += 1) {
        result = values[index] * multiplier + result * (1 - multiplier);
    }
    return result;
}

function atr(candles = [], period = 20) {
    const safePeriod = Math.max(2, Math.floor(finite(period, 20)));
    if (candles.length < safePeriod + 1) return null;
    const ranges = [];
    for (let index = 1; index < candles.length; index += 1) {
        const candle = candles[index];
        const previousClose = candles[index - 1].close;
        ranges.push(
            Math.max(
                candle.high - candle.low,
                Math.abs(candle.high - previousClose),
                Math.abs(candle.low - previousClose)
            )
        );
    }
    return average(ranges.slice(-safePeriod));
}

function pipSize(instrument) {
    return String(instrument || "").endsWith("_JPY") ? 0.01 : 0.0001;
}

function resultBase({ currentPrice, signalCandleTime, atrValue, instrument }) {
    return {
        signalCandleTime,
        atrVal: atrValue || 0,
        atrPips:
            Number.isFinite(atrValue) && atrValue > 0
                ? atrValue / pipSize(instrument)
                : 0,
        currentPrice,
        rsiVal: 0,
        adxVal: 0,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir: 0,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "1d",
            direction: 0,
            longAllowed: false,
            shortAllowed: false,
            reason: "Daily carry-trend context",
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

function exitOnly(base, direction, context) {
    const exitsLong = direction < 0;
    return {
        ...base,
        signalType: exitsLong ? "SELL" : "BUY",
        reason: exitsLong
            ? "EXIT_ONLY: daily long trend is no longer valid"
            : "EXIT_ONLY: daily short trend is no longer valid",
        reasonCode: exitsLong
            ? "CARRY_TREND_EXIT_LONG"
            : "CARRY_TREND_EXIT_SHORT",
        signalClass: "EXIT_ONLY",
        intent: exitsLong ? "EXIT_LONG_ONLY" : "EXIT_SHORT_ONLY",
        entryType: "EXIT_ONLY",
        currentDir: exitsLong ? -1 : 1,
        strategyContext: context,
    };
}

async function evaluateCarryTrendEntry({
    instrument,
    currentPrice,
    config = {},
    dataService = null,
    marketContext = null,
}) {
    const resolved = { ...DEFAULT_CARRY_TREND_CONFIG, ...config };
    const daily = marketContext?.timeframes?.["1d"]?.candles || [];
    const h4 = marketContext?.timeframes?.["4h"]?.candles || [];
    const slowDays = Math.max(50, Math.floor(finite(resolved.carryTrendSlowDays, 200)));
    const breakoutDays = Math.max(
        5,
        Math.floor(finite(resolved.carryTrendBreakoutDays, 20))
    );
    const momentumDays = Math.max(
        breakoutDays,
        Math.floor(finite(resolved.carryTrendMomentumDays, 60))
    );
    const currentDaily = daily[daily.length - 1] || null;
    const currentH4 = h4[h4.length - 1] || null;
    const price = finite(currentPrice, currentH4?.close ?? currentDaily?.close);
    const atrValue = atr(
        daily,
        Math.floor(finite(resolved.carryTrendAtrDays, 20))
    );
    const base = resultBase({
        currentPrice: price,
        signalCandleTime: currentH4?.time || currentDaily?.time || null,
        atrValue,
        instrument,
    });

    if (daily.length < slowDays + 5 || h4.length < 2 || !Number.isFinite(price)) {
        return hold(
            base,
            "CARRY_TREND_WARMUP",
            "HOLD: waiting for complete daily and H4 history"
        );
    }

    const closes = daily.map((candle) => candle.close);
    const fast = ema(closes, resolved.carryTrendFastDays);
    const slow = ema(closes, slowDays);
    const momentumBase = closes[closes.length - 1 - momentumDays];
    const momentum =
        Number.isFinite(momentumBase) && momentumBase > 0
            ? currentDaily.close / momentumBase - 1
            : 0;
    const longTrend = currentDaily.close > fast && fast > slow && momentum > 0;
    const shortTrend = currentDaily.close < fast && fast < slow && momentum < 0;
    const financing = dataService?.getInstrumentFinancing?.(instrument) || null;
    const longRate = finite(financing?.longRateAnnual, null);
    const shortRate = finite(financing?.shortRateAnnual, null);
    const carryAdvantage =
        Number.isFinite(longRate) && Number.isFinite(shortRate)
            ? longRate - shortRate
            : null;
    const context = {
        family: "carry_trend",
        daily: {
            close: currentDaily.close,
            fastEma: fast,
            slowEma: slow,
            momentum,
            atr: atrValue,
            longTrend,
            shortTrend,
        },
        financing: {
            status: financing?.status || "UNAVAILABLE",
            longRateAnnual: longRate,
            shortRateAnnual: shortRate,
            carryAdvantageAnnual: carryAdvantage,
            source: financing?.source || null,
        },
    };

    base.htfContext = {
        enabled: true,
        timeframe: "1d",
        direction: longTrend ? 1 : shortTrend ? -1 : 0,
        longAllowed: longTrend,
        shortAllowed: shortTrend,
        reason: `EMA ${resolved.carryTrendFastDays}/${slowDays}; ${momentumDays}d momentum ${(momentum * 100).toFixed(2)}%`,
    };

    // Symmetric exit-only signals let the live engine unwind an old trend
    // without opening the opposite side before a fresh breakout occurs.
    if (!longTrend && fast >= slow) {
        return exitOnly(base, -1, context);
    }
    if (!shortTrend && fast < slow) {
        return exitOnly(base, 1, context);
    }

    if (
        financing?.status !== "MODELED" ||
        !Number.isFinite(longRate) ||
        !Number.isFinite(shortRate)
    ) {
        return hold(
            base,
            "CARRY_TREND_FINANCING_UNAVAILABLE",
            "HOLD: broker financing metadata is unavailable",
            context
        );
    }

    const minimumMomentum = Math.max(
        0,
        finite(resolved.carryTrendMinimumMomentum, 0.01)
    );
    if (Math.abs(momentum) < minimumMomentum) {
        return hold(
            base,
            "CARRY_TREND_MOMENTUM_WEAK",
            "HOLD: daily momentum is too weak to cover trading friction",
            context
        );
    }

    const channel = daily.slice(-(breakoutDays + 1), -1);
    const previousChannel = daily.slice(-(breakoutDays + 2), -2);
    const channelHigh = Math.max(...channel.map((candle) => candle.high));
    const channelLow = Math.min(...channel.map((candle) => candle.low));
    const previousHigh = Math.max(
        ...previousChannel.map((candle) => candle.high)
    );
    const previousLow = Math.min(...previousChannel.map((candle) => candle.low));
    const previousDaily = daily[daily.length - 2];
    const longBreakout =
        longTrend &&
        previousDaily.close <= previousHigh &&
        currentDaily.close > channelHigh;
    const shortBreakout =
        shortTrend &&
        previousDaily.close >= previousLow &&
        currentDaily.close < channelLow;
    if (!longBreakout && !shortBreakout) {
        return hold(
            base,
            "CARRY_TREND_NO_BREAKOUT",
            `HOLD: no fresh ${breakoutDays}-day breakout`,
            context
        );
    }

    const direction = longBreakout ? 1 : -1;
    const directionalRate = direction > 0 ? longRate : shortRate;
    const opposingRate = direction > 0 ? shortRate : longRate;
    const minimumAdvantage = finite(
        resolved.carryTrendMinimumAdvantageAnnual,
        0.005
    );
    const minimumDirectionalRate = finite(
        resolved.carryTrendMinimumDirectionalRateAnnual,
        -0.03
    );
    if (
        directionalRate - opposingRate < minimumAdvantage ||
        directionalRate < minimumDirectionalRate
    ) {
        return hold(
            base,
            "CARRY_TREND_CARRY_MISALIGNED",
            "HOLD: breakout direction is not supported by the broker financing differential",
            context
        );
    }
    if (!Number.isFinite(atrValue) || atrValue <= 0) {
        return hold(
            base,
            "CARRY_TREND_ATR_UNAVAILABLE",
            "HOLD: daily ATR is unavailable for the protective stop",
            context
        );
    }

    const stopDistance = Math.max(
        atrValue * Math.max(1, finite(resolved.carryTrendStopAtr, 2.5)),
        pipSize(instrument) * Math.max(1, finite(resolved.minStopLossPips, 20))
    );
    const stopLossPrice = price - direction * stopDistance;
    const trendStrength = Math.min(
        100,
        Math.max(
            1,
            (Math.abs(fast - slow) / atrValue) * 20 +
                Math.abs(momentum) * 500 +
                Math.max(0, directionalRate - opposingRate) * 200
        )
    );

    return {
        ...base,
        signalType: direction > 0 ? "BUY" : "SELL",
        reason:
            `${direction > 0 ? "BUY" : "SELL"}: fresh ${breakoutDays}-day breakout | ` +
            `${momentumDays}d momentum ${(momentum * 100).toFixed(2)}% | ` +
            `carry ${(directionalRate * 100).toFixed(2)}% vs ${(opposingRate * 100).toFixed(2)}%`,
        reasonCode:
            direction > 0
                ? "CARRY_TREND_LONG_ENTRY"
                : "CARRY_TREND_SHORT_ENTRY",
        signalClass: "ACTIONABLE",
        intent: direction > 0 ? "ENTER_LONG" : "ENTER_SHORT",
        entryType: "CARRY_TREND_BREAKOUT",
        adxVal: trendStrength,
        currentDir: direction,
        htfContext: {
            ...base.htfContext,
            direction,
            longAllowed: direction > 0,
            shortAllowed: direction < 0,
        },
        tradePlan: {
            stopLossPrice,
            takeProfitPrice: null,
            timeStopHours: 0,
        },
        strategyContext: context,
    };
}

const carryTrendStrategy = createStrategyDefinition({
    key: "carry_trend",
    label: "Carry Trend",
    description:
        "Daily trend breakout aligned with OANDA's live financing differential.",
    version: "1.0.0",
    runtimeStatus: "live_ready",
    requiredData: {
        timeframes: ["4h", "1d"],
        marketData: ["candles", "price", "spread", "instrument_financing"],
        indicators: [],
    },
    metadata: {
        supportsLive: true,
        defaultConfig: DEFAULT_CARRY_TREND_CONFIG,
    },
    evaluateEntry: evaluateCarryTrendEntry,
});

module.exports = Object.assign({}, carryTrendStrategy, {
    DEFAULT_CARRY_TREND_CONFIG,
    atr,
    ema,
    evaluateCarryTrendEntry,
});
