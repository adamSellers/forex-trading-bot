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
const {
    LIVE_RISK_LIMITS,
    getLiveRiskLimitViolations,
} = require("../runtime/liveReadiness");

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
                if (
                    fileConfig.liveReleaseVersion !==
                    DEFAULT_CONFIG.liveReleaseVersion
                ) {
                    this.config = normalizeTradingConfig({
                        ...DEFAULT_CONFIG,
                        enableTrading: fileConfig.enableTrading === true,
                        logLevel: fileConfig.logLevel || DEFAULT_CONFIG.logLevel,
                        enableEmailAlerts:
                            fileConfig.enableEmailAlerts === true,
                        alertEmail:
                            typeof fileConfig.alertEmail === "string"
                                ? fileConfig.alertEmail
                                : DEFAULT_CONFIG.alertEmail,
                    });
                    this.save();
                    logger.info(
                        `Applied live strategy release ${DEFAULT_CONFIG.liveReleaseVersion}; prior live enabled state was preserved`
                    );
                }
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
    update(newConfig, options = {}) {
        const oldAssets = [...(this.config.assets || [])];
        const { tradingMode, configHash, ...sanitizedConfig } = newConfig;

        if (
            (sanitizedConfig.referenceCurrency &&
                String(sanitizedConfig.referenceCurrency).toUpperCase() !== "AUD") ||
            (sanitizedConfig.accountCurrency &&
                String(sanitizedConfig.accountCurrency).toUpperCase() !== "AUD")
        ) {
            throw new Error("AUD is the fixed account and reference currency");
        }

        const requestsActivation =
            sanitizedConfig.enableTrading === true &&
            this.config.enableTrading !== true;
        if (requestsActivation && options.allowLiveActivation !== true) {
            const error = new Error(
                "Live trading can only be enabled through the readiness-gated activation endpoint"
            );
            error.code = "LIVE_ACTIVATION_PATH_REQUIRED";
            throw error;
        }
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

        const nextConfig = normalizeTradingConfig({
            ...this.config,
            ...sanitizedConfig,
        });

        if (nextConfig.enableTrading) {
            const violations = getLiveRiskLimitViolations(nextConfig);
            if (violations.length > 0) {
                const error = new Error(
                    `Live risk limits cannot exceed release caps: ${violations
                        .map((violation) => violation.key)
                        .join(", ")}`
                );
                error.code = "LIVE_RISK_LIMIT";
                error.limits = LIVE_RISK_LIMITS;
                error.violations = violations;
                throw error;
            }
        }

        // Merge only after every fail-closed invariant has passed.
        this.config = nextConfig;

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
        // The live runtime owns an immutable release snapshot. Operational
        // updates are still passed through so assets/timeframes stay in sync.
        if (this.signalGenerator) {
            this.signalGenerator.updateConfig(this.config);
            logger.debug("Live runtime configuration synchronized");
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
