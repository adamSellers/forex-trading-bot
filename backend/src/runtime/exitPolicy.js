function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getTradeExitMetadata({
    trade = {},
    runtimeMetadata = {},
    pipValue = 0,
} = {}) {
    const entryPrice = toFiniteNumber(trade.entryPrice, null);
    const currentStopLossPrice = toFiniteNumber(trade.stopLossPrice, null);
    const initialStopLossPrice = toFiniteNumber(
        runtimeMetadata.initialStopLossPrice,
        currentStopLossPrice
    );
    const initialStopDistance = toFiniteNumber(
        runtimeMetadata.initialStopDistance,
        Number.isFinite(entryPrice) && Number.isFinite(initialStopLossPrice)
            ? Math.abs(entryPrice - initialStopLossPrice)
            : null
    );
    const atrDistance = toFiniteNumber(
        runtimeMetadata.atrDistance,
        Math.max(0, toFiniteNumber(trade.atrPips, 0)) *
            Math.max(0, toFiniteNumber(pipValue, 0))
    );

    return {
        initialStopLossPrice,
        initialStopDistance,
        atrDistance,
    };
}

function resolveConfiguredDistance({
    trade = {},
    config = {},
    pipValue = 0,
    runtimeMetadata = {},
    pipsKey,
    riskMultipleKey,
    atrMultipleKey,
    defaultPips,
} = {}) {
    const { initialStopDistance, atrDistance } = getTradeExitMetadata({
        trade,
        runtimeMetadata,
        pipValue,
    });
    const riskMultiple = toFiniteNumber(config[riskMultipleKey], null);
    if (
        Number.isFinite(riskMultiple) &&
        riskMultiple > 0 &&
        Number.isFinite(initialStopDistance) &&
        initialStopDistance > 0
    ) {
        return initialStopDistance * riskMultiple;
    }

    const atrMultiple = toFiniteNumber(config[atrMultipleKey], null);
    if (
        Number.isFinite(atrMultiple) &&
        atrMultiple > 0 &&
        Number.isFinite(atrDistance) &&
        atrDistance > 0
    ) {
        return atrDistance * atrMultiple;
    }

    const pips = toFiniteNumber(config[pipsKey], defaultPips);
    const pipDistance = Math.max(0, toFiniteNumber(pips, 0)) *
        Math.max(0, toFiniteNumber(pipValue, 0));
    return pipDistance > 0 ? pipDistance : null;
}

module.exports = {
    getTradeExitMetadata,
    resolveConfiguredDistance,
};
