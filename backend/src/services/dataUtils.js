// backend/src/services/dataUtils.js
const logger = require("../utils/logger");

/**
 * Fetches historical candlestick data from the Binance API with retries.
 * @param {object} binance - The initialized Binance API client.
 * @param {string} symbol - The trading pair symbol (e.g., 'BTCUSDT').
 * @param {string} interval - The candle interval (e.g., '1h', '4h').
 * @param {number} limit - The number of candles to fetch.
 * @returns {Promise<Array>} A promise that resolves to an array of formatted candle objects.
 * @throws {Error} If the API call fails or returns no data after retries.
 */
async function getHistoricalCandles(binance, symbol, interval, limit = 500) {
    try {
        let retries = 2;
        let candles;

        while (retries > 0) {
            try {
                candles = await binance.candlesticks(symbol, interval, false, {
                    limit: Math.min(limit, 1000), // Binance API max limit is 1000
                });
                if (candles && candles.length > 0) {
                    break; // Success
                }
                // If API returns empty array, treat it as an error to trigger a retry
                throw new Error(
                    `API returned no candles for ${symbol} ${interval}.`
                );
            } catch (error) {
                retries--;
                if (retries === 0) {
                    // On final retry failure, re-throw the last error to be caught by the outer block.
                    throw error;
                }

                logger.warn(
                    `⚠️ Retrying fetch for ${symbol} ${interval} (attempts left: ${retries})...`
                );
                await new Promise((resolve) => setTimeout(resolve, 1500)); // Wait before retrying
            }
        }

        return candles.map((c) => ({
            openTime: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5],
            closeTime: c[6],
            timestamp: new Date(c[0]).toISOString(),
        }));
    } catch (error) {
        const errorMessage = `❌ Final API error fetching candles for ${symbol} ${interval}: ${error.message}`;
        logger.error(errorMessage);
        // Re-throw the error to be handled by the calling service (e.g., to halt initialization).
        throw new Error(errorMessage);
    }
}

module.exports = {
    getHistoricalCandles,
};
