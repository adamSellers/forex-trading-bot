// backend/src/services/binanceDataService.js
const EventEmitter = require("events");
const Binance = require("node-binance-api");
const logger = require("../utils/logger");

class BinanceDataService extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.client = new Binance().options({
            APIKEY: process.env.BINANCE_API_KEY,
            APISECRET: process.env.BINANCE_API_SECRET,
            family: 4, // Use IPv4
            useServerTime: true,
        });

        // In-Memory Database of Candles
        // Structure: { "BTCUSDT": { "1h": [candle1, candle2...] } }
        this.candleCache = {};

        // Real-time Price Cache
        this.priceCache = {};

        // Static Symbol Info (Min notional, step size, etc.)
        this.symbolInfo = new Map();

        this.isReady = false;
        this.streams = [];
    }

    async initialize() {
        try {
            logger.info(
                "📡 Initializing Binance Data Service (WebSocket Mode)..."
            );

            // 1. Load Exchange Info (limits, precision) - ONE TIME CALL
            await this.loadExchangeInfo();

            // 2. Initialize Cache Structure
            this.config.assets.forEach((symbol) => {
                this.candleCache[symbol] = {};
                this.config.timeframes.forEach((tf) => {
                    this.candleCache[symbol][tf] = [];
                });
            });

            // 3. Hydrate Cache & Start Streams
            // We fetch initial history via REST, then immediately hook the socket
            await this.startHybridDataFeeds();

            this.isReady = true;
            this.emit("serviceReady");
            logger.success("✅ Binance Data Service Fully Synced & Listening.");
        } catch (error) {
            logger.error("❌ Data Service Initialization Failed:", error);
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
        const assets = this.config.assets;
        const timeframes = this.config.timeframes;

        // A. Snapshot History (The "Backfill")
        // We do this sequentially to avoid hammering the API (Rate Limit Protection)
        logger.info("📥 Fetching historical snapshots...");
        for (const symbol of assets) {
            for (const interval of timeframes) {
                try {
                    // Fetch last 200 candles to fill the chart
                    const candles = await this.client.candlesticks(
                        symbol,
                        interval,
                        false,
                        { limit: 200 }
                    );
                    this.processSnapshot(symbol, interval, candles);
                    await new Promise((r) => setTimeout(r, 100)); // 100ms throttle
                } catch (e) {
                    logger.error(
                        `Failed snapshot for ${symbol} ${interval}`,
                        e.message
                    );
                }
            }
        }

        // B. Start WebSockets (The "Live Feed")
        logger.info("🔌 Connecting WebSockets...");

        // 1. Candle Streams (for Indicators)
        // Format: btcusdt@kline_1h
        const streams = [];
        assets.forEach((s) => {
            timeframes.forEach((tf) =>
                streams.push(`${s.toLowerCase()}@kline_${tf}`)
            );
        });

        this.client.websockets.candlesticks(
            assets,
            timeframes,
            (candlesticks) => {
                const {
                    e: eventType,
                    E: eventTime,
                    s: symbol,
                    k: ticks,
                } = candlesticks;
                const {
                    t: time,
                    o: open,
                    h: high,
                    l: low,
                    c: close,
                    v: volume,
                    n: trades,
                    i: interval,
                    x: isFinal,
                    q: quoteVolume,
                    V: buyVolume,
                    Q: quoteBuyVolume,
                } = ticks;

                // Standardize format to match our engine's expectations
                const candle = {
                    openTime: time,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                    volume: parseFloat(volume),
                    isFinal: isFinal,
                };

                this.updateCandleCache(symbol, interval, candle);
            }
        );

        // 2. Ticker Streams (for Live Prices)
        this.client.websockets.prevDay(assets, (error, response) => {
            if (response) {
                const symbol = response.symbol;
                const price = parseFloat(response.close);
                this.priceCache[symbol] = {
                    price: price,
                    priceChangePercent: parseFloat(response.percentChange),
                    timestamp: Date.now(),
                };
                // Emit lightweight price update event
                this.emit("priceUpdate", { symbol, price });
            }
        });
    }

    processSnapshot(symbol, interval, rawData) {
        if (!rawData || !Array.isArray(rawData)) return;

        // Map Binance Array [time, open, high, low, close...] to Objects
        const mapped = rawData.map((c) => ({
            openTime: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
        }));

        this.candleCache[symbol][interval] = mapped;
        // Update price cache with latest close
        const last = mapped[mapped.length - 1];
        if (last) {
            this.priceCache[symbol] = {
                price: last.close,
                timestamp: Date.now(),
            };
        }
    }

    updateCandleCache(symbol, interval, newCandle) {
        const cache = this.candleCache[symbol][interval];
        const lastCandle = cache[cache.length - 1];

        if (lastCandle && lastCandle.openTime === newCandle.openTime) {
            // Update current candle in-place
            cache[cache.length - 1] = newCandle;
        } else {
            // It's a new candle, push it
            cache.push(newCandle);
            // Maintain max length (keep memory low)
            if (cache.length > 500) cache.shift();

            // IMPORTANT: If candle closed, trigger specific event for SignalGenerator
            if (cache[cache.length - 2] && cache[cache.length - 2].isFinal) {
                // We could emit 'candleClosed' here if needed
            }
        }
    }

    // --- Public API for TradingEngine ---
    // Now purely synchronous! No awaits, no bans.

    getCandles(symbol, interval, limit = 200) {
        const data = this.candleCache[symbol]?.[interval] || [];
        return data.slice(-limit);
    }

    getCurrentPrice(symbol) {
        return this.priceCache[symbol] || null;
    }

    getAllPrices() {
        return this.priceCache;
    }

    async getAccountInfo() {
        // This is the ONLY method that still needs a real API call
        // But we call it rarely (only on trade execution or dashboard refresh)
        try {
            const res = await this.client.account();
            return {
                balances: Object.entries(res.balances).map(([asset, data]) => ({
                    asset,
                    free: parseFloat(data.available),
                    locked: parseFloat(data.onOrder),
                    total:
                        parseFloat(data.available) + parseFloat(data.onOrder),
                })),
                canTrade: res.canTrade,
                accountType: res.accountType,
            };
        } catch (e) {
            return { error: e };
        }
    }

    getServiceStatus() {
        return {
            ready: this.isReady,
            cachedSymbols: Object.keys(this.candleCache).length,
            prices: Object.keys(this.priceCache).length,
        };
    }
}

module.exports = BinanceDataService;
