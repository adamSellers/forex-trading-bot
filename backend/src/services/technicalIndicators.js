// backend/src/services/technicalIndicators.js

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

        const closePrices = candles.map((c) => c.close);
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
        } catch (error) {
            console.error("Error calculating indicators:", error);
            results.error = error.message;
        }

        return results;
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
     * Calculate Moving Average Crossover signals
     * @param {Array} fastMA - Fast moving average values
     * @param {Array} slowMA - Slow moving average values
     * @param {number} lookback - Number of periods to look back for confirmation
     * @returns {Object} Signal information
     */
    calculateMACrossover(fastMA, slowMA, lookback = 1) {
        if (!fastMA || !slowMA || fastMA.length < 2 || slowMA.length < 2) {
            return {
                signal: "NONE",
                strength: 0,
                message: "Insufficient data",
            };
        }

        const minLength = Math.min(fastMA.length, slowMA.length);
        if (minLength < lookback + 1) {
            return {
                signal: "NONE",
                strength: 0,
                message: "Insufficient lookback data",
            };
        }

        const currentFast = fastMA[minLength - 1];
        const currentSlow = slowMA[minLength - 1];
        const prevFast = fastMA[minLength - 2];
        const prevSlow = slowMA[minLength - 2];

        let signal = "HOLD";
        let strength = 0;
        let message = "";

        // Golden Cross: Fast MA crosses above Slow MA
        if (prevFast <= prevSlow && currentFast > currentSlow) {
            signal = "BUY";
            strength =
                (Math.abs(currentFast - currentSlow) / currentSlow) * 100;
            message = "Golden Cross detected - Fast MA crossed above Slow MA";
        }
        // Death Cross: Fast MA crosses below Slow MA
        else if (prevFast >= prevSlow && currentFast < currentSlow) {
            signal = "SELL";
            strength =
                (Math.abs(currentFast - currentSlow) / currentSlow) * 100;
            message = "Death Cross detected - Fast MA crossed below Slow MA";
        }
        // Trending signals
        else if (currentFast > currentSlow) {
            const divergence =
                ((currentFast - currentSlow) / currentSlow) * 100;
            if (divergence > 2) {
                signal = "STRONG_BUY";
                strength = divergence;
                message = "Strong uptrend - Fast MA well above Slow MA";
            } else {
                signal = "WEAK_BUY";
                strength = divergence;
                message = "Weak uptrend - Fast MA above Slow MA";
            }
        } else if (currentFast < currentSlow) {
            const divergence =
                ((currentSlow - currentFast) / currentSlow) * 100;
            if (divergence > 2) {
                signal = "STRONG_SELL";
                strength = divergence;
                message = "Strong downtrend - Fast MA well below Slow MA";
            } else {
                signal = "WEAK_SELL";
                strength = divergence;
                message = "Weak downtrend - Fast MA below Slow MA";
            }
        }

        return {
            signal,
            strength: Math.round(strength * 100) / 100,
            message,
            currentFast: Math.round(currentFast * 100) / 100,
            currentSlow: Math.round(currentSlow * 100) / 100,
            divergence: Math.round((currentFast - currentSlow) * 100) / 100,
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
     * Analyze trend strength and direction
     * @param {Object} indicators - Calculated indicators
     * @param {Array} prices - Recent price data
     * @returns {Object} Trend analysis
     */
    analyzeTrend(indicators, prices) {
        if (!indicators || !prices || prices.length < 10) {
            return { trend: "UNKNOWN", strength: 0, confidence: 0 };
        }

        const current = this.getCurrentValues(indicators);
        const recentPrices = prices.slice(-10);
        const priceChange =
            ((recentPrices[recentPrices.length - 1] - recentPrices[0]) /
                recentPrices[0]) *
            100;

        let trend = "SIDEWAYS";
        let strength = 0;
        let confidence = 0;

        // Analyze price momentum
        if (priceChange > 2) {
            trend = "UPTREND";
            strength = Math.min(priceChange, 10);
        } else if (priceChange < -2) {
            trend = "DOWNTREND";
            strength = Math.min(Math.abs(priceChange), 10);
        }

        // Analyze MA alignment for confirmation
        let maAlignment = 0;
        if (current.ema12 && current.ema26 && current.ema50) {
            if (
                current.ema12 > current.ema26 &&
                current.ema26 > current.ema50
            ) {
                maAlignment = 1; // Bullish alignment
            } else if (
                current.ema12 < current.ema26 &&
                current.ema26 < current.ema50
            ) {
                maAlignment = -1; // Bearish alignment
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
