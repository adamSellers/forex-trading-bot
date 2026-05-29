const { RSI, ADX, ATR } = require("technicalindicators");
const { calculateSuperTrend } = require("../utils/indicators");
const { getStrategyDefinition } = require("../strategies");
const { buildOpeningRange } = require("../strategies/rangeBreakout");
const {
    resolveSupertrendPeriod,
    resolveSupertrendMultiplier,
} = require("../config/supertrendParams");
const {
    calculateAlignedStochasticSeries,
} = require("../strategies/stochasticDivergence");
const { buildSqueezePlayDerivedContext } = require("../strategies/squeezePlay");

function normalizeTimeframeSet(strategyDefinition, config = {}) {
    const timeframes = new Set(
        Array.isArray(strategyDefinition?.requiredData?.timeframes)
            ? strategyDefinition.requiredData.timeframes
            : []
    );

    if (config.timeframe) {
        timeframes.add(config.timeframe);
    }

    if (config.enableHTFFilter && config.htfTimeframe) {
        timeframes.add(config.htfTimeframe);
    }

    return Array.from(timeframes).filter(Boolean);
}

function normalizeIndicatorSet(strategyDefinition) {
    return Array.isArray(strategyDefinition?.requiredData?.indicators)
        ? strategyDefinition.requiredData.indicators.filter(Boolean)
        : [];
}

function buildSessionContext(priceData = null) {
    const now = new Date();
    const utcHour = now.getUTCHours();

    let session = "Off-Hours";
    if (utcHour >= 12 && utcHour < 21) {
        session = "New York";
    } else if (utcHour >= 7 && utcHour < 16) {
        session = "London";
    } else if (utcHour >= 0 && utcHour < 9) {
        session = "Tokyo";
    } else if (utcHour >= 21 || utcHour < 6) {
        session = "Sydney";
    }

    return {
        generatedAt: Date.now(),
        utcHour,
        session,
        spreadPips:
            priceData && Number.isFinite(Number(priceData.spread))
                ? Number(priceData.spread)
                : null,
        tradeable:
            priceData?.tradeable === undefined ? null : priceData.tradeable === true,
    };
}

function buildIndicatorBundle(candles = [], indicators = [], config = {}) {
    if (!Array.isArray(candles) || candles.length === 0) {
        return {};
    }

    const supportedIndicators = new Set(indicators);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const closes = candles.map((candle) => candle.close);
    const indicatorBundle = {};

    if (supportedIndicators.has("supertrend")) {
        indicatorBundle.supertrend = calculateSuperTrend(
            highs,
            lows,
            closes,
            resolveSupertrendPeriod(config),
            resolveSupertrendMultiplier(config)
        );
    }

    if (supportedIndicators.has("rsi")) {
        indicatorBundle.rsi = RSI.calculate({
            values: closes,
            period: 14,
        });
    }

    if (supportedIndicators.has("adx")) {
        indicatorBundle.adx = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        });
    }

    if (supportedIndicators.has("atr")) {
        indicatorBundle.atr = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        });
    }

    if (supportedIndicators.has("stochastic")) {
        indicatorBundle.stochastic = calculateAlignedStochasticSeries(
            candles,
            config
        );
    }

    return indicatorBundle;
}

function buildDerivedTimeframeBundle(
    strategyKey,
    instrumentContext,
    timeframe,
    config = {}
) {
    const derived = {};

    if (strategyKey === "range_breakout" && timeframe === "5m") {
        const m5Candles = instrumentContext?.timeframes?.["5m"]?.candles || [];
        const referenceTimeframe = config.timeframe || "15m";
        const currentSignalCandle =
            instrumentContext?.timeframes?.[referenceTimeframe]?.candles?.slice(-1)[0] ||
            null;
        const currentTimeMs = currentSignalCandle
            ? Date.parse(currentSignalCandle.time)
            : null;

        if (Number.isFinite(currentTimeMs) && m5Candles.length > 0) {
            derived.rangeBreakout = buildOpeningRange(
                m5Candles,
                currentTimeMs,
                config
            );
        }
    }

    if (strategyKey === "squeeze_play" && timeframe === "15m") {
        derived.squeezePlay = buildSqueezePlayDerivedContext(
            instrumentContext?.timeframes?.["15m"]?.candles || [],
            instrumentContext?.timeframes?.["1h"]?.candles || [],
            config
        );
    }

    return derived;
}

function createRunDescriptor(runDescriptor = {}) {
    const config = runDescriptor.config || runDescriptor.configSnapshot || {};

    return {
        runId: runDescriptor.runId || null,
        selectionId: runDescriptor.selectionId || null,
        mode: runDescriptor.mode || "live",
        strategy: runDescriptor.strategy || config.strategy || "supertrend_momentum",
        config,
        configHash:
            runDescriptor.configHash || config.configHash || "unhashed-config",
        assets: Array.isArray(runDescriptor.assets)
            ? runDescriptor.assets
            : config.assets || [],
    };
}

class MarketContextService {
    createRunDescriptor(runDescriptor = {}) {
        return createRunDescriptor(runDescriptor);
    }

    getRunContextKey(runDescriptor = {}) {
        const normalizedRun = createRunDescriptor(runDescriptor);
        return [
            normalizedRun.strategy,
            normalizedRun.configHash || "unhashed-config",
            normalizedRun.config.timeframe || "15m",
            normalizedRun.config.enableHTFFilter ? normalizedRun.config.htfTimeframe || "1h" : "no-htf",
        ].join("|");
    }

    buildSharedContext(runDescriptors = [], dataService) {
        const normalizedRuns = runDescriptors.map((descriptor) =>
            createRunDescriptor(descriptor)
        );
        const instrumentRequirements = new Map();
        const runRequirements = new Map();

        normalizedRuns.forEach((runDescriptor) => {
            const strategyDefinition = getStrategyDefinition(runDescriptor.strategy);
            const contextKey = this.getRunContextKey(runDescriptor);

            runRequirements.set(contextKey, {
                strategy: runDescriptor.strategy,
                config: runDescriptor.config,
                configHash: runDescriptor.configHash,
                timeframes: normalizeTimeframeSet(
                    strategyDefinition,
                    runDescriptor.config
                ),
                indicators: normalizeIndicatorSet(strategyDefinition),
            });

            runDescriptor.assets.forEach((instrument) => {
                if (!instrumentRequirements.has(instrument)) {
                    instrumentRequirements.set(instrument, {
                        timeframes: new Set(),
                        runKeys: new Set(),
                    });
                }

                const requirement = instrumentRequirements.get(instrument);
                runRequirements.get(contextKey).timeframes.forEach((timeframe) =>
                    requirement.timeframes.add(timeframe)
                );
                requirement.runKeys.add(contextKey);
            });
        });

        const instruments = {};
        instrumentRequirements.forEach((requirement, instrument) => {
            const price = dataService?.getCurrentPrice?.(instrument) || null;
            const timeframes = {};

            requirement.timeframes.forEach((timeframe) => {
                timeframes[timeframe] = {
                    candles: dataService?.getCandles?.(instrument, timeframe) || [],
                };
            });

            instruments[instrument] = {
                instrument,
                price,
                session: buildSessionContext(price),
                timeframes,
            };
        });

        const precomputed = {};

        runRequirements.forEach((requirement, contextKey) => {
            precomputed[contextKey] = {
                strategy: requirement.strategy,
                configHash: requirement.configHash,
                instruments: {},
            };

            instrumentRequirements.forEach((instrumentRequirement, instrument) => {
                if (!instrumentRequirement.runKeys.has(contextKey)) {
                    return;
                }

                const baseInstrumentContext = instruments[instrument];
                const timeframeContexts = {};

                requirement.timeframes.forEach((timeframe) => {
                    const candles =
                        baseInstrumentContext?.timeframes?.[timeframe]?.candles || [];
                    timeframeContexts[timeframe] = {
                        indicators: buildIndicatorBundle(
                            candles,
                            requirement.indicators,
                            requirement.config
                        ),
                        derived: buildDerivedTimeframeBundle(
                            requirement.strategy,
                            baseInstrumentContext,
                            timeframe,
                            requirement.config
                        ),
                    };
                });

                precomputed[contextKey].instruments[instrument] = {
                    timeframes: timeframeContexts,
                };
            });
        });

        return {
            generatedAt: Date.now(),
            dataService,
            runs: normalizedRuns,
            instruments,
            precomputed,
        };
    }

    createInstrumentContext(sharedContext, runDescriptor, instrument) {
        const normalizedRun = createRunDescriptor(runDescriptor);
        const instrumentContext = sharedContext?.instruments?.[instrument] || null;
        if (!instrumentContext) {
            return null;
        }

        const contextKey = this.getRunContextKey(normalizedRun);
        const precomputedInstrument =
            sharedContext?.precomputed?.[contextKey]?.instruments?.[instrument] || {};
        const timeframes = {};
        const peers = {};
        const runAssets = new Set(
            Array.isArray(normalizedRun.assets) && normalizedRun.assets.length > 0
                ? normalizedRun.assets
                : Object.keys(sharedContext.instruments || {})
        );

        Object.entries(instrumentContext.timeframes || {}).forEach(
            ([timeframe, timeframeContext]) => {
                timeframes[timeframe] = {
                    candles: timeframeContext.candles || [],
                    indicators:
                        precomputedInstrument.timeframes?.[timeframe]?.indicators || {},
                    derived:
                        precomputedInstrument.timeframes?.[timeframe]?.derived || {},
                };
            }
        );

        Object.entries(sharedContext.instruments || {}).forEach(
            ([peerInstrument, peerInstrumentContext]) => {
                if (peerInstrument === instrument) return;
                if (!runAssets.has(peerInstrument)) return;

                const peerPrecomputedInstrument =
                    sharedContext?.precomputed?.[contextKey]?.instruments?.[
                        peerInstrument
                    ] || {};
                const peerTimeframes = {};

                Object.entries(peerInstrumentContext.timeframes || {}).forEach(
                    ([timeframe, timeframeContext]) => {
                        peerTimeframes[timeframe] = {
                            candles: timeframeContext.candles || [],
                            indicators:
                                peerPrecomputedInstrument.timeframes?.[timeframe]
                                    ?.indicators || {},
                            derived:
                                peerPrecomputedInstrument.timeframes?.[timeframe]
                                    ?.derived || {},
                        };
                    }
                );

                peers[peerInstrument] = {
                    instrument: peerInstrument,
                    price: peerInstrumentContext.price || null,
                    session: peerInstrumentContext.session || null,
                    timeframes: peerTimeframes,
                };
            }
        );

        return {
            generatedAt: sharedContext.generatedAt,
            instrument,
            price: instrumentContext.price || null,
            session: instrumentContext.session || null,
            timeframes,
            peers,
        };
    }
}

module.exports = MarketContextService;
