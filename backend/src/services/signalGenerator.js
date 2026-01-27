// backend/src/services/signalGenerator.js - Forex SuperTrend + ADX Signal Generator
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { RSI, ADX, ATR } = require("technicalindicators");

class SignalGenerator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.isRunning = false;
        this.signalInterval = null;
        this.dataService = null;
        this.latestSignals = [];

        this.config = {
            strategy: "supertrend_momentum",
            timeframe: "15m",
            signalCooldown: 60000,
            assets: [],

            // Forex-specific: Lower ADX threshold (Forex trends show lower ADX than crypto)
            minAdx: 22, // Lower than crypto (25-28)
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
            continuationMaxPriceDeviation: 0.02, // 2% for Forex (tighter than crypto)

            ...config,
        };

        this.lastSignals = new Map();
        this._pendingEntries = new Map();
        this._lastKnownDirection = new Map(); // Tracks last observed SuperTrend direction per instrument to prevent repeated flip signals

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
            }
        } catch (error) {
            logger.error("âŒ Signal Cycle Error:", error);
        }
    }

    /**
     * Calculate SuperTrend indicator
     */
    calculateSuperTrend(highs, lows, closes, period = 10, factor = 3) {
        // True Range calculation
        let tr = [highs[0] - lows[0]];
        let atr = [tr[0]];

        for (let i = 1; i < closes.length; i++) {
            let hl = highs[i] - lows[i];
            let hc = Math.abs(highs[i] - closes[i - 1]);
            let lc = Math.abs(lows[i] - closes[i - 1]);
            tr.push(Math.max(hl, hc, lc));
            atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
        }

        let upperBand = [],
            lowerBand = [],
            superTrend = [],
            direction = [];
        let basicUpper = (highs[0] + lows[0]) / 2 + factor * atr[0];
        let basicLower = (highs[0] + lows[0]) / 2 - factor * atr[0];

        upperBand.push(basicUpper);
        lowerBand.push(basicLower);
        superTrend.push(basicUpper);
        direction.push(1);

        for (let i = 1; i < closes.length; i++) {
            let currBasicUpper = (highs[i] + lows[i]) / 2 + factor * atr[i];
            let currBasicLower = (highs[i] + lows[i]) / 2 - factor * atr[i];

            let prevFinalUpper = upperBand[i - 1];
            let prevFinalLower = lowerBand[i - 1];
            let prevClose = closes[i - 1];

            let finalUpper =
                currBasicUpper < prevFinalUpper || prevClose > prevFinalUpper
                    ? currBasicUpper
                    : prevFinalUpper;
            let finalLower =
                currBasicLower > prevFinalLower || prevClose < prevFinalLower
                    ? currBasicLower
                    : prevFinalLower;

            upperBand.push(finalUpper);
            lowerBand.push(finalLower);

            let prevDir = direction[i - 1];
            let currentDir = prevDir;

            if (prevDir === 1 && closes[i] < lowerBand[i - 1]) currentDir = -1;
            else if (prevDir === -1 && closes[i] > upperBand[i - 1])
                currentDir = 1;

            direction.push(currentDir);
            superTrend.push(currentDir === 1 ? finalLower : finalUpper);
        }

        return { superTrend, direction, atr };
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

            // Track direction state to fire flip signals only once per actual change
            const lastKnownDir = this._lastKnownDirection.get(instrument);
            this._lastKnownDirection.set(instrument, currentDir);

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

            // 3. PRIMARY ENTRY: Fresh SuperTrend Flip (RED → GREEN)
            // Uses lastKnownDir (generator's memory) not prevDir (candle data) to prevent repeated signals
            if (lastKnownDir === -1 && currentDir === 1) {
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
                            flipTime: Date.now(),
                            flipPrice: currentPrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "ADX_SLOPE_RISING",
                        });
                        reason = `⏸️ PENDING: ST Flip blocked by falling ADX (${adxVal.toFixed(1)} < prev ${prevAdxVal.toFixed(1)}) - waiting for rising trend`;
                        logger.info(`📉 ${instrument}: Signal filtered - ADX falling (${adxVal.toFixed(1)} < prev ${prevAdxVal.toFixed(1)})`);
                    }
                } else if (adxOk && !rsiOkForFresh) {
                    // ADX strong but RSI overbought - wait for RSI cooldown
                    if (this.config.enableContinuationEntry) {
                        this._pendingEntries.set(instrument, {
                            flipTime: Date.now(),
                            flipPrice: currentPrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "RSI_COOLDOWN",
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
                            flipTime: Date.now(),
                            flipPrice: currentPrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "ADX_STRENGTHEN",
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
                            flipTime: Date.now(),
                            flipPrice: currentPrice,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor: "BOTH",
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
                this._pendingEntries.has(instrument)
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
                        this.config.continuationMaxPriceDeviation || 0.02;
                    const priceDeviation =
                        (currentPrice - pending.flipPrice) / pending.flipPrice;
                    const priceOk = priceDeviation <= maxDeviation;

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
                        if (adxRising && rsiOkForFresh) {
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
            // 5. EXIT: SuperTrend Flip (GREEN → RED)
            // Uses lastKnownDir (generator's memory) not prevDir (candle data) to prevent repeated signals
            else if (lastKnownDir === 1 && currentDir === -1) {
                signalType = "SELL";
                entryType = "FRESH_FLIP";
                reason = `📉 SELL: ST Flip RED`;
                this._pendingEntries.delete(instrument);
            }

            return {
                symbol: instrument,
                signal: signalType,
                strength: adxVal,
                message: reason,
                timestamp: Date.now(),
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
        const lastTime = this.lastSignals.get(key) || 0;

        // Rate limit active signals
        if (
            (signal.signal === "BUY" || signal.signal === "SELL") &&
            Date.now() - lastTime < this.config.signalCooldown
        ) {
            return {
                ...signal,
                signal: "COOLDOWN",
                message: "Signal Spam Filter",
            };
        }

        if (signal.signal === "BUY" || signal.signal === "SELL") {
            this.lastSignals.set(key, Date.now());
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
        this._lastKnownDirection.clear();
        logger.info("📄 Signal Generator reset. Pending entries and direction state cleared.");
    }

    clearPendingEntries() {
        const count = this._pendingEntries.size;
        this._pendingEntries.clear();
        logger.info(`ðŸ§¹ Cleared ${count} pending entries.`);
        return count;
    }
}

module.exports = SignalGenerator;
