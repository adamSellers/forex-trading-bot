// backend/src/services/OandaDataService.js - Oanda Data Service with EventEmitter
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { buildOandaApiError } = require("../utils/oandaErrors");

const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

class OandaDataService extends EventEmitter {
    constructor(instruments = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"]) {
        super();
        this.instruments = instruments;
        this.priceCache = {};
        this.candleCache = {};
        this.candleCacheUpdatedAt = {};
        this.primaryTimeframe = "15m";
        this.enableHTFFilter = false;
        this.htfTimeframe = "1h";
        // Granularities required by active runtime runs (live/shadow/candidate).
        // Each run carries its own config snapshot, so a run can need timeframes
        // the GLOBAL config doesn't (e.g. a candidate with enableHTFFilter:true
        // while the global config has it off). Kept in sync by the runtime
        // coordinator via updateRuntimeTimeframes(); if a required granularity
        // is never fetched, HTF-filtered strategies fail CLOSED and never trade.
        this.runtimeGranularities = new Set();
        this.isRunning = false;
        this.priceInterval = null;
        this.candleInterval = null;
        this.isFetchingPrices = false;
        this.isFetchingCandles = false;
        this.failureLogTimestamps = new Map();
    }

    logFailureThrottled(key, message, data = null, intervalMs = 60000) {
        const now = Date.now();
        const lastLoggedAt = this.failureLogTimestamps.get(key) || 0;
        if (now - lastLoggedAt < intervalMs) {
            return;
        }

        this.failureLogTimestamps.set(key, now);
        logger.error(message, data);
    }

    async oandaRequest(endpoint) {
        const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
            headers: {
                Authorization: `Bearer ${OANDA_API_KEY}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            throw await buildOandaApiError(response);
        }

        return response.json();
    }

    getPipValue(instrument) {
        return instrument.includes("JPY") ? 0.01 : 0.0001;
    }

    async start() {
        if (!OANDA_API_KEY) {
            logger.warn("⚠️ OANDA_API_KEY not set - data service disabled");
            return;
        }

        this.isRunning = true;
        logger.info("📡 Oanda Data Service starting...");

        // Initial fetch
        await this.fetchAllPrices();
        await this.fetchAllCandles();

        // Poll prices every 5 seconds
        this.priceInterval = setInterval(() => this.fetchAllPrices(), 5000);

        // Poll candles every 60 seconds
        this.candleInterval = setInterval(() => this.fetchAllCandles(), 60000);

        logger.success("✅ Oanda Data Service running");
    }

    stop() {
        this.isRunning = false;
        if (this.priceInterval) clearInterval(this.priceInterval);
        if (this.candleInterval) clearInterval(this.candleInterval);
        logger.info("⏹️ Oanda Data Service stopped");
    }

    async fetchAllPrices() {
        if (this.isFetchingPrices) {
            return;
        }

        this.isFetchingPrices = true;
        try {
            const instruments = this.instruments.join(",");
            const data = await this.oandaRequest(
                `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${instruments}`
            );

            const updatedPrices = {};

            data.prices.forEach((price) => {
                const bid = parseFloat(price.bids?.[0]?.price || 0);
                const ask = parseFloat(price.asks?.[0]?.price || 0);
                const mid = (bid + ask) / 2;
                const pipValue = this.getPipValue(price.instrument);
                const spread = (ask - bid) / pipValue;

                const priceData = {
                    instrument: price.instrument,
                    bid,
                    ask,
                    mid,
                    price: mid, // alias for compatibility
                    spread: parseFloat(spread.toFixed(1)),
                    tradeable: price.tradeable,
                    time: price.time,
                    timestamp: Date.now(),
                };

                this.priceCache[price.instrument] = priceData;
                updatedPrices[price.instrument] = priceData;
            });

            // Emit price update event for socket.io broadcasting
            this.emit("priceUpdate", updatedPrices);
        } catch (error) {
            this.logFailureThrottled(
                "prices",
                "❌ Price fetch error:",
                error.message
            );
        } finally {
            this.isFetchingPrices = false;
        }
    }

    async fetchAllCandles() {
        if (this.isFetchingCandles) {
            return;
        }

        this.isFetchingCandles = true;
        const granularities = this.getRequiredGranularities();

        try {
            for (const instrument of this.instruments) {
                for (const granularity of granularities) {
                    await this.fetchCandles(instrument, granularity, 500);
                }
            }
        } finally {
            this.isFetchingCandles = false;
        }
    }

    getRequiredGranularities() {
        const granularities = new Set([
            this.convertTimeframe(this.primaryTimeframe || "15m"),
        ]);

        if (this.enableHTFFilter) {
            granularities.add(this.convertTimeframe(this.htfTimeframe || "1h"));
        }

        this.runtimeGranularities.forEach((granularity) =>
            granularities.add(granularity)
        );

        return Array.from(granularities);
    }

    /**
     * Replace the set of timeframes required by active runtime runs.
     * Called by the runtime coordinator whenever run sessions change
     * (register/stop/config update). Accepts config-style timeframes
     * ("15m", "1h", "4h"); the union with the global-config granularities
     * is what fetchAllCandles polls.
     */
    updateRuntimeTimeframes(timeframes = []) {
        const previousRequired = new Set(this.getRequiredGranularities());

        this.runtimeGranularities = new Set(
            (Array.isArray(timeframes) ? timeframes : [])
                .filter(Boolean)
                .map((timeframe) => this.convertTimeframe(timeframe))
        );

        // Fetch immediately when the requirement set grows so a newly launched
        // run doesn't sit with an empty candle cache until the next 60s poll —
        // HTF-filtered strategies block all entries while candles are missing.
        const addedGranularities = this.getRequiredGranularities().filter(
            (granularity) => !previousRequired.has(granularity)
        );
        if (addedGranularities.length > 0 && this.isRunning) {
            this.fetchAllCandles();
        }
    }

    async fetchCandles(instrument, granularity = "M15", count = 500) {
        try {
            const data = await this.oandaRequest(
                `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
            );

            const candles = data.candles
                .filter((c) => c.complete)
                .map((c) => ({
                    time: c.time,
                    open: parseFloat(c.mid.o),
                    high: parseFloat(c.mid.h),
                    low: parseFloat(c.mid.l),
                    close: parseFloat(c.mid.c),
                    volume: c.volume,
                }));

            const key = `${instrument}_${granularity}`;
            this.candleCache[key] = candles;
            this.candleCacheUpdatedAt[key] = Date.now();

            return candles;
        } catch (error) {
            this.logFailureThrottled(
                `candles:${instrument}:${granularity}`,
                `❌ Candle fetch error for ${instrument}:`,
                error.message
            );
            return [];
        }
    }

    // Methods expected by SignalGenerator and routes
    getCurrentPrice(instrument) {
        return this.priceCache[instrument] || null;
    }

    getCurrentPrices() {
        return this.priceCache;
    }

    getAllPrices() {
        return this.priceCache;
    }

    getCandles(instrument, timeframe = "15m") {
        // Convert timeframe format (15m -> M15)
        const granularity = this.convertTimeframe(timeframe);
        const key = `${instrument}_${granularity}`;
        return this.candleCache[key] || [];
    }

    convertTimeframe(tf) {
        const map = {
            "1m": "M1",
            "5m": "M5",
            "15m": "M15",
            "30m": "M30",
            "1h": "H1",
            "4h": "H4",
            "1d": "D",
        };
        return map[tf] || "M15";
    }

    getStatus() {
        const candleCount = Object.values(this.candleCache).reduce(
            (total, candles) => total + (Array.isArray(candles) ? candles.length : 0),
            0
        );

        return {
            isRunning: this.isRunning,
            instruments: this.instruments,
            pricesCached: Object.keys(this.priceCache).length,
            candlesCached: Object.keys(this.candleCache).length,
            candleCount,
            candleGranularities: this.getRequiredGranularities(),
        };
    }

    updateCandleConfig({
        timeframe = "15m",
        enableHTFFilter = false,
        htfTimeframe = "1h",
    } = {}) {
        this.primaryTimeframe = timeframe || "15m";
        this.enableHTFFilter = enableHTFFilter === true;
        this.htfTimeframe = htfTimeframe || "1h";

        if (this.isRunning) {
            this.fetchAllCandles();
        }
    }

    /**
     * Update active instruments (called by ConfigService)
     */
    updateInstruments(newInstruments) {
        if (!newInstruments || !Array.isArray(newInstruments)) return;

        const oldInstruments = [...this.instruments];
        this.instruments = newInstruments;

        // Fetch data for any new instruments
        const addedInstruments = newInstruments.filter(
            (i) => !oldInstruments.includes(i)
        );
        if (addedInstruments.length > 0 && this.isRunning) {
            this.fetchAllPrices();
            addedInstruments.forEach((instrument) => {
                this.getRequiredGranularities().forEach((granularity) => {
                    this.fetchCandles(instrument, granularity, 500);
                });
            });
        }

        // Clean up cache for removed instruments
        const removedInstruments = oldInstruments.filter(
            (i) => !newInstruments.includes(i)
        );
        removedInstruments.forEach((instrument) => {
            delete this.priceCache[instrument];
            // Remove candle cache entries for this instrument
            Object.keys(this.candleCache).forEach((key) => {
                if (key.startsWith(instrument + "_")) {
                    delete this.candleCache[key];
                    delete this.candleCacheUpdatedAt[key];
                }
            });
        });
    }
}

module.exports = OandaDataService;
