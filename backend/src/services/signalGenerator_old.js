// backend/src/services/signalGenerator.js
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { RSI, ADX, SMA, EMA, ATR } = require("technicalindicators");

class SignalGenerator extends EventEmitter {
    constructor(config = {}) {
        super();

        this.isRunning = false;
        this.signalInterval = null;
        this.binanceDataService = null;

        this.config = {
            strategy: config.strategy || "balanced",
            timeframe: config.timeframe || "1h",
            signalCooldown: config.signalCooldown || 60000,
            minStrength: config.minStrength || 20, // Interpreted as Min ADX strength now
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
                "TRUMPUSDT",
            ],

            // --- NEW: Advanced Filter Config ---
            enableAdxFilter: config.enableAdxFilter !== false,
            adxPeriod: config.adxPeriod || 14,
            minAdx: config.minAdx || 25, // Below 25 is considered "Chop/Ranging"

            enableRsiFilter: config.enableRsiFilter !== false,
            rsiPeriod: config.rsiPeriod || 14,
            rsiOverbought: config.rsiOverbought || 70,
            rsiOversold: config.rsiOversold || 30,

            // Volatility Config
            atrPeriod: config.atrPeriod || 14,

            ...config,
        };

        this.strategyConfig = {
            conservative: { fast: 50, slow: 200, type: "SMA" },
            balanced: { fast: 20, slow: 50, type: "EMA" },
            responsive: { fast: 12, slow: 26, type: "EMA" },
        };

        this.lastSignals = new Map();
        this.signalHistory = [];

        logger.info(
            `🎯 SMART Signal Generator initialized - Strategy: ${this.config.strategy} | ADX Filter: ${this.config.enableAdxFilter}`
        );
    }

    start(binanceDataService, intervalMs = 60000) {
        if (this.isRunning) return;

        logger.info(`🎯 Starting Signal Generator loop (${intervalMs}ms)...`);
        this.binanceDataService = binanceDataService;
        this.isRunning = true;

        this.generateSignalCycle(); // Immediate run
        this.signalInterval = setInterval(() => {
            if (this.isRunning) this.generateSignalCycle();
        }, intervalMs);

        this.emit("generatorStarted");
    }

    stop() {
        this.isRunning = false;
        if (this.signalInterval) {
            clearInterval(this.signalInterval);
            this.signalInterval = null;
        }
        logger.info("🛑 Signal Generator stopped");
        this.emit("generatorStopped");
    }

    /**
     * Core loop to process all assets
     */
    async generateSignalCycle() {
        if (!this.binanceDataService) return;

        try {
            const signals = await this.generateAllSignals(
                this.binanceDataService
            );
            if (signals.length > 0) {
                this.emit("allSignalsGenerated", signals);
                signals.forEach((s) => this.emit("signalGenerated", s));
                logger.info(`📡 Generated ${signals.length} signals`);
            }
        } catch (error) {
            logger.error("❌ Error in signal generation cycle:", error);
        }
    }

    /**
     * Helper to prepare data for technicalindicators lib
     */
    prepareInputData(candles) {
        return {
            open: candles.map((c) => c.open),
            high: candles.map((c) => c.high),
            low: candles.map((c) => c.low),
            close: candles.map((c) => c.close),
            volume: candles.map((c) => c.volume),
        };
    }

    /**
     * MAIN LOGIC: Calculates indicators and determines signal
     */
    async generateSignal(symbol, candles, currentPrice) {
        try {
            const requiredCandles = 200; // Needed for accurate ADX/EMA calc
            if (!candles || candles.length < requiredCandles) {
                return this.createSignalObject(
                    symbol,
                    "INSUFFICIENT_DATA",
                    0,
                    "Not enough candle history"
                );
            }

            const input = this.prepareInputData(candles);
            const strategy = this.strategyConfig[this.config.strategy];

            // 1. Calculate Moving Averages (The Trend Direction)
            let fastMAValues, slowMAValues;
            const maParamsFast = { values: input.close, period: strategy.fast };
            const maParamsSlow = { values: input.close, period: strategy.slow };

            if (strategy.type === "SMA") {
                fastMAValues = SMA.calculate(maParamsFast);
                slowMAValues = SMA.calculate(maParamsSlow);
            } else {
                fastMAValues = EMA.calculate(maParamsFast);
                slowMAValues = EMA.calculate(maParamsSlow);
            }

            const fastMA = fastMAValues[fastMAValues.length - 1];
            const slowMA = slowMAValues[slowMAValues.length - 1];
            const prevFastMA = fastMAValues[fastMAValues.length - 2];
            const prevSlowMA = slowMAValues[slowMAValues.length - 2];

            // 2. Calculate ADX (The Trend Strength) - CRITICAL FIX
            const adxInput = {
                high: input.high,
                low: input.low,
                close: input.close,
                period: this.config.adxPeriod,
            };
            const adxValues = ADX.calculate(adxInput);
            const currentADX = adxValues[adxValues.length - 1];

            // 3. Calculate RSI (Overbought/Oversold)
            const rsiInput = {
                values: input.close,
                period: this.config.rsiPeriod,
            };
            const rsiValues = RSI.calculate(rsiInput);
            const currentRSI = rsiValues[rsiValues.length - 1];

            // 4. Calculate ATR (Volatility)
            const atrInput = {
                high: input.high,
                low: input.low,
                close: input.close,
                period: this.config.atrPeriod,
            };
            const atrValues = ATR.calculate(atrInput);
            const currentATR = atrValues[atrValues.length - 1];
            const atrPercent = (currentATR / currentPrice) * 100;

            // --- LOGIC EVALUATION ---

            let signalType = "HOLD";
            let reason = "Monitoring";

            // Detect Crossovers
            const goldenCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
            const deathCross = prevFastMA >= prevSlowMA && fastMA < slowMA;
            const bullishHold = fastMA > slowMA;
            const bearishHold = fastMA < slowMA;

            // Filter Checks
            const isChoppy =
                this.config.enableAdxFilter &&
                currentADX.adx < this.config.minAdx;
            const isOverbought =
                this.config.enableRsiFilter &&
                currentRSI > this.config.rsiOverbought;
            const isOversold =
                this.config.enableRsiFilter &&
                currentRSI < this.config.rsiOversold;

            // DECISION TREE
            if (goldenCross) {
                if (isChoppy) {
                    signalType = "HOLD";
                    reason = `Golden Cross ignored: Market is Choppy (ADX ${currentADX.adx.toFixed(
                        1
                    )} < ${this.config.minAdx})`;
                } else if (isOverbought) {
                    signalType = "HOLD";
                    reason = `Golden Cross ignored: RSI Overbought (${currentRSI.toFixed(
                        1
                    )})`;
                } else {
                    signalType = "BUY";
                    reason = "Golden Cross + Strong Trend";
                }
            } else if (deathCross) {
                if (isChoppy) {
                    signalType = "HOLD";
                    reason = `Death Cross ignored: Market is Choppy (ADX ${currentADX.adx.toFixed(
                        1
                    )} < ${this.config.minAdx})`;
                } else if (isOversold) {
                    signalType = "HOLD";
                    reason = `Death Cross ignored: RSI Oversold (${currentRSI.toFixed(
                        1
                    )})`;
                } else {
                    signalType = "SELL";
                    reason = "Death Cross + Trend Breakdown";
                }
            } else if (bullishHold) {
                signalType = "HOLD_BULLISH";
                reason = "Trend is Up";
            } else if (bearishHold) {
                signalType = "HOLD_BEARISH";
                reason = "Trend is Down";
            }

            return {
                symbol,
                signal: signalType,
                strength: currentADX.adx, // Use ADX as the definitive strength metric
                strategy: this.config.strategy,
                message: reason,
                timestamp: Date.now(),
                data: {
                    currentPrice,
                    fastMA,
                    slowMA,
                    rsi: currentRSI,
                    adx: currentADX.adx,
                    atr: currentATR,
                    atrPercent: atrPercent,
                    isChoppy,
                    isOverbought,
                    isOversold,
                },
                // Standardizing ATR for the engine
                atr: currentATR,
                atrPercent: atrPercent,
            };
        } catch (error) {
            logger.error(`Error calculating signal for ${symbol}:`, error);
            return this.createSignalObject(symbol, "ERROR", 0, error.message);
        }
    }

    validateSignal(signal) {
        // Cooldown Check
        const key = `${signal.symbol}_${signal.signal}`;
        const lastTime = this.lastSignals.get(key) || 0;
        const now = Date.now();

        // Only apply cooldown to active actionable signals (BUY/SELL), not HOLDs
        if (
            (signal.signal === "BUY" || signal.signal === "SELL") &&
            now - lastTime < this.config.signalCooldown
        ) {
            return {
                ...signal,
                signal: "COOLDOWN",
                message: "Signal Cooldown Active",
            };
        }

        if (signal.signal === "BUY" || signal.signal === "SELL") {
            this.lastSignals.set(key, now);
        }

        return signal;
    }

    async generateAllSignals(binanceDataService) {
        const signals = [];
        for (const asset of this.config.assets) {
            try {
                const candles = binanceDataService.getCandles(
                    asset,
                    this.config.timeframe
                );
                const priceData = binanceDataService.getCurrentPrice(asset);

                if (candles.length && priceData) {
                    let signal = await this.generateSignal(
                        asset,
                        candles,
                        priceData.price
                    );
                    signal = this.validateSignal(signal);
                    signals.push(signal);

                    // Log actionable signals
                    if (signal.signal === "BUY" || signal.signal === "SELL") {
                        logger.info(
                            `🔔 ${
                                signal.signal
                            } ${asset} | Strength(ADX): ${signal.strength.toFixed(
                                1
                            )} | RSI: ${signal.data.rsi.toFixed(1)}`
                        );
                    }
                }
            } catch (err) {
                logger.error(`Failed to generate signal for ${asset}`, err);
            }
        }
        return signals;
    }

    createSignalObject(symbol, type, strength, msg) {
        return {
            symbol,
            signal: type,
            strength,
            message: msg,
            timestamp: Date.now(),
        };
    }

    // Required for Dashboard Status
    getStatus() {
        return {
            isActive: this.isRunning,
            config: this.config,
            strategyConfig: this.strategyConfig[this.config.strategy],
            lastRun: new Date().toISOString(),
        };
    }

    // Helper for System Checks
    getRequiredCandleCount() {
        return 200; // Always ensure we have enough for 200 SMA calculation
    }

    // Stub for reset if needed by controller
    reset() {
        this.lastSignals.clear();
        this.signalHistory = [];
    }

    // Stub for config update
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info("Signal Generator Config Updated");
    }
}

module.exports = SignalGenerator;
