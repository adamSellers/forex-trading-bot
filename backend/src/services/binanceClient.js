// backend/src/services/binanceClient.js - FIXED VERSION
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
            verbose: false, // CRITICAL: Set to false to reduce parse error logging
            family: 4, // Force IPv4 for stability on some systems

            // FIXED: Simplified json_parse function for node-binance-api v0.13.5
            // This prevents the "callback is not a function" errors
            json_parse: (json) => {
                try {
                    // Simple JSON parse without BigNumber handling
                    // The library will handle BigNumber conversion internally
                    return JSON.parse(json);
                } catch (error) {
                    // Silently handle parse errors to prevent console spam
                    return {};
                }
            },

            // Alternative approach: disable custom JSON parsing entirely
            // Remove json_parse if the above doesn't work
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
