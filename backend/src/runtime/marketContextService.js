const { getStrategyDefinition } = require("../strategies");

function createRunDescriptor(run = {}) {
    const config = run.config || run.configSnapshot || {};
    return {
        runId: run.runId || null,
        strategy: run.strategy || config.strategy || "carry_trend",
        config,
        assets: Array.isArray(run.assets) ? run.assets : config.assets || [],
    };
}

function getRequiredTimeframes(run) {
    const timeframes = new Set();
    try {
        const definition = getStrategyDefinition(run.strategy);
        (definition.requiredData?.timeframes || []).forEach((timeframe) =>
            timeframes.add(timeframe)
        );
    } catch (_error) {
        // A recovered live run can still contribute its configured timeframe.
    }
    if (run.config.timeframe) timeframes.add(run.config.timeframe);
    if (run.config.enableHTFFilter && run.config.htfTimeframe)
        timeframes.add(run.config.htfTimeframe);
    return Array.from(timeframes).filter(Boolean);
}

function buildSession(price = null) {
    const now = new Date();
    return {
        generatedAt: Date.now(),
        utcHour: now.getUTCHours(),
        spreadPips: Number.isFinite(Number(price?.spread))
            ? Number(price.spread)
            : null,
        tradeable:
            price?.tradeable === undefined ? null : price.tradeable === true,
    };
}

class MarketContextService {
    createRunDescriptor(run = {}) {
        return createRunDescriptor(run);
    }

    getRequiredTimeframesForRun(run = {}) {
        return getRequiredTimeframes(createRunDescriptor(run));
    }

    buildSharedContext(runDescriptors = [], dataService) {
        const runs = runDescriptors.map(createRunDescriptor);
        const requirements = new Map();
        runs.forEach((run) => {
            getRequiredTimeframes(run).forEach((timeframe) => {
                run.assets.forEach((instrument) => {
                    if (!requirements.has(instrument))
                        requirements.set(instrument, new Set());
                    requirements.get(instrument).add(timeframe);
                });
            });
        });

        const instruments = {};
        requirements.forEach((timeframes, instrument) => {
            const price = dataService?.getCurrentPrice?.(instrument) || null;
            instruments[instrument] = {
                instrument,
                price,
                session: buildSession(price),
                timeframes: Array.from(timeframes).reduce((result, timeframe) => {
                    result[timeframe] = {
                        candles:
                            dataService?.getCandles?.(instrument, timeframe) || [],
                    };
                    return result;
                }, {}),
            };
        });
        return { generatedAt: Date.now(), dataService, runs, instruments };
    }

    createInstrumentContext(sharedContext, runDescriptor, instrument) {
        const run = createRunDescriptor(runDescriptor);
        const source = sharedContext?.instruments?.[instrument];
        if (!source) return null;
        const required = new Set(getRequiredTimeframes(run));
        const timeframes = Object.entries(source.timeframes || {}).reduce(
            (result, [timeframe, context]) => {
                if (required.has(timeframe)) {
                    result[timeframe] = {
                        candles: context.candles || [],
                        indicators: {},
                        derived: {},
                    };
                }
                return result;
            },
            {}
        );
        const peers = {};
        run.assets.forEach((peer) => {
            if (peer === instrument) return;
            const peerSource = sharedContext?.instruments?.[peer];
            if (!peerSource) return;
            peers[peer] = {
                instrument: peer,
                price: peerSource.price,
                session: peerSource.session,
                timeframes: peerSource.timeframes,
            };
        });
        return {
            generatedAt: sharedContext.generatedAt,
            instrument,
            price: source.price,
            session: source.session,
            timeframes,
            peers,
        };
    }
}

module.exports = MarketContextService;
