const { BollingerBands, RSI, ADX, ATR } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_MEAN_REVERSION_CONFIG = Object.freeze({
    bbPeriod: 20,
    bbStdDev: 2.0,
    bbwMinRatio: 0.5,
    maxRegimeAdx: 25,
    rsiOversoldEntry: 30,
    rsiOverboughtEntry: 70,
    stopLossAtrMultiplier: 1.5,
    breakevenAtTpPercent: 0.5,
    timeStopHours: 8,
    activeSessions: ["london", "newyork"],
});

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSessionName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

function getPipValue(instrument, dataService = null) {
    const pipValue = dataService?.getPipValue?.(instrument);
    if (Number.isFinite(Number(pipValue))) {
        return Number(pipValue);
    }

    return instrument?.includes("JPY") ? 0.01 : 0.0001;
}

function getLastIndicatorValue(series = [], key = null) {
    if (!Array.isArray(series) || series.length === 0) {
        return null;
    }

    const lastValue = series[series.length - 1];
    if (key === null || key === undefined) {
        return toFiniteNumber(lastValue, null);
    }

    return toFiniteNumber(lastValue?.[key], null);
}

function average(values = []) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildBollingerContext(candles = [], config = {}) {
    const period = Math.max(5, toFiniteNumber(config.bbPeriod, 20));
    const stdDev = Math.max(0.5, toFiniteNumber(config.bbStdDev, 2.0));
    const closes = candles.map((candle) => candle.close);
    const bands = BollingerBands.calculate({
        period,
        stdDev,
        values: closes,
    });

    if (!bands.length) {
        return null;
    }

    const currentBand = bands[bands.length - 1];
    const widths = bands
        .slice(-period)
        .map((band) => band.upper - band.lower)
        .filter((value) => Number.isFinite(value));
    const currentWidth = currentBand.upper - currentBand.lower;
    const averageWidth = average(widths);

    return {
        currentBand,
        currentWidth,
        averageWidth,
        widthRatio: averageWidth > 0 ? currentWidth / averageWidth : 0,
    };
}

function buildStrategyContext(context = {}, overrides = {}) {
    const config = overrides.config || context.config || {};
    const bollingerContext =
        overrides.bollingerContext || context.bollingerContext || {};
    const currentBand = bollingerContext.currentBand || {};
    const currentPrice = toFiniteNumber(context.currentPrice, null);
    const lowerBand = toFiniteNumber(currentBand.lower, null);
    const middleBand = toFiniteNumber(currentBand.middle, null);
    const upperBand = toFiniteNumber(currentBand.upper, null);
    const widthRatio = toFiniteNumber(bollingerContext.widthRatio, null);
    let bandPosition = "inside";

    if (Number.isFinite(currentPrice) && Number.isFinite(lowerBand) && currentPrice <= lowerBand) {
        bandPosition = "below_lower";
    } else if (
        Number.isFinite(currentPrice) &&
        Number.isFinite(upperBand) &&
        currentPrice >= upperBand
    ) {
        bandPosition = "above_upper";
    }

    return {
        family: "mean_reversion",
        setup: overrides.setup || "scan",
        entryBias: overrides.entryBias || null,
        bandPosition,
        currentPrice,
        m15: {
            rsi: toFiniteNumber(context.rsiVal, null),
            atrPips: toFiniteNumber(context.atrPips, null),
        },
        bollinger: {
            lower: lowerBand,
            middle: middleBand,
            upper: upperBand,
            width: toFiniteNumber(bollingerContext.currentWidth, null),
            averageWidth: toFiniteNumber(bollingerContext.averageWidth, null),
            widthRatio,
            minWidthRatio: toFiniteNumber(config.bbwMinRatio, 0.5),
        },
        regime: {
            h1Adx: toFiniteNumber(context.regimeAdx, null),
            maxH1Adx: toFiniteNumber(config.maxRegimeAdx, 25),
            pdi: toFiniteNumber(context.pdiVal, null),
            mdi: toFiniteNumber(context.mdiVal, null),
        },
        thresholds: {
            rsiOversold: toFiniteNumber(config.rsiOversoldEntry, 30),
            rsiOverbought: toFiniteNumber(config.rsiOverboughtEntry, 70),
        },
        session: {
            name: context.sessionName || null,
            active: context.sessionActive ?? null,
            spreadPips: toFiniteNumber(context.spreadPips, null),
        },
    };
}

function deriveIndicatorsFromCandles(candles = []) {
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const closes = candles.map((candle) => candle.close);

    return {
        rsi: RSI.calculate({
            values: closes,
            period: 14,
        }),
        atr: ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        }),
        adx: ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        }),
    };
}

function buildHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: mean reversion filters not met",
        reasonCode: overrides.reasonCode || "MEAN_REVERSION_FILTERED",
        signalClass: overrides.signalClass || "FILTERED",
        intent: overrides.intent || "WAIT",
        entryType: null,
        signalCandleTime: context.currentCandle?.time || null,
        atrVal: context.atrVal || 0,
        atrPips: context.atrPips || 0,
        currentPrice: context.currentPrice ?? null,
        rsiVal: context.rsiVal || 0,
        adxVal: context.regimeAdx || 0,
        pdiVal: context.pdiVal || 0,
        mdiVal: context.mdiVal || 0,
        adxRising: false,
        prevAdxVal: context.prevAdxVal || 0,
        currentDir: 0,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "1h",
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason:
                overrides.htfReason ||
                (Number.isFinite(context.regimeAdx)
                    ? `H1 ADX ${context.regimeAdx.toFixed(1)}`
                    : "H1 ADX unavailable"),
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        strategyContext:
            overrides.strategyContext || buildStrategyContext(context, overrides),
    };
}

async function evaluateMeanReversionEntry({
    instrument,
    candles = [],
    currentPrice,
    config = {},
    dataService = null,
    marketContext = null,
}) {
    if (!Array.isArray(candles) || candles.length < 30) {
        return buildHoldResult(
            {
                currentPrice,
            },
            {
                reason: "HOLD: mean reversion requires at least 30 M15 candles",
                reasonCode: "MEAN_REVERSION_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_MEAN_REVERSION_CONFIG,
        ...(config || {}),
    };
    const timeframeContext = marketContext?.timeframes?.["15m"] || {};
    const h1Context = marketContext?.timeframes?.["1h"] || {};
    const fallbackIndicators = deriveIndicatorsFromCandles(candles);
    const h1FallbackIndicators = deriveIndicatorsFromCandles(
        h1Context.candles || []
    );
    const currentCandle = candles[candles.length - 1];
    const entryPrice = toFiniteNumber(currentPrice, currentCandle?.close);
    const pipValue = getPipValue(instrument, dataService);
    const bollingerContext = buildBollingerContext(candles, resolvedConfig);
    const rsiVal =
        getLastIndicatorValue(timeframeContext.indicators?.rsi) ||
        getLastIndicatorValue(fallbackIndicators.rsi);
    const atrVal =
        getLastIndicatorValue(timeframeContext.indicators?.atr) ||
        getLastIndicatorValue(fallbackIndicators.atr);
    const regimeAdxSeries =
        h1Context.indicators?.adx || h1FallbackIndicators.adx || [];
    const regimeAdx = getLastIndicatorValue(regimeAdxSeries, "adx");
    const pdiVal = getLastIndicatorValue(regimeAdxSeries, "pdi") || 0;
    const mdiVal = getLastIndicatorValue(regimeAdxSeries, "mdi") || 0;
    const prevAdxVal =
        regimeAdxSeries.length > 1
            ? toFiniteNumber(
                  regimeAdxSeries[regimeAdxSeries.length - 2]?.adx,
                  0
              )
            : 0;
    const atrPips =
        Number.isFinite(atrVal) && pipValue > 0 ? atrVal / pipValue : 0;
    const sessionName = marketContext?.session?.session || "Off-Hours";
    const sessionKey = normalizeSessionName(sessionName);
    const activeSessions = Array.isArray(resolvedConfig.activeSessions)
        ? resolvedConfig.activeSessions.map(normalizeSessionName)
        : DEFAULT_MEAN_REVERSION_CONFIG.activeSessions;
    const spreadPips = toFiniteNumber(
        marketContext?.session?.spreadPips ?? marketContext?.price?.spread,
        null
    );

    const evaluationContext = {
        currentCandle,
        currentPrice: entryPrice,
        atrVal,
        atrPips,
        rsiVal,
        regimeAdx,
        pdiVal,
        mdiVal,
        prevAdxVal,
        config: resolvedConfig,
        bollingerContext,
        sessionName,
        sessionActive: activeSessions.includes(sessionKey),
        spreadPips,
    };

    if (!bollingerContext || !Number.isFinite(entryPrice)) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: Bollinger context unavailable",
            reasonCode: "MEAN_REVERSION_NO_BOLLINGER",
        });
    }

    if (!activeSessions.includes(sessionKey)) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: session ${sessionName} is outside the configured mean reversion window`,
            reasonCode: "MEAN_REVERSION_SESSION_FILTERED",
        });
    }

    if (
        Number.isFinite(spreadPips) &&
        spreadPips > toFiniteNumber(resolvedConfig.maxSpreadPips, Infinity)
    ) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: spread ${spreadPips.toFixed(1)} is above the configured threshold`,
            reasonCode: "MEAN_REVERSION_SPREAD_FILTERED",
        });
    }

    if (!Number.isFinite(regimeAdx)) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: H1 ADX regime context is unavailable",
            reasonCode: "MEAN_REVERSION_NO_H1_ADX",
        });
    }

    if (regimeAdx >= toFiniteNumber(resolvedConfig.maxRegimeAdx, 25)) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: H1 ADX ${regimeAdx.toFixed(1)} is too strong for a range fade`,
            reasonCode: "MEAN_REVERSION_REGIME_FILTERED",
        });
    }

    if (
        bollingerContext.widthRatio <
        toFiniteNumber(resolvedConfig.bbwMinRatio, 0.5)
    ) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: Bollinger width ratio ${bollingerContext.widthRatio.toFixed(2)} is below the minimum`,
            reasonCode: "MEAN_REVERSION_BANDWIDTH_FILTERED",
        });
    }

    if (!Number.isFinite(rsiVal) || !Number.isFinite(atrVal) || atrVal <= 0) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: RSI/ATR context unavailable",
            reasonCode: "MEAN_REVERSION_NO_M15_CONTEXT",
        });
    }

    const lowerBand = toFiniteNumber(bollingerContext.currentBand.lower, null);
    const upperBand = toFiniteNumber(bollingerContext.currentBand.upper, null);
    const middleBand = toFiniteNumber(
        bollingerContext.currentBand.middle,
        null
    );

    if (
        !Number.isFinite(lowerBand) ||
        !Number.isFinite(upperBand) ||
        !Number.isFinite(middleBand)
    ) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: Bollinger values are incomplete",
            reasonCode: "MEAN_REVERSION_INVALID_BOLLINGER",
        });
    }

    const stopDistance =
        atrVal * toFiniteNumber(resolvedConfig.stopLossAtrMultiplier, 1.5);

    const longSetup =
        entryPrice <= lowerBand &&
        rsiVal < toFiniteNumber(resolvedConfig.rsiOversoldEntry, 30) &&
        middleBand > entryPrice;
    const shortSetup =
        entryPrice >= upperBand &&
        rsiVal > toFiniteNumber(resolvedConfig.rsiOverboughtEntry, 70) &&
        middleBand < entryPrice;

    if (longSetup) {
        return {
            signalType: "BUY",
            reason:
                `BUY: Mean reversion long | close ${entryPrice.toFixed(5)} <= lower band ${lowerBand.toFixed(5)} | ` +
                `RSI ${rsiVal.toFixed(1)} | H1 ADX ${regimeAdx.toFixed(1)}`,
            reasonCode: "MEAN_REVERSION_LONG_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_LONG",
            entryType: "MEAN_REVERSION_BAND_FADE",
            signalCandleTime: currentCandle.time,
            atrVal,
            atrPips,
            currentPrice: entryPrice,
            rsiVal,
            adxVal: regimeAdx,
            pdiVal,
            mdiVal,
            adxRising: false,
            prevAdxVal,
            currentDir: 0,
            prevDir: 0,
            htfContext: {
                enabled: true,
                timeframe: "1h",
                direction: 0,
                longAllowed: true,
                shortAllowed: true,
                reason: `H1 ADX ${regimeAdx.toFixed(1)} confirms a ranging regime`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan: {
                stopLossPrice: entryPrice - stopDistance,
                takeProfitPrice: middleBand,
            },
            strategyContext: buildStrategyContext(evaluationContext, {
                config: resolvedConfig,
                bollingerContext,
                setup: "lower_band_fade",
                entryBias: "long",
            }),
        };
    }

    if (shortSetup) {
        return {
            signalType: "SELL",
            reason:
                `SELL: Mean reversion short | close ${entryPrice.toFixed(5)} >= upper band ${upperBand.toFixed(5)} | ` +
                `RSI ${rsiVal.toFixed(1)} | H1 ADX ${regimeAdx.toFixed(1)}`,
            reasonCode: "MEAN_REVERSION_SHORT_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_SHORT",
            entryType: "MEAN_REVERSION_BAND_FADE",
            signalCandleTime: currentCandle.time,
            atrVal,
            atrPips,
            currentPrice: entryPrice,
            rsiVal,
            adxVal: regimeAdx,
            pdiVal,
            mdiVal,
            adxRising: false,
            prevAdxVal,
            currentDir: 0,
            prevDir: 0,
            htfContext: {
                enabled: true,
                timeframe: "1h",
                direction: 0,
                longAllowed: true,
                shortAllowed: true,
                reason: `H1 ADX ${regimeAdx.toFixed(1)} confirms a ranging regime`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan: {
                stopLossPrice: entryPrice + stopDistance,
                takeProfitPrice: middleBand,
            },
            strategyContext: buildStrategyContext(evaluationContext, {
                config: resolvedConfig,
                bollingerContext,
                setup: "upper_band_fade",
                entryBias: "short",
            }),
        };
    }

    return buildHoldResult(evaluationContext, {
        reason:
            `HOLD: Mean reversion setup incomplete | RSI ${rsiVal.toFixed(1)} | ` +
            `band ratio ${bollingerContext.widthRatio.toFixed(2)} | H1 ADX ${regimeAdx.toFixed(1)}`,
        reasonCode: "MEAN_REVERSION_WAIT",
    });
}

const meanReversionStrategy = createStrategyDefinition({
    key: "mean_reversion",
    label: "Mean Reversion",
    description:
        "Candidate paper strategy for fading statistical extremes during ranging conditions.",
    phaseIntroduced: 3,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["15m", "1h"],
        marketData: ["candles", "price", "session", "spread"],
        indicators: ["bollinger_bands", "adx", "rsi", "atr"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
        defaultConfig: DEFAULT_MEAN_REVERSION_CONFIG,
    },
    evaluateEntry: evaluateMeanReversionEntry,
});

module.exports = Object.assign({}, meanReversionStrategy, {
    DEFAULT_MEAN_REVERSION_CONFIG,
    evaluateMeanReversionEntry,
});
