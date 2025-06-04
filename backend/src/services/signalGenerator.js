// backend/src/services/signalGenerator.js
const TechnicalIndicators = require("./technicalIndicators");
const EventEmitter = require("events");

class SignalGenerator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            strategy: config.strategy || "balanced",
            timeframe: config.timeframe || "1h",
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],
            signalCooldown: config.signalCooldown || 60000, // 1 minute between same signals
            minStrength: config.minStrength || 0.5,
            ...config,
        };

        this.indicators = new TechnicalIndicators();
        this.lastSignals = new Map();
        this.signalHistory = [];
        this.isActive = false;
    }

    /**
     * Generate trading signals for a specific asset
     * @param {string} symbol - Asset symbol (e.g., 'BTCUSDT')
     * @param {Array} candles - Historical candle data
     * @param {number} currentPrice - Current market price
     * @returns {Object} Signal analysis result
     */
    async generateSignal(symbol, candles, currentPrice) {
        try {
            if (!candles || candles.length < 200) {
                return {
                    symbol,
                    signal: "INSUFFICIENT_DATA",
                    strength: 0,
                    message: "Insufficient candle data for analysis",
                    timestamp: Date.now(),
                };
            }

            // Calculate technical indicators based on strategy
            const indicatorConfig = {
                strategy: this.config.strategy,
                includeAll: false,
            };

            const calculatedIndicators = this.indicators.calculateAllIndicators(
                candles,
                indicatorConfig
            );

            if (calculatedIndicators.error) {
                throw new Error(calculatedIndicators.error);
            }

            // Generate signals based on strategy
            let signalResult;
            switch (this.config.strategy) {
                case "conservative":
                    signalResult = this.generateConservativeSignal(
                        calculatedIndicators.indicators,
                        currentPrice
                    );
                    break;
                case "balanced":
                    signalResult = this.generateBalancedSignal(
                        calculatedIndicators.indicators,
                        currentPrice
                    );
                    break;
                case "responsive":
                    signalResult = this.generateResponsiveSignal(
                        calculatedIndicators.indicators,
                        currentPrice
                    );
                    break;
                default:
                    throw new Error(
                        `Unknown strategy: ${this.config.strategy}`
                    );
            }

            // Add ATR-based stop loss calculation
            const atrValues = calculatedIndicators.indicators.atr;
            if (atrValues && atrValues.length > 0) {
                const currentATR = atrValues[atrValues.length - 1];
                signalResult.stopLoss = this.indicators.calculateATRStopLoss(
                    currentPrice,
                    currentATR,
                    1.5,
                    signalResult.signal.includes("BUY") ? "BUY" : "SELL"
                );
                signalResult.atr = currentATR;
            }

            // Add trend analysis
            const closePrices = candles.slice(-20).map((c) => c.close);
            const trendAnalysis = this.indicators.analyzeTrend(
                calculatedIndicators.indicators,
                closePrices
            );
            signalResult.trend = trendAnalysis;

            // Enhance signal with metadata
            const enhancedSignal = {
                ...signalResult,
                symbol,
                currentPrice,
                timestamp: Date.now(),
                strategy: this.config.strategy,
                timeframe: this.config.timeframe,
                candleCount: candles.length,
            };

            // Check signal cooldown and strength threshold
            const processedSignal = this.processSignal(enhancedSignal);

            // Store in history
            this.signalHistory.push(processedSignal);

            // Keep only last 1000 signals
            if (this.signalHistory.length > 1000) {
                this.signalHistory.shift();
            }

            // Emit signal event
            this.emit("signalGenerated", processedSignal);

            return processedSignal;
        } catch (error) {
            console.error(`Error generating signal for ${symbol}:`, error);
            return {
                symbol,
                signal: "ERROR",
                strength: 0,
                message: error.message,
                timestamp: Date.now(),
            };
        }
    }

    /**
     * Conservative strategy: 50/200 SMA Golden Cross/Death Cross
     */
    generateConservativeSignal(indicators, currentPrice) {
        const { sma50, sma200 } = indicators;

        if (!sma50 || !sma200 || sma50.length < 2 || sma200.length < 2) {
            return {
                signal: "INSUFFICIENT_DATA",
                strength: 0,
                message: "Insufficient SMA data for conservative strategy",
            };
        }

        const crossoverResult = this.indicators.calculateMACrossover(
            sma50,
            sma200
        );

        return {
            signal: crossoverResult.signal,
            strength: crossoverResult.strength,
            message: crossoverResult.message,
            details: {
                sma50: crossoverResult.currentFast,
                sma200: crossoverResult.currentSlow,
                divergence: crossoverResult.divergence,
            },
        };
    }

    /**
     * Balanced strategy: 20/50 EMA with trend confirmation
     */
    generateBalancedSignal(indicators, currentPrice) {
        const { ema20, ema50 } = indicators;

        if (!ema20 || !ema50 || ema20.length < 2 || ema50.length < 2) {
            return {
                signal: "INSUFFICIENT_DATA",
                strength: 0,
                message: "Insufficient EMA data for balanced strategy",
            };
        }

        const crossoverResult = this.indicators.calculateMACrossover(
            ema20,
            ema50
        );

        // Enhance with additional confirmation
        let enhancedSignal = crossoverResult.signal;
        let enhancedStrength = crossoverResult.strength;

        // Check for trend alignment
        if (indicators.ema9 && indicators.ema9.length > 0) {
            const ema9Current = indicators.ema9[indicators.ema9.length - 1];
            const ema20Current = ema20[ema20.length - 1];
            const ema50Current = ema50[ema50.length - 1];

            // Strong bullish alignment: EMA9 > EMA20 > EMA50
            if (
                ema9Current > ema20Current &&
                ema20Current > ema50Current &&
                crossoverResult.signal.includes("BUY")
            ) {
                enhancedSignal = "STRONG_BUY";
                enhancedStrength *= 1.5;
            }
            // Strong bearish alignment: EMA9 < EMA20 < EMA50
            else if (
                ema9Current < ema20Current &&
                ema20Current < ema50Current &&
                crossoverResult.signal.includes("SELL")
            ) {
                enhancedSignal = "STRONG_SELL";
                enhancedStrength *= 1.5;
            }
        }

        return {
            signal: enhancedSignal,
            strength: Math.min(enhancedStrength, 10), // Cap at 10%
            message: crossoverResult.message,
            details: {
                ema20: crossoverResult.currentFast,
                ema50: crossoverResult.currentSlow,
                divergence: crossoverResult.divergence,
                ema9: indicators.ema9
                    ? indicators.ema9[indicators.ema9.length - 1]
                    : null,
            },
        };
    }

    /**
     * Responsive strategy: 12/26 EMA with momentum confirmation
     */
    generateResponsiveSignal(indicators, currentPrice) {
        const { ema12, ema26 } = indicators;

        if (!ema12 || !ema26 || ema12.length < 3 || ema26.length < 3) {
            return {
                signal: "INSUFFICIENT_DATA",
                strength: 0,
                message: "Insufficient EMA data for responsive strategy",
            };
        }

        const crossoverResult = this.indicators.calculateMACrossover(
            ema12,
            ema26
        );

        // Add momentum confirmation
        const ema12Current = ema12[ema12.length - 1];
        const ema12Previous = ema12[ema12.length - 2];
        const ema26Current = ema26[ema26.length - 1];
        const ema26Previous = ema26[ema26.length - 2];

        const momentum12 =
            ((ema12Current - ema12Previous) / ema12Previous) * 100;
        const momentum26 =
            ((ema26Current - ema26Previous) / ema26Previous) * 100;

        let enhancedSignal = crossoverResult.signal;
        let enhancedStrength = crossoverResult.strength;

        // Momentum confirmation
        if (
            crossoverResult.signal.includes("BUY") &&
            momentum12 > momentum26 &&
            momentum12 > 0.1
        ) {
            enhancedSignal = "STRONG_BUY";
            enhancedStrength *= 1.3;
        } else if (
            crossoverResult.signal.includes("SELL") &&
            momentum12 < momentum26 &&
            momentum12 < -0.1
        ) {
            enhancedSignal = "STRONG_SELL";
            enhancedStrength *= 1.3;
        }

        return {
            signal: enhancedSignal,
            strength: Math.min(enhancedStrength, 15), // Higher cap for responsive strategy
            message: crossoverResult.message,
            details: {
                ema12: crossoverResult.currentFast,
                ema26: crossoverResult.currentSlow,
                divergence: crossoverResult.divergence,
                momentum12: Math.round(momentum12 * 1000) / 1000,
                momentum26: Math.round(momentum26 * 1000) / 1000,
            },
        };
    }

    /**
     * Process signal with cooldown and threshold checks
     */
    processSignal(signal) {
        const key = `${signal.symbol}_${signal.signal}`;
        const now = Date.now();
        const lastSignalTime = this.lastSignals.get(key) || 0;

        // Apply cooldown
        if (now - lastSignalTime < this.config.signalCooldown) {
            return {
                ...signal,
                signal: "COOLDOWN",
                originalSignal: signal.signal,
                message: `Signal in cooldown period. Last ${
                    signal.signal
                } was ${Math.round((now - lastSignalTime) / 1000)}s ago`,
            };
        }

        // Check minimum strength threshold
        if (
            signal.strength < this.config.minStrength &&
            signal.signal !== "HOLD"
        ) {
            return {
                ...signal,
                signal: "WEAK_SIGNAL",
                originalSignal: signal.signal,
                message: `Signal strength ${signal.strength} below threshold ${this.config.minStrength}`,
            };
        }

        // Valid signal - update last signal time
        if (signal.signal.includes("BUY") || signal.signal.includes("SELL")) {
            this.lastSignals.set(key, now);
        }

        return signal;
    }

    /**
     * Generate signals for all configured assets
     */
    async generateAllSignals(binanceDataService) {
        const signals = [];

        for (const asset of this.config.assets) {
            try {
                const candles = binanceDataService.getCandles(
                    asset,
                    this.config.timeframe
                );
                const priceData = binanceDataService.getCurrentPrice(asset);

                if (!priceData) {
                    console.warn(`No price data available for ${asset}`);
                    continue;
                }

                const signal = await this.generateSignal(
                    asset,
                    candles,
                    priceData.price
                );
                signals.push(signal);
            } catch (error) {
                console.error(`Error generating signal for ${asset}:`, error);
                signals.push({
                    symbol: asset,
                    signal: "ERROR",
                    strength: 0,
                    message: error.message,
                    timestamp: Date.now(),
                });
            }
        }

        this.emit("allSignalsGenerated", signals);
        return signals;
    }

    /**
     * Get signal statistics
     */
    getSignalStats() {
        const recent = this.signalHistory.slice(-100); // Last 100 signals
        const stats = {
            total: this.signalHistory.length,
            recent: recent.length,
            signals: {
                BUY: 0,
                SELL: 0,
                HOLD: 0,
                ERROR: 0,
                OTHER: 0,
            },
            averageStrength: 0,
            lastSignalTime:
                recent.length > 0 ? recent[recent.length - 1].timestamp : null,
        };

        let totalStrength = 0;
        recent.forEach((signal) => {
            if (signal.signal.includes("BUY")) {
                stats.signals.BUY++;
            } else if (signal.signal.includes("SELL")) {
                stats.signals.SELL++;
            } else if (signal.signal === "HOLD") {
                stats.signals.HOLD++;
            } else if (signal.signal === "ERROR") {
                stats.signals.ERROR++;
            } else {
                stats.signals.OTHER++;
            }

            totalStrength += signal.strength || 0;
        });

        stats.averageStrength =
            recent.length > 0 ? totalStrength / recent.length : 0;

        return stats;
    }

    /**
     * Get recent signals for a specific asset
     */
    getAssetSignals(symbol, limit = 10) {
        return this.signalHistory
            .filter((signal) => signal.symbol === symbol)
            .slice(-limit)
            .reverse();
    }

    /**
     * Clear signal history and cache
     */
    reset() {
        this.signalHistory = [];
        this.lastSignals.clear();
        this.indicators.clearCache();
        this.emit("signalReset");
    }

    /**
     * Start continuous signal generation
     */
    start(binanceDataService, interval = 60000) {
        // 1 minute default
        if (this.isActive) {
            console.warn("Signal generator is already active");
            return;
        }

        this.isActive = true;
        console.log(
            `🚀 Starting signal generator with ${this.config.strategy} strategy`
        );

        this.signalInterval = setInterval(async () => {
            try {
                await this.generateAllSignals(binanceDataService);
            } catch (error) {
                console.error("Error in signal generation cycle:", error);
                this.emit("signalError", error);
            }
        }, interval);

        this.emit("signalGeneratorStarted");
    }

    /**
     * Stop continuous signal generation
     */
    stop() {
        if (!this.isActive) {
            return;
        }

        this.isActive = false;

        if (this.signalInterval) {
            clearInterval(this.signalInterval);
            this.signalInterval = null;
        }

        console.log("📴 Signal generator stopped");
        this.emit("signalGeneratorStopped");
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.emit("configUpdated", this.config);
        console.log("⚙️ Signal generator configuration updated");
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Health check
     */
    getStatus() {
        return {
            isActive: this.isActive,
            strategy: this.config.strategy,
            timeframe: this.config.timeframe,
            assets: this.config.assets,
            totalSignals: this.signalHistory.length,
            lastSignalTime:
                this.signalHistory.length > 0
                    ? this.signalHistory[this.signalHistory.length - 1]
                          .timestamp
                    : null,
            signalStats: this.getSignalStats(),
        };
    }
}

module.exports = SignalGenerator;
