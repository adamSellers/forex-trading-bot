// backend/src/services/ForexDataService.js - Forex Market Data Service
const EventEmitter = require("events");
const logger = require("../utils/logger");
const oandaClient = require("./OandaClient");

class ForexDataService extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;

        // Cache for candle data: { "AUD_USD": { "M15": [...candles] } }
        this.candleCache = {};

        // Cache for current prices: { "AUD_USD": { bid, ask, spread, mid, timestamp } }
        this.priceCache = {};

        // Instrument info (pip size, margin requirements, etc.)
        this.instrumentInfo = new Map();

        this.isReady = false;
        this.pollingInterval = null;
        this.pricePollingInterval = null;

        // Polling intervals (in milliseconds)
        this.candlePollingMs = config.candlePollingMs || 60000; // Poll candles every 60s
        this.pricePollingMs = config.pricePollingMs || 5000; // Poll prices every 5s

        logger.info(
            `📊 Forex Data Service initialized with ${
                config.assets?.length || 0
            } instruments`
        );
    }

    async initialize() {
        try {
            logger.info("📡 Initializing Forex Data Service...");

            // 1. Initialize Oanda connection
            await oandaClient.initialize();

            // 2. Load instrument info
            await this.loadInstrumentInfo();

            // 3. Initialize cache structure for all assets
            this.config.assets.forEach((instrument) => {
                this.candleCache[instrument] = {};
                this.config.timeframes.forEach((tf) => {
                    this.candleCache[instrument][tf] = [];
                });
                this.priceCache[instrument] = null;
            });

            // 4. Load initial candle data
            await this.loadInitialCandles();

            // 5. Start polling for updates
            this.startPolling();

            this.isReady = true;
            this.emit("serviceReady");
            logger.success("✅ Forex Data Service Ready.");
        } catch (error) {
            logger.error(
                `❌ Data Service Initialization Failed: ${error.message}`
            );
            this.emit("serviceError", error);
            throw error;
        }
    }

    async loadInstrumentInfo() {
        try {
            const response = await oandaClient.getInstruments();

            if (response.instruments) {
                response.instruments.forEach((inst) => {
                    this.instrumentInfo.set(inst.name, {
                        name: inst.name,
                        displayName: inst.displayName,
                        pipLocation: inst.pipLocation,
                        pipValue: Math.pow(10, inst.pipLocation),
                        minimumTradeSize: parseFloat(inst.minimumTradeSize),
                        maximumTradeUnits: parseFloat(inst.maximumTradeUnits),
                        marginRate: parseFloat(inst.marginRate),
                        displayPrecision: inst.displayPrecision,
                        tradeUnitsPrecision: inst.tradeUnitsPrecision,
                    });
                });
                logger.info(
                    `📋 Loaded info for ${this.instrumentInfo.size} instruments`
                );
            }
        } catch (error) {
            logger.warn(
                "⚠️ Failed to load instrument info, using defaults:",
                error.message
            );
        }
    }

    async loadInitialCandles() {
        logger.info("📈 Loading initial candle data...");

        for (const instrument of this.config.assets) {
            for (const timeframe of this.config.timeframes) {
                try {
                    await this.fetchCandles(instrument, timeframe);
                    // Small delay to avoid rate limiting
                    await new Promise((r) => setTimeout(r, 100));
                } catch (error) {
                    logger.warn(
                        `⚠️ Failed to load ${instrument} ${timeframe} candles: ${error.message}`
                    );
                }
            }
        }

        logger.info("✅ Initial candle data loaded");
    }

    async fetchCandles(instrument, timeframe) {
        try {
            // Convert our timeframe format to Oanda granularity
            const granularity = this.convertTimeframe(timeframe);

            const response = await oandaClient.getCandles(
                instrument,
                granularity,
                500
            );

            if (response.candles) {
                const candles = response.candles
                    .filter((c) => c.complete) // Only use completed candles
                    .map((c) => ({
                        openTime: parseFloat(c.time) * 1000, // Convert to milliseconds
                        open: parseFloat(c.mid.o),
                        high: parseFloat(c.mid.h),
                        low: parseFloat(c.mid.l),
                        close: parseFloat(c.mid.c),
                        volume: parseInt(c.volume),
                    }));

                this.candleCache[instrument][timeframe] = candles;

                // Update price cache with latest candle close
                if (candles.length > 0) {
                    const lastCandle = candles[candles.length - 1];
                    if (!this.priceCache[instrument]) {
                        this.priceCache[instrument] = {
                            mid: lastCandle.close,
                            timestamp: Date.now(),
                        };
                    }
                }

                this.emit("candlesUpdated", {
                    instrument,
                    timeframe,
                    count: candles.length,
                });
            }
        } catch (error) {
            logger.error(
                `❌ Failed to fetch candles for ${instrument} ${timeframe}:`,
                error.message
            );
            throw error;
        }
    }

    async fetchPrices() {
        if (!this.config.assets || this.config.assets.length === 0) return;

        try {
            const response = await oandaClient.getPricing(this.config.assets);

            if (response.prices) {
                response.prices.forEach((price) => {
                    const instrument = price.instrument;
                    const bid = parseFloat(price.bids?.[0]?.price || 0);
                    const ask = parseFloat(price.asks?.[0]?.price || 0);
                    const mid = (bid + ask) / 2;
                    const spread = ask - bid;
                    const pipValue = this.getPipValue(instrument);
                    const spreadPips = spread / pipValue;

                    this.priceCache[instrument] = {
                        bid,
                        ask,
                        mid,
                        spread,
                        spreadPips,
                        timestamp: Date.now(),
                        tradeable: price.tradeable,
                    };

                    this.emit("priceUpdate", {
                        instrument,
                        price: mid,
                        bid,
                        ask,
                        spread: spreadPips,
                    });
                });
            }
        } catch (error) {
            logger.error("❌ Price fetch error:", error.message);
        }
    }

    startPolling() {
        // Poll candles periodically
        this.pollingInterval = setInterval(async () => {
            if (!this.isReady) return;

            for (const instrument of this.config.assets) {
                for (const timeframe of this.config.timeframes) {
                    try {
                        await this.fetchCandles(instrument, timeframe);
                    } catch (error) {
                        // Log but don't crash on individual fetch errors
                    }
                }
            }
        }, this.candlePollingMs);

        // Poll prices more frequently
        this.pricePollingInterval = setInterval(() => {
            if (this.isReady) {
                this.fetchPrices();
            }
        }, this.pricePollingMs);

        // Initial price fetch
        this.fetchPrices();

        logger.info(
            `🔄 Polling started: Candles every ${
                this.candlePollingMs / 1000
            }s, Prices every ${this.pricePollingMs / 1000}s`
        );
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.pricePollingInterval) {
            clearInterval(this.pricePollingInterval);
            this.pricePollingInterval = null;
        }
        logger.info("⏹️ Polling stopped");
    }

    // ==================== PUBLIC API (matches BinanceDataService interface) ====================

    /**
     * Get cached candles for an instrument/timeframe
     */
    getCandles(instrument, timeframe, limit = 200) {
        const tf = timeframe || this.config.timeframes[0] || "15m";
        return this.candleCache[instrument]?.[tf]?.slice(-limit) || [];
    }

    /**
     * Get current price for an instrument
     */
    getCurrentPrice(instrument) {
        const cached = this.priceCache[instrument];
        if (!cached) return null;

        return {
            price: cached.mid,
            bid: cached.bid,
            ask: cached.ask,
            spread: cached.spreadPips,
            timestamp: cached.timestamp,
        };
    }

    /**
     * Get all cached prices
     */
    getAllPrices() {
        const prices = {};
        for (const [instrument, data] of Object.entries(this.priceCache)) {
            if (data) {
                prices[instrument] = {
                    price: data.mid,
                    bid: data.bid,
                    ask: data.ask,
                    spread: data.spreadPips,
                    timestamp: data.timestamp,
                };
            }
        }
        return prices;
    }

    /**
     * Get account info
     */
    async getAccountInfo() {
        try {
            const accountData = await oandaClient.getAccountDetails();
            const account = accountData.account;

            return {
                balance: parseFloat(account.balance),
                unrealizedPL: parseFloat(account.unrealizedPL),
                realizedPL: parseFloat(account.pl),
                marginUsed: parseFloat(account.marginUsed),
                marginAvailable: parseFloat(account.marginAvailable),
                marginCloseoutPercent: parseFloat(
                    account.marginCloseoutPercent
                ),
                positionValue: parseFloat(account.positionValue),
                currency: account.currency,
                openTradeCount: account.openTradeCount,
                openPositionCount: account.openPositionCount,
                pendingOrderCount: account.pendingOrderCount,
                error: null,
            };
        } catch (error) {
            return { error };
        }
    }

    /**
     * Execute a market order
     * @param {string} instrument - Instrument name (e.g., "AUD_USD")
     * @param {string} side - "BUY" or "SELL"
     * @param {number} units - Number of units (positive value)
     * @param {object} options - Stop loss, take profit options
     */
    async executeOrder(instrument, side, units, options = {}) {
        try {
            // Convert side to Oanda units (positive for buy, negative for sell)
            const orderUnits =
                side === "BUY" ? Math.abs(units) : -Math.abs(units);

            logger.info(`⚡ EXECUTING ORDER: ${side} ${units} ${instrument}`);

            const response = await oandaClient.placeMarketOrder(
                instrument,
                orderUnits,
                options
            );

            if (response.orderFillTransaction) {
                const fill = response.orderFillTransaction;
                return {
                    orderId: fill.id,
                    tradeId: fill.tradeOpened?.tradeID || fill.id,
                    instrument: fill.instrument,
                    units: Math.abs(parseFloat(fill.units)),
                    price: parseFloat(fill.price),
                    pl: parseFloat(fill.pl || 0),
                    financing: parseFloat(fill.financing || 0),
                    commission: parseFloat(fill.commission || 0),
                    timestamp: fill.time,
                    fills: [
                        {
                            price: parseFloat(fill.price),
                            quantity: Math.abs(parseFloat(fill.units)),
                            commission: "0", // Oanda uses spread, not commission
                            commissionAsset: "AUD",
                        },
                    ],
                    executedQty: Math.abs(parseFloat(fill.units)),
                    cummulativeQuoteQty: Math.abs(
                        parseFloat(fill.units) * parseFloat(fill.price)
                    ),
                };
            }

            throw new Error("Order fill transaction not found in response");
        } catch (error) {
            logger.error(`❌ Order execution failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Close a trade
     */
    async closeTrade(tradeId) {
        try {
            const response = await oandaClient.closeTrade(tradeId);
            return response;
        } catch (error) {
            logger.error(
                `❌ Failed to close trade ${tradeId}: ${error.message}`
            );
            throw error;
        }
    }

    /**
     * Get open trades from Oanda
     */
    async getOpenTrades() {
        try {
            const response = await oandaClient.getOpenTrades();
            return response.trades || [];
        } catch (error) {
            logger.error("❌ Failed to get open trades:", error.message);
            return [];
        }
    }

    // ==================== FOREX-SPECIFIC UTILITIES ====================

    /**
     * Get pip value for an instrument
     */
    getPipValue(instrument) {
        const info = this.instrumentInfo.get(instrument);
        if (info) return info.pipValue;

        // Default: JPY pairs use 0.01, others use 0.0001
        return instrument.includes("JPY") ? 0.01 : 0.0001;
    }

    /**
     * Get display precision for an instrument
     */
    getDisplayPrecision(instrument) {
        const info = this.instrumentInfo.get(instrument);
        if (info) return info.displayPrecision;

        // Default: JPY pairs use 3 decimals, others use 5
        return instrument.includes("JPY") ? 3 : 5;
    }

    /**
     * Convert pips to price distance
     */
    pipsToPrice(pips, instrument) {
        return pips * this.getPipValue(instrument);
    }

    /**
     * Convert price distance to pips
     */
    priceToPips(priceDistance, instrument) {
        return priceDistance / this.getPipValue(instrument);
    }

    /**
     * Round units to valid precision for instrument
     */
    roundUnits(units, instrument) {
        const info = this.instrumentInfo.get(instrument);
        const precision = info?.tradeUnitsPrecision || 0;
        return (
            Math.floor(units * Math.pow(10, precision)) /
            Math.pow(10, precision)
        );
    }

    /**
     * Convert timeframe string to Oanda granularity
     */
    convertTimeframe(timeframe) {
        const mapping = {
            "1m": "M1",
            "5m": "M5",
            "15m": "M15",
            "30m": "M30",
            "1h": "H1",
            "4h": "H4",
            "1d": "D",
            "1w": "W",
            "1M": "M",
            // Also accept Oanda format directly
            M1: "M1",
            M5: "M5",
            M15: "M15",
            M30: "M30",
            H1: "H1",
            H4: "H4",
            D: "D",
            W: "W",
        };
        return mapping[timeframe] || "M15";
    }

    /**
     * Get service status
     */
    getServiceStatus() {
        return {
            ready: this.isReady,
            candleCount: Object.values(this.candleCache).reduce((acc, tf) => {
                return (
                    acc + Object.values(tf).reduce((a, c) => a + c.length, 0)
                );
            }, 0),
            prices: Object.keys(this.priceCache).filter(
                (k) => this.priceCache[k]
            ).length,
            instruments: this.instrumentInfo.size,
            oandaStatus: oandaClient.getStatus(),
        };
    }

    /**
     * Shutdown the service
     */
    shutdown() {
        this.stopPolling();
        this.isReady = false;
        this.emit("serviceShutdown");
        logger.info("🛑 Forex Data Service shut down");
    }
}

module.exports = ForexDataService;
