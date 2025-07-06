// frontend/src/utils/indicators.js

/**
 * Calculates the Simple Moving Average (SMA) for a series of prices.
 * @param {number[]} prices - An array of closing prices.
 * @param {number} period - The moving average period.
 * @returns {Array<number|null>} An array of SMA values, with nulls for the initial period.
 */
export const calculateSMA = (prices, period) => {
    if (!prices || prices.length < period) return [];

    const sma = Array(period - 1).fill(null); // Pad with nulls for the initial period
    for (let i = period - 1; i < prices.length; i++) {
        const slice = prices.slice(i - period + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        sma.push(sum / period);
    }
    return sma;
};

/**
 * Calculates the Exponential Moving Average (EMA) for a series of prices.
 * @param {number[]} prices - An array of closing prices.
 * @param {number} period - The moving average period.
 * @returns {Array<number|null>} An array of EMA values, with nulls for the initial period.
 */
export const calculateEMA = (prices, period) => {
    if (!prices || prices.length < period) return [];

    const ema = Array(period - 1).fill(null);
    const multiplier = 2 / (period + 1);

    // Calculate the first EMA value (which is the SMA of the first period)
    const firstSlice = prices.slice(0, period);
    let previousEma = firstSlice.reduce((a, b) => a + b, 0) / period;
    ema.push(previousEma);

    // Calculate the rest of the EMA values
    for (let i = period; i < prices.length; i++) {
        const currentEma = (prices[i] - previousEma) * multiplier + previousEma;
        ema.push(currentEma);
        previousEma = currentEma;
    }
    return ema;
};
