const crypto = require("crypto");
const defaults = require("../../../shared/tradingConfigDefaults.json");
const legacyDefaults = require("../../../shared/legacyIntradayConfigDefaults.json");

const clone = (value) => JSON.parse(JSON.stringify(value));

const NUMERIC_KEYS = new Set([
    "configSchemaVersion",
    "signalCooldown",
    "minAdx",
    "riskPerTrade",
    "maxCapitalAtRisk",
    "maxOpenPositions", // Retained for historical snapshots; retired from active config.
    "maxPortfolioExposure",
    "maxAggregateStopRiskPctNav",
    "maxNetCurrencyExposurePctNav",
    "maxCorrelatedExposurePctNav",
    "maxDailyLossPctNav",
    "maxDrawdownPctNav",
    "maxConsecutiveLosses",
    "correlationThreshold",
    "minNavAud",
    "leverage",
    "maxLeverage",
    "marginBuffer",
    "maxSpreadPips",
    "expectedSlippagePips",
    "maxPriceAgeMs",
    "maxEntryDeviationPips",
    "fixedPositionUnits",
    "stopLossPips",
    "stopLossAtrMultiplier",
    "minStopLossPips",
    "timeStopHours",
    "breakevenTriggerPips",
    "breakevenTriggerRiskMultiple",
    "trailingStopPips",
    "trailingStopActivationPips",
    "trailingStopActivationRiskMultiple",
    "trailingStopRiskMultiple",
    "sessionCloseLocalHour",
    "sessionCloseLocalMinute",
    "sessionCloseWindowMinutes",
    "intradayFastEmaPeriod",
    "intradaySlowEmaPeriod",
    "intradayAdxPeriod",
    "intradayMinAdx",
    "intradayAtrPeriod",
    "intradayRsiPeriod",
    "intradayBreakoutBars",
    "intradayPullbackBars",
    "intradayStopAtr",
    "intradayTargetRiskMultiple",
    "intradayMinBodyRatio",
    "intradayMinRangeAtr",
    "intradayMaxRangeAtr",
    "intradayLongRsiMinimum",
    "intradayLongRsiMaximum",
    "intradayShortRsiMinimum",
    "intradayShortRsiMaximum",
    "intradayMaxCostToStopRatio",
    "trendBreakoutBars", "trendExitBars", "trendAtrPeriod", "trendStopAtr",
    "trendMaxCostToStopRatio", "weekendCloseLocalHour", "weekendCloseLocalMinute",
]);

const BOOLEAN_KEYS = new Set([
    "enableTrading",
    "enableAdxFilter",
    "enableShorting",
    "enableHTFFilter",
    "enableSessionFilter",
    "portfolioRiskEnforcement",
    "enableTakeProfit",
    "enableBreakeven",
    "enableTrailingStops",
    "enableChannelTrailing",
    "enableEmailAlerts",
    "enforceConfigFreeze",
]);

const ARRAY_KEYS = new Set([
    "assets",
    "activeSessions",
]);

const HASH_EXCLUDED_KEYS = new Set([
    "configHash",
    "enableTrading",
    "logLevel",
    "enableEmailAlerts",
    "alertEmail",
    "enforceConfigFreeze",
]);

// The freeze is server policy, not an operational setting a caller can disable.
// Keep it outside the strategy hash so it cannot split otherwise identical runs.
const OPERATIONAL_KEYS = new Set(
    [...HASH_EXCLUDED_KEYS].filter((key) => key !== "enforceConfigFreeze")
);
const FREEZE_PROTECTED_KEYS = Object.keys(defaults).filter(
    (key) => !OPERATIONAL_KEYS.has(key)
);

function cloneDefaultConfig() {
    return clone(defaults);
}

function normalizeBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off", ""].includes(normalized))
            return false;
    }
    return Boolean(value);
}

function normalizeTradingConfig(config = {}, { mergeDefaults = true } = {}) {
    // Historical snapshots must not acquire new H4 defaults or change hashes.
    const legacy = config.strategy === "intraday_momentum" ||
        String(config.liveReleaseVersion || "").startsWith("m15-intraday-") ||
        String(config.executionPolicyVersion || "").startsWith("intraday-risk-");
    const base = mergeDefaults ? clone(legacy ? legacyDefaults : defaults) : {};
    const normalized = { ...base, ...clone(config || {}) };
    delete normalized.configHash;

    NUMERIC_KEYS.forEach((key) => {
        if (
            normalized[key] === undefined ||
            normalized[key] === null ||
            normalized[key] === ""
        ) {
            return;
        }
        const value = Number(normalized[key]);
        if (Number.isFinite(value)) normalized[key] = value;
        else if (mergeDefaults) normalized[key] = base[key];
        else delete normalized[key];
    });

    BOOLEAN_KEYS.forEach((key) => {
        if (normalized[key] !== undefined)
            normalized[key] = normalizeBoolean(normalized[key]);
    });

    ARRAY_KEYS.forEach((key) => {
        if (normalized[key] === undefined) return;
        normalized[key] = Array.isArray(normalized[key])
            ? normalized[key]
                  .map((value) =>
                      typeof value === "string" ? value.trim() : value
                  )
                  .filter((value) => value !== "" && value != null)
            : clone(base[key] || []);
    });

    if (!normalized.strategy && mergeDefaults)
        normalized.strategy = defaults.strategy;
    if (!normalized.timeframe && mergeDefaults)
        normalized.timeframe = defaults.timeframe;
    if (!normalized.positionSizeMethod && mergeDefaults)
        normalized.positionSizeMethod = defaults.positionSizeMethod;
    if (!normalized.stopLossType && mergeDefaults)
        normalized.stopLossType = defaults.stopLossType;
    if (typeof normalized.alertEmail !== "string" && mergeDefaults)
        normalized.alertEmail = defaults.alertEmail;

    if (mergeDefaults || normalized.referenceCurrency !== undefined)
        normalized.referenceCurrency = "AUD";
    if (mergeDefaults || normalized.accountCurrency !== undefined)
        normalized.accountCurrency = "AUD";
    return normalized;
}

function getStrategyDefaultConfig(strategyKey) {
    if (!strategyKey) return {};
    try {
        const { getStrategyDefinition } = require("../strategies");
        return clone(
            getStrategyDefinition(strategyKey).metadata?.defaultConfig || {}
        );
    } catch (_error) {
        return {};
    }
}

function materializeStrategyConfig(config = {}, options = {}) {
    const provided = clone(config || {});
    const strategyKey = options.strategyKey || provided.strategy ||
        options.baseConfig?.strategy || defaults.strategy;
    const base = normalizeTradingConfig({ ...(options.baseConfig || {}), strategy: strategyKey });
    return normalizeTradingConfig({
        ...base,
        ...getStrategyDefaultConfig(strategyKey),
        ...provided,
        strategy: strategyKey,
    });
}

function stableSort(value) {
    if (Array.isArray(value)) return value.map(stableSort);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value)
        .sort()
        .reduce((result, key) => {
            result[key] = stableSort(value[key]);
            return result;
        }, {});
}

function buildHashableConfig(config = {}) {
    const normalized = materializeStrategyConfig(config);
    return Object.keys(normalized)
        .filter(
            (key) =>
                !HASH_EXCLUDED_KEYS.has(key) && normalized[key] !== undefined
        )
        .sort()
        .reduce((result, key) => {
            result[key] = normalized[key];
            return result;
        }, {});
}

function computeConfigHash(config = {}) {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(stableSort(buildHashableConfig(config))))
        .digest("hex")
        .slice(0, 20);
}

function getProtectedConfigChanges(currentConfig = {}, incomingConfig = {}) {
    const current = normalizeTradingConfig(currentConfig);
    const next = normalizeTradingConfig({ ...current, ...incomingConfig });
    return Object.keys(incomingConfig).filter(
        (key) =>
            !OPERATIONAL_KEYS.has(key) &&
            JSON.stringify(current[key]) !== JSON.stringify(next[key])
    );
}

module.exports = {
    DEFAULT_TRADING_CONFIG: cloneDefaultConfig(),
    FREEZE_PROTECTED_KEYS,
    cloneDefaultConfig,
    normalizeTradingConfig,
    materializeStrategyConfig,
    getStrategyDefaultConfig,
    buildHashableConfig,
    computeConfigHash,
    getProtectedConfigChanges,
};
