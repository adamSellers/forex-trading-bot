// backend/src/services/signalGenerator.js - Forex SuperTrend + ADX Signal Generator
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { RSI, ADX, ATR } = require("technicalindicators");
const { calculateSuperTrend } = require("../utils/indicators");
const { computeConfigHash } = require("../config/tradingConfig");
const { getStrategyDefinition } = require("../strategies");
const {
    resolveSupertrendPeriod,
    resolveSupertrendMultiplier,
} = require("../config/supertrendParams");

class SignalGenerator extends EventEmitter {
    constructor(config = {}, signalRepository = null) {
        super();
        this.isRunning = false;
        this.signalInterval = null;
        this.dataService = null;
        this.signalRepo = signalRepository;
        this.latestSignals = [];

        this.config = {
            strategy: "supertrend_momentum",
            timeframe: "15m",
            signalCooldown: 60000,
            assets: [],

            // Forex default ADX threshold
            enableAdxFilter: true,
            minAdx: 22,
            maxRegimeAdx: 25,
            adxSlopeFilter: true, // Only enter when ADX is rising
            adxSlopeLookback: 3, // Compare current ADX vs N bars ago
            requireDirectionalAdx: true,
            enableRsiFilter: true,
            longRsiMomentumFloor: 52,
            shortRsiMomentumCeiling: 48,
            freshLongRsiCeiling: 68,
            rsiOverbought: 75,
            rsiOversold: 30,
            supertrendPeriod: 10,
            supertrendMultiplier: 3,
            atrPeriod: 10,
            factor: 3, // SuperTrend multiplier

            // Continuation entry settings
            enableContinuationEntry: true,
            enableLongContinuationEntry: true,
            enableShortContinuationEntry: false,
            continuationWindowMs: 4 * 60 * 60 * 1000, // 4 hours
            continuationRsiThreshold: 70,
            continuationMaxPriceDeviation: 0.005, // 0.5% default for forex continuation entries
            continuationPullbackMinAtr: 0.5,
            continuationPullbackMaxAtr: 1.5,

            // Higher-timeframe trend filter
            enableHTFFilter: true,
            htfTimeframe: "1h",

            ...config,
        };
        this.config.atrPeriod = resolveSupertrendPeriod(this.config);
        this.config.factor = resolveSupertrendMultiplier(this.config);
        this.config.supertrendPeriod = this.config.atrPeriod;
        this.config.supertrendMultiplier = this.config.factor;

        this.lastSignals = new Map();
        this._pendingEntries = new Map();

        logger.info(
            `ðŸ§  Signal Generator v4.5 (Forex) Initialized. ` +
                `ADX Threshold: ${this.config.minAdx}, ` +
                `Continuation: ${
                    this.config.enableContinuationEntry ? "ON" : "OFF"
                }`
        );
    }

    start(dataService, intervalMs = 60000) {
        if (this.isRunning) return;
        this.dataService = dataService;
        this.isRunning = true;
        this.generateSignalCycle();
        this.signalInterval = setInterval(() => {
            if (this.isRunning) this.generateSignalCycle();
        }, intervalMs);
        logger.info(
            `ðŸš€ Signal Generator Loop Started (${intervalMs}ms interval)`
        );
    }

    stop() {
        this.isRunning = false;
        if (this.signalInterval) clearInterval(this.signalInterval);
        this.emit("generatorStopped");
        logger.info("â¹ï¸ Signal Generator stopped");
    }

    async generateSignalCycle() {
        if (!this.dataService) return;
        try {
            const signals = await this.generateAllSignals(this.dataService);
            this.latestSignals = signals;

            if (signals.length > 0) {
                this.emit("allSignalsGenerated", signals);
                signals.forEach((s) => this.emit("signalGenerated", s));

                // Persist signals to database for analytics
                if (this.signalRepo) {
                    await this.signalRepo.saveBatch(signals);
                }
            }
        } catch (error) {
            logger.error("âŒ Signal Cycle Error:", error);
        }
    }

    /**
     * Calculate SuperTrend indicator.
     * Delegates to the shared indicators module so runtime math stays centralized.
     */
    calculateSuperTrend(highs, lows, closes, period = 10, factor = 3) {
        return calculateSuperTrend(highs, lows, closes, period, factor);
    }

    getCandleTimestampMs(candleTime) {
        if (typeof candleTime === "number") {
            return candleTime > 1e12 ? candleTime : candleTime * 1000;
        }

        const parsed = Date.parse(candleTime);
        return Number.isFinite(parsed) ? parsed : Date.now();
    }

    createSetupId(instrument, direction, signalCandleTime, entryType = null) {
        return [
            instrument,
            direction || "UNKNOWN",
            this.getCandleTimestampMs(signalCandleTime),
            entryType || "BASE",
        ].join(":");
    }

    createPendingSnapshot(pending) {
        if (!pending) return null;

        const ageMs = Math.max(0, Date.now() - (pending.flipTime || Date.now()));

        return {
            direction: pending.direction || null,
            state: pending.state || null,
            waitingFor: pending.waitingFor || null,
            flipTime: pending.flipTime || null,
            flipPrice: pending.flipPrice || null,
            flipAdx: pending.flipAdx || null,
            flipRsi: pending.flipRsi || null,
            peakPrice: pending.peakPrice ?? null,
            troughPrice: pending.troughPrice ?? null,
            pullbackLow: pending.pullbackLow ?? null,
            pullbackHigh: pending.pullbackHigh ?? null,
            pullbackDepthAtr: pending.pullbackDepthAtr ?? null,
            reaccelerationTrigger: pending.reaccelerationTrigger ?? null,
            pullbackDetectedTime: pending.pullbackDetectedTime ?? null,
            signalCandleTime: pending.signalCandleTime ?? null,
            ageMs,
            ageMinutes: Math.round(ageMs / 60000),
        };
    }

    createDecisionContext({
        currentDir,
        prevDir,
        adxVal,
        adxRising,
        prevAdxVal,
        pdiVal,
        mdiVal,
        rsiVal,
        atrVal,
        atrPips,
        htfContext,
        pending,
        currentPrice,
    }) {
        return {
            currentDirection: currentDir,
            previousDirection: prevDir,
            currentPrice,
            adx: adxVal,
            adxRising,
            previousAdx: prevAdxVal,
            pdi: pdiVal,
            mdi: mdiVal,
            rsi: rsiVal,
            atr: atrVal,
            atrPips,
            htf: htfContext
                ? {
                      enabled: htfContext.enabled,
                      timeframe: htfContext.timeframe,
                      direction: htfContext.direction,
                      longAllowed: htfContext.longAllowed,
                      shortAllowed: htfContext.shortAllowed,
                      reason: htfContext.reason || null,
                  }
                : null,
            pending: this.createPendingSnapshot(pending),
        };
    }

    buildSignalPayload({
        instrument,
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
        pending,
        tradePlan = null,
        expectedEdge = null,
        strategyContext = null,
        strategyVersion = null,
    }) {
        const safeHtfContext = htfContext || {
            enabled: false,
            timeframe: null,
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason: null,
        };
        const pendingSnapshot = this.createPendingSnapshot(pending);
        const setupDirection =
            signalType === "BUY"
                ? "LONG"
                : signalType === "SELL" && entryType !== "EXIT_ONLY"
                ? "SHORT"
                : pendingSnapshot?.direction || (currentDir === 1 ? "LONG" : "SHORT");
        const setupId = this.createSetupId(
            instrument,
            setupDirection,
            pendingSnapshot?.flipTime || signalCandleTime,
            entryType
        );
        const configHash = computeConfigHash(this.config);
        const decisionContext = this.createDecisionContext({
            currentDir,
            prevDir,
            adxVal,
            adxRising,
            prevAdxVal,
            pdiVal,
            mdiVal,
            rsiVal,
            atrVal,
            atrPips,
            htfContext: safeHtfContext,
            pending,
            currentPrice,
        });

        if (strategyContext) {
            decisionContext.strategyContext = strategyContext;
        }
        if (expectedEdge) {
            decisionContext.expectedEdge = expectedEdge;
        }

        return {
            symbol: instrument,
            signal: signalType,
            strength: adxVal,
            message: reason,
            reasonCode,
            signalClass,
            intent,
            setupId,
            uniqueEvent: true,
            cooldownSuppressed: false,
            timestamp: Date.now(),
            signalCandleTime: this.getCandleTimestampMs(signalCandleTime),
            atr: atrVal,
            atrPips: atrPips,
            currentPrice: currentPrice,
            entryType,
            strategy: this.config.strategy || "supertrend_momentum",
            strategyVersion,
            timeframe: this.config.timeframe || "15m",
            configHash,
            decisionContext,

            trend: {
                currentPrice,
                rsi: rsiVal,
                adx: adxVal,
                pdi: pdiVal,
                mdi: mdiVal,
                adxRising: adxRising,
                adxPrev: prevAdxVal,
                supertrend_direction: currentDir,
                atrPips: atrPips,
                htfDirection: safeHtfContext.direction,
                htfTimeframe: safeHtfContext.timeframe,
            },

            data: {
                currentPrice,
                rsi: rsiVal,
                adx: adxVal,
                pdi: pdiVal,
                mdi: mdiVal,
                adxRising: adxRising,
                adxPrev: prevAdxVal,
                stDirection: currentDir,
                atrPips: atrPips,
                htfDirection: safeHtfContext.direction,
                htfTimeframe: safeHtfContext.timeframe,
            },

            pendingState: pendingSnapshot,
            pendingEntry: pendingSnapshot
                ? {
                      flipTime: pendingSnapshot.flipTime,
                      flipPrice: pendingSnapshot.flipPrice,
                      flipAdx: pendingSnapshot.flipAdx,
                      flipRsi: pendingSnapshot.flipRsi,
                      state: pendingSnapshot.state,
                      waitingFor: pendingSnapshot.waitingFor,
                      direction: pendingSnapshot.direction,
                      pullbackDepthAtr: pendingSnapshot.pullbackDepthAtr,
                      reaccelerationTrigger:
                          pendingSnapshot.reaccelerationTrigger,
                      ageMinutes: pendingSnapshot.ageMinutes,
                  }
                : null,
            tradePlan,
            expectedEdge,
            strategyContext,
        };
    }

    isLongContinuationEnabled() {
        if (this.config.enableContinuationEntry === false) return false;
        return this.config.enableLongContinuationEntry !== false;
    }

    isAdxFilterEnabled() {
        return this.config.enableAdxFilter !== false;
    }

    isRsiFilterEnabled() {
        return this.config.enableRsiFilter !== false;
    }

    getLongMomentumFloor() {
        return this.config.longRsiMomentumFloor ?? 52;
    }

    getShortMomentumCeiling() {
        return this.config.shortRsiMomentumCeiling ?? 50;
    }

    getFreshLongRsiCeiling() {
        return (
            this.config.freshLongRsiCeiling ??
            this.config.rsiOverbought ??
            75
        );
    }

    passesLongMomentum(rsiVal) {
        return !this.isRsiFilterEnabled() || rsiVal >= this.getLongMomentumFloor();
    }

    passesShortMomentum(rsiVal) {
        return (
            !this.isRsiFilterEnabled() || rsiVal <= this.getShortMomentumCeiling()
        );
    }

    passesFreshLongRsiCeiling(rsiVal) {
        return !this.isRsiFilterEnabled() || rsiVal < this.getFreshLongRsiCeiling();
    }

    passesLongOverboughtCeiling(rsiVal) {
        return !this.isRsiFilterEnabled() || rsiVal < (this.config.rsiOverbought ?? 75);
    }

    passesFreshShortRsiFloor(rsiVal) {
        return !this.isRsiFilterEnabled() || rsiVal > (this.config.rsiOversold ?? 30);
    }

    isShortContinuationEnabled() {
        if (this.config.enableContinuationEntry === false) return false;
        return this.config.enableShortContinuationEntry !== false;
    }

    getHtfTrendContext(instrument) {
        if (!this.config.enableHTFFilter) {
            return {
                enabled: false,
                timeframe: null,
                direction: 0,
                longAllowed: true,
                shortAllowed: true,
            };
        }

        const timeframe = this.config.htfTimeframe || "1h";
        const candles = this.dataService?.getCandles?.(instrument, timeframe) || [];
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

        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);
        const closes = candles.map((c) => c.close);
        const stData = this.calculateSuperTrend(
            highs,
            lows,
            closes,
            resolveSupertrendPeriod(this.config),
            resolveSupertrendMultiplier(this.config)
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

    createPullbackSetup({
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

    createHtfConfirmationSetup({
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

    createImmediatePullbackSetup({
        direction,
        currentTime,
        currentPrice,
        currentAdx,
        currentRsi,
        currentHigh,
        currentLow,
        signalCandleTime,
    }) {
        return this.createPullbackSetup({
            direction,
            flipTime: currentTime,
            flipPrice: currentPrice,
            flipAdx: currentAdx,
            flipRsi: currentRsi,
            initialHigh: currentHigh,
            initialLow: currentLow,
            signalCandleTime,
        });
    }

    evaluateLongHtfConfirmationSetup({
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
    }) {
        const ageMs = Date.now() - pending.flipTime;
        const maxAgeMs =
            this.config.continuationWindowMs || 4 * 60 * 60 * 1000;
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
                !this.passesLongMomentum(rsiVal)
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

        const maxDeviation =
            this.config.continuationMaxPriceDeviation || 0.005;
        const priceDeviation =
            pending.flipPrice > 0
                ? Math.max(
                      0,
                      (currentClose - pending.flipPrice) / pending.flipPrice
                  )
                : 0;
        const isChaseable = priceDeviation <= maxDeviation;

        if (adxOk && this.passesLongOverboughtCeiling(rsiVal) && isChaseable) {
            return {
                signalType: "BUY",
                entryType: "HTF_CONFIRMATION",
                clearPending: true,
                reason:
                    `BUY: HTF confirmed after M15 flip | ` +
                    `deviation ${(priceDeviation * 100).toFixed(2)}% | ADX ${adxVal.toFixed(
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
                    ...this.createPullbackSetup({
                        direction: "LONG",
                        flipTime: pending.flipTime,
                        flipPrice: pending.flipPrice,
                        flipAdx: pending.flipAdx,
                        flipRsi: pending.flipRsi,
                        initialHigh: updatedPeakPrice,
                        initialLow: currentLow,
                        signalCandleTime:
                            pending.signalCandleTime || signalCandleTime,
                    }),
                    peakPrice: updatedPeakPrice,
                },
                reason:
                    `HOLD: HTF confirmed but move extended | ` +
                    `deviation ${(priceDeviation * 100).toFixed(2)}% | waiting for pullback`,
                reasonCode: "LONG_HTF_CONFIRMED_PULLBACK",
                signalClass: "PENDING",
                intent: "WAIT",
            };
        }

        return {
            clearPending: true,
            reason:
                `HOLD: HTF confirmed but entry not chaseable (${(
                    priceDeviation * 100
                ).toFixed(2)}%)`,
            reasonCode: "LONG_HTF_CONFIRMED_NOT_CHASEABLE",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    evaluateShortHtfConfirmationSetup({
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
    }) {
        const ageMs = Date.now() - pending.flipTime;
        const maxAgeMs =
            this.config.continuationWindowMs || 4 * 60 * 60 * 1000;
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
                !this.passesShortMomentum(rsiVal)
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

        const maxDeviation =
            this.config.continuationMaxPriceDeviation || 0.005;
        const priceDeviation =
            pending.flipPrice > 0
                ? Math.max(
                      0,
                      (pending.flipPrice - currentClose) / pending.flipPrice
                  )
                : 0;
        const isChaseable = priceDeviation <= maxDeviation;

        if (adxOk && this.passesFreshShortRsiFloor(rsiVal) && isChaseable) {
            return {
                signalType: "SELL",
                entryType: "SHORT_HTF_CONFIRMATION",
                clearPending: true,
                reason:
                    `SELL: HTF confirmed after M15 flip | ` +
                    `deviation ${(priceDeviation * 100).toFixed(2)}% | ADX ${adxVal.toFixed(
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
                    ...this.createPullbackSetup({
                        direction: "SHORT",
                        flipTime: pending.flipTime,
                        flipPrice: pending.flipPrice,
                        flipAdx: pending.flipAdx,
                        flipRsi: pending.flipRsi,
                        initialHigh: currentHigh,
                        initialLow: updatedTroughPrice,
                        signalCandleTime:
                            pending.signalCandleTime || signalCandleTime,
                    }),
                    troughPrice: updatedTroughPrice,
                },
                reason:
                    `HOLD: HTF confirmed but move extended | ` +
                    `deviation ${(priceDeviation * 100).toFixed(2)}% | waiting for pullback`,
                reasonCode: "SHORT_HTF_CONFIRMED_PULLBACK",
                signalClass: "PENDING",
                intent: "WAIT",
            };
        }

        return {
            clearPending: true,
            reason:
                `HOLD: HTF confirmed but entry not chaseable (${(
                    priceDeviation * 100
                ).toFixed(2)}%)`,
            reasonCode: "SHORT_HTF_CONFIRMED_NOT_CHASEABLE",
            signalClass: "FILTERED",
            intent: "WAIT",
        };
    }

    evaluateLongPullbackSetup({
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
    }) {
        const ageMs = Date.now() - pending.flipTime;
        const maxAgeMs =
            this.config.continuationWindowMs || 4 * 60 * 60 * 1000;
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

        const minPullbackAtr = this.config.continuationPullbackMinAtr || 0.5;
        const maxPullbackAtr = this.config.continuationPullbackMaxAtr || 1.5;
        const trackedPeakPrice =
            pending.state === "AWAIT_PULLBACK"
                ? Math.max(pending.peakPrice || pending.flipPrice, currentHigh)
                : pending.peakPrice || pending.flipPrice;
        const pullbackDepthAtr =
            atrVal > 0 ? (trackedPeakPrice - currentLow) / atrVal : 0;
        const bearishPullbackCandle =
            currentClose < previousCandle.close ||
            currentLow < previousCandle.low;
        const rsiCooled =
            rsiVal <= (this.config.continuationRsiThreshold || 70);

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

            if (bearishPullbackCandle && pullbackDepthAtr >= minPullbackAtr && rsiCooled) {
                const nextPending = {
                    ...pending,
                    state: "AWAIT_REACCELERATION",
                    waitingFor: "REACCELERATION",
                    peakPrice: trackedPeakPrice,
                    pullbackLow: currentLow,
                    pullbackHigh: currentHigh,
                    pullbackDepthAtr,
                    reaccelerationTrigger: currentHigh,
                    pullbackDetectedTime:
                        this.getCandleTimestampMs(signalCandleTime),
                };

                return {
                    pending: nextPending,
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
            pending.reaccelerationTrigger ||
            pending.pullbackHigh ||
            previousCandle.high;
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
            this.passesLongMomentum(rsiVal) &&
            this.passesLongOverboughtCeiling(rsiVal) &&
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

    evaluateShortPullbackSetup({
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
    }) {
        const ageMs = Date.now() - pending.flipTime;
        const maxAgeMs =
            this.config.continuationWindowMs || 4 * 60 * 60 * 1000;
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

        const minPullbackAtr = this.config.continuationPullbackMinAtr || 0.5;
        const maxPullbackAtr = this.config.continuationPullbackMaxAtr || 1.5;
        const trackedTroughPrice =
            pending.state === "AWAIT_PULLBACK"
                ? Math.min(pending.troughPrice || pending.flipPrice, currentLow)
                : pending.troughPrice || pending.flipPrice;
        const pullbackDepthAtr =
            atrVal > 0 ? (currentHigh - trackedTroughPrice) / atrVal : 0;
        const bullishPullbackCandle =
            currentClose > previousCandle.close ||
            currentHigh > previousCandle.high;
        const rsiRecovered =
            !this.isRsiFilterEnabled() ||
            rsiVal >= this.getShortMomentumCeiling();

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

            if (bullishPullbackCandle && pullbackDepthAtr >= minPullbackAtr && rsiRecovered) {
                const nextPending = {
                    ...pending,
                    state: "AWAIT_REACCELERATION",
                    waitingFor: "REACCELERATION",
                    troughPrice: trackedTroughPrice,
                    pullbackLow: currentLow,
                    pullbackHigh: currentHigh,
                    pullbackDepthAtr,
                    reaccelerationTrigger: currentLow,
                    pullbackDetectedTime:
                        this.getCandleTimestampMs(signalCandleTime),
                };

                return {
                    pending: nextPending,
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
            pending.reaccelerationTrigger ||
            pending.pullbackLow ||
            previousCandle.low;
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
            this.passesShortMomentum(rsiVal) &&
            this.passesFreshShortRsiFloor(rsiVal) &&
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

    async generateSignal(instrument, candles, currentPrice, options = {}) {
        try {
            if (!candles || candles.length < 200) {
                return {
                    symbol: instrument,
                    signal: "HOLD",
                    strength: 0,
                    message: "Insufficient data",
                    reasonCode: "INSUFFICIENT_DATA",
                    signalClass: "FILTERED",
                    intent: "WAIT",
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                    configHash: computeConfigHash(this.config),
                    timestamp: Date.now(),
                };
            }

            const strategyDefinition = getStrategyDefinition(
                this.config.strategy || "supertrend_momentum"
            );
            const evaluation =
                await strategyDefinition.evaluateEntry({
                    instrument,
                    candles,
                    currentPrice,
                    config: this.config,
                    dataService: this.dataService,
                    pendingEntry: this._pendingEntries.get(instrument) || null,
                    calculateSuperTrendFn: this.calculateSuperTrend.bind(this),
                    getHtfTrendContextFn: this.getHtfTrendContext.bind(this),
                    marketContext: options.marketContext || null,
                    nowMs:
                        options.nowMs ??
                        this.getCandleTimestampMs(candles[candles.length - 1]?.time),
                });

            if (evaluation.pendingAction === "clear") {
                this._pendingEntries.delete(instrument);
            } else if (evaluation.pendingAction === "set") {
                this._pendingEntries.set(instrument, evaluation.pending);
            }

            return this.buildSignalPayload({
                instrument,
                signalType: evaluation.signalType,
                reason: evaluation.reason,
                reasonCode: evaluation.reasonCode,
                signalClass: evaluation.signalClass,
                intent: evaluation.intent,
                entryType: evaluation.entryType,
                signalCandleTime: evaluation.signalCandleTime,
                atrVal: evaluation.atrVal,
                atrPips: evaluation.atrPips,
                currentPrice,
                rsiVal: evaluation.rsiVal,
                adxVal: evaluation.adxVal,
                pdiVal: evaluation.pdiVal,
                mdiVal: evaluation.mdiVal,
                adxRising: evaluation.adxRising,
                prevAdxVal: evaluation.prevAdxVal,
                currentDir: evaluation.currentDir,
                prevDir: evaluation.prevDir,
                htfContext: evaluation.htfContext,
                pending:
                    evaluation.pendingAction === "clear"
                        ? null
                        : evaluation.pending,
                tradePlan: evaluation.tradePlan || null,
                expectedEdge: evaluation.expectedEdge || null,
                strategyContext: evaluation.strategyContext || null,
                strategyVersion: strategyDefinition.version,
            });
        } catch (error) {
            logger.error(
                `âŒ Signal calculation error for ${instrument}:`,
                error.message
            );
            return null;
        }
    }

    validateSignal(signal) {
        if (!signal) return null;
        const key = `${signal.symbol}_${signal.signal}`;
        const now = Date.now();
        const lastEntry = this.lastSignals.get(key);
        const lastMeta =
            typeof lastEntry === "number"
                ? { time: lastEntry, signalCandleTime: null, entryType: null }
                : lastEntry || { time: 0, signalCandleTime: null, entryType: null };
        const signalCandleTime = signal.signalCandleTime || null;

        // Rate limit active signals
        if (signal.signal === "BUY" || signal.signal === "SELL") {
            if (
                signalCandleTime &&
                lastMeta.signalCandleTime === signalCandleTime &&
                lastMeta.entryType === (signal.entryType || null)
            ) {
                return {
                    ...signal,
                    signal: "COOLDOWN",
                    message: "Signal already emitted for this candle",
                    reasonCode: "COOLDOWN_DUPLICATE_CANDLE",
                    signalClass: "COOLDOWN",
                    uniqueEvent: false,
                    cooldownSuppressed: true,
                    decisionContext: {
                        ...(signal.decisionContext || {}),
                        originalSignal: signal.signal,
                        originalEntryType: signal.entryType || null,
                        originalReasonCode: signal.reasonCode || null,
                    },
                };
            }

            if (now - (lastMeta.time || 0) < this.config.signalCooldown) {
                return {
                    ...signal,
                    signal: "COOLDOWN",
                    message: "Signal Spam Filter",
                    reasonCode: "COOLDOWN_RATE_LIMIT",
                    signalClass: "COOLDOWN",
                    uniqueEvent: false,
                    cooldownSuppressed: true,
                    decisionContext: {
                        ...(signal.decisionContext || {}),
                        originalSignal: signal.signal,
                        originalEntryType: signal.entryType || null,
                        originalReasonCode: signal.reasonCode || null,
                    },
                };
            }
        }

        if (signal.signal === "BUY" || signal.signal === "SELL") {
            this.lastSignals.set(key, {
                time: now,
                signalCandleTime,
                entryType: signal.entryType || null,
            });
        }
        return signal;
    }

    async generateAllSignals(dataService) {
        this.dataService = dataService;
        const signals = [];
        for (const instrument of this.config.assets) {
            try {
                const tf = this.config.timeframe || "15m";
                const candles = dataService.getCandles(instrument, tf);
                const priceData = dataService.getCurrentPrice(instrument);

                if (candles.length && priceData) {
                    let signal = await this.generateSignal(
                        instrument,
                        candles,
                        priceData.price
                    );

                    if (signal) {
                        signal.timeframe = tf;
                        signal = this.validateSignal(signal);
                        if (signal) signals.push(signal);
                    }
                }
            } catch (err) {
                logger.error(
                    `Signal generation error for ${instrument}:`,
                    err.message
                );
            }
        }
        return signals;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.config.atrPeriod = resolveSupertrendPeriod(this.config);
        this.config.factor = resolveSupertrendMultiplier(this.config);
        this.config.supertrendPeriod = this.config.atrPeriod;
        this.config.supertrendMultiplier = this.config.factor;
        logger.info(
            `ðŸ”„ Signal Generator config updated. ADX threshold: ${this.config.minAdx}`
        );
    }

    getStatus() {
        return {
            isActive: this.isRunning,
            config: this.config,
            activeSignals: this.latestSignals || [],
            pendingEntries: Array.from(this._pendingEntries.entries()).map(
                ([symbol, data]) => ({
                    symbol,
                    flipTime: data.flipTime,
                    flipPrice: data.flipPrice,
                    flipAdx: data.flipAdx,
                    flipRsi: data.flipRsi,
                    state: data.state || "UNKNOWN",
                    waitingFor: data.waitingFor || "UNKNOWN",
                    direction: data.direction || "UNKNOWN",
                    pullbackDepthAtr: data.pullbackDepthAtr ?? null,
                    reaccelerationTrigger: data.reaccelerationTrigger ?? null,
                    ageMinutes: ((Date.now() - data.flipTime) / 60000).toFixed(
                        0
                    ),
                })
            ),
        };
    }

    reset() {
        this.lastSignals.clear();
        this.latestSignals = [];
        this._pendingEntries.clear();
        logger.info("ðŸ”„ Signal Generator reset. Pending entries cleared.");
    }

    clearPendingEntries() {
        const count = this._pendingEntries.size;
        this._pendingEntries.clear();
        logger.info(`ðŸ§¹ Cleared ${count} pending entries.`);
        return count;
    }
}

module.exports = SignalGenerator;
