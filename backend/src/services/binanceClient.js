// backend/src/services/binanceClient.js
const Binance = require("node-binance-api");
const logger = require("../utils/logger");

let binanceClient = null;

// Check for API credentials at the module level.
if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    logger.warn(
        "⚠️ No Binance API credentials found in environment variables. Live data features will be disabled."
    );
} else {
    try {
        logger.info(
            "🔑 Binance API credentials detected. Initializing client..."
        );
        binanceClient = new Binance().options({
            APIKEY: process.env.BINANCE_API_KEY,
            APISECRET: process.env.BINANCE_API_SECRET,
            useServerTime: true,
            test: false, // Always connect to the live API
            hedgeMode: false,
            recvWindow: 60000,
            verbose: false,
            family: 4, // Force IPv4 for stability on some systems
            // This is crucial to prevent "Cannot convert object to primitive value" errors
            // from the BigNumber.js objects returned by the WebSocket library.
            json_parse: (json) => {
                return JSON.parse(json, (key, value) => {
                    if (
                        typeof value === "object" &&
                        value !== null &&
                        typeof value.toNumber === "function"
                    ) {
                        return value.toNumber();
                    }
                    return value;
                });
            },
        });
        logger.success("✅ Binance client initialized successfully.");
    } catch (setupError) {
        logger.error(
            "❌ Failed to initialize Binance client:",
            setupError.message
        );
        binanceClient = null; // Ensure client is null on failure
    }
}

module.exports = binanceClient;
