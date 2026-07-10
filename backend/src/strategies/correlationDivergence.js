const { ATR } = require("technicalindicators");
const { createStrategyDefinition } = require("./strategyContract");

const DEFAULT_CORRELATION_DIVERGENCE_CONFIG = Object.freeze({
    correlationDivergenceLookbackBars: 16,
    correlationDivergenceReturnStrideBars: 16,
    correlationDivergenceZWindowBars: 80,
    correlationDivergenceMinObservations: 30,
    correlationDivergenceEntryZScore: 2.0,
    correlationDivergenceMinPeerMoveBps: 5,
    correlationDivergenceMinPeerInstruments: 2,
    correlationDivergenceMinCorrelation: 0.35,
    correlationDivergenceBetaMin: 0.25,
    correlationDivergenceBetaMax: 1.75,
    correlationDivergenceStopLossAtrMultiplier: 1.25,
    correlationDivergenceRiskReward: 1.0,
    correlationDivergenceRequireFreshCross: true,
    correlationDivergenceExitZScore: 0.5,
    timeStopHours: 4,
});

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toTimestampMs(value) {
    if (typeof value === "number") {
        return value > 1e12 ? value : value * 1000;
    }

    if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 1e12 ? numeric : numeric * 1000;
        }

        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function getPipValue(instrument, dataService = null) {
    const pipValue = dataService?.getPipValue?.(instrument);
    if (Number.isFinite(Number(pipValue))) {
        return Number(pipValue);
    }

    return instrument?.includes("JPY") ? 0.01 : 0.0001;
}

function getAntiUsdSign(instrument) {
    const [base, quote] = String(instrument || "")
        .toUpperCase()
        .split("_");

    if (quote === "USD") return 1;
    if (base === "USD") return -1;
    return null;
}

function mapAntiUsdDirectionToSignal(instrument, antiUsdDirection) {
    const sign = getAntiUsdSign(instrument);
    if (!sign || antiUsdDirection === 0) return "HOLD";

    const rawDirection = antiUsdDirection * sign;
    return rawDirection > 0 ? "BUY" : "SELL";
}

function normalizeCandles(candles = []) {
    if (!Array.isArray(candles)) return [];

    return candles
        .map((candle) => {
            const timeMs = toTimestampMs(candle?.time);
            const close = toFiniteNumber(candle?.close, null);

            if (!Number.isFinite(timeMs) || !Number.isFinite(close) || close <= 0) {
                return null;
            }

            return {
                timeMs,
                time: new Date(timeMs).toISOString(),
                close,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.timeMs - b.timeMs);
}

function buildLookbackReturnMap(
    candles = [],
    lookbackBars = 16,
    sign = 1,
    strideBars = lookbackBars
) {
    const normalized = normalizeCandles(candles);
    const points = [];
    const lookback = Math.max(1, Math.floor(lookbackBars));

    const stride = Math.max(1, Math.floor(strideBars));
    for (let index = lookback; index < normalized.length; index += stride) {
        const previous = normalized[index - lookback];
        const current = normalized[index];
        const value = Math.log(current.close / previous.close) * sign;

        if (Number.isFinite(value)) {
            points.push({
                timeMs: current.timeMs,
                time: current.time,
                value,
            });
        }
    }

    return new Map(points.map((point) => [point.timeMs, point]));
}

function average(values = []) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mean(values = []) {
    return average(values) ?? 0;
}

function standardDeviation(values = []) {
    if (values.length < 2) return null;
    const avg = mean(values);
    const variance =
        values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
        (values.length - 1);
    const stdDev = Math.sqrt(variance);
    return Number.isFinite(stdDev) && stdDev > 0 ? stdDev : null;
}

function covariance(leftValues = [], rightValues = []) {
    if (leftValues.length !== rightValues.length || leftValues.length < 2) {
        return null;
    }

    const leftMean = mean(leftValues);
    const rightMean = mean(rightValues);
    return (
        leftValues.reduce(
            (sum, leftValue, index) =>
                sum + (leftValue - leftMean) * (rightValues[index] - rightMean),
            0
        ) /
        (leftValues.length - 1)
    );
}

function pearsonCorrelation(leftValues = [], rightValues = []) {
    const cov = covariance(leftValues, rightValues);
    const leftStdDev = standardDeviation(leftValues);
    const rightStdDev = standardDeviation(rightValues);

    if (
        !Number.isFinite(cov) ||
        !Number.isFinite(leftStdDev) ||
        !Number.isFinite(rightStdDev) ||
        leftStdDev === 0 ||
        rightStdDev === 0
    ) {
        return null;
    }

    return Math.max(-1, Math.min(1, cov / (leftStdDev * rightStdDev)));
}

function estimateBeta(targetValues = [], peerValues = [], config = {}) {
    const peerVariance = covariance(peerValues, peerValues);
    const targetPeerCovariance = covariance(targetValues, peerValues);

    if (
        !Number.isFinite(peerVariance) ||
        Math.abs(peerVariance) < 1e-12 ||
        !Number.isFinite(targetPeerCovariance)
    ) {
        return 1;
    }

    const rawBeta = targetPeerCovariance / peerVariance;
    const betaMin = toFiniteNumber(
        config.correlationDivergenceBetaMin,
        DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceBetaMin
    );
    const betaMax = toFiniteNumber(
        config.correlationDivergenceBetaMax,
        DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceBetaMax
    );

    return Math.min(betaMax, Math.max(betaMin, rawBeta));
}

function getLastIndicatorValue(series = []) {
    if (!Array.isArray(series) || series.length === 0) {
        return null;
    }

    return toFiniteNumber(series[series.length - 1], null);
}

function deriveAtr(candles = []) {
    if (!Array.isArray(candles) || candles.length < 15) {
        return null;
    }

    const series = ATR.calculate({
        high: candles.map((candle) => candle.high),
        low: candles.map((candle) => candle.low),
        close: candles.map((candle) => candle.close),
        period: 14,
    });

    return getLastIndicatorValue(series);
}

function buildStrategyContext(context = {}, overrides = {}) {
    return {
        family: "correlation_divergence",
        setup: overrides.setup || "scan",
        targetInstrument: context.instrument || null,
        targetAntiUsdReturnBps: toFiniteNumber(context.targetReturn, 0) * 10000,
        peerAntiUsdReturnBps: toFiniteNumber(context.peerReturn, 0) * 10000,
        residualBps: toFiniteNumber(context.residual, 0) * 10000,
        residualMeanBps: toFiniteNumber(context.residualMean, 0) * 10000,
        residualStdDevBps: toFiniteNumber(context.residualStdDev, 0) * 10000,
        zScore: toFiniteNumber(context.zScore, null),
        beta: toFiniteNumber(context.beta, null),
        rollingCorrelation: toFiniteNumber(context.rollingCorrelation, null),
        peerCount: context.peerCount || 0,
        observationCount: context.observationCount || 0,
        thresholds: {
            entryZScore: toFiniteNumber(
                context.config?.correlationDivergenceEntryZScore,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceEntryZScore
            ),
            minPeerMoveBps: toFiniteNumber(
                context.config?.correlationDivergenceMinPeerMoveBps,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceMinPeerMoveBps
            ),
            minCorrelation: toFiniteNumber(
                context.config?.correlationDivergenceMinCorrelation,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceMinCorrelation
            ),
        },
        peers: context.peerInstruments || [],
    };
}

function buildHoldResult(context = {}, overrides = {}) {
    return {
        signalType: "HOLD",
        reason: overrides.reason || "HOLD: correlation divergence filters not met",
        reasonCode: overrides.reasonCode || "CORRELATION_DIVERGENCE_WAIT",
        signalClass: overrides.signalClass || "FILTERED",
        intent: "WAIT",
        entryType: null,
        signalCandleTime: context.currentCandle?.time || null,
        atrVal: context.atrVal || 0,
        atrPips: context.atrPips || 0,
        currentPrice: context.currentPrice ?? null,
        rsiVal: 0,
        adxVal: Math.abs(toFiniteNumber(context.zScore, 0)),
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir: 0,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "peer_residual",
            direction: 0,
            longAllowed: false,
            shortAllowed: false,
            reason: overrides.htfReason || overrides.reason || null,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan: null,
        strategyContext:
            overrides.strategyContext || buildStrategyContext(context, overrides),
    };
}

function buildPeerReturnMaps(
    marketContext = {},
    timeframe,
    lookbackBars,
    strideBars
) {
    return Object.entries(marketContext?.peers || {})
        .map(([instrument, peerContext]) => {
            const sign = getAntiUsdSign(instrument);
            const candles =
                peerContext?.timeframes?.[timeframe]?.candles ||
                peerContext?.timeframes?.["15m"]?.candles ||
                [];

            if (!sign || !Array.isArray(candles) || candles.length === 0) {
                return null;
            }

            return {
                instrument,
                returns: buildLookbackReturnMap(
                    candles,
                    lookbackBars,
                    sign,
                    strideBars
                ),
            };
        })
        .filter(Boolean);
}

function buildResidualObservations({
    targetReturns,
    peerReturnMaps,
    minPeerInstruments,
}) {
    const observations = [];

    Array.from(targetReturns.values())
        .sort((a, b) => a.timeMs - b.timeMs)
        .forEach((targetPoint) => {
            const peerValues = peerReturnMaps
                .map((peer) => peer.returns.get(targetPoint.timeMs)?.value)
                .filter((value) => Number.isFinite(value));

            if (peerValues.length < minPeerInstruments) {
                return;
            }

            observations.push({
                timeMs: targetPoint.timeMs,
                time: targetPoint.time,
                targetReturn: targetPoint.value,
                peerReturn: average(peerValues),
                peerCount: peerValues.length,
            });
        });

    return observations;
}

function analyzeDivergence({
    instrument,
    candles,
    marketContext,
    config,
}) {
    const lookbackBars = Math.max(
        2,
        Math.floor(
            toFiniteNumber(
                config.correlationDivergenceLookbackBars,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceLookbackBars
            )
        )
    );
    const zWindowBars = Math.max(
        20,
        Math.floor(
            toFiniteNumber(
                config.correlationDivergenceZWindowBars,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceZWindowBars
            )
        )
    );
    const strideBars = Math.max(
        1,
        Math.floor(
            toFiniteNumber(
                config.correlationDivergenceReturnStrideBars,
                lookbackBars
            )
        )
    );
    const minObservations = Math.max(
        20,
        Math.floor(
            toFiniteNumber(
                config.correlationDivergenceMinObservations,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceMinObservations
            )
        )
    );
    const minPeerInstruments = Math.max(
        1,
        Math.floor(
            toFiniteNumber(
                config.correlationDivergenceMinPeerInstruments,
                DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceMinPeerInstruments
            )
        )
    );
    const timeframe = config.timeframe || "15m";
    const targetSign = getAntiUsdSign(instrument);

    if (!targetSign) {
        return {
            valid: false,
            reason: `${instrument} is not a USD-base or USD-quote pair`,
            reasonCode: "CORRELATION_DIVERGENCE_UNSUPPORTED_PAIR",
        };
    }

    const peerReturnMaps = buildPeerReturnMaps(
        marketContext,
        timeframe,
        lookbackBars,
        strideBars
    );
    if (peerReturnMaps.length < minPeerInstruments) {
        return {
            valid: false,
            reason: "Not enough USD peer instruments for divergence model",
            reasonCode: "CORRELATION_DIVERGENCE_INSUFFICIENT_PEERS",
            peerInstruments: peerReturnMaps.map((peer) => peer.instrument),
        };
    }

    const targetReturns = buildLookbackReturnMap(
        candles,
        lookbackBars,
        targetSign,
        strideBars
    );
    const observations = buildResidualObservations({
        targetReturns,
        peerReturnMaps,
        minPeerInstruments,
    });
    const window = observations.slice(-zWindowBars);
    const baseline = window.slice(0, -1);

    if (baseline.length < minObservations || window.length < minObservations + 1) {
        return {
            valid: false,
            reason: `Not enough aligned residual observations (${baseline.length}/${minObservations})`,
            reasonCode: "CORRELATION_DIVERGENCE_INSUFFICIENT_HISTORY",
            peerInstruments: peerReturnMaps.map((peer) => peer.instrument),
            observationCount: baseline.length,
        };
    }

    const targetValues = baseline.map((point) => point.targetReturn);
    const peerValues = baseline.map((point) => point.peerReturn);
    const rollingCorrelation = pearsonCorrelation(targetValues, peerValues);
    const beta = estimateBeta(targetValues, peerValues, config);
    const residuals = baseline.map(
        (point) => point.targetReturn - beta * point.peerReturn
    );
    const residualMean = mean(residuals);
    const residualStdDev = standardDeviation(residuals);
    const current = window[window.length - 1];
    const residual = current.targetReturn - beta * current.peerReturn;

    if (!Number.isFinite(residualStdDev) || residualStdDev <= 0) {
        return {
            valid: false,
            reason: "Residual volatility is too low to score divergence",
            reasonCode: "CORRELATION_DIVERGENCE_LOW_RESIDUAL_VARIANCE",
            peerInstruments: peerReturnMaps.map((peer) => peer.instrument),
            observationCount: baseline.length,
        };
    }
    const previousResidual = residuals[residuals.length - 1];
    const previousZScore = Number.isFinite(previousResidual)
        ? (previousResidual - residualMean) / residualStdDev
        : null;

    return {
        valid: true,
        time: current.time,
        targetReturn: current.targetReturn,
        peerReturn: current.peerReturn,
        peerCount: current.peerCount,
        residual,
        residualMean,
        residualStdDev,
        zScore: (residual - residualMean) / residualStdDev,
        previousZScore,
        returnStrideBars: strideBars,
        beta,
        rollingCorrelation,
        observationCount: baseline.length,
        peerInstruments: peerReturnMaps.map((peer) => peer.instrument),
    };
}

async function evaluateCorrelationDivergenceEntry({
    instrument,
    candles = [],
    currentPrice,
    config = {},
    dataService = null,
    marketContext = null,
}) {
    const resolvedConfig = {
        ...DEFAULT_CORRELATION_DIVERGENCE_CONFIG,
        ...(config || {}),
    };
    const currentCandle = candles[candles.length - 1] || null;
    const entryPrice = toFiniteNumber(currentPrice, currentCandle?.close);
    const timeframe = resolvedConfig.timeframe || "15m";
    const timeframeContext = marketContext?.timeframes?.[timeframe] || {};
    const atrVal =
        getLastIndicatorValue(timeframeContext.indicators?.atr) ||
        deriveAtr(candles) ||
        0;
    const pipValue = getPipValue(instrument, dataService);
    const atrPips =
        Number.isFinite(atrVal) && pipValue > 0 ? atrVal / pipValue : 0;
    const baseContext = {
        instrument,
        currentCandle,
        currentPrice: entryPrice,
        atrVal,
        atrPips,
        config: resolvedConfig,
    };

    if (!Array.isArray(candles) || candles.length < 200) {
        return buildHoldResult(baseContext, {
            reason: "HOLD: correlation divergence requires at least 200 M15 candles",
            reasonCode: "CORRELATION_DIVERGENCE_INSUFFICIENT_M15",
        });
    }

    const analysis = analyzeDivergence({
        instrument,
        candles,
        marketContext,
        config: resolvedConfig,
    });
    const context = {
        ...baseContext,
        ...analysis,
    };

    if (!analysis.valid) {
        return buildHoldResult(context, {
            reason: `HOLD: ${analysis.reason}`,
            reasonCode: analysis.reasonCode,
        });
    }

    if (
        toTimestampMs(analysis.time) !== toTimestampMs(currentCandle?.time)
    ) {
        return buildHoldResult(context, {
            reason: "HOLD: waiting for the next non-overlapping return block",
            reasonCode: "CORRELATION_DIVERGENCE_WAIT_BLOCK",
        });
    }

    const minCorrelation = toFiniteNumber(
        resolvedConfig.correlationDivergenceMinCorrelation,
        DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceMinCorrelation
    );
    if (
        !Number.isFinite(analysis.rollingCorrelation) ||
        analysis.rollingCorrelation < minCorrelation
    ) {
        return buildHoldResult(context, {
            reason: `HOLD: peer correlation too low (${(analysis.rollingCorrelation || 0).toFixed(2)} < ${minCorrelation.toFixed(2)})`,
            reasonCode: "CORRELATION_DIVERGENCE_CORRELATION_TOO_LOW",
        });
    }

    const minPeerMoveBps = toFiniteNumber(
        resolvedConfig.correlationDivergenceMinPeerMoveBps,
        DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceMinPeerMoveBps
    );
    const peerMoveBps = Math.abs(analysis.peerReturn * 10000);
    if (peerMoveBps < minPeerMoveBps) {
        return buildHoldResult(context, {
            reason: `HOLD: peer USD factor move too small (${peerMoveBps.toFixed(1)}bps < ${minPeerMoveBps.toFixed(1)}bps)`,
            reasonCode: "CORRELATION_DIVERGENCE_PEER_MOVE_TOO_SMALL",
        });
    }

    const entryZScore = toFiniteNumber(
        resolvedConfig.correlationDivergenceEntryZScore,
        DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceEntryZScore
    );
    const absZScore = Math.abs(analysis.zScore);
    if (absZScore < entryZScore) {
        return buildHoldResult(context, {
            reason: `HOLD: residual z-score ${analysis.zScore.toFixed(2)} below entry ${entryZScore.toFixed(2)}`,
            reasonCode: "CORRELATION_DIVERGENCE_ZSCORE_TOO_SMALL",
        });
    }

    if (
        resolvedConfig.correlationDivergenceRequireFreshCross !== false &&
        Number.isFinite(analysis.previousZScore) &&
        Math.abs(analysis.previousZScore) >= entryZScore
    ) {
        return buildHoldResult(context, {
            reason:
                `HOLD: residual remains extended at z ${analysis.zScore.toFixed(
                    2
                )}; waiting for convergence before re-arming`,
            reasonCode: "CORRELATION_DIVERGENCE_NOT_FRESH",
        });
    }

    const antiUsdDirection = analysis.zScore < 0 ? 1 : -1;
    const signalType = mapAntiUsdDirectionToSignal(instrument, antiUsdDirection);
    if (signalType !== "BUY" && signalType !== "SELL") {
        return buildHoldResult(context, {
            reason: "HOLD: unable to map divergence direction to trade side",
            reasonCode: "CORRELATION_DIVERGENCE_SIDE_UNAVAILABLE",
        });
    }

    const stopMultiplier = toFiniteNumber(
        resolvedConfig.correlationDivergenceStopLossAtrMultiplier,
        DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceStopLossAtrMultiplier
    );
    const riskReward = Math.max(
        0.1,
        toFiniteNumber(
            resolvedConfig.correlationDivergenceRiskReward,
            DEFAULT_CORRELATION_DIVERGENCE_CONFIG.correlationDivergenceRiskReward
        )
    );
    const minStopDistance =
        Math.max(
            toFiniteNumber(resolvedConfig.minStopLossPips, 15),
            toFiniteNumber(resolvedConfig.stopLossPips, 15)
        ) * pipValue;
    const atrDistance = atrVal * Math.max(0.1, stopMultiplier);
    const stopDistance = Math.max(minStopDistance, atrDistance);
    const rewardDistance = stopDistance * riskReward;

    const tradePlan =
        signalType === "BUY"
            ? {
                  stopLossPrice: entryPrice - stopDistance,
                  takeProfitPrice: entryPrice + rewardDistance,
              }
            : {
                  stopLossPrice: entryPrice + stopDistance,
                  takeProfitPrice: entryPrice - rewardDistance,
              };

    return {
        signalType,
        reason:
            `Correlation divergence ${signalType}: z ${analysis.zScore.toFixed(2)}, residual ${(analysis.residual * 10000).toFixed(1)}bps, peer ${(analysis.peerReturn * 10000).toFixed(1)}bps`,
        reasonCode:
            analysis.zScore < 0
                ? "CORRELATION_DIVERGENCE_LAGGARD_LONG_ANTI_USD"
                : "CORRELATION_DIVERGENCE_OVERSHOOT_SHORT_ANTI_USD",
        signalClass: "ACTIONABLE",
        intent: signalType === "BUY" ? "ENTER_LONG" : "ENTER_SHORT",
        entryType: "CORRELATION_DIVERGENCE_MEAN_REVERSION",
        signalCandleTime: currentCandle?.time || analysis.time,
        atrVal,
        atrPips,
        currentPrice: entryPrice,
        rsiVal: 0,
        adxVal: absZScore,
        pdiVal: 0,
        mdiVal: 0,
        adxRising: false,
        prevAdxVal: 0,
        currentDir: antiUsdDirection,
        prevDir: 0,
        htfContext: {
            enabled: true,
            timeframe: "peer_residual",
            direction: antiUsdDirection,
            longAllowed: signalType === "BUY",
            shortAllowed: signalType === "SELL",
            reason: `z=${analysis.zScore.toFixed(2)}, corr=${analysis.rollingCorrelation.toFixed(2)}, beta=${analysis.beta.toFixed(2)}`,
        },
        pendingAction: "clear",
        pending: null,
        tradePlan,
        strategyContext: buildStrategyContext(context, {
            setup: "mean_reversion_entry",
        }),
    };
}

async function evaluateCorrelationDivergenceExit(context = {}) {
    const config = {
        ...DEFAULT_CORRELATION_DIVERGENCE_CONFIG,
        ...(context.config || {}),
    };
    const analysis = analyzeDivergence({
        instrument: context.instrument,
        candles: context.candles || [],
        marketContext: context.marketContext,
        config,
    });
    const exitZ = Math.max(
        0,
        toFiniteNumber(config.correlationDivergenceExitZScore, 0.5)
    );
    if (analysis.valid && Math.abs(analysis.zScore) <= exitZ) {
        return {
            signalType: "CLOSE",
            signalClass: "ACTIONABLE",
            intent: "EXIT_POSITION",
            reasonCode: "CORRELATION_DIVERGENCE_CONVERGED_EXIT",
            reason: `EXIT: residual converged to z ${analysis.zScore.toFixed(2)}`,
            signalCandleTime:
                context.candles?.[context.candles.length - 1]?.time || null,
        };
    }
    return buildHoldResult(
        {
            currentCandle: context.candles?.[context.candles.length - 1],
            currentPrice: context.currentPrice,
            ...analysis,
        },
        {
            reason: analysis.valid
                ? `HOLD: residual z ${analysis.zScore.toFixed(2)} has not converged`
                : `HOLD: ${analysis.reason || "residual unavailable"}`,
            reasonCode: "CORRELATION_DIVERGENCE_EXIT_WAIT",
        }
    );
}

const correlationDivergenceStrategy = createStrategyDefinition({
    key: "correlation_divergence",
    label: "Correlation Divergence",
    description:
        "Paper candidate that trades single-leg mean reversion when one USD pair diverges from its peer USD factor.",
    phaseIntroduced: 7,
    runtimeStatus: "candidate",
    requiredData: {
        timeframes: ["15m"],
        marketData: ["candles", "price", "session", "spread", "peerCandles"],
        indicators: ["atr"],
    },
    metadata: {
        supportsLive: false,
        supportsShadow: false,
        supportsCandidate: true,
        defaultConfig: DEFAULT_CORRELATION_DIVERGENCE_CONFIG,
    },
    evaluateEntry: evaluateCorrelationDivergenceEntry,
    evaluateExit: evaluateCorrelationDivergenceExit,
});

module.exports = Object.assign({}, correlationDivergenceStrategy, {
    DEFAULT_CORRELATION_DIVERGENCE_CONFIG,
    analyzeDivergence,
    buildLookbackReturnMap,
    evaluateCorrelationDivergenceEntry,
    evaluateCorrelationDivergenceExit,
    getAntiUsdSign,
    mapAntiUsdDirectionToSignal,
});
