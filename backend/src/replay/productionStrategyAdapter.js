const SignalGenerator = require("../services/signalGenerator");

/**
 * Adapt the production signal generator to the replay callback contract.
 * A new adapter must be created for every variant/fold so pending-entry state is
 * isolated. The replay engine supplies only information available at bar close.
 */
function createProductionStrategyAdapter(config = {}, options = {}) {
    const generator = new SignalGenerator({
        signalCooldown: 0,
        ...config,
    });

    return async (context) => {
        const dataService = {
            getCandles: (instrument, timeframe) => {
                if (timeframe === generator.config.timeframe) {
                    return context.histories.get(instrument) || [];
                }
                if (typeof options.higherTimeframeProvider === "function") {
                    return options.higherTimeframeProvider({
                        instrument,
                        timeframe,
                        timestamp: context.timestamp,
                        histories: context.histories,
                    }) || [];
                }
                return [];
            },
            getCurrentPrice: (instrument) => ({
                price: context.prices.get(instrument),
                timestamp: context.timestamp,
                spread: options.spreadPips ?? null,
            }),
        };
        generator.dataService = dataService;
        return generator.generateSignal(
            context.instrument,
            context.candles,
            context.candle.close,
            { nowMs: context.timestamp }
        );
    };
}

module.exports = { createProductionStrategyAdapter };
