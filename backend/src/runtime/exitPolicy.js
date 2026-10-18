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
const CHANNEL_OWNER_EXIT_POLICY_VERSION = 2;
const CHANNEL_EXIT_KIND = "H4_CHANNEL";
const weeklyExitClock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

function isH4ChannelExitPolicy(policy = {}) {
    const config = policy.config || policy;
    return policy.kind === CHANNEL_EXIT_KIND || policy.strategy === "multi_day_trend" ||
        config.strategy === "multi_day_trend" || config.liveReleaseVersion === "h4-channel-v1" ||
        config.executionPolicyVersion === "h4-channel-risk-v1";
}

// The multi-day release holds through ordinary weekday rollovers, then closes
// before the weekly market shutdown. Keep the entry embargo active through the
// existing Sunday 17:05 New York reopen, including either DST transition.
function resolveEntryExitWindowReason({ policy = {}, now = Date.now() } = {}) {
    if (!isH4ChannelExitPolicy(policy)) return null;
    if (!Number.isFinite(now)) return "WEEKEND_CLOSE";
    const values = Object.fromEntries(weeklyExitClock.formatToParts(new Date(now))
        .map((part) => [part.type, part.value]));
    const minute = Number(values.hour) * 60 + Number(values.minute);
    return values.weekday === "Sat" || values.weekday === "Fri" && minute >= 16 * 60 + 45 ||
        values.weekday === "Sun" && minute < 17 * 60 + 5 ? "WEEKEND_CLOSE" : null;
}

const OWNER_EXIT_CONFIG_KEYS = [
    "liveReleaseVersion",
    "executionPolicyVersion",
    "enableTakeProfit",
    "enableChannelTrailing",
    "channelTrailTimeframe",
    "trendExitBars",
    "timeStopHours",
    "sessionCloseHourUTC",
    "sessionCloseTimeZone",
    "sessionCloseLocalHour",
    "sessionCloseLocalMinute",
    "sessionCloseWindowMinutes",
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
    "commissionPerTradeAud",
    "commissionPerUnitAud",
    "commissionPerMillionAud",
    "financingRates",
    "financingRateAnnual",
    "financingCutoffHourUtc",
    "financingCutoffTimeZone",
    "financingCutoffLocalHour",
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
    const channelPolicy = isH4ChannelExitPolicy({ strategy, config });
    if (channelPolicy) {
        Object.assign(exitConfig, {
            liveReleaseVersion: "h4-channel-v1",
            executionPolicyVersion: "h4-channel-risk-v1",
            enableTakeProfit: false,
            enableBreakeven: false,
            enableTrailingStops: false,
            enableChannelTrailing: true,
            channelTrailTimeframe: "4h",
            trendExitBars: toFiniteNumber(config.trendExitBars, 10),
            timeStopHours: 0,
        });
    }
    if (
        tradePlan?.trailingStopPips !== undefined &&
        exitConfig.trailingStopPips === undefined
    ) {
        exitConfig.trailingStopPips = tradePlan.trailingStopPips;
    }

    return {
        version: channelPolicy ? CHANNEL_OWNER_EXIT_POLICY_VERSION : OWNER_EXIT_POLICY_VERSION,
        ...(channelPolicy ? { kind: CHANNEL_EXIT_KIND } : {}),
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
        trade?.brokerReconciliationPayload?.liveRuntime?.ownerExitPolicy;

    if (persisted?.config && persisted.version) return persisted;

    // Old positions without an explicit snapshot must not acquire the newly
    // selected multi-day exits. Normal persisted owners remain authoritative.
    const retainedConfig = trade?.brokerReconciliationPayload?.liveRuntime?.exitConfig;
    const config = retainedConfig || (isH4ChannelExitPolicy(fallbackConfig) && !isH4ChannelExitPolicy(trade)
        ? { ...require("../strategies/intradayMomentum").DEFAULT_INTRADAY_MOMENTUM_CONFIG,
            strategy: "intraday_momentum" }
        : fallbackConfig);

    return buildOwnerRunExitPolicy({
        strategy: trade.strategy || config.strategy,
        config,
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
    if (isH4ChannelExitPolicy(policy)) return resolveEntryExitWindowReason({ policy, now });
    const config = policy.config || policy || {};
    const entryTime = toFiniteNumber(trade.entryTime, now);
    const sessionCloseTimeZone = String(
        config.sessionCloseTimeZone || ""
    ).trim();
    const sessionCloseLocalHour = toFiniteNumber(
        config.sessionCloseLocalHour,
        null
    );
    const sessionCloseLocalMinute = Math.max(
        0,
        Math.min(59, toFiniteNumber(config.sessionCloseLocalMinute, 0))
    );
    const sessionCloseWindowMinutes = Math.max(
        1,
        toFiniteNumber(config.sessionCloseWindowMinutes, 30)
    );
    if (
        sessionCloseTimeZone &&
        Number.isFinite(sessionCloseLocalHour) &&
        sessionCloseLocalHour >= 0 &&
        sessionCloseLocalHour <= 23
    ) {
        try {
            const parts = new Intl.DateTimeFormat("en-US", {
                timeZone: sessionCloseTimeZone,
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
            }).formatToParts(new Date(now));
            const values = Object.fromEntries(
                parts
                    .filter((part) => part.type !== "literal")
                    .map((part) => [part.type, Number(part.value)])
            );
            const currentMinuteOfDay = values.hour * 60 + values.minute;
            const closeMinuteOfDay =
                sessionCloseLocalHour * 60 + sessionCloseLocalMinute;
            if (
                currentMinuteOfDay >= closeMinuteOfDay &&
                currentMinuteOfDay <
                    closeMinuteOfDay + sessionCloseWindowMinutes
            ) {
                return "SESSION_CLOSE";
            }
        } catch (_error) {
            // An invalid timezone fails over to the legacy UTC close below.
        }
    }

    const sessionCloseHourUtc = toFiniteNumber(
        config.sessionCloseHourUTC,
        null
    );
    if (
        Number.isFinite(sessionCloseHourUtc) &&
        new Date(now).getUTCHours() >= sessionCloseHourUtc
    ) {
        return "SESSION_CLOSE";
    }

    const timeStopHours = toFiniteNumber(config.timeStopHours, null);
    if (
        Number.isFinite(timeStopHours) &&
        timeStopHours > 0 &&
        now - entryTime >= timeStopHours * 60 * 60 * 1000
    ) {
        return "TIME_STOP";
    }

    return null;
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
    CHANNEL_OWNER_EXIT_POLICY_VERSION,
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    getTradeExitMetadata,
    isH4ChannelExitPolicy,
    resolveBreakevenDistance,
    resolveConfiguredDistance,
    resolveOwnerRunExitPolicy,
    resolveEntryExitWindowReason,
    resolveTimedExitReason,
    resolveTrailingStopDistances,
};
