const crypto = require("crypto");
const defaultConfig = require("../../../shared/tradingConfigDefaults.json");

const CLONE = (value) => JSON.parse(JSON.stringify(value));

const NUMERIC_KEYS = new Set([
    "maxCapitalAtRisk",
    "maxOpenPositions",
    "signalCooldown",
    "supertrendPeriod",
    "supertrendMultiplier",
    "minAdx",
    "adxSlopeLookback",
    "longRsiMomentumFloor",
    "shortRsiMomentumCeiling",
    "freshLongRsiCeiling",
    "rsiOverbought",
    "rsiOversold",
    "continuationWindowMs",
    "continuationRsiThreshold",
    "continuationMaxPriceDeviation",
    "continuationPullbackMinAtr",
    "continuationPullbackMaxAtr",
    "timesFmHorizonBars",
    "timesFmTimeoutMs",
    "timesFmVetoConfidence",
    "timesFmDeadZoneBps",
    "riskPerTrade",
    "freshFlipRiskMultiplier",
    "maxPortfolioExposure",
    "leverage",
    "maxSpreadPips",
    "maxPriceAgeMs",
    "fixedPositionUnits",
    "stopLossPips",
    "stopLossAtrMultiplier",
    "minStopLossPips",
    "trailingStopPips",
    "trailingStopActivationPips",
    "takeProfitPercent",
    "breakevenTriggerPips",
    "maxLeverage",
]);

const BOOLEAN_KEYS = new Set([
    "enableTrading",
    "enableAdxFilter",
    "adxSlopeFilter",
    "requireDirectionalAdx",
    "enableRsiFilter",
    "enableContinuationEntry",
    "enableLongContinuationEntry",
    "enableShortContinuationEntry",
    "enableHTFFilter",
    "enableShorting",
    "timesFmEnabled",
    "enableTrailingStops",
    "enableTakeProfit",
    "enableBreakeven",
    "enableSessionFilter",
    "enableEmailAlerts",
    "enforceConfigFreeze",
]);

const ARRAY_KEYS = new Set(["assets", "activeSessions"]);

const FREEZE_PROTECTED_KEYS = new Set([
    "assets",
    "strategy",
    "timeframe",
    "signalCooldown",
    "supertrendPeriod",
    "supertrendMultiplier",
    "enableAdxFilter",
    "minAdx",
    "adxSlopeFilter",
    "adxSlopeLookback",
    "requireDirectionalAdx",
    "longRsiMomentumFloor",
    "shortRsiMomentumCeiling",
    "freshLongRsiCeiling",
    "enableRsiFilter",
    "rsiOverbought",
    "rsiOversold",
    "enableContinuationEntry",
    "enableLongContinuationEntry",
    "enableShortContinuationEntry",
    "continuationWindowMs",
    "continuationRsiThreshold",
    "continuationMaxPriceDeviation",
    "continuationPullbackMinAtr",
    "continuationPullbackMaxAtr",
    "enableHTFFilter",
    "htfTimeframe",
    "enableShorting",
    "timesFmEnabled",
    "timesFmMode",
    "timesFmHorizonBars",
    "timesFmTimeoutMs",
    "timesFmVetoConfidence",
    "timesFmDeadZoneBps",
    "riskPerTrade",
    "freshFlipRiskMultiplier",
    "maxCapitalAtRisk",
    "maxOpenPositions",
    "maxPortfolioExposure",
    "leverage",
    "maxSpreadPips",
    "maxPriceAgeMs",
    "positionSizeMethod",
    "fixedPositionUnits",
    "stopLossType",
    "stopLossPips",
    "stopLossAtrMultiplier",
    "minStopLossPips",
    "enableTrailingStops",
    "trailingStopPips",
    "trailingStopActivationPips",
    "enableTakeProfit",
    "takeProfitPercent",
    "enableBreakeven",
    "breakevenTriggerPips",
    "enableSessionFilter",
    "activeSessions",
]);

const HASH_KEYS = new Set(FREEZE_PROTECTED_KEYS);

function cloneDefaultConfig() {
    return CLONE(defaultConfig);
}

function normalizeArray(value, fallback) {
    if (!Array.isArray(value)) {
        return CLONE(fallback);
    }

    return value
        .map((item) => (typeof item === "string" ? item.trim() : item))
        .filter(Boolean);
}

function normalizeBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) {
            return true;
        }
        if (["false", "0", "no", "off", ""].includes(normalized)) {
            return false;
        }
    }

    return Boolean(value);
}

function normalizeTradingConfig(config = {}, options = {}) {
    const { mergeDefaults = true } = options;
    const base = mergeDefaults ? cloneDefaultConfig() : {};
    const normalized = { ...base, ...CLONE(config || {}) };
    delete normalized.configHash;

    for (const key of NUMERIC_KEYS) {
        if (normalized[key] === undefined || normalized[key] === null || normalized[key] === "") {
            continue;
        }

        const value = Number(normalized[key]);
        if (Number.isFinite(value)) {
            normalized[key] = value;
        } else if (mergeDefaults) {
            normalized[key] = base[key];
        } else {
            delete normalized[key];
        }
    }

    for (const key of BOOLEAN_KEYS) {
        if (normalized[key] === undefined) {
            continue;
        }
        normalized[key] = normalizeBoolean(normalized[key]);
    }

    for (const key of ARRAY_KEYS) {
        if (normalized[key] !== undefined || mergeDefaults) {
            normalized[key] = normalizeArray(
                normalized[key],
                mergeDefaults ? base[key] || [] : []
            );
        }
    }

    if (typeof normalized.strategy !== "string" || !normalized.strategy) {
        normalized.strategy = base.strategy;
    }
    if (typeof normalized.timeframe !== "string" || !normalized.timeframe) {
        normalized.timeframe = base.timeframe;
    }
    if (typeof normalized.htfTimeframe !== "string" || !normalized.htfTimeframe) {
        normalized.htfTimeframe = base.htfTimeframe;
    }
    if (typeof normalized.logLevel !== "string" || !normalized.logLevel) {
        normalized.logLevel = base.logLevel;
    }
    if (typeof normalized.timesFmMode !== "string" || !normalized.timesFmMode) {
        normalized.timesFmMode = base.timesFmMode;
    }
    if (typeof normalized.positionSizeMethod !== "string" || !normalized.positionSizeMethod) {
        normalized.positionSizeMethod = base.positionSizeMethod;
    }
    if (typeof normalized.stopLossType !== "string" || !normalized.stopLossType) {
        normalized.stopLossType = base.stopLossType;
    }
    if (typeof normalized.alertEmail !== "string") {
        normalized.alertEmail = base.alertEmail;
    }

    return normalized;
}

function stableSortObject(value) {
    if (Array.isArray(value)) {
        return value.map(stableSortObject);
    }

    if (value && typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
                acc[key] = stableSortObject(value[key]);
                return acc;
            }, {});
    }

    return value;
}

function buildHashableConfig(config = {}) {
    const normalized = normalizeTradingConfig(config);

    return Array.from(HASH_KEYS)
        .sort()
        .reduce((acc, key) => {
            if (normalized[key] !== undefined) {
                acc[key] = normalized[key];
            }
            return acc;
        }, {});
}

function computeConfigHash(config) {
    return crypto
        .createHash("sha1")
        .update(JSON.stringify(stableSortObject(buildHashableConfig(config))))
        .digest("hex")
        .slice(0, 12);
}

function getProtectedConfigChanges(currentConfig, incomingConfig) {
    const current = normalizeTradingConfig(currentConfig || {});
    const next = normalizeTradingConfig({ ...(currentConfig || {}), ...(incomingConfig || {}) });

    return Object.keys(next).filter((key) => {
        if (!FREEZE_PROTECTED_KEYS.has(key)) {
            return false;
        }

        return JSON.stringify(current[key]) !== JSON.stringify(next[key]);
    });
}

module.exports = {
    DEFAULT_TRADING_CONFIG: cloneDefaultConfig(),
    FREEZE_PROTECTED_KEYS: Array.from(FREEZE_PROTECTED_KEYS),
    cloneDefaultConfig,
    normalizeTradingConfig,
    computeConfigHash,
    getProtectedConfigChanges,
};
