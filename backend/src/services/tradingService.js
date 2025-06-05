// backend/src/services/tradingService.js
const BinanceDataService = require("./binanceDataService");
const SignalGenerator = require("./signalGenerator");
const PaperTradingEngine = require("./paperTradingEngine");
const TradeRepository = require("../repositories/tradeRepository");
const SignalRepository = require("../repositories/signalRepository");
const logger = require("../utils/logger");

class TradingService extends EventEmitter {
    constructor(io) {
        super();
        this.io = io;
        this.isActive = false;

        // Initialize repositories
        this.tradeRepo = new TradeRepository();
        this.signalRepo = new SignalRepository();

        this.config = {
            strategy: "balanced",
            timeframe: "1h",
            enableTrading: false,
            assets: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"],
        };
    }

    async initialize() {
        try {
            logger.info("🚀 Initializing Trading Service...");

            // Initialize core services
            this.binanceData = new BinanceDataService(this.config);
            this.signalGenerator = new SignalGenerator(this.config);
            this.paperTrading = new PaperTradingEngine(this.config);

            // Wait for services to be ready
            await this.waitForServices();

            // Start services
            this.paperTrading.start();
            this.signalGenerator.start(this.binanceData, 60000);

            this.setupServiceEvents();
            this.isActive = true;

            logger.info("✅ Trading Service initialized");
        } catch (error) {
            logger.error("❌ Trading Service initialization failed:", error);
            throw error;
        }
    }

    async waitForServices() {
        return new Promise((resolve, reject) => {
            this.binanceData.once("serviceReady", resolve);
            this.binanceData.once("serviceError", reject);

            setTimeout(() => reject(new Error("Service timeout")), 30000);
        });
    }

    setupServiceEvents() {
        // Signal generation events
        this.signalGenerator.on("signalGenerated", async (signal) => {
            try {
                await this.handleSignal(signal);
                this.emit("signalGenerated", signal);
            } catch (error) {
                logger.error("Error handling signal:", error);
            }
        });

        // Trade execution events
        this.paperTrading.on("tradeExecuted", async (trade) => {
            try {
                await this.tradeRepo.save(trade);
                this.emit("tradeExecuted", trade);
            } catch (error) {
                logger.error("Error saving trade:", error);
            }
        });

        // Price update events
        this.binanceData.on("priceUpdate", (priceData) => {
            const allPrices = this.binanceData.getAllPrices();
            this.paperTrading.updatePortfolioValue(allPrices);
            this.io.emit("priceUpdate", priceData);
        });
    }

    async handleSignal(signal) {
        try {
            // Save signal to database
            await this.signalRepo.save(signal);

            // Process signal if trading enabled
            if (this.config.enableTrading) {
                const priceData = this.binanceData.getCurrentPrice(
                    signal.symbol
                );
                if (priceData) {
                    await this.paperTrading.processSignal(
                        signal,
                        priceData.price,
                        signal.atr
                    );
                }
            }
        } catch (error) {
            logger.error("Error handling signal:", error);
            throw error;
        }
    }

    getStatus() {
        return {
            isActive: this.isActive,
            config: this.config,
            services: {
                binanceData: this.binanceData?.getServiceStatus(),
                signalGenerator: this.signalGenerator?.getStatus(),
                paperTrading: this.paperTrading?.getStatus(),
            },
        };
    }

    async startTrading() {
        this.config.enableTrading = true;
        this.paperTrading.updateConfig({ enableTrading: true });
        logger.info("▶️ Trading started");
    }

    async stopTrading() {
        this.config.enableTrading = false;
        this.paperTrading.updateConfig({ enableTrading: false });
        logger.info("⏹️ Trading stopped");
    }

    async cleanup() {
        logger.info("🧹 Cleaning up Trading Service...");

        if (this.signalGenerator) this.signalGenerator.stop();
        if (this.paperTrading) this.paperTrading.stop();
        if (this.binanceData) this.binanceData.cleanup();

        this.isActive = false;
        logger.info("✅ Trading Service cleaned up");
    }
}

module.exports = TradingService;
