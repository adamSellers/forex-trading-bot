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

const OWNER_EXIT_POLICY_VERSION = 1;

const OWNER_EXIT_CONFIG_KEYS = [
    "timeStopHours",
    "sessionCloseHourUTC",
    "enableBreakeven",
    "breakevenTriggerPips",
    "breakevenTriggerRiskMultiple",
    "breakevenTriggerAtrMultiplier",
    "breakevenAtTpPercent",
    "breakevenSlMultiplier",
    "enableTrailingStops",
    "trailingStopActivationPips",
    "trailingStopActivationRiskMultiple",
    "trailingStopActivationAtrMultiplier",
    "trailingStopPips",
    "trailingStopRiskMultiple",
    "trailingStopAtrMultiplier",
    "tpRangeMultiplier",
    "trailActivationMultiplier",
    "trailDistanceMultiplier",
    "trailActivationSlMultiplier",
    "trailDistanceAtr",
    "trailActivationAtr",
    "paperCommissionPerTradeAud",
    "commissionPerTradeAud",
    "paperCommissionPerUnitAud",
    "commissionPerUnitAud",
    "paperCommissionPerMillionAud",
    "commissionPerMillionAud",
    "paperCommissionSides",
    "paperFinancingRates",
    "financingRates",
    "paperFinancingRateAnnual",
    "financingRateAnnual",
    "paperFinancingRateMaxAgeMs",
    "paperFinancingCutoffHourUtc",
    "financingCutoffHourUtc",
    "paperFinancingCutoffTimeZone",
    "financingCutoffTimeZone",
    "paperFinancingCutoffLocalHour",
    "financingCutoffLocalHour",
    "paperTripleRolloverWeekday",
    "tripleRolloverWeekday",
];

function pickExitConfig(config = {}) {
    return OWNER_EXIT_CONFIG_KEYS.reduce((snapshot, key) => {
        if (config[key] !== undefined) {
            snapshot[key] =
                config[key] && typeof config[key] === "object"
                    ? JSON.parse(JSON.stringify(config[key]))
                    : config[key];
        }
        return snapshot;
    }, {});
}

/**
 * Immutable-at-entry exit rules. Persist this object with the trade so changing
 * the globally selected strategy cannot alter an existing position's exits.
 */
function buildOwnerRunExitPolicy({
    strategy = null,
    config = {},
    tradePlan = {},
    ownerRunId = null,
    createdAt = Date.now(),
} = {}) {
    const exitConfig = pickExitConfig(config);
    if (
        tradePlan?.trailingStopPips !== undefined &&
        exitConfig.trailingStopPips === undefined
    ) {
        exitConfig.trailingStopPips = tradePlan.trailingStopPips;
    }

    return {
        version: OWNER_EXIT_POLICY_VERSION,
        ownerRunId,
        strategy: strategy || config.strategy || null,
        createdAt,
        config: exitConfig,
    };
}

function resolveOwnerRunExitPolicy(trade = {}, fallbackConfig = {}) {
    const persisted =
        trade.ownerExitPolicy ||
        trade?.brokerReconciliationPayload?.ownerExitPolicy ||
        trade?.brokerReconciliationPayload?.paperRuntime?.ownerExitPolicy ||
        trade?.brokerReconciliationPayload?.liveRuntime?.ownerExitPolicy;

    if (persisted?.config && persisted.version) return persisted;

    return buildOwnerRunExitPolicy({
        strategy: trade.strategy || fallbackConfig.strategy,
        config: fallbackConfig,
        tradePlan: {
            trailingStopPips: trade.trailingStopPips,
        },
        ownerRunId: trade.ownerRunId || trade.runId || null,
        createdAt: toFiniteNumber(trade.entryTime, Date.now()),
    });
}

function resolveBreakevenDistance({
    trade = {},
    policy = {},
    pipValue = 0,
    runtimeMetadata = {},
} = {}) {
    const config = policy.config || policy || {};
    const strategy = policy.strategy || trade.strategy;
    const { initialStopDistance } = getTradeExitMetadata({
        trade,
        runtimeMetadata,
        pipValue,
    });
    const takeProfitPrice = toFiniteNumber(trade.takeProfitPrice, null);
    const entryPrice = toFiniteNumber(trade.entryPrice, null);

    if (
        strategy === "mean_reversion" &&
        Number.isFinite(takeProfitPrice) &&
        Number.isFinite(entryPrice)
    ) {
        return (
            Math.abs(takeProfitPrice - entryPrice) *
            Math.max(0, toFiniteNumber(config.breakevenAtTpPercent, 0.5))
        );
    }
    if (
        strategy === "stochastic_divergence" &&
        Number.isFinite(initialStopDistance)
    ) {
        return (
            initialStopDistance *
            Math.max(0, toFiniteNumber(config.breakevenSlMultiplier, 1))
        );
    }
    if (config.enableBreakeven === false) return null;

    return resolveConfiguredDistance({
        trade,
        config,
        pipValue,
        runtimeMetadata,
        pipsKey: "breakevenTriggerPips",
        riskMultipleKey: "breakevenTriggerRiskMultiple",
        atrMultipleKey: "breakevenTriggerAtrMultiplier",
        defaultPips: 5,
    });
}

function resolveTrailingStopDistances({
    trade = {},
    policy = {},
    pipValue = 0,
    runtimeMetadata = {},
} = {}) {
    const config = policy.config || policy || {};
    const strategy = policy.strategy || trade.strategy;
    const { initialStopDistance, atrDistance } = getTradeExitMetadata({
        trade,
        runtimeMetadata,
        pipValue,
    });
    const takeProfitPrice = toFiniteNumber(trade.takeProfitPrice, null);
    const entryPrice = toFiniteNumber(trade.entryPrice, null);

    if (
        strategy === "range_breakout" &&
        Number.isFinite(takeProfitPrice) &&
        Number.isFinite(entryPrice)
    ) {
        const tpMultiplier = Math.max(
            0.1,
            toFiniteNumber(config.tpRangeMultiplier, 1.5)
        );
        const rangeHeight = Math.abs(takeProfitPrice - entryPrice) / tpMultiplier;
        return {
            activationDistance:
                rangeHeight *
                Math.max(0, toFiniteNumber(config.trailActivationMultiplier, 1)),
            trailDistance:
                rangeHeight *
                Math.max(0, toFiniteNumber(config.trailDistanceMultiplier, 0.5)),
        };
    }
    if (
        strategy === "stochastic_divergence" &&
        Number.isFinite(initialStopDistance) &&
        Number.isFinite(atrDistance)
    ) {
        return {
            activationDistance:
                initialStopDistance *
                Math.max(
                    0,
                    toFiniteNumber(config.trailActivationSlMultiplier, 1.5)
                ),
            trailDistance:
                atrDistance *
                Math.max(0, toFiniteNumber(config.trailDistanceAtr, 1)),
        };
    }
    if (strategy === "squeeze_play" && Number.isFinite(atrDistance)) {
        return {
            activationDistance:
                atrDistance *
                Math.max(0, toFiniteNumber(config.trailActivationAtr, 2)),
            trailDistance:
                atrDistance *
                Math.max(0, toFiniteNumber(config.trailDistanceAtr, 1)),
        };
    }
    if (config.enableTrailingStops === false) {
        return { activationDistance: null, trailDistance: null };
    }

    return {
        activationDistance: resolveConfiguredDistance({
            trade,
            config,
            pipValue,
            runtimeMetadata,
            pipsKey: "trailingStopActivationPips",
            riskMultipleKey: "trailingStopActivationRiskMultiple",
            atrMultipleKey: "trailingStopActivationAtrMultiplier",
            defaultPips: 20,
        }),
        trailDistance: resolveConfiguredDistance({
            trade,
            config,
            pipValue,
            runtimeMetadata,
            pipsKey: "trailingStopPips",
            riskMultipleKey: "trailingStopRiskMultiple",
            atrMultipleKey: "trailingStopAtrMultiplier",
            defaultPips: 25,
        }),
    };
}

function resolveTimedExitReason({ trade = {}, policy = {}, now = Date.now() }) {
    const config = policy.config || policy || {};
    const strategy = policy.strategy || trade.strategy;
    const entryTime = toFiniteNumber(trade.entryTime, now);
    const timeStopHours = toFiniteNumber(config.timeStopHours, null);
    if (
        Number.isFinite(timeStopHours) &&
        timeStopHours > 0 &&
        now - entryTime >= timeStopHours * 60 * 60 * 1000
    ) {
        return "TIME_STOP";
    }

    if (strategy !== "range_breakout") return null;
    const closeHour = toFiniteNumber(config.sessionCloseHourUTC, null);
    if (!Number.isFinite(closeHour)) return null;

    const firstClose = new Date(entryTime);
    firstClose.setUTCHours(Math.max(0, Math.min(23, closeHour)), 0, 0, 0);
    if (firstClose.getTime() <= entryTime) {
        firstClose.setUTCDate(firstClose.getUTCDate() + 1);
    }
    return now >= firstClose.getTime() ? "SESSION_CLOSE" : null;
}

function calculateMonotonicStop({ trade = {}, currentPrice, trailDistance }) {
    const price = toFiniteNumber(currentPrice, null);
    const distance = toFiniteNumber(trailDistance, null);
    if (!Number.isFinite(price) || !Number.isFinite(distance) || distance <= 0) {
        return null;
    }

    const nextStop = trade.side === "SELL" ? price + distance : price - distance;
    const activeStop = toFiniteNumber(
        trade.stopLossPrice,
        toFiniteNumber(trade.trailingStopPrice, null)
    );
    if (!Number.isFinite(activeStop)) return nextStop;
    if (trade.side === "SELL") return nextStop < activeStop ? nextStop : null;
    return nextStop > activeStop ? nextStop : null;
}

module.exports = {
    OWNER_EXIT_POLICY_VERSION,
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    getTradeExitMetadata,
    resolveBreakevenDistance,
    resolveConfiguredDistance,
    resolveOwnerRunExitPolicy,
    resolveTimedExitReason,
    resolveTrailingStopDistances,
};
