// backend/src/services/binanceDataService.js (Refactored)
const EventEmitter = require("events");
const logger = require("../utils/logger");
const binance = require("./binanceClient"); // Import the configured client
const { getHistoricalCandles } = require("./dataUtils"); // Import data utility

class BinanceDataService extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            assets: config.assets || [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
            ],
            timeframes: config.timeframes || ["1h", "4h", "1d"],
            historicalDataRequirements: config.historicalDataRequirements || {
                "1h": 500,
                "4h": 250,
                "1d": 200,
            },
            ...config,
        };

        this.binance = binance; // Use the singleton client instance
        this.priceCache = new Map();
        this.candleCache = new Map();
        this.isConnected = false;

        // Fail-fast: If the client didn't initialize (e.g., no API keys), throw an error.
        if (!this.binance) {
            const errorMessage =
                "Binance client failed to initialize. Please check API credentials and logs.";
            logger.error(`❌ ${errorMessage}`);
            throw new Error(errorMessage);
        }

        this.initializeService();
    }

    async initializeService() {
        try {
            logger.info("🚀 Initializing Binance Data Service...");

            await this.testConnection();
            await this.loadHistoricalData();
            await this.initializePriceStreams();

            this.isConnected = true;
            this.emit("serviceReady");
            logger.success("✅ Binance Data Service initialized successfully");
        } catch (error) {
            logger.error("❌ Service initialization failed:", error.message);
            // Re-throw the error to ensure the application startup process is halted.
            // This prevents the app from running in a partially initialized or broken state.
            throw error;
        }
    }

    async testConnection() {
        try {
            logger.info("📡 Testing LIVE Binance API connection...");

            // Minimal connection test
            const serverTimeResponse = await this.binance.time();
            // Log the raw response for debugging
            logger.debug(
                `Binance server time response: ${JSON.stringify(
                    serverTimeResponse
                )}`
            );

            if (serverTimeResponse && serverTimeResponse.serverTime > 0) {
                logger.success("✅ LIVE Binance API connection successful");
            } else {
                throw new Error("Invalid server time response");
            }
        } catch (error) {
            logger.error(`❌ LIVE API test failed: ${error.message || error}`);
            logger.error("Full API test error details:", {
                name: error.name,
                message: error.message,
            });
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
            throw error; // Re-throw to halt initialization
        }
    }

    async loadHistoricalData() {
        logger.info("📚 Loading historical data...");
        let totalLoaded = 0;

        for (const asset of this.config.assets) {
            for (const timeframe of this.config.timeframes) {
                const limit = this.config.historicalDataRequirements[timeframe];
                logger.info(
                    `📊 Loading ${limit} ${timeframe} candles for ${asset}...`
                );

                // This will throw an error on failure, which will be caught by initializeService
                const candles = await getHistoricalCandles(
                    this.binance,
                    asset,
                    timeframe,
                    limit
                );

                const cacheKey = `${asset}_${timeframe}`;
                this.candleCache.set(cacheKey, candles);
                totalLoaded += candles.length;
                logger.success(
                    `✅ Loaded ${candles.length} ${timeframe} candles for ${asset}`
                );

                // Rate limiting
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }

        logger.success(
            `✅ Historical data loaded: ${totalLoaded} total candles`
        );
    }

    async initializePriceStreams() {
        logger.info("📊 Initializing price streams...");

        try {
            // ADDED: A defensive check to ensure the websockets object and its methods are available.
            if (
                !this.binance.websockets ||
                typeof this.binance.websockets.ticker !== "function"
            ) {
                log_warning(
                    "⚠️ WebSocket functionality not available, falling back to polling"
                );
                this.initializePricePolling();
                return;
            }

            let successCount = 0;

            for (const asset of this.config.assets) {
                try {
                    this.binance.websockets.ticker(asset, (ticker) => {
                        try {
                            // Ensure explicit conversion for potential BigNumber values
                            const priceData = {
                                // The json_parse fix in binanceClient handles BigNumber
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
                            // Log minimal info to avoid flooding logs
                            logger.error("Ticker data causing error:", ticker);
                        }
                    });

                    successCount++;
                    logger.success(`✅ Live stream active for ${asset}`);
                    await new Promise((resolve) => setTimeout(resolve, 100));
                } catch (streamError) {
                    logger.error(
                        `❌ Stream failed for ${asset}:`,
                        streamError.message
                    ); // This won't stop other streams from trying to connect
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
            ); // This error will be caught by the main initializeService block
            throw error;
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
            // Do not return mock data. Let the caller handle the error.
            throw error;
        }
    }

    cleanup() {
        logger.info("🧹 Cleaning up Binance Data Service...");

        try {
            if (this.binance && this.binance.websockets) {
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
                assets: this.config.assets,
                timeframes: this.config.timeframes,
            },
        };
    }
}

module.exports = BinanceDataService;
