const CANONICAL_STRATEGY_KEYS = Object.freeze(["intraday_momentum"]);

const CANONICAL_STRATEGY_KEY_SET = new Set(CANONICAL_STRATEGY_KEYS);

function assertCanonicalStrategyKey(strategyKey) {
    if (!CANONICAL_STRATEGY_KEY_SET.has(strategyKey)) {
        throw new Error(`Unknown canonical strategy key: ${strategyKey}`);
    }

    return strategyKey;
}

function normalizeRequiredData(requiredData = {}) {
    return {
        indicators: Array.isArray(requiredData.indicators)
            ? [...requiredData.indicators]
            : [],
        marketData: Array.isArray(requiredData.marketData)
            ? [...requiredData.marketData]
            : [],
        timeframes: Array.isArray(requiredData.timeframes)
            ? [...requiredData.timeframes]
            : [],
    };
}

function createNoopResult(context = {}) {
    const currentPrice = context.currentPrice ?? null;

    return {
        signalType: "HOLD",
        reason: "Strategy not yet wired into runtime",
        reasonCode: "STRATEGY_NOT_READY",
        signalClass: "FILTERED",
        intent: "WAIT",
        entryType: null,
        signalCandleTime: null,
        atrVal: 0,
        atrPips: 0,
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
            enabled: false,
            timeframe: null,
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason: null,
        },
        pendingAction: "clear",
        pending: null,
        metadata: {
            strategy: context.strategy || null,
        },
    };
}

function createStrategyDefinition(definition = {}) {
    const {
        key,
        label,
        description = "",
        version = "1.0.0",
        phaseIntroduced = null,
        runtimeStatus = "planned",
        requiredData = {},
        metadata = {},
        evaluateEntry,
        evaluateExit,
        createInitialState,
        reduceState,
    } = definition;

    assertCanonicalStrategyKey(key);

    if (typeof label !== "string" || !label.trim()) {
        throw new Error(`Strategy ${key} must define a label`);
    }

    return Object.freeze({
        key,
        label: label.trim(),
        description: description.trim(),
        version: String(version || "1.0.0"),
        phaseIntroduced,
        runtimeStatus,
        requiredData: normalizeRequiredData(requiredData),
        metadata: { ...metadata },
        evaluateEntry:
            typeof evaluateEntry === "function"
                ? evaluateEntry
                : (context = {}) => createNoopResult({ ...context, strategy: key }),
        evaluateExit:
            typeof evaluateExit === "function"
                ? evaluateExit
                : (context = {}) => createNoopResult({ ...context, strategy: key }),
        createInitialState:
            typeof createInitialState === "function"
                ? createInitialState
                : () => ({}),
        reduceState:
            typeof reduceState === "function"
                ? reduceState
                : (state = {}) => state,
    });
}

module.exports = {
    CANONICAL_STRATEGY_KEYS,
    assertCanonicalStrategyKey,
    createNoopResult,
    createStrategyDefinition,
};
