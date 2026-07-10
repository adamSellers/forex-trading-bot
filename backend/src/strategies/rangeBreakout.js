const { ATR } = require("technicalindicators");
const { calculateExpectedEdge } = require("./expectedEdge");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_RANGE_BREAKOUT_CONFIG = Object.freeze({
    useTimezoneAwareSessions: true,
    londonTimeZone: "Europe/London",
    londonOpenLocalHour: 8,
    newYorkTimeZone: "America/New_York",
    newYorkOpenLocalHour: 8,
    londonOpenHourUTC: 7,
    nyOpenHourUTC: 12,
    rangeMinAtrRatio: 0.5,
    rangeMaxAtrRatio: 2.0,
    tpRangeMultiplier: 1.5,
    trailActivationMultiplier: 1.0,
    trailDistanceMultiplier: 0.5,
    maxBreakoutBodyRatio: 0.7,
    requireBreakoutQuality: true,
    breakoutCompressionLookbackCandles: 6,
    maxBreakoutCompressionRatio: 0.75,
    breakoutAcceptanceCloses: 2,
    breakoutRetestToleranceRatio: 0.15,
    entryWindowHours: 4,
    sessionCloseHourUTC: 17,
});

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getTimestampMs(value) {
    if (typeof value === "number") {
        return value > 1e12 ? value : value * 1000;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getZonedHourMinute(timestampMs, timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(timestampMs));
    const read = (type) => Number(parts.find((part) => part.type === type)?.value);
    return { hour: read("hour"), minute: read("minute") };
}

function resolveOpeningSession(timestampMs, config = {}) {
    const timestamp = new Date(timestampMs);
    if (config.useTimezoneAwareSessions === false) {
        const hour = timestamp.getUTCHours();
        const minute = timestamp.getUTCMinutes();
        if (minute !== 0) return null;
        if (hour === Math.max(0, toFiniteNumber(config.londonOpenHourUTC, 7))) {
            return "London";
        }
        if (hour === Math.max(0, toFiniteNumber(config.nyOpenHourUTC, 12))) {
            return "New York";
        }
        return null;
    }

    const london = getZonedHourMinute(
        timestampMs,
        config.londonTimeZone || "Europe/London"
    );
    if (
        london.minute === 0 &&
        london.hour === toFiniteNumber(config.londonOpenLocalHour, 8)
    ) {
        return "London";
    }
    const newYork = getZonedHourMinute(
        timestampMs,
        config.newYorkTimeZone || "America/New_York"
    );
    if (
        newYork.minute === 0 &&
        newYork.hour === toFiniteNumber(config.newYorkOpenLocalHour, 8)
    ) {
        return "New York";
    }
    return null;
}

function getPipValue(instrument, dataService = null) {
    const pipValue = dataService?.getPipValue?.(instrument);
    if (Number.isFinite(Number(pipValue))) {
        return Number(pipValue);
    }

    return instrument?.includes("JPY") ? 0.01 : 0.0001;
}

function getLastIndicatorValue(series = []) {
    if (!Array.isArray(series) || series.length === 0) {
        return null;
    }

    return toFiniteNumber(series[series.length - 1], null);
}

function deriveAtrFromCandles(candles = []) {
    if (!Array.isArray(candles) || candles.length < 14) {
        return null;
    }

    const atrSeries = ATR.calculate({
        high: candles.map((candle) => candle.high),
        low: candles.map((candle) => candle.low),
        close: candles.map((candle) => candle.close),
        period: 14,
    });

    return getLastIndicatorValue(atrSeries);
}

function buildStrategyContext(context = {}, overrides = {}) {
    const config = overrides.config || context.config || {};
    const openingRange = overrides.openingRange || context.openingRange || null;
    const entryPrice = toFiniteNumber(context.currentPrice, null);
    const high = toFiniteNumber(openingRange?.high, null);
    const low = toFiniteNumber(openingRange?.low, null);
    const height = toFiniteNumber(openingRange?.height, null);
    const h1Atr = toFiniteNumber(context.atrVal, null);
    const atrRatio =
        Number.isFinite(height) && Number.isFinite(h1Atr) && h1Atr > 0
            ? height / h1Atr
            : toFiniteNumber(context.atrRatio, null);
    const bodyRatio = toFiniteNumber(context.bodyRatio, null);
    let breakoutState = "waiting";

    if (Number.isFinite(entryPrice) && Number.isFinite(high) && entryPrice > high) {
        breakoutState = "above_range";
    } else if (
        Number.isFinite(entryPrice) &&
        Number.isFinite(low) &&
        entryPrice < low
    ) {
        breakoutState = "below_range";
    } else if (openingRange) {
        breakoutState = "inside_range";
    }

    return {
        family: "range_breakout",
        setup: overrides.setup || "opening_range",
        entryBias: overrides.entryBias || null,
        breakoutState,
        currentPrice: entryPrice,
        openingRange: openingRange
            ? {
                  session: openingRange.session || null,
                  high,
                  low,
                  height,
                  formedAt: openingRange.formedAt || null,
                  ageMinutes: Number.isFinite(openingRange.ageMs)
                      ? Math.round(openingRange.ageMs / 60000)
                      : null,
                  atrRatio,
              }
            : null,
        h1: {
            atr: h1Atr,
            atrPips: toFiniteNumber(context.atrPips, null),
        },
        candle: {
            bodyRatio,
        },
        breakoutQuality:
            overrides.breakoutQuality || context.breakoutQuality || null,
        thresholds: {
            rangeMinAtrRatio: toFiniteNumber(config.rangeMinAtrRatio, 0.5),
            rangeMaxAtrRatio: toFiniteNumber(config.rangeMaxAtrRatio, 2.0),
            maxBreakoutBodyRatio: toFiniteNumber(config.maxBreakoutBodyRatio, 0.7),
            entryWindowHours: toFiniteNumber(config.entryWindowHours, 4),
        },
        expectedEdge: overrides.expectedEdge || context.expectedEdge || null,
        session: {
            name: context.sessionName || null,
            spreadPips: toFiniteNumber(context.spreadPips, null),
        },
    };
}

function createHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: range breakout filters not met",
        reasonCode: overrides.reasonCode || "RANGE_BREAKOUT_FILTERED",
        signalClass: overrides.signalClass || "FILTERED",
        intent: overrides.intent || "WAIT",
        entryType: null,
        signalCandleTime: context.currentCandle?.time || null,
        atrVal: context.atrVal || 0,
        atrPips: context.atrPips || 0,
        currentPrice: context.currentPrice ?? null,
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
            timeframe: "1h",
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason:
                overrides.htfReason ||
                (Number.isFinite(context.atrVal)
                    ? `H1 ATR ${context.atrVal.toFixed(5)}`
                    : "H1 ATR unavailable"),
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        strategyContext:
            overrides.strategyContext || buildStrategyContext(context, overrides),
    };
}

function buildOpeningRange(candles = [], currentTimeMs, config = {}) {
    const timeframeMs = 5 * 60 * 1000;
    const candleMap = new Map(
        candles.map((candle) => [getTimestampMs(candle.time), candle])
    );

    const candidates = candles
        .map((candle) => {
            const timestampMs = getTimestampMs(candle.time);
            if (!Number.isFinite(timestampMs)) {
                return null;
            }

            const session = resolveOpeningSession(timestampMs, config);
            if (!session) {
                return null;
            }

            const rangeCandles = [];
            for (let index = 0; index < 12; index += 1) {
                const targetTime = timestampMs + index * timeframeMs;
                const rangeCandle = candleMap.get(targetTime);
                if (!rangeCandle) {
                    return null;
                }
                rangeCandles.push(rangeCandle);
            }

            const formedAt = timestampMs + 12 * timeframeMs;
            const ageMs = currentTimeMs - formedAt;
            const maxAgeMs =
                Math.max(1, toFiniteNumber(config.entryWindowHours, 4)) *
                60 *
                60 *
                1000;

            if (ageMs < 0 || ageMs > maxAgeMs) {
                return null;
            }

            const openingRangeHigh = Math.max(
                ...rangeCandles.map((rangeCandle) => rangeCandle.high)
            );
            const openingRangeLow = Math.min(
                ...rangeCandles.map((rangeCandle) => rangeCandle.low)
            );

            return {
                session,
                formedAt,
                ageMs,
                high: openingRangeHigh,
                low: openingRangeLow,
                height: openingRangeHigh - openingRangeLow,
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.formedAt - left.formedAt);

    return candidates[0] || null;
}

function buildBreakoutQualityContext({
    m5Candles = [],
    currentTimeMs = null,
    openingRange = null,
    config = {},
} = {}) {
    const high = toFiniteNumber(openingRange?.high, null);
    const low = toFiniteNumber(openingRange?.low, null);
    const height = toFiniteNumber(openingRange?.height, null);
    const formedAt = toFiniteNumber(openingRange?.formedAt, null);

    if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(height) ||
        height <= 0 ||
        !Number.isFinite(formedAt) ||
        !Number.isFinite(currentTimeMs)
    ) {
        return {
            compressionOk: false,
            longAcceptanceOk: false,
            shortAcceptanceOk: false,
            longQualityOk: false,
            shortQualityOk: false,
            reason: "breakout quality context unavailable",
        };
    }

    const postRangeCandles = m5Candles.filter((candle) => {
        const timestampMs = getTimestampMs(candle.time);
        return (
            Number.isFinite(timestampMs) &&
            timestampMs >= formedAt &&
            timestampMs <= currentTimeMs
        );
    });
    const lookback = Math.max(
        3,
        Math.floor(toFiniteNumber(config.breakoutCompressionLookbackCandles, 6))
    );
    const recentCandles = postRangeCandles.slice(-lookback);
    const recentHigh = Math.max(
        ...recentCandles.map((candle) => toFiniteNumber(candle.high, -Infinity))
    );
    const recentLow = Math.min(
        ...recentCandles.map((candle) => toFiniteNumber(candle.low, Infinity))
    );
    const compressionRatio =
        recentCandles.length > 0 && Number.isFinite(recentHigh) && Number.isFinite(recentLow)
            ? (recentHigh - recentLow) / height
            : null;
    const recentClosesInside =
        recentCandles.length >= lookback &&
        recentCandles.every((candle) => {
            const close = toFiniteNumber(candle.close, null);
            return Number.isFinite(close) && close <= high && close >= low;
        });
    const compressionOk =
        recentClosesInside &&
        Number.isFinite(compressionRatio) &&
        compressionRatio <= toFiniteNumber(config.maxBreakoutCompressionRatio, 0.75);
    const requiredAcceptanceCloses = Math.max(
        1,
        Math.floor(toFiniteNumber(config.breakoutAcceptanceCloses, 2))
    );
    const retestTolerance =
        height * toFiniteNumber(config.breakoutRetestToleranceRatio, 0.15);
    const longAcceptedCloses = postRangeCandles.filter(
        (candle) => toFiniteNumber(candle.close, null) > high
    ).length;
    const shortAcceptedCloses = postRangeCandles.filter(
        (candle) => toFiniteNumber(candle.close, null) < low
    ).length;
    const longRetestOk = postRangeCandles.some((candle, index) => {
        const previousClose =
            index > 0 ? toFiniteNumber(postRangeCandles[index - 1].close, null) : null;
        const lowPrice = toFiniteNumber(candle.low, null);
        const close = toFiniteNumber(candle.close, null);
        return (
            Number.isFinite(previousClose) &&
            previousClose > high &&
            Number.isFinite(lowPrice) &&
            lowPrice <= high + retestTolerance &&
            Number.isFinite(close) &&
            close > high
        );
    });
    const shortRetestOk = postRangeCandles.some((candle, index) => {
        const previousClose =
            index > 0 ? toFiniteNumber(postRangeCandles[index - 1].close, null) : null;
        const highPrice = toFiniteNumber(candle.high, null);
        const close = toFiniteNumber(candle.close, null);
        return (
            Number.isFinite(previousClose) &&
            previousClose < low &&
            Number.isFinite(highPrice) &&
            highPrice >= low - retestTolerance &&
            Number.isFinite(close) &&
            close < low
        );
    });
    const longAcceptanceOk =
        longAcceptedCloses >= requiredAcceptanceCloses || longRetestOk;
    const shortAcceptanceOk =
        shortAcceptedCloses >= requiredAcceptanceCloses || shortRetestOk;

    return {
        compressionOk,
        compressionRatio: toFiniteNumber(compressionRatio, null),
        compressionLookback: lookback,
        longAcceptedCloses,
        shortAcceptedCloses,
        longRetestOk,
        shortRetestOk,
        longAcceptanceOk,
        shortAcceptanceOk,
        longQualityOk: compressionOk || longAcceptanceOk,
        shortQualityOk: compressionOk || shortAcceptanceOk,
    };
}

async function evaluateRangeBreakoutEntry({
    instrument,
    candles = [],
    currentPrice,
    config = {},
    dataService = null,
    marketContext = null,
}) {
    if (!Array.isArray(candles) || candles.length < 2) {
        return createHoldResult(
            {
                currentPrice,
            },
            {
                reason: "HOLD: range breakout requires at least two M15 candles",
                reasonCode: "RANGE_BREAKOUT_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_RANGE_BREAKOUT_CONFIG,
        ...(config || {}),
    };
    const m5Candles = marketContext?.timeframes?.["5m"]?.candles || [];
    const h1Context = marketContext?.timeframes?.["1h"] || {};
    const currentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];
    const currentTimeMs = getTimestampMs(currentCandle.time);
    const entryPrice = toFiniteNumber(currentPrice, currentCandle.close);
    const h1Atr =
        getLastIndicatorValue(h1Context.indicators?.atr) ||
        deriveAtrFromCandles(h1Context.candles || []);
    const pipValue = getPipValue(instrument, dataService);
    const atrPips =
        Number.isFinite(h1Atr) && pipValue > 0 ? h1Atr / pipValue : 0;
    const spreadPips = toFiniteNumber(
        marketContext?.session?.spreadPips ?? marketContext?.price?.spread,
        null
    );
    const evaluationContext = {
        currentCandle,
        currentPrice: entryPrice,
        atrVal: h1Atr,
        atrPips,
        config: resolvedConfig,
        sessionName: marketContext?.session?.session || null,
        spreadPips,
    };

    if (!Array.isArray(m5Candles) || m5Candles.length < 12) {
        return createHoldResult(evaluationContext, {
            reason: "HOLD: opening-range M5 context is unavailable",
            reasonCode: "RANGE_BREAKOUT_NO_M5_CONTEXT",
        });
    }

    if (!Number.isFinite(currentTimeMs) || !Number.isFinite(entryPrice)) {
        return createHoldResult(evaluationContext, {
            reason: "HOLD: current candle timing is unavailable",
            reasonCode: "RANGE_BREAKOUT_NO_CURRENT_CANDLE",
        });
    }

    if (
        Number.isFinite(spreadPips) &&
        spreadPips > toFiniteNumber(resolvedConfig.maxSpreadPips, Infinity)
    ) {
        return createHoldResult(evaluationContext, {
            reason: `HOLD: spread ${spreadPips.toFixed(1)} is above the configured threshold`,
            reasonCode: "RANGE_BREAKOUT_SPREAD_FILTERED",
        });
    }

    if (!Number.isFinite(h1Atr) || h1Atr <= 0) {
        return createHoldResult(evaluationContext, {
            reason: "HOLD: H1 ATR context is unavailable",
            reasonCode: "RANGE_BREAKOUT_NO_H1_ATR",
        });
    }

    const openingRange =
        marketContext?.timeframes?.["5m"]?.derived?.rangeBreakout ||
        buildOpeningRange(m5Candles, currentTimeMs, resolvedConfig);

    if (!openingRange) {
        return createHoldResult(evaluationContext, {
            reason: "HOLD: no eligible London or New York opening range is active",
            reasonCode: "RANGE_BREAKOUT_NO_ACTIVE_RANGE",
        });
    }

    evaluationContext.openingRange = openingRange;
    const rangeHeight = openingRange.height;
    const atrRatio = rangeHeight / h1Atr;
    evaluationContext.atrRatio = atrRatio;
    if (
        atrRatio < toFiniteNumber(resolvedConfig.rangeMinAtrRatio, 0.5) ||
        atrRatio > toFiniteNumber(resolvedConfig.rangeMaxAtrRatio, 2.0)
    ) {
        return createHoldResult(evaluationContext, {
            reason:
                `HOLD: opening-range height ${rangeHeight.toFixed(5)} is outside the ATR band ` +
                `(${atrRatio.toFixed(2)}x)`,
            reasonCode: "RANGE_BREAKOUT_RANGE_FILTERED",
        });
    }

    const candleBody = Math.abs(
        toFiniteNumber(currentCandle.close, entryPrice) -
            toFiniteNumber(currentCandle.open, entryPrice)
    );
    const maxBodyRatio = toFiniteNumber(
        resolvedConfig.maxBreakoutBodyRatio,
        0.7
    );
    evaluationContext.bodyRatio = candleBody / Math.max(rangeHeight, 0.00001);
    if (rangeHeight <= 0 || candleBody / rangeHeight > maxBodyRatio) {
        return createHoldResult(evaluationContext, {
            reason:
                `HOLD: breakout candle body ${(candleBody / Math.max(rangeHeight, 0.00001)).toFixed(2)} ` +
                "is too extended",
            reasonCode: "RANGE_BREAKOUT_BODY_FILTERED",
        });
    }

    const longBreakout =
        entryPrice > openingRange.high &&
        toFiniteNumber(previousCandle.close, entryPrice) <= openingRange.high;
    const shortBreakout =
        entryPrice < openingRange.low &&
        toFiniteNumber(previousCandle.close, entryPrice) >= openingRange.low;
    const takeProfitDistance =
        rangeHeight * toFiniteNumber(resolvedConfig.tpRangeMultiplier, 1.5);
    const breakoutQuality = buildBreakoutQualityContext({
        m5Candles,
        currentTimeMs,
        openingRange,
        config: resolvedConfig,
    });
    evaluationContext.breakoutQuality = breakoutQuality;
    const requireBreakoutQuality = resolvedConfig.requireBreakoutQuality !== false;

    if (
        requireBreakoutQuality &&
        ((longBreakout && !breakoutQuality.longQualityOk) ||
            (shortBreakout && !breakoutQuality.shortQualityOk))
    ) {
        return createHoldResult(evaluationContext, {
            reason:
                `HOLD: breakout lacks acceptance/retest or compression | ` +
                `compression ${breakoutQuality.compressionOk ? "yes" : "no"} | ` +
                `acceptance ${
                    longBreakout
                        ? breakoutQuality.longAcceptanceOk
                            ? "yes"
                            : "no"
                        : breakoutQuality.shortAcceptanceOk
                        ? "yes"
                        : "no"
                }`,
            reasonCode: "RANGE_BREAKOUT_QUALITY_FILTERED",
        });
    }

    if (longBreakout) {
        const tradePlan = {
            stopLossPrice: openingRange.low,
            takeProfitPrice: entryPrice + takeProfitDistance,
        };
        const expectedEdge = calculateExpectedEdge({
            entryPrice,
            stopLossPrice: tradePlan.stopLossPrice,
            takeProfitPrice: tradePlan.takeProfitPrice,
            pipValue,
            spreadPips,
            slippagePips: resolvedConfig.expectedSlippagePips,
            minNetEdgePips: resolvedConfig.minNetEdgePips,
        });
        return {
            signalType: "BUY",
            reason:
                `BUY: ${openingRange.session} opening-range breakout | close ${entryPrice.toFixed(5)} > ` +
                `${openingRange.high.toFixed(5)} | range ${atrRatio.toFixed(2)}x H1 ATR`,
            reasonCode: "RANGE_BREAKOUT_LONG_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_LONG",
            entryType: "RANGE_BREAKOUT_OPENING_RANGE",
            signalCandleTime: currentCandle.time,
            atrVal: h1Atr,
            atrPips,
            currentPrice: entryPrice,
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
                timeframe: "1h",
                direction: 0,
                longAllowed: true,
                shortAllowed: true,
                reason: `H1 ATR ${h1Atr.toFixed(5)} validates the opening-range size`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan,
            expectedEdge,
            strategyContext: buildStrategyContext(evaluationContext, {
                config: resolvedConfig,
                openingRange,
                breakoutQuality,
                expectedEdge,
                setup: "opening_range_breakout",
                entryBias: "long",
            }),
        };
    }

    if (shortBreakout) {
        const tradePlan = {
            stopLossPrice: openingRange.high,
            takeProfitPrice: entryPrice - takeProfitDistance,
        };
        const expectedEdge = calculateExpectedEdge({
            entryPrice,
            stopLossPrice: tradePlan.stopLossPrice,
            takeProfitPrice: tradePlan.takeProfitPrice,
            pipValue,
            spreadPips,
            slippagePips: resolvedConfig.expectedSlippagePips,
            minNetEdgePips: resolvedConfig.minNetEdgePips,
        });
        return {
            signalType: "SELL",
            reason:
                `SELL: ${openingRange.session} opening-range breakdown | close ${entryPrice.toFixed(5)} < ` +
                `${openingRange.low.toFixed(5)} | range ${atrRatio.toFixed(2)}x H1 ATR`,
            reasonCode: "RANGE_BREAKOUT_SHORT_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_SHORT",
            entryType: "RANGE_BREAKOUT_OPENING_RANGE",
            signalCandleTime: currentCandle.time,
            atrVal: h1Atr,
            atrPips,
            currentPrice: entryPrice,
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
                timeframe: "1h",
                direction: 0,
                longAllowed: true,
                shortAllowed: true,
                reason: `H1 ATR ${h1Atr.toFixed(5)} validates the opening-range size`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan,
            expectedEdge,
            strategyContext: buildStrategyContext(evaluationContext, {
                config: resolvedConfig,
                openingRange,
                breakoutQuality,
                expectedEdge,
                setup: "opening_range_breakdown",
                entryBias: "short",
            }),
        };
    }

    return createHoldResult(evaluationContext, {
        reason:
            `HOLD: waiting for a fresh breakout beyond ${openingRange.high.toFixed(5)} / ` +
            `${openingRange.low.toFixed(5)}`,
        reasonCode: "RANGE_BREAKOUT_WAIT",
    });
}

const rangeBreakoutStrategy = createStrategyDefinition({
    key: "range_breakout",
    label: "Range Breakout",
    description:
        "Candidate paper strategy focused on breakout continuation once intraday ranges compress and release.",
    phaseIntroduced: 3,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["5m", "15m", "1h"],
        marketData: ["candles", "price", "session", "spread"],
        indicators: ["atr", "range", "breakout_levels"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
        defaultConfig: DEFAULT_RANGE_BREAKOUT_CONFIG,
    },
    evaluateEntry: evaluateRangeBreakoutEntry,
});

module.exports = Object.assign({}, rangeBreakoutStrategy, {
    DEFAULT_RANGE_BREAKOUT_CONFIG,
    evaluateRangeBreakoutEntry,
    buildOpeningRange,
    buildBreakoutQualityContext,
    getZonedHourMinute,
    resolveOpeningSession,
});
