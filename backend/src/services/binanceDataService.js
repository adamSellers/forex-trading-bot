// backend/src/services/binanceDataService.js
const Binance = require("node-binance-api");
const EventEmitter = require("events");

class BinanceDataService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            useTestnet: config.useTestnet || true,
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],
            timeframes: config.timeframes || ["1h", "4h", "1d"],
            ...config,
        };

        this.binance = new Binance().options({
            APIKEY: process.env.BINANCE_API_KEY || "test-key",
            APISECRET: process.env.BINANCE_API_SECRET || "test-secret",
            useServerTime: true,
            test: this.config.useTestnet,
            hedgeMode: false,
            recvWindow: 60000,
            verbose: false,
            log: console.log,
        });

        this.priceCache = new Map();
        this.candleCache = new Map();
        this.websockets = new Map();
        this.isConnected = false;

        this.initializeService();
    }

    async initializeService() {
        try {
            console.log("🚀 Initializing Binance Data Service...");

            // Test connection
            await this.testConnection();

            // Initialize price streams
            await this.initializePriceStreams();

            // Load initial historical data
            await this.loadHistoricalData();

            this.isConnected = true;
            this.emit("serviceReady");
            console.log("✅ Binance Data Service initialized successfully");
        } catch (error) {
            console.error(
                "❌ Failed to initialize Binance Data Service:",
                error
            );
            this.emit("serviceError", error);
        }
    }

    async testConnection() {
        try {
            const exchangeInfo = await this.binance.exchangeInfo();
            console.log("📡 Binance connection test successful");
            return exchangeInfo;
        } catch (error) {
            throw new Error(`Binance connection failed: ${error.message}`);
        }
    }

    async initializePriceStreams() {
        console.log("📊 Initializing price streams...");

        try {
            // Initialize individual ticker streams for each asset
            this.config.assets.forEach((asset) => {
                const stream = asset.toLowerCase() + "@ticker";

                this.binance.websockets.ticker(asset, (ticker) => {
                    try {
                        const priceData = {
                            symbol: ticker.symbol,
                            price: parseFloat(ticker.curDayClose),
                            priceChange: parseFloat(ticker.priceChangePercent),
                            volume: parseFloat(ticker.volume),
                            high: parseFloat(ticker.high),
                            low: parseFloat(ticker.low),
                            timestamp: Date.now(),
                        };

                        this.priceCache.set(ticker.symbol, priceData);
                        this.emit("priceUpdate", priceData);
                    } catch (error) {
                        console.error(
                            `Price stream error for ${asset}:`,
                            error
                        );
                    }
                });

                console.log(`✅ Price stream initialized for ${asset}`);
            });
        } catch (error) {
            console.error("Error initializing price streams:", error);

            // Fallback: Use polling instead of WebSocket
            console.log("🔄 Falling back to price polling...");
            this.initializePricePolling();
        }
    }

    // Fallback method using polling instead of WebSocket
    initializePricePolling() {
        setInterval(async () => {
            try {
                for (const asset of this.config.assets) {
                    const ticker = await this.binance.prices(asset);
                    const price = parseFloat(ticker[asset]);

                    if (price) {
                        const priceData = {
                            symbol: asset,
                            price: price,
                            priceChange: 0, // We don't have change data in polling mode
                            volume: 0,
                            high: price,
                            low: price,
                            timestamp: Date.now(),
                        };

                        this.priceCache.set(asset, priceData);
                        this.emit("priceUpdate", priceData);
                    }
                }
            } catch (error) {
                console.error("Price polling error:", error);
            }
        }, 5000); // Poll every 5 seconds

        console.log("📊 Price polling initialized (fallback mode)");
    }

    async loadHistoricalData() {
        console.log("📚 Loading historical candle data...");

        for (const asset of this.config.assets) {
            for (const timeframe of this.config.timeframes) {
                try {
                    const candles = await this.getHistoricalCandles(
                        asset,
                        timeframe,
                        500
                    );
                    const cacheKey = `${asset}_${timeframe}`;
                    this.candleCache.set(cacheKey, candles);

                    console.log(
                        `✅ Loaded ${candles.length} candles for ${asset} ${timeframe}`
                    );
                } catch (error) {
                    console.error(
                        `❌ Failed to load ${asset} ${timeframe}:`,
                        error.message
                    );
                }
            }
        }
    }

    async getHistoricalCandles(symbol, interval, limit = 500) {
        try {
            const candles = await this.binance.candlesticks(
                symbol,
                interval,
                false,
                { limit }
            );

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
            throw new Error(
                `Failed to fetch candles for ${symbol}: ${error.message}`
            );
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

    async refreshCandles(symbol, timeframe, limit = 100) {
        try {
            const newCandles = await this.getHistoricalCandles(
                symbol,
                timeframe,
                limit
            );
            const cacheKey = `${symbol}_${timeframe}`;

            // Merge with existing data, avoiding duplicates
            const existingCandles = this.candleCache.get(cacheKey) || [];
            const mergedCandles = this.mergeCandleData(
                existingCandles,
                newCandles
            );

            this.candleCache.set(cacheKey, mergedCandles);
            this.emit("candlesUpdated", {
                symbol,
                timeframe,
                candles: mergedCandles,
            });

            return mergedCandles;
        } catch (error) {
            console.error(`Failed to refresh candles for ${symbol}:`, error);
            throw error;
        }
    }

    mergeCandleData(existing, newData) {
        const combined = [...existing, ...newData];
        const unique = combined.filter(
            (candle, index, self) =>
                index === self.findIndex((c) => c.openTime === candle.openTime)
        );

        return unique.sort((a, b) => a.openTime - b.openTime);
    }

    // Get account info (for live trading mode)
    async getAccountInfo() {
        try {
            const account = await this.binance.account();

            // Filter and format balances
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
            console.error("Failed to get account info:", error);
            throw error;
        }
    }

    // Get specific asset balance
    async getAssetBalance(asset) {
        try {
            const account = await this.getAccountInfo();
            const balance = account.balances.find((b) => b.asset === asset);
            return balance || { asset, free: 0, locked: 0, total: 0 };
        } catch (error) {
            console.error(`Failed to get balance for ${asset}:`, error);
            return { asset, free: 0, locked: 0, total: 0 };
        }
    }

    // Order placement methods (for future live trading)
    async placeBuyOrder(symbol, quantity, price = null) {
        if (this.config.useTestnet) {
            console.log(
                `📋 PAPER TRADE: Buy ${quantity} ${symbol} at ${
                    price || "market"
                }`
            );
            return {
                orderId: Date.now(),
                symbol,
                side: "BUY",
                quantity,
                price,
            };
        }

        try {
            if (price) {
                return await this.binance.buy(symbol, quantity, price);
            } else {
                return await this.binance.marketBuy(symbol, quantity);
            }
        } catch (error) {
            console.error("Buy order failed:", error);
            throw error;
        }
    }

    async placeSellOrder(symbol, quantity, price = null) {
        if (this.config.useTestnet) {
            console.log(
                `📋 PAPER TRADE: Sell ${quantity} ${symbol} at ${
                    price || "market"
                }`
            );
            return {
                orderId: Date.now(),
                symbol,
                side: "SELL",
                quantity,
                price,
            };
        }

        try {
            if (price) {
                return await this.binance.sell(symbol, quantity, price);
            } else {
                return await this.binance.marketSell(symbol, quantity);
            }
        } catch (error) {
            console.error("Sell order failed:", error);
            throw error;
        }
    }

    // Cleanup method
    cleanup() {
        console.log("🧹 Cleaning up Binance Data Service...");

        try {
            // Close all websocket connections
            this.config.assets.forEach((asset) => {
                try {
                    this.binance.websockets.terminate(
                        `${asset.toLowerCase()}@ticker`
                    );
                } catch (error) {
                    console.error(
                        `Error closing websocket for ${asset}:`,
                        error
                    );
                }
            });
        } catch (error) {
            console.error("Error during websocket cleanup:", error);
        }

        this.websockets.clear();
        this.priceCache.clear();
        this.candleCache.clear();
        this.isConnected = false;

        this.emit("serviceClosed");
        console.log("✅ Binance Data Service cleaned up");
    }

    // Health check
    getServiceStatus() {
        return {
            isConnected: this.isConnected,
            priceStreams: this.priceCache.size,
            candleDatasets: this.candleCache.size,
            lastUpdate: Math.max(
                ...Array.from(this.priceCache.values()).map((p) => p.timestamp)
            ),
            config: {
                useTestnet: this.config.useTestnet,
                assets: this.config.assets,
                timeframes: this.config.timeframes,
            },
        };
    }
}

module.exports = BinanceDataService;
