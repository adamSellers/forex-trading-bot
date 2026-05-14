// backend/src/services/configService.js - Trading Configuration Manager
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const logger = require("../utils/logger");
const {
    DEFAULT_TRADING_CONFIG,
    cloneDefaultConfig,
    normalizeTradingConfig,
    computeConfigHash,
    getProtectedConfigChanges,
} = require("../config/tradingConfig");

const DEFAULT_CONFIG = cloneDefaultConfig();

class ConfigService extends EventEmitter {
    constructor(configPath = null) {
        super();
        this.configPath =
            configPath ||
            path.join(__dirname, "../../data/trading_config.json");
        this.config = normalizeTradingConfig(DEFAULT_CONFIG);
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
                this.config = normalizeTradingConfig(fileConfig);
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
            this.config = normalizeTradingConfig(DEFAULT_CONFIG);
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
        const { tradingMode, configHash, ...sanitizedConfig } = newConfig;
        const protectedChanges =
            this.config.enforceConfigFreeze === true
                ? getProtectedConfigChanges(this.config, sanitizedConfig)
                : [];

        if (protectedChanges.length > 0) {
            throw new Error(
                `Configuration freeze active. Protected keys cannot change: ${protectedChanges.join(
                    ", "
                )}`
            );
        }

        // Merge new config
        this.config = normalizeTradingConfig({
            ...this.config,
            ...sanitizedConfig,
        });

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
                enableAdxFilter: this.config.enableAdxFilter,
                minAdx: this.config.minAdx,
                maxRegimeAdx: this.config.maxRegimeAdx,
                adxSlopeFilter: this.config.adxSlopeFilter,
                adxSlopeLookback: this.config.adxSlopeLookback,
                requireDirectionalAdx: this.config.requireDirectionalAdx,
                enableRsiFilter: this.config.enableRsiFilter,
                longRsiMomentumFloor: this.config.longRsiMomentumFloor,
                shortRsiMomentumCeiling:
                    this.config.shortRsiMomentumCeiling,
                freshLongRsiCeiling: this.config.freshLongRsiCeiling,
                rsiOverbought: this.config.rsiOverbought,
                rsiOversold: this.config.rsiOversold,
                enableContinuationEntry: this.config.enableContinuationEntry,
                enableLongContinuationEntry:
                    this.config.enableLongContinuationEntry,
                enableShortContinuationEntry:
                    this.config.enableShortContinuationEntry,
                continuationWindowMs: this.config.continuationWindowMs,
                continuationRsiThreshold: this.config.continuationRsiThreshold,
                continuationMaxPriceDeviation:
                    this.config.continuationMaxPriceDeviation,
                continuationPullbackMinAtr:
                    this.config.continuationPullbackMinAtr,
                continuationPullbackMaxAtr:
                    this.config.continuationPullbackMaxAtr,
                enableHTFFilter: this.config.enableHTFFilter,
                htfTimeframe: this.config.htfTimeframe,
                timesFmEnabled: this.config.timesFmEnabled,
                timesFmMode: this.config.timesFmMode,
                timesFmHorizonBars: this.config.timesFmHorizonBars,
                timesFmTimeoutMs: this.config.timesFmTimeoutMs,
                timesFmVetoConfidence: this.config.timesFmVetoConfidence,
                timesFmDeadZoneBps: this.config.timesFmDeadZoneBps,
                timesFmStrategyMinConfidence:
                    this.config.timesFmStrategyMinConfidence,
                timesFmStrategyMinReturnBps:
                    this.config.timesFmStrategyMinReturnBps,
                timesFmStrategyHighConfidenceThreshold:
                    this.config.timesFmStrategyHighConfidenceThreshold,
                timesFmStrategyHighConfidenceMinReturnBps:
                    this.config.timesFmStrategyHighConfidenceMinReturnBps,
                timesFmStrategyStopLossAtrMultiplier:
                    this.config.timesFmStrategyStopLossAtrMultiplier,
                timesFmStrategyRiskReward: this.config.timesFmStrategyRiskReward,
                timesFmStrategyBlockExtremeVolatility:
                    this.config.timesFmStrategyBlockExtremeVolatility,
                timeStopHours: this.config.timeStopHours,
                maxSpreadPips: this.config.maxSpreadPips,
                signalCooldown: this.config.signalCooldown,
                atrPeriod: this.config.supertrendPeriod,
                factor: this.config.supertrendMultiplier,
            });
            logger.debug("📡 SignalGenerator config updated");
        }

        // Update DataService instruments
        if (this.dataService && this.config.assets) {
            this.dataService.updateCandleConfig?.({
                timeframe: this.config.timeframe,
                enableHTFFilter: this.config.enableHTFFilter,
                htfTimeframe: this.config.htfTimeframe,
            });
            this.dataService.updateInstruments(this.config.assets);
            logger.debug("📡 DataService instruments updated");
        }
    }

    /**
     * Get current config
     */
    get() {
        const config = normalizeTradingConfig(this.config);
        return {
            ...config,
            configHash: computeConfigHash(config),
        };
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
        this.config = normalizeTradingConfig(DEFAULT_CONFIG);
        this.save();
        this.applyToServices();
        this.emit("configReset", this.config);
        logger.info("🔄 Config reset to defaults");
        return this.config;
    }
}

module.exports = ConfigService;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
module.exports.computeConfigHash = computeConfigHash;
