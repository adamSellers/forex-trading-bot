// backend/src/services/technicalIndicators.js - FIXED VERSION

class TechnicalIndicators {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Simple Moving Average (SMA)
     * @param {Array} prices - Array of price values
     * @param {number} period - Period for calculation
     * @returns {Array} Array of SMA values
     */
    calculateSMA(prices, period) {
        if (!prices || prices.length < period) return [];

        const smaValues = [];

        for (let i = period - 1; i < prices.length; i++) {
            const sum = prices
                .slice(i - period + 1, i + 1)
                .reduce((a, b) => a + b, 0);
            smaValues.push(sum / period);
        }

        return smaValues;
    }

    /**
     * Exponential Moving Average (EMA)
     * @param {Array} prices - Array of price values
     * @param {number} period - Period for calculation
     * @returns {Array} Array of EMA values
     */
    calculateEMA(prices, period) {
        if (!prices || prices.length < period) return [];

        const emaValues = [];
        const multiplier = 2 / (period + 1);

        // First EMA value is SMA
        const firstSMA =
            prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        emaValues.push(firstSMA);

        // Calculate subsequent EMA values
        for (let i = period; i < prices.length; i++) {
            const ema =
                prices[i] * multiplier +
                emaValues[emaValues.length - 1] * (1 - multiplier);
            emaValues.push(ema);
        }

        return emaValues;
    }

    /**
     * Average True Range (ATR)
     * @param {Array} candles - Array of OHLC candle objects
     * @param {number} period - Period for calculation (default 14)
     * @returns {Array} Array of ATR values
     */
    calculateATR(candles, period = 14) {
        if (!candles || candles.length < period + 1) return [];

        const trueRanges = [];

        // Calculate True Range for each candle (starting from second candle)
        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i - 1];

            const tr1 = current.high - current.low;
            const tr2 = Math.abs(current.high - previous.close);
            const tr3 = Math.abs(current.low - previous.close);

            const trueRange = Math.max(tr1, tr2, tr3);
            trueRanges.push(trueRange);
        }

        // Calculate ATR using EMA of True Ranges
        return this.calculateEMA(trueRanges, period);
    }

    /**
     * Calculate all indicators for a given dataset
     * @param {Array} candles - Array of OHLC candle objects
     * @param {Object} config - Configuration object
     * @returns {Object} Object containing all calculated indicators
     */
    calculateAllIndicators(candles, config) {
        if (!candles || candles.length === 0) {
            return { error: "No candle data provided" };
        }

        const closePrices = candles.map((c) => parseFloat(c.close));
        const results = {
            timestamp: Date.now(),
            candleCount: candles.length,
            indicators: {},
        };

        try {
            // Conservative Strategy: 50/200 SMA
            if (config.strategy === "conservative" || config.includeAll) {
                results.indicators.sma50 = this.calculateSMA(closePrices, 50);
                results.indicators.sma200 = this.calculateSMA(closePrices, 200);
            }

            // Balanced Strategy: 20/50 EMA
            if (config.strategy === "balanced" || config.includeAll) {
                results.indicators.ema20 = this.calculateEMA(closePrices, 20);
                results.indicators.ema50 = this.calculateEMA(closePrices, 50);
            }

            // Responsive Strategy: 12/26 EMA
            if (config.strategy === "responsive" || config.includeAll) {
                results.indicators.ema12 = this.calculateEMA(closePrices, 12);
                results.indicators.ema26 = this.calculateEMA(closePrices, 26);
            }

            // ATR for stop loss calculation
            results.indicators.atr = this.calculateATR(candles, 14);

            // Additional useful indicators
            results.indicators.sma10 = this.calculateSMA(closePrices, 10);
            results.indicators.ema9 = this.calculateEMA(closePrices, 9);

            // DEBUG: Log calculated values for debugging
            if (config.strategy === "balanced") {
                const ema20 = results.indicators.ema20;
                const ema50 = results.indicators.ema50;
                if (ema20.length > 0 && ema50.length > 0) {
                    console.log(
                        `🔍 DEBUG EMA20 latest: ${ema20[
                            ema20.length - 1
                        ].toFixed(2)}`
                    );
                    console.log(
                        `🔍 DEBUG EMA50 latest: ${ema50[
                            ema50.length - 1
                        ].toFixed(2)}`
                    );
                    console.log(
                        `🔍 DEBUG Divergence: ${(
                            ema20[ema20.length - 1] - ema50[ema50.length - 1]
                        ).toFixed(2)}`
                    );
                }
            }
        } catch (error) {
            console.error("Error calculating indicators:", error);
            results.error = error.message;
        }

        return results;
    }

    /**
     * FIXED: Calculate Moving Average Crossover signals
     * @param {Array} fastMA - Fast moving average values
     * @param {Array} slowMA - Slow moving average values
     * @param {number} lookback - Number of periods to look back for confirmation
     * @returns {Object} Signal information
     */
    calculateMACrossover(fastMA, slowMA, lookback = 1) {
        if (!fastMA || !slowMA || fastMA.length < 2 || slowMA.length < 2) {
            return {
                signal: "INSUFFICIENT_DATA",
                strength: 0,
                message: "Insufficient MA data",
            };
        }

        const minLength = Math.min(fastMA.length, slowMA.length);
        if (minLength < lookback + 1) {
            return {
                signal: "INSUFFICIENT_DATA",
                strength: 0,
                message: "Insufficient lookback data",
            };
        }

        const currentFast = fastMA[minLength - 1];
        const currentSlow = slowMA[minLength - 1];
        const prevFast = fastMA[minLength - 2];
        const prevSlow = slowMA[minLength - 2];

        // CRITICAL FIX: Ensure we have valid numbers
        if (
            isNaN(currentFast) ||
            isNaN(currentSlow) ||
            isNaN(prevFast) ||
            isNaN(prevSlow)
        ) {
            console.error("❌ NaN values in MA crossover:", {
                currentFast,
                currentSlow,
                prevFast,
                prevSlow,
            });
            return {
                signal: "ERROR",
                strength: 0,
                message: "Invalid MA values (NaN detected)",
            };
        }

        let signal = "HOLD";
        let strength = 0;
        let message = "";

        // Calculate percentage divergence (FIXED calculation)
        const currentDivergence = currentFast - currentSlow;
        const divergencePercent =
            Math.abs(currentDivergence / currentSlow) * 100;

        // DEBUGGING: Log the actual values
        console.log(
            `🔍 MA Debug: Fast=${currentFast.toFixed(
                2
            )}, Slow=${currentSlow.toFixed(2)}, Div=${currentDivergence.toFixed(
                2
            )} (${divergencePercent.toFixed(3)}%)`
        );

        // IMPROVED: More sensitive crossover detection
        const crossoverThreshold = 0.0001; // 0.01% threshold

        // Golden Cross: Fast MA crosses above Slow MA
        if (
            prevFast <= prevSlow * (1 + crossoverThreshold) &&
            currentFast > currentSlow * (1 + crossoverThreshold)
        ) {
            signal = "BUY";
            strength = Math.max(divergencePercent, 0.1); // Minimum 0.1 strength
            message = "Golden Cross - Fast MA crossed above Slow MA";
            console.log(
                `🟢 GOLDEN CROSS DETECTED: ${strength.toFixed(2)} strength`
            );
        }
        // Death Cross: Fast MA crosses below Slow MA
        else if (
            prevFast >= prevSlow * (1 - crossoverThreshold) &&
            currentFast < currentSlow * (1 - crossoverThreshold)
        ) {
            signal = "SELL";
            strength = Math.max(divergencePercent, 0.1); // Minimum 0.1 strength
            message = "Death Cross - Fast MA crossed below Slow MA";
            console.log(
                `🔴 DEATH CROSS DETECTED: ${strength.toFixed(2)} strength`
            );
        }
        // FIXED: More aggressive trend following with lower thresholds
        else if (currentFast > currentSlow) {
            if (divergencePercent > 0.5) {
                // Reduced from 2% to 0.5%
                signal = "STRONG_BUY";
                strength = Math.min(divergencePercent, 10);
                message = "Strong uptrend - Fast MA well above Slow MA";
            } else if (divergencePercent > 0.1) {
                // Reduced from 0.2% to 0.1%
                signal = "BUY";
                strength = Math.max(divergencePercent * 2, 0.2); // Amplify weak signals
                message = "Uptrend - Fast MA above Slow MA";
            }
        } else if (currentFast < currentSlow) {
            if (divergencePercent > 0.5) {
                // Reduced from 2% to 0.5%
                signal = "STRONG_SELL";
                strength = Math.min(divergencePercent, 10);
                message = "Strong downtrend - Fast MA well below Slow MA";
            } else if (divergencePercent > 0.1) {
                // Reduced from 0.2% to 0.1%
                signal = "SELL";
                strength = Math.max(divergencePercent * 2, 0.2); // Amplify weak signals
                message = "Downtrend - Fast MA below Slow MA";
            }
        }

        // FINAL DEBUG LOG
        console.log(
            `📊 Signal Result: ${signal} (${strength.toFixed(
                3
            )} strength) - ${message}`
        );

        return {
            signal,
            strength: Math.round(strength * 1000) / 1000, // 3 decimal places
            message,
            currentFast: Math.round(currentFast * 100) / 100,
            currentSlow: Math.round(currentSlow * 100) / 100,
            divergence: Math.round(currentDivergence * 100) / 100,
            divergencePercent: Math.round(divergencePercent * 1000) / 1000,
        };
    }

    /**
     * Calculate stop loss price using ATR
     * @param {number} currentPrice - Current asset price
     * @param {number} atrValue - Current ATR value
     * @param {number} multiplier - ATR multiplier (default 1.5)
     * @param {string} side - 'BUY' or 'SELL'
     * @returns {number} Stop loss price
     */
    calculateATRStopLoss(
        currentPrice,
        atrValue,
        multiplier = 1.5,
        side = "BUY"
    ) {
        if (!currentPrice || !atrValue) return null;

        if (side === "BUY") {
            // For long positions, stop loss below current price
            return currentPrice - atrValue * multiplier;
        } else {
            // For short positions, stop loss above current price
            return currentPrice + atrValue * multiplier;
        }
    }

    /**
     * FIXED: Analyze trend strength and direction
     * @param {Object} indicators - Calculated indicators
     * @param {Array} prices - Recent price data
     * @returns {Object} Trend analysis
     */
    analyzeTrend(indicators, prices) {
        if (!indicators || !prices || prices.length < 10) {
            return { trend: "UNKNOWN", strength: 0, confidence: 0 };
        }

        const current = this.getCurrentValues(indicators);
        const recentPrices = prices.slice(-20); // Increased from 10 to 20 for better trend analysis
        const priceChange =
            ((recentPrices[recentPrices.length - 1] - recentPrices[0]) /
                recentPrices[0]) *
            100;

        let trend = "SIDEWAYS";
        let strength = 0;
        let confidence = 0;

        // FIXED: More sensitive trend detection
        if (priceChange > 0.5) {
            // Reduced from 2% to 0.5%
            trend = "UPTREND";
            strength = Math.min(Math.abs(priceChange), 10);
        } else if (priceChange < -0.5) {
            // Reduced from -2% to -0.5%
            trend = "DOWNTREND";
            strength = Math.min(Math.abs(priceChange), 10);
        }

        // Analyze MA alignment for confirmation
        let maAlignment = 0;
        if (current.ema20 && current.ema50) {
            // Use available EMAs
            if (current.ema20 > current.ema50) {
                maAlignment = 1; // Bullish alignment
            } else if (current.ema20 < current.ema50) {
                maAlignment = -1; // Bearish alignment
            }
        } else if (current.sma50 && current.sma200) {
            // Fallback to SMAs
            if (current.sma50 > current.sma200) {
                maAlignment = 1;
            } else if (current.sma50 < current.sma200) {
                maAlignment = -1;
            }
        }

        // Calculate confidence based on alignment
        if (
            (trend === "UPTREND" && maAlignment === 1) ||
            (trend === "DOWNTREND" && maAlignment === -1)
        ) {
            confidence = 80;
        } else if (trend === "SIDEWAYS") {
            confidence = 60;
        } else {
            confidence = 40;
        }

        return {
            trend,
            strength: Math.round(strength * 10) / 10,
            confidence,
            priceChange: Math.round(priceChange * 100) / 100,
            maAlignment:
                maAlignment === 1
                    ? "BULLISH"
                    : maAlignment === -1
                    ? "BEARISH"
                    : "NEUTRAL",
        };
    }

    /**
     * Get current indicator values (latest values from arrays)
     * @param {Object} indicators - Indicators object from calculateAllIndicators
     * @returns {Object} Current values of all indicators
     */
    getCurrentValues(indicators) {
        const current = {};

        for (const [key, values] of Object.entries(indicators)) {
            if (Array.isArray(values) && values.length > 0) {
                current[key] = values[values.length - 1];
            }
        }

        return current;
    }

    /**
     * Cache indicators to avoid recalculation
     * @param {string} key - Cache key (e.g., 'BTCUSDT_1h')
     * @param {Object} indicators - Calculated indicators
     */
    cacheIndicators(key, indicators) {
        this.cache.set(key, {
            ...indicators,
            cachedAt: Date.now(),
        });
    }

    /**
     * Get cached indicators if still valid
     * @param {string} key - Cache key
     * @param {number} maxAge - Maximum age in milliseconds (default 5 minutes)
     * @returns {Object|null} Cached indicators or null if expired
     */
    getCachedIndicators(key, maxAge = 5 * 60 * 1000) {
        const cached = this.cache.get(key);
        if (!cached) return null;

        if (Date.now() - cached.cachedAt > maxAge) {
            this.cache.delete(key);
            return null;
        }

        return cached;
    }

    /**
     * Clear indicator cache
     */
    clearCache() {
        this.cache.clear();
    }
}

module.exports = TechnicalIndicators;
