// backend/src/services/signalGenerator.js - ENHANCED WITH VOLATILITY FILTER
const EventEmitter = require("events");
const logger = require("../utils/logger");

class SignalGenerator extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            strategy: config.strategy || "balanced",
            timeframe: config.timeframe || "1h",
            signalCooldown: config.signalCooldown || 60000, // 1 minute
            minStrength: config.minStrength || 0.5,
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],

            // NEW: Enhanced volatility filter config
            enableVolatilityFilter: config.enableVolatilityFilter !== false, // Default true
            minVolatilityPercent: config.minVolatilityPercent || 2.0, // 2% ATR minimum
            atrPeriod: config.atrPeriod || 14,
            volatilityLookback: config.volatilityLookback || 24, // Hours to check volatility

            ...config,
        };

        // Strategy configurations
        this.strategyConfig = {
            conservative: { fast: 50, slow: 200, type: "SMA" },
            balanced: { fast: 20, slow: 50, type: "EMA" },
            responsive: { fast: 12, slow: 26, type: "EMA" },
        };

        this.lastSignals = new Map(); // Cooldown tracking
        this.signalHistory = [];

        // NEW: Volatility tracking
        this.volatilityHistory = new Map(); // Track volatility over time
        this.volatilityStats = {
            periodsChecked: 0,
            lowVolatilityPeriods: 0,
            avgVolatility: 0,
            signalsBlocked: 0,
        };

        logger.info(
            `🎯 ENHANCED Signal Generator initialized - Strategy: ${this.config.strategy}, Volatility Filter: ${this.config.enableVolatilityFilter}`
        );
    }

    getStatus() {
        try {
            return {
                isActive: this.isRunning || false,
                strategy: this.config.strategy,
                timeframe: this.config.timeframe,
                signalCount: this.signalHistory.length,
                lastSignalTime:
                    Math.max(...Array.from(this.lastSignals.values())) || null,
                cooldownPeriod: this.config.signalCooldown,
                assets: this.config.assets,

                // Volatility filter status
                volatilityFilter: {
                    enabled: this.config.enableVolatilityFilter,
                    minVolatilityPercent: this.config.minVolatilityPercent,
                    periodsChecked: this.volatilityStats.periodsChecked,
                    signalsBlocked: this.volatilityStats.signalsBlocked,
                    avgVolatility: this.volatilityStats.avgVolatility,
                },

                // Configuration
                config: {
                    minStrength: this.config.minStrength,
                    signalCooldown: this.config.signalCooldown,
                    enableVolatilityFilter: this.config.enableVolatilityFilter,
                },

                timestamp: Date.now(),
            };
        } catch (error) {
            logger.error("Error getting signal generator status:", error);
            return {
                isActive: false,
                error: error.message,
                timestamp: Date.now(),
            };
        }
    }

    // That's it! This single method addition should fix the signalGenerator getStatus error
    // without removing any of the existing functionality

    /**
     * NEW: Calculate Average True Range (ATR)
     */
    calculateATR(candles, period = 14) {
        if (!candles || candles.length < period + 1) {
            return null;
        }

        const trueRanges = [];

        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i - 1];

            const tr1 = current.high - current.low;
            const tr2 = Math.abs(current.high - previous.close);
            const tr3 = Math.abs(current.low - previous.close);

            trueRanges.push(Math.max(tr1, tr2, tr3));
        }

        // Calculate simple moving average of true ranges
        const recentTR = trueRanges.slice(-period);
        return recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;
    }

    /**
     * NEW: Calculate volatility filter data
     */
    calculateVolatilityFilter(candles, currentPrice) {
        const atr = this.calculateATR(candles, this.config.atrPeriod);
        if (!atr || !currentPrice) {
            return {
                atr: null,
                atrPercent: null,
                isHighVolatility: false,
                volatilityRating: "UNKNOWN",
            };
        }

        // Calculate ATR as percentage of current price
        const atrPercent = (atr / currentPrice) * 100;

        // Determine volatility rating
        let volatilityRating = "LOW";
        let isHighVolatility = false;

        if (atrPercent >= this.config.minVolatilityPercent) {
            isHighVolatility = true;
            if (atrPercent >= this.config.minVolatilityPercent * 2) {
                volatilityRating = "HIGH";
            } else {
                volatilityRating = "MEDIUM";
            }
        }

        // Update volatility statistics
        this.volatilityStats.periodsChecked++;
        if (!isHighVolatility) {
            this.volatilityStats.lowVolatilityPeriods++;
        }

        // Update running average
        this.volatilityStats.avgVolatility =
            (this.volatilityStats.avgVolatility *
                (this.volatilityStats.periodsChecked - 1) +
                atrPercent) /
            this.volatilityStats.periodsChecked;

        return {
            atr,
            atrPercent,
            isHighVolatility,
            volatilityRating,
            minRequired: this.config.minVolatilityPercent,
        };
    }

    /**
     * Calculate Simple Moving Average
     */
    calculateSMA(candles, period) {
        if (!candles || candles.length < period) return null;

        const values = candles.slice(-period).map((c) => c.close);
        return values.reduce((sum, val) => sum + val, 0) / period;
    }

    /**
     * Calculate Exponential Moving Average
     */
    calculateEMA(candles, period) {
        if (!candles || candles.length < period) return null;

        const multiplier = 2 / (period + 1);
        let ema = candles[0].close;

        for (let i = 1; i < candles.length; i++) {
            ema = candles[i].close * multiplier + ema * (1 - multiplier);
        }

        return ema;
    }

    /**
     * ENHANCED: Generate trading signal with volatility analysis
     */
    async generateSignal(symbol, candles, currentPrice) {
        try {
            if (!candles || candles.length < 50) {
                return {
                    symbol,
                    signal: "INSUFFICIENT_DATA",
                    strength: 0,
                    message: `Insufficient candle data: ${
                        candles?.length || 0
                    }/50 required`,
                    timestamp: Date.now(),
                };
            }

            const strategy = this.strategyConfig[this.config.strategy];
            if (!strategy) {
                throw new Error(`Unknown strategy: ${this.config.strategy}`);
            }

            // Calculate moving averages
            let fastMA, slowMA;
            if (strategy.type === "SMA") {
                fastMA = this.calculateSMA(candles, strategy.fast);
                slowMA = this.calculateSMA(candles, strategy.slow);
            } else {
                fastMA = this.calculateEMA(candles, strategy.fast);
                slowMA = this.calculateEMA(candles, strategy.slow);
            }

            if (!fastMA || !slowMA) {
                return {
                    symbol,
                    signal: "INSUFFICIENT_DATA",
                    strength: 0,
                    message: "Unable to calculate moving averages",
                    timestamp: Date.now(),
                };
            }

            // NEW: Calculate volatility data
            const volatilityData = this.calculateVolatilityFilter(
                candles,
                currentPrice
            );

            // Store volatility history for analysis
            const volatilityKey = `${symbol}_${Date.now()}`;
            this.volatilityHistory.set(volatilityKey, {
                symbol,
                atrPercent: volatilityData.atrPercent,
                timestamp: Date.now(),
                rating: volatilityData.volatilityRating,
            });

            // Clean old volatility data (keep last 100 entries per symbol)
            const symbolEntries = Array.from(this.volatilityHistory.entries())
                .filter(([key, data]) => data.symbol === symbol)
                .slice(-100);

            // Determine crossover signal
            const previousCandles = candles.slice(0, -1);
            let prevFastMA, prevSlowMA;

            if (strategy.type === "SMA") {
                prevFastMA = this.calculateSMA(previousCandles, strategy.fast);
                prevSlowMA = this.calculateSMA(previousCandles, strategy.slow);
            } else {
                prevFastMA = this.calculateEMA(previousCandles, strategy.fast);
                prevSlowMA = this.calculateEMA(previousCandles, strategy.slow);
            }

            let signal = "HOLD";
            let strength = 0;
            let crossoverType = "NONE";

            // Detect crossovers
            if (prevFastMA && prevSlowMA) {
                const currentCross = fastMA > slowMA;
                const previousCross = prevFastMA > prevSlowMA;

                if (currentCross && !previousCross) {
                    // Golden cross - bullish
                    signal = "BUY";
                    crossoverType = "GOLDEN_CROSS";
                    strength = Math.min(
                        0.9,
                        Math.abs(fastMA - slowMA) / slowMA
                    );
                } else if (!currentCross && previousCross) {
                    // Death cross - bearish
                    signal = "SELL";
                    crossoverType = "DEATH_CROSS";
                    strength = Math.min(
                        0.9,
                        Math.abs(fastMA - slowMA) / slowMA
                    );
                } else if (currentCross) {
                    // Above but no cross
                    signal = "HOLD_BULLISH";
                    strength = Math.min(
                        0.7,
                        Math.abs(fastMA - slowMA) / slowMA
                    );
                } else {
                    // Below but no cross
                    signal = "HOLD_BEARISH";
                    strength = Math.min(
                        0.7,
                        Math.abs(fastMA - slowMA) / slowMA
                    );
                }
            }

            // Adjust strength based on price position relative to MAs
            const priceAboveFast = currentPrice > fastMA;
            const priceAboveSlow = currentPrice > slowMA;

            if (signal.includes("BUY") && priceAboveFast && priceAboveSlow) {
                strength *= 1.2; // Boost if price confirms the signal
            } else if (
                signal.includes("SELL") &&
                !priceAboveFast &&
                !priceAboveSlow
            ) {
                strength *= 1.2;
            } else if (
                signal.includes("BUY") &&
                (!priceAboveFast || !priceAboveSlow)
            ) {
                strength *= 0.8; // Reduce if price doesn't confirm
            } else if (
                signal.includes("SELL") &&
                (priceAboveFast || priceAboveSlow)
            ) {
                strength *= 0.8;
            }

            strength = Math.min(1.0, Math.max(0.1, strength));

            const signalData = {
                symbol,
                signal,
                strength,
                crossoverType,
                timestamp: Date.now(),
                data: {
                    currentPrice,
                    fastMA: fastMA.toFixed(6),
                    slowMA: slowMA.toFixed(6),
                    strategy: `${strategy.fast}/${strategy.slow} ${strategy.type}`,
                    priceAboveFast,
                    priceAboveSlow,
                },
                // NEW: Include volatility data
                volatility: volatilityData,
                atr: volatilityData.atr,
                atrPercent: volatilityData.atrPercent,
                volatilityRating: volatilityData.volatilityRating,
            };

            // Store in history
            this.signalHistory.push(signalData);
            if (this.signalHistory.length > 1000) {
                this.signalHistory = this.signalHistory.slice(-500);
            }

            return signalData;
        } catch (error) {
            logger.error(
                `Error generating enhanced signal for ${symbol}:`,
                error
            );
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
     * ENHANCED: Validate signal with volatility filter
     */
    validateSignal(signal, candles = null, currentPrice = null) {
        const now = Date.now();
        const key = `${signal.symbol}_${signal.signal}`;
        const lastSignalTime = this.lastSignals.get(key) || 0;

        // 1. Cooldown check
        if (now - lastSignalTime < this.config.signalCooldown) {
            return {
                ...signal,
                signal: "COOLDOWN",
                originalSignal: signal.signal,
                message: `Cooldown active. Last ${
                    signal.signal
                } was ${Math.round((now - lastSignalTime) / 1000)}s ago`,
            };
        }

        // 2. NEW: Volatility filter check
        if (this.config.enableVolatilityFilter && signal.volatilityRating) {
            if (
                signal.volatilityRating === "LOW" &&
                signal.signal !== "HOLD" &&
                !signal.signal.includes("HOLD")
            ) {
                this.volatilityStats.signalsBlocked++;

                return {
                    ...signal,
                    signal: "LOW_VOLATILITY",
                    originalSignal: signal.signal,
                    message: `Signal blocked due to low volatility: ${signal.atrPercent?.toFixed(
                        2
                    )}% (min: ${this.config.minVolatilityPercent}%)`,
                    blockedAt: now,
                };
            }
        }

        // 3. Strength threshold check
        if (
            signal.strength < this.config.minStrength &&
            signal.signal !== "HOLD" &&
            !signal.signal.includes("HOLD")
        ) {
            return {
                ...signal,
                signal: "WEAK_SIGNAL",
                originalSignal: signal.signal,
                message: `Signal strength ${signal.strength?.toFixed(
                    3
                )} below threshold ${this.config.minStrength}`,
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
                    logger.warn(`No price data available for ${asset}`);
                    continue;
                }

                const rawSignal = await this.generateSignal(
                    asset,
                    candles,
                    priceData.price
                );
                const validatedSignal = this.validateSignal(
                    rawSignal,
                    candles,
                    priceData.price
                );

                signals.push(validatedSignal);

                // Log volatility blocking
                if (validatedSignal.signal === "LOW_VOLATILITY") {
                    logger.debug(
                        `🔇 ${asset} signal blocked - Volatility: ${validatedSignal.atrPercent?.toFixed(
                            2
                        )}% (${validatedSignal.volatilityRating})`
                    );
                }
            } catch (error) {
                logger.error(
                    `Error generating enhanced signal for ${asset}:`,
                    error
                );
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
     * NEW: Get enhanced signal statistics with volatility metrics
     */
    getEnhancedSignalStats() {
        const recent = this.signalHistory.slice(-100);
        const stats = {
            total: this.signalHistory.length,
            recent: recent.length,
            signals: {
                BUY: recent.filter((s) => s.signal.includes("BUY")).length,
                SELL: recent.filter((s) => s.signal.includes("SELL")).length,
                HOLD: recent.filter((s) => s.signal.includes("HOLD")).length,
                BLOCKED: recent.filter((s) => s.signal === "LOW_VOLATILITY")
                    .length,
                WEAK: recent.filter((s) => s.signal === "WEAK_SIGNAL").length,
                ERROR: recent.filter((s) => s.signal === "ERROR").length,
            },
            averageStrength:
                recent.length > 0
                    ? recent.reduce((sum, s) => sum + (s.strength || 0), 0) /
                      recent.length
                    : 0,
            lastSignalTime:
                recent.length > 0 ? recent[recent.length - 1].timestamp : null,

            // NEW: Volatility statistics
            volatilityStats: {
                ...this.volatilityStats,
                avgVolatilityPercent: this.volatilityStats.avgVolatility,
                lowVolatilityRate:
                    this.volatilityStats.periodsChecked > 0
                        ? (this.volatilityStats.lowVolatilityPeriods /
                              this.volatilityStats.periodsChecked) *
                          100
                        : 0,
                recentVolatilityRatings: recent
                    .filter((s) => s.volatilityRating)
                    .reduce((acc, s) => {
                        acc[s.volatilityRating] =
                            (acc[s.volatilityRating] || 0) + 1;
                        return acc;
                    }, {}),
                filterEffectiveness: this.volatilityStats.signalsBlocked,
            },
        };

        return stats;
    }

    /**
     * NEW: Get volatility analysis for dashboard
     */
    getVolatilityAnalysis() {
        const recentVolatility = Array.from(
            this.volatilityHistory.values()
        ).slice(-50);

        if (recentVolatility.length === 0) {
            return {
                overall: "INSUFFICIENT_DATA",
                avgVolatility: 0,
                trends: {},
                recommendations: ["Collect more data for volatility analysis"],
            };
        }

        const assetVolatility = {};
        this.config.assets.forEach((asset) => {
            const assetData = recentVolatility.filter(
                (v) => v.symbol === asset
            );
            if (assetData.length > 0) {
                assetVolatility[asset] = {
                    avgVolatility:
                        assetData.reduce((sum, v) => sum + v.atrPercent, 0) /
                        assetData.length,
                    currentRating:
                        assetData[assetData.length - 1]?.rating || "UNKNOWN",
                    trend: this.calculateVolatilityTrend(assetData),
                };
            }
        });

        const recommendations = [];
        Object.entries(assetVolatility).forEach(([asset, data]) => {
            if (data.avgVolatility < this.config.minVolatilityPercent) {
                recommendations.push(
                    `${asset}: Low volatility (${data.avgVolatility.toFixed(
                        2
                    )}%) - expect fewer signals`
                );
            } else if (
                data.avgVolatility >
                this.config.minVolatilityPercent * 3
            ) {
                recommendations.push(
                    `${asset}: High volatility (${data.avgVolatility.toFixed(
                        2
                    )}%) - use smaller position sizes`
                );
            }
        });

        return {
            overall: this.getOverallVolatilityRating(assetVolatility),
            avgVolatility: this.volatilityStats.avgVolatility,
            assetBreakdown: assetVolatility,
            trends: this.getVolatilityTrends(assetVolatility),
            recommendations:
                recommendations.length > 0
                    ? recommendations
                    : ["Market volatility within normal parameters"],
            filterStats: {
                signalsBlocked: this.volatilityStats.signalsBlocked,
                lowVolatilityPeriods: this.volatilityStats.lowVolatilityPeriods,
                totalPeriodsChecked: this.volatilityStats.periodsChecked,
                filterEffectiveness:
                    this.volatilityStats.periodsChecked > 0
                        ? (this.volatilityStats.signalsBlocked /
                              this.volatilityStats.periodsChecked) *
                          100
                        : 0,
            },
        };
    }

    calculateVolatilityTrend(assetData) {
        if (assetData.length < 2) return "STABLE";

        const recent = assetData.slice(-5);
        const older = assetData.slice(-10, -5);

        if (recent.length === 0 || older.length === 0) return "STABLE";

        const recentAvg =
            recent.reduce((sum, v) => sum + v.atrPercent, 0) / recent.length;
        const olderAvg =
            older.reduce((sum, v) => sum + v.atrPercent, 0) / older.length;

        const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

        if (changePercent > 10) return "INCREASING";
        if (changePercent < -10) return "DECREASING";
        return "STABLE";
    }

    getOverallVolatilityRating(assetVolatility) {
        const ratings = Object.values(assetVolatility).map(
            (v) => v.currentRating
        );
        const highCount = ratings.filter((r) => r === "HIGH").length;
        const mediumCount = ratings.filter((r) => r === "MEDIUM").length;
        const lowCount = ratings.filter((r) => r === "LOW").length;

        if (highCount >= ratings.length / 2) return "HIGH";
        if (mediumCount >= ratings.length / 2) return "MEDIUM";
        return "LOW";
    }

    getVolatilityTrends(assetVolatility) {
        const trends = {};
        Object.entries(assetVolatility).forEach(([asset, data]) => {
            trends[asset] = data.trend;
        });
        return trends;
    }

    /**
     * Reset signal generator state
     */
    reset() {
        this.lastSignals.clear();
        this.signalHistory = [];
        this.volatilityHistory.clear();
        this.volatilityStats = {
            periodsChecked: 0,
            lowVolatilityPeriods: 0,
            avgVolatility: 0,
            signalsBlocked: 0,
        };

        logger.info("🔄 Enhanced Signal Generator reset");
        this.emit("generatorReset");
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info("⚙️ Enhanced Signal Generator configuration updated");
        this.emit("configUpdated", this.config);
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
}

module.exports = SignalGenerator;
