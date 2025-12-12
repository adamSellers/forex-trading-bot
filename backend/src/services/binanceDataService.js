// backend/src/services/binanceDataService.js - FIXED COUNTS & LIMITS
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
            `🔍 BOT BOOT: Using API Key starting with [ ${visibleKey} ] (Length: ${key.length})`
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
            logger.info(
                "📡 Initializing Binance Data Service (Fixed WebSocket Mode)..."
            );

            await this.loadExchangeInfo();

            // Initialize Cache Structure
            this.config.assets.forEach((symbol) => {
                this.candleCache[symbol] = {};
                this.config.timeframes.forEach((tf) => {
                    this.candleCache[symbol][tf] = [];
                });
            });

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
        logger.info("📥 Fetching historical snapshots...");
        for (const symbol of assets) {
            for (const interval of timeframes) {
                try {
                    // Fetch 1000 candles per asset/timeframe
                    const candles = await this.client.candlesticks(
                        symbol,
                        interval,
                        false,
                        { limit: 1000 }
                    );
                    this.processSnapshot(symbol, interval, candles);
                    await new Promise((r) => setTimeout(r, 50)); // Tiny throttle
                } catch (e) {
                    logger.error(
                        `Failed snapshot for ${symbol} ${interval}: ${e.message}`
                    );
                }
            }
        }

        // B. Start WebSockets (The "Live Feed")
        logger.info("🔌 Connecting WebSockets...");

        // 1. Candle Streams
        for (const tf of timeframes) {
            this.client.websockets.candlesticks(assets, tf, (candlesticks) => {
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
                    x: isFinal,
                } = ticks;

                const candle = {
                    openTime: time,
                    open: parseFloat(open),
                    high: parseFloat(high),
                    low: parseFloat(low),
                    close: parseFloat(close),
                    volume: parseFloat(volume),
                    isFinal: isFinal,
                };

                this.updateCandleCache(symbol, tf, candle);
            });
            logger.debug(
                `   ↳ Listening to ${tf} candles for ${assets.length} assets`
            );
        }

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
                this.emit("priceUpdate", { symbol, price });
            }
        });
        logger.debug(
            `   ↳ Listening to live tickers for ${assets.length} assets`
        );
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
        if (last) {
            this.priceCache[symbol] = {
                price: last.close,
                timestamp: Date.now(),
            };
        }
    }

    updateCandleCache(symbol, interval, newCandle) {
        if (!this.candleCache[symbol] || !this.candleCache[symbol][interval])
            return;

        const cache = this.candleCache[symbol][interval];
        const lastCandle = cache[cache.length - 1];

        if (lastCandle && lastCandle.openTime === newCandle.openTime) {
            cache[cache.length - 1] = newCandle;
        } else {
            cache.push(newCandle);
            // FIXED: Increased hard limit from 500 to 1500 to maintain "Optimal" history depth
            if (cache.length > 1500) cache.shift();
        }
    }

    // --- Public API ---

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
        try {
            const res = await this.client.account();
            let balances = [];

            if (Array.isArray(res.balances)) {
                balances = res.balances.map((b) => ({
                    asset: b.asset,
                    free: parseFloat(b.free),
                    locked: parseFloat(b.locked),
                    total: parseFloat(b.free) + parseFloat(b.locked),
                }));
            } else {
                balances = Object.entries(res.balances).map(
                    ([asset, data]) => ({
                        asset: data.asset || asset,
                        free: parseFloat(data.available || data.free),
                        locked: parseFloat(data.onOrder || data.locked),
                        total:
                            parseFloat(data.available || data.free) +
                            parseFloat(data.onOrder || data.locked),
                    })
                );
            }

            return {
                balances,
                canTrade: res.canTrade,
                accountType: res.accountType,
            };
        } catch (e) {
            logger.error("❌ FAILED TO FETCH BALANCE:", e.message || e);
            return { error: e };
        }
    }

    getServiceStatus() {
        // FIXED: Count ALL candles across ALL assets and timeframes
        let totalCandles = 0;
        const assets = this.config.assets || [];
        const timeframes = this.config.timeframes || [];

        for (const symbol of assets) {
            for (const tf of timeframes) {
                if (this.candleCache[symbol] && this.candleCache[symbol][tf]) {
                    totalCandles += this.candleCache[symbol][tf].length;
                }
            }
        }

        // Only log occasional status updates
        if (Math.random() < 0.05) {
            logger.info(
                `📊 SYSTEM STATUS: Total Candles=${totalCandles} (Assets: ${assets.length})`
            );
        }

        return {
            ready: this.isReady,
            cachedSymbols: Object.keys(this.candleCache).length,
            prices: Object.keys(this.priceCache).length,
            candleCount: totalCandles, // Now returns the TRUE total (approx 15,000)
        };
    }
}

module.exports = BinanceDataService;
