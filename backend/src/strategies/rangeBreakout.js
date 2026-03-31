const { ATR } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_RANGE_BREAKOUT_CONFIG = Object.freeze({
    londonOpenHourUTC: 7,
    nyOpenHourUTC: 12,
    rangeMinAtrRatio: 0.5,
    rangeMaxAtrRatio: 2.0,
    tpRangeMultiplier: 1.5,
    trailActivationMultiplier: 1.0,
    trailDistanceMultiplier: 0.5,
    maxBreakoutBodyRatio: 0.7,
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
    };
}

function buildOpeningRange(candles = [], currentTimeMs, config = {}) {
    const timeframeMs = 5 * 60 * 1000;
    const sessionStarts = new Set([
        Math.max(0, toFiniteNumber(config.londonOpenHourUTC, 7)),
        Math.max(0, toFiniteNumber(config.nyOpenHourUTC, 12)),
    ]);
    const candleMap = new Map(
        candles.map((candle) => [getTimestampMs(candle.time), candle])
    );

    const candidates = candles
        .map((candle) => {
            const timestampMs = getTimestampMs(candle.time);
            if (!Number.isFinite(timestampMs)) {
                return null;
            }

            const timestamp = new Date(timestampMs);
            if (
                timestamp.getUTCMinutes() !== 0 ||
                !sessionStarts.has(timestamp.getUTCHours())
            ) {
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
                session:
                    timestamp.getUTCHours() ===
                    Math.max(0, toFiniteNumber(config.londonOpenHourUTC, 7))
                        ? "London"
                        : "New York",
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

    const rangeHeight = openingRange.height;
    const atrRatio = rangeHeight / h1Atr;
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

    if (longBreakout) {
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
            tradePlan: {
                stopLossPrice: openingRange.low,
                takeProfitPrice: entryPrice + takeProfitDistance,
            },
        };
    }

    if (shortBreakout) {
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
            tradePlan: {
                stopLossPrice: openingRange.high,
                takeProfitPrice: entryPrice - takeProfitDistance,
            },
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
});
