const supertrendMomentumStrategy = require("./supertrendMomentum");
const meanReversionStrategy = require("./meanReversion");
const rangeBreakoutStrategy = require("./rangeBreakout");
const stochasticDivergenceStrategy = require("./stochasticDivergence");
const squeezePlayStrategy = require("./squeezePlay");
const timesFmDirectionalStrategy = require("./timesFmDirectional");
const correlationDivergenceStrategy = require("./correlationDivergence");
const counterSignalReversionStrategy = require("./counterSignalReversion");
const {
    CANONICAL_STRATEGY_KEYS,
    assertCanonicalStrategyKey,
} = require("./strategyContract");

const strategyRegistry = Object.freeze({
    supertrend_momentum: supertrendMomentumStrategy,
    mean_reversion: meanReversionStrategy,
    range_breakout: rangeBreakoutStrategy,
    stochastic_divergence: stochasticDivergenceStrategy,
    squeeze_play: squeezePlayStrategy,
    timesfm_directional: timesFmDirectionalStrategy,
    correlation_divergence: correlationDivergenceStrategy,
    counter_signal_reversion: counterSignalReversionStrategy,
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
