// backend/scripts/fetch-historical-candles.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Configuration
const CONFIG = {
    symbol: "BTCUSDT",
    interval: "1h",
    limit: 1000, // Number of hours to fetch (approx 41 days)
    outputFile: "BTCUSDT-1h-1000.json",
};

const OUTPUT_DIR = path.join(__dirname, "../data/historical");

async function fetchCandles() {
    console.log(
        `🚀 Fetching ${CONFIG.limit} candles for ${CONFIG.symbol} (${CONFIG.interval})...`
    );

    // Ensure directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    try {
        // Binance Public API (No keys needed for historical data)
        const url = `https://api.binance.com/api/v3/klines`;
        const response = await axios.get(url, {
            params: {
                symbol: CONFIG.symbol,
                interval: CONFIG.interval,
                limit: CONFIG.limit,
            },
        });

        // Format: [Open Time, Open, High, Low, Close, Volume, ...]
        // We map it to the object format our Engine expects
        const candles = response.data.map((c) => ({
            openTime: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
            closeTime: c[6],
        }));

        const outputPath = path.join(OUTPUT_DIR, CONFIG.outputFile);
        fs.writeFileSync(outputPath, JSON.stringify(candles, null, 2));

        console.log(`✅ Successfully saved ${candles.length} candles.`);
        console.log(`💾 Location: ${outputPath}`);
        console.log(
            `ℹ️  Date Range: ${new Date(
                candles[0].openTime
            ).toISOString()} to ${new Date(
                candles[candles.length - 1].openTime
            ).toISOString()}`
        );
    } catch (error) {
        console.error("❌ Error fetching candles:", error.message);
    }
}

fetchCandles();
