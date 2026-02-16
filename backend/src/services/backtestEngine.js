// backend/src/services/backtestEngine.js - Backtest engine for historical strategy simulation
// Replicates signalGenerator.js signal logic and LiveTradingEngine.js trade management
// on historical candle data with no look-ahead bias
const {
    calculateSuperTrend,
    calculateRSI,
    calculateADX,
    calculateATR,
    getPipValue,
} = require("../utils/indicators");
const logger = require("../utils/logger");

// Default config matching live trading parameters
const DEFAULTS = {
    // Strategy (matches signalGenerator.js)
    atrPeriod: 10,
    factor: 3,
    minAdx: 22,
    adxSlopeFilter: true,
    adxSlopeLookback: 3,
    rsiOverbought: 75,
    rsiOversold: 30,

    // Continuation (matches signalGenerator.js)
    enableContinuationEntry: true,
    continuationWindowSeconds: 4 * 60 * 60, // 4 hours in candle time
    continuationRsiThreshold: 70,
    continuationMaxPriceDeviation: 0.02,

    // Position sizing (matches LiveTradingEngine.js)
    initialBalance: 500,
    riskPerTrade: 0.02,
    leverage: 10,
    marginBuffer: 0.2,
    maxOpenPositions: 2,

    // Stop loss (matches LiveTradingEngine.js)
    stopLossType: "ATR",
    stopLossAtrMultiplier: 2.0,
    minStopLossPips: 12,

    // Take profit (matches LiveTradingEngine.js)
    enableTakeProfit: true,
    takeProfitPercent: 0.06,

    // Trailing stop (matches LiveTradingEngine.js)
    enableTrailingStops: true,
    trailingStopPips: 25,
    trailingStopActivationPips: 20,

    // Breakeven (matches LiveTradingEngine.js)
    enableBreakeven: true,
    breakevenTriggerPips: 12,

    // Shorting
    enableShorting: true,

    // Higher-timeframe trend filter (H4 SuperTrend must agree with entry direction)
    enableHTFFilter: false,

    // Multi-timeframe simulation: M15 candles aggregated to H1 for signals, M15 used for fill resolution
    enableMultiTimeframe: false,

    // Costs
    spreadPips: 1.5,
};

class BacktestEngine {
    constructor(historicalDataService = null) {
        this.historicalDataService = historicalDataService;
    }

    /**
     * Run backtest by fetching historical data then simulating
     * @param {string} instrument - e.g. "AUD_USD"
     * @param {string} granularity - e.g. "M15"
     * @param {number} fromTimestamp - UNIX seconds
     * @param {number} toTimestamp - UNIX seconds
     * @param {object} configOverrides - Override default config for parameter sweeps
     */
    async run(instrument, granularity, fromTimestamp, toTimestamp, configOverrides = {}) {
        if (!this.historicalDataService) {
            throw new Error("historicalDataService is required for run()");
        }

        const config = { ...DEFAULTS, ...configOverrides };

        // Multi-TF mode always fetches M15 candles (aggregated to H1 internally for signals)
        const fetchGranularity = config.enableMultiTimeframe ? "M15" : granularity;
        const candles = await this.historicalDataService.getCandles(
            instrument, fetchGranularity, fromTimestamp, toTimestamp
        );

        // Auto-fetch H4 candles for HTF filter
        let htfCandles = null;
        if (config.enableHTFFilter) {
            htfCandles = await this.historicalDataService.getCandles(
                instrument, "H4", fromTimestamp, toTimestamp
            );
        }

        return this.runOnCandles(candles, instrument, configOverrides, htfCandles);
    }

    /**
     * Run backtest on pre-loaded candle data (sync, for testing)
     * @param {Array<{time, open, high, low, close, volume}>} candles
     * @param {string} instrument - e.g. "AUD_USD"
     * @param {object} configOverrides
     */
    runOnCandles(candles, instrument, configOverrides = {}, htfCandles = null) {
        const config = { ...DEFAULTS, ...configOverrides };
        const pipValue = getPipValue(instrument);

        // Need enough candles for indicator warmup
        if (!candles || candles.length < 50) {
            return this._emptyResult(config);
        }

        // Pre-compute HTF SuperTrend if filter enabled and H4 candles provided
        let htfDirections = null;
        let htfTimes = null;
        if (config.enableHTFFilter && htfCandles && htfCandles.length >= 50) {
            const htfHighs = htfCandles.map(c => c.high);
            const htfLows = htfCandles.map(c => c.low);
            const htfCloses = htfCandles.map(c => c.close);
            const htfST = calculateSuperTrend(htfHighs, htfLows, htfCloses, config.atrPeriod, config.factor);
            htfDirections = htfST.direction;
            htfTimes = htfCandles.map(c => c.time);
        }

        // === Multi-TF setup: choose indicator source candles ===
        // In multi-TF mode, indicators are computed on aggregated H1 bars while
        // the main loop iterates M15 candles for finer exit resolution.
        let m15ToH1Index = null;      // Maps M15 iteration index → H1 indicator index (null if single-TF)
        let shouldEvaluateSignal;     // Predicate: should signal eval run at this iteration index?

        let indicatorCandles;
        if (config.enableMultiTimeframe) {
            const agg = this._aggregateToH1(candles);
            indicatorCandles = agg.h1Candles;
            m15ToH1Index = agg.m15ToH1Index;
            shouldEvaluateSignal = (i) => agg.h1CompletionM15Indices.has(i);

            if (indicatorCandles.length < 50) {
                return this._emptyResult(config);
            }
        } else {
            indicatorCandles = candles;
            shouldEvaluateSignal = () => true;
        }

        // Pre-compute all indicators on indicator candle array (H1 in multi-TF, input candles otherwise)
        const highs = indicatorCandles.map((c) => c.high);
        const lows = indicatorCandles.map((c) => c.low);
        const closes = indicatorCandles.map((c) => c.close);

        const stData = calculateSuperTrend(highs, lows, closes, config.atrPeriod, config.factor);
        const rsiValues = calculateRSI(closes, 14);
        const adxValues = calculateADX(highs, lows, closes, 14);
        const atrValues = calculateATR(highs, lows, closes, 14);

        // Calculate offset for each indicator (they return shorter arrays than input)
        const rsiOffset = indicatorCandles.length - rsiValues.length;
        const adxOffset = indicatorCandles.length - adxValues.length;
        const atrOffset = indicatorCandles.length - atrValues.length;

        // Indicator warmup index (on indicator candle array)
        const indicatorStartIndex = Math.max(rsiOffset, adxOffset, atrOffset) + 1;

        // Determine main loop start index (on iteration candle array)
        let startIndex;
        if (config.enableMultiTimeframe) {
            // Find first M15 index whose H1 index >= warmup threshold
            startIndex = candles.findIndex((_, idx) => m15ToH1Index[idx] >= indicatorStartIndex);
            if (startIndex < 0) return this._emptyResult(config);
        } else {
            startIndex = indicatorStartIndex;
            if (startIndex >= candles.length) return this._emptyResult(config);
        }

        // Helper to get indicators at iteration index i
        // In multi-TF mode, maps M15 index → H1 indicator index via m15ToH1Index
        const getIndicators = (i) => {
            const indIdx = m15ToH1Index ? m15ToH1Index[i] : i;

            const rsiIdx = indIdx - rsiOffset;
            const adxIdx = indIdx - adxOffset;
            const atrIdx = indIdx - atrOffset;

            const currentDir = stData.direction[indIdx];
            const prevDir = stData.direction[indIdx - 1];
            const rsiVal = rsiIdx >= 0 && rsiIdx < rsiValues.length ? rsiValues[rsiIdx] : 0;

            const adxResult = adxIdx >= 0 && adxIdx < adxValues.length ? adxValues[adxIdx] : null;
            const adxVal = adxResult?.adx || 0;

            // ADX slope: compare to N bars ago
            const lookback = config.adxSlopeLookback || 3;
            const prevAdxIdx = adxIdx - lookback;
            const prevAdxResult = prevAdxIdx >= 0 ? adxValues[prevAdxIdx] : null;
            const prevAdxVal = prevAdxResult?.adx || adxVal;
            const adxRising = adxVal > prevAdxVal;

            const atrVal = atrIdx >= 0 && atrIdx < atrValues.length ? atrValues[atrIdx] : 0;
            const atrPips = atrVal / pipValue;

            return { currentDir, prevDir, rsiVal, adxVal, adxRising, prevAdxVal, atrVal, atrPips };
        };

        // Simulation state
        let balance = config.initialBalance;
        const openPositions = []; // Array of open trade objects
        let pendingEntry = null;
        const pendingContinuations = new Map(); // instrument -> pending data
        const closedTrades = [];
        const equityCurve = [];

        // Main loop: iterate candles from startIndex
        for (let i = startIndex; i < candles.length; i++) {
            const candle = candles[i];

            // === 1. EXECUTE PENDING ENTRY at open ===
            if (pendingEntry && openPositions.length < config.maxOpenPositions) {
                const entryPrice = candle.open;
                const ind = getIndicators(pendingEntry.signalCandle);
                const trade = this._openTrade(
                    instrument, pendingEntry.side, pendingEntry.entryType,
                    entryPrice, ind, config, balance, pipValue
                );

                if (trade) {
                    trade.entryTime = candle.time;
                    trade.entryCandle = i;
                    openPositions.push(trade);
                    // Reserve margin
                    balance -= 0; // margin is tracked on the trade, not deducted from balance
                }
                pendingEntry = null;
            } else if (pendingEntry) {
                // Max positions reached, discard pending entry
                pendingEntry = null;
            }

            // === 2. CHECK EXITS on open positions ===
            for (let p = openPositions.length - 1; p >= 0; p--) {
                const trade = openPositions[p];
                const isBuy = trade.side === "BUY";

                // 2a. Breakeven check
                if (config.enableBreakeven && !trade.breakevenHit) {
                    const profitPips = isBuy
                        ? (candle.high - trade.entryPrice) / pipValue
                        : (trade.entryPrice - candle.low) / pipValue;
                    if (profitPips >= config.breakevenTriggerPips) {
                        trade.stopLossPrice = trade.entryPrice;
                        trade.breakevenHit = true;
                    }
                }

                // 2b. Trailing stop update
                if (config.enableTrailingStops) {
                    this._updateTrailingStop(trade, candle, config, pipValue);
                }

                // Effective stop loss (trailing overrides original if set)
                const effectiveSL = trade.trailingStopPrice || trade.stopLossPrice;

                // 2c. Stop loss check (priority over TP)
                const slHit = isBuy
                    ? candle.low <= effectiveSL
                    : candle.high >= effectiveSL;

                if (slHit) {
                    const exitReason = trade.trailingStopPrice ? "TRAILING_STOP" : "STOP_LOSS";
                    this._closeTrade(trade, effectiveSL, exitReason, candle.time, config, pipValue);
                    closedTrades.push(trade);
                    balance += trade.pnlNet;
                    openPositions.splice(p, 1);
                    continue;
                }

                // 2d. Take profit check
                if (trade.takeProfitPrice) {
                    const tpHit = isBuy
                        ? candle.high >= trade.takeProfitPrice
                        : candle.low <= trade.takeProfitPrice;

                    if (tpHit) {
                        this._closeTrade(trade, trade.takeProfitPrice, "TAKE_PROFIT", candle.time, config, pipValue);
                        closedTrades.push(trade);
                        balance += trade.pnlNet;
                        openPositions.splice(p, 1);
                        continue;
                    }
                }
            }

            // === 3. EVALUATE SIGNAL at close ===
            // In multi-TF mode, only evaluate signals when an H1 bar completes
            if (shouldEvaluateSignal(i)) {
            const ind = getIndicators(i);
            const { currentDir, prevDir, rsiVal, adxVal, adxRising, prevAdxVal, atrPips } = ind;

            const adxMeetsThreshold = adxVal >= config.minAdx;
            const adxSlopeOk = !config.adxSlopeFilter || adxRising;
            const adxOk = adxMeetsThreshold && adxSlopeOk;
            const rsiOkForFresh = rsiVal < config.rsiOverbought;
            const rsiOkForContinuation = rsiVal < config.continuationRsiThreshold;
            const rsiOkForShort = rsiVal > config.rsiOversold;
            const rsiOkForShortContinuation = rsiVal > (config.rsiOversold + 5);

            let signalType = null;
            let entryType = null;
            let signalSide = null;

            // 3a. LONG: Fresh SuperTrend flip RED→GREEN
            if (prevDir === -1 && currentDir === 1) {
                // Clear short continuations on direction change
                if (pendingContinuations.has(instrument) && pendingContinuations.get(instrument).direction === "SHORT") {
                    pendingContinuations.delete(instrument);
                }

                if (adxOk && rsiOkForFresh) {
                    signalType = "BUY";
                    entryType = "FRESH_FLIP";
                    signalSide = "BUY";
                    pendingContinuations.delete(instrument);
                } else if (config.enableContinuationEntry) {
                    // Determine what we're waiting for
                    let waitingFor = null;
                    if (adxMeetsThreshold && !adxSlopeOk && rsiOkForFresh) {
                        waitingFor = "ADX_SLOPE_RISING";
                    } else if (adxOk && !rsiOkForFresh) {
                        waitingFor = "RSI_COOLDOWN";
                    } else if (!adxMeetsThreshold && rsiOkForFresh) {
                        waitingFor = "ADX_STRENGTHEN";
                    } else {
                        waitingFor = "BOTH";
                    }

                    pendingContinuations.set(instrument, {
                        flipTime: candle.time,
                        flipPrice: candle.close,
                        flipAdx: adxVal,
                        flipRsi: rsiVal,
                        waitingFor,
                        direction: "LONG",
                    });
                }
            }
            // 3b. LONG CONTINUATION
            else if (
                currentDir === 1 &&
                config.enableContinuationEntry &&
                pendingContinuations.has(instrument) &&
                pendingContinuations.get(instrument).direction === "LONG"
            ) {
                const pending = pendingContinuations.get(instrument);
                const ageSec = candle.time - pending.flipTime;

                if (ageSec > config.continuationWindowSeconds) {
                    pendingContinuations.delete(instrument);
                } else {
                    const priceDeviation = (candle.close - pending.flipPrice) / pending.flipPrice;
                    if (Math.abs(priceDeviation) > config.continuationMaxPriceDeviation) {
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "RSI_COOLDOWN" && adxOk && rsiOkForContinuation) {
                        signalType = "BUY";
                        entryType = "CONTINUATION_RSI";
                        signalSide = "BUY";
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "ADX_STRENGTHEN" && adxOk && rsiOkForFresh) {
                        signalType = "BUY";
                        entryType = "CONTINUATION_ADX";
                        signalSide = "BUY";
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "ADX_SLOPE_RISING" && adxMeetsThreshold && adxRising && rsiOkForFresh) {
                        signalType = "BUY";
                        entryType = "CONTINUATION_ADX_SLOPE";
                        signalSide = "BUY";
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "BOTH" && adxOk && rsiOkForContinuation) {
                        signalType = "BUY";
                        entryType = "CONTINUATION_BOTH";
                        signalSide = "BUY";
                        pendingContinuations.delete(instrument);
                    }
                }
            }
            // 3c. SHORT: Fresh SuperTrend flip GREEN→RED
            else if (prevDir === 1 && currentDir === -1) {
                // Clear long continuations on direction change
                if (pendingContinuations.has(instrument) && pendingContinuations.get(instrument).direction !== "SHORT") {
                    pendingContinuations.delete(instrument);
                }

                // Always emit SELL to close longs (signal reversal)
                signalType = "SELL";

                if (adxOk && rsiOkForShort) {
                    entryType = "SHORT_ENTRY";
                    signalSide = "SELL";
                } else {
                    entryType = "EXIT_ONLY";
                    signalSide = null; // No new short position

                    if (config.enableContinuationEntry && config.enableShorting) {
                        let waitingFor = null;
                        if (adxMeetsThreshold && !adxSlopeOk && rsiOkForShort) {
                            waitingFor = "ADX_SLOPE_RISING";
                        } else if (adxOk && !rsiOkForShort) {
                            waitingFor = "RSI_RECOVERY";
                        } else if (!adxMeetsThreshold && rsiOkForShort) {
                            waitingFor = "ADX_STRENGTHEN";
                        } else {
                            waitingFor = "BOTH";
                        }

                        pendingContinuations.set(instrument, {
                            flipTime: candle.time,
                            flipPrice: candle.close,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            waitingFor,
                            direction: "SHORT",
                        });
                    }
                }
            }
            // 3d. SHORT CONTINUATION
            else if (
                currentDir === -1 &&
                config.enableContinuationEntry &&
                config.enableShorting &&
                pendingContinuations.has(instrument) &&
                pendingContinuations.get(instrument).direction === "SHORT"
            ) {
                const pending = pendingContinuations.get(instrument);
                const ageSec = candle.time - pending.flipTime;

                if (ageSec > config.continuationWindowSeconds) {
                    pendingContinuations.delete(instrument);
                } else {
                    // For shorts, price deviation is inverted (favorable when price falls)
                    const priceDeviation = (pending.flipPrice - candle.close) / pending.flipPrice;
                    if (Math.abs(priceDeviation) > config.continuationMaxPriceDeviation) {
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "RSI_RECOVERY" && adxOk && rsiOkForShortContinuation) {
                        signalType = "SELL";
                        entryType = "SHORT_CONTINUATION_RSI";
                        signalSide = "SELL";
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "ADX_STRENGTHEN" && adxOk && rsiOkForShort) {
                        signalType = "SELL";
                        entryType = "SHORT_CONTINUATION_ADX";
                        signalSide = "SELL";
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "ADX_SLOPE_RISING" && adxMeetsThreshold && adxRising && rsiOkForShort) {
                        signalType = "SELL";
                        entryType = "SHORT_CONTINUATION_ADX_SLOPE";
                        signalSide = "SELL";
                        pendingContinuations.delete(instrument);
                    } else if (pending.waitingFor === "BOTH" && adxOk && rsiOkForShortContinuation) {
                        signalType = "SELL";
                        entryType = "SHORT_CONTINUATION_BOTH";
                        signalSide = "SELL";
                        pendingContinuations.delete(instrument);
                    }
                }
            }

            // === 3e. SIGNAL REVERSAL: close opposite positions ===
            if (signalType === "BUY") {
                // Close any open SHORT positions
                for (let p = openPositions.length - 1; p >= 0; p--) {
                    if (openPositions[p].side === "SELL" && openPositions[p].instrument === instrument) {
                        const trade = openPositions[p];
                        this._closeTrade(trade, candle.close, "SIGNAL_REVERSAL", candle.time, config, pipValue);
                        closedTrades.push(trade);
                        balance += trade.pnlNet;
                        openPositions.splice(p, 1);
                    }
                }
            } else if (signalType === "SELL") {
                // Close any open LONG positions
                for (let p = openPositions.length - 1; p >= 0; p--) {
                    if (openPositions[p].side === "BUY" && openPositions[p].instrument === instrument) {
                        const trade = openPositions[p];
                        this._closeTrade(trade, candle.close, "SIGNAL_REVERSAL", candle.time, config, pipValue);
                        closedTrades.push(trade);
                        balance += trade.pnlNet;
                        openPositions.splice(p, 1);
                    }
                }
            }

            // === 4. QUEUE NEXT ENTRY (no look-ahead) ===
            if (signalSide && i < candles.length - 1) {
                // Check if we already hold a position in this direction
                const alreadyHolding = openPositions.some(
                    (t) => t.instrument === instrument && t.side === signalSide
                );

                // For shorts, check enableShorting
                const shortAllowed = signalSide === "BUY" || config.enableShorting;

                // HTF filter: H4 SuperTrend must agree with entry direction
                const htfAllowed = !htfDirections || this._checkHTFFilter(htfDirections, htfTimes, candle.time, signalSide);

                if (!alreadyHolding && shortAllowed && htfAllowed) {
                    pendingEntry = {
                        side: signalSide,
                        entryType,
                        signalCandle: i,
                    };
                }
            }
            } // end shouldEvaluateSignal

            // === 5. TRACK EQUITY ===
            let unrealizedPnl = 0;
            for (const pos of openPositions) {
                const priceChange = pos.side === "BUY"
                    ? candle.close - pos.entryPrice
                    : pos.entryPrice - candle.close;
                unrealizedPnl += pos.units * priceChange;
            }
            equityCurve.push({ time: candle.time, equity: balance + unrealizedPnl });
        }

        // Close any remaining open positions at last candle close
        const lastCandle = candles[candles.length - 1];
        for (const trade of openPositions) {
            this._closeTrade(trade, lastCandle.close, "BACKTEST_END", lastCandle.time, config, pipValue);
            closedTrades.push(trade);
            balance += trade.pnlNet;
        }
        openPositions.length = 0;

        return this._buildResult(closedTrades, equityCurve, config);
    }

    // === Trade helpers ===

    /**
     * Open a new trade with position sizing, SL, and TP
     */
    _openTrade(instrument, side, entryType, entryPrice, indicators, config, balance, pipValue) {
        // Calculate stop loss
        const stopLossPips = this._calculateStopLossPips(indicators.atrPips, config);
        const stopLossPrice = side === "BUY"
            ? entryPrice - stopLossPips * pipValue
            : entryPrice + stopLossPips * pipValue;

        // Position sizing
        const safeMargin = balance * (1 - config.marginBuffer);
        if (safeMargin <= 0) return null;

        const riskAmount = safeMargin * config.riskPerTrade;
        const units = Math.floor(riskAmount / (stopLossPips * pipValue));
        if (units < 1) return null;

        const marginUsed = (units * entryPrice) / config.leverage;

        // Take profit (margin-based)
        let takeProfitPrice = null;
        if (config.enableTakeProfit && marginUsed > 0) {
            const targetProfit = marginUsed * config.takeProfitPercent;
            const priceChange = targetProfit / units;
            takeProfitPrice = side === "BUY"
                ? entryPrice + priceChange
                : entryPrice - priceChange;
        }

        return {
            instrument,
            side,
            entryType,
            entryPrice,
            units,
            marginUsed,
            stopLossPrice,
            stopLossPips,
            takeProfitPrice,
            trailingStopPrice: null,
            breakevenHit: false,
            highestPrice: entryPrice,
            lowestPrice: entryPrice,
            entryTime: null, // Set by caller
            entryCandle: null,
        };
    }

    /**
     * Calculate stop loss distance in pips
     */
    _calculateStopLossPips(atrPips, config) {
        let stopLossPips;
        if (config.stopLossType === "ATR" && atrPips > 0) {
            stopLossPips = atrPips * config.stopLossAtrMultiplier;
        } else {
            stopLossPips = 30; // Fixed fallback
        }
        return Math.max(stopLossPips, config.minStopLossPips);
    }

    /**
     * Update trailing stop based on candle high/low
     */
    _updateTrailingStop(trade, candle, config, pipValue) {
        const isBuy = trade.side === "BUY";
        const trailingPips = config.trailingStopPips;
        const activationPips = config.trailingStopActivationPips;

        // Track extreme price
        if (isBuy) {
            trade.highestPrice = Math.max(trade.highestPrice || trade.entryPrice, candle.high);
        } else {
            trade.lowestPrice = Math.min(trade.lowestPrice || trade.entryPrice, candle.low);
        }

        // Check activation
        const profitPips = isBuy
            ? (trade.highestPrice - trade.entryPrice) / pipValue
            : (trade.entryPrice - trade.lowestPrice) / pipValue;

        if (profitPips < activationPips) return;

        // Calculate new trailing stop
        const newStop = isBuy
            ? trade.highestPrice - trailingPips * pipValue
            : trade.lowestPrice + trailingPips * pipValue;

        // Only move in favorable direction
        const shouldUpdate = isBuy
            ? !trade.trailingStopPrice || newStop > trade.trailingStopPrice
            : !trade.trailingStopPrice || newStop < trade.trailingStopPrice;

        if (shouldUpdate) {
            trade.trailingStopPrice = newStop;
        }
    }

    /**
     * Binary search to find H4 SuperTrend direction at a given timestamp.
     * Returns direction (1=uptrend, -1=downtrend) of the most recent H4 candle <= timestamp.
     */
    _getHTFDirection(htfDirections, htfTimes, timestamp) {
        let lo = 0, hi = htfTimes.length - 1;
        let result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (htfTimes[mid] <= timestamp) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        if (result < 0) return 0; // no HTF data before this timestamp
        return htfDirections[result];
    }

    /**
     * Check if HTF trend agrees with entry direction.
     * BUY requires H4 uptrend (1), SELL requires H4 downtrend (-1).
     */
    _checkHTFFilter(htfDirections, htfTimes, timestamp, signalSide) {
        const htfDir = this._getHTFDirection(htfDirections, htfTimes, timestamp);
        if (htfDir === 0) return true; // no data yet, allow entry
        if (signalSide === "BUY") return htfDir === 1;
        if (signalSide === "SELL") return htfDir === -1;
        return true;
    }

    /**
     * Aggregate M15 candles into H1 candles by hour boundary.
     * Groups by floor(time / 3600) * 3600. Returns H1 OHLC candles plus mapping
     * structures for the multi-TF simulation loop.
     *
     * @param {Array} m15Candles - Array of M15 candle objects with time, open, high, low, close, volume
     * @returns {{ h1Candles: Array, m15ToH1Index: number[], h1CompletionM15Indices: Set<number> }}
     *   - h1Candles: Aggregated H1 bars (open=first M15 open, high=max, low=min, close=last M15 close)
     *   - m15ToH1Index: Maps each M15 index to its parent H1 index
     *   - h1CompletionM15Indices: Set of M15 indices where each H1 bar's last candle falls
     *     (last H1 bar excluded — incomplete bars don't trigger signals)
     */
    _aggregateToH1(m15Candles) {
        const h1Candles = [];
        const m15ToH1Index = new Array(m15Candles.length);
        const h1CompletionM15Indices = new Set();

        let currentHour = -1;
        let h1Idx = -1;

        for (let i = 0; i < m15Candles.length; i++) {
            const candle = m15Candles[i];
            const hourKey = Math.floor(candle.time / 3600) * 3600;

            if (hourKey !== currentHour) {
                // Mark previous group's last M15 as H1 completion
                if (h1Idx >= 0 && i > 0) {
                    h1CompletionM15Indices.add(i - 1);
                }

                // Start new H1 bar
                currentHour = hourKey;
                h1Idx++;
                h1Candles.push({
                    time: hourKey,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume || 0,
                });
            } else {
                // Extend current H1 bar
                const h1 = h1Candles[h1Idx];
                h1.high = Math.max(h1.high, candle.high);
                h1.low = Math.min(h1.low, candle.low);
                h1.close = candle.close;
                h1.volume += candle.volume || 0;
            }

            m15ToH1Index[i] = h1Idx;
        }

        // Last H1 bar is NOT marked complete — prevents signals on partial bars

        return { h1Candles, m15ToH1Index, h1CompletionM15Indices };
    }

    /**
     * Close a trade and calculate P&L
     */
    _closeTrade(trade, exitPrice, exitReason, exitTime, config, pipValue) {
        trade.exitPrice = exitPrice;
        trade.exitReason = exitReason;
        trade.exitTime = exitTime;

        const priceChange = trade.side === "BUY"
            ? exitPrice - trade.entryPrice
            : trade.entryPrice - exitPrice;

        const pnlGross = trade.units * priceChange;
        const spreadCost = config.spreadPips * pipValue * trade.units;

        trade.pnlGross = pnlGross;
        trade.spreadCost = spreadCost;
        trade.pnlNet = pnlGross - spreadCost;
        trade.pnlPips = priceChange / pipValue - config.spreadPips;
        trade.holdingPeriodSeconds = exitTime - trade.entryTime;
    }

    /**
     * Build the final result object with summary stats
     */
    _buildResult(trades, equityCurve, config) {
        if (trades.length === 0) {
            return {
                trades: [],
                summary: this._emptySummary(config),
                equityCurve,
                config,
            };
        }

        const winners = trades.filter((t) => t.pnlNet > 0);
        const losers = trades.filter((t) => t.pnlNet <= 0);

        const totalPnl = trades.reduce((sum, t) => sum + t.pnlNet, 0);
        const avgWin = winners.length > 0
            ? winners.reduce((sum, t) => sum + t.pnlNet, 0) / winners.length
            : 0;
        const avgLoss = losers.length > 0
            ? Math.abs(losers.reduce((sum, t) => sum + t.pnlNet, 0) / losers.length)
            : 0;

        const grossProfit = winners.reduce((sum, t) => sum + t.pnlNet, 0);
        const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnlNet, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        const expectancy = trades.reduce((sum, t) => sum + t.pnlNet, 0) / trades.length;

        // Calculate max drawdown from equity curve
        let peak = config.initialBalance;
        let maxDrawdown = 0;
        let maxDrawdownPercent = 0;
        for (const point of equityCurve) {
            if (point.equity > peak) peak = point.equity;
            const drawdown = peak - point.equity;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
                maxDrawdownPercent = (drawdown / peak) * 100;
            }
        }

        // Average risk:reward ratio
        const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

        // Breakdown by entry type
        const byEntryType = {};
        for (const trade of trades) {
            const type = trade.entryType || "UNKNOWN";
            if (!byEntryType[type]) {
                byEntryType[type] = { count: 0, wins: 0, pnl: 0 };
            }
            byEntryType[type].count++;
            if (trade.pnlNet > 0) byEntryType[type].wins++;
            byEntryType[type].pnl += trade.pnlNet;
        }
        for (const key of Object.keys(byEntryType)) {
            byEntryType[key].winRate = byEntryType[key].count > 0
                ? byEntryType[key].wins / byEntryType[key].count
                : 0;
        }

        // Breakdown by exit reason
        const byExitReason = {};
        for (const trade of trades) {
            const reason = trade.exitReason || "UNKNOWN";
            if (!byExitReason[reason]) {
                byExitReason[reason] = { count: 0, pnl: 0 };
            }
            byExitReason[reason].count++;
            byExitReason[reason].pnl += trade.pnlNet;
        }

        const endBalance = config.initialBalance + totalPnl;

        return {
            trades,
            summary: {
                totalTrades: trades.length,
                winners: winners.length,
                losers: losers.length,
                winRate: winners.length / trades.length,
                avgWin,
                avgLoss,
                profitFactor,
                expectancy,
                totalPnl,
                maxDrawdown,
                maxDrawdownPercent,
                avgRR,
                byEntryType,
                byExitReason,
                startBalance: config.initialBalance,
                endBalance,
                returnPercent: ((endBalance - config.initialBalance) / config.initialBalance) * 100,
            },
            equityCurve,
            config,
        };
    }

    _emptyResult(config) {
        return {
            trades: [],
            summary: this._emptySummary(config),
            equityCurve: [],
            config,
        };
    }

    _emptySummary(config) {
        return {
            totalTrades: 0,
            winners: 0,
            losers: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            profitFactor: 0,
            expectancy: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            maxDrawdownPercent: 0,
            avgRR: 0,
            byEntryType: {},
            byExitReason: {},
            startBalance: config.initialBalance,
            endBalance: config.initialBalance,
            returnPercent: 0,
        };
    }
}

module.exports = BacktestEngine;
