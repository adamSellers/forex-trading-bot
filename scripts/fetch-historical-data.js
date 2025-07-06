// scripts/fetch-historical-data.js
require("dotenv").config({ path: "./backend/.env" });
const Binance = require("node-binance-api");
const fs = require("fs");
const path = require("path");
const logger = require("../backend/src/utils/logger");

const binance = new Binance().options({
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_API_SECRET,
    useServerTime: true,
});

const ASSETS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"];
const TIMEFRAME = "1h";
const MONTHS_TO_FETCH = 12;
const OUTPUT_DIR = path.join(__dirname, "../backend/data/historical");

// Binance API limit is 1000 candles per request.
const API_LIMIT = 1000;

/**
 * Fetches historical candles for a given symbol, handling pagination.
 */
async function fetchAllCandles(symbol, interval, months) {
    logger.info(
        `Fetching ${months} months of ${interval} data for ${symbol}...`
    );
    const hoursInMonth = 30 * 24;
    const intervalHours = parseInt(interval) || 1;
    const totalCandlesToFetch = (hoursInMonth * months) / intervalHours;
    let allCandles = [];
    let lastCandleTime = null;

    while (allCandles.length < totalCandlesToFetch) {
        try {
            const options = { limit: API_LIMIT };
            if (lastCandleTime) {
                options.endTime = lastCandleTime - 1;
            }

            const candles = await binance.candlesticks(
                symbol,
                interval,
                false,
                options
            );

            if (!candles || candles.length === 0) {
                logger.success(
                    `No more data for ${symbol}. Total candles: ${allCandles.length}`
                );
                break;
            }

            // Format candles
            const formattedCandles = candles.map((c) => ({
                openTime: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                closeTime: c[6],
            }));

            allCandles = formattedCandles.concat(allCandles);
            lastCandleTime = candles[0][0]; // The open time of the first candle in the batch

            logger.debug(
                `Fetched ${candles.length} candles for ${symbol}. Total: ${allCandles.length}`
            );
            await new Promise((resolve) => setTimeout(resolve, 500)); // Avoid rate limits
        } catch (error) {
            logger.error(
                `Error fetching candles for ${symbol}:`,
                error.message
            );
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait longer on error
            break; // Stop on error
        }
    }

    allCandles.sort((a, b) => a.openTime - b.openTime);
    return allCandles;
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        logger.info(`Created output directory: ${OUTPUT_DIR}`);
    }

    for (const asset of ASSETS) {
        const candles = await fetchAllCandles(
            asset,
            TIMEFRAME,
            MONTHS_TO_FETCH
        );
        if (candles.length > 0) {
            const filename = `${asset}-${TIMEFRAME}-${MONTHS_TO_FETCH}m.json`;
            const filepath = path.join(OUTPUT_DIR, filename);
            fs.writeFileSync(filepath, JSON.stringify(candles, null, 2));
            logger.success(
                `Saved ${candles.length} candles for ${asset} to ${filepath}`
            );
        }
    }

    logger.success("✅ Historical data fetching complete.");
}

main().catch((err) => {
    logger.error("❌ An unexpected error occurred:", err);
    process.exit(1);
});
