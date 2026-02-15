// backend/src/services/historicalDataService.js - Fetch and cache historical candles from Oanda
// Used by backtestEngine to run strategy simulations on past data
const fs = require("fs");
const path = require("path");
const oandaClient = require("./Oandaclient");
const logger = require("../utils/logger");

const HISTORICAL_DIR = path.join(__dirname, "../../data/historical");

// Oanda allows max 5000 candles per request
const MAX_CANDLES_PER_REQUEST = 5000;

// Rate limit: 60 requests/minute -> wait 1050ms between requests (with buffer)
const REQUEST_DELAY_MS = 1050;

class HistoricalDataService {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || HISTORICAL_DIR;
        this.client = options.client || oandaClient;
        this.requestDelayMs = options.requestDelayMs || REQUEST_DELAY_MS;
    }

    /**
     * Get historical candles for an instrument. Uses cache if available, fetches from Oanda otherwise.
     *
     * @param {string} instrument - e.g. "AUD_USD"
     * @param {string} granularity - e.g. "M15", "H1", "H4"
     * @param {number} fromTimestamp - Start time as UNIX timestamp (seconds)
     * @param {number} toTimestamp - End time as UNIX timestamp (seconds)
     * @param {object} options - { forceRefresh: false }
     * @returns {Promise<Array<{time: number, open: number, high: number, low: number, close: number, volume: number}>>}
     */
    async getCandles(instrument, granularity, fromTimestamp, toTimestamp, options = {}) {
        if (!instrument || !granularity || !fromTimestamp || !toTimestamp) {
            throw new Error("Missing required parameters: instrument, granularity, fromTimestamp, toTimestamp");
        }

        if (fromTimestamp >= toTimestamp) {
            throw new Error("fromTimestamp must be before toTimestamp");
        }

        const cacheFile = this._getCacheFilePath(instrument, granularity, fromTimestamp, toTimestamp);

        // Return cached data if available and not forcing refresh
        if (!options.forceRefresh && this._isCacheValid(cacheFile)) {
            logger.info(`Cache hit: ${instrument} ${granularity} ${this._formatDate(fromTimestamp)} to ${this._formatDate(toTimestamp)}`);
            return this._readCache(cacheFile);
        }

        // Fetch from Oanda with pagination
        logger.info(`Fetching ${instrument} ${granularity} from ${this._formatDate(fromTimestamp)} to ${this._formatDate(toTimestamp)}`);
        const candles = await this._fetchAllCandles(instrument, granularity, fromTimestamp, toTimestamp);

        // Cache the results
        this._writeCache(cacheFile, candles);
        logger.info(`Cached ${candles.length} candles for ${instrument} ${granularity}`);

        return candles;
    }

    /**
     * Fetch candles across multiple instruments in sequence (respecting rate limits)
     *
     * @param {string[]} instruments - Array of instrument names
     * @param {string} granularity
     * @param {number} fromTimestamp
     * @param {number} toTimestamp
     * @param {object} options
     * @returns {Promise<Object>} Map of instrument -> candle array
     */
    async getCandlesMultiple(instruments, granularity, fromTimestamp, toTimestamp, options = {}) {
        const results = {};

        for (const instrument of instruments) {
            results[instrument] = await this.getCandles(
                instrument, granularity, fromTimestamp, toTimestamp, options
            );
        }

        return results;
    }

    /**
     * Fetch all candles between from/to, paginating through Oanda's 5000 candle limit.
     * Each request fetches up to 5000 candles starting from the `from` cursor,
     * then advances the cursor past the last returned candle.
     */
    async _fetchAllCandles(instrument, granularity, fromTimestamp, toTimestamp) {
        const allCandles = [];
        let cursor = fromTimestamp;

        while (cursor < toTimestamp) {
            // Respect rate limits between requests (skip delay before first request)
            if (allCandles.length > 0) {
                await this._delay(this.requestDelayMs);
            }

            // Use from + count pagination (Oanda rejects count + from + to together)
            const response = await this.client.getCandles(
                instrument,
                granularity,
                MAX_CANDLES_PER_REQUEST,
                { from: cursor.toString() }
            );

            const rawCandles = response.candles || [];
            if (rawCandles.length === 0) {
                break;
            }

            // Map Oanda format to internal format, only include complete candles within range
            const mapped = rawCandles
                .filter((c) => c.complete && parseFloat(c.time) <= toTimestamp)
                .map((c) => ({
                    time: parseFloat(c.time),
                    open: parseFloat(c.mid.o),
                    high: parseFloat(c.mid.h),
                    low: parseFloat(c.mid.l),
                    close: parseFloat(c.mid.c),
                    volume: c.volume,
                }));

            allCandles.push(...mapped);

            // If last raw candle is past our end time, we're done
            const lastRawTimestamp = parseFloat(rawCandles[rawCandles.length - 1].time);
            if (lastRawTimestamp >= toTimestamp) {
                break;
            }

            // Advance cursor past the last candle we received
            const lastRawTime = parseFloat(rawCandles[rawCandles.length - 1].time);
            const newCursor = lastRawTime + 1;

            // Safety check: if cursor didn't advance, break to avoid infinite loop
            if (newCursor <= cursor) {
                logger.warn(`Cursor did not advance for ${instrument}, stopping pagination`);
                break;
            }

            cursor = newCursor;

            // If we got fewer candles than the max, we've reached the end
            if (rawCandles.length < MAX_CANDLES_PER_REQUEST) {
                break;
            }
        }

        // Sort by time and deduplicate (in case of overlap between pages)
        return this._deduplicateCandles(allCandles);
    }

    /**
     * Remove duplicate candles (same timestamp) and sort by time ascending
     */
    _deduplicateCandles(candles) {
        const seen = new Map();
        for (const candle of candles) {
            seen.set(candle.time, candle);
        }
        return Array.from(seen.values()).sort((a, b) => a.time - b.time);
    }

    /**
     * Generate a cache file path based on instrument, granularity, and date range.
     * File name uses dates (not timestamps) for human readability.
     */
    _getCacheFilePath(instrument, granularity, fromTimestamp, toTimestamp) {
        const fromDate = this._formatDateCompact(fromTimestamp);
        const toDate = this._formatDateCompact(toTimestamp);
        const filename = `${instrument}_${granularity}_${fromDate}_${toDate}.json`;
        return path.join(this.cacheDir, filename);
    }

    /**
     * Check if a cache file exists and is non-empty
     */
    _isCacheValid(filePath) {
        try {
            const stat = fs.statSync(filePath);
            return stat.size > 0;
        } catch {
            return false;
        }
    }

    /**
     * Read cached candle data from disk
     */
    _readCache(filePath) {
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    }

    /**
     * Write candle data to cache file, creating the directory if needed
     */
    _writeCache(filePath, candles) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(candles));
    }

    /**
     * List all cached data files
     * @returns {Array<{file: string, instrument: string, granularity: string}>}
     */
    listCache() {
        if (!fs.existsSync(this.cacheDir)) {
            return [];
        }

        return fs.readdirSync(this.cacheDir)
            .filter((f) => f.endsWith(".json"))
            .map((f) => {
                const parts = f.replace(".json", "").split("_");
                // Format: INST1_INST2_GRANULARITY_FROMDATE_TODATE
                // e.g. AUD_USD_M15_20251001_20260101
                return {
                    file: f,
                    instrument: `${parts[0]}_${parts[1]}`,
                    granularity: parts[2],
                    fromDate: parts[3],
                    toDate: parts[4],
                };
            });
    }

    /**
     * Clear all cached data or for a specific instrument
     * @param {string} [instrument] - Optional instrument to clear cache for
     * @returns {number} Number of files deleted
     */
    clearCache(instrument = null) {
        if (!fs.existsSync(this.cacheDir)) {
            return 0;
        }

        const files = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith(".json"));
        let deleted = 0;

        for (const file of files) {
            if (!instrument || file.startsWith(instrument)) {
                fs.unlinkSync(path.join(this.cacheDir, file));
                deleted++;
            }
        }

        return deleted;
    }

    /**
     * Format UNIX timestamp (seconds) as human-readable date string
     */
    _formatDate(timestamp) {
        return new Date(timestamp * 1000).toISOString().split("T")[0];
    }

    /**
     * Format UNIX timestamp (seconds) as compact date (YYYYMMDD) for filenames
     */
    _formatDateCompact(timestamp) {
        return new Date(timestamp * 1000).toISOString().split("T")[0].replace(/-/g, "");
    }

    /**
     * Promise-based delay for rate limiting
     */
    _delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = HistoricalDataService;
