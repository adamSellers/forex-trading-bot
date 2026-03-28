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
const sharedTradingDefaults = require("../../../shared/tradingConfigDefaults.json");

function toFiniteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function toBoolean(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off", ""].includes(normalized)) {
            return false;
        }
    }

    return Boolean(value);
}

function toString(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// Defaults tuned to the live signal/config surface. The engine still accepts
// older backtest aliases and normalizes them in _normalizeConfig().
const DEFAULTS = {
    // Strategy
    atrPeriod: sharedTradingDefaults.supertrendPeriod,
    factor: sharedTradingDefaults.supertrendMultiplier,
    enableAdxFilter: sharedTradingDefaults.enableAdxFilter,
    minAdx: sharedTradingDefaults.minAdx,
    adxSlopeFilter: sharedTradingDefaults.adxSlopeFilter,
    adxSlopeLookback: sharedTradingDefaults.adxSlopeLookback,
    requireDirectionalAdx: sharedTradingDefaults.requireDirectionalAdx,
    enableRsiFilter: sharedTradingDefaults.enableRsiFilter,
    longRsiMomentumFloor: sharedTradingDefaults.longRsiMomentumFloor,
    shortRsiMomentumCeiling: sharedTradingDefaults.shortRsiMomentumCeiling,
    freshLongRsiCeiling: sharedTradingDefaults.freshLongRsiCeiling,
    rsiOverbought: sharedTradingDefaults.rsiOverbought,
    rsiOversold: sharedTradingDefaults.rsiOversold,

    // Continuation
    enableContinuationEntry: sharedTradingDefaults.enableContinuationEntry,
    enableLongContinuationEntry:
        sharedTradingDefaults.enableLongContinuationEntry,
    enableShortContinuationEntry:
        sharedTradingDefaults.enableShortContinuationEntry,
    continuationWindowSeconds:
        sharedTradingDefaults.continuationWindowMs / 1000,
    continuationRsiThreshold:
        sharedTradingDefaults.continuationRsiThreshold,
    continuationMaxPriceDeviation:
        sharedTradingDefaults.continuationMaxPriceDeviation,
    continuationPullbackMinAtr:
        sharedTradingDefaults.continuationPullbackMinAtr,
    continuationPullbackMaxAtr:
        sharedTradingDefaults.continuationPullbackMaxAtr,

    // Position sizing / risk
    initialBalance: 500,
    riskPerTrade: sharedTradingDefaults.riskPerTrade,
    freshFlipRiskMultiplier: sharedTradingDefaults.freshFlipRiskMultiplier,
    leverage: sharedTradingDefaults.leverage,
    marginBuffer: 0.2,
    maxOpenPositions: sharedTradingDefaults.maxOpenPositions,
    maxPortfolioExposure: sharedTradingDefaults.maxPortfolioExposure,

    // Stop loss / take profit
    stopLossType: sharedTradingDefaults.stopLossType,
    stopLossPips: sharedTradingDefaults.stopLossPips,
    stopLossAtrMultiplier: sharedTradingDefaults.stopLossAtrMultiplier,
    minStopLossPips: sharedTradingDefaults.minStopLossPips,
    enableTakeProfit: sharedTradingDefaults.enableTakeProfit,
    takeProfitPercent: sharedTradingDefaults.takeProfitPercent,

    // Stop management
    enableTrailingStops: sharedTradingDefaults.enableTrailingStops,
    trailingStopPips: sharedTradingDefaults.trailingStopPips,
    trailingStopActivationPips:
        sharedTradingDefaults.trailingStopActivationPips,
    enableBreakeven: sharedTradingDefaults.enableBreakeven,
    breakevenTriggerPips: sharedTradingDefaults.breakevenTriggerPips,

    // Directional controls
    enableShorting: sharedTradingDefaults.enableShorting,
    enableHTFFilter: sharedTradingDefaults.enableHTFFilter,
    htfTimeframe: sharedTradingDefaults.htfTimeframe,
    assets: sharedTradingDefaults.assets,
    enableSessionFilter: sharedTradingDefaults.enableSessionFilter,
    activeSessions: sharedTradingDefaults.activeSessions,

    // Simulation mode
    enableMultiTimeframe: false,
    simulateLiveEntryFilters: false,

    // Costs
    spreadPips: 1.5,
    maxSpreadPips: sharedTradingDefaults.maxSpreadPips,
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

        const config = this._normalizeConfig(configOverrides);
        const baseGranularity = config.enableMultiTimeframe
            ? "M15"
            : this._normalizeGranularity(granularity, "M15");

        const candles = await this.historicalDataService.getCandles(
            instrument,
            baseGranularity,
            fromTimestamp,
            toTimestamp
        );

        let htfCandles = null;
        if (config.enableHTFFilter) {
            const htfGranularity = this._normalizeGranularity(
                config.htfTimeframe,
                "H1"
            );
            if (htfGranularity === baseGranularity) {
                htfCandles = candles;
            } else {
                htfCandles = await this.historicalDataService.getCandles(
                    instrument,
                    htfGranularity,
                    fromTimestamp,
                    toTimestamp
                );
            }
        }

        return this.runOnCandles(candles, instrument, config, htfCandles);
    }

    /**
     * Run backtest on pre-loaded candle data (sync, for testing)
     * @param {Array<{time, open, high, low, close, volume}>} candles
     * @param {string} instrument - e.g. "AUD_USD"
     * @param {object} configOverrides
     */
    runOnCandles(candles, instrument, configOverrides = {}, htfCandles = null) {
        const config = this._normalizeConfig(configOverrides);
        const pipValue = getPipValue(instrument);

        if (!candles || candles.length < 50) {
            return this._emptyResult(config);
        }

        let m15ToH1Index = null;
        let shouldEvaluateSignal;
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

        const resolvedHtfCandles = this._deriveHtfCandles(
            candles,
            indicatorCandles,
            config,
            htfCandles
        );
        const htfTrend = this._buildHtfTrend(resolvedHtfCandles, config);
        const htfDirections = htfTrend?.directions || null;
        const htfTimes = htfTrend?.times || null;

        const highs = indicatorCandles.map((c) => c.high);
        const lows = indicatorCandles.map((c) => c.low);
        const closes = indicatorCandles.map((c) => c.close);

        const stData = calculateSuperTrend(
            highs,
            lows,
            closes,
            config.atrPeriod,
            config.factor
        );
        const rsiValues = calculateRSI(closes, 14);
        const adxValues = calculateADX(highs, lows, closes, 14);
        const atrValues = calculateATR(highs, lows, closes, 14);

        const rsiOffset = indicatorCandles.length - rsiValues.length;
        const adxOffset = indicatorCandles.length - adxValues.length;
        const atrOffset = indicatorCandles.length - atrValues.length;
        const indicatorStartIndex =
            Math.max(rsiOffset, adxOffset, atrOffset) + 1;

        let startIndex;
        if (config.enableMultiTimeframe) {
            startIndex = candles.findIndex(
                (_, idx) => m15ToH1Index[idx] >= indicatorStartIndex
            );
            if (startIndex < 0) return this._emptyResult(config);
        } else {
            startIndex = indicatorStartIndex;
            if (startIndex >= candles.length) return this._emptyResult(config);
        }

        const getIndicators = (i) => {
            const indIdx = m15ToH1Index ? m15ToH1Index[i] : i;

            const rsiIdx = indIdx - rsiOffset;
            const adxIdx = indIdx - adxOffset;
            const atrIdx = indIdx - atrOffset;

            const currentDir = stData.direction[indIdx];
            const prevDir = stData.direction[indIdx - 1];
            const rsiVal =
                rsiIdx >= 0 && rsiIdx < rsiValues.length ? rsiValues[rsiIdx] : 0;

            const adxResult =
                adxIdx >= 0 && adxIdx < adxValues.length
                    ? adxValues[adxIdx]
                    : null;
            const adxVal = adxResult?.adx || 0;
            const pdiVal = adxResult?.pdi || 0;
            const mdiVal = adxResult?.mdi || 0;

            const lookback = config.adxSlopeLookback || 3;
            const prevAdxIdx = adxIdx - lookback;
            const prevAdxResult = prevAdxIdx >= 0 ? adxValues[prevAdxIdx] : null;
            const prevAdxVal = prevAdxResult?.adx || adxVal;
            const adxRising = adxVal > prevAdxVal;

            const atrVal =
                atrIdx >= 0 && atrIdx < atrValues.length ? atrValues[atrIdx] : 0;
            const atrPips = atrVal / pipValue;

            return {
                currentDir,
                prevDir,
                rsiVal,
                adxVal,
                pdiVal,
                mdiVal,
                adxRising,
                prevAdxVal,
                atrVal,
                atrPips,
            };
        };

        let balance = config.initialBalance;
        const openPositions = [];
        let pendingEntry = null;
        let pendingSignal = null;
        const closedTrades = [];
        const equityCurve = [];

        const longContinuationEnabled = this.isLongContinuationEnabled(config);
        const shortContinuationEnabled = this.isShortContinuationEnabled(config);

        for (let i = startIndex; i < candles.length; i++) {
            const candle = candles[i];

            if (pendingEntry) {
                const entryPrice = candle.open;
                const ind = getIndicators(pendingEntry.signalCandle);
                const filterResult = this._passesSimulatedLiveEntryFilters({
                    instrument,
                    side: pendingEntry.side,
                    entryType: pendingEntry.entryType,
                    entryPrice,
                    candleTime: candle.time,
                    indicators: ind,
                    openPositions,
                    balance,
                    config,
                    pipValue,
                });

                const trade =
                    filterResult.valid && openPositions.length < config.maxOpenPositions
                        ? this._openTrade(
                              instrument,
                              pendingEntry.side,
                              pendingEntry.entryType,
                              entryPrice,
                              ind,
                              config,
                              balance,
                              pipValue
                          )
                        : null;

                if (trade) {
                    trade.entryTime = candle.time;
                    trade.entryCandle = i;
                    openPositions.push(trade);
                }
                pendingEntry = null;
            }

            for (let p = openPositions.length - 1; p >= 0; p--) {
                const trade = openPositions[p];
                const isBuy = trade.side === "BUY";

                if (config.enableBreakeven && !trade.breakevenHit) {
                    const profitPips = isBuy
                        ? (candle.high - trade.entryPrice) / pipValue
                        : (trade.entryPrice - candle.low) / pipValue;
                    if (profitPips >= config.breakevenTriggerPips) {
                        trade.stopLossPrice = trade.entryPrice;
                        trade.breakevenHit = true;
                    }
                }

                if (config.enableTrailingStops) {
                    this._updateTrailingStop(trade, candle, config, pipValue);
                }

                const effectiveSL = trade.trailingStopPrice || trade.stopLossPrice;
                const slHit = isBuy
                    ? candle.low <= effectiveSL
                    : candle.high >= effectiveSL;

                if (slHit) {
                    const exitReason = trade.trailingStopPrice
                        ? "TRAILING_STOP"
                        : "STOP_LOSS";
                    this._closeTrade(
                        trade,
                        effectiveSL,
                        exitReason,
                        candle.time,
                        config,
                        pipValue
                    );
                    closedTrades.push(trade);
                    balance += trade.pnlNet;
                    openPositions.splice(p, 1);
                    continue;
                }

                if (trade.takeProfitPrice) {
                    const tpHit = isBuy
                        ? candle.high >= trade.takeProfitPrice
                        : candle.low <= trade.takeProfitPrice;

                    if (tpHit) {
                        this._closeTrade(
                            trade,
                            trade.takeProfitPrice,
                            "TAKE_PROFIT",
                            candle.time,
                            config,
                            pipValue
                        );
                        closedTrades.push(trade);
                        balance += trade.pnlNet;
                        openPositions.splice(p, 1);
                        continue;
                    }
                }
            }

            if (shouldEvaluateSignal(i)) {
                const previousCandle = candles[i - 1];
                const ind = getIndicators(i);
                const {
                    currentDir,
                    prevDir,
                    rsiVal,
                    adxVal,
                    pdiVal,
                    mdiVal,
                    adxRising,
                    atrVal,
                } = ind;

                const adxFilterEnabled = this.isAdxFilterEnabled(config);
                const adxMeetsThreshold =
                    !adxFilterEnabled || adxVal >= config.minAdx;
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
                const htfContext = this.getHtfTrendContext(
                    htfDirections,
                    htfTimes,
                    candle.time,
                    config
                );

                const longBaseRegimeOk =
                    adxMeetsThreshold &&
                    longDiOk &&
                    htfContext.longAllowed &&
                    this.passesLongMomentum(rsiVal, config);
                const shortBaseRegimeOk =
                    adxMeetsThreshold &&
                    shortDiOk &&
                    htfContext.shortAllowed &&
                    this.passesShortMomentum(rsiVal, config);
                const freshLongEntryOk =
                    longBaseRegimeOk &&
                    adxSlopeOk &&
                    this.passesFreshLongRsiCeiling(rsiVal, config);
                const freshShortEntryOk =
                    shortBaseRegimeOk &&
                    adxSlopeOk &&
                    this.passesFreshShortRsiFloor(rsiVal, config);

                let signalType = null;
                let entryType = null;
                let signalSide = null;

                if (prevDir === -1 && currentDir === 1) {
                    if (pendingSignal && pendingSignal.direction === "SHORT") {
                        pendingSignal = null;
                    }

                    if (freshLongEntryOk) {
                        signalType = "BUY";
                        entryType = "FRESH_FLIP";
                        signalSide = "BUY";
                        pendingSignal = null;
                    } else if (longContinuationEnabled && longBaseRegimeOk) {
                        pendingSignal = this.createPullbackSetup({
                            direction: "LONG",
                            flipTime: candle.time,
                            flipPrice: candle.close,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            initialHigh: candle.high,
                            initialLow: candle.low,
                        });
                    } else if (
                        htfContext.enabled &&
                        !htfContext.longAllowed &&
                        adxMeetsThreshold &&
                        longDiOk &&
                        this.passesLongMomentum(rsiVal, config)
                    ) {
                        pendingSignal = this.createHtfConfirmationSetup({
                            direction: "LONG",
                            flipTime: candle.time,
                            flipPrice: candle.close,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            initialHigh: candle.high,
                            initialLow: candle.low,
                        });
                    }
                } else if (
                    currentDir === 1 &&
                    pendingSignal &&
                    pendingSignal.direction === "LONG"
                ) {
                    const evaluation =
                        pendingSignal.state === "AWAIT_HTF_CONFIRMATION"
                            ? this.evaluateLongHtfConfirmationSetup({
                                  pending: pendingSignal,
                                  candle,
                                  currentDir,
                                  adxMeetsThreshold,
                                  adxOk,
                                  longDiOk,
                                  longBaseRegimeOk,
                                  longContinuationEnabled,
                                  htfContext,
                                  rsiVal,
                                  adxVal,
                                  config,
                              })
                            : this.evaluateLongPullbackSetup({
                                  pending: pendingSignal,
                                  candle,
                                  previousCandle,
                                  atrVal,
                                  rsiVal,
                                  adxMeetsThreshold,
                                  adxOk,
                                  longDiOk,
                                  htfContext,
                                  config,
                              });

                    if (evaluation.clearPending) {
                        pendingSignal = null;
                    } else if (evaluation.pending) {
                        pendingSignal = evaluation.pending;
                    }

                    if (evaluation.signalType) {
                        signalType = evaluation.signalType;
                        entryType = evaluation.entryType;
                        signalSide = "BUY";
                    }
                } else if (prevDir === 1 && currentDir === -1) {
                    signalType = "SELL";

                    if (pendingSignal && pendingSignal.direction !== "SHORT") {
                        pendingSignal = null;
                    }

                    if (freshShortEntryOk) {
                        entryType = "SHORT_ENTRY";
                        signalSide = "SELL";
                        pendingSignal = null;
                    } else if (
                        htfContext.enabled &&
                        !htfContext.shortAllowed &&
                        adxMeetsThreshold &&
                        shortDiOk &&
                        this.passesShortMomentum(rsiVal, config)
                    ) {
                        pendingSignal = this.createHtfConfirmationSetup({
                            direction: "SHORT",
                            flipTime: candle.time,
                            flipPrice: candle.close,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            initialHigh: candle.high,
                            initialLow: candle.low,
                        });
                        entryType = "EXIT_ONLY";
                    } else if (shortContinuationEnabled && shortBaseRegimeOk) {
                        pendingSignal = this.createPullbackSetup({
                            direction: "SHORT",
                            flipTime: candle.time,
                            flipPrice: candle.close,
                            flipAdx: adxVal,
                            flipRsi: rsiVal,
                            initialHigh: candle.high,
                            initialLow: candle.low,
                        });
                        entryType = "EXIT_ONLY";
                    } else {
                        entryType = "EXIT_ONLY";
                    }
                } else if (
                    currentDir === -1 &&
                    pendingSignal &&
                    pendingSignal.direction === "SHORT"
                ) {
                    const evaluation =
                        pendingSignal.state === "AWAIT_HTF_CONFIRMATION"
                            ? this.evaluateShortHtfConfirmationSetup({
                                  pending: pendingSignal,
                                  candle,
                                  currentDir,
                                  adxMeetsThreshold,
                                  adxOk,
                                  shortDiOk,
                                  shortBaseRegimeOk,
                                  shortContinuationEnabled,
                                  htfContext,
                                  rsiVal,
                                  adxVal,
                                  config,
                              })
                            : this.evaluateShortPullbackSetup({
                                  pending: pendingSignal,
                                  candle,
                                  previousCandle,
                                  atrVal,
                                  rsiVal,
                                  adxMeetsThreshold,
                                  adxOk,
                                  shortDiOk,
                                  htfContext,
                                  config,
                              });

                    if (evaluation.clearPending) {
                        pendingSignal = null;
                    } else if (evaluation.pending) {
                        pendingSignal = evaluation.pending;
                    }

                    if (evaluation.signalType) {
                        signalType = evaluation.signalType;
                        entryType = evaluation.entryType;
                        signalSide = "SELL";
                    }
                }

                if (signalType === "BUY") {
                    for (let p = openPositions.length - 1; p >= 0; p--) {
                        if (
                            openPositions[p].side === "SELL" &&
                            openPositions[p].instrument === instrument
                        ) {
                            const trade = openPositions[p];
                            this._closeTrade(
                                trade,
                                candle.close,
                                "SIGNAL_REVERSAL",
                                candle.time,
                                config,
                                pipValue
                            );
                            closedTrades.push(trade);
                            balance += trade.pnlNet;
                            openPositions.splice(p, 1);
                        }
                    }
                } else if (signalType === "SELL") {
                    for (let p = openPositions.length - 1; p >= 0; p--) {
                        if (
                            openPositions[p].side === "BUY" &&
                            openPositions[p].instrument === instrument
                        ) {
                            const trade = openPositions[p];
                            this._closeTrade(
                                trade,
                                candle.close,
                                "SIGNAL_REVERSAL",
                                candle.time,
                                config,
                                pipValue
                            );
                            closedTrades.push(trade);
                            balance += trade.pnlNet;
                            openPositions.splice(p, 1);
                        }
                    }
                }

                if (signalSide && i < candles.length - 1) {
                    const alreadyHolding = openPositions.some(
                        (t) =>
                            t.instrument === instrument && t.side === signalSide
                    );

                    if (!alreadyHolding) {
                        pendingEntry = {
                            side: signalSide,
                            entryType,
                            signalCandle: i,
                        };
                    }
                }

            }

            let unrealizedPnl = 0;
            for (const pos of openPositions) {
                const priceChange =
                    pos.side === "BUY"
                        ? candle.close - pos.entryPrice
                        : pos.entryPrice - candle.close;
                unrealizedPnl += pos.units * priceChange;
            }
            equityCurve.push({ time: candle.time, equity: balance + unrealizedPnl });
        }

        const lastCandle = candles[candles.length - 1];
        for (const trade of openPositions) {
            this._closeTrade(
                trade,
                lastCandle.close,
                "BACKTEST_END",
                lastCandle.time,
                config,
                pipValue
            );
            closedTrades.push(trade);
            balance += trade.pnlNet;
        }

        equityCurve.push({ time: lastCandle.time, equity: balance });

        return this._buildResult(closedTrades, equityCurve, config);
    }

    isAdxFilterEnabled(config) {
        return config.enableAdxFilter !== false;
    }

    isRsiFilterEnabled(config) {
        return config.enableRsiFilter !== false;
    }

    getLongMomentumFloor(config) {
        return config.longRsiMomentumFloor || 52;
    }

    getShortMomentumCeiling(config) {
        return config.shortRsiMomentumCeiling || 48;
    }

    getFreshLongRsiCeiling(config) {
        return config.freshLongRsiCeiling || config.rsiOverbought || 75;
    }

    passesLongMomentum(rsiVal, config) {
        return !this.isRsiFilterEnabled(config) || rsiVal >= this.getLongMomentumFloor(config);
    }

    passesShortMomentum(rsiVal, config) {
        return !this.isRsiFilterEnabled(config) || rsiVal <= this.getShortMomentumCeiling(config);
    }

    passesFreshLongRsiCeiling(rsiVal, config) {
        return !this.isRsiFilterEnabled(config) || rsiVal < this.getFreshLongRsiCeiling(config);
    }

    passesLongOverboughtCeiling(rsiVal, config) {
        return !this.isRsiFilterEnabled(config) || rsiVal < config.rsiOverbought;
    }

    passesFreshShortRsiFloor(rsiVal, config) {
        return !this.isRsiFilterEnabled(config) || rsiVal > config.rsiOversold;
    }

    isLongContinuationEnabled(config) {
        if (config.enableContinuationEntry === false) return false;
        return config.enableLongContinuationEntry !== false;
    }

    isShortContinuationEnabled(config) {
        if (config.enableContinuationEntry === false) return false;
        return config.enableShortContinuationEntry !== false;
    }

    createPullbackSetup({
        direction,
        flipTime,
        flipPrice,
        flipAdx,
        flipRsi,
        initialHigh,
        initialLow,
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
    }) {
        return this.createPullbackSetup({
            direction,
            flipTime: currentTime,
            flipPrice: currentPrice,
            flipAdx: currentAdx,
            flipRsi: currentRsi,
            initialHigh: currentHigh,
            initialLow: currentLow,
        });
    }

    evaluateLongHtfConfirmationSetup({
        pending,
        candle,
        currentDir,
        adxMeetsThreshold,
        adxOk,
        longDiOk,
        longBaseRegimeOk,
        longContinuationEnabled,
        htfContext,
        rsiVal,
        adxVal,
        config,
    }) {
        const ageSec = candle.time - pending.flipTime;
        if (ageSec > config.continuationWindowSeconds) {
            return { clearPending: true };
        }

        if (currentDir !== 1) {
            return { clearPending: true };
        }

        const updatedPeakPrice = Math.max(
            pending.peakPrice || pending.flipPrice,
            candle.high
        );

        if (htfContext.enabled && !htfContext.longAllowed) {
            if (
                !adxMeetsThreshold ||
                !longDiOk ||
                !this.passesLongMomentum(rsiVal, config)
            ) {
                return { clearPending: true };
            }

            return {
                pending: {
                    ...pending,
                    peakPrice: updatedPeakPrice,
                },
            };
        }

        if (!longBaseRegimeOk) {
            return { clearPending: true };
        }

        const priceDeviation =
            pending.flipPrice > 0
                ? Math.max(
                      0,
                      (candle.close - pending.flipPrice) / pending.flipPrice
                  )
                : 0;
        const isChaseable = priceDeviation <= config.continuationMaxPriceDeviation;

        if (adxOk && this.passesLongOverboughtCeiling(rsiVal, config) && isChaseable) {
            return {
                signalType: "BUY",
                entryType: "HTF_CONFIRMATION",
                clearPending: true,
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
                        initialLow: candle.low,
                    }),
                    peakPrice: updatedPeakPrice,
                },
            };
        }

        return { clearPending: true };
    }

    evaluateShortHtfConfirmationSetup({
        pending,
        candle,
        currentDir,
        adxMeetsThreshold,
        adxOk,
        shortDiOk,
        shortBaseRegimeOk,
        shortContinuationEnabled,
        htfContext,
        rsiVal,
        adxVal,
        config,
    }) {
        const ageSec = candle.time - pending.flipTime;
        if (ageSec > config.continuationWindowSeconds) {
            return { clearPending: true };
        }

        if (currentDir !== -1) {
            return { clearPending: true };
        }

        const updatedTroughPrice = Math.min(
            pending.troughPrice || pending.flipPrice,
            candle.low
        );

        if (htfContext.enabled && !htfContext.shortAllowed) {
            if (
                !adxMeetsThreshold ||
                !shortDiOk ||
                !this.passesShortMomentum(rsiVal, config)
            ) {
                return { clearPending: true };
            }

            return {
                pending: {
                    ...pending,
                    troughPrice: updatedTroughPrice,
                },
            };
        }

        if (!shortBaseRegimeOk) {
            return { clearPending: true };
        }

        const priceDeviation =
            pending.flipPrice > 0
                ? Math.max(
                      0,
                      (pending.flipPrice - candle.close) / pending.flipPrice
                  )
                : 0;
        const isChaseable = priceDeviation <= config.continuationMaxPriceDeviation;

        if (adxOk && this.passesFreshShortRsiFloor(rsiVal, config) && isChaseable) {
            return {
                signalType: "SELL",
                entryType: "SHORT_HTF_CONFIRMATION",
                clearPending: true,
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
                        initialHigh: candle.high,
                        initialLow: updatedTroughPrice,
                    }),
                    troughPrice: updatedTroughPrice,
                },
            };
        }

        return { clearPending: true };
    }

    evaluateLongPullbackSetup({
        pending,
        candle,
        previousCandle,
        atrVal,
        rsiVal,
        adxMeetsThreshold,
        adxOk,
        longDiOk,
        htfContext,
        config,
    }) {
        if (!previousCandle) {
            return { pending };
        }

        const ageSec = candle.time - pending.flipTime;
        if (ageSec > config.continuationWindowSeconds) {
            return { clearPending: true };
        }

        if (
            (htfContext.enabled && !htfContext.longAllowed) ||
            !adxMeetsThreshold ||
            !longDiOk
        ) {
            return { clearPending: true };
        }

        const trackedPeakPrice =
            pending.state === "AWAIT_PULLBACK"
                ? Math.max(pending.peakPrice || pending.flipPrice, candle.high)
                : pending.peakPrice || pending.flipPrice;
        const pullbackDepthAtr =
            atrVal > 0 ? (trackedPeakPrice - candle.low) / atrVal : 0;
        const bearishPullbackCandle =
            candle.close < previousCandle.close || candle.low < previousCandle.low;
        const rsiCooled = rsiVal <= config.continuationRsiThreshold;

        if (pending.state === "AWAIT_PULLBACK") {
            if (pullbackDepthAtr > config.continuationPullbackMaxAtr) {
                return { clearPending: true };
            }

            if (
                bearishPullbackCandle &&
                pullbackDepthAtr >= config.continuationPullbackMinAtr &&
                rsiCooled
            ) {
                return {
                    pending: {
                        ...pending,
                        state: "AWAIT_REACCELERATION",
                        waitingFor: "REACCELERATION",
                        peakPrice: trackedPeakPrice,
                        pullbackLow: candle.low,
                        pullbackHigh: candle.high,
                        pullbackDepthAtr,
                        reaccelerationTrigger: candle.high,
                        pullbackDetectedTime: candle.time,
                    },
                };
            }

            return {
                pending: {
                    ...pending,
                    peakPrice: trackedPeakPrice,
                },
            };
        }

        const breakoutTrigger =
            pending.reaccelerationTrigger ||
            pending.pullbackHigh ||
            previousCandle.high;
        const updatedPullbackLow =
            pending.pullbackLow == null
                ? candle.low
                : Math.min(pending.pullbackLow, candle.low);
        const updatedPullbackHigh =
            pending.pullbackHigh == null
                ? candle.high
                : Math.max(pending.pullbackHigh, candle.high);
        const updatedTrigger = Math.max(breakoutTrigger, candle.high);
        const updatedDepthAtr =
            atrVal > 0
                ? (pending.peakPrice - updatedPullbackLow) / atrVal
                : pending.pullbackDepthAtr || 0;

        if (updatedDepthAtr > config.continuationPullbackMaxAtr) {
            return { clearPending: true };
        }

        const bullishBreakout =
            candle.close > breakoutTrigger &&
            candle.close > previousCandle.high &&
            candle.close > candle.open;
        const reaccelerationConfirmed =
            bullishBreakout &&
            adxOk &&
            longDiOk &&
            this.passesLongMomentum(rsiVal, config) &&
            this.passesLongOverboughtCeiling(rsiVal, config) &&
            htfContext.longAllowed;

        if (reaccelerationConfirmed) {
            return {
                signalType: "BUY",
                entryType: "CONTINUATION_PULLBACK",
                clearPending: true,
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
        };
    }

    evaluateShortPullbackSetup({
        pending,
        candle,
        previousCandle,
        atrVal,
        rsiVal,
        adxMeetsThreshold,
        adxOk,
        shortDiOk,
        htfContext,
        config,
    }) {
        if (!previousCandle) {
            return { pending };
        }

        const ageSec = candle.time - pending.flipTime;
        if (ageSec > config.continuationWindowSeconds) {
            return { clearPending: true };
        }

        if (
            (htfContext.enabled && !htfContext.shortAllowed) ||
            !adxMeetsThreshold ||
            !shortDiOk
        ) {
            return { clearPending: true };
        }

        const trackedTroughPrice =
            pending.state === "AWAIT_PULLBACK"
                ? Math.min(pending.troughPrice || pending.flipPrice, candle.low)
                : pending.troughPrice || pending.flipPrice;
        const pullbackDepthAtr =
            atrVal > 0 ? (candle.high - trackedTroughPrice) / atrVal : 0;
        const bullishPullbackCandle =
            candle.close > previousCandle.close ||
            candle.high > previousCandle.high;
        const rsiRecovered =
            !this.isRsiFilterEnabled(config) ||
            rsiVal >= this.getShortMomentumCeiling(config);

        if (pending.state === "AWAIT_PULLBACK") {
            if (pullbackDepthAtr > config.continuationPullbackMaxAtr) {
                return { clearPending: true };
            }

            if (
                bullishPullbackCandle &&
                pullbackDepthAtr >= config.continuationPullbackMinAtr &&
                rsiRecovered
            ) {
                return {
                    pending: {
                        ...pending,
                        state: "AWAIT_REACCELERATION",
                        waitingFor: "REACCELERATION",
                        troughPrice: trackedTroughPrice,
                        pullbackLow: candle.low,
                        pullbackHigh: candle.high,
                        pullbackDepthAtr,
                        reaccelerationTrigger: candle.low,
                        pullbackDetectedTime: candle.time,
                    },
                };
            }

            return {
                pending: {
                    ...pending,
                    troughPrice: trackedTroughPrice,
                },
            };
        }

        const breakdownTrigger =
            pending.reaccelerationTrigger ||
            pending.pullbackLow ||
            previousCandle.low;
        const updatedPullbackLow =
            pending.pullbackLow == null
                ? candle.low
                : Math.min(pending.pullbackLow, candle.low);
        const updatedPullbackHigh =
            pending.pullbackHigh == null
                ? candle.high
                : Math.max(pending.pullbackHigh, candle.high);
        const updatedTrigger = Math.min(breakdownTrigger, candle.low);
        const updatedDepthAtr =
            atrVal > 0
                ? (updatedPullbackHigh - pending.troughPrice) / atrVal
                : pending.pullbackDepthAtr || 0;

        if (updatedDepthAtr > config.continuationPullbackMaxAtr) {
            return { clearPending: true };
        }

        const bearishBreakdown =
            candle.close < breakdownTrigger &&
            candle.close < previousCandle.low &&
            candle.close < candle.open;
        const reaccelerationConfirmed =
            bearishBreakdown &&
            adxOk &&
            shortDiOk &&
            this.passesShortMomentum(rsiVal, config) &&
            this.passesFreshShortRsiFloor(rsiVal, config) &&
            htfContext.shortAllowed;

        if (reaccelerationConfirmed) {
            return {
                signalType: "SELL",
                entryType: "SHORT_CONTINUATION_PULLBACK",
                clearPending: true,
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
        };
    }

    getHtfTrendContext(htfDirections, htfTimes, timestamp, config) {
        if (
            !config.enableHTFFilter ||
            !Array.isArray(htfDirections) ||
            !Array.isArray(htfTimes) ||
            htfDirections.length === 0 ||
            htfTimes.length === 0
        ) {
            return {
                enabled: false,
                timeframe: config.htfTimeframe,
                direction: 0,
                longAllowed: true,
                shortAllowed: true,
                reason: null,
            };
        }

        const direction = this._getHTFDirection(htfDirections, htfTimes, timestamp);
        if (direction === 0) {
            return {
                enabled: true,
                timeframe: config.htfTimeframe,
                direction: 0,
                longAllowed: false,
                shortAllowed: false,
                reason: `HTF ${config.htfTimeframe} unavailable`,
            };
        }

        return {
            enabled: true,
            timeframe: config.htfTimeframe,
            direction,
            longAllowed: direction === 1,
            shortAllowed: direction === -1,
            reason:
                direction === 1
                    ? `HTF ${config.htfTimeframe} uptrend`
                    : `HTF ${config.htfTimeframe} downtrend`,
        };
    }

    _normalizeConfig(configOverrides = {}) {
        const config = {
            ...DEFAULTS,
        };

        config.atrPeriod = toFiniteNumber(
            configOverrides.atrPeriod ?? configOverrides.supertrendPeriod,
            config.atrPeriod
        );
        config.factor = toFiniteNumber(
            configOverrides.factor ?? configOverrides.supertrendMultiplier,
            config.factor
        );
        config.enableAdxFilter = toBoolean(
            configOverrides.enableAdxFilter,
            config.enableAdxFilter
        );
        config.minAdx = toFiniteNumber(configOverrides.minAdx, config.minAdx);
        config.adxSlopeFilter = toBoolean(
            configOverrides.adxSlopeFilter,
            config.adxSlopeFilter
        );
        config.adxSlopeLookback = Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    configOverrides.adxSlopeLookback,
                    config.adxSlopeLookback
                )
            )
        );
        config.requireDirectionalAdx = toBoolean(
            configOverrides.requireDirectionalAdx,
            config.requireDirectionalAdx
        );
        config.enableRsiFilter = toBoolean(
            configOverrides.enableRsiFilter,
            config.enableRsiFilter
        );
        config.longRsiMomentumFloor = toFiniteNumber(
            configOverrides.longRsiMomentumFloor,
            config.longRsiMomentumFloor
        );
        config.shortRsiMomentumCeiling = toFiniteNumber(
            configOverrides.shortRsiMomentumCeiling,
            config.shortRsiMomentumCeiling
        );
        config.freshLongRsiCeiling = toFiniteNumber(
            configOverrides.freshLongRsiCeiling,
            config.freshLongRsiCeiling
        );
        config.rsiOverbought = toFiniteNumber(
            configOverrides.rsiOverbought ?? configOverrides.maxRsi,
            config.rsiOverbought
        );
        config.rsiOversold = toFiniteNumber(
            configOverrides.rsiOversold,
            config.rsiOversold
        );

        config.enableContinuationEntry = toBoolean(
            configOverrides.enableContinuationEntry,
            config.enableContinuationEntry
        );
        config.enableLongContinuationEntry = toBoolean(
            configOverrides.enableLongContinuationEntry,
            config.enableLongContinuationEntry
        );
        config.enableShortContinuationEntry = toBoolean(
            configOverrides.enableShortContinuationEntry,
            config.enableShortContinuationEntry
        );
        const continuationWindowSeconds = Number(
            configOverrides.continuationWindowSeconds
        );
        const continuationWindowMs = Number(configOverrides.continuationWindowMs);
        config.continuationWindowSeconds = Number.isFinite(
            continuationWindowSeconds
        )
            ? Math.max(1, Math.floor(continuationWindowSeconds))
            : Number.isFinite(continuationWindowMs)
            ? Math.max(1, Math.floor(continuationWindowMs / 1000))
            : config.continuationWindowSeconds;
        config.continuationRsiThreshold = toFiniteNumber(
            configOverrides.continuationRsiThreshold,
            config.continuationRsiThreshold
        );
        config.continuationMaxPriceDeviation = toFiniteNumber(
            configOverrides.continuationMaxPriceDeviation,
            config.continuationMaxPriceDeviation
        );
        config.continuationPullbackMinAtr = toFiniteNumber(
            configOverrides.continuationPullbackMinAtr,
            config.continuationPullbackMinAtr
        );
        config.continuationPullbackMaxAtr = toFiniteNumber(
            configOverrides.continuationPullbackMaxAtr,
            config.continuationPullbackMaxAtr
        );

        config.initialBalance = toFiniteNumber(
            configOverrides.initialBalance ?? configOverrides.balance,
            config.initialBalance
        );
        config.riskPerTrade = toFiniteNumber(
            configOverrides.riskPerTrade,
            config.riskPerTrade
        );
        config.freshFlipRiskMultiplier = toFiniteNumber(
            configOverrides.freshFlipRiskMultiplier,
            config.freshFlipRiskMultiplier
        );
        config.leverage = toFiniteNumber(
            configOverrides.leverage,
            config.leverage
        );
        config.marginBuffer = toFiniteNumber(
            configOverrides.marginBuffer,
            config.marginBuffer
        );
        config.maxOpenPositions = Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    configOverrides.maxOpenPositions,
                    config.maxOpenPositions
                )
            )
        );
        config.maxPortfolioExposure = toFiniteNumber(
            configOverrides.maxPortfolioExposure,
            config.maxPortfolioExposure
        );

        config.stopLossType = toString(
            configOverrides.stopLossType,
            config.stopLossType
        ).toUpperCase();
        config.stopLossPips = toFiniteNumber(
            configOverrides.stopLossPips,
            config.stopLossPips
        );
        config.stopLossAtrMultiplier = toFiniteNumber(
            configOverrides.stopLossAtrMultiplier ?? configOverrides.stopLossATR,
            config.stopLossAtrMultiplier
        );
        config.minStopLossPips = toFiniteNumber(
            configOverrides.minStopLossPips,
            config.minStopLossPips
        );

        config.enableTakeProfit = toBoolean(
            configOverrides.enableTakeProfit,
            config.enableTakeProfit
        );
        config.takeProfitPercent = toFiniteNumber(
            configOverrides.takeProfitPercent,
            config.takeProfitPercent
        );

        config.enableTrailingStops = toBoolean(
            configOverrides.enableTrailingStops,
            config.enableTrailingStops
        );
        config.trailingStopPips = toFiniteNumber(
            configOverrides.trailingStopPips,
            config.trailingStopPips
        );
        config.trailingStopActivationPips = toFiniteNumber(
            configOverrides.trailingStopActivationPips,
            config.trailingStopActivationPips
        );

        config.enableBreakeven = toBoolean(
            configOverrides.enableBreakeven,
            config.enableBreakeven
        );
        config.breakevenTriggerPips = toFiniteNumber(
            configOverrides.breakevenTriggerPips,
            config.breakevenTriggerPips
        );

        config.enableShorting = toBoolean(
            configOverrides.enableShorting,
            config.enableShorting
        );
        config.assets = Array.isArray(configOverrides.assets)
            ? configOverrides.assets.filter(Boolean)
            : config.assets;
        config.enableHTFFilter = toBoolean(
            configOverrides.enableHTFFilter,
            config.enableHTFFilter
        );
        config.htfTimeframe = toString(
            configOverrides.htfTimeframe,
            config.htfTimeframe
        ).toLowerCase();
        config.enableMultiTimeframe = toBoolean(
            configOverrides.enableMultiTimeframe,
            config.enableMultiTimeframe
        );
        config.simulateLiveEntryFilters = toBoolean(
            configOverrides.simulateLiveEntryFilters,
            config.simulateLiveEntryFilters
        );
        config.enableSessionFilter = toBoolean(
            configOverrides.enableSessionFilter,
            config.enableSessionFilter
        );
        config.activeSessions = Array.isArray(configOverrides.activeSessions)
            ? configOverrides.activeSessions.filter(Boolean)
            : config.activeSessions;
        config.spreadPips = toFiniteNumber(
            configOverrides.spreadPips,
            config.spreadPips
        );
        config.maxSpreadPips = toFiniteNumber(
            configOverrides.maxSpreadPips,
            config.maxSpreadPips
        );

        return config;
    }

    _normalizeGranularity(value, fallback = "M15") {
        const raw = toString(value, fallback)
            .toUpperCase()
            .replace(/\s+/g, "");

        switch (raw) {
            case "15M":
            case "M15":
                return "M15";
            case "1H":
            case "H1":
            case "60M":
                return "H1";
            case "4H":
            case "H4":
            case "240M":
                return "H4";
            case "1D":
            case "D":
            case "D1":
                return "D";
            default:
                return raw;
        }
    }

    _intervalSecondsForGranularity(granularity) {
        switch (this._normalizeGranularity(granularity, "M15")) {
            case "M15":
                return 15 * 60;
            case "H1":
                return 60 * 60;
            case "H4":
                return 4 * 60 * 60;
            case "D":
                return 24 * 60 * 60;
            default:
                return null;
        }
    }

    _inferCandleSeconds(candles) {
        if (!Array.isArray(candles) || candles.length < 2) {
            return null;
        }

        let smallestPositive = null;
        for (let i = 1; i < candles.length; i++) {
            const delta = Number(candles[i].time) - Number(candles[i - 1].time);
            if (delta > 0 && (smallestPositive == null || delta < smallestPositive)) {
                smallestPositive = delta;
            }
        }

        return smallestPositive;
    }

    _aggregateCandles(candles, intervalSeconds) {
        const targetCandles = [];
        const sourceToTargetIndex = new Array(candles.length);
        const completionIndices = new Set();

        let currentBucket = null;
        let targetIdx = -1;

        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            const bucket = Math.floor(candle.time / intervalSeconds) * intervalSeconds;

            if (bucket !== currentBucket) {
                if (targetIdx >= 0 && i > 0) {
                    completionIndices.add(i - 1);
                }

                currentBucket = bucket;
                targetIdx++;
                targetCandles.push({
                    time: bucket,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume || 0,
                });
            } else {
                const target = targetCandles[targetIdx];
                target.high = Math.max(target.high, candle.high);
                target.low = Math.min(target.low, candle.low);
                target.close = candle.close;
                target.volume += candle.volume || 0;
            }

            sourceToTargetIndex[i] = targetIdx;
        }

        return { targetCandles, sourceToTargetIndex, completionIndices };
    }

    _deriveHtfCandles(candles, indicatorCandles, config, explicitHtfCandles) {
        if (Array.isArray(explicitHtfCandles) && explicitHtfCandles.length > 0) {
            return explicitHtfCandles;
        }

        if (!config.enableHTFFilter) {
            return null;
        }

        const htfGranularity = this._normalizeGranularity(config.htfTimeframe, "H1");
        if (
            config.enableMultiTimeframe &&
            htfGranularity === "H1" &&
            Array.isArray(indicatorCandles)
        ) {
            return indicatorCandles;
        }

        const targetSeconds = this._intervalSecondsForGranularity(htfGranularity);
        const baseSeconds = this._inferCandleSeconds(candles);
        if (!targetSeconds || !baseSeconds) {
            return null;
        }

        if (targetSeconds === baseSeconds) {
            return candles;
        }

        if (targetSeconds > baseSeconds && targetSeconds % baseSeconds === 0) {
            return this._aggregateCandles(candles, targetSeconds).targetCandles;
        }

        return null;
    }

    _buildHtfTrend(htfCandles, config) {
        if (!Array.isArray(htfCandles) || htfCandles.length < 50) {
            return null;
        }

        const highs = htfCandles.map((c) => c.high);
        const lows = htfCandles.map((c) => c.low);
        const closes = htfCandles.map((c) => c.close);
        const stData = calculateSuperTrend(
            highs,
            lows,
            closes,
            config.atrPeriod,
            config.factor
        );

        return {
            directions: stData.direction,
            times: htfCandles.map((c) => c.time),
        };
    }

    _calculateRiskPerTrade(entryType, config) {
        const baseRisk = toFiniteNumber(config.riskPerTrade, DEFAULTS.riskPerTrade);
        if (entryType === "FRESH_FLIP") {
            return Math.max(
                0,
                baseRisk *
                    toFiniteNumber(
                        config.freshFlipRiskMultiplier,
                        DEFAULTS.freshFlipRiskMultiplier
                    )
            );
        }

        return Math.max(0, baseRisk);
    }

    _estimateTradeSizing(
        side,
        entryType,
        entryPrice,
        indicators,
        config,
        balance,
        pipValue
    ) {
        const stopLossPips = this._calculateStopLossPips(
            indicators.atrPips,
            config
        );
        const stopLossPrice =
            side === "BUY"
                ? entryPrice - stopLossPips * pipValue
                : entryPrice + stopLossPips * pipValue;

        const safeMargin = balance * (1 - config.marginBuffer);
        if (safeMargin <= 0) return null;

        const riskAmount = safeMargin * this._calculateRiskPerTrade(entryType, config);
        const units = Math.floor(riskAmount / (stopLossPips * pipValue));
        if (units < 1) return null;

        const marginUsed = (units * entryPrice) / config.leverage;

        return {
            stopLossPips,
            stopLossPrice,
            units,
            marginUsed,
            riskAmount,
        };
    }

    _isWithinActiveSession(hourUtc, activeSessions = []) {
        const sessionHours = {
            sydney: { start: 21, end: 6 },
            tokyo: { start: 0, end: 9 },
            london: { start: 7, end: 16 },
            newyork: { start: 12, end: 21 },
        };

        return activeSessions.some((sessionName) => {
            const session = sessionHours[sessionName];
            if (!session) return false;

            if (session.start > session.end) {
                return hourUtc >= session.start || hourUtc < session.end;
            }

            return hourUtc >= session.start && hourUtc < session.end;
        });
    }

    _passesSimulatedLiveEntryFilters({
        instrument,
        side,
        entryType,
        entryPrice,
        candleTime,
        indicators,
        openPositions,
        balance,
        config,
        pipValue,
    }) {
        if (!config.simulateLiveEntryFilters) {
            return { valid: true };
        }

        if (Array.isArray(config.assets) && config.assets.length > 0) {
            if (!config.assets.includes(instrument)) {
                return { valid: false, reason: "inactive_asset" };
            }
        }

        if (side === "SELL" && !config.enableShorting) {
            return { valid: false, reason: "short_disabled" };
        }

        if (config.enableSessionFilter) {
            const activeSessions = Array.isArray(config.activeSessions)
                ? config.activeSessions
                : [];
            if (
                activeSessions.length === 0 ||
                !this._isWithinActiveSession(
                    new Date(candleTime * 1000).getUTCHours(),
                    activeSessions
                )
            ) {
                return { valid: false, reason: "outside_session" };
            }
        }

        if (openPositions.length >= config.maxOpenPositions) {
            return { valid: false, reason: "max_positions" };
        }

        if (
            Number.isFinite(config.maxSpreadPips) &&
            config.maxSpreadPips > 0 &&
            Number.isFinite(config.spreadPips) &&
            config.spreadPips > config.maxSpreadPips
        ) {
            return { valid: false, reason: "spread_too_wide" };
        }

        if (
            Number.isFinite(config.maxPortfolioExposure) &&
            config.maxPortfolioExposure > 0
        ) {
            const estimate = this._estimateTradeSizing(
                side,
                entryType,
                entryPrice,
                indicators,
                config,
                balance,
                pipValue
            );
            if (!estimate) {
                return { valid: false, reason: "position_size_too_small" };
            }

            const currentMarginUsed = openPositions.reduce(
                (sum, position) => sum + toFiniteNumber(position.marginUsed, 0),
                0
            );
            const projectedExposure =
                balance > 0
                    ? (currentMarginUsed + estimate.marginUsed) / balance
                    : Infinity;

            if (projectedExposure >= config.maxPortfolioExposure) {
                return { valid: false, reason: "exposure_limit" };
            }
        }

        return { valid: true };
    }

    _openTrade(instrument, side, entryType, entryPrice, indicators, config, balance, pipValue) {
        const sizing = this._estimateTradeSizing(
            side,
            entryType,
            entryPrice,
            indicators,
            config,
            balance,
            pipValue
        );
        if (!sizing) return null;

        const { stopLossPips, stopLossPrice, units, marginUsed } = sizing;

        let takeProfitPrice = null;
        if (config.enableTakeProfit && marginUsed > 0) {
            const targetProfit = marginUsed * config.takeProfitPercent;
            const priceChange = targetProfit / units;
            takeProfitPrice =
                side === "BUY"
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
            entryTime: null,
            entryCandle: null,
        };
    }

    _calculateStopLossPips(atrPips, config) {
        let stopLossPips;
        if (config.stopLossType === "ATR" && atrPips > 0) {
            stopLossPips = atrPips * config.stopLossAtrMultiplier;
        } else {
            stopLossPips = config.stopLossPips || 30;
        }
        return Math.max(stopLossPips, config.minStopLossPips);
    }

    _updateTrailingStop(trade, candle, config, pipValue) {
        const isBuy = trade.side === "BUY";
        const trailingPips = config.trailingStopPips;
        const activationPips = config.trailingStopActivationPips;

        if (isBuy) {
            trade.highestPrice = Math.max(
                trade.highestPrice || trade.entryPrice,
                candle.high
            );
        } else {
            trade.lowestPrice = Math.min(
                trade.lowestPrice || trade.entryPrice,
                candle.low
            );
        }

        const profitPips = isBuy
            ? (trade.highestPrice - trade.entryPrice) / pipValue
            : (trade.entryPrice - trade.lowestPrice) / pipValue;

        if (profitPips < activationPips) return;

        const newStop = isBuy
            ? trade.highestPrice - trailingPips * pipValue
            : trade.lowestPrice + trailingPips * pipValue;
        const shouldUpdate = isBuy
            ? !trade.trailingStopPrice || newStop > trade.trailingStopPrice
            : !trade.trailingStopPrice || newStop < trade.trailingStopPrice;

        if (shouldUpdate) {
            trade.trailingStopPrice = newStop;
        }
    }

    _getHTFDirection(htfDirections, htfTimes, timestamp) {
        let lo = 0;
        let hi = htfTimes.length - 1;
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

        if (result < 0) return 0;
        return htfDirections[result];
    }

    _checkHTFFilter(htfDirections, htfTimes, timestamp, signalSide) {
        const htfDir = this._getHTFDirection(htfDirections, htfTimes, timestamp);
        if (htfDir === 0) return true;
        if (signalSide === "BUY") return htfDir === 1;
        if (signalSide === "SELL") return htfDir === -1;
        return true;
    }

    _aggregateToH1(m15Candles) {
        const agg = this._aggregateCandles(m15Candles, 60 * 60);
        return {
            h1Candles: agg.targetCandles,
            m15ToH1Index: agg.sourceToTargetIndex,
            h1CompletionM15Indices: agg.completionIndices,
        };
    }

    _closeTrade(trade, exitPrice, exitReason, exitTime, config, pipValue) {
        trade.exitPrice = exitPrice;
        trade.exitReason = exitReason;
        trade.exitTime = exitTime;

        const priceChange =
            trade.side === "BUY"
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
        const avgWin =
            winners.length > 0
                ? winners.reduce((sum, t) => sum + t.pnlNet, 0) / winners.length
                : 0;
        const avgLoss =
            losers.length > 0
                ? Math.abs(
                      losers.reduce((sum, t) => sum + t.pnlNet, 0) /
                          losers.length
                  )
                : 0;

        const grossProfit = winners.reduce((sum, t) => sum + t.pnlNet, 0);
        const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnlNet, 0));
        const profitFactor =
            grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        const expectancy = totalPnl / trades.length;

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

        const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

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
            byEntryType[key].winRate =
                byEntryType[key].count > 0
                    ? byEntryType[key].wins / byEntryType[key].count
                    : 0;
        }

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
                returnPercent:
                    ((endBalance - config.initialBalance) /
                        config.initialBalance) *
                    100,
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
