const { ATR } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_TIMESFM_DIRECTIONAL_CONFIG = Object.freeze({
    timesFmStrategyMinConfidence: 0.7,
    timesFmStrategyMinReturnBps: 10,
    timesFmStrategyHighConfidenceThreshold: 0.8,
    timesFmStrategyHighConfidenceMinReturnBps: 7.5,
    timesFmStrategyStopLossAtrMultiplier: 1.5,
    timesFmStrategyRiskReward: 3.0,
    timesFmStrategyBlockExtremeVolatility: true,
    enableShorting: false,
    enableSessionFilter: true,
    activeSessions: ["london", "newyork"],
    enableBreakeven: true,
    breakevenTriggerRiskMultiple: 1.0,
    trailingStopActivationRiskMultiple: 1.5,
    trailingStopRiskMultiple: 1.0,
    timeStopHours: 0,
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

function deriveAtrSeries(candles = []) {
    if (!Array.isArray(candles) || candles.length < 15) {
        return [];
    }

    return ATR.calculate({
        high: candles.map((candle) => candle.high),
        low: candles.map((candle) => candle.low),
        close: candles.map((candle) => candle.close),
        period: 14,
    });
}

function mapForecastDirection(direction) {
    if (direction === "BULLISH") return 1;
    if (direction === "BEARISH") return -1;
    return 0;
}

function buildForecastSummary(forecast = {}) {
    const direction = forecast.direction || "NEUTRAL";
    const confidence = Math.max(
        0,
        Math.min(1, toFiniteNumber(forecast.confidence, 0))
    );
    const returnBps = toFiniteNumber(forecast.returnBps, 0) || 0;
    const volatilityRegime = forecast.volatilityRegime || "NORMAL";

    return `TimesFM ${direction.toLowerCase()} | conf ${(confidence * 100).toFixed(
        0
    )}% | ${returnBps.toFixed(1)}bps | vol ${volatilityRegime}`;
}

function resolveMinReturnBps(config = {}, confidence = 0) {
    const baseMinReturnBps = toFiniteNumber(
        config.timesFmStrategyMinReturnBps,
        DEFAULT_TIMESFM_DIRECTIONAL_CONFIG.timesFmStrategyMinReturnBps
    );
    const highConfidenceThreshold = toFiniteNumber(
        config.timesFmStrategyHighConfidenceThreshold,
        DEFAULT_TIMESFM_DIRECTIONAL_CONFIG.timesFmStrategyHighConfidenceThreshold
    );
    const highConfidenceMinReturnBps = toFiniteNumber(
        config.timesFmStrategyHighConfidenceMinReturnBps,
        DEFAULT_TIMESFM_DIRECTIONAL_CONFIG.timesFmStrategyHighConfidenceMinReturnBps
    );

    const minReturnBps =
        confidence >= highConfidenceThreshold
            ? Math.min(baseMinReturnBps, highConfidenceMinReturnBps)
            : baseMinReturnBps;

    return {
        minReturnBps,
        baseMinReturnBps,
        highConfidenceThreshold,
        highConfidenceMinReturnBps,
        highConfidenceOverride:
            confidence >= highConfidenceThreshold &&
            highConfidenceMinReturnBps < baseMinReturnBps,
    };
}

function buildHoldResult(context = {}, overrides = {}) {
    const currentDir =
        overrides.currentDir ?? context.currentDir ?? mapForecastDirection(context.direction);
    const forecastSummary =
        overrides.forecastSummary ||
        context.forecastSummary ||
        "TimesFM forecast unavailable";

    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: TimesFM directional filters not met",
        reasonCode: overrides.reasonCode || "TIMESFM_DIRECTIONAL_WAIT",
        signalClass: overrides.signalClass || "FILTERED",
        intent: overrides.intent || "WAIT",
        entryType: null,
        signalCandleTime: context.currentCandle?.time || null,
        atrVal: context.atrVal || 0,
        atrPips: context.atrPips || 0,
        currentPrice: context.currentPrice ?? null,
        rsiVal: 0,
        adxVal: context.confidencePct || 0,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "timesfm",
            direction: currentDir,
            longAllowed: currentDir >= 0,
            shortAllowed: currentDir <= 0,
            reason: overrides.htfReason || forecastSummary,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
    };
}

async function evaluateTimesFmDirectionalEntry({
    instrument,
    candles = [],
    currentPrice,
    config = {},
    dataService = null,
    marketContext = null,
}) {
    if (!Array.isArray(candles) || candles.length < 50) {
        return buildHoldResult(
            {
                currentPrice,
            },
            {
                reason: "HOLD: TimesFM directional requires at least 50 M15 candles",
                reasonCode: "TIMESFM_DIRECTIONAL_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_TIMESFM_DIRECTIONAL_CONFIG,
        ...(config || {}),
    };
    const timeframe = resolvedConfig.timeframe || "15m";
    const currentCandle = candles[candles.length - 1];
    const entryPrice = toFiniteNumber(currentPrice, currentCandle?.close);
    const timeframeContext = marketContext?.timeframes?.[timeframe] || {};
    const atrSeries =
        timeframeContext.indicators?.atr || deriveAtrSeries(candles);
    const atrVal = getLastIndicatorValue(atrSeries);
    const pipValue = getPipValue(instrument, dataService);
    const atrPips =
        Number.isFinite(atrVal) && pipValue > 0 ? atrVal / pipValue : 0;
    const spreadPips = toFiniteNumber(
        marketContext?.session?.spreadPips ?? marketContext?.price?.spread,
        null
    );
    const forecast = marketContext?.timesFmForecast || null;
    const direction = forecast?.direction || "NEUTRAL";
    const currentDir = mapForecastDirection(direction);
    const confidence = Math.max(
        0,
        Math.min(1, toFiniteNumber(forecast?.confidence, 0))
    );
    const confidencePct = confidence * 100;
    const returnBps = toFiniteNumber(forecast?.returnBps, 0) || 0;
    const volatilityRegime = forecast?.volatilityRegime || null;
    const forecastSummary = buildForecastSummary(forecast || {});
    const sessionName = marketContext?.session?.session || "Off-Hours";
    const sessionKey = normalizeSessionName(sessionName);
    const activeSessions = Array.isArray(resolvedConfig.activeSessions)
        ? resolvedConfig.activeSessions.map(normalizeSessionName)
        : [];
    const context = {
        currentCandle,
        currentPrice: entryPrice,
        atrVal,
        atrPips,
        currentDir,
        direction,
        confidencePct,
        forecastSummary,
    };

    if (resolvedConfig.timesFmEnabled === false) {
        return buildHoldResult(context, {
            reason: "HOLD: TimesFM directional strategy is disabled in config",
            reasonCode: "TIMESFM_DIRECTIONAL_DISABLED",
        });
    }

    if (!forecast || forecast.available !== true) {
        return buildHoldResult(context, {
            reason:
                forecast?.reason === "insufficient_context"
                    ? "HOLD: TimesFM sidecar needs more context bars"
                    : "HOLD: TimesFM forecast unavailable",
            reasonCode: "TIMESFM_DIRECTIONAL_NO_FORECAST",
            htfReason:
                forecast?.reason
                    ? `TimesFM unavailable: ${forecast.reason}`
                    : "TimesFM forecast unavailable",
        });
    }

    if (!Number.isFinite(entryPrice)) {
        return buildHoldResult(context, {
            reason: "HOLD: current price is unavailable",
            reasonCode: "TIMESFM_DIRECTIONAL_NO_PRICE",
        });
    }

    if (
        Array.isArray(activeSessions) &&
        activeSessions.length > 0 &&
        !activeSessions.includes(sessionKey)
    ) {
        return buildHoldResult(context, {
            reason: `HOLD: session ${sessionName} is outside the configured TimesFM window`,
            reasonCode: "TIMESFM_DIRECTIONAL_SESSION_FILTERED",
        });
    }

    if (
        Number.isFinite(spreadPips) &&
        spreadPips > toFiniteNumber(resolvedConfig.maxSpreadPips, Infinity)
    ) {
        return buildHoldResult(context, {
            reason: `HOLD: spread ${spreadPips.toFixed(1)} is above the configured threshold`,
            reasonCode: "TIMESFM_DIRECTIONAL_SPREAD_FILTERED",
        });
    }

    if (!Number.isFinite(atrVal) || atrVal <= 0) {
        return buildHoldResult(context, {
            reason: "HOLD: ATR context unavailable for TimesFM sizing",
            reasonCode: "TIMESFM_DIRECTIONAL_NO_ATR",
        });
    }

    if (currentDir === 0 || forecast.neutral === true) {
        return buildHoldResult(context, {
            reason: "HOLD: TimesFM forecast is neutral",
            reasonCode: "TIMESFM_DIRECTIONAL_NEUTRAL",
        });
    }

    if (
        resolvedConfig.timesFmStrategyBlockExtremeVolatility !== false &&
        volatilityRegime === "EXTREME"
    ) {
        return buildHoldResult(context, {
            reason: "HOLD: TimesFM forecast marked the regime as EXTREME volatility",
            reasonCode: "TIMESFM_DIRECTIONAL_EXTREME_VOLATILITY",
        });
    }

    const minConfidence = toFiniteNumber(
        resolvedConfig.timesFmStrategyMinConfidence,
        0.7
    );
    if (confidence < minConfidence) {
        return buildHoldResult(context, {
            reason: `HOLD: TimesFM confidence ${(confidence * 100).toFixed(
                0
            )}% is below the configured threshold`,
            reasonCode: "TIMESFM_DIRECTIONAL_CONFIDENCE_FILTERED",
        });
    }

    const returnGate = resolveMinReturnBps(resolvedConfig, confidence);
    const minReturnBps = returnGate.minReturnBps;
    if (Math.abs(returnBps) < minReturnBps) {
        return buildHoldResult(context, {
            reason: `HOLD: TimesFM return ${Math.abs(returnBps).toFixed(
                1
            )}bps is below the configured ${minReturnBps.toFixed(1)}bps threshold`,
            reasonCode: "TIMESFM_DIRECTIONAL_RETURN_FILTERED",
        });
    }

    const stopDistance =
        atrVal *
        Math.max(
            0.5,
            toFiniteNumber(
                resolvedConfig.timesFmStrategyStopLossAtrMultiplier,
                1.5
            ) || 1.5
        );
    const rewardDistance =
        stopDistance *
        Math.max(
            1,
            toFiniteNumber(resolvedConfig.timesFmStrategyRiskReward, 1.5) || 1.5
        );
    const signalType = currentDir > 0 ? "BUY" : "SELL";

    if (signalType === "SELL" && resolvedConfig.enableShorting === false) {
        return buildHoldResult(context, {
            reason: "HOLD: TimesFM short forecast blocked by long-only Phase 2 config",
            reasonCode: "TIMESFM_DIRECTIONAL_SHORTS_DISABLED",
        });
    }

    return {
        signalType,
        reason:
            `${signalType}: TimesFM directional ${direction.toLowerCase()} | ` +
            `conf ${(confidence * 100).toFixed(0)}% | ${returnBps.toFixed(
                1
            )}bps | min ${minReturnBps.toFixed(1)}bps | vol ${
                forecast.volatilityRegime || "NORMAL"
            }`,
        reasonCode:
            signalType === "BUY"
                ? "TIMESFM_DIRECTIONAL_LONG_ACTIONABLE"
                : "TIMESFM_DIRECTIONAL_SHORT_ACTIONABLE",
        signalClass: "ACTIONABLE",
        intent: signalType === "BUY" ? "ENTER_LONG" : "ENTER_SHORT",
        entryType: "TIMESFM_DIRECTIONAL",
        signalCandleTime: currentCandle.time,
        atrVal,
        atrPips,
        currentPrice: entryPrice,
        rsiVal: 0,
        adxVal: confidencePct,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "timesfm",
            direction: currentDir,
            longAllowed: currentDir >= 0,
            shortAllowed: currentDir <= 0,
            reason: forecastSummary,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan:
            signalType === "BUY"
                ? {
                      stopLossPrice: entryPrice - stopDistance,
                      takeProfitPrice: entryPrice + rewardDistance,
                  }
                : {
                      stopLossPrice: entryPrice + stopDistance,
                      takeProfitPrice: entryPrice - rewardDistance,
                  },
    };
}

const timesFmDirectionalStrategy = createStrategyDefinition({
    key: "timesfm_directional",
    label: "TimesFM Directional",
    description:
        "Promotable strategy that originates entries directly from TimesFM forecast direction and confidence.",
    phaseIntroduced: 4,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["15m"],
        marketData: ["candles", "price", "session", "spread"],
        indicators: ["atr"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
        defaultConfig: DEFAULT_TIMESFM_DIRECTIONAL_CONFIG,
    },
    evaluateEntry: evaluateTimesFmDirectionalEntry,
});

module.exports = Object.assign({}, timesFmDirectionalStrategy, {
    DEFAULT_TIMESFM_DIRECTIONAL_CONFIG,
    evaluateTimesFmDirectionalEntry,
    resolveMinReturnBps,
});
