// backend/src/services/configService.js - Trading Configuration Manager
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const logger = require("../utils/logger");

// Default Forex trading configuration
const DEFAULT_CONFIG = {
    // General
    enableTrading: false,
    maxCapitalAtRisk: 500,
    maxOpenPositions: 2,
    logLevel: "info",

    // Instruments
    assets: ["AUD_USD", "EUR_USD"],

    // Strategy
    strategy: "supertrend_momentum",
    timeframe: "15m",
    signalCooldown: 60000, // ms

    // SuperTrend
    supertrendPeriod: 10,
    supertrendMultiplier: 3.0,

    // Entry Filters
    enableAdxFilter: true,
    minAdx: 22,
    adxSlopeFilter: true,
    adxSlopeLookback: 3,
    enableRsiFilter: true,
    rsiOverbought: 75,
    rsiOversold: 30,

    // Continuation Entry
    enableContinuationEntry: true,
    continuationWindowMs: 4 * 60 * 60 * 1000, // 4 hours
    continuationRsiThreshold: 70,
    continuationMaxPriceDeviation: 0.02,

    // Short Selling
    enableShorting: false,

    // Risk Management
    riskPerTrade: 0.02,
    maxPortfolioExposure: 0.5,
    leverage: 10,

    // Position Sizing
    positionSizeMethod: "RISK",
    fixedPositionUnits: 1000,

    // Stop Loss
    stopLossType: "ATR",
    stopLossPips: 30,
    stopLossAtrMultiplier: 1.5,

    // Trailing Stop
    enableTrailingStops: true,
    trailingStopPips: 25,
    trailingStopActivationPips: 20,

    // Trading Sessions
    enableSessionFilter: false,
    activeSessions: ["sydney", "tokyo", "london", "newyork"],

    // Notifications
    enableEmailAlerts: false,
    alertEmail: "",
};

class ConfigService extends EventEmitter {
    constructor(configPath = null) {
        super();
        this.configPath =
            configPath ||
            path.join(__dirname, "../../data/trading_config.json");
        this.config = { ...DEFAULT_CONFIG };
        this.dataService = null;
        this.signalGenerator = null;
    }

    /**
     * Initialize config service and load from file
     */
    init(dataService = null, signalGenerator = null) {
        this.dataService = dataService;
        this.signalGenerator = signalGenerator;
        this.load();
        return this;
    }

    /**
     * Load config from file, create with defaults if doesn't exist
     */
    load() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.configPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
                logger.info(`📁 Created data directory: ${dataDir}`);
            }

            // Load or create config file
            if (fs.existsSync(this.configPath)) {
                const fileContent = fs.readFileSync(this.configPath, "utf8");
                const fileConfig = JSON.parse(fileContent);
                this.config = { ...DEFAULT_CONFIG, ...fileConfig };
                delete this.config.tradingMode;
                logger.info(`📋 Config loaded from ${this.configPath}`);
            } else {
                // Create default config file
                this.save();
                logger.info(`📋 Created default config at ${this.configPath}`);
            }

            // Apply config to services
            this.applyToServices();
        } catch (error) {
            logger.error(`❌ Config load error: ${error.message}`);
            this.config = { ...DEFAULT_CONFIG };
        }
    }

    /**
     * Save current config to file
     */
    save() {
        try {
            const dataDir = path.dirname(this.configPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(
                this.configPath,
                JSON.stringify(this.config, null, 4)
            );
            logger.info("💾 Config saved");
            return true;
        } catch (error) {
            logger.error(`❌ Config save error: ${error.message}`);
            return false;
        }
    }

    /**
     * Update config with new values
     */
    update(newConfig) {
        const oldAssets = [...(this.config.assets || [])];
        const { tradingMode, ...sanitizedConfig } = newConfig;

        // Merge new config
        this.config = { ...this.config, ...sanitizedConfig };

        // Save to file
        this.save();

        // Apply to running services
        this.applyToServices();

        // Emit change event
        this.emit("configChanged", this.config);

        // Check if assets changed
        const newAssets = this.config.assets || [];
        if (JSON.stringify(oldAssets) !== JSON.stringify(newAssets)) {
            this.emit("assetsChanged", newAssets);
            logger.info(
                `📊 Active instruments changed: ${newAssets.join(", ")}`
            );
        }

        return this.config;
    }

    /**
     * Apply config to running services
     */
    applyToServices() {
        // Update SignalGenerator
        if (this.signalGenerator) {
            this.signalGenerator.updateConfig({
                assets: this.config.assets,
                timeframe: this.config.timeframe,
                minAdx: this.config.minAdx,
                adxSlopeFilter: this.config.adxSlopeFilter,
                adxSlopeLookback: this.config.adxSlopeLookback,
                rsiOverbought: this.config.rsiOverbought,
                rsiOversold: this.config.rsiOversold,
                enableContinuationEntry: this.config.enableContinuationEntry,
                continuationWindowMs: this.config.continuationWindowMs,
                continuationRsiThreshold: this.config.continuationRsiThreshold,
                continuationMaxPriceDeviation:
                    this.config.continuationMaxPriceDeviation,
                signalCooldown: this.config.signalCooldown,
                atrPeriod: this.config.supertrendPeriod,
                factor: this.config.supertrendMultiplier,
            });
            logger.debug("📡 SignalGenerator config updated");
        }

        // Update DataService instruments
        if (this.dataService && this.config.assets) {
            this.dataService.updateInstruments(this.config.assets);
            logger.debug("📡 DataService instruments updated");
        }
    }

    /**
     * Get current config
     */
    get() {
        return { ...this.config };
    }

    /**
     * Get specific config value
     */
    getValue(key) {
        return this.config[key];
    }

    /**
     * Reset to defaults
     */
    reset() {
        this.config = { ...DEFAULT_CONFIG };
        this.save();
        this.applyToServices();
        this.emit("configReset", this.config);
        logger.info("🔄 Config reset to defaults");
        return this.config;
    }
}

module.exports = ConfigService;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
