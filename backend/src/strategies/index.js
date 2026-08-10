const intradayMomentumStrategy = require("./intradayMomentum");
const {
    CANONICAL_STRATEGY_KEYS,
    assertCanonicalStrategyKey,
} = require("./strategyContract");

const strategyRegistry = Object.freeze({
    intraday_momentum: intradayMomentumStrategy,
});

function isCanonicalStrategyKey(strategyKey) {
    return CANONICAL_STRATEGY_KEYS.includes(strategyKey);
}

function getStrategyDefinition(strategyKey) {
    return strategyRegistry[assertCanonicalStrategyKey(strategyKey)];
}

function listStrategyCatalog() {
    return CANONICAL_STRATEGY_KEYS.map((strategyKey) => {
        const definition = getStrategyDefinition(strategyKey);

        return {
            key: definition.key,
            label: definition.label,
            description: definition.description,
            version: definition.version,
            phaseIntroduced: definition.phaseIntroduced,
            runtimeStatus: definition.runtimeStatus,
            requiredData: definition.requiredData,
            metadata: definition.metadata,
        };
    });
}

module.exports = {
    CANONICAL_STRATEGY_KEYS,
    strategyRegistry,
    isCanonicalStrategyKey,
    getStrategyDefinition,
    listStrategyCatalog,
};
