// backend/src/services/OandaDataService.js - Oanda Data Service with EventEmitter
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { buildOandaApiError } = require("../utils/oandaErrors");
const { ACCOUNT_CURRENCY } = require("../runtime/currencyConversion");
const {
    evaluateCandleFreshness,
    evaluateIntradayEntryFreshness,
    getForexMarketState,
} = require("../runtime/marketDataFreshness");

const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID;
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";
const HOME_CONVERSION_MAX_AGE_MS = 30_000;
const AUD_CONVERSION_BRIDGES = ["AUD_USD"];
const INSTRUMENT_METADATA_REFRESH_MS = 6 * 60 * 60 * 1000;
const INSTRUMENT_METADATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRICE_FRESHNESS_MAX_AGE_MS = 20_000;
const CANDLE_REFRESH_FRESHNESS_MAX_AGE_MS = 180_000;
const OANDA_REQUEST_TIMEOUT_MS = 10_000;

class OandaDataService extends EventEmitter {
    constructor(
        instruments = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"],
        options = {}
    ) {
        super();
        this.instruments = instruments;
        this.priceCache = {};
        this.homeConversionCache = {};
        this.homeConversionMaxAgeMs = HOME_CONVERSION_MAX_AGE_MS;
        this.conversionBridgeInstruments = new Set(AUD_CONVERSION_BRIDGES);
        this.instrumentMetadataCache = {};
        this.instrumentMetadataMaxAgeMs = INSTRUMENT_METADATA_MAX_AGE_MS;
        this.instrumentMetadataProvider =
            options.instrumentMetadataProvider || null;
        this.candleCache = {};
        this.candleCacheUpdatedAt = {};
        this.primaryTimeframe = "4h";
        this.enableHTFFilter = false;
        this.htfTimeframe = "1h";
        // Granularities required by the active live strategy and any older
        // broker-owned position that is still being managed to exit.
        this.runtimeGranularities = new Set();
        this.isRunning = false;
        this.priceInterval = null;
        this.candleInterval = null;
        this.instrumentMetadataInterval = null;
        this.isFetchingPrices = false;
        this.isFetchingCandles = false;
        this.failureLogTimestamps = new Map();
        this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
            ? Math.min(options.requestTimeoutMs, OANDA_REQUEST_TIMEOUT_MS)
            : OANDA_REQUEST_TIMEOUT_MS;
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
                headers: {
                    Authorization: `Bearer ${OANDA_API_KEY}`,
                    "Content-Type": "application/json",
                },
                signal: controller.signal,
            });
            if (!response.ok) throw await buildOandaApiError(response);
            return await response.json();
        } catch (error) {
            if (controller.signal.aborted) {
                // A busy event loop can delay the abort callback beyond the
                // configured deadline, so do not claim an exact elapsed time.
                const timeoutError = new Error(
                    `Oanda request exceeded ${this.requestTimeoutMs}ms deadline`
                );
                timeoutError.name = "OandaTimeoutError";
                timeoutError.code = "OANDA_TIMEOUT";
                timeoutError.cause = error;
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    getPipValue(instrument) {
        return instrument.includes("JPY") ? 0.01 : 0.0001;
    }

    async start() {
        if (!OANDA_API_KEY || !OANDA_ACCOUNT_ID) {
            logger.warn("OANDA credentials not set - data service disabled");
            return;
        }

        this.isRunning = true;
        logger.info("📡 Oanda Data Service starting...");

        // Initial fetch
        await this.fetchAllPrices();
        await this.refreshInstrumentMetadata();
        await this.fetchAllCandles();

        // Poll prices every 5 seconds
        this.priceInterval = setInterval(() => this.fetchAllPrices(), 5000);

        // Poll candles every 60 seconds
        this.candleInterval = setInterval(() => this.fetchAllCandles(), 60000);
        this.instrumentMetadataInterval = setInterval(
            () => this.refreshInstrumentMetadata(),
            INSTRUMENT_METADATA_REFRESH_MS
        );

        logger.success("✅ Oanda Data Service running");
    }

    stop() {
        this.isRunning = false;
        if (this.priceInterval) clearInterval(this.priceInterval);
        if (this.candleInterval) clearInterval(this.candleInterval);
        if (this.instrumentMetadataInterval) {
            clearInterval(this.instrumentMetadataInterval);
        }
        logger.info("⏹️ Oanda Data Service stopped");
    }

    async fetchAllPrices() {
        if (this.isFetchingPrices) {
            return;
        }

        this.isFetchingPrices = true;
        try {
            const instruments = this.getPricingInstruments().join(",");
            const data = await this.oandaRequest(
                `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${instruments}&includeHomeConversions=true`
            );

            const updatedPrices = {};
            const fetchedAt = Date.now();

            this.seedHomeConversions(data.homeConversions, fetchedAt);

            data.prices.forEach((price) => {
                const bid = Number(price.bids?.[0]?.price);
                const ask = Number(price.asks?.[0]?.price);
                const brokerTimestamp = Date.parse(price.time);
                const validQuote = Number.isFinite(bid) && bid > 0 &&
                    Number.isFinite(ask) && ask >= bid;
                const validTime = Number.isFinite(brokerTimestamp) &&
                    brokerTimestamp > 0 && brokerTimestamp <= fetchedAt + 1000;
                const mid = validQuote ? (bid + ask) / 2 : null;
                const pipValue = this.getPipValue(price.instrument);
                const spread = validQuote ? (ask - bid) / pipValue : null;

                const priceData = {
                    instrument: price.instrument,
                    bid: validQuote ? bid : null,
                    ask: validQuote ? ask : null,
                    mid,
                    price: mid, // alias for compatibility
                    spread,
                    tradeable: validQuote && validTime && price.tradeable === true,
                    time: price.time,
                    timestamp: validTime ? brokerTimestamp : null,
                    fetchedAt,
                    invalidReason: !validQuote ? "INVALID_BID_ASK" : !validTime ? "INVALID_BROKER_TIME" : null,
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

    getPricingInstruments() {
        return Array.from(
            new Set([...this.instruments, ...this.conversionBridgeInstruments])
        );
    }

    seedHomeConversions(homeConversions = [], updatedAt = Date.now()) {
        for (const conversion of Array.isArray(homeConversions)
            ? homeConversions
            : []) {
            const currency = String(conversion?.currency || "").toUpperCase();
            const accountGain = Number(conversion?.accountGain);
            const accountLoss = Number(conversion?.accountLoss);
            const positionValue = Number(conversion?.positionValue);
            if (
                !currency ||
                ![accountGain, accountLoss, positionValue].some(
                    (value) => Number.isFinite(value) && value > 0
                )
            ) {
                continue;
            }

            this.homeConversionCache[currency] = {
                currency,
                accountGain:
                    Number.isFinite(accountGain) && accountGain > 0
                        ? accountGain
                        : null,
                accountLoss:
                    Number.isFinite(accountLoss) && accountLoss > 0
                        ? accountLoss
                        : null,
                positionValue:
                    Number.isFinite(positionValue) && positionValue > 0
                        ? positionValue
                        : null,
                updatedAt,
            };
        }
    }

    getHomeConversion(currency) {
        const normalizedCurrency = String(currency || "").toUpperCase();
        if (normalizedCurrency === ACCOUNT_CURRENCY) {
            return {
                currency: ACCOUNT_CURRENCY,
                accountGain: 1,
                accountLoss: 1,
                positionValue: 1,
                updatedAt: Date.now(),
            };
        }

        const conversion = this.homeConversionCache[normalizedCurrency];
        if (
            !conversion ||
            Date.now() - conversion.updatedAt > this.homeConversionMaxAgeMs
        ) {
            return null;
        }
        return { ...conversion };
    }

    getHomeConversionRate(currency, { purpose = "neutral", amount = 0 } = {}) {
        const conversion = this.getHomeConversion(currency);
        if (!conversion) return null;

        if (purpose === "margin" || purpose === "position") {
            return (
                conversion.positionValue ||
                conversion.accountLoss ||
                conversion.accountGain
            );
        }
        if (purpose === "pnl" && Number(amount) < 0) {
            return (
                conversion.accountLoss ||
                conversion.positionValue ||
                conversion.accountGain
            );
        }
        if (purpose === "pnl" && Number(amount) > 0) {
            return (
                conversion.accountGain ||
                conversion.positionValue ||
                conversion.accountLoss
            );
        }
        if (conversion.accountGain && conversion.accountLoss) {
            return (conversion.accountGain + conversion.accountLoss) / 2;
        }
        return (
            conversion.positionValue ||
            conversion.accountLoss ||
            conversion.accountGain ||
            null
        );
    }

    async fetchInstrumentMetadataFromBroker() {
        if (this.instrumentMetadataProvider) {
            return this.instrumentMetadataProvider(this.getPricingInstruments());
        }

        // Lazy import avoids coupling the market-data constructor to the order
        // client and reuses its account-instrument response/cache.
        const oandaClient = require("./Oandaclient");
        const response = await oandaClient.getInstruments();
        return response?.instruments || [];
    }

    async refreshInstrumentMetadata() {
        try {
            const instruments = await this.fetchInstrumentMetadataFromBroker();
            const updatedAt = Date.now();
            for (const instrument of Array.isArray(instruments)
                ? instruments
                : []) {
                if (!instrument?.name) continue;
                this.instrumentMetadataCache[instrument.name] = {
                    ...instrument,
                    updatedAt,
                };
            }
            return this.instrumentMetadataCache;
        } catch (error) {
            this.logFailureThrottled(
                "instrument-metadata",
                "❌ Instrument metadata refresh error:",
                error.message
            );
            return this.instrumentMetadataCache;
        }
    }

    getInstrumentFinancing(instrument) {
        const metadata = this.instrumentMetadataCache[instrument];
        if (!metadata) {
            return { status: "UNMODELED_MISSING_INSTRUMENT_METADATA" };
        }
        if (
            Date.now() - metadata.updatedAt >
            this.instrumentMetadataMaxAgeMs
        ) {
            return {
                status: "UNMODELED_STALE_INSTRUMENT_METADATA",
                updatedAt: metadata.updatedAt,
                source: "OANDA_ACCOUNT_INSTRUMENTS",
            };
        }

        const financing = metadata.financing || {};
        const longRate = Number(financing.longRate);
        const shortRate = Number(financing.shortRate);
        if (!Number.isFinite(longRate) || !Number.isFinite(shortRate)) {
            return {
                status: "UNMODELED_MISSING_FINANCING_RATE",
                updatedAt: metadata.updatedAt,
                source: "OANDA_ACCOUNT_INSTRUMENTS",
            };
        }

        return {
            status: "MODELED",
            longRateAnnual: longRate,
            shortRateAnnual: shortRate,
            financingDaysOfWeek: Array.isArray(financing.financingDaysOfWeek)
                ? financing.financingDaysOfWeek
                : null,
            updatedAt: metadata.updatedAt,
            source: "OANDA_ACCOUNT_INSTRUMENTS",
        };
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
            this.convertTimeframe(this.primaryTimeframe || "4h"),
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
     * ("4h", "1d"); the union with the configured primary granularity
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

    async fetchCandles(instrument, granularity = "H4", count = 500) {
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
            let previousTime = -Infinity;
            for (const candle of candles) {
                const candleTime = Date.parse(candle.time);
                if (!Number.isFinite(candleTime) || candleTime <= previousTime ||
                    ![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0) ||
                    candle.high < Math.max(candle.open, candle.close) ||
                    candle.low > Math.min(candle.open, candle.close)) {
                    throw new Error("Invalid or unordered completed candle data");
                }
                previousTime = candleTime;
            }

            const key = `${instrument}_${granularity}`;
            this.candleCache[key] = candles;
            this.candleCacheUpdatedAt[key] = Date.now();

            return candles;
        } catch (error) {
            this.logFailureThrottled(
                `candles:${instrument}:${granularity}`,
                `❌ Candle fetch error for ${instrument} (${granularity}):`,
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

    getEntryFreshness(instrument, { nowMs = Date.now() } = {}) {
        return evaluateIntradayEntryFreshness({
            m15Candles: this.getCandles(instrument, "15m"),
            h1Candles: this.getCandles(instrument, "1h"),
            nowMs,
        });
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
        return map[tf] || "H4";
    }

    getStatus() {
        const candleCount = Object.values(this.candleCache).reduce(
            (total, candles) => total + (Array.isArray(candles) ? candles.length : 0),
            0
        );

        return {
            isRunning: this.isRunning,
            instruments: this.instruments,
            pricingInstruments: this.getPricingInstruments(),
            pricesCached: Object.keys(this.priceCache).length,
            homeConversionsCached: Object.keys(this.homeConversionCache).length,
            instrumentMetadataCached: Object.keys(
                this.instrumentMetadataCache
            ).length,
            candlesCached: Object.keys(this.candleCache).length,
            candleCount,
            candleGranularities: this.getRequiredGranularities(),
            freshness: this.getFreshnessStatus(),
        };
    }

    getFreshnessStatus(options = {}) {
        const nowMs = Number(options.nowMs) || Date.now();
        const maxPriceAgeMs =
            Number(options.maxPriceAgeMs) || PRICE_FRESHNESS_MAX_AGE_MS;
        const maxCandleRefreshAgeMs =
            Number(options.maxCandleRefreshAgeMs) ||
            CANDLE_REFRESH_FRESHNESS_MAX_AGE_MS;
        const priceRows = this.instruments.map((instrument) => {
            const updatedAt = Number(this.priceCache[instrument]?.timestamp) || null;
            return {
                instrument,
                updatedAt,
                invalid: Boolean(this.priceCache[instrument]?.invalidReason),
                ageMs: updatedAt === null ? null : Math.max(0, nowMs - updatedAt),
            };
        });
        const candleRows = this.instruments.flatMap((instrument) =>
            this.getRequiredGranularities().map((granularity) => {
                const key = `${instrument}_${granularity}`;
                const updatedAt = Number(this.candleCacheUpdatedAt[key]) || null;
                const completedCandle = ["M15", "H1"].includes(granularity)
                    ? evaluateCandleFreshness(this.candleCache[key], granularity, { nowMs })
                    : null;
                return {
                    key,
                    instrument,
                    granularity,
                    updatedAt,
                    completedCandle,
                    ageMs:
                        updatedAt === null ? null : Math.max(0, nowMs - updatedAt),
                };
            })
        );
        const stalePrices = priceRows.filter(
            (row) => row.invalid || row.ageMs === null || row.ageMs > maxPriceAgeMs
        );
        const staleCandles = candleRows.filter(
            (row) =>
                row.ageMs === null || row.ageMs > maxCandleRefreshAgeMs || row.completedCandle?.fresh === false
        );
        const finitePriceAges = priceRows
            .map((row) => row.ageMs)
            .filter(Number.isFinite);
        const finiteCandleAges = candleRows
            .map((row) => row.ageMs)
            .filter(Number.isFinite);

        return {
            checkedAt: nowMs,
            market: getForexMarketState(nowMs),
            pricesFresh: stalePrices.length === 0,
            candlesFresh: staleCandles.length === 0,
            oldestPriceAgeMs:
                finitePriceAges.length > 0 ? Math.max(...finitePriceAges) : null,
            oldestCandleRefreshAgeMs:
                finiteCandleAges.length > 0
                    ? Math.max(...finiteCandleAges)
                    : null,
            lastPriceUpdateAt:
                priceRows.length > 0 && priceRows.every((row) => row.updatedAt !== null)
                    ? Math.max(...priceRows.map((row) => row.updatedAt))
                    : null,
            lastCandleRefreshAt:
                candleRows.length > 0 && candleRows.every((row) => row.updatedAt !== null)
                    ? Math.max(...candleRows.map((row) => row.updatedAt))
                    : null,
            maxPriceAgeMs,
            maxCandleRefreshAgeMs,
            stalePrices: stalePrices.map((row) => row.instrument),
            staleCandles: staleCandles.map((row) => row.key),
            completedCandles: candleRows.filter((row) => row.completedCandle).map((row) => ({
                instrument: row.instrument,
                ...row.completedCandle,
            })),
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
            this.refreshInstrumentMetadata();
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
            if (!this.conversionBridgeInstruments.has(instrument)) {
                delete this.priceCache[instrument];
            }
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
