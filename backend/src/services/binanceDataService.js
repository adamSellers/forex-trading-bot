// backend/src/services/binanceDataService.js - ADDED EXECUTION & PRECISION
const EventEmitter = require("events");
const Binance = require("node-binance-api");
const logger = require("../utils/logger");

class BinanceDataService extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;

        // DEBUG: Reveal what key the bot is ACTUALLY seeing
        const key = process.env.BINANCE_API_KEY || "";
        const visibleKey =
            key.length > 4 ? `${key.substring(0, 4)}...` : "INVALID/EMPTY";
        logger.warn(
            `🔍 BOT BOOT: Using API Key starting with [ ${visibleKey} ]`
        );

        this.client = new Binance().options({
            APIKEY: key,
            APISECRET: process.env.BINANCE_API_SECRET,
            family: 4,
            useServerTime: true,
            log: (...args) => logger.debug(args),
        });

        this.candleCache = {};
        this.priceCache = {};
        this.symbolInfo = new Map();
        this.isReady = false;
    }

    async initialize() {
        try {
            logger.info("📡 Initializing Binance Data Service...");
            await this.loadExchangeInfo();

            this.config.assets.forEach((symbol) => {
                this.candleCache[symbol] = {};
                this.config.timeframes.forEach((tf) => {
                    this.candleCache[symbol][tf] = [];
                });
            });

            await this.startHybridDataFeeds();
            this.isReady = true;
            this.emit("serviceReady");
            logger.success("✅ Binance Data Service Ready.");
        } catch (error) {
            // --- DEBUG FIX START ---
            let msg = error.message || "Unknown Error";
            // Check if it's a Binance API response error (often in 'body')
            if (error.body) {
                try {
                    const parsed = JSON.parse(error.body);
                    msg = `API Error ${parsed.code}: ${parsed.msg}`;
                } catch (e) {
                    msg = `Raw API Body: ${error.body}`;
                }
            }
            logger.error(`❌ Data Service Initialization Failed: ${msg}`);
            // --- DEBUG FIX END ---

            this.emit("serviceError", error);
        }
    }

    async loadExchangeInfo() {
        try {
            const data = await this.client.exchangeInfo();
            data.symbols.forEach((s) => {
                const filters = {};
                s.filters.forEach((f) => (filters[f.filterType] = f));
                this.symbolInfo.set(s.symbol, {
                    stepSize: parseFloat(filters.LOT_SIZE?.stepSize || 0),
                    minNotional: parseFloat(
                        filters.NOTIONAL?.minNotional || 10
                    ),
                });
            });
            logger.info("ℹ️  Exchange Info Loaded.");
        } catch (e) {
            logger.warn("⚠️ Failed to load exchange info, using defaults.");
        }
    }

    async startHybridDataFeeds() {
        // ... (Keep existing feed logic same as your upload) ...
        // For brevity, assuming the standard snapshot/websocket logic you uploaded exists here
        // If you are copy-pasting, ensure the websocket code from your previous file is included
        // or just add the TWO NEW METHODS below to your existing file.

        // (RE-INSERTING YOUR SNAPSHOT/WEBSOCKET LOGIC HERE FOR COMPLETENESS)
        const assets = this.config.assets;
        const timeframes = this.config.timeframes;

        // A. Snapshot
        for (const symbol of assets) {
            for (const interval of timeframes) {
                try {
                    const candles = await this.client.candlesticks(
                        symbol,
                        interval,
                        false,
                        { limit: 1000 }
                    );
                    this.processSnapshot(symbol, interval, candles);
                    await new Promise((r) => setTimeout(r, 50));
                } catch (e) {}
            }
        }

        // B. WebSockets
        for (const tf of timeframes) {
            this.client.websockets.candlesticks(assets, tf, (candlesticks) => {
                const { s: symbol, k: ticks } = candlesticks;
                const candle = {
                    openTime: ticks.t,
                    open: parseFloat(ticks.o),
                    high: parseFloat(ticks.h),
                    low: parseFloat(ticks.l),
                    close: parseFloat(ticks.c),
                    volume: parseFloat(ticks.v),
                    isFinal: ticks.x,
                };
                this.updateCandleCache(symbol, tf, candle);
            });
        }

        this.client.websockets.prevDay(assets, (error, response) => {
            if (response) {
                const symbol = response.symbol;
                const price = parseFloat(response.close);
                this.priceCache[symbol] = { price, timestamp: Date.now() };
                this.emit("priceUpdate", { symbol, price });
            }
        });
    }

    processSnapshot(symbol, interval, rawData) {
        if (!rawData || !Array.isArray(rawData)) return;
        const mapped = rawData.map((c) => ({
            openTime: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
        }));
        this.candleCache[symbol][interval] = mapped;
        const last = mapped[mapped.length - 1];
        if (last)
            this.priceCache[symbol] = {
                price: last.close,
                timestamp: Date.now(),
            };
    }

    updateCandleCache(symbol, interval, newCandle) {
        if (!this.candleCache[symbol] || !this.candleCache[symbol][interval])
            return;
        const cache = this.candleCache[symbol][interval];
        const last = cache[cache.length - 1];
        if (last && last.openTime === newCandle.openTime)
            cache[cache.length - 1] = newCandle;
        else {
            cache.push(newCandle);
            if (cache.length > 1500) cache.shift();
        }
    }

    // --- NEW METHODS REQUIRED BY ENGINE ---

    // 1. Precision Helper
    stepSize(symbol, quantity) {
        const info = this.symbolInfo.get(symbol);
        if (!info || !info.stepSize) return quantity.toFixed(6); // Default fallback

        // Math to calculate precision from stepSize (e.g. 0.001 -> 3 decimals)
        const step = info.stepSize;
        const precision = Math.max(0, Math.log10(1 / step));

        // Floor to nearest step
        return (Math.floor(quantity / step) * step).toFixed(precision);
    }

    async executeOrder(symbol, side, quantity) {
        return new Promise((resolve, reject) => {
            // FIX: Apply stepSize precision to avoid "too much precision" error
            const formattedQty = parseFloat(this.stepSize(symbol, quantity));
            logger.info(
                `⚡ API EXECUTION: ${side} ${formattedQty} ${symbol} (raw: ${quantity})`
            );

            // Simple Market Order for Reliability
            const callback = (error, response) => {
                if (error) {
                    const msg = error.body
                        ? JSON.parse(error.body).msg
                        : error.message;
                    logger.error(`❌ Binance API Error: ${msg}`);
                    reject(new Error(msg));
                } else {
                    resolve(response);
                }
            };

            if (side === "BUY") {
                this.client.marketBuy(symbol, formattedQty, callback);
            } else {
                this.client.marketSell(symbol, formattedQty, callback);
            }
        });
    }

    // --- EXISTING PUBLIC API ---
    getCandles(symbol, interval, limit = 200) {
        return this.candleCache[symbol]?.[interval]?.slice(-limit) || [];
    }
    getCurrentPrice(symbol) {
        return this.priceCache[symbol] || null;
    }
    getAllPrices() {
        return this.priceCache;
    }
    async getAccountInfo() {
        try {
            const res = await this.client.account();
            // Normalize balances
            const balances = Array.isArray(res.balances)
                ? res.balances
                : Object.entries(res.balances).map(([k, v]) => ({
                      asset: k,
                      ...v,
                  }));

            return {
                balances: balances.map((b) => ({
                    asset: b.asset,
                    free: parseFloat(b.free || b.available),
                    locked: parseFloat(b.locked || b.onOrder),
                    total:
                        parseFloat(b.free || b.available) +
                        parseFloat(b.locked || b.onOrder),
                })),
                error: null,
            };
        } catch (e) {
            return { error: e };
        }
    }
    getServiceStatus() {
        return {
            ready: this.isReady,
            candleCount: 1500,
            prices: Object.keys(this.priceCache || {}).length,
        };
    }
}

module.exports = BinanceDataService;
