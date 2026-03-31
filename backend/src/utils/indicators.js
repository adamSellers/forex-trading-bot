// backend/src/utils/indicators.js - Shared indicator calculations
// Used by the live runtime and shared analytics/helpers
const { RSI, ADX, ATR } = require("technicalindicators");

/**
 * Calculate SuperTrend indicator from OHLC arrays
 * Returns direction array where 1 = uptrend (GREEN), -1 = downtrend (RED)
 *
 * @param {number[]} highs - Array of high prices
 * @param {number[]} lows - Array of low prices
 * @param {number[]} closes - Array of close prices
 * @param {number} period - ATR lookback period (default: 10)
 * @param {number} factor - Band multiplier (default: 3)
 * @returns {{ superTrend: number[], direction: number[], atr: number[] }}
 */
function calculateSuperTrend(highs, lows, closes, period = 10, factor = 3) {
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

/**
 * Calculate RSI values from close prices
 * @param {number[]} closes - Array of close prices
 * @param {number} period - RSI period (default: 14)
 * @returns {number[]} Array of RSI values
 */
function calculateRSI(closes, period = 14) {
    return RSI.calculate({ values: closes, period });
}

/**
 * Calculate ADX values from OHLC data
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} period - ADX period (default: 14)
 * @returns {Array<{adx: number, pdi: number, mdi: number}>}
 */
function calculateADX(highs, lows, closes, period = 14) {
    return ADX.calculate({ high: highs, low: lows, close: closes, period });
}

/**
 * Calculate ATR values from OHLC data
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} period - ATR period (default: 14)
 * @returns {number[]}
 */
function calculateATR(highs, lows, closes, period = 14) {
    return ATR.calculate({ high: highs, low: lows, close: closes, period });
}

/**
 * Get pip value for a forex instrument
 * JPY pairs use 0.01, all others use 0.0001
 * @param {string} instrument - e.g., "AUD_USD", "USD_JPY"
 * @returns {number}
 */
function getPipValue(instrument) {
    return instrument && instrument.includes("JPY") ? 0.01 : 0.0001;
}

/**
 * Calculate all indicators for a candle array in one call.
 * Convenience helper for non-runtime indicator consumers.
 *
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {object} config - Strategy config with atrPeriod, factor
 * @returns {object} All indicator values for the latest candle
 */
function calculateAllIndicators(candles, config = {}) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const stData = calculateSuperTrend(
        highs,
        lows,
        closes,
        config.atrPeriod || 10,
        config.factor || 3
    );

    const idx = closes.length - 1;
    const currentDir = stData.direction[idx];
    const prevDir = stData.direction[idx - 1];

    const rsiResults = calculateRSI(closes, 14);
    const rsiVal = rsiResults[rsiResults.length - 1] || 0;

    const adxResults = calculateADX(highs, lows, closes, 14);
    const adxResult = adxResults[adxResults.length - 1];
    const adxVal = adxResult?.adx || 0;

    // ADX Slope: compare current ADX to N bars ago
    const lookback = config.adxSlopeLookback || 3;
    const lookbackIdx = adxResults.length - 1 - lookback;
    const prevAdxResult = lookbackIdx >= 0 ? adxResults[lookbackIdx] : null;
    const prevAdxVal = prevAdxResult?.adx || adxVal;
    const adxRising = adxVal > prevAdxVal;

    const atrResults = calculateATR(highs, lows, closes, 14);
    const atrVal = atrResults[atrResults.length - 1] || 0;

    return {
        currentDir,
        prevDir,
        rsiVal,
        adxVal,
        adxRising,
        prevAdxVal,
        atrVal,
        adxResults,
        superTrendData: stData,
    };
}

module.exports = {
    calculateSuperTrend,
    calculateRSI,
    calculateADX,
    calculateATR,
    getPipValue,
    calculateAllIndicators,
};
