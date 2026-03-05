// backend/src/services/signalGenerator.js - Forex SuperTrend + ADX Signal Generator
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { RSI, ADX, ATR } = require("technicalindicators");
const { calculateSuperTrend } = require("../utils/indicators");

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
            minAdx: 22,
            adxSlopeFilter: true, // Only enter when ADX is rising
            adxSlopeLookback: 3, // Compare current ADX vs N bars ago
            rsiOverbought: 75,
            rsiOversold: 30,
            atrPeriod: 10,
            factor: 3, // SuperTrend multiplier

            // Continuation entry settings
            enableContinuationEntry: true,
            continuationWindowMs: 4 * 60 * 60 * 1000, // 4 hours
            continuationRsiThreshold: 70,
            continuationMaxPriceDeviation: 0.005, // 0.5% default for forex continuation entries

            ...config,
        };

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
     * Calculate SuperTrend indicator
     * Delegates to shared indicators module for reuse by backtester
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

    async generateSignal(instrument, candles, currentPrice) {
        try {
            if (!candles || candles.length < 200) {
                return {
                    symbol: instrument,
                    signal: "HOLD",
                    strength: 0,
                    message: "Insufficient data",
                    timestamp: Date.now(),
                };
            }

            const highs = candles.map((c) => c.high);
            const lows = candles.map((c) => c.low);
            const closes = candles.map((c) => c.close);

            // 1. Calculate Indicators
            const stData = this.calculateSuperTrend(
                highs,
                lows,
                closes,
                this.config.atrPeriod || 10,
                this.config.factor || 3
            );

            const idx = closes.length - 1;
            const currentDir = stData.direction[idx];
            const prevDir = stData.direction[idx - 1];
            const signalCandleTime = candles[idx]?.time || null;
            const flipCandlePrice = closes[idx];
            const flipTimeMs = this.getCandleTimestampMs(signalCandleTime);

            const rsiVal = RSI.calculate({ values: closes, period: 14 }).pop();
            const adxResults = ADX.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14,
            });
            const adxResult = adxResults[adxResults.length - 1];
            const adxVal = adxResult?.adx || 0;

            // ADX Slope calculation: compare current ADX to ADX from N bars ago
            const lookback = this.config.adxSlopeLookback || 3;
            const lookbackIdx = adxResults.length - 1 - lookback;
            const prevAdxResult = lookbackIdx >= 0 ? adxResults[lookbackIdx] : null;
            const prevAdxVal = prevAdxResult?.adx || adxVal;
            const adxRising = adxVal > prevAdxVal;

            const atrVal = ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14,
            }).pop();

            // Convert ATR to pips for Forex
            const pipValue =
                this.dataService?.getPipValue?.(instrument) || 0.0001;
            const atrPips = atrVal / pipValue;

            // 2. Base state
            let signalType = "HOLD";
            let reason = `ST:${
                currentDir === 1 ? "ðŸŸ¢" : "ðŸ”´"
            } ADX:${adxVal.toFixed(1)} RSI:${rsiVal.toFixed(
                1
            )} ATR:${atrPips.toFixed(1)}pips`;
            let entryType = null;

            const adxMeetsThreshold = adxVal >= (this.config.minAdx || 22);
            const adxSlopeOk = !this.config.adxSlopeFilter || adxRising;
            const adxOk = adxMeetsThreshold && adxSlopeOk;
            const rsiOkForFresh = rsiVal < (this.config.rsiOverbought || 75);
            const rsiOkForContinuation =
                rsiVal < (this.config.continuationRsiThreshold || 70);
            // SHORT entry RSI check: not oversold (inverse of overbought for longs)
            const rsiOkForShort = rsiVal > (this.config.rsiOversold || 30);
            const rsiOkForShortContinuation = rsiVal > ((this.config.rsiOversold || 30) + 5); // 35 default

            // 3. PRIMARY ENTRY: Fresh SuperTrend Flip (RED â†’ GREEN)
            if (prevDir === -1 && currentDir === 1) {
                // Clear any pending SHORT entries on direction change
                const existingPending = this._pendingEntries.get(instrument);
                if (existingPending && existingPending.direction === "SHORT") {
                    this._pendingEntries.delete(instrument);
                }

                if (adxOk && rsiOkForFresh) {
                    // All conditions met - immediate entry
                    signalType = "BUY";
                    entryType = "FRESH_FLIP";
                    reason = `🚀 BUY: ST Flip GREEN | ADX ${adxVal.toFixed(1)}${adxRising ? "↑" : "↓"} | RSI ${rsiVal.toFixed(1)}`;
                    this._pendingEntries.delete(instrument);
                } else if (adxMeetsThreshold && !adxSlopeOk && rsiOkForFresh) {
                    // ADX meets threshold but falling - wait for ADX to rise
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "ADX_SLOPE_RISING",
                            direction: "LONG",
                        });
                        reason = `⏸️ PENDING: ST Flip blocked by falling ADX (${adxVal.toFixed(1)} < prev ${prevAdxVal.toFixed(1)}) - waiting for rising trend`;
                        logger.info(`📉 ${instrument}: Signal filtered - ADX falling (${adxVal.toFixed(1)} < prev ${prevAdxVal.toFixed(1)})`);
                    }
                } else if (adxOk && !rsiOkForFresh) {
                    // ADX strong but RSI overbought - wait for RSI cooldown
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "RSI_COOLDOWN",
                            direction: "LONG",
                        });
                        reason = `â¸ï¸ PENDING: ST Flip blocked by RSI (${rsiVal.toFixed(
                            1
                        )} >= ${
                            this.config.rsiOverbought
                        }) - waiting for cooldown`;
                    }
                } else if (!adxMeetsThreshold && rsiOkForFresh) {
                    // RSI OK but ADX below threshold - wait for ADX to strengthen
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "ADX_STRENGTHEN",
                            direction: "LONG",
                        });
                        reason = `â¸ï¸ PENDING: ST Flip blocked by ADX (${adxVal.toFixed(
                            1
                        )} < ${
                            this.config.minAdx
                        }) - waiting for trend strength`;
                    }
                } else {
                    // Both ADX weak AND RSI overbought - wait for both
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "BOTH",
                            direction: "LONG",
                        });
                        reason = `â¸ï¸ PENDING: ST Flip blocked by ADX (${adxVal.toFixed(
                            1
                        )}) AND RSI (${rsiVal.toFixed(1)}) - waiting for both`;
                    }
                }
            }
            // 4. CONTINUATION ENTRY: Conditions improved after pending flip
            else if (
                currentDir === 1 &&
                this.config.enableContinuationEntry &&
                this._pendingEntries.has(instrument) &&
                (
                    !this._pendingEntries.get(instrument).direction ||
                    this._pendingEntries.get(instrument).direction === "LONG"
                )
            ) {
                const pending = this._pendingEntries.get(instrument);
                const ageMs = Date.now() - pending.flipTime;
                const maxAgeMs =
                    this.config.continuationWindowMs || 4 * 60 * 60 * 1000;

                if (ageMs > maxAgeMs) {
                    logger.info(
                        `â° ${instrument}: Continuation window expired after ${(
                            ageMs / 60000
                        ).toFixed(0)} minutes. Was waiting for: ${
                            pending.waitingFor
                        }`
                    );
                    this._pendingEntries.delete(instrument);
                } else {
                    const maxDeviation =
                        this.config.continuationMaxPriceDeviation || 0.005;
                    const priceDeviation =
                        (currentPrice - pending.flipPrice) / pending.flipPrice;
                    const priceOk = Math.abs(priceDeviation) <= maxDeviation;

                    // Check if price has moved too far - cancel regardless of type
                    if (!priceOk) {
                        logger.info(
                            `âŒ ${instrument}: Continuation cancelled. Price moved ${(
                                priceDeviation * 100
                            ).toFixed(1)}% from flip price`
                        );
                        this._pendingEntries.delete(instrument);
                    }
                    // Handle based on what we're waiting for
                    else if (pending.waitingFor === "RSI_COOLDOWN") {
                        // Was blocked by high RSI - check if RSI cooled down
                        if (adxOk && rsiOkForContinuation) {
                            signalType = "BUY";
                            entryType = "CONTINUATION_RSI";
                            reason =
                                `ðŸ”„ BUY: Continuation (RSI Cooldown) | RSI ${rsiVal.toFixed(
                                    1
                                )} < ${
                                    this.config.continuationRsiThreshold
                                } | ` +
                                `Price: ${(priceDeviation * 100).toFixed(
                                    1
                                )}% from flip | ` +
                                `Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else if (pending.waitingFor === "ADX_STRENGTHEN") {
                        // Was blocked by weak ADX - check if ADX strengthened
                        if (adxOk && rsiOkForFresh) {
                            signalType = "BUY";
                            entryType = "CONTINUATION_ADX";
                            reason =
                                `🔄 BUY: Continuation (ADX Strengthened) | ADX ${adxVal.toFixed(1)} >= ${this.config.minAdx} | ` +
                                `Price: ${(priceDeviation * 100).toFixed(1)}% from flip | ` +
                                `Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else if (pending.waitingFor === "ADX_SLOPE_RISING") {
                        // Was blocked by falling ADX - check if ADX is now rising
                        if (adxMeetsThreshold && adxRising && rsiOkForFresh) {
                            signalType = "BUY";
                            entryType = "CONTINUATION_ADX_SLOPE";
                            reason =
                                `🔄 BUY: Continuation (ADX Rising) | ADX ${adxVal.toFixed(1)}↑ | ` +
                                `Price: ${(priceDeviation * 100).toFixed(1)}% from flip | ` +
                                `Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else if (pending.waitingFor === "BOTH") {
                        // Was blocked by both - need both to be OK
                        if (adxOk && rsiOkForContinuation) {
                            signalType = "BUY";
                            entryType = "CONTINUATION_BOTH";
                            reason =
                                `ðŸ”„ BUY: Continuation (Both OK) | ADX ${adxVal.toFixed(
                                    1
                                )} RSI ${rsiVal.toFixed(1)} | ` +
                                `Price: ${(priceDeviation * 100).toFixed(
                                    1
                                )}% from flip | ` +
                                `Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else {
                        // Legacy pending entries without waitingFor field (backwards compat)
                        if (adxOk && rsiOkForContinuation) {
                            signalType = "BUY";
                            entryType = "CONTINUATION";
                            reason =
                                `ðŸ”„ BUY: Continuation Entry | RSI cooled (${rsiVal.toFixed(
                                    1
                                )} < ${
                                    this.config.continuationRsiThreshold
                                }) | ` +
                                `Price: ${(priceDeviation * 100).toFixed(
                                    1
                                )}% from flip | Wait: ${(ageMs / 60000).toFixed(
                                    0
                                )}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    }
                }
            }
            // 5. SHORT ENTRY: SuperTrend Flip (GREEN → RED)
            // Always emits SELL (to close longs), but entryType indicates if short entry is valid
            else if (prevDir === 1 && currentDir === -1) {
                signalType = "SELL";
                // Clear any pending LONG entries on direction change
                const existingPending = this._pendingEntries.get(instrument);
                if (existingPending && existingPending.direction !== "SHORT") {
                    this._pendingEntries.delete(instrument);
                }

                if (adxOk && rsiOkForShort) {
                    // All conditions met - valid short entry
                    entryType = "SHORT_ENTRY";
                    reason = `📉 SELL: ST Flip RED | ADX ${adxVal.toFixed(1)}${adxRising ? "↑" : "↓"} | RSI ${rsiVal.toFixed(1)}`;
                    this._pendingEntries.delete(instrument);
                } else if (adxMeetsThreshold && !adxSlopeOk && rsiOkForShort) {
                    // ADX meets threshold but falling - wait for ADX to rise
                    entryType = "EXIT_ONLY";
                    reason = `📉 EXIT: ST Flip RED (short blocked: falling ADX ${adxVal.toFixed(1)})`;
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "ADX_SLOPE_RISING",
                            direction: "SHORT",
                        });
                        logger.info(`📉 ${instrument}: Short entry filtered - ADX falling (${adxVal.toFixed(1)} < prev ${prevAdxVal.toFixed(1)})`);
                    }
                } else if (adxOk && !rsiOkForShort) {
                    // ADX strong but RSI oversold - wait for RSI recovery
                    entryType = "EXIT_ONLY";
                    reason = `📉 EXIT: ST Flip RED (short blocked: RSI oversold ${rsiVal.toFixed(1)})`;
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "RSI_RECOVERY",
                            direction: "SHORT",
                        });
                    }
                } else if (!adxMeetsThreshold && rsiOkForShort) {
                    // RSI OK but ADX below threshold - wait for ADX to strengthen
                    entryType = "EXIT_ONLY";
                    reason = `📉 EXIT: ST Flip RED (short blocked: ADX ${adxVal.toFixed(1)} < ${this.config.minAdx})`;
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "ADX_STRENGTHEN",
                            direction: "SHORT",
                        });
                    }
                } else {
                    // Both ADX weak AND RSI oversold - wait for both
                    entryType = "EXIT_ONLY";
                    reason = `📉 EXIT: ST Flip RED (short blocked: ADX ${adxVal.toFixed(1)} & RSI ${rsiVal.toFixed(1)})`;
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: flipTimeMs,
                            flipPrice: flipCandlePrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "BOTH",
                            direction: "SHORT",
                        });
                    }
                }
            }
            // 6. SHORT CONTINUATION: Conditions improved after pending short flip
            else if (
                currentDir === -1 &&
                this.config.enableContinuationEntry &&
                this._pendingEntries.has(instrument) &&
                this._pendingEntries.get(instrument).direction === "SHORT"
            ) {
                const pending = this._pendingEntries.get(instrument);
                const ageMs = Date.now() - pending.flipTime;
                const maxAgeMs = this.config.continuationWindowMs || 4 * 60 * 60 * 1000;

                if (ageMs > maxAgeMs) {
                    logger.info(
                        `⏰ ${instrument}: Short continuation window expired after ${(ageMs / 60000).toFixed(0)} minutes. Was waiting for: ${pending.waitingFor}`
                    );
                    this._pendingEntries.delete(instrument);
                } else {
                    const maxDeviation = this.config.continuationMaxPriceDeviation || 0.005;
                    // For shorts, price deviation is negative when price falls (favorable)
                    const priceDeviation = (pending.flipPrice - currentPrice) / pending.flipPrice;
                    const priceOk = Math.abs(priceDeviation) <= maxDeviation;

                    if (!priceOk) {
                        logger.info(
                            `❌ ${instrument}: Short continuation cancelled. Price moved ${(priceDeviation * 100).toFixed(1)}% from flip price`
                        );
                        this._pendingEntries.delete(instrument);
                    } else if (pending.waitingFor === "RSI_RECOVERY") {
                        if (adxOk && rsiOkForShortContinuation) {
                            signalType = "SELL";
                            entryType = "SHORT_CONTINUATION_RSI";
                            reason = `🔄 SELL: Short Continuation (RSI Recovery) | RSI ${rsiVal.toFixed(1)} > ${(this.config.rsiOversold || 30) + 5} | ` +
                                `Price: ${(priceDeviation * 100).toFixed(1)}% from flip | Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else if (pending.waitingFor === "ADX_STRENGTHEN") {
                        if (adxOk && rsiOkForShort) {
                            signalType = "SELL";
                            entryType = "SHORT_CONTINUATION_ADX";
                            reason = `🔄 SELL: Short Continuation (ADX Strengthened) | ADX ${adxVal.toFixed(1)} >= ${this.config.minAdx} | ` +
                                `Price: ${(priceDeviation * 100).toFixed(1)}% from flip | Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else if (pending.waitingFor === "ADX_SLOPE_RISING") {
                        if (adxMeetsThreshold && adxRising && rsiOkForShort) {
                            signalType = "SELL";
                            entryType = "SHORT_CONTINUATION_ADX_SLOPE";
                            reason = `🔄 SELL: Short Continuation (ADX Rising) | ADX ${adxVal.toFixed(1)}↑ | ` +
                                `Price: ${(priceDeviation * 100).toFixed(1)}% from flip | Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    } else if (pending.waitingFor === "BOTH") {
                        if (adxOk && rsiOkForShortContinuation) {
                            signalType = "SELL";
                            entryType = "SHORT_CONTINUATION_BOTH";
                            reason = `🔄 SELL: Short Continuation (Both OK) | ADX ${adxVal.toFixed(1)} RSI ${rsiVal.toFixed(1)} | ` +
                                `Price: ${(priceDeviation * 100).toFixed(1)}% from flip | Wait: ${(ageMs / 60000).toFixed(0)}min`;
                            this._pendingEntries.delete(instrument);
                        }
                    }
                }
            }

            return {
                symbol: instrument,
                signal: signalType,
                strength: adxVal,
                message: reason,
                timestamp: Date.now(),
                signalCandleTime,
                atr: atrVal,
                atrPips: atrPips,
                currentPrice: currentPrice,
                entryType,

                // Trend data for dashboard
                trend: {
                    currentPrice,
                    rsi: rsiVal,
                    adx: adxVal,
                    adxRising: adxRising,
                    adxPrev: prevAdxVal,
                    supertrend_direction: currentDir,
                    atrPips: atrPips,
                },

                // Trading engine compatibility
                data: {
                    currentPrice,
                    rsi: rsiVal,
                    adx: adxVal,
                    adxRising: adxRising,
                    adxPrev: prevAdxVal,
                    stDirection: currentDir,
                    atrPips: atrPips,
                },

                pendingEntry: this._pendingEntries.has(instrument)
                    ? {
                          flipTime:
                              this._pendingEntries.get(instrument).flipTime,
                          flipPrice:
                              this._pendingEntries.get(instrument).flipPrice,
                          flipAdx: this._pendingEntries.get(instrument).flipAdx,
                          flipRsi: this._pendingEntries.get(instrument).flipRsi,
                          waitingFor:
                              this._pendingEntries.get(instrument).waitingFor,
                          ageMinutes: (
                              (Date.now() -
                                  this._pendingEntries.get(instrument)
                                      .flipTime) /
                              60000
                          ).toFixed(0),
                      }
                    : null,
            };
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
                };
            }

            if (now - (lastMeta.time || 0) < this.config.signalCooldown) {
                return {
                    ...signal,
                    signal: "COOLDOWN",
                    message: "Signal Spam Filter",
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
                    waitingFor: data.waitingFor || "UNKNOWN",
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
