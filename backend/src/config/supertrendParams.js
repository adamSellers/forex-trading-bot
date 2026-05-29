function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSupertrendPeriod(config = {}) {
    return Math.max(
        1,
        toFiniteNumber(
            config.supertrendPeriod ?? config.atrPeriod,
            10
        )
    );
}

function resolveSupertrendMultiplier(config = {}) {
    return Math.max(
        0.1,
        toFiniteNumber(
            config.supertrendMultiplier ?? config.factor,
            3
        )
    );
}

module.exports = {
    resolveSupertrendPeriod,
    resolveSupertrendMultiplier,
};
