const { ATR } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_STOCHASTIC_DIVERGENCE_CONFIG = Object.freeze({
    stochPeriod: 14,
    stochSignalPeriod: 3,
    stochSmoothK: 3,
    pivotWindow: 2,
    maxPivotLookback: 30,
    minPivotSeparationBars: 5,
    minPriceDivergenceAtr: 0.1,
    minOscillatorDivergencePoints: 3,
    oversoldZone: 20,
    overboughtZone: 80,
    htfStochThreshold: 50,
    requireHtfSlopeConfirmation: true,
    tpSlMultiplier: 2.0,
    breakevenSlMultiplier: 1.0,
    trailActivationSlMultiplier: 1.5,
    trailDistanceAtr: 1.0,
    slPivotAtrBuffer: 0.5,
    activeSessions: ["london", "newyork"],
});

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSessionName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

function average(values = []) {
    const validValues = values.filter((value) => Number.isFinite(value));
    if (validValues.length === 0) {
        return null;
    }

    return (
        validValues.reduce((sum, value) => sum + value, 0) / validValues.length
    );
}

function getPipValue(instrument, dataService = null) {
    const pipValue = dataService?.getPipValue?.(instrument);
    if (Number.isFinite(Number(pipValue))) {
        return Number(pipValue);
    }

    return instrument?.includes("JPY") ? 0.01 : 0.0001;
}

function getLastValidValue(series = [], key = null, fromOffset = 0) {
    if (!Array.isArray(series) || series.length === 0) {
        return null;
    }

    for (let index = series.length - 1 - fromOffset; index >= 0; index -= 1) {
        const candidate = series[index];
        const value =
            key === null || key === undefined
                ? toFiniteNumber(candidate, null)
                : toFiniteNumber(candidate?.[key], null);

        if (Number.isFinite(value)) {
            return value;
        }
    }

    return null;
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

    return getLastValidValue(atrSeries);
}

function calculateAlignedStochasticSeries(candles = [], config = {}) {
    if (!Array.isArray(candles) || candles.length === 0) {
        return [];
    }

    const period = Math.max(3, toFiniteNumber(config.stochPeriod, 14));
    const signalPeriod = Math.max(
        2,
        toFiniteNumber(config.stochSignalPeriod, 3)
    );
    const smoothK = Math.max(1, toFiniteNumber(config.stochSmoothK, 3));
    const rawK = new Array(candles.length).fill(null);
    const smoothedK = new Array(candles.length).fill(null);
    const series = new Array(candles.length).fill(null);

    for (let index = period - 1; index < candles.length; index += 1) {
        const window = candles.slice(index - period + 1, index + 1);
        const highestHigh = Math.max(...window.map((candle) => candle.high));
        const lowestLow = Math.min(...window.map((candle) => candle.low));
        const close = toFiniteNumber(candles[index]?.close, null);
        const range = highestHigh - lowestLow;

        if (!Number.isFinite(close) || !Number.isFinite(range)) {
            continue;
        }

        rawK[index] =
            range === 0 ? 50 : ((close - lowestLow) / Math.max(range, 1e-10)) * 100;
    }

    for (let index = 0; index < candles.length; index += 1) {
        const smoothWindow = rawK.slice(
            Math.max(0, index - smoothK + 1),
            index + 1
        );
        const k = average(smoothWindow);
        if (!Number.isFinite(k)) {
            continue;
        }

        smoothedK[index] = k;

        const signalWindow = smoothedK.slice(
            Math.max(0, index - signalPeriod + 1),
            index + 1
        );
        const d = average(signalWindow);
        if (!Number.isFinite(d)) {
            continue;
        }

        series[index] = {
            k,
            d,
        };
    }

    return series;
}

function createPivotCandidates(
    candles = [],
    stochasticSeries = [],
    type = "low",
    pivotWindow = 2,
    maxPivotLookback = 30
) {
    if (!Array.isArray(candles) || candles.length === 0) {
        return [];
    }

    const startIndex = Math.max(
        pivotWindow,
        candles.length - Math.max(maxPivotLookback, pivotWindow * 2 + 1)
    );
    const endIndex = candles.length - pivotWindow - 1;
    const pivots = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
        const candle = candles[index];
        const localWindow = candles.slice(
            index - pivotWindow,
            index + pivotWindow + 1
        );
        const prices = localWindow.map((windowCandle) =>
            type === "low" ? windowCandle.low : windowCandle.high
        );
        const currentPrice =
            type === "low"
                ? toFiniteNumber(candle?.low, null)
                : toFiniteNumber(candle?.high, null);
        const targetPrice =
            type === "low" ? Math.min(...prices) : Math.max(...prices);
        const strictEdge = prices.some((price, priceIndex) => {
            if (priceIndex === pivotWindow) return false;
            return type === "low"
                ? currentPrice < price
                : currentPrice > price;
        });

        if (!Number.isFinite(currentPrice) || currentPrice !== targetPrice) {
            continue;
        }
        if (!strictEdge) {
            continue;
        }

        const stochasticPoint = stochasticSeries[index] || null;
        const stochasticK = toFiniteNumber(stochasticPoint?.k, null);

        pivots.push({
            index,
            time: candle.time,
            price: currentPrice,
            stochasticK,
        });
    }

    return pivots;
}

function getRecentPivotPair(
    candles = [],
    stochasticSeries = [],
    type = "low",
    config = {}
) {
    const pivotWindow = Math.max(1, toFiniteNumber(config.pivotWindow, 2));
    const maxPivotLookback = Math.max(
        10,
        toFiniteNumber(config.maxPivotLookback, 30)
    );
    const pivots = createPivotCandidates(
        candles,
        stochasticSeries,
        type,
        pivotWindow,
        maxPivotLookback
    ).filter((pivot) => Number.isFinite(pivot.stochasticK));

    if (pivots.length < 2) {
        return null;
    }

    return {
        first: pivots[pivots.length - 2],
        second: pivots[pivots.length - 1],
    };
}

function summarizePivot(pivot = null) {
    if (!pivot) {
        return null;
    }

    return {
        time: pivot.time || null,
        price: Number.isFinite(pivot.price) ? pivot.price : null,
        stochasticK: Number.isFinite(pivot.stochasticK) ? pivot.stochasticK : null,
    };
}

function buildStrategyContext(context = {}, overrides = {}) {
    const h1Direction = context.h1Rising
        ? "rising"
        : context.h1Falling
        ? "falling"
        : "flat";

    return {
        family: "stochastic_divergence",
        setup: overrides.setup || "none",
        entryBias: overrides.entryBias || null,
        crossState: overrides.crossState || "none",
        m15: {
            k: Number.isFinite(context.currentK) ? context.currentK : null,
            d: Number.isFinite(context.currentD) ? context.currentD : null,
            previousK: Number.isFinite(context.previousK)
                ? context.previousK
                : null,
        },
        h1: {
            k: Number.isFinite(context.h1K) ? context.h1K : null,
            direction: h1Direction,
        },
        pivots:
            overrides.pivots && (overrides.pivots.first || overrides.pivots.second)
                ? {
                      first: summarizePivot(overrides.pivots.first),
                      second: summarizePivot(overrides.pivots.second),
                  }
                : null,
    };
}

function buildHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason:
            overrides.reason ||
            "HOLD: stochastic divergence filters not met",
        reasonCode:
            overrides.reasonCode || "STOCHASTIC_DIVERGENCE_FILTERED",
        signalClass: overrides.signalClass || "FILTERED",
        intent: overrides.intent || "WAIT",
        entryType: null,
        signalCandleTime: context.currentCandle?.time || null,
        atrVal: context.atrVal || 0,
        atrPips: context.atrPips || 0,
        currentPrice: context.currentPrice ?? null,
        rsiVal: context.currentK || 0,
        adxVal: 0,
        pdiVal: context.currentD || 0,
        mdiVal: context.h1K || 0,
        adxRising: Boolean(context.h1Rising),
        prevAdxVal: context.previousK || 0,
        currentDir: 0,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "1h",
            direction: 0,
            longAllowed:
                overrides.longAllowed === undefined
                    ? true
                    : Boolean(overrides.longAllowed),
            shortAllowed:
                overrides.shortAllowed === undefined
                    ? true
                    : Boolean(overrides.shortAllowed),
            reason:
                overrides.htfReason ||
                (Number.isFinite(context.h1K)
                    ? `H1 %K ${context.h1K.toFixed(1)}`
                    : "H1 stochastic unavailable"),
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        strategyContext: buildStrategyContext(context, {
            setup: overrides.setup,
            entryBias: overrides.entryBias,
            crossState: overrides.crossState,
            pivots: overrides.pivots,
        }),
    };
}

function isCrossAbove(series = []) {
    const current = series[series.length - 1] || null;
    const previous = series[series.length - 2] || null;

    return (
        Number.isFinite(current?.k) &&
        Number.isFinite(current?.d) &&
        Number.isFinite(previous?.k) &&
        Number.isFinite(previous?.d) &&
        current.k > current.d &&
        previous.k <= previous.d
    );
}

function isCrossBelow(series = []) {
    const current = series[series.length - 1] || null;
    const previous = series[series.length - 2] || null;

    return (
        Number.isFinite(current?.k) &&
        Number.isFinite(current?.d) &&
        Number.isFinite(previous?.k) &&
        Number.isFinite(previous?.d) &&
        current.k < current.d &&
        previous.k >= previous.d
    );
}

async function evaluateStochasticDivergenceEntry({
    instrument,
    candles = [],
    currentPrice,
    config = {},
    dataService = null,
    marketContext = null,
}) {
    if (!Array.isArray(candles) || candles.length < 35) {
        return buildHoldResult(
            {
                currentPrice,
            },
            {
                reason:
                    "HOLD: stochastic divergence requires at least 35 M15 candles",
                reasonCode: "STOCHASTIC_DIVERGENCE_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_STOCHASTIC_DIVERGENCE_CONFIG,
        ...(config || {}),
    };
    const currentCandle = candles[candles.length - 1];
    const entryPrice = toFiniteNumber(currentPrice, currentCandle?.close);
    const pipValue = getPipValue(instrument, dataService);
    const sessionName = marketContext?.session?.session || "Off-Hours";
    const sessionKey = normalizeSessionName(sessionName);
    const activeSessions = Array.isArray(resolvedConfig.activeSessions)
        ? resolvedConfig.activeSessions.map(normalizeSessionName)
        : DEFAULT_STOCHASTIC_DIVERGENCE_CONFIG.activeSessions;
    const spreadPips = toFiniteNumber(
        marketContext?.session?.spreadPips ?? marketContext?.price?.spread,
        null
    );
    const stochasticSeries =
        marketContext?.timeframes?.["15m"]?.indicators?.stochastic ||
        calculateAlignedStochasticSeries(candles, resolvedConfig);
    const h1Candles = marketContext?.timeframes?.["1h"]?.candles || [];
    const h1StochasticSeries =
        marketContext?.timeframes?.["1h"]?.indicators?.stochastic ||
        calculateAlignedStochasticSeries(h1Candles, resolvedConfig);
    const atrVal =
        getLastValidValue(marketContext?.timeframes?.["15m"]?.indicators?.atr) ||
        deriveAtrFromCandles(candles);
    const atrPips =
        Number.isFinite(atrVal) && pipValue > 0 ? atrVal / pipValue : 0;
    const currentStochastic = stochasticSeries[stochasticSeries.length - 1] || {};
    const previousStochastic = stochasticSeries[stochasticSeries.length - 2] || {};
    const currentK = toFiniteNumber(currentStochastic.k, null);
    const currentD = toFiniteNumber(currentStochastic.d, null);
    const previousK = toFiniteNumber(previousStochastic.k, null);
    const h1K = getLastValidValue(h1StochasticSeries, "k");
    const previousH1K = getLastValidValue(h1StochasticSeries, "k", 1);
    const h1Rising =
        Number.isFinite(h1K) &&
        Number.isFinite(previousH1K) &&
        h1K > previousH1K;
    const h1Falling =
        Number.isFinite(h1K) &&
        Number.isFinite(previousH1K) &&
        h1K < previousH1K;
    const evaluationContext = {
        currentCandle,
        currentPrice: entryPrice,
        atrVal,
        atrPips,
        currentK,
        currentD,
        previousK,
        h1K,
        h1Rising,
        h1Falling,
    };

    if (!activeSessions.includes(sessionKey)) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: session ${sessionName} is outside the divergence window`,
            reasonCode: "STOCHASTIC_DIVERGENCE_SESSION_FILTERED",
        });
    }

    if (
        Number.isFinite(spreadPips) &&
        spreadPips > toFiniteNumber(resolvedConfig.maxSpreadPips, Infinity)
    ) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: spread ${spreadPips.toFixed(1)} is above the configured threshold`,
            reasonCode: "STOCHASTIC_DIVERGENCE_SPREAD_FILTERED",
        });
    }

    if (
        !Number.isFinite(entryPrice) ||
        !Number.isFinite(atrVal) ||
        atrVal <= 0 ||
        !Number.isFinite(currentK) ||
        !Number.isFinite(currentD)
    ) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: M15 stochastic or ATR context unavailable",
            reasonCode: "STOCHASTIC_DIVERGENCE_NO_M15_CONTEXT",
        });
    }

    if (!Number.isFinite(h1K)) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: H1 stochastic context unavailable",
            reasonCode: "STOCHASTIC_DIVERGENCE_NO_H1_CONTEXT",
        });
    }

    const bullishPivots = getRecentPivotPair(
        candles,
        stochasticSeries,
        "low",
        resolvedConfig
    );
    const bearishPivots = getRecentPivotPair(
        candles,
        stochasticSeries,
        "high",
        resolvedConfig
    );
    const oversoldZone = toFiniteNumber(resolvedConfig.oversoldZone, 20);
    const overboughtZone = toFiniteNumber(resolvedConfig.overboughtZone, 80);
    const htfThreshold = toFiniteNumber(resolvedConfig.htfStochThreshold, 50);
    const shortHtfThreshold = 100 - htfThreshold;
    const bullishDivergence =
        bullishPivots &&
        bullishPivots.second.index - bullishPivots.first.index >=
            toFiniteNumber(resolvedConfig.minPivotSeparationBars, 5) &&
        bullishPivots.second.price < bullishPivots.first.price &&
        bullishPivots.first.price - bullishPivots.second.price >=
            atrVal * toFiniteNumber(resolvedConfig.minPriceDivergenceAtr, 0.1) &&
        bullishPivots.second.stochasticK > bullishPivots.first.stochasticK &&
        bullishPivots.second.stochasticK - bullishPivots.first.stochasticK >=
            toFiniteNumber(resolvedConfig.minOscillatorDivergencePoints, 3) &&
        bullishPivots.first.stochasticK < oversoldZone &&
        bullishPivots.second.stochasticK < oversoldZone;
    const bearishDivergence =
        bearishPivots &&
        bearishPivots.second.index - bearishPivots.first.index >=
            toFiniteNumber(resolvedConfig.minPivotSeparationBars, 5) &&
        bearishPivots.second.price > bearishPivots.first.price &&
        bearishPivots.second.price - bearishPivots.first.price >=
            atrVal * toFiniteNumber(resolvedConfig.minPriceDivergenceAtr, 0.1) &&
        bearishPivots.second.stochasticK < bearishPivots.first.stochasticK &&
        bearishPivots.first.stochasticK - bearishPivots.second.stochasticK >=
            toFiniteNumber(resolvedConfig.minOscillatorDivergencePoints, 3) &&
        bearishPivots.first.stochasticK > overboughtZone &&
        bearishPivots.second.stochasticK > overboughtZone;
    const requireHtfSlope =
        resolvedConfig.requireHtfSlopeConfirmation !== false;
    const h1LongAllowed =
        h1K > htfThreshold && (!requireHtfSlope || h1Rising);
    const h1ShortAllowed =
        h1K < shortHtfThreshold && (!requireHtfSlope || h1Falling);
    const longCrossConfirmed = isCrossAbove(stochasticSeries);
    const shortCrossConfirmed = isCrossBelow(stochasticSeries);

    if (bullishDivergence && !h1LongAllowed) {
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: bullish divergence found but H1 %K ${h1K.toFixed(1)} is not supportive`,
            reasonCode: "STOCHASTIC_DIVERGENCE_HTF_LONG_FILTERED",
            longAllowed: false,
            htfReason: `H1 %K ${h1K.toFixed(1)} is below the confirmation threshold`,
            setup: "bullish_divergence",
            entryBias: "long",
            crossState: longCrossConfirmed ? "confirmed" : "waiting",
            pivots: bullishPivots,
        });
    }

    if (bearishDivergence && !h1ShortAllowed) {
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: bearish divergence found but H1 %K ${h1K.toFixed(1)} is not supportive`,
            reasonCode: "STOCHASTIC_DIVERGENCE_HTF_SHORT_FILTERED",
            shortAllowed: false,
            htfReason: `H1 %K ${h1K.toFixed(1)} is above the short confirmation threshold`,
            setup: "bearish_divergence",
            entryBias: "short",
            crossState: shortCrossConfirmed ? "confirmed" : "waiting",
            pivots: bearishPivots,
        });
    }

    if (bullishDivergence && longCrossConfirmed) {
        const pivotLow = bullishPivots.second.price;
        const stopLossPrice =
            pivotLow -
            atrVal * toFiniteNumber(resolvedConfig.slPivotAtrBuffer, 0.5);
        const stopDistance = entryPrice - stopLossPrice;

        if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
            return buildHoldResult(evaluationContext, {
                reason: "HOLD: bullish divergence stop distance is invalid",
                reasonCode: "STOCHASTIC_DIVERGENCE_INVALID_LONG_STOP",
                setup: "bullish_divergence",
                entryBias: "long",
                crossState: "confirmed",
                pivots: bullishPivots,
            });
        }

        return {
            signalType: "BUY",
            reason:
                `BUY: bullish stochastic divergence | lower low ${bullishPivots.first.price.toFixed(
                    5
                )} -> ${bullishPivots.second.price.toFixed(5)} | ` +
                `%K ${bullishPivots.first.stochasticK.toFixed(1)} -> ${bullishPivots.second.stochasticK.toFixed(
                    1
                )} | H1 %K ${h1K.toFixed(1)}`,
            reasonCode: "STOCHASTIC_DIVERGENCE_LONG_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_LONG",
            entryType: "STOCHASTIC_DIVERGENCE_REVERSAL",
            signalCandleTime: currentCandle.time,
            atrVal,
            atrPips,
            currentPrice: entryPrice,
            rsiVal: currentK,
            adxVal: 0,
            pdiVal: currentD,
            mdiVal: h1K,
            adxRising: h1Rising,
            prevAdxVal: previousK || 0,
            currentDir: 0,
            prevDir: 0,
            htfContext: {
                enabled: true,
                timeframe: "1h",
                direction: 1,
                longAllowed: true,
                shortAllowed: false,
                reason:
                    h1K > htfThreshold
                        ? `H1 %K ${h1K.toFixed(1)} is above ${htfThreshold}`
                        : `H1 %K ${h1K.toFixed(1)} is rising`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan: {
                stopLossPrice,
                takeProfitPrice:
                    entryPrice +
                    stopDistance *
                        toFiniteNumber(resolvedConfig.tpSlMultiplier, 2.0),
            },
            strategyContext: buildStrategyContext(evaluationContext, {
                setup: "bullish_divergence",
                entryBias: "long",
                crossState: "confirmed",
                pivots: bullishPivots,
            }),
        };
    }

    if (bearishDivergence && shortCrossConfirmed) {
        const pivotHigh = bearishPivots.second.price;
        const stopLossPrice =
            pivotHigh +
            atrVal * toFiniteNumber(resolvedConfig.slPivotAtrBuffer, 0.5);
        const stopDistance = stopLossPrice - entryPrice;

        if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
            return buildHoldResult(evaluationContext, {
                reason: "HOLD: bearish divergence stop distance is invalid",
                reasonCode: "STOCHASTIC_DIVERGENCE_INVALID_SHORT_STOP",
                setup: "bearish_divergence",
                entryBias: "short",
                crossState: "confirmed",
                pivots: bearishPivots,
            });
        }

        return {
            signalType: "SELL",
            reason:
                `SELL: bearish stochastic divergence | higher high ${bearishPivots.first.price.toFixed(
                    5
                )} -> ${bearishPivots.second.price.toFixed(5)} | ` +
                `%K ${bearishPivots.first.stochasticK.toFixed(1)} -> ${bearishPivots.second.stochasticK.toFixed(
                    1
                )} | H1 %K ${h1K.toFixed(1)}`,
            reasonCode: "STOCHASTIC_DIVERGENCE_SHORT_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_SHORT",
            entryType: "STOCHASTIC_DIVERGENCE_REVERSAL",
            signalCandleTime: currentCandle.time,
            atrVal,
            atrPips,
            currentPrice: entryPrice,
            rsiVal: currentK,
            adxVal: 0,
            pdiVal: currentD,
            mdiVal: h1K,
            adxRising: h1Falling,
            prevAdxVal: previousK || 0,
            currentDir: 0,
            prevDir: 0,
            htfContext: {
                enabled: true,
                timeframe: "1h",
                direction: -1,
                longAllowed: false,
                shortAllowed: true,
                reason:
                    h1K < shortHtfThreshold
                        ? `H1 %K ${h1K.toFixed(1)} is below ${shortHtfThreshold}`
                        : `H1 %K ${h1K.toFixed(1)} is falling`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan: {
                stopLossPrice,
                takeProfitPrice:
                    entryPrice -
                    stopDistance *
                        toFiniteNumber(resolvedConfig.tpSlMultiplier, 2.0),
            },
            strategyContext: buildStrategyContext(evaluationContext, {
                setup: "bearish_divergence",
                entryBias: "short",
                crossState: "confirmed",
                pivots: bearishPivots,
            }),
        };
    }

    if (bullishDivergence || bearishDivergence) {
        const direction = bullishDivergence ? "bullish" : "bearish";
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: ${direction} divergence detected but the M15 stochastic cross has not confirmed yet`,
            reasonCode: "STOCHASTIC_DIVERGENCE_WAIT_CROSS",
            signalClass: "PENDING",
            setup: bullishDivergence
                ? "bullish_divergence"
                : "bearish_divergence",
            entryBias: bullishDivergence ? "long" : "short",
            crossState: "waiting",
            pivots: bullishDivergence ? bullishPivots : bearishPivots,
        });
    }

    return buildHoldResult(evaluationContext, {
        reason:
            `HOLD: no fresh stochastic divergence setup | M15 %K ${currentK.toFixed(
                1
            )} | H1 %K ${h1K.toFixed(1)}`,
        reasonCode: "STOCHASTIC_DIVERGENCE_WAIT",
    });
}

const stochasticDivergenceStrategy = createStrategyDefinition({
    key: "stochastic_divergence",
    label: "Stochastic Divergence",
    description:
        "Candidate paper strategy that combines divergence detection with stochastic reversal timing.",
    phaseIntroduced: 4,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["15m", "1h"],
        marketData: ["candles", "price", "session", "spread"],
        indicators: ["stochastic", "atr"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
        defaultConfig: DEFAULT_STOCHASTIC_DIVERGENCE_CONFIG,
    },
    evaluateEntry: evaluateStochasticDivergenceEntry,
});

module.exports = Object.assign({}, stochasticDivergenceStrategy, {
    DEFAULT_STOCHASTIC_DIVERGENCE_CONFIG,
    calculateAlignedStochasticSeries,
    evaluateStochasticDivergenceEntry,
});
