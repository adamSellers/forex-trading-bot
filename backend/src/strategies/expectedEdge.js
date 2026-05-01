function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundNumber(value, precision = 2) {
    if (!Number.isFinite(value)) {
        return null;
    }

    return Number(value.toFixed(precision));
}

function normalizePips(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = toFiniteNumber(value, null);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeProbability(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = toFiniteNumber(value, null);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
        ? parsed
        : null;
}

function priceDistanceToPips(leftPrice, rightPrice, pipValue) {
    const left = toFiniteNumber(leftPrice, null);
    const right = toFiniteNumber(rightPrice, null);
    const pip = toFiniteNumber(pipValue, null);

    if (!Number.isFinite(left) || !Number.isFinite(right) || !pip || pip <= 0) {
        return null;
    }

    return Math.abs(left - right) / pip;
}

function calculateExpectedEdge({
    entryPrice,
    stopLossPrice = null,
    takeProfitPrice = null,
    stopPips = null,
    targetPips = null,
    pipValue,
    spreadPips = null,
    slippagePips = 0,
    minNetEdgePips = 0,
    winProbability = null,
} = {}) {
    const grossTargetPips =
        normalizePips(targetPips) ??
        priceDistanceToPips(entryPrice, takeProfitPrice, pipValue);
    const grossStopPips =
        normalizePips(stopPips) ??
        priceDistanceToPips(entryPrice, stopLossPrice, pipValue);

    if (!Number.isFinite(grossTargetPips) || !Number.isFinite(grossStopPips)) {
        return null;
    }

    const spreadCostPips = normalizePips(spreadPips) ?? 0;
    const slippageCostPips = normalizePips(slippagePips) ?? 0;
    const totalCostPips = spreadCostPips + slippageCostPips;
    const payoffSkewPips = grossTargetPips - grossStopPips;
    const targetAfterCostPips = grossTargetPips - totalCostPips;
    const normalizedWinProbability = normalizeProbability(winProbability);
    const grossExpectancyPips =
        normalizedWinProbability === null
            ? null
            : normalizedWinProbability * grossTargetPips -
              (1 - normalizedWinProbability) * grossStopPips;
    const netExpectancyPips =
        grossExpectancyPips === null
            ? null
            : grossExpectancyPips - totalCostPips;
    const breakEvenWinRate =
        grossTargetPips + grossStopPips > 0
            ? (grossStopPips + totalCostPips) /
              (grossTargetPips + grossStopPips)
            : null;
    const minNetEdge = Math.max(0, toFiniteNumber(minNetEdgePips, 0));
    const brokerFeedingOnly =
        netExpectancyPips === null
            ? targetAfterCostPips <= minNetEdge
            : netExpectancyPips <= minNetEdge;
    const requiresProbabilityModel = normalizedWinProbability === null;
    const edgeVerdict = brokerFeedingOnly
        ? "BROKER_FEEDING"
        : requiresProbabilityModel
        ? "REQUIRES_WIN_RATE_MODEL"
        : "POSITIVE_EXPECTANCY";

    return {
        grossTargetPips: roundNumber(grossTargetPips),
        grossStopPips: roundNumber(grossStopPips),
        spreadCostPips: roundNumber(spreadCostPips),
        slippageCostPips: roundNumber(slippageCostPips),
        totalCostPips: roundNumber(totalCostPips),
        grossRewardRisk:
            grossStopPips > 0
                ? roundNumber(grossTargetPips / grossStopPips, 3)
                : null,
        breakEvenWinRate: roundNumber(breakEvenWinRate, 4),
        assumedWinProbability: roundNumber(normalizedWinProbability, 4),
        grossExpectancyPips: roundNumber(grossExpectancyPips),
        netExpectancyPips: roundNumber(netExpectancyPips),
        payoffSkewPips: roundNumber(payoffSkewPips),
        targetAfterCostPips: roundNumber(targetAfterCostPips),
        netEdgePips: roundNumber(netExpectancyPips),
        requiresProbabilityModel,
        brokerFeedingOnly,
        edgeVerdict,
        brokerFeedingReason: brokerFeedingOnly
            ? "Estimated payoff does not clear spread/slippage cost"
            : null,
    };
}

module.exports = {
    calculateExpectedEdge,
};
