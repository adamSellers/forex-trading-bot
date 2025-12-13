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

            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
                "TRUMPUSDT",
            ],

            // --- LEAN CONFIG DEFAULTS ---
            // Updated to match the "Golden Config" from your backtest
            enableAdxFilter: config.enableAdxFilter !== false,
            adxPeriod: config.adxPeriod || 14,
            minAdx: config.minAdx || 30, // Updated to 30 (High Volatility Requirement)

            enableRsiFilter: config.enableRsiFilter !== false,
            rsiPeriod: config.rsiPeriod || 14,
            rsiOverbought: config.rsiOverbought || 70,
            rsiOversold: config.rsiOversold || 30, // Updated to 30 (Dip Buying)

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
            `🧠 Signal Generator initialized - Strategy: Lean Snapback | Min ADX: ${this.config.minAdx}`
        );
    }

    start(binanceDataService, intervalMs = 60000) {
        if (this.isRunning) return;

        logger.info(`🚀 Starting Signal Generator loop (${intervalMs}ms)...`);
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
                logger.info(`⚡ Generated ${signals.length} signals`);
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
     * STRATEGY: Volatility Mean Reversion ("The Lean Config")
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

            // 1. Calculate Moving Averages (Kept for context & safety checks)
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

            // 2. Calculate ADX (The Trend Strength)
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

            // --- STRATEGY EVALUATION (LEAN CONFIG) ---

            let signalType = "HOLD";
            let reason = "Monitoring";

            // Conditions
            const isHighVolatility = currentADX.adx > this.config.minAdx; // > 30
            const isOversold = currentRSI < this.config.rsiOversold; // < 30
            const isOverbought = currentRSI > this.config.rsiOverbought; // > 70
            const trendBroken = fastMA < slowMA; // EMA Cross (Bearish)

            // ENTRY LOGIC: Volatility Snapback
            // Buy when the trend is powerful (High ADX) but price has dipped (Low RSI)
            if (isHighVolatility && isOversold) {
                signalType = "BUY";
                reason = `🔥 VOLATILITY SNAPBACK: Strong Trend (ADX ${currentADX.adx.toFixed(
                    0
                )}) + Oversold (RSI ${currentRSI.toFixed(0)})`;
            }

            // EXIT LOGIC: Profit Taking
            // Sell when price is overextended
            else if (isOverbought) {
                signalType = "SELL";
                reason = `💰 OVERBOUGHT EXIT: RSI ${currentRSI.toFixed(
                    0
                )} hit peak`;
            }

            // EXIT LOGIC: Safety Net (Optional - uncomment to enable)
            // If the macro trend breaks, get out to prevent bag holding
            /* else if (trendBroken) {
                 signalType = "SELL";
                 reason = "📉 SAFETY EXIT: Trend Collapse (EMA Cross)";
            }
            */
            else {
                reason = `Monitoring (ADX: ${currentADX.adx.toFixed(
                    1
                )} | RSI: ${currentRSI.toFixed(1)})`;
            }

            return {
                symbol,
                signal: signalType,
                strength: currentADX.adx, // Use ADX as the definitive strength metric
                strategy: "mean_reversion_lean",
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
                    isChoppy: !isHighVolatility,
                    isOverbought,
                    isOversold,
                },
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
                            } ${asset} | ADX: ${signal.strength.toFixed(
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
