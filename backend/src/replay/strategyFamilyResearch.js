const { ATR } = require("technicalindicators");

function finite(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values) {
    return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
}

function standardDeviation(values) {
    if (values.length < 2) return null;
    const mean = average(values);
    const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (values.length - 1);
    return Math.sqrt(variance);
}

function ema(values, period) {
    if (values.length < period) return null;
    const multiplier = 2 / (period + 1);
    let result = average(values.slice(0, period));
    for (let index = period; index < values.length; index += 1) {
        result = values[index] * multiplier + result * (1 - multiplier);
    }
    return result;
}

function atr(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const values = ATR.calculate({
        high: candles.map((candle) => candle.high),
        low: candles.map((candle) => candle.low),
        close: candles.map((candle) => candle.close),
        period,
    });
    return finite(values[values.length - 1], null);
}

function pipSize(instrument) {
    return instrument.endsWith("_JPY") ? 0.01 : 0.0001;
}

function tradeSignal(context, direction, stopDistance, options = {}) {
    const currentPrice = context.candle.close;
    const stopLossPrice = currentPrice - direction * stopDistance;
    const riskReward = finite(options.riskReward, 1.5);
    return {
        signal: direction > 0 ? "BUY" : "SELL",
        intent: direction > 0 ? "ENTER_LONG" : "ENTER_SHORT",
        signalClass: "ACTIONABLE",
        reasonCode: options.reasonCode,
        entryType: options.entryType,
        currentPrice,
        stopLossPrice,
        takeProfitPrice: currentPrice + direction * stopDistance * riskReward,
        maxHoldingBars: Math.max(1, Math.floor(finite(options.maxHoldingBars, 32))),
        metadata: {
            family: options.family,
            strategyVersion: "research-families-v1",
        },
    };
}

function hold(reasonCode) {
    return {
        signal: "HOLD",
        signalClass: "FILTERED",
        intent: "WAIT",
        reasonCode,
    };
}

function utcParts(time) {
    const date = new Date(Number(time) > 1e12 ? Number(time) : Number(time) * 1000);
    return {
        day: date.toISOString().slice(0, 10),
        hour: date.getUTCHours(),
        weekday: date.getUTCDay(),
        weekOfMonth: Math.floor((date.getUTCDate() - 1) / 7),
    };
}

function sessionExpansion(variant) {
    const config = variant.config || variant;
    const rangeStartHour = finite(config.rangeStartHour, 0);
    const rangeEndHour = finite(config.rangeEndHour, 6);
    const entryStartHour = finite(config.entryStartHour, 7);
    const entryEndHour = finite(config.entryEndHour, 10);
    const minimumRangeAtr = finite(config.minimumRangeAtr, 0.75);
    const maximumRangeAtr = finite(config.maximumRangeAtr, 3);
    const breakoutBufferAtr = finite(config.breakoutBufferAtr, 0.1);

    return async (context) => {
        const candles = context.candles;
        if (candles.length < 200) return hold("SESSION_EXPANSION_WARMUP");
        const current = utcParts(context.timestamp);
        if (current.weekday === 0 || current.weekday === 6) {
            return hold("SESSION_EXPANSION_WEEKEND");
        }
        if (current.hour < entryStartHour || current.hour >= entryEndHour) {
            return hold("SESSION_EXPANSION_OUTSIDE_ENTRY_WINDOW");
        }
        const sessionCandles = candles.slice(-100).filter((candle) => {
            const parts = utcParts(candle.time);
            return (
                parts.day === current.day &&
                parts.hour >= rangeStartHour &&
                parts.hour < rangeEndHour
            );
        });
        if (sessionCandles.length < (rangeEndHour - rangeStartHour) * 3) {
            return hold("SESSION_EXPANSION_INCOMPLETE_RANGE");
        }
        const atrValue = atr(candles.slice(-200), 14);
        if (!atrValue) return hold("SESSION_EXPANSION_NO_ATR");
        const rangeHigh = Math.max(...sessionCandles.map((candle) => candle.high));
        const rangeLow = Math.min(...sessionCandles.map((candle) => candle.low));
        const range = rangeHigh - rangeLow;
        const ratio = range / atrValue;
        if (ratio < minimumRangeAtr || ratio > maximumRangeAtr) {
            return hold("SESSION_EXPANSION_RANGE_REGIME");
        }
        const buffer = breakoutBufferAtr * atrValue;
        const previous = candles[candles.length - 2];
        const currentCandle = candles[candles.length - 1];
        const longBreak =
            previous.close <= rangeHigh + buffer &&
            currentCandle.close > rangeHigh + buffer;
        const shortBreak =
            previous.close >= rangeLow - buffer &&
            currentCandle.close < rangeLow - buffer;
        if (!longBreak && !shortBreak) return hold("SESSION_EXPANSION_NO_BREAK");
        const direction = longBreak ? 1 : -1;
        const stopDistance = Math.max(
            atrValue * finite(config.stopAtr, 1.5),
            range * finite(config.stopRangeFraction, 0.5),
            pipSize(context.instrument) * finite(config.minimumStopPips, 8)
        );
        return tradeSignal(context, direction, stopDistance, {
            family: "session_expansion",
            entryType: "SESSION_RANGE_BREAKOUT",
            reasonCode: longBreak
                ? "SESSION_EXPANSION_LONG_ENTRY"
                : "SESSION_EXPANSION_SHORT_ENTRY",
            riskReward: config.riskReward,
            maxHoldingBars: config.maxHoldingBars,
        });
    };
}

function mediumTermTrend(variant) {
    const config = variant.config || variant;
    const fastBars = Math.max(2, Math.floor(finite(config.fastBars, 192)));
    const slowBars = Math.max(fastBars + 1, Math.floor(finite(config.slowBars, 768)));
    const breakoutBars = Math.max(4, Math.floor(finite(config.breakoutBars, 384)));
    const exitBars = Math.max(2, Math.floor(finite(config.exitBars, Math.floor(breakoutBars / 4))));

    return async (context) => {
        const candles = context.candles;
        const warmup = Math.max(slowBars * 2, breakoutBars + 2);
        if (candles.length < warmup) return hold("MEDIUM_TREND_WARMUP");
        const current = candles[candles.length - 1];
        if (context.position) {
            const exitChannel = candles.slice(-(exitBars + 1), -1);
            const exitLow = Math.min(...exitChannel.map((candle) => candle.low));
            const exitHigh = Math.max(...exitChannel.map((candle) => candle.high));
            if (context.position.direction === 1 && current.close < exitLow) {
                return {
                    signal: "SELL",
                    intent: "EXIT_LONG_ONLY",
                    signalClass: "ACTIONABLE",
                    reasonCode: "MEDIUM_TREND_LONG_CHANNEL_EXIT",
                    entryType: "EXIT_ONLY",
                };
            }
            if (context.position.direction === -1 && current.close > exitHigh) {
                return {
                    signal: "BUY",
                    intent: "EXIT_SHORT_ONLY",
                    signalClass: "ACTIONABLE",
                    reasonCode: "MEDIUM_TREND_SHORT_CHANNEL_EXIT",
                    entryType: "EXIT_ONLY",
                };
            }
            return hold("MEDIUM_TREND_POSITION_OPEN");
        }
        const closes = candles
            .slice(-Math.max(slowBars * 2, breakoutBars + 2))
            .map((candle) => candle.close);
        const fast = ema(closes.slice(-slowBars * 2), fastBars);
        const slow = ema(closes.slice(-slowBars * 2), slowBars);
        const channel = candles.slice(-(breakoutBars + 1), -1);
        const high = Math.max(...channel.map((candle) => candle.high));
        const low = Math.min(...channel.map((candle) => candle.low));
        const previous = candles[candles.length - 2];
        const previousChannel = candles.slice(-(breakoutBars + 2), -2);
        const previousHigh = Math.max(...previousChannel.map((candle) => candle.high));
        const previousLow = Math.min(...previousChannel.map((candle) => candle.low));
        const direction =
            fast > slow && previous.close <= previousHigh && current.close > high
                ? 1
                : fast < slow && previous.close >= previousLow && current.close < low
                  ? -1
                  : 0;
        if (!direction) return hold("MEDIUM_TREND_NO_BREAKOUT");
        const atrValue = atr(candles.slice(-200), 14);
        if (!atrValue) return hold("MEDIUM_TREND_NO_ATR");
        return tradeSignal(context, direction, atrValue * finite(config.stopAtr, 3), {
            family: "medium_term_trend",
            entryType: "MEDIUM_TERM_CHANNEL_BREAKOUT",
            reasonCode: direction > 0 ? "MEDIUM_TREND_LONG_ENTRY" : "MEDIUM_TREND_SHORT_ENTRY",
            riskReward: config.riskReward,
            maxHoldingBars: config.maxHoldingBars,
        });
    };
}

function pullbackContinuation(variant) {
    const config = variant.config || variant;
    return async (context) => {
        const candles = context.candles;
        if (candles.length < 500) return hold("PULLBACK_CONTINUATION_WARMUP");
        const closes = candles.slice(-500).map((candle) => candle.close);
        const previousCloses = closes.slice(0, -1);
        const fast = ema(closes.slice(-400), finite(config.fastBars, 48));
        const slow = ema(closes.slice(-500), finite(config.slowBars, 192));
        const trigger = ema(closes.slice(-150), finite(config.triggerBars, 20));
        const previousTrigger = ema(previousCloses.slice(-150), finite(config.triggerBars, 20));
        const current = candles[candles.length - 1];
        const previous = candles[candles.length - 2];
        const longPullback = fast > slow && previous.close <= previousTrigger && current.close > trigger;
        const shortPullback = fast < slow && previous.close >= previousTrigger && current.close < trigger;
        if (!longPullback && !shortPullback) return hold("PULLBACK_CONTINUATION_NO_RECLAIM");
        const atrValue = atr(candles.slice(-200), 14);
        if (!atrValue) return hold("PULLBACK_CONTINUATION_NO_ATR");
        const direction = longPullback ? 1 : -1;
        return tradeSignal(context, direction, atrValue * finite(config.stopAtr, 2), {
            family: "pullback_continuation",
            entryType: "TREND_PULLBACK_RECLAIM",
            reasonCode: direction > 0 ? "PULLBACK_CONTINUATION_LONG_ENTRY" : "PULLBACK_CONTINUATION_SHORT_ENTRY",
            riskReward: config.riskReward,
            maxHoldingBars: config.maxHoldingBars,
        });
    };
}

function meanReversion(variant) {
    const config = variant.config || variant;
    const lookbackBars = Math.max(20, Math.floor(finite(config.lookbackBars, 96)));
    return async (context) => {
        const candles = context.candles;
        if (candles.length < lookbackBars + 20) return hold("MEAN_REVERSION_WARMUP");
        const closes = candles.slice(-lookbackBars).map((candle) => candle.close);
        const mean = average(closes);
        const deviation = standardDeviation(closes);
        if (!deviation) return hold("MEAN_REVERSION_NO_VOLATILITY");
        const zScore = (closes[closes.length - 1] - mean) / deviation;
        const previousWindow = candles
            .slice(-(lookbackBars + 1), -1)
            .map((candle) => candle.close);
        const previousMean = average(previousWindow);
        const previousDeviation = standardDeviation(previousWindow);
        const previousZScore = previousDeviation
            ? (previousWindow[previousWindow.length - 1] - previousMean) /
              previousDeviation
            : 0;
        const entryZ = finite(config.entryZ, 2.25);
        const direction =
            zScore <= -entryZ && previousZScore > -entryZ
                ? 1
                : zScore >= entryZ && previousZScore < entryZ
                  ? -1
                  : 0;
        if (!direction) return hold("MEAN_REVERSION_NO_EXTREME");
        const trendFast = ema(closes, Math.max(10, Math.floor(lookbackBars / 4)));
        const trendSlow = ema(closes, Math.max(20, Math.floor(lookbackBars / 2)));
        if (Math.abs(trendFast - trendSlow) > deviation * finite(config.maxTrendStd, 0.35)) {
            return hold("MEAN_REVERSION_TREND_FILTER");
        }
        const atrValue = atr(candles.slice(-200), 14);
        if (!atrValue) return hold("MEAN_REVERSION_NO_ATR");
        const stopDistance = atrValue * finite(config.stopAtr, 1.5);
        const targetDistance = Math.abs(mean - context.candle.close);
        const rewardRisk = targetDistance / stopDistance;
        if (rewardRisk < finite(config.minimumRiskReward, 1.2)) {
            return hold("MEAN_REVERSION_INSUFFICIENT_EDGE");
        }
        return tradeSignal(context, direction, stopDistance, {
            family: "mean_reversion",
            entryType: "ROLLING_ZSCORE_FADE",
            reasonCode: direction > 0 ? "MEAN_REVERSION_LONG_ENTRY" : "MEAN_REVERSION_SHORT_ENTRY",
            riskReward: Math.min(finite(config.maximumRiskReward, 2.5), rewardRisk),
            maxHoldingBars: config.maxHoldingBars,
        });
    };
}

function antiUsdSign(instrument) {
    const [base, quote] = instrument.split("_");
    if (quote === "USD") return 1;
    if (base === "USD") return -1;
    return 0;
}

function crossSectionalMomentum(variant) {
    const config = variant.config || variant;
    const lookbackBars = Math.max(20, Math.floor(finite(config.lookbackBars, 480)));
    const rebalanceHour = Math.floor(finite(config.rebalanceHour, 0));
    const rebalanceWeekday = Math.floor(finite(config.rebalanceWeekday, 2));
    const rebalanceWeekOfMonth = finite(config.rebalanceWeekOfMonth, null);
    const lastSignalDay = new Map();
    return async (context) => {
        const current = utcParts(context.timestamp);
        if (
            current.hour !== rebalanceHour ||
            current.weekday !== rebalanceWeekday ||
            (Number.isFinite(rebalanceWeekOfMonth) &&
                current.weekOfMonth !== rebalanceWeekOfMonth)
        ) {
            return hold("CROSS_SECTIONAL_OUTSIDE_REBALANCE");
        }
        if (lastSignalDay.get(context.instrument) === current.day) {
            return hold("CROSS_SECTIONAL_ALREADY_REBALANCED");
        }
        const scores = [];
        for (const [instrument, candles] of context.histories.entries()) {
            if (candles.length <= lookbackBars) continue;
            const sign = antiUsdSign(instrument);
            if (!sign) continue;
            const currentClose = candles[candles.length - 1].close;
            const pastClose = candles[candles.length - 1 - lookbackBars].close;
            scores.push({
                instrument,
                score: Math.log(currentClose / pastClose) * sign,
            });
        }
        if (scores.length < 4) return hold("CROSS_SECTIONAL_INCOMPLETE_UNIVERSE");
        scores.sort((left, right) => left.score - right.score);
        const loser = scores[0];
        const winner = scores[scores.length - 1];
        const selected =
            context.instrument === winner.instrument
                ? { rankDirection: 1, score: winner.score }
                : context.instrument === loser.instrument
                  ? { rankDirection: -1, score: loser.score }
                  : null;
        if (!selected) return hold("CROSS_SECTIONAL_MIDDLE_RANK");
        const minimumDispersionBps = finite(config.minimumDispersionBps, 15);
        if ((winner.score - loser.score) * 10000 < minimumDispersionBps) {
            return hold("CROSS_SECTIONAL_LOW_DISPERSION");
        }
        const direction = selected.rankDirection * antiUsdSign(context.instrument);
        const atrValue = atr(context.candles.slice(-200), 14);
        if (!atrValue) return hold("CROSS_SECTIONAL_NO_ATR");
        lastSignalDay.set(context.instrument, current.day);
        return tradeSignal(context, direction, atrValue * finite(config.stopAtr, 3), {
            family: "cross_sectional_momentum",
            entryType: "CURRENCY_RELATIVE_MOMENTUM",
            reasonCode: direction > 0 ? "CROSS_SECTIONAL_LONG_ENTRY" : "CROSS_SECTIONAL_SHORT_ENTRY",
            riskReward: config.riskReward,
            maxHoldingBars: config.maxHoldingBars,
        });
    };
}

module.exports = function createResearchStrategy(variant = {}) {
    const family = variant.family || variant.config?.family;
    let strategy;
    switch (family) {
        case "session_expansion":
            strategy = sessionExpansion(variant);
            break;
        case "medium_term_trend":
            strategy = mediumTermTrend(variant);
            break;
        case "pullback_continuation":
            strategy = pullbackContinuation(variant);
            break;
        case "mean_reversion":
            strategy = meanReversion(variant);
            break;
        case "cross_sectional_momentum":
            strategy = crossSectionalMomentum(variant);
            break;
        default:
            throw new Error(`Unknown research strategy family: ${family}`);
    }
    const instruments = Array.isArray(variant.config?.instruments)
        ? new Set(variant.config.instruments)
        : null;
    if (!instruments) return strategy;
    return async (context) =>
        instruments.has(context.instrument)
            ? strategy(context)
            : hold("INSTRUMENT_NOT_SELECTED");
};

module.exports._internals = {
    antiUsdSign,
    atr,
    ema,
    standardDeviation,
    utcParts,
};
