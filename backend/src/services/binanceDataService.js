// backend/src/services/binanceDataService.js - ENHANCED WITH DYNAMIC ORDER MINIMUMS
const Binance = require("node-binance-api");
const EventEmitter = require("events");
const logger = require("../utils/logger");

class BinanceDataService extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            apiKey: config.apiKey || process.env.BINANCE_API_KEY,
            apiSecret: config.apiSecret || process.env.BINANCE_API_SECRET,
            useTestnet: config.useTestnet !== false, // Default to testnet for safety
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],
            timeframes: config.timeframes || ["1h", "4h", "1d"],
            useFallback: config.useFallback || false,

            // NEW: Enhanced features
            autoFetchExchangeInfo: config.autoFetchExchangeInfo !== false, // Default true
            cacheExchangeInfo: config.cacheExchangeInfo !== false, // Default true
            exchangeInfoRefreshInterval:
                config.exchangeInfoRefreshInterval || 24 * 60 * 60 * 1000, // 24 hours

            ...config,
        };

        // Data storage
        this.priceData = new Map();
        this.candleCache = new Map();
        this.webSocketConnections = new Map();

        // NEW: Exchange info and symbol data
        this.exchangeInfo = null;
        this.symbolInfo = new Map();
        this.lastExchangeInfoUpdate = 0;

        // Connection state
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 5;

        // Initialize Binance client
        this.initializeBinanceClient();

        logger.info(
            `🌐 ENHANCED Binance Data Service initialized - Testnet: ${this.config.useTestnet}, Exchange Info: ${this.config.autoFetchExchangeInfo}`
        );
    }

    initializeBinanceClient() {
        try {
            if (!this.config.apiKey || !this.config.apiSecret) {
                logger.warn(
                    "⚠️ No Binance API credentials - Using fallback mode"
                );
                this.config.useFallback = true;
                return;
            }

            this.binanceClient = Binance({
                APIKEY: this.config.apiKey,
                APISECRET: this.config.apiSecret,
                test: this.config.useTestnet,
                reconnect: true,
                keepAlive: true,
                verbose: false,
            });

            logger.info("✅ Binance client initialized successfully");
        } catch (error) {
            logger.error("❌ Failed to initialize Binance client:", error);
            this.config.useFallback = true;
        }
    }

    /**
     * NEW: Fetch and cache exchange information
     */
    async fetchExchangeInfo() {
        try {
            if (!this.binanceClient) {
                logger.warn("⚠️ No Binance client available for exchange info");
                return this.createFallbackExchangeInfo();
            }

            logger.info("📊 Fetching exchange information from Binance...");

            const exchangeInfo = await new Promise((resolve, reject) => {
                this.binanceClient.exchangeInfo((error, data) => {
                    if (error) reject(error);
                    else resolve(data);
                });
            });

            if (!exchangeInfo || !exchangeInfo.symbols) {
                throw new Error("Invalid exchange info response");
            }

            this.exchangeInfo = exchangeInfo;
            this.lastExchangeInfoUpdate = Date.now();

            // Process symbol information for our assets
            this.processSymbolInfo(exchangeInfo.symbols);

            logger.success(
                `✅ Exchange info loaded - ${exchangeInfo.symbols.length} symbols processed`
            );
            return exchangeInfo;
        } catch (error) {
            logger.error("❌ Failed to fetch exchange info:", error);

            // Fallback to default values
            const fallbackInfo = this.createFallbackExchangeInfo();
            this.exchangeInfo = fallbackInfo;
            this.processSymbolInfo(fallbackInfo.symbols);

            return fallbackInfo;
        }
    }

    /**
     * NEW: Process symbol information and extract trading constraints
     */
    processSymbolInfo(symbols) {
        logger.info("🔍 Processing symbol information...");

        this.config.assets.forEach((asset) => {
            const symbolData = symbols.find((s) => s.symbol === asset);

            if (symbolData) {
                const info = this.extractSymbolConstraints(symbolData);
                this.symbolInfo.set(asset, info);

                logger.debug(
                    `📋 ${asset}: Min notional $${info.minNotional}, Min qty ${info.minQty}, Step size ${info.stepSize}`
                );
            } else {
                // Fallback data for missing symbols
                const fallbackInfo = this.createFallbackSymbolInfo(asset);
                this.symbolInfo.set(asset, fallbackInfo);

                logger.warn(`⚠️ ${asset}: Using fallback constraints`);
            }
        });

        logger.success(
            `✅ Symbol constraints processed for ${this.symbolInfo.size} assets`
        );
    }

    /**
     * NEW: Extract trading constraints from symbol data
     */
    extractSymbolConstraints(symbolData) {
        const constraints = {
            symbol: symbolData.symbol,
            status: symbolData.status,
            minQty: 0,
            maxQty: 0,
            stepSize: 0,
            minNotional: 0,
            minPrice: 0,
            maxPrice: 0,
            tickSize: 0,
        };

        // Extract from filters
        symbolData.filters.forEach((filter) => {
            switch (filter.filterType) {
                case "LOT_SIZE":
                    constraints.minQty = parseFloat(filter.minQty);
                    constraints.maxQty = parseFloat(filter.maxQty);
                    constraints.stepSize = parseFloat(filter.stepSize);
                    break;

                case "MIN_NOTIONAL":
                    constraints.minNotional = parseFloat(
                        filter.minNotional || filter.notional || 0
                    );
                    break;

                case "NOTIONAL":
                    if (!constraints.minNotional) {
                        constraints.minNotional = parseFloat(
                            filter.minNotional || 0
                        );
                    }
                    break;

                case "PRICE_FILTER":
                    constraints.minPrice = parseFloat(filter.minPrice);
                    constraints.maxPrice = parseFloat(filter.maxPrice);
                    constraints.tickSize = parseFloat(filter.tickSize);
                    break;
            }
        });

        return constraints;
    }

    /**
     * NEW: Create fallback exchange info when API is unavailable
     */
    createFallbackExchangeInfo() {
        const symbols = this.config.assets.map((asset) => ({
            symbol: asset,
            status: "TRADING",
            filters: [
                {
                    filterType: "LOT_SIZE",
                    minQty: "0.00001000",
                    maxQty: "9000.00000000",
                    stepSize: "0.00001000",
                },
                {
                    filterType: "MIN_NOTIONAL",
                    minNotional: "10.00000000",
                },
                {
                    filterType: "PRICE_FILTER",
                    minPrice: "0.01000000",
                    maxPrice: "1000000.00000000",
                    tickSize: "0.01000000",
                },
            ],
        }));

        return {
            timezone: "UTC",
            serverTime: Date.now(),
            symbols: symbols,
            rateLimits: [],
            exchangeFilters: [],
        };
    }

    /**
     * NEW: Create fallback symbol info
     */
    createFallbackSymbolInfo(asset) {
        const baseDefaults = {
            minQty: 0.00001,
            maxQty: 9000,
            stepSize: 0.00001,
            minNotional: 10, // $10 minimum
            minPrice: 0.01,
            maxPrice: 1000000,
            tickSize: 0.01,
        };

        // Asset-specific adjustments
        const assetSpecific = {
            BTCUSDT: { minNotional: 10, stepSize: 0.00001 },
            ETHUSDT: { minNotional: 10, stepSize: 0.0001 },
            BNBUSDT: { minNotional: 10, stepSize: 0.001 },
            DOGEUSDT: { minNotional: 5, stepSize: 1 }, // DOGE has different precision
        };

        return {
            symbol: asset,
            status: "TRADING",
            ...baseDefaults,
            ...(assetSpecific[asset] || {}),
        };
    }

    /**
     * NEW: Get minimum order size for a specific symbol
     */
    getMinOrderSize(symbol) {
        const symbolData = this.symbolInfo.get(symbol);

        if (!symbolData) {
            logger.warn(
                `⚠️ No symbol data for ${symbol}, using default minimum`
            );
            return 10; // Default fallback
        }

        // Return the larger of minNotional or our global minimum
        const exchangeMinimum = symbolData.minNotional || 10;
        const globalMinimum = this.config.minOrderSize || 10;

        return Math.max(exchangeMinimum, globalMinimum);
    }

    /**
     * NEW: Get all symbol constraints for a symbol
     */
    getSymbolConstraints(symbol) {
        const symbolData = this.symbolInfo.get(symbol);

        if (!symbolData) {
            logger.warn(`⚠️ No constraints data for ${symbol}`);
            return this.createFallbackSymbolInfo(symbol);
        }

        return { ...symbolData };
    }

    /**
     * NEW: Validate order parameters against exchange constraints
     */
    validateOrderParameters(symbol, quantity, price) {
        const constraints = this.getSymbolConstraints(symbol);
        const notionalValue = quantity * price;

        const validation = {
            valid: true,
            errors: [],
            adjustedQuantity: quantity,
            adjustedPrice: price,
        };

        // Check minimum notional
        if (notionalValue < constraints.minNotional) {
            validation.valid = false;
            validation.errors.push(
                `Order value ${notionalValue.toFixed(2)} USDT below minimum ${
                    constraints.minNotional
                } USDT`
            );
        }

        // Check quantity constraints
        if (quantity < constraints.minQty) {
            validation.valid = false;
            validation.errors.push(
                `Quantity ${quantity} below minimum ${constraints.minQty}`
            );
        }

        if (quantity > constraints.maxQty) {
            validation.valid = false;
            validation.errors.push(
                `Quantity ${quantity} above maximum ${constraints.maxQty}`
            );
        }

        // Check quantity precision (step size)
        if (constraints.stepSize > 0) {
            const steps = Math.round(quantity / constraints.stepSize);
            const adjustedQty = steps * constraints.stepSize;

            if (Math.abs(quantity - adjustedQty) > constraints.stepSize * 0.1) {
                validation.adjustedQuantity = adjustedQty;
                validation.errors.push(
                    `Quantity adjusted for step size: ${quantity} → ${adjustedQty}`
                );
            }
        }

        // Check price constraints
        if (price < constraints.minPrice) {
            validation.valid = false;
            validation.errors.push(
                `Price ${price} below minimum ${constraints.minPrice}`
            );
        }

        if (price > constraints.maxPrice) {
            validation.valid = false;
            validation.errors.push(
                `Price ${price} above maximum ${constraints.maxPrice}`
            );
        }

        return validation;
    }

    /**
     * Enhanced initialization with exchange info
     */
    async initialize() {
        try {
            logger.info("🚀 Initializing ENHANCED Binance Data Service...");

            // Test connection first
            await this.testConnection();

            // Fetch exchange information
            if (this.config.autoFetchExchangeInfo) {
                await this.fetchExchangeInfo();
            }

            // Load historical data
            await this.loadHistoricalData();

            // Start real-time data streams
            await this.startRealTimeData();

            this.isConnected = true;
            logger.success(
                "✅ ENHANCED Binance Data Service initialized successfully"
            );
            this.emit("serviceReady");
        } catch (error) {
            logger.error("❌ Failed to initialize enhanced service:", error);
            this.emit("serviceError", error);
            throw error;
        }
    }

    async testConnection() {
        if (this.config.useFallback) {
            logger.info("📱 Using fallback mode - skipping connection test");
            return;
        }

        try {
            logger.info("🔌 Testing Binance connection...");

            const serverTime = await new Promise((resolve, reject) => {
                this.binanceClient.time((error, data) => {
                    if (error) reject(error);
                    else resolve(data);
                });
            });

            logger.success(
                `✅ Binance connection successful - Server time: ${new Date(
                    serverTime.serverTime
                )}`
            );
            return serverTime;
        } catch (error) {
            logger.error("❌ Binance connection failed:", error);
            logger.info("⚠️ Switching to fallback mode...");
            this.config.useFallback = true;
        }
    }

    async loadHistoricalData() {
        logger.info("📚 Loading historical candle data...");

        const dataRequirements = {
            "1h": 100,
            "4h": 75,
            "1d": 60,
        };

        for (const asset of this.config.assets) {
            for (const timeframe of this.config.timeframes) {
                try {
                    const limit = dataRequirements[timeframe] || 100;
                    logger.debug(
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
                        logger.debug(
                            `✅ Loaded ${candles.length} candles for ${asset} ${timeframe}`
                        );
                    } else {
                        logger.warn(
                            `⚠️ No candle data received for ${asset} ${timeframe}`
                        );
                    }

                    await new Promise((resolve) => setTimeout(resolve, 200));
                } catch (error) {
                    logger.error(
                        `❌ Failed to load ${asset} ${timeframe}:`,
                        error
                    );
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }

    async getHistoricalCandles(symbol, interval, limit = 100) {
        try {
            if (this.config.useFallback) {
                return this.generateFallbackCandles(symbol, interval, limit);
            }

            let candles;
            let retries = 3;

            while (retries > 0) {
                try {
                    candles = await new Promise((resolve, reject) => {
                        this.binanceClient.candlesticks(
                            symbol,
                            interval,
                            (error, ticks) => {
                                if (error) reject(error);
                                else resolve(ticks);
                            },
                            { limit }
                        );
                    });
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }

            return this.formatCandles(candles);
        } catch (error) {
            logger.error(`Failed to fetch candles for ${symbol}:`, error);
            return this.generateFallbackCandles(symbol, interval, limit);
        }
    }

    async startRealTimeData() {
        logger.info("📡 Starting real-time data streams...");

        for (const asset of this.config.assets) {
            try {
                await this.startPriceStream(asset);
                await new Promise((resolve) => setTimeout(resolve, 100));
            } catch (error) {
                logger.error(
                    `Failed to start price stream for ${asset}:`,
                    error
                );
            }
        }
    }

    async startPriceStream(symbol) {
        if (this.config.useFallback) {
            this.startFallbackPriceData(symbol);
            return;
        }

        try {
            const stream = this.binanceClient.websockets.prevDay(
                symbol,
                (ticker) => {
                    // Add null check
                    if (!ticker || !ticker.s) {
                        logger.debug(`Received null ticker data for ${symbol}`);
                        return;
                    }

                    const priceData = {
                        symbol: ticker.s,
                        price: parseFloat(ticker.c),
                        priceChange: parseFloat(ticker.p),
                        priceChangePercent: parseFloat(ticker.P),
                        volume: parseFloat(ticker.v),
                        timestamp: Date.now(),
                    };

                    this.priceData.set(symbol, priceData);
                    this.emit("priceUpdate", priceData);
                }
            );

            this.webSocketConnections.set(symbol, stream);
            logger.debug(`📈 Price stream started for ${symbol}`);
        } catch (error) {
            logger.error(`Failed to start WebSocket for ${symbol}:`, error);
            this.startFallbackPriceData(symbol);
        }
    }

    startFallbackPriceData(symbol) {
        const basePrice = this.getFallbackBasePrice(symbol);

        const updatePrice = () => {
            const change = (Math.random() - 0.5) * 0.02; // ±1% random change
            const currentPrice = this.priceData.get(symbol)?.price || basePrice;
            const newPrice = currentPrice * (1 + change);

            const priceData = {
                symbol,
                price: newPrice,
                priceChange: newPrice - currentPrice,
                priceChangePercent: change * 100,
                volume: Math.random() * 1000000,
                timestamp: Date.now(),
                fallback: true,
            };

            this.priceData.set(symbol, priceData);
            this.emit("priceUpdate", priceData);
        };

        // Update every 5 seconds
        setInterval(updatePrice, 5000);
        updatePrice(); // Initial update

        logger.debug(`📈 Fallback price stream started for ${symbol}`);
    }

    getFallbackBasePrice(symbol) {
        const basePrices = {
            BTCUSDT: 45000,
            ETHUSDT: 2500,
            BNBUSDT: 350,
            DOGEUSDT: 0.08,
        };
        return basePrices[symbol] || 100;
    }

    formatCandles(rawCandles) {
        return rawCandles.map((candle) => ({
            openTime: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            closeTime: candle[6],
        }));
    }

    generateFallbackCandles(symbol, interval, limit) {
        const basePrice = this.getFallbackBasePrice(symbol);
        const candles = [];
        const now = Date.now();
        const intervals = { "1h": 3600000, "4h": 14400000, "1d": 86400000 };
        const intervalMs = intervals[interval] || 3600000;

        for (let i = limit - 1; i >= 0; i--) {
            const timestamp = now - i * intervalMs;
            const price = basePrice * (1 + (Math.random() - 0.5) * 0.1);

            candles.push({
                openTime: timestamp,
                open: price,
                high: price * 1.02,
                low: price * 0.98,
                close: price * (1 + (Math.random() - 0.5) * 0.02),
                volume: Math.random() * 1000,
                closeTime: timestamp + intervalMs - 1,
            });
        }

        return candles;
    }

    /**
     * NEW: Refresh exchange info if needed
     */
    async refreshExchangeInfoIfNeeded() {
        const now = Date.now();
        const timeSinceUpdate = now - this.lastExchangeInfoUpdate;

        if (timeSinceUpdate > this.config.exchangeInfoRefreshInterval) {
            logger.info("🔄 Refreshing exchange information...");
            await this.fetchExchangeInfo();
        }
    }

    // Public API methods
    getCurrentPrice(symbol) {
        return this.priceData.get(symbol) || null;
    }

    getAllPrices() {
        const prices = {};
        this.priceData.forEach((data, symbol) => {
            prices[symbol] = data;
        });
        return prices;
    }

    getCandles(symbol, timeframe) {
        const cacheKey = `${symbol}_${timeframe}`;
        return this.candleCache.get(cacheKey) || [];
    }

    /**
     * NEW: Get enhanced service status with exchange info
     */
    getServiceStatus() {
        return {
            connected: this.isConnected,
            useFallback: this.config.useFallback,
            exchangeInfoLoaded: this.exchangeInfo !== null,
            symbolsConfigured: this.symbolInfo.size,
            lastExchangeInfoUpdate: this.lastExchangeInfoUpdate,
            activeStreams: this.webSocketConnections.size,
            cachedCandles: this.candleCache.size,
            currentPrices: this.priceData.size,
            assets: this.config.assets,
            timeframes: this.config.timeframes,

            // NEW: Symbol constraint summary
            symbolConstraints: Array.from(this.symbolInfo.entries()).map(
                ([symbol, info]) => ({
                    symbol,
                    minNotional: info.minNotional,
                    minQty: info.minQty,
                    status: info.status,
                })
            ),
        };
    }

    async stop() {
        logger.info("🛑 Stopping Enhanced Binance Data Service...");

        // Close WebSocket connections
        for (const [symbol, stream] of this.webSocketConnections) {
            try {
                if (
                    this.binanceClient &&
                    typeof this.binanceClient.websockets.terminate ===
                        "function"
                ) {
                    this.binanceClient.websockets.terminate(stream);
                }
                logger.debug(`📡 Closed WebSocket for ${symbol}`);
            } catch (error) {
                logger.error(`Error closing WebSocket for ${symbol}:`, error);
            }
        }

        this.webSocketConnections.clear();
        this.isConnected = false;

        logger.info("✅ Enhanced Binance Data Service stopped");
        this.emit("serviceStopped");
    }
}

module.exports = BinanceDataService;
