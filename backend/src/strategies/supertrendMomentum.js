const { RSI, ADX, ATR } = require("technicalindicators");
const logger = require("../utils/logger");
const { calculateSuperTrend } = require("../utils/indicators");
const { calculateExpectedEdge } = require("./expectedEdge");
const { createStrategyDefinition } = require("./strategyContract");
const {
    resolveSupertrendPeriod,
    resolveSupertrendMultiplier,
} = require("../config/supertrendParams");

function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getCandleTimestampMs(candleTime) {
    if (typeof candleTime === "number") {
        return candleTime > 1e12 ? candleTime : candleTime * 1000;
    }

    const parsed = Date.parse(candleTime);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function isLongContinuationEnabled(config) {
    if (config.enableContinuationEntry === false) return false;
    return config.enableLongContinuationEntry !== false;
}

function isShortContinuationEnabled(config) {
    if (config.enableContinuationEntry === false) return false;
    return config.enableShortContinuationEntry !== false;
}

function isShortingEnabled(config) {
    return config.enableShorting !== false;
}

function areFreshFlipEntriesEnabled(config) {
    return config.enableFreshFlipEntries !== false;
}

function isAdxFilterEnabled(config) {
    return config.enableAdxFilter !== false;
}

function isRsiFilterEnabled(config) {
    return config.enableRsiFilter !== false;
}

function getLongMomentumFloor(config) {
    return toFiniteNumber(config.longRsiMomentumFloor, 52);
}

function getShortMomentumCeiling(config) {
    return toFiniteNumber(config.shortRsiMomentumCeiling, 50);
}

function getFreshLongRsiCeiling(config) {
    return toFiniteNumber(
        config.freshLongRsiCeiling ?? config.rsiOverbought,
        75
    );
}

function passesLongMomentum(config, rsiVal) {
    return !isRsiFilterEnabled(config) || rsiVal >= getLongMomentumFloor(config);
}

function passesShortMomentum(config, rsiVal) {
    return !isRsiFilterEnabled(config) || rsiVal <= getShortMomentumCeiling(config);
}

function passesFreshLongRsiCeiling(config, rsiVal) {
    return !isRsiFilterEnabled(config) || rsiVal < getFreshLongRsiCeiling(config);
}

function passesLongOverboughtCeiling(config, rsiVal) {
    return (
        !isRsiFilterEnabled(config) ||
        rsiVal < toFiniteNumber(config.rsiOverbought, 75)
    );
}

function passesFreshShortRsiFloor(config, rsiVal) {
    return (
        !isRsiFilterEnabled(config) ||
        rsiVal > toFiniteNumber(config.rsiOversold, 30)
    );
}

function estimateSupertrendStopPips(config = {}, atrPips = 0) {
    const atrStopPips =
        Math.max(0, toFiniteNumber(atrPips, 0)) *
        Math.max(1, toFiniteNumber(config.stopLossAtrMultiplier, 2));
    const configuredStopPips = Math.max(
        toFiniteNumber(config.stopLossPips, 15),
        toFiniteNumber(config.minStopLossPips, 0)
    );

    if (String(config.stopLossType || "").toUpperCase() === "FIXED") {
        return configuredStopPips;
    }

    return Math.max(atrStopPips, configuredStopPips);
}

function estimateSupertrendTargetPips(config = {}, stopPips = 0) {
    const explicitTargetPips = toFiniteNumber(config.expectedTargetPips, null);
    if (Number.isFinite(explicitTargetPips) && explicitTargetPips > 0) {
        return explicitTargetPips;
    }

    const trailingActivationPips = toFiniteNumber(
        config.trailingStopActivationPips,
        null
    );
    if (
        config.enableTrailingStops !== false &&
        Number.isFinite(trailingActivationPips) &&
        trailingActivationPips > 0
    ) {
        return trailingActivationPips;
    }

    const expectedRewardRisk = Math.max(
        0.1,
        toFiniteNumber(config.expectedRewardRisk, 1)
    );
    return Math.max(0, toFiniteNumber(stopPips, 0)) * expectedRewardRisk;
}

function evaluateContinuationChase(config, pending, currentClose, atrVal) {
    const direction = pending.direction === "SHORT" ? -1 : 1;
    const favorableMove = Math.max(
        0,
        direction * (currentClose - pending.flipPrice)
    );
    const maxChaseAtr = Math.max(
        0,
        toFiniteNumber(config.continuationMaxChaseAtr, 0.75)
    );
    const deviationAtr = Number.isFinite(atrVal) && atrVal > 0
        ? favorableMove / atrVal
        : Infinity;
    return {
        deviationAtr,
        maxChaseAtr,
        isChaseable: deviationAtr <= maxChaseAtr,
    };
}

function buildSupertrendStrategyContext({
    signalType,
    entryType,
    currentPrice,
    atrPips,
    rsiVal,
    adxVal,
    pdiVal,
    mdiVal,
    currentDir,
    prevDir,
    htfContext,
    freshFlipEntriesEnabled,
    longContinuationEnabled,
    shortContinuationEnabled,
    spreadPips,
    expectedEdge,
}) {
    return {
        family: "supertrend_momentum",
        setup: entryType || "scan",
        entryBias:
            signalType === "BUY"
                ? "long"
                : signalType === "SELL" && entryType !== "EXIT_ONLY"
                ? "short"
                : null,
        currentPrice: toFiniteNumber(currentPrice, null),
        m15: {
            supertrendDirection: currentDir,
            previousSupertrendDirection: prevDir,
            adx: toFiniteNumber(adxVal, null),
            pdi: toFiniteNumber(pdiVal, null),
            mdi: toFiniteNumber(mdiVal, null),
            rsi: toFiniteNumber(rsiVal, null),
            atrPips: toFiniteNumber(atrPips, null),
        },
        htf: htfContext || null,
        filters: {
            freshFlipEntriesEnabled,
            longContinuationEnabled,
            shortContinuationEnabled,
        },
        session: {
            spreadPips: toFiniteNumber(spreadPips, null),
        },
        expectedEdge: expectedEdge || null,
    };
}

function getHtfTrendContext(config, dataService, instrument, options = {}) {
    const { calculateSuperTrendFn = calculateSuperTrend } = options;

    if (!config.enableHTFFilter) {
        return {
            enabled: false,
            timeframe: null,
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
        };
    }

    const timeframe = config.htfTimeframe || "1h";
    const candles = dataService?.getCandles?.(instrument, timeframe) || [];
    if (candles.length < 50) {
        return {
            enabled: true,
            timeframe,
            direction: 0,
            longAllowed: false,
            shortAllowed: false,
            reason: `HTF ${timeframe} unavailable`,
        };
    }

    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const closes = candles.map((candle) => candle.close);
    const stData = calculateSuperTrendFn(
        highs,
        lows,
        closes,
        resolveSupertrendPeriod(config),
        resolveSupertrendMultiplier(config)
    );
    const direction = stData.direction[stData.direction.length - 1] || 0;

    return {
        enabled: true,
        timeframe,
        direction,
        longAllowed: direction === 1,
        shortAllowed: direction === -1,
        reason:
            direction === 1
                ? `HTF ${timeframe} uptrend`
                : `HTF ${timeframe} downtrend`,
    };
}

function createPullbackSetup({
    direction,
    flipTime,
    flipPrice,
    flipAdx,
    flipRsi,
    initialHigh,
    initialLow,
    signalCandleTime,
}) {
    return {
        direction,
        state: "AWAIT_PULLBACK",
        waitingFor: "PULLBACK",
        flipTime,
        flipPrice,
        flipAdx,
        flipRsi,
        peakPrice: initialHigh,
        troughPrice: initialLow,
        signalCandleTime,
        pullbackLow: null,
        pullbackHigh: null,
        pullbackDepthAtr: null,
        reaccelerationTrigger: null,
        pullbackDetectedTime: null,
    };
}

function createHtfConfirmationSetup({
    direction,
    flipTime,
    flipPrice,
    flipAdx,
    flipRsi,
    initialHigh,
    initialLow,
    signalCandleTime,
}) {
    return {
        direction,
        state: "AWAIT_HTF_CONFIRMATION",
        waitingFor: "HTF_CONFIRMATION",
        flipTime,
        flipPrice,
        flipAdx,
        flipRsi,
        peakPrice: initialHigh,
        troughPrice: initialLow,
        signalCandleTime,
        pullbackLow: null,
        pullbackHigh: null,
        pullbackDepthAtr: null,
        reaccelerationTrigger: null,
        pullbackDetectedTime: null,
    };
}

function evaluateLongHtfConfirmationSetup(config, params) {
    const {
        pending,
        signalCandleTime,
        currentDir,
        currentClose,
        currentHigh,
        currentLow,
        adxMeetsThreshold,
        adxOk,
        longDiOk,
        longBaseRegimeOk,
        longContinuationEnabled,
        htfContext,
        rsiVal,
        adxVal,
        atrVal,
        nowMs = Date.now(),
    } = params;

    const ageMs = nowMs - pending.flipTime;
    const maxAgeMs = config.continuationWindowMs || 4 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
        return {
            clearPending: true,
            reason: "HOLD: waiting for HTF confirmation expired",
            reasonCode: "LONG_WAIT_HTF_EXPIRED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    if (currentDir !== 1) {
        return {
            clearPending: true,
            reason: "HOLD: HTF confirmation invalidated (trend lost)",
            reasonCode: "LONG_WAIT_HTF_TREND_LOST",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    const updatedPeakPrice = Math.max(
        pending.peakPrice || pending.flipPrice,
        currentHigh
    );
    if (!htfContext.longAllowed) {
        if (
            !adxMeetsThreshold ||
            !longDiOk ||
            !passesLongMomentum(config, rsiVal)
        ) {
            return {
                clearPending: true,
                reason: "HOLD: HTF confirmation invalidated (momentum faded)",
                reasonCode: "LONG_WAIT_HTF_MOMENTUM_FADED",
                signalClass: "FILTERED",
                intent: "WAIT",
            };
        }

        return {
            pending: {
                ...pending,
                peakPrice: updatedPeakPrice,
            },
            reason: `HOLD: waiting for HTF confirmation (${htfContext.reason})`,
            reasonCode: "LONG_WAIT_HTF_PENDING",
            signalClass: "PENDING",
            intent: "WAIT",
        };
    }

    if (!longBaseRegimeOk) {
        return {
            clearPending: true,
            reason: "HOLD: HTF confirmed but long setup invalidated",
            reasonCode: "LONG_HTF_CONFIRMED_INVALIDATED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    const chase = evaluateContinuationChase(
        config,
        pending,
        currentClose,
        atrVal
    );
    const isChaseable = chase.isChaseable;

    if (adxOk && passesLongOverboughtCeiling(config, rsiVal) && isChaseable) {
        return {
            signalType: "BUY",
            entryType: "HTF_CONFIRMATION",
            clearPending: true,
            reason:
                `BUY: HTF confirmed after M15 flip | ` +
                `deviation ${chase.deviationAtr.toFixed(2)} ATR | ADX ${adxVal.toFixed(
                    1
                )} | RSI ${rsiVal.toFixed(1)}`,
            reasonCode: "LONG_HTF_CONFIRMED_ENTRY",
            signalClass: "ACTIONABLE",
            intent: "ENTER_LONG",
        };
    }

    if (longContinuationEnabled) {
        return {
            pending: {
                ...createPullbackSetup({
                    direction: "LONG",
                    flipTime: pending.flipTime,
                    flipPrice: pending.flipPrice,
                    flipAdx: pending.flipAdx,
                    flipRsi: pending.flipRsi,
                    initialHigh: updatedPeakPrice,
                    initialLow: currentLow,
                    signalCandleTime: pending.signalCandleTime || signalCandleTime,
                }),
                peakPrice: updatedPeakPrice,
            },
            reason:
                `HOLD: HTF confirmed but move extended | ` +
                `deviation ${chase.deviationAtr.toFixed(2)} ATR | waiting for pullback`,
            reasonCode: "LONG_HTF_CONFIRMED_PULLBACK",
            signalClass: "PENDING",
            intent: "WAIT",
        };
    }

    return {
        clearPending: true,
        reason:
            `HOLD: HTF confirmed but entry not chaseable (${chase.deviationAtr.toFixed(
                2
            )} ATR > ${chase.maxChaseAtr.toFixed(2)} ATR)`,
        reasonCode: "LONG_HTF_CONFIRMED_NOT_CHASEABLE",
        signalClass: "FILTERED",
        intent: "WAIT",
    };
}

function evaluateShortHtfConfirmationSetup(config, params) {
    const {
        pending,
        signalCandleTime,
        currentDir,
        currentClose,
        currentHigh,
        currentLow,
        adxMeetsThreshold,
        adxOk,
        shortDiOk,
        shortBaseRegimeOk,
        shortContinuationEnabled,
        htfContext,
        rsiVal,
        adxVal,
        atrVal,
        nowMs = Date.now(),
    } = params;

    const ageMs = nowMs - pending.flipTime;
    const maxAgeMs = config.continuationWindowMs || 4 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
        return {
            clearPending: true,
            reason: "HOLD: waiting for HTF confirmation expired",
            reasonCode: "SHORT_WAIT_HTF_EXPIRED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    if (currentDir !== -1) {
        return {
            clearPending: true,
            reason: "HOLD: HTF confirmation invalidated (trend lost)",
            reasonCode: "SHORT_WAIT_HTF_TREND_LOST",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    const updatedTroughPrice = Math.min(
        pending.troughPrice || pending.flipPrice,
        currentLow
    );
    if (!htfContext.shortAllowed) {
        if (
            !adxMeetsThreshold ||
            !shortDiOk ||
            !passesShortMomentum(config, rsiVal)
        ) {
            return {
                clearPending: true,
                reason: "HOLD: HTF confirmation invalidated (momentum faded)",
                reasonCode: "SHORT_WAIT_HTF_MOMENTUM_FADED",
                signalClass: "FILTERED",
                intent: "WAIT",
            };
        }

        return {
            pending: {
                ...pending,
                troughPrice: updatedTroughPrice,
            },
            reason: `HOLD: waiting for HTF confirmation (${htfContext.reason})`,
            reasonCode: "SHORT_WAIT_HTF_PENDING",
            signalClass: "PENDING",
            intent: "WAIT",
        };
    }

    if (!shortBaseRegimeOk) {
        return {
            clearPending: true,
            reason: "HOLD: HTF confirmed but short setup invalidated",
            reasonCode: "SHORT_HTF_CONFIRMED_INVALIDATED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    const chase = evaluateContinuationChase(
        config,
        pending,
        currentClose,
        atrVal
    );
    const isChaseable = chase.isChaseable;

    if (adxOk && passesFreshShortRsiFloor(config, rsiVal) && isChaseable) {
        return {
            signalType: "SELL",
            entryType: "SHORT_HTF_CONFIRMATION",
            clearPending: true,
            reason:
                `SELL: HTF confirmed after M15 flip | ` +
                `deviation ${chase.deviationAtr.toFixed(2)} ATR | ADX ${adxVal.toFixed(
                    1
                )} | RSI ${rsiVal.toFixed(1)}`,
            reasonCode: "SHORT_HTF_CONFIRMED_ENTRY",
            signalClass: "ACTIONABLE",
            intent: "ENTER_SHORT",
        };
    }

    if (shortContinuationEnabled) {
        return {
            pending: {
                ...createPullbackSetup({
                    direction: "SHORT",
                    flipTime: pending.flipTime,
                    flipPrice: pending.flipPrice,
                    flipAdx: pending.flipAdx,
                    flipRsi: pending.flipRsi,
                    initialHigh: currentHigh,
                    initialLow: updatedTroughPrice,
                    signalCandleTime: pending.signalCandleTime || signalCandleTime,
                }),
                troughPrice: updatedTroughPrice,
            },
            reason:
                `HOLD: HTF confirmed but move extended | ` +
                `deviation ${chase.deviationAtr.toFixed(2)} ATR | waiting for pullback`,
            reasonCode: "SHORT_HTF_CONFIRMED_PULLBACK",
            signalClass: "PENDING",
            intent: "WAIT",
        };
    }

    return {
        clearPending: true,
        reason:
            `HOLD: HTF confirmed but entry not chaseable (${chase.deviationAtr.toFixed(
                2
            )} ATR > ${chase.maxChaseAtr.toFixed(2)} ATR)`,
        reasonCode: "SHORT_HTF_CONFIRMED_NOT_CHASEABLE",
        signalClass: "FILTERED",
        intent: "WAIT",
    };
}

function evaluateLongPullbackSetup(config, params) {
    const {
        instrument,
        pending,
        signalCandleTime,
        currentOpen,
        currentClose,
        currentHigh,
        currentLow,
        previousCandle,
        atrVal,
        rsiVal,
        adxMeetsThreshold,
        adxOk,
        longDiOk,
        htfContext,
        nowMs = Date.now(),
    } = params;

    const ageMs = nowMs - pending.flipTime;
    const maxAgeMs = config.continuationWindowMs || 4 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
        logger.info(
            `TIME ${instrument}: Long setup expired after ${(
                ageMs / 60000
            ).toFixed(0)} minutes`
        );
        return {
            clearPending: true,
            reason: "HOLD: long setup expired",
            reasonCode: "LONG_CONTINUATION_EXPIRED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    if (!htfContext.longAllowed || !adxMeetsThreshold || !longDiOk) {
        return {
            clearPending: true,
            reason: `HOLD: long setup invalidated (${htfContext.reason || "trend lost"})`,
            reasonCode: "LONG_CONTINUATION_INVALIDATED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    const minPullbackAtr = config.continuationPullbackMinAtr || 0.5;
    const maxPullbackAtr = config.continuationPullbackMaxAtr || 1.5;
    const trackedPeakPrice =
        pending.state === "AWAIT_PULLBACK"
            ? Math.max(pending.peakPrice || pending.flipPrice, currentHigh)
            : pending.peakPrice || pending.flipPrice;
    const pullbackDepthAtr =
        atrVal > 0 ? (trackedPeakPrice - currentLow) / atrVal : 0;
    const bearishPullbackCandle =
        currentClose < previousCandle.close || currentLow < previousCandle.low;
    const rsiCooled = rsiVal <= (config.continuationRsiThreshold || 70);

    if (pending.state === "AWAIT_PULLBACK") {
        if (pullbackDepthAtr > maxPullbackAtr) {
            return {
                clearPending: true,
                reason: `HOLD: long pullback too deep (${pullbackDepthAtr.toFixed(
                    2
                )} ATR)`,
                reasonCode: "LONG_PULLBACK_TOO_DEEP",
                signalClass: "FILTERED",
                intent: "WAIT",
            };
        }

        if (
            bearishPullbackCandle &&
            pullbackDepthAtr >= minPullbackAtr &&
            rsiCooled
        ) {
            return {
                pending: {
                    ...pending,
                    state: "AWAIT_REACCELERATION",
                    waitingFor: "REACCELERATION",
                    peakPrice: trackedPeakPrice,
                    pullbackLow: currentLow,
                    pullbackHigh: currentHigh,
                    pullbackDepthAtr,
                    reaccelerationTrigger: currentHigh,
                    pullbackDetectedTime: getCandleTimestampMs(signalCandleTime),
                },
                reason:
                    `HOLD: long pullback detected (${pullbackDepthAtr.toFixed(
                        2
                    )} ATR) - waiting for breakout`,
                reasonCode: "LONG_PULLBACK_DETECTED",
                signalClass: "PENDING",
                intent: "WAIT",
            };
        }

        return {
            pending: {
                ...pending,
                peakPrice: trackedPeakPrice,
            },
            reason:
                `HOLD: long setup waiting for pullback | peak ${trackedPeakPrice.toFixed(
                    5
                )}`,
            reasonCode: "LONG_PULLBACK_WAIT",
            signalClass: "PENDING",
            intent: "WAIT",
        };
    }

    const breakoutTrigger =
        pending.reaccelerationTrigger || pending.pullbackHigh || previousCandle.high;
    const updatedPullbackLow =
        pending.pullbackLow == null
            ? currentLow
            : Math.min(pending.pullbackLow, currentLow);
    const updatedPullbackHigh =
        pending.pullbackHigh == null
            ? currentHigh
            : Math.max(pending.pullbackHigh, currentHigh);
    const updatedTrigger = Math.max(breakoutTrigger, currentHigh);
    const updatedDepthAtr =
        atrVal > 0
            ? (pending.peakPrice - updatedPullbackLow) / atrVal
            : pending.pullbackDepthAtr || 0;

    if (updatedDepthAtr > maxPullbackAtr) {
        return {
            clearPending: true,
            reason: `HOLD: long pullback invalidated (${updatedDepthAtr.toFixed(
                2
            )} ATR)`,
            reasonCode: "LONG_REACCELERATION_INVALIDATED",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    const bullishBreakout =
        currentClose > breakoutTrigger &&
        currentClose > previousCandle.high &&
        currentClose > currentOpen;
    const reaccelerationConfirmed =
        bullishBreakout &&
        adxOk &&
        longDiOk &&
        passesLongMomentum(config, rsiVal) &&
        passesLongOverboughtCeiling(config, rsiVal) &&
        htfContext.longAllowed;

    if (reaccelerationConfirmed) {
        return {
            signalType: "BUY",
            entryType: "CONTINUATION_PULLBACK",
            clearPending: true,
            reason:
                `BUY: Pullback reacceleration | depth ${updatedDepthAtr.toFixed(
                    2
                )} ATR | RSI ${rsiVal.toFixed(1)} | ` +
                `+DI breakout confirmed`,
            reasonCode: "LONG_PULLBACK_REACCELERATION",
            signalClass: "ACTIONABLE",
            intent: "ENTER_LONG",
        };
    }

    return {
        pending: {
            ...pending,
            state: "AWAIT_REACCELERATION",
            waitingFor: "REACCELERATION",
            pullbackLow: updatedPullbackLow,
            pullbackHigh: updatedPullbackHigh,
            pullbackDepthAtr: updatedDepthAtr,
            reaccelerationTrigger: updatedTrigger,
        },
        reason:
            `HOLD: long setup waiting for breakout | depth ${updatedDepthAtr.toFixed(
                2
            )} ATR`,
        reasonCode: "LONG_REACCELERATION_WAIT",
        signalClass: "PENDING",
        intent: "WAIT",
    };
}

function evaluateShortPullbackSetup(config, params) {
    const {
        instrument,
        pending,
        signalCandleTime,
        currentOpen,
        currentClose,
        currentHigh,
        currentLow,
        previousCandle,
        atrVal,
        rsiVal,
        adxMeetsThreshold,
        adxOk,
        shortDiOk,
        htfContext,
        nowMs = Date.now(),
    } = params;

    const ageMs = nowMs - pending.flipTime;
    const maxAgeMs = config.continuationWindowMs || 4 * 60 * 60 * 1000;
    if (ageMs > maxAgeMs) {
        logger.info(
            `TIME ${instrument}: Short setup expired after ${(
                ageMs / 60000
            ).toFixed(0)} minutes`
        );
        return {
            clearPending: true,
            reason: "EXIT_ONLY: short setup expired",
            reasonCode: "SHORT_CONTINUATION_EXPIRED",
            signalClass: "EXIT_ONLY",
            intent: "EXIT_LONG_ONLY",
        };
    }

    if (!htfContext.shortAllowed || !adxMeetsThreshold || !shortDiOk) {
        return {
            clearPending: true,
            reason: `EXIT_ONLY: short setup invalidated (${htfContext.reason || "trend lost"})`,
            reasonCode: "SHORT_CONTINUATION_INVALIDATED",
            signalClass: "EXIT_ONLY",
            intent: "EXIT_LONG_ONLY",
        };
    }

    const minPullbackAtr = config.continuationPullbackMinAtr || 0.5;
    const maxPullbackAtr = config.continuationPullbackMaxAtr || 1.5;
    const trackedTroughPrice =
        pending.state === "AWAIT_PULLBACK"
            ? Math.min(pending.troughPrice || pending.flipPrice, currentLow)
            : pending.troughPrice || pending.flipPrice;
    const pullbackDepthAtr =
        atrVal > 0 ? (currentHigh - trackedTroughPrice) / atrVal : 0;
    const bullishPullbackCandle =
        currentClose > previousCandle.close || currentHigh > previousCandle.high;
    const rsiRecovered =
        !isRsiFilterEnabled(config) || rsiVal >= getShortMomentumCeiling(config);

    if (pending.state === "AWAIT_PULLBACK") {
        if (pullbackDepthAtr > maxPullbackAtr) {
            return {
                clearPending: true,
                reason: `EXIT_ONLY: short pullback too deep (${pullbackDepthAtr.toFixed(
                    2
                )} ATR)`,
                reasonCode: "SHORT_PULLBACK_TOO_DEEP",
                signalClass: "EXIT_ONLY",
                intent: "EXIT_LONG_ONLY",
            };
        }

        if (
            bullishPullbackCandle &&
            pullbackDepthAtr >= minPullbackAtr &&
            rsiRecovered
        ) {
            return {
                pending: {
                    ...pending,
                    state: "AWAIT_REACCELERATION",
                    waitingFor: "REACCELERATION",
                    troughPrice: trackedTroughPrice,
                    pullbackLow: currentLow,
                    pullbackHigh: currentHigh,
                    pullbackDepthAtr,
                    reaccelerationTrigger: currentLow,
                    pullbackDetectedTime: getCandleTimestampMs(signalCandleTime),
                },
                reason:
                    `EXIT_ONLY: short pullback detected (${pullbackDepthAtr.toFixed(
                        2
                    )} ATR) - waiting for breakdown`,
                reasonCode: "SHORT_PULLBACK_DETECTED",
                signalClass: "EXIT_ONLY",
                intent: "EXIT_LONG_ONLY",
            };
        }

        return {
            pending: {
                ...pending,
                troughPrice: trackedTroughPrice,
            },
            reason:
                `EXIT_ONLY: short setup waiting for pullback | trough ${trackedTroughPrice.toFixed(
                    5
                )}`,
            reasonCode: "SHORT_PULLBACK_WAIT",
            signalClass: "EXIT_ONLY",
            intent: "EXIT_LONG_ONLY",
        };
    }

    const breakdownTrigger =
        pending.reaccelerationTrigger || pending.pullbackLow || previousCandle.low;
    const updatedPullbackLow =
        pending.pullbackLow == null
            ? currentLow
            : Math.min(pending.pullbackLow, currentLow);
    const updatedPullbackHigh =
        pending.pullbackHigh == null
            ? currentHigh
            : Math.max(pending.pullbackHigh, currentHigh);
    const updatedTrigger = Math.min(breakdownTrigger, currentLow);
    const updatedDepthAtr =
        atrVal > 0
            ? (updatedPullbackHigh - pending.troughPrice) / atrVal
            : pending.pullbackDepthAtr || 0;

    if (updatedDepthAtr > maxPullbackAtr) {
        return {
            clearPending: true,
            reason: `EXIT_ONLY: short pullback invalidated (${updatedDepthAtr.toFixed(
                2
            )} ATR)`,
            reasonCode: "SHORT_REACCELERATION_INVALIDATED",
            signalClass: "EXIT_ONLY",
            intent: "EXIT_LONG_ONLY",
        };
    }

    const bearishBreakdown =
        currentClose < breakdownTrigger &&
        currentClose < previousCandle.low &&
        currentClose < currentOpen;
    const reaccelerationConfirmed =
        bearishBreakdown &&
        adxOk &&
        shortDiOk &&
        passesShortMomentum(config, rsiVal) &&
        passesFreshShortRsiFloor(config, rsiVal) &&
        htfContext.shortAllowed;

    if (reaccelerationConfirmed) {
        return {
            signalType: "SELL",
            entryType: "SHORT_CONTINUATION_PULLBACK",
            clearPending: true,
            reason:
                `SELL: Pullback reacceleration | depth ${updatedDepthAtr.toFixed(
                    2
                )} ATR | RSI ${rsiVal.toFixed(1)} | ` +
                `-DI breakdown confirmed`,
            reasonCode: "SHORT_PULLBACK_REACCELERATION",
            signalClass: "ACTIONABLE",
            intent: "ENTER_SHORT",
        };
    }

    return {
        pending: {
            ...pending,
            state: "AWAIT_REACCELERATION",
            waitingFor: "REACCELERATION",
            pullbackLow: updatedPullbackLow,
            pullbackHigh: updatedPullbackHigh,
            pullbackDepthAtr: updatedDepthAtr,
            reaccelerationTrigger: updatedTrigger,
        },
        reason:
            `EXIT_ONLY: short setup waiting for breakdown | depth ${updatedDepthAtr.toFixed(
                2
            )} ATR`,
        reasonCode: "SHORT_REACCELERATION_WAIT",
        signalClass: "EXIT_ONLY",
        intent: "EXIT_LONG_ONLY",
    };
}

async function evaluateSupertrendMomentumEntry(context) {
    const {
        instrument,
        candles,
        currentPrice,
        config,
        dataService,
        pendingEntry = null,
        calculateSuperTrendFn = calculateSuperTrend,
        getHtfTrendContextFn = null,
        marketContext = null,
        nowMs: contextNowMs = null,
    } = context;

    const timeframe = config.timeframe || "15m";
    const timeframeContext = marketContext?.timeframes?.[timeframe] || null;
    const resolvedCandles = Array.isArray(candles) && candles.length > 0
        ? candles
        : timeframeContext?.candles || [];
    const highs = resolvedCandles.map((candle) => candle.high);
    const lows = resolvedCandles.map((candle) => candle.low);
    const closes = resolvedCandles.map((candle) => candle.close);
    const indicatorBundle = timeframeContext?.indicators || {};

    const stData =
        indicatorBundle.supertrend ||
        calculateSuperTrendFn(
            highs,
            lows,
            closes,
            resolveSupertrendPeriod(config),
            resolveSupertrendMultiplier(config)
        );

    const idx = closes.length - 1;
    const currentDir = stData.direction[idx];
    const prevDir = stData.direction[idx - 1];
    const signalCandleTime = resolvedCandles[idx]?.time || null;
    const nowMs = toFiniteNumber(
        contextNowMs,
        getCandleTimestampMs(signalCandleTime)
    );
    const flipCandlePrice = closes[idx];
    const flipTimeMs = getCandleTimestampMs(signalCandleTime);

    const rsiVal =
        indicatorBundle.rsi?.[indicatorBundle.rsi.length - 1] ??
        RSI.calculate({ values: closes, period: 14 }).pop();
    const adxResults =
        indicatorBundle.adx ||
        ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        });
    const adxResult = adxResults[adxResults.length - 1];
    const adxVal = adxResult?.adx || 0;
    const pdiVal = adxResult?.pdi || 0;
    const mdiVal = adxResult?.mdi || 0;

    const lookback = config.adxSlopeLookback || 3;
    const lookbackIdx = adxResults.length - 1 - lookback;
    const prevAdxResult = lookbackIdx >= 0 ? adxResults[lookbackIdx] : null;
    const prevAdxVal = prevAdxResult?.adx || adxVal;
    const adxRising = adxVal > prevAdxVal;

    const atrValues =
        indicatorBundle.atr ||
        ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        });
    const atrVal = atrValues[atrValues.length - 1];

    const pipValue = dataService?.getPipValue?.(instrument) || 0.0001;
    const atrPips = atrVal / pipValue;
    const htfTimeframe = config.htfTimeframe || "1h";
    const htfTimeframeContext = marketContext?.timeframes?.[htfTimeframe] || null;
    const htfSupertrend = htfTimeframeContext?.indicators?.supertrend || null;
    const htfCandles = htfTimeframeContext?.candles || [];
    const htfDirection =
        htfSupertrend?.direction?.[htfSupertrend.direction.length - 1] || 0;
    const htfContext = getHtfTrendContextFn
        ? getHtfTrendContextFn(instrument)
        : htfTimeframeContext
        ? !config.enableHTFFilter
            ? {
                  enabled: false,
                  timeframe: null,
                  direction: 0,
                  longAllowed: true,
                  shortAllowed: true,
              }
            : htfCandles.length < 50
            ? {
                  enabled: true,
                  timeframe: htfTimeframe,
                  direction: 0,
                  longAllowed: false,
                  shortAllowed: false,
                  reason: `HTF ${htfTimeframe} unavailable`,
              }
            : {
                  enabled: true,
                  timeframe: htfTimeframe,
                  direction: htfDirection,
                  longAllowed: htfDirection === 1,
                  shortAllowed: htfDirection === -1,
                  reason:
                      htfDirection === 1
                          ? `HTF ${htfTimeframe} uptrend`
                          : `HTF ${htfTimeframe} downtrend`,
              }
        : getHtfTrendContext(config, dataService, instrument, {
              calculateSuperTrendFn,
          });
    const spreadPips = toFiniteNumber(
        marketContext?.session?.spreadPips ?? marketContext?.price?.spread,
        null
    );
    const freshFlipEntriesEnabled = areFreshFlipEntriesEnabled(config);
    const longContinuationEnabled = isLongContinuationEnabled(config);
    const shortContinuationEnabled = isShortContinuationEnabled(config);
    const shortingEnabled = isShortingEnabled(config);
    const currentCandle = resolvedCandles[idx];
    const previousCandle = resolvedCandles[idx - 1];
    const pending = pendingEntry;

    let signalType = "HOLD";
    let reason = `ST:${currentDir === 1 ? "🟢" : "🔴"} ADX:${adxVal.toFixed(
        1
    )} +DI:${pdiVal.toFixed(1)} -DI:${mdiVal.toFixed(1)} RSI:${rsiVal.toFixed(
        1
    )} ATR:${atrPips.toFixed(1)}pips`;
    let entryType = null;
    let reasonCode = "BASE_TREND_STATE";
    let signalClass = "INFO";
    let intent = "NONE";

    let pendingAction = "preserve";
    let nextPending = pending;

    const setPending = (value) => {
        pendingAction = "set";
        nextPending = value;
    };

    const clearPending = () => {
        pendingAction = "clear";
        nextPending = null;
    };

    const adxFilterEnabled = isAdxFilterEnabled(config);
    const rsiFilterEnabled = isRsiFilterEnabled(config);
    const longMomentumFloor = getLongMomentumFloor(config);
    const shortMomentumCeiling = getShortMomentumCeiling(config);
    const adxMeetsThreshold =
        !adxFilterEnabled || adxVal >= (config.minAdx || 22);
    const adxSlopeOk =
        !adxFilterEnabled || !config.adxSlopeFilter || adxRising;
    const adxOk = adxMeetsThreshold && adxSlopeOk;
    const longDiOk =
        !adxFilterEnabled ||
        config.requireDirectionalAdx === false ||
        pdiVal > mdiVal;
    const shortDiOk =
        !adxFilterEnabled ||
        config.requireDirectionalAdx === false ||
        mdiVal > pdiVal;
    const longBaseRegimeOk =
        adxMeetsThreshold &&
        longDiOk &&
        htfContext.longAllowed &&
        passesLongMomentum(config, rsiVal);
    const shortBaseRegimeOk =
        adxMeetsThreshold &&
        shortDiOk &&
        htfContext.shortAllowed &&
        passesShortMomentum(config, rsiVal);
    const freshLongEntryOk =
        longBaseRegimeOk &&
        adxSlopeOk &&
        passesFreshLongRsiCeiling(config, rsiVal);
    const freshShortEntryOk =
        shortingEnabled &&
        shortBaseRegimeOk &&
        adxSlopeOk &&
        passesFreshShortRsiFloor(config, rsiVal);

    if (prevDir === -1 && currentDir === 1) {
        if (pending && pending.direction === "SHORT") {
            clearPending();
        }

        if (freshFlipEntriesEnabled && freshLongEntryOk) {
            signalType = "BUY";
            entryType = "FRESH_FLIP";
            reasonCode = "LONG_FRESH_FLIP_ACTIONABLE";
            signalClass = "ACTIONABLE";
            intent = "ENTER_LONG";
            reason =
                `🚀 BUY: ST Flip GREEN | ADX ${adxVal.toFixed(1)}${
                    adxRising ? "↑" : "↓"
                } | ` +
                `+DI ${pdiVal.toFixed(1)} > -DI ${mdiVal.toFixed(1)} | RSI ${rsiVal.toFixed(
                    1
                )}`;
            clearPending();
        } else if (longContinuationEnabled && longBaseRegimeOk) {
            setPending(
                createPullbackSetup({
                    direction: "LONG",
                    flipTime: flipTimeMs,
                    flipPrice: flipCandlePrice,
                    flipAdx: adxVal,
                    flipRsi: rsiVal,
                    initialHigh: currentCandle.high,
                    initialLow: currentCandle.low,
                    signalCandleTime,
                })
            );
            reasonCode =
                !freshFlipEntriesEnabled && freshLongEntryOk
                    ? "LONG_FRESH_FLIP_CONTINUATION_ONLY"
                    : "LONG_FRESH_FLIP_PULLBACK_PENDING";
            signalClass = "PENDING";
            intent = "WAIT";
            reason = !freshFlipEntriesEnabled && freshLongEntryOk
                ? `HOLD: fresh long flip entries disabled | waiting for pullback continuation`
                : `HOLD: long trend valid but not chaseable | ` +
                  `ADX ${adxVal.toFixed(1)}${adxRising ? "↑" : "↓"} | RSI ${rsiVal.toFixed(
                      1
                  )} | waiting for pullback`;
        } else if (
            !htfContext.longAllowed &&
            adxMeetsThreshold &&
            longDiOk &&
            passesLongMomentum(config, rsiVal)
        ) {
            setPending(
                createHtfConfirmationSetup({
                    direction: "LONG",
                    flipTime: flipTimeMs,
                    flipPrice: flipCandlePrice,
                    flipAdx: adxVal,
                    flipRsi: rsiVal,
                    initialHigh: currentCandle.high,
                    initialLow: currentCandle.low,
                    signalCandleTime,
                })
            );
            reasonCode = "LONG_FRESH_FLIP_WAIT_HTF";
            signalClass = "PENDING";
            intent = "WAIT";
            reason = `HOLD: waiting for HTF confirmation (${htfContext.reason})`;
        } else if (!htfContext.longAllowed) {
            reasonCode = "LONG_FRESH_FLIP_BLOCKED_HTF";
            signalClass = "FILTERED";
            intent = "WAIT";
            reason = `HOLD: ST Flip blocked by ${htfContext.reason}`;
        } else if (adxFilterEnabled && !adxMeetsThreshold) {
            reasonCode = "LONG_FRESH_FLIP_BLOCKED_ADX";
            signalClass = "FILTERED";
            intent = "WAIT";
            reason = `HOLD: ST Flip blocked by weak ADX ${adxVal.toFixed(1)} < ${config.minAdx}`;
        } else if (adxFilterEnabled && !longDiOk) {
            reasonCode = "LONG_FRESH_FLIP_BLOCKED_DIRECTIONAL_ADX";
            signalClass = "FILTERED";
            intent = "WAIT";
            reason =
                `HOLD: ST Flip blocked by directional ADX (+DI ${pdiVal.toFixed(
                    1
                )} <= -DI ${mdiVal.toFixed(1)})`;
        } else if (rsiFilterEnabled && !passesLongMomentum(config, rsiVal)) {
            reasonCode = "LONG_FRESH_FLIP_BLOCKED_MOMENTUM";
            signalClass = "FILTERED";
            intent = "WAIT";
            reason =
                `HOLD: ST Flip blocked by weak momentum RSI ${rsiVal.toFixed(
                    1
                )} < ${longMomentumFloor}`;
        } else if (!freshFlipEntriesEnabled && freshLongEntryOk) {
            reasonCode = "LONG_FRESH_FLIP_DISABLED";
            signalClass = "FILTERED";
            intent = "WAIT";
            reason = "HOLD: fresh long flip entries disabled";
        } else {
            reasonCode = "LONG_FRESH_FLIP_FILTERED";
            signalClass = "FILTERED";
            intent = "WAIT";
            reason =
                `HOLD: ST Flip filtered | ADX ${adxVal.toFixed(1)} | ` +
                `+DI ${pdiVal.toFixed(1)} / -DI ${mdiVal.toFixed(1)} | RSI ${rsiVal.toFixed(
                    1
                )}`;
        }
    } else if (currentDir === 1 && pending && pending.direction === "LONG") {
        const evaluation =
            pending.state === "AWAIT_HTF_CONFIRMATION"
                ? evaluateLongHtfConfirmationSetup(config, {
                      pending,
                      signalCandleTime,
                      currentDir,
                      currentClose: currentCandle.close,
                      currentHigh: currentCandle.high,
                      currentLow: currentCandle.low,
                      adxMeetsThreshold,
                      adxOk,
                      longDiOk,
                      longBaseRegimeOk,
                      longContinuationEnabled,
                      htfContext,
                      rsiVal,
                      adxVal,
                      atrVal,
                      nowMs,
                  })
                : evaluateLongPullbackSetup(config, {
                      instrument,
                      pending,
                      signalCandleTime,
                      currentOpen: currentCandle.open,
                      currentClose: currentCandle.close,
                      currentHigh: currentCandle.high,
                      currentLow: currentCandle.low,
                      previousCandle,
                      atrVal,
                      rsiVal,
                      adxMeetsThreshold,
                      adxOk,
                      longDiOk,
                      htfContext,
                      nowMs,
                  });

        if (evaluation.clearPending) {
            clearPending();
        } else if (evaluation.pending) {
            setPending(evaluation.pending);
        }

        if (evaluation.signalType) {
            signalType = evaluation.signalType;
            entryType = evaluation.entryType;
            reason = evaluation.reason;
        } else {
            reason = evaluation.reason;
        }
        reasonCode = evaluation.reasonCode || reasonCode;
        signalClass = evaluation.signalClass || signalClass;
        intent = evaluation.intent || intent;
    } else if (prevDir === 1 && currentDir === -1) {
        signalType = "SELL";
        if (pending && pending.direction !== "SHORT") {
            clearPending();
        }

        if (!shortingEnabled) {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_SHORTING_DISABLED";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = "EXIT_ONLY: ST Flip RED (short entries disabled)";
            clearPending();
        } else if (freshFlipEntriesEnabled && freshShortEntryOk) {
            entryType = "SHORT_ENTRY";
            reasonCode = "SHORT_FRESH_FLIP_ACTIONABLE";
            signalClass = "ACTIONABLE";
            intent = "ENTER_SHORT";
            reason =
                `📉 SELL: ST Flip RED | ADX ${adxVal.toFixed(1)}${
                    adxRising ? "↑" : "↓"
                } | ` +
                `-DI ${mdiVal.toFixed(1)} > +DI ${pdiVal.toFixed(1)} | RSI ${rsiVal.toFixed(
                    1
                )}`;
            clearPending();
        } else if (
            !htfContext.shortAllowed &&
            adxMeetsThreshold &&
            shortDiOk &&
            passesShortMomentum(config, rsiVal)
        ) {
            setPending(
                createHtfConfirmationSetup({
                    direction: "SHORT",
                    flipTime: flipTimeMs,
                    flipPrice: flipCandlePrice,
                    flipAdx: adxVal,
                    flipRsi: rsiVal,
                    initialHigh: currentCandle.high,
                    initialLow: currentCandle.low,
                    signalCandleTime,
                })
            );
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_WAIT_HTF";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = `📉 EXIT: ST Flip RED (short waiting for HTF confirmation: ${htfContext.reason})`;
        } else if (shortContinuationEnabled && shortBaseRegimeOk) {
            setPending(
                createPullbackSetup({
                    direction: "SHORT",
                    flipTime: flipTimeMs,
                    flipPrice: flipCandlePrice,
                    flipAdx: adxVal,
                    flipRsi: rsiVal,
                    initialHigh: currentCandle.high,
                    initialLow: currentCandle.low,
                    signalCandleTime,
                })
            );
            entryType = "EXIT_ONLY";
            reasonCode =
                !freshFlipEntriesEnabled && freshShortEntryOk
                    ? "SHORT_FRESH_FLIP_CONTINUATION_ONLY"
                    : "SHORT_FRESH_FLIP_PULLBACK_PENDING";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = !freshFlipEntriesEnabled && freshShortEntryOk
                ? `EXIT_ONLY: fresh short flip entries disabled | waiting for pullback continuation`
                : `EXIT_ONLY: short trend valid but waiting for pullback | ` +
                  `ADX ${adxVal.toFixed(1)}${adxRising ? "↑" : "↓"} | RSI ${rsiVal.toFixed(
                      1
                  )}`;
        } else if (!htfContext.shortAllowed) {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_BLOCKED_HTF";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = `📉 EXIT: ST Flip RED (short blocked: ${htfContext.reason})`;
        } else if (adxFilterEnabled && !adxMeetsThreshold) {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_BLOCKED_ADX";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = `📉 EXIT: ST Flip RED (short blocked: ADX ${adxVal.toFixed(1)} < ${config.minAdx})`;
        } else if (adxFilterEnabled && !shortDiOk) {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_BLOCKED_DIRECTIONAL_ADX";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason =
                `📉 EXIT: ST Flip RED (short blocked: directional ADX -DI ${mdiVal.toFixed(
                    1
                )} <= +DI ${pdiVal.toFixed(1)})`;
        } else if (rsiFilterEnabled && !passesShortMomentum(config, rsiVal)) {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_BLOCKED_MOMENTUM";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason =
                `📉 EXIT: ST Flip RED (short blocked: momentum too strong RSI ${rsiVal.toFixed(
                    1
                )} > ${shortMomentumCeiling})`;
        } else if (!freshFlipEntriesEnabled && freshShortEntryOk) {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_DISABLED";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = "📉 EXIT: ST Flip RED (fresh short entries disabled)";
        } else {
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_FRESH_FLIP_FILTERED";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason =
                `📉 EXIT: ST Flip RED (short filtered | ADX ${adxVal.toFixed(1)} | ` +
                `+DI ${pdiVal.toFixed(1)} / -DI ${mdiVal.toFixed(1)} | RSI ${rsiVal.toFixed(
                    1
                )})`;
        }
    } else if (currentDir === -1 && pending && pending.direction === "SHORT") {
        if (!shortingEnabled) {
            signalType = "SELL";
            entryType = "EXIT_ONLY";
            reasonCode = "SHORT_PENDING_SHORTING_DISABLED";
            signalClass = "EXIT_ONLY";
            intent = "EXIT_LONG_ONLY";
            reason = "EXIT_ONLY: short setup cleared because short entries are disabled";
            clearPending();
        } else {
            const evaluation =
                pending.state === "AWAIT_HTF_CONFIRMATION"
                    ? evaluateShortHtfConfirmationSetup(config, {
                          pending,
                          signalCandleTime,
                          currentDir,
                          currentClose: currentCandle.close,
                          currentHigh: currentCandle.high,
                          currentLow: currentCandle.low,
                          adxMeetsThreshold,
                          adxOk,
                          shortDiOk,
                          shortBaseRegimeOk,
                          shortContinuationEnabled,
                          htfContext,
                          rsiVal,
                          adxVal,
                          atrVal,
                          nowMs,
                      })
                    : evaluateShortPullbackSetup(config, {
                          instrument,
                          pending,
                          signalCandleTime,
                          currentOpen: currentCandle.open,
                          currentClose: currentCandle.close,
                          currentHigh: currentCandle.high,
                          currentLow: currentCandle.low,
                          previousCandle,
                          atrVal,
                          rsiVal,
                          adxMeetsThreshold,
                          adxOk,
                          shortDiOk,
                          htfContext,
                          nowMs,
                      });

            if (evaluation.clearPending) {
                clearPending();
            } else if (evaluation.pending) {
                setPending(evaluation.pending);
            }

            if (evaluation.signalType) {
                signalType = evaluation.signalType;
                entryType = evaluation.entryType;
                reason = evaluation.reason;
            } else {
                signalType =
                    pending.state === "AWAIT_HTF_CONFIRMATION" ? "HOLD" : "SELL";
                entryType =
                    pending.state === "AWAIT_HTF_CONFIRMATION" ? null : "EXIT_ONLY";
                reason = evaluation.reason;
            }
            reasonCode = evaluation.reasonCode || reasonCode;
            signalClass =
                evaluation.signalClass ||
                (signalType === "SELL" && entryType === "EXIT_ONLY"
                    ? "EXIT_ONLY"
                    : signalClass);
            intent = evaluation.intent || intent;
        }
    }

    const expectedEdge =
        signalClass === "ACTIONABLE" &&
        (signalType === "BUY" || signalType === "SELL")
            ? calculateExpectedEdge({
                  entryPrice: currentPrice,
                  stopPips: estimateSupertrendStopPips(config, atrPips),
                  targetPips: estimateSupertrendTargetPips(
                      config,
                      estimateSupertrendStopPips(config, atrPips)
                  ),
                  pipValue,
                  spreadPips,
                  slippagePips: config.expectedSlippagePips,
                  minNetEdgePips: config.minNetEdgePips,
              })
            : null;
    const strategyContext = buildSupertrendStrategyContext({
        signalType,
        entryType,
        currentPrice,
        atrPips,
        rsiVal,
        adxVal,
        pdiVal,
        mdiVal,
        currentDir,
        prevDir,
        htfContext,
        freshFlipEntriesEnabled,
        longContinuationEnabled,
        shortContinuationEnabled,
        spreadPips,
        expectedEdge,
    });

    return {
        signalType,
        reason,
        reasonCode,
        signalClass,
        intent,
        entryType,
        signalCandleTime,
        atrVal,
        atrPips,
        currentPrice,
        rsiVal,
        adxVal,
        pdiVal,
        mdiVal,
        adxRising,
        prevAdxVal,
        currentDir,
        prevDir,
        htfContext,
        pendingAction,
        pending: nextPending || null,
        expectedEdge,
        strategyContext,
    };
}

const supertrendMomentumStrategy = createStrategyDefinition({
    key: "supertrend_momentum",
    label: "SuperTrend Momentum",
    description:
        "Canonical live baseline using SuperTrend, ADX, RSI, ATR, and optional HTF confirmation.",
    phaseIntroduced: 1,
    runtimeStatus: "baseline",
    requiredData: {
        timeframes: ["15m", "1h"],
        marketData: ["candles", "price", "session"],
        indicators: ["supertrend", "adx", "rsi", "atr"],
    },
    metadata: {
        supportsLive: true,
        supportsShadow: true,
        supportsCandidate: true,
    },
    evaluateEntry: evaluateSupertrendMomentumEntry,
});

module.exports = supertrendMomentumStrategy;
