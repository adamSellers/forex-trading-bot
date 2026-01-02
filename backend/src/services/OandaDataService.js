// backend/src/services/OandaDataService.js - Oanda Data Service
const logger = require("../utils/logger");

const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

class OandaDataService {
    constructor(instruments = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"]) {
        this.instruments = instruments;
        this.priceCache = {};
        this.candleCache = {};
        this.isRunning = false;
        this.priceInterval = null;
        this.candleInterval = null;
    }

    async oandaRequest(endpoint) {
        const response = await fetch(`${OANDA_BASE_URL}${endpoint}`, {
            headers: {
                Authorization: `Bearer ${OANDA_API_KEY}`,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Oanda API error: ${response.status} - ${error}`);
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
        try {
            const instruments = this.instruments.join(",");
            const data = await this.oandaRequest(
                `/v3/accounts/${OANDA_ACCOUNT_ID}/pricing?instruments=${instruments}`
            );

            data.prices.forEach((price) => {
                const bid = parseFloat(price.bids?.[0]?.price || 0);
                const ask = parseFloat(price.asks?.[0]?.price || 0);
                const pipValue = this.getPipValue(price.instrument);
                const spread = (ask - bid) / pipValue;

                this.priceCache[price.instrument] = {
                    instrument: price.instrument,
                    bid,
                    ask,
                    price: (bid + ask) / 2, // mid price
                    spread: parseFloat(spread.toFixed(1)),
                    tradeable: price.tradeable,
                    time: price.time,
                    timestamp: Date.now(),
                };
            });
        } catch (error) {
            logger.error("❌ Price fetch error:", error.message);
        }
    }

    async fetchAllCandles() {
        for (const instrument of this.instruments) {
            try {
                await this.fetchCandles(instrument, "M15", 500);
            } catch (error) {
                logger.error(
                    `❌ Candle fetch error for ${instrument}:`,
                    error.message
                );
            }
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

            return candles;
        } catch (error) {
            logger.error(
                `❌ Candle fetch error for ${instrument}:`,
                error.message
            );
            return [];
        }
    }

    // Methods expected by SignalGenerator
    getCurrentPrice(instrument) {
        return this.priceCache[instrument] || null;
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
        return {
            isRunning: this.isRunning,
            instruments: this.instruments,
            pricesCached: Object.keys(this.priceCache).length,
            candlesCached: Object.keys(this.candleCache).length,
        };
    }
}

module.exports = OandaDataService;
