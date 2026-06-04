const { createStrategyDefinition } = require("./strategyContract");
const {
    DEFAULT_COUNTER_SIGNAL_REVERSION_CONFIG,
    SIGNAL_FOLLOWING_KEY,
    buildFallbackTradePlan,
    deriveAtrFromCandles,
    evaluateSourceStrategy,
    getLastIndicatorValue,
    getPipValue,
    isActionableEntry,
    isStopValid,
    isTakeProfitValid,
    normalizeSourceStrategies,
    toFiniteNumber,
} = require("./counterSignalReversion");

const DEFAULT_SIGNAL_FOLLOWING_CONFIG = Object.freeze({
    ...DEFAULT_COUNTER_SIGNAL_REVERSION_CONFIG,
});

function buildHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: no source strategy entry to follow",
        reasonCode: overrides.reasonCode || "SIGNAL_FOLLOWING_NO_SOURCE_ENTRY",
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
            family: "signal_following",
            setup: "pure_follow",
            sourceStrategies: context.sourceStrategies || [],
            selectedSource: null,
        },
    };
}

function buildFollowTradePlan({
    sourceEvaluation = {},
    side,
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
        side,
        entryPrice,
        config,
        dataService,
    });
    const followedPlan = {
        ...(sourceEvaluation.tradePlan || {}),
        stopLossPrice: isStopValid(side, entryPrice, sourceStopLoss)
            ? sourceStopLoss
            : fallback?.stopLossPrice,
        takeProfitPrice: isTakeProfitValid(side, entryPrice, sourceTakeProfit)
            ? sourceTakeProfit
            : fallback?.takeProfitPrice,
    };

    if (!isStopValid(side, entryPrice, followedPlan.stopLossPrice)) {
        return fallback;
    }

    return followedPlan;
}

async function evaluateSignalFollowingEntry({
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
                reason: "HOLD: signal following requires at least 50 M15 candles",
                reasonCode: "SIGNAL_FOLLOWING_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_SIGNAL_FOLLOWING_CONFIG,
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
            reasonCode: "SIGNAL_FOLLOWING_NO_PRICE",
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

        const signalType = sourceEvaluation.signalType;
        const tradePlan = buildFollowTradePlan({
            sourceEvaluation,
            side: signalType,
            entryPrice,
            instrument,
            config: resolvedConfig,
            dataService,
        });
        const entryBias = signalType === "BUY" ? "long" : "short";

        return {
            signalType,
            reason:
                `${signalType}: signal following copied ${sourceStrategy} ` +
                `${sourceEvaluation.signalType} ${sourceEvaluation.reasonCode || "signal"}`,
            reasonCode:
                signalType === "BUY"
                    ? "SIGNAL_FOLLOWING_LONG_ACTIONABLE"
                    : "SIGNAL_FOLLOWING_SHORT_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: signalType === "BUY" ? "ENTER_LONG" : "ENTER_SHORT",
            entryType: "SIGNAL_FOLLOWING",
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
            prevDir: sourceEvaluation.prevDir || 0,
            htfContext: {
                enabled: true,
                timeframe: "signal_following",
                direction: signalType === "BUY" ? 1 : -1,
                longAllowed: signalType === "BUY",
                shortAllowed: signalType === "SELL",
                reason: `Followed ${sourceStrategy} ${sourceEvaluation.signalType}`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan,
            strategyContext: {
                family: "signal_following",
                setup: "pure_follow",
                entryBias,
                sourceStrategies,
                selectedSource: {
                    strategy: sourceStrategy,
                    signalType: sourceEvaluation.signalType,
                    reasonCode: sourceEvaluation.reasonCode || null,
                    entryType: sourceEvaluation.entryType || null,
                    entryBias,
                    tradePlan: sourceEvaluation.tradePlan || null,
                    strategyContext: sourceEvaluation.strategyContext || null,
                },
                followedTradePlan: tradePlan,
            },
        };
    }

    return buildHoldResult(holdContext);
}

const signalFollowingStrategy = createStrategyDefinition({
    key: SIGNAL_FOLLOWING_KEY,
    label: "Signal Following",
    description:
        "Aggregate candidate that treats actionable source strategy entries as confirmation and follows the first available setup.",
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
        sourceSignalAggregation: true,
        entryValidation: {
            enforceGlobalMinAdx: false,
        },
        defaultConfig: DEFAULT_SIGNAL_FOLLOWING_CONFIG,
    },
    evaluateEntry: evaluateSignalFollowingEntry,
});

module.exports = Object.assign({}, signalFollowingStrategy, {
    DEFAULT_SIGNAL_FOLLOWING_CONFIG,
    SIGNAL_FOLLOWING_KEY,
    buildFollowTradePlan,
    evaluateSignalFollowingEntry,
});
