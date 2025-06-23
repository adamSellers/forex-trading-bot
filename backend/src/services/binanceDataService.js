// backend/src/services/binanceDataService.js - SAFE LIVE VERSION
const Binance = require("node-binance-api");
const EventEmitter = require("events");
const logger = require("../utils/logger"); // Assuming this path to your logger utility

class BinanceDataService extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            useTestnet: false, // Set to true for Binance Testnet
            useRealData: process.env.USE_REAL_BINANCE_DATA === "true",
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],
            timeframes: config.timeframes || ["1h", "4h", "1d"],
            ...config,
        };

        // Check for API credentials
        if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
            logger.warn(
                "⚠️ No Binance API credentials found. Using fallback mode."
            );
            this.useFallback = true;
        } else {
            logger.info("🔑 Binance API credentials detected");
            this.useFallback = false;
        }

        // Binance API setup with error handling
        try {
            this.binance = new Binance().options({
                APIKEY: process.env.BINANCE_API_KEY || "dummy-key",
                APISECRET: process.env.BINANCE_API_SECRET || "dummy-secret",
                useServerTime: true,
                test: false,
                hedgeMode: false,
                recvWindow: 60000,
                verbose: false,
                family: 4,
                // Custom JSON parser to handle BigNumber conversion explicitly
                // This is crucial to prevent "Cannot convert object to primitive value" errors
                json_parse: (json) => {
                    return JSON.parse(json, (key, value) => {
                        // Check if value is an object and has a .toNumber() method (characteristic of BigNumber.js objects)
                        if (
                            typeof value === "object" &&
                            value !== null &&
                            typeof value.toNumber === "function"
                        ) {
                            // Convert BigNumber to a standard JavaScript number
                            // Use .toString() for full precision if needed, or .toNumber() for convenience
                            return value.toNumber();
                        }
                        return value;
                    });
                },
            });
        } catch (setupError) {
            logger.error("❌ Binance setup error:", setupError.message);
            this.useFallback = true;
        }

        this.priceCache = new Map();
        this.candleCache = new Map();
        this.websockets = new Map();
        this.isConnected = false;
        this.pollingInterval = null;

        logger.info(
            `🌐 ${
                this.useFallback ? "FALLBACK" : "LIVE"
            } MODE: Binance Data Service`
        );
        this.initializeService();
    }

    async initializeService() {
        try {
            logger.info("🚀 Initializing Binance Data Service...");

            const connectionResult = await this.testConnection();

            if (!connectionResult.success && !this.useFallback) {
                logger.warn(
                    "⚠️ Live connection failed, switching to fallback mode"
                );
                this.useFallback = true;
            }

            // Load historical data (live or fallback)
            await this.loadHistoricalData();

            // Initialize price streams
            await this.initializePriceStreams();

            this.isConnected = true;
            this.emit("serviceReady");
            logger.success("✅ Binance Data Service initialized successfully");
        } catch (error) {
            logger.error("❌ Service initialization failed:", error.message);
            logger.error("Full initialization error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                response: error.response || null, // For HTTP errors
                code: error.code || null, // For specific error codes
                originalError: error, // Keep the original error object for inspection
            });

            logger.info("🔄 Attempting fallback initialization...");
            this.useFallback = true;
            await this.initializeFallbackMode();
        }
    }

    async testConnection() {
        if (this.useFallback) {
            logger.info("📡 Using fallback mode (no API test needed)");
            return { success: true, mode: "fallback" };
        }

        try {
            logger.info("📡 Testing LIVE Binance API connection...");

            // Minimal connection test
            const serverTime = await this.binance.time();

            if (serverTime && serverTime > 0) {
                logger.success("✅ LIVE Binance API connection successful");
                logger.info(
                    `📊 Server time: ${new Date(serverTime).toISOString()}`
                );
                return { success: true, serverTime };
            } else {
                throw new Error("Invalid server time response");
            }
        } catch (error) {
            logger.error(`❌ LIVE API test failed: ${error.message || error}`);
            logger.error("Full API test error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                response: error.response || null, // For HTTP errors
                code: error.code || null, // For specific error codes
                originalError: error, // Keep the original error object for inspection
            });

            // Provide helpful error messages
            if (
                error.message.includes("API key") ||
                error.message.includes("signature")
            ) {
                logger.error(
                    "🔑 API Error: Please check your BINANCE_API_KEY and BINANCE_API_SECRET. Ensure they are correct and have 'Enable Reading' permission."
                );
            } else if (error.message.includes("IP")) {
                logger.error(
                    "🌐 IP Error: Please whitelist your IP in Binance API settings."
                );
            } else if (error.message.includes("permission")) {
                logger.error(
                    "🔒 Permission Error: Please enable 'Enable Reading' in API settings."
                );
            } else if (error.message.includes("Network Error")) {
                logger.error(
                    "📡 Network Error: Could not reach Binance API. Check internet connection or Binance status."
                );
            } else if (error.message.includes("Timeout")) {
                logger.error(
                    "⏳ Timeout Error: Binance API request timed out. Network latency or API issues."
                );
            }

            return { success: false, error: error.message };
        }
    }

    async loadHistoricalData() {
        logger.info("📚 Loading historical data...");

        if (this.useFallback) {
            return this.generateFallbackData();
        }

        // LIVE: Real data loading with safety
        const dataRequirements = {
            "1h": 500, // Reduced for safety
            "4h": 250,
            "1d": 200,
        };

        let totalLoaded = 0;

        for (const asset of this.config.assets) {
            for (const timeframe of this.config.timeframes) {
                try {
                    const limit = dataRequirements[timeframe];
                    logger.info(
                        `📊 Loading ${limit} ${timeframe} candles for ${asset}...`
                    );

                    const candles = await this.getHistoricalCandles(
                        asset,
                        timeframe,
                        limit
                    );

                    if (candles && candles.length > 0) {
                        const cacheKey = `${asset}_${timeframe}`;
                        this.candleCache.set(cacheKey, candles);
                        totalLoaded += candles.length;
                        logger.success(
                            `✅ Loaded ${candles.length} ${timeframe} candles for ${asset}`
                        );
                    } else {
                        logger.warn(
                            `⚠️ No candles returned for ${asset} ${timeframe}.`
                        );
                    }

                    // Rate limiting
                    await new Promise((resolve) => setTimeout(resolve, 200));
                } catch (error) {
                    logger.error(
                        `❌ Failed to load ${asset} ${timeframe}:`,
                        error.message
                    );
                    logger.error("Full historical data error details:", {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        response: error.response || null,
                        code: error.code || null,
                        originalError: error,
                    });

                    // Generate fallback data for failed requests
                    logger.info(
                        `🔧 Generating fallback data for ${asset} ${timeframe}...`
                    );
                    const fallbackCandles = this.generateMockCandles(
                        asset,
                        timeframe,
                        100
                    );
                    const cacheKey = `${asset}_${timeframe}`;
                    this.candleCache.set(cacheKey, fallbackCandles);
                    totalLoaded += fallbackCandles.length;
                }
            }

            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        logger.success(
            `✅ Historical data loaded: ${totalLoaded} total candles`
        );
    }

    async getHistoricalCandles(symbol, interval, limit = 500) {
        if (this.useFallback) {
            return this.generateMockCandles(symbol, interval, limit);
        }

        try {
            let retries = 2; // Reduced retries
            let candles;

            while (retries > 0) {
                try {
                    candles = await this.binance.candlesticks(
                        symbol,
                        interval,
                        false,
                        { limit: Math.min(limit, 1000) } // Max limit for Binance API is 1000
                    );
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;

                    logger.warn(
                        `⚠️ Retrying for ${symbol} ${interval} (attempts left: ${retries})...`
                    );
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }

            if (!candles || candles.length === 0) {
                throw new Error(`No data returned for ${symbol}`);
            }

            return candles.map((candle) => ({
                openTime: candle[0],
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5]),
                closeTime: candle[6],
                timestamp: new Date(candle[0]).toISOString(),
            }));
        } catch (error) {
            logger.error(
                `❌ API error for ${symbol} ${interval}:`,
                error.message
            );
            logger.error("Full getHistoricalCandles error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                response: error.response || null,
                code: error.code || null,
                originalError: error,
            });
            throw error;
        }
    }

    generateFallbackData() {
        logger.info("🔧 Generating comprehensive fallback data...");

        const counts = {
            "1h": 500,
            "4h": 250,
            "1d": 200,
        };

        let totalGenerated = 0;

        this.config.assets.forEach((asset) => {
            this.config.timeframes.forEach((timeframe) => {
                const count = counts[timeframe];
                const candles = this.generateMockCandles(
                    asset,
                    timeframe,
                    count
                );
                const cacheKey = `${asset}_${timeframe}`;
                this.candleCache.set(cacheKey, candles);
                totalGenerated += candles.length; // Accumulate totalGenerated
                logger.success(
                    `✅ Generated ${candles.length} ${timeframe} candles for ${asset}`
                );
            });
        });

        logger.success(
            `🎯 Fallback data complete: ${Array.from(
                this.candleCache.values()
            ).reduce((sum, arr) => sum + arr.length, 0)} total candles`
        );
    }

    generateMockCandles(symbol, timeframe, count) {
        const basePrices = {
            BTCUSDT: 67000,
            ETHUSDT: 3400,
            BNBUSDT: 600,
            DOGEUSDT: 0.15,
        };

        const basePrice = basePrices[symbol] || 1000;
        const candles = [];

        const intervals = {
            "1h": 60 * 60 * 1000,
            "4h": 4 * 60 * 60 * 1000,
            "1d": 24 * 60 * 60 * 1000,
        };

        const interval = intervals[timeframe] || intervals["1h"];
        const now = Date.now();

        for (let i = count; i >= 0; i--) {
            const openTime = now - i * interval;
            const closeTime = openTime + interval - 1;

            // Realistic price movement
            const dayProgress = (count - i) / count;
            const trendPrice = basePrice * (0.85 + dayProgress * 0.3);
            const volatility = trendPrice * 0.02;

            const open = trendPrice + (Math.random() - 0.5) * volatility;
            const close = open + (Math.random() - 0.5) * volatility * 0.7;
            const high =
                Math.max(open, close) + Math.random() * volatility * 0.3;
            const low =
                Math.min(open, close) - Math.random() * volatility * 0.3;
            const volume = 50000 + Math.random() * 200000;

            candles.push({
                openTime,
                open: parseFloat(open.toFixed(8)),
                high: parseFloat(high.toFixed(8)),
                low: parseFloat(low.toFixed(8)),
                close: parseFloat(close.toFixed(8)),
                volume: parseFloat(volume.toFixed(2)),
                closeTime,
                timestamp: new Date(openTime).toISOString(),
            });
        }

        return candles.sort((a, b) => a.openTime - b.openTime);
    }

    async initializePriceStreams() {
        logger.info("📊 Initializing price streams...");

        if (this.useFallback) {
            return this.initializeFallbackPricing();
        }

        try {
            // Try live streams with safety
            let successCount = 0;

            for (const asset of this.config.assets) {
                try {
                    this.binance.websockets.ticker(asset, (ticker) => {
                        try {
                            // Ensure explicit conversion for potential BigNumber values
                            const priceData = {
                                symbol: ticker.symbol,
                                price: parseFloat(
                                    ticker.curDayClose || ticker.c
                                ),
                                priceChange: parseFloat(
                                    ticker.priceChangePercent || ticker.P
                                ),
                                volume: parseFloat(ticker.volume || ticker.v),
                                high: parseFloat(ticker.high || ticker.h),
                                low: parseFloat(ticker.low || ticker.l),
                                timestamp: Date.now(),
                            };

                            this.priceCache.set(ticker.symbol, priceData);
                            this.emit("priceUpdate", priceData);
                        } catch (error) {
                            logger.error(
                                `Price stream error for ${asset}:`,
                                error.message
                            );
                            logger.error(
                                "Full price stream processing error details:",
                                {
                                    name: error.name,
                                    message: error.message,
                                    stack: error.stack,
                                    originalError: error,
                                }
                            );
                        }
                    });

                    successCount++;
                    logger.success(`✅ Live stream active for ${asset}`);
                    await new Promise((resolve) => setTimeout(resolve, 100));
                } catch (streamError) {
                    logger.error(
                        `❌ Stream failed for ${asset}:`,
                        streamError.message
                    );
                    logger.error("Full stream setup error details:", {
                        name: streamError.name,
                        message: streamError.message,
                        stack: streamError.stack,
                        originalError: streamError,
                    });
                }
            }

            if (successCount === 0) {
                throw new Error("No live streams available");
            }

            logger.success(
                `🚀 ${successCount}/${this.config.assets.length} live streams active`
            );
        } catch (error) {
            logger.error(
                "❌ Live streams failed to initialize:",
                error.message
            );
            logger.error("Full live stream initialization error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                originalError: error,
            });
            logger.info("🔄 Using fallback pricing...");
            this.initializeFallbackPricing();
        }
    }

    initializeFallbackPricing() {
        logger.info("📊 Starting fallback price simulation...");

        const basePrices = {
            BTCUSDT: 67000,
            ETHUSDT: 3400,
            BNBUSDT: 600,
            DOGEUSDT: 0.15,
        };

        // Initialize prices
        this.config.assets.forEach((asset) => {
            const basePrice = basePrices[asset] || 1000;
            this.priceCache.set(asset, {
                symbol: asset,
                price: basePrice,
                priceChange: 0,
                volume: 1000000,
                high: basePrice * 1.01,
                low: basePrice * 0.99,
                timestamp: Date.now(),
            });
        });

        // Update prices regularly
        this.pollingInterval = setInterval(() => {
            this.config.assets.forEach((asset) => {
                const current = this.priceCache.get(asset);
                if (current) {
                    const variation =
                        current.price * 0.001 * (Math.random() - 0.5);
                    const newPrice = current.price + variation;
                    const changePercent = (variation / current.price) * 100;

                    this.priceCache.set(asset, {
                        symbol: asset,
                        price: newPrice,
                        priceChange: changePercent,
                        volume: 1000000 + Math.random() * 5000000,
                        high: newPrice * 1.002,
                        low: newPrice * 0.998,
                        timestamp: Date.now(),
                    });

                    this.emit("priceUpdate", this.priceCache.get(asset));
                }
            });
        }, 3000);

        logger.success("✅ Fallback pricing initialized");
    }

    async initializeFallbackMode() {
        try {
            logger.info("🔄 Initializing fallback mode...");
            this.generateFallbackData();
            this.initializeFallbackPricing();
            this.isConnected = true;
            this.emit("serviceReady");
            logger.success("✅ Fallback mode ready");
        } catch (error) {
            logger.error("❌ Fallback mode failed:", error);
            this.emit("serviceError", error);
        }
    }

    getCurrentPrice(symbol) {
        return this.priceCache.get(symbol);
    }

    getAllPrices() {
        return Object.fromEntries(this.priceCache);
    }

    getCandles(symbol, timeframe) {
        const cacheKey = `${symbol}_${timeframe}`;
        return this.candleCache.get(cacheKey) || [];
    }

    async getAccountInfo() {
        if (this.useFallback) {
            return {
                balances: [
                    { asset: "USDT", free: 5000, locked: 0, total: 5000 },
                    { asset: "BTC", free: 0, locked: 0, total: 0 },
                    { asset: "ETH", free: 0, locked: 0, total: 0 },
                    { asset: "BNB", free: 0, locked: 0, total: 0 },
                    { asset: "DOGE", free: 0, locked: 0, total: 0 },
                ],
                canTrade: false,
                canWithdraw: false,
                canDeposit: false,
                accountType: "PAPER_TRADING",
                permissions: ["SPOT"],
            };
        }

        try {
            const account = await this.binance.account();
            const relevantBalances = account.balances
                .filter((balance) => {
                    const total =
                        parseFloat(balance.free) + parseFloat(balance.locked);
                    return (
                        total > 0 ||
                        this.config.assets.some((asset) =>
                            asset.startsWith(balance.asset)
                        )
                    );
                })
                .map((balance) => ({
                    asset: balance.asset,
                    free: parseFloat(balance.free),
                    locked: parseFloat(balance.locked),
                    total:
                        parseFloat(balance.free) + parseFloat(balance.locked),
                }));

            return {
                balances: relevantBalances,
                canTrade: account.canTrade,
                canWithdraw: account.canWithdraw,
                canDeposit: account.canDeposit,
                accountType: account.accountType,
                permissions: account.permissions,
            };
        } catch (error) {
            logger.error("❌ Account info failed:", error.message);
            logger.error("Full account info error details:", {
                name: error.name,
                message: error.message,
                stack: error.stack,
                response: error.response || null,
                code: error.code || null,
                originalError: error,
            });
            // Return fallback account info
            return this.getAccountInfo.call({ useFallback: true });
        }
    }

    cleanup() {
        logger.info("🧹 Cleaning up Binance Data Service...");

        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }

        try {
            if (!this.useFallback && this.binance.websockets) {
                this.config.assets.forEach((asset) => {
                    try {
                        this.binance.websockets.terminate(
                            `${asset.toLowerCase()}@ticker` // Ensure correct websocket stream is terminated
                        );
                    } catch (error) {
                        // Silent cleanup
                        logger.debug(
                            `Error terminating websocket for ${asset}: ${error.message}`
                        );
                    }
                });
            }
        } catch (error) {
            logger.debug(`General websocket cleanup error: ${error.message}`);
        }

        this.websockets.clear();
        this.priceCache.clear();
        this.candleCache.clear();
        this.isConnected = false;

        this.emit("serviceClosed"); // Emit event for external listeners
        logger.info("✅ Binance Data Service cleaned up");
    }

    getServiceStatus() {
        const totalCandles = Array.from(this.candleCache.values()).reduce(
            (total, candles) => total + candles.length,
            0
        );

        return {
            isConnected: this.isConnected,
            priceStreams: this.priceCache.size,
            candleDatasets: this.candleCache.size,
            totalCandles: totalCandles,
            lastUpdate: Math.max(
                ...Array.from(this.priceCache.values()).map((p) => p.timestamp),
                0
            ),
            config: {
                useTestnet: this.config.useTestnet,
                useRealData: this.config.useRealData,
                assets: this.config.assets,
                timeframes: this.config.timeframes,
            },
            pollingActive: !!this.pollingInterval,
            mode: this.useFallback ? "FALLBACK" : "LIVE",
        };
    }
}

module.exports = BinanceDataService;
