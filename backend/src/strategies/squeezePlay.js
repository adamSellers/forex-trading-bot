const { ATR, BollingerBands, EMA } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_SQUEEZE_PLAY_CONFIG = Object.freeze({
    bbPeriod: 20,
    bbStdDev: 2.0,
    keltnerEmaPeriod: 20,
    keltnerAtrPeriod: 20,
    keltnerAtrMultiplier: 1.5,
    minSqueezeBarCount: 6,
    linRegPeriod: 12,
    minNormalizedSlopeAtrPerBar: 0.03,
    requireCompressionBoundaryBreak: true,
    h1AtrPercentileMax: 60,
    h1AtrLookback: 50,
    stopLossAtrMultiplier: 2.0,
    takeProfitAtrMultiplier: 3.0,
    trailActivationAtr: 2.0,
    trailDistanceAtr: 1.0,
    timeStopHours: 12,
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

function getLastValidValue(series = [], key = null, fromOffset = 0) {
    if (!Array.isArray(series) || series.length === 0) {
        return null;
    }

    for (let index = series.length - 1 - fromOffset; index >= 0; index -= 1) {
        const candidate = series[index];
        const value =
            key === null || key === undefined
                ? toFiniteNumber(candidate, null)
                : toFiniteNumber(candidate?.[key], null);

        if (Number.isFinite(value)) {
            return value;
        }
    }

    return null;
}

function alignSeries(sourceValues = [], fullLength = 0, mapper = (value) => value) {
    const aligned = new Array(fullLength).fill(null);
    const offset = Math.max(0, fullLength - sourceValues.length);

    sourceValues.forEach((value, index) => {
        aligned[index + offset] = mapper(value);
    });

    return aligned;
}

function calculateAlignedAtrSeries(candles = [], period = 20) {
    if (!Array.isArray(candles) || candles.length < period) {
        return [];
    }

    return alignSeries(
        ATR.calculate({
            high: candles.map((candle) => candle.high),
            low: candles.map((candle) => candle.low),
            close: candles.map((candle) => candle.close),
            period,
        }),
        candles.length,
        (value) => toFiniteNumber(value, null)
    );
}

function calculateAlignedBollingerSeries(candles = [], config = {}) {
    const period = Math.max(5, toFiniteNumber(config.bbPeriod, 20));
    const stdDev = Math.max(0.5, toFiniteNumber(config.bbStdDev, 2.0));
    const closes = candles.map((candle) => candle.close);
    const rawBands = BollingerBands.calculate({
        period,
        stdDev,
        values: closes,
    });

    return alignSeries(rawBands, candles.length, (band) => {
        const upper = toFiniteNumber(band?.upper, null);
        const lower = toFiniteNumber(band?.lower, null);
        const middle = toFiniteNumber(band?.middle, null);

        if (
            !Number.isFinite(upper) ||
            !Number.isFinite(lower) ||
            !Number.isFinite(middle)
        ) {
            return null;
        }

        return {
            upper,
            lower,
            middle,
            width: upper - lower,
        };
    });
}

function calculateAlignedKeltnerSeries(candles = [], config = {}) {
    const closes = candles.map((candle) => candle.close);
    const emaPeriod = Math.max(5, toFiniteNumber(config.keltnerEmaPeriod, 20));
    const atrPeriod = Math.max(5, toFiniteNumber(config.keltnerAtrPeriod, 20));
    const atrMultiplier = Math.max(
        0.5,
        toFiniteNumber(config.keltnerAtrMultiplier, 1.5)
    );
    const alignedEma = alignSeries(
        EMA.calculate({
            period: emaPeriod,
            values: closes,
        }),
        candles.length,
        (value) => toFiniteNumber(value, null)
    );
    const alignedAtr = calculateAlignedAtrSeries(candles, atrPeriod);

    return alignedEma.map((emaValue, index) => {
        const atrValue = alignedAtr[index];
        if (!Number.isFinite(emaValue) || !Number.isFinite(atrValue)) {
            return null;
        }

        return {
            middle: emaValue,
            upper: emaValue + atrValue * atrMultiplier,
            lower: emaValue - atrValue * atrMultiplier,
            width: atrValue * atrMultiplier * 2,
            atr: atrValue,
        };
    });
}

function calculateLinearRegressionSlope(values = []) {
    const validValues = values.filter((value) => Number.isFinite(value));
    if (validValues.length < 2) {
        return null;
    }

    const n = validValues.length;
    const xMean = (n - 1) / 2;
    const yMean = validValues.reduce((sum, value) => sum + value, 0) / n;
    let numerator = 0;
    let denominator = 0;

    validValues.forEach((value, index) => {
        const xDelta = index - xMean;
        numerator += xDelta * (value - yMean);
        denominator += xDelta * xDelta;
    });

    return denominator === 0 ? null : numerator / denominator;
}

function calculatePercentileRank(value, sample = []) {
    const validSample = sample.filter((entry) => Number.isFinite(entry));
    if (!Number.isFinite(value) || validSample.length === 0) {
        return null;
    }

    const valuesAtOrBelow = validSample.filter((entry) => entry <= value).length;
    return (valuesAtOrBelow / validSample.length) * 100;
}

function countConsecutiveSqueezeBars(flags = [], endIndex = -1) {
    if (!Array.isArray(flags) || flags.length === 0 || endIndex < 0) {
        return 0;
    }

    let count = 0;
    for (let index = endIndex; index >= 0; index -= 1) {
        if (flags[index] !== true) {
            break;
        }
        count += 1;
    }

    return count;
}

function buildSqueezePlayDerivedContext(
    m15Candles = [],
    h1Candles = [],
    config = {}
) {
    if (!Array.isArray(m15Candles) || m15Candles.length === 0) {
        return null;
    }

    const resolvedConfig = {
        ...DEFAULT_SQUEEZE_PLAY_CONFIG,
        ...(config || {}),
    };
    const bollingerSeries = calculateAlignedBollingerSeries(
        m15Candles,
        resolvedConfig
    );
    const keltnerSeries = calculateAlignedKeltnerSeries(
        m15Candles,
        resolvedConfig
    );
    const currentIndex = m15Candles.length - 1;
    const currentBand = bollingerSeries[currentIndex] || null;
    const previousBand = bollingerSeries[currentIndex - 1] || null;
    const currentChannel = keltnerSeries[currentIndex] || null;
    const previousChannel = keltnerSeries[currentIndex - 1] || null;
    const squeezeFlags = bollingerSeries.map((band, index) => {
        const channel = keltnerSeries[index] || null;
        return Boolean(
            band &&
                channel &&
                Number.isFinite(band.width) &&
                Number.isFinite(channel.width) &&
                band.width <= channel.width
        );
    });
    const priorSqueezeCount = countConsecutiveSqueezeBars(
        squeezeFlags,
        currentIndex - 1
    );
    const closes = m15Candles.map((candle) => candle.close);
    const linRegPeriod = Math.max(
        3,
        toFiniteNumber(resolvedConfig.linRegPeriod, 12)
    );
    const slope = calculateLinearRegressionSlope(closes.slice(-linRegPeriod));
    const compressionCandles = m15Candles.slice(
        Math.max(0, currentIndex - priorSqueezeCount),
        currentIndex
    );
    const compressionHigh = compressionCandles.length
        ? Math.max(...compressionCandles.map((candle) => candle.high))
        : null;
    const compressionLow = compressionCandles.length
        ? Math.min(...compressionCandles.map((candle) => candle.low))
        : null;
    const normalizedSlope =
        Number.isFinite(slope) && Number.isFinite(currentChannel?.atr) &&
        currentChannel.atr > 0
            ? slope / currentChannel.atr
            : null;
    const h1AtrSeries = calculateAlignedAtrSeries(
        h1Candles,
        Math.max(5, toFiniteNumber(resolvedConfig.keltnerAtrPeriod, 20))
    );
    const currentH1Atr = getLastValidValue(h1AtrSeries);
    const h1Lookback = Math.max(
        10,
        toFiniteNumber(resolvedConfig.h1AtrLookback, 50)
    );
    const h1Percentile = calculatePercentileRank(
        currentH1Atr,
        h1AtrSeries.slice(-h1Lookback)
    );

    return {
        bollingerSeries,
        keltnerSeries,
        currentBand,
        previousBand,
        currentChannel,
        previousChannel,
        isInSqueeze: squeezeFlags[currentIndex] === true,
        priorSqueezeCount,
        releaseTriggered: Boolean(
            currentBand &&
                currentChannel &&
                currentBand.width > currentChannel.width &&
                priorSqueezeCount >=
                    Math.max(
                        1,
                        toFiniteNumber(resolvedConfig.minSqueezeBarCount, 6)
                    )
        ),
        slope,
        normalizedSlope,
        compressionHigh,
        compressionLow,
        direction:
            Number.isFinite(slope) && slope > 0
                ? "LONG"
                : Number.isFinite(slope) && slope < 0
                ? "SHORT"
                : "FLAT",
        h1AtrCurrent: currentH1Atr,
        h1AtrPercentile: h1Percentile,
    };
}

function buildStrategyContext(context = {}, overrides = {}) {
    const config = overrides.config || context.config || {};
    const squeezeContext =
        overrides.squeezeContext || context.squeezeContext || null;
    const direction = squeezeContext?.direction || "FLAT";
    let setup = overrides.setup || "scan";

    if (squeezeContext?.releaseTriggered) {
        setup = "release";
    } else if (squeezeContext?.isInSqueeze) {
        setup = "compression";
    }

    return {
        family: "squeeze_play",
        setup,
        entryBias:
            overrides.entryBias ||
            (direction === "LONG" ? "long" : direction === "SHORT" ? "short" : null),
        currentPrice: toFiniteNumber(context.currentPrice, null),
        compression: {
            inSqueeze: squeezeContext?.isInSqueeze === true,
            priorBars: toFiniteNumber(squeezeContext?.priorSqueezeCount, null),
            minBars: toFiniteNumber(config.minSqueezeBarCount, 6),
        },
        release: {
            triggered: squeezeContext?.releaseTriggered === true,
            direction,
            slope: toFiniteNumber(squeezeContext?.slope, null),
            normalizedSlope: toFiniteNumber(
                squeezeContext?.normalizedSlope,
                null
            ),
            compressionHigh: toFiniteNumber(
                squeezeContext?.compressionHigh,
                null
            ),
            compressionLow: toFiniteNumber(
                squeezeContext?.compressionLow,
                null
            ),
        },
        volatility: {
            h1AtrPercentile: toFiniteNumber(
                squeezeContext?.h1AtrPercentile ?? context.h1AtrPercentile,
                null
            ),
            maxH1AtrPercentile: toFiniteNumber(config.h1AtrPercentileMax, 60),
        },
        m15: {
            atrPips: toFiniteNumber(context.atrPips, null),
        },
        session: {
            name: context.sessionName || null,
            active: context.sessionActive ?? null,
            spreadPips: toFiniteNumber(context.spreadPips, null),
        },
    };
}

function buildHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: squeeze play filters not met",
        reasonCode: overrides.reasonCode || "SQUEEZE_PLAY_FILTERED",
        signalClass: overrides.signalClass || "FILTERED",
        intent: overrides.intent || "WAIT",
        entryType: null,
        signalCandleTime: context.currentCandle?.time || null,
        atrVal: context.atrVal || 0,
        atrPips: context.atrPips || 0,
        currentPrice: context.currentPrice ?? null,
        rsiVal: 0,
        adxVal: 0,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
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
                (Number.isFinite(context.h1AtrPercentile)
                    ? `H1 ATR percentile ${context.h1AtrPercentile.toFixed(1)}`
                    : "H1 ATR percentile unavailable"),
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        strategyContext:
            overrides.strategyContext || buildStrategyContext(context, overrides),
    };
}

async function evaluateSqueezePlayEntry({
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
                reason: "HOLD: squeeze play requires at least 30 M15 candles",
                reasonCode: "SQUEEZE_PLAY_INSUFFICIENT_M15",
            }
        );
    }

    const resolvedConfig = {
        ...DEFAULT_SQUEEZE_PLAY_CONFIG,
        ...(config || {}),
    };
    const currentCandle = candles[candles.length - 1];
    const entryPrice = toFiniteNumber(currentPrice, currentCandle?.close);
    const pipValue = getPipValue(instrument, dataService);
    const atrVal =
        getLastValidValue(marketContext?.timeframes?.["15m"]?.indicators?.atr) ||
        getLastValidValue(
            calculateAlignedAtrSeries(
                candles,
                Math.max(5, toFiniteNumber(resolvedConfig.keltnerAtrPeriod, 20))
            )
        );
    const atrPips =
        Number.isFinite(atrVal) && pipValue > 0 ? atrVal / pipValue : 0;
    const h1Candles = marketContext?.timeframes?.["1h"]?.candles || [];
    const calculatedSqueezeContext = buildSqueezePlayDerivedContext(
        candles,
        h1Candles,
        resolvedConfig
    );
    const suppliedSqueezeContext =
        marketContext?.timeframes?.["15m"]?.derived?.squeezePlay || null;
    const squeezeContext = suppliedSqueezeContext
        ? { ...calculatedSqueezeContext, ...suppliedSqueezeContext }
        : calculatedSqueezeContext;
    const sessionName = marketContext?.session?.session || "Off-Hours";
    const sessionKey = normalizeSessionName(sessionName);
    const activeSessions = Array.isArray(resolvedConfig.activeSessions)
        ? resolvedConfig.activeSessions.map(normalizeSessionName)
        : DEFAULT_SQUEEZE_PLAY_CONFIG.activeSessions;
    const spreadPips = toFiniteNumber(
        marketContext?.session?.spreadPips ?? marketContext?.price?.spread,
        null
    );
    const evaluationContext = {
        currentCandle,
        currentPrice: entryPrice,
        atrVal,
        atrPips,
        h1AtrPercentile: squeezeContext?.h1AtrPercentile,
        config: resolvedConfig,
        squeezeContext,
        sessionName,
        sessionActive: activeSessions.includes(sessionKey),
        spreadPips,
    };

    if (!activeSessions.includes(sessionKey)) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: session ${sessionName} is outside the squeeze-play window`,
            reasonCode: "SQUEEZE_PLAY_SESSION_FILTERED",
        });
    }

    if (
        Number.isFinite(spreadPips) &&
        spreadPips > toFiniteNumber(resolvedConfig.maxSpreadPips, Infinity)
    ) {
        return buildHoldResult(evaluationContext, {
            reason: `HOLD: spread ${spreadPips.toFixed(1)} is above the configured threshold`,
            reasonCode: "SQUEEZE_PLAY_SPREAD_FILTERED",
        });
    }

    if (!squeezeContext || !Number.isFinite(entryPrice) || !Number.isFinite(atrVal)) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: squeeze context is unavailable",
            reasonCode: "SQUEEZE_PLAY_NO_CONTEXT",
        });
    }

    if (!Number.isFinite(squeezeContext.h1AtrPercentile)) {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: H1 ATR percentile context is unavailable",
            reasonCode: "SQUEEZE_PLAY_NO_H1_ATR_PERCENTILE",
        });
    }

    if (
        squeezeContext.h1AtrPercentile >
        toFiniteNumber(resolvedConfig.h1AtrPercentileMax, 60)
    ) {
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: H1 ATR percentile ${squeezeContext.h1AtrPercentile.toFixed(
                    1
                )} is above the allowed squeeze regime`,
            reasonCode: "SQUEEZE_PLAY_H1_REGIME_FILTERED",
            htfReason: `H1 ATR percentile ${squeezeContext.h1AtrPercentile.toFixed(1)}`,
        });
    }

    if (!squeezeContext.releaseTriggered) {
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: waiting for a squeeze release after ${squeezeContext.priorSqueezeCount} compression bars`,
            reasonCode: "SQUEEZE_PLAY_WAIT_RELEASE",
            signalClass: squeezeContext.isInSqueeze ? "PENDING" : "FILTERED",
        });
    }

    if (!Number.isFinite(squeezeContext.slope) || squeezeContext.direction === "FLAT") {
        return buildHoldResult(evaluationContext, {
            reason: "HOLD: release fired but regression slope is flat",
            reasonCode: "SQUEEZE_PLAY_FLAT_SLOPE",
        });
    }

    const normalizedSlope =
        suppliedSqueezeContext &&
        Number.isFinite(toFiniteNumber(suppliedSqueezeContext.slope, null)) &&
        !Number.isFinite(
            toFiniteNumber(suppliedSqueezeContext.normalizedSlope, null)
        )
            ? suppliedSqueezeContext.slope / atrVal
            : toFiniteNumber(
                  squeezeContext.normalizedSlope,
                  squeezeContext.slope / atrVal
              );
    const minNormalizedSlope = Math.max(
        0,
        toFiniteNumber(resolvedConfig.minNormalizedSlopeAtrPerBar, 0.03)
    );
    if (
        !Number.isFinite(normalizedSlope) ||
        Math.abs(normalizedSlope) < minNormalizedSlope
    ) {
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: normalized release slope ${toFiniteNumber(
                    normalizedSlope,
                    0
                ).toFixed(3)} ATR/bar is too weak`,
            reasonCode: "SQUEEZE_PLAY_SLOPE_FILTERED",
        });
    }

    const compressionHigh = toFiniteNumber(
        squeezeContext.compressionHigh,
        null
    );
    const compressionLow = toFiniteNumber(
        squeezeContext.compressionLow,
        null
    );
    const requireBoundaryBreak =
        resolvedConfig.requireCompressionBoundaryBreak !== false;

    const bullishRelease =
        squeezeContext.direction === "LONG" &&
        toFiniteNumber(currentCandle.close, entryPrice) >
            toFiniteNumber(currentCandle.open, entryPrice) &&
        (!requireBoundaryBreak ||
            (Number.isFinite(compressionHigh) && entryPrice > compressionHigh));
    const bearishRelease =
        squeezeContext.direction === "SHORT" &&
        toFiniteNumber(currentCandle.close, entryPrice) <
            toFiniteNumber(currentCandle.open, entryPrice) &&
        (!requireBoundaryBreak ||
            (Number.isFinite(compressionLow) && entryPrice < compressionLow));

    if (!bullishRelease && !bearishRelease) {
        return buildHoldResult(evaluationContext, {
            reason:
                `HOLD: release did not close beyond the ${squeezeContext.direction.toLowerCase()} ` +
                "compression boundary",
            reasonCode: "SQUEEZE_PLAY_BOUNDARY_FILTERED",
        });
    }

    const stopDistance =
        atrVal *
        Math.max(0.1, toFiniteNumber(resolvedConfig.stopLossAtrMultiplier, 2.0));
    const takeProfitDistance =
        atrVal *
        Math.max(0.1, toFiniteNumber(resolvedConfig.takeProfitAtrMultiplier, 3.0));

    if (bullishRelease) {
        return {
            signalType: "BUY",
            reason:
                `BUY: squeeze release long | ${squeezeContext.priorSqueezeCount} bars compressed | ` +
                `slope ${squeezeContext.slope.toExponential(2)} | H1 ATR percentile ${squeezeContext.h1AtrPercentile.toFixed(
                    1
                )}`,
            reasonCode: "SQUEEZE_PLAY_LONG_ACTIONABLE",
            signalClass: "ACTIONABLE",
            intent: "ENTER_LONG",
            entryType: "SQUEEZE_PLAY_RELEASE",
            signalCandleTime: currentCandle.time,
            atrVal,
            atrPips,
            currentPrice: entryPrice,
            rsiVal: 0,
            adxVal: 0,
            pdiVal: 0,
            mdiVal: 0,
            adxRising: false,
            prevAdxVal: 0,
            currentDir: 1,
            prevDir: 0,
            htfContext: {
                enabled: true,
                timeframe: "1h",
                direction: 1,
                longAllowed: true,
                shortAllowed: false,
                reason: `H1 ATR percentile ${squeezeContext.h1AtrPercentile.toFixed(1)}`,
            },
            pendingAction: "clear",
            pending: null,
            tradePlan: {
                stopLossPrice: entryPrice - stopDistance,
                takeProfitPrice: entryPrice + takeProfitDistance,
            },
            strategyContext: buildStrategyContext(evaluationContext, {
                config: resolvedConfig,
                squeezeContext,
                setup: "release",
                entryBias: "long",
            }),
        };
    }

    return {
        signalType: "SELL",
        reason:
            `SELL: squeeze release short | ${squeezeContext.priorSqueezeCount} bars compressed | ` +
            `slope ${squeezeContext.slope.toExponential(2)} | H1 ATR percentile ${squeezeContext.h1AtrPercentile.toFixed(
                1
            )}`,
        reasonCode: "SQUEEZE_PLAY_SHORT_ACTIONABLE",
        signalClass: "ACTIONABLE",
        intent: "ENTER_SHORT",
        entryType: "SQUEEZE_PLAY_RELEASE",
        signalCandleTime: currentCandle.time,
        atrVal,
        atrPips,
        currentPrice: entryPrice,
        rsiVal: 0,
        adxVal: 0,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir: -1,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "1h",
            direction: -1,
            longAllowed: false,
            shortAllowed: true,
            reason: `H1 ATR percentile ${squeezeContext.h1AtrPercentile.toFixed(1)}`,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: {
            stopLossPrice: entryPrice + stopDistance,
            takeProfitPrice: entryPrice - takeProfitDistance,
        },
        strategyContext: buildStrategyContext(evaluationContext, {
            config: resolvedConfig,
            squeezeContext,
            setup: "release",
            entryBias: "short",
        }),
    };
}

const squeezePlayStrategy = createStrategyDefinition({
    key: "squeeze_play",
    label: "Squeeze Play",
    description:
        "Candidate paper strategy for low-volatility compression followed by directional release.",
    phaseIntroduced: 4,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["15m", "1h"],
        marketData: ["candles", "price", "session", "spread"],
        indicators: ["atr", "bollinger_bands", "keltner_channels"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
        defaultConfig: DEFAULT_SQUEEZE_PLAY_CONFIG,
    },
    evaluateEntry: evaluateSqueezePlayEntry,
});

module.exports = Object.assign({}, squeezePlayStrategy, {
    DEFAULT_SQUEEZE_PLAY_CONFIG,
    buildSqueezePlayDerivedContext,
    evaluateSqueezePlayEntry,
});
