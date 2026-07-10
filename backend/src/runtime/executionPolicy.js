function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function isDirectionValid(side, entryPrice, price, kind) {
    if (!Number.isFinite(price)) return kind === "takeProfit";
    if (side === "SELL") {
        return kind === "stop" ? price > entryPrice : price < entryPrice;
    }
    return kind === "stop" ? price < entryPrice : price > entryPrice;
}

function calculateFallbackStopPips(signal = {}, config = {}) {
    const atrPips = toFiniteNumber(signal.atrPips, 0);
    const useAtr =
        String(config.stopLossType || "ATR").toUpperCase() === "ATR" &&
        atrPips > 0;
    const configuredPips = useAtr
        ? atrPips * Math.max(0, toFiniteNumber(config.stopLossAtrMultiplier, 2))
        : Math.max(0, toFiniteNumber(config.stopLossPips, 30));
    const minimumPips = Math.max(
        0,
        toFiniteNumber(config.minStopLossPips, 15)
    );
    return Math.max(configuredPips, minimumPips);
}

/** Canonical strategy-plan/fallback stop resolution shared by paper and live. */
function resolveCanonicalTradePlan({
    signal = {},
    config = {},
    entryPrice = signal.currentPrice,
    pipValue,
} = {}) {
    const entry = toFiniteNumber(entryPrice, null);
    const pip = toFiniteNumber(pipValue, null);
    const side = signal.signal === "SELL" ? "SELL" : "BUY";
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(pip) || pip <= 0) {
        return null;
    }

    const minimumPips = Math.max(
        0,
        toFiniteNumber(config.minStopLossPips, 15)
    );
    const plannedStop = toFiniteNumber(signal?.tradePlan?.stopLossPrice, null);
    const planIsValid = isDirectionValid(side, entry, plannedStop, "stop");
    let stopLossPips;
    let source;
    let floored = false;

    if (Number.isFinite(plannedStop) && planIsValid) {
        stopLossPips = Math.abs(entry - plannedStop) / pip;
        source = "SIGNAL_TRADE_PLAN";
        if (stopLossPips < minimumPips) {
            stopLossPips = minimumPips;
            floored = true;
        }
    } else {
        stopLossPips = calculateFallbackStopPips(signal, config);
        source = "GLOBAL_CONFIG";
    }

    if (!Number.isFinite(stopLossPips) || stopLossPips <= 0) return null;
    const stopDistance = stopLossPips * pip;
    const stopLossPrice =
        side === "SELL" ? entry + stopDistance : entry - stopDistance;
    const plannedTakeProfit = toFiniteNumber(
        signal?.tradePlan?.takeProfitPrice,
        null
    );
    const takeProfitPrice = isDirectionValid(
        side,
        entry,
        plannedTakeProfit,
        "takeProfit"
    )
        ? plannedTakeProfit
        : null;

    return {
        ...(signal.tradePlan || {}),
        stopLossPrice,
        stopLossPips,
        stopDistance,
        takeProfitPrice,
        source,
        floored,
    };
}

function getTimesFmPositionSizeMultiplier(signal = {}, config = {}) {
    const mode = String(config.timesFmMode || "disabled").toLowerCase();
    if (
        config.timesFmEnabled !== true ||
        (mode !== "size" && mode !== "veto")
    ) {
        return 1;
    }

    return clamp(
        toFiniteNumber(signal?.timesFm?.positionSizeMultiplier, 1),
        0,
        1
    );
}

function getEntryRiskMultipliers(signal = {}, config = {}) {
    const freshFlip =
        signal.entryType === "FRESH_FLIP"
            ? Math.max(0, toFiniteNumber(config.freshFlipRiskMultiplier, 1))
            : 1;
    const timesFm = getTimesFmPositionSizeMultiplier(signal, config);
    return {
        freshFlip,
        timesFm,
        combined: freshFlip * timesFm,
    };
}

function resolveLeverage(config = {}) {
    const requested = Math.max(1, toFiniteNumber(config.leverage, 20));
    const ceiling = Math.max(
        1,
        toFiniteNumber(config.maxLeverage, requested)
    );
    return Math.min(requested, ceiling);
}

function calculateMarginAud({ units, baseToAudRate, leverage }) {
    const normalizedUnits = Math.abs(toFiniteNumber(units, 0));
    const rate = toFiniteNumber(baseToAudRate, null);
    const normalizedLeverage = Math.max(1, toFiniteNumber(leverage, 1));
    if (!Number.isFinite(rate) || rate <= 0 || normalizedUnits <= 0) {
        return null;
    }
    return (normalizedUnits * rate) / normalizedLeverage;
}

/**
 * Returns a rich sizing decision so both adapters can persist identical inputs.
 * All amounts are in AUD and missing/invalid conversion inputs fail closed.
 */
function calculateCanonicalPositionSize({
    config = {},
    signal = {},
    entryPrice,
    stopLossPrice,
    equityAud,
    marginAvailableAud,
    baseToAudRate,
    quoteToAudRate,
} = {}) {
    const entry = toFiniteNumber(entryPrice, null);
    const stop = toFiniteNumber(stopLossPrice, null);
    const equity = toFiniteNumber(equityAud, null);
    const freeMargin = toFiniteNumber(marginAvailableAud, null);
    const baseRate = toFiniteNumber(baseToAudRate, null);
    const quoteRate = toFiniteNumber(quoteToAudRate, null);
    if (
        !Number.isFinite(entry) ||
        entry <= 0 ||
        !Number.isFinite(stop) ||
        stop === entry ||
        !Number.isFinite(equity) ||
        equity <= 0 ||
        !Number.isFinite(freeMargin) ||
        freeMargin <= 0 ||
        !Number.isFinite(baseRate) ||
        baseRate <= 0 ||
        !Number.isFinite(quoteRate) ||
        quoteRate <= 0
    ) {
        return {
            units: 0,
            valid: false,
            code: "INVALID_SIZING_INPUT",
            reason: "Position sizing inputs or AUD conversion are unavailable",
        };
    }

    const leverage = resolveLeverage(config);
    const marginBuffer = clamp(
        toFiniteNumber(config.marginBuffer, 0.2),
        0,
        0.95
    );
    const safeMarginAvailableAud = freeMargin * (1 - marginBuffer);
    const leverageCapUnits = Math.floor(
        (safeMarginAvailableAud * leverage) / baseRate
    );
    const multipliers = getEntryRiskMultipliers(signal, config);
    let requestedUnits;
    let riskBudgetAud = null;
    let riskPerUnitAud = null;
    let effectiveRiskCapitalAud = null;

    if (String(config.positionSizeMethod || "RISK").toUpperCase() === "FIXED") {
        // Preserve fixed-size semantics while applying TimesFM's explicit size
        // control. The fresh-flip multiplier belongs to risk-budget sizing.
        requestedUnits = Math.floor(
            Math.max(0, toFiniteNumber(config.fixedPositionUnits, 1000)) *
                multipliers.timesFm
        );
    } else {
        const maxCapitalAtRisk = Math.max(
            0,
            toFiniteNumber(config.maxCapitalAtRisk, 0)
        );
        effectiveRiskCapitalAud =
            maxCapitalAtRisk > 0
                ? Math.min(safeMarginAvailableAud, maxCapitalAtRisk)
                : safeMarginAvailableAud;
        const riskFraction = Math.max(
            0,
            toFiniteNumber(config.riskPerTrade, 0.01)
        );
        riskBudgetAud =
            effectiveRiskCapitalAud * riskFraction * multipliers.combined;
        riskPerUnitAud = Math.abs(entry - stop) * quoteRate;
        requestedUnits =
            riskPerUnitAud > 0
                ? Math.floor(riskBudgetAud / riskPerUnitAud)
                : 0;
    }

    const units = Math.max(
        0,
        Math.min(requestedUnits || 0, leverageCapUnits || 0)
    );
    const marginRequiredAud = calculateMarginAud({
        units,
        baseToAudRate: baseRate,
        leverage,
    });

    return {
        units,
        valid: units >= 1,
        code: units >= 1 ? null : "POSITION_SIZE_TOO_SMALL",
        reason: units >= 1 ? null : "Position size too small",
        requestedUnits,
        leverageCapUnits,
        leverage,
        marginBuffer,
        safeMarginAvailableAud,
        effectiveRiskCapitalAud,
        riskBudgetAud,
        riskPerUnitAud,
        marginRequiredAud: marginRequiredAud || 0,
        multipliers,
        baseToAudRate: baseRate,
        quoteToAudRate: quoteRate,
    };
}

function calculateProjectedExposure({
    marginUsedAud,
    projectedMarginAud,
    equityAud,
}) {
    const equity = toFiniteNumber(equityAud, null);
    if (!Number.isFinite(equity) || equity <= 0) return null;
    return (
        (Math.max(0, toFiniteNumber(marginUsedAud, 0)) +
            Math.max(0, toFiniteNumber(projectedMarginAud, 0))) /
        equity
    );
}

module.exports = {
    calculateCanonicalPositionSize,
    calculateFallbackStopPips,
    calculateMarginAud,
    calculateProjectedExposure,
    getEntryRiskMultipliers,
    getTimesFmPositionSizeMultiplier,
    resolveCanonicalTradePlan,
    resolveLeverage,
};
