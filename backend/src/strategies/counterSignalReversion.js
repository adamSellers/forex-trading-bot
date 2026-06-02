const { ATR } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const COUNTER_SIGNAL_REVERSION_KEY = "counter_signal_reversion";
const DEFAULT_COUNTER_SIGNAL_SOURCE_STRATEGIES = Object.freeze([
    "timesfm_directional",
    "mean_reversion",
    "stochastic_divergence",
    "supertrend_momentum",
]);

const DEFAULT_COUNTER_SIGNAL_REVERSION_CONFIG = Object.freeze({
    counterSignalSourceStrategies: DEFAULT_COUNTER_SIGNAL_SOURCE_STRATEGIES,
    counterSignalStopLossPips: 15,
    counterSignalTakeProfitPips: 15,
    enableShorting: true,
    enableSessionFilter: false,
    timeStopHours: 0,
});

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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
    if (!Array.isArray(candles) || candles.length < 15) {
        return null;
    }

    return getLastIndicatorValue(
        ATR.calculate({
            high: candles.map((candle) => candle.high),
            low: candles.map((candle) => candle.low),
            close: candles.map((candle) => candle.close),
            period: 14,
        })
    );
}

function normalizeSourceStrategies(config = {}) {
    const rawSources = Array.isArray(config.counterSignalSourceStrategies)
        ? config.counterSignalSourceStrategies
        : DEFAULT_COUNTER_SIGNAL_SOURCE_STRATEGIES;
    const seen = new Set();

    return rawSources
        .map((source) => String(source || "").trim())
        .filter((source) => {
            if (!source || source === COUNTER_SIGNAL_REVERSION_KEY) return false;
            if (seen.has(source)) return false;
            seen.add(source);
            return true;
        });
}

function isActionableEntry(evaluation = {}) {
    return (
        (evaluation.signalType === "BUY" || evaluation.signalType === "SELL") &&
        evaluation.signalClass === "ACTIONABLE" &&
        evaluation.entryType !== "EXIT_ONLY" &&
        !String(evaluation.intent || "").startsWith("EXIT_")
    );
}

function invertSide(side) {
    return side === "BUY" ? "SELL" : "BUY";
}

function isStopValid(side, entryPrice, stopLossPrice) {
    return (
        Number.isFinite(stopLossPrice) &&
        Number.isFinite(entryPrice) &&
        ((side === "BUY" && stopLossPrice < entryPrice) ||
            (side === "SELL" && stopLossPrice > entryPrice))
    );
}

function isTakeProfitValid(side, entryPrice, takeProfitPrice) {
    return (
        Number.isFinite(takeProfitPrice) &&
        Number.isFinite(entryPrice) &&
        ((side === "BUY" && takeProfitPrice > entryPrice) ||
            (side === "SELL" && takeProfitPrice < entryPrice))
    );
}

function buildFallbackTradePlan({
    instrument,
    side,
    entryPrice,
    config = {},
    dataService = null,
} = {}) {
    const pipValue = getPipValue(instrument, dataService);
    const stopPips = Math.max(
        0.1,
        toFiniteNumber(config.counterSignalStopLossPips, 15)
    );
    const takeProfitPips = Math.max(
        0.1,
        toFiniteNumber(config.counterSignalTakeProfitPips, stopPips)
    );
    const stopDistance = stopPips * pipValue;
    const takeProfitDistance = takeProfitPips * pipValue;

    if (!Number.isFinite(entryPrice) || !Number.isFinite(pipValue) || pipValue <= 0) {
        return null;
    }

    return {
        stopLossPrice:
            side === "BUY" ? entryPrice - stopDistance : entryPrice + stopDistance,
        takeProfitPrice:
            side === "BUY"
                ? entryPrice + takeProfitDistance
                : entryPrice - takeProfitDistance,
    };
}

function invertTradePlan({
    sourceEvaluation = {},
    inverseSide,
    entryPrice,
    instrument,
    config = {},
    dataService = null,
} = {}) {
    const sourceStopLoss = toFiniteNumber(
        sourceEvaluation.tradePlan?.stopLossPrice,
        null
    );
    const sourceTakeProfit = toFiniteNumber(
        sourceEvaluation.tradePlan?.takeProfitPrice,
        null
    );
    const fallback = buildFallbackTradePlan({
        instrument,
        side: inverseSide,
        entryPrice,
        config,
        dataService,
    });
    const mirroredPlan = {
        stopLossPrice: isStopValid(inverseSide, entryPrice, sourceTakeProfit)
            ? sourceTakeProfit
            : fallback?.stopLossPrice,
        takeProfitPrice: isTakeProfitValid(inverseSide, entryPrice, sourceStopLoss)
            ? sourceStopLoss
            : fallback?.takeProfitPrice,
    };

    if (!isStopValid(inverseSide, entryPrice, mirroredPlan.stopLossPrice)) {
        return fallback;
    }

    return mirroredPlan;
}

function buildHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: no source strategy entry to invert",
        reasonCode: overrides.reasonCode || "COUNTER_SIGNAL_NO_SOURCE_ENTRY",
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
            enabled: false,
            timeframe: null,
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason: overrides.htfReason || null,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        strategyContext: {
            family: "counter_signal_reversion",
            setup: "pure_inverse",
            sourceStrategies: context.sourceStrategies || [],
            selectedSource: null,
        },
    };
}

function buildSourceConfig(baseConfig = {}, sourceStrategy) {
    return {
        ...baseConfig,
        strategy: sourceStrategy,
    };
}

async function evaluateSourceStrategy({
    sourceStrategy,
    instrument,
    candles,
    currentPrice,
    config,
    dataService,
    pendingEntry,
    calculateSuperTrendFn,
    getHtfTrendContextFn,
    marketContext,
} = {}) {
    const { getStrategyDefinition } = require("./index");
    const strategyDefinition = getStrategyDefinition(sourceStrategy);

    return strategyDefinition.evaluateEntry({
        instrument,
        candles,
        currentPrice,
        config: buildSourceConfig(config, sourceStrategy),
        dataService,
        pendingEntry,
        calculateSuperTrendFn,
        getHtfTrendContextFn,
        marketContext,
    });
}

async function evaluateCounterSignalReversionEntry({
    instrument,
    candles = [],
    currentPrice,
    config = {},
    dataService = null,
    pendingEntry = null,
    calculateSuperTrendFn = null,
    getHtfTrendContextFn = null,
    marketContext = null,
}) {
    if (!Array.isArray(candles) || candles.length < 50) {
        return buildHoldResult(
            { currentPrice },
            {
                reason: "HOLD: counter signal reversion requires at least 50 M15 candles",
                reasonCode: "COUNTER_SIGNAL_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_COUNTER_SIGNAL_REVERSION_CONFIG,
        ...(config || {}),
    };
    const currentCandle = candles[candles.length - 1];
    const entryPrice = toFiniteNumber(currentPrice, currentCandle?.close);
    const pipValue = getPipValue(instrument, dataService);
    const atrVal =
        getLastIndicatorValue(marketContext?.timeframes?.["15m"]?.indicators?.atr) ||
        deriveAtrFromCandles(candles);
    const atrPips =
        Number.isFinite(atrVal) && pipValue > 0 ? atrVal / pipValue : 0;
    const sourceStrategies = normalizeSourceStrategies(resolvedConfig);
    const holdContext = {
        currentCandle,
        currentPrice: entryPrice,
        atrVal,
        atrPips,
        sourceStrategies,
    };

    if (!Number.isFinite(entryPrice)) {
        return buildHoldResult(holdContext, {
            reason: "HOLD: current price is unavailable",
            reasonCode: "COUNTER_SIGNAL_NO_PRICE",
        });
    }

    for (const sourceStrategy of sourceStrategies) {
        const sourceEvaluation = await evaluateSourceStrategy({
            sourceStrategy,
            instrument,
            candles,
            currentPrice: entryPrice,
            config: resolvedConfig,
            dataService,
            pendingEntry,
            calculateSuperTrendFn,
            getHtfTrendContextFn,
            marketContext,
        });

        if (!isActionableEntry(sourceEvaluation)) {
            continue;
        }

        const signalType = invertSide(sourceEvaluation.signalType);
        const tradePlan = invertTradePlan({
            sourceEvaluation,
            inverseSide: signalType,
            entryPrice,
            instrument,
            config: resolvedConfig,
            dataService,
        });
        const sourceDirection =
            sourceEvaluation.signalType === "BUY" ? "long" : "short";
        const inverseDirection = signalType === "BUY" ? "long" : "short";

        return {
            signalType,
            reason:
                `${signalType}: counter-signal reversion inverted ${sourceStrategy} ` +
                `${sourceEvaluation.signalType} ${sourceEvaluation.reasonCode || "signal"}`,
            reasonCode:
                signalType === "BUY"
                    ? "COUNTER_SIGNAL_INVERSE_LONG_ACTIONABLE"
                    : "COUNTER_SIGNAL_INVERSE_SHORT_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: signalType === "BUY" ? "ENTER_LONG" : "ENTER_SHORT",
            entryType: "COUNTER_SIGNAL_REVERSION",
            signalCandleTime: sourceEvaluation.signalCandleTime || currentCandle.time,
            atrVal: sourceEvaluation.atrVal || atrVal || 0,
            atrPips: sourceEvaluation.atrPips || atrPips || 0,
            currentPrice: entryPrice,
            rsiVal: sourceEvaluation.rsiVal || 0,
            adxVal: sourceEvaluation.adxVal || 0,
            pdiVal: sourceEvaluation.pdiVal || 0,
            mdiVal: sourceEvaluation.mdiVal || 0,
            adxRising: Boolean(sourceEvaluation.adxRising),
            prevAdxVal: sourceEvaluation.prevAdxVal || 0,
            currentDir: signalType === "BUY" ? 1 : -1,
            prevDir: sourceEvaluation.currentDir || 0,
            htfContext: {
                enabled: true,
                timeframe: "counter_signal",
                direction: signalType === "BUY" ? 1 : -1,
                longAllowed: signalType === "BUY",
                shortAllowed: signalType === "SELL",
                reason: `Inverted ${sourceStrategy} ${sourceEvaluation.signalType}`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan,
            strategyContext: {
                family: "counter_signal_reversion",
                setup: "pure_inverse",
                entryBias: inverseDirection,
                sourceStrategies,
                selectedSource: {
                    strategy: sourceStrategy,
                    signalType: sourceEvaluation.signalType,
                    reasonCode: sourceEvaluation.reasonCode || null,
                    entryType: sourceEvaluation.entryType || null,
                    entryBias: sourceDirection,
                    tradePlan: sourceEvaluation.tradePlan || null,
                    strategyContext: sourceEvaluation.strategyContext || null,
                },
                mirroredTradePlan: tradePlan,
            },
        };
    }

    return buildHoldResult(holdContext);
}

const counterSignalReversionStrategy = createStrategyDefinition({
    key: COUNTER_SIGNAL_REVERSION_KEY,
    label: "Counter Signal Reversion",
    description:
        "Pure inverse candidate that treats actionable source strategy entries as lagging exhaustion signals.",
    phaseIntroduced: 5,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["15m", "1h"],
        marketData: ["candles", "price", "session", "spread"],
        indicators: ["supertrend", "adx", "rsi", "atr", "stochastic"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
        entryValidation: {
            enforceGlobalMinAdx: false,
        },
        defaultConfig: DEFAULT_COUNTER_SIGNAL_REVERSION_CONFIG,
    },
    evaluateEntry: evaluateCounterSignalReversionEntry,
});

module.exports = Object.assign({}, counterSignalReversionStrategy, {
    COUNTER_SIGNAL_REVERSION_KEY,
    DEFAULT_COUNTER_SIGNAL_REVERSION_CONFIG,
    DEFAULT_COUNTER_SIGNAL_SOURCE_STRATEGIES,
    evaluateCounterSignalReversionEntry,
    invertSide,
    invertTradePlan,
    normalizeSourceStrategies,
});
