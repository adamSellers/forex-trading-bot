// backend/src/services/configService.js - Trading Configuration Manager
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
        this.persistenceFault = null;
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

            let nextConfig = normalizeTradingConfig(DEFAULT_CONFIG);
            let needsSave = !fs.existsSync(this.configPath);
            // Resolve the full next state before committing it in memory.
            if (fs.existsSync(this.configPath)) {
                const fileContent = fs.readFileSync(this.configPath, "utf8");
                const fileConfig = JSON.parse(fileContent);
                nextConfig = normalizeTradingConfig(fileConfig);
                delete nextConfig.tradingMode;
                if (
                    ["m15-intraday-v3", "m15-intraday-v3.1", "m15-intraday-v3.2", "m15-intraday-v3.3", "m15-intraday-v4", "m15-intraday-v4.1"].includes(fileConfig.liveReleaseVersion) &&
                    DEFAULT_CONFIG.liveReleaseVersion === "m15-intraday-v4.2"
                ) {
                    // Preserve saved entry/exit/risk settings and enabled intent.
                    // The retired account-wide position limit is removed below.
                    nextConfig = {
                        ...nextConfig,
                        liveReleaseVersion: DEFAULT_CONFIG.liveReleaseVersion,
                        executionPolicyVersion: DEFAULT_CONFIG.executionPolicyVersion,
                        pricingModelVersion: DEFAULT_CONFIG.pricingModelVersion,
                    };
                    needsSave = true;
                    logger.info(
                        `Applied live release ${DEFAULT_CONFIG.liveReleaseVersion}; retained configuration values were preserved`
                    );
                } else if (
                    fileConfig.liveReleaseVersion !==
                    DEFAULT_CONFIG.liveReleaseVersion
                ) {
                    nextConfig = normalizeTradingConfig({
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
                    needsSave = true;
                    logger.info(
                        `Applied live strategy release ${DEFAULT_CONFIG.liveReleaseVersion}; prior live enabled state was preserved`
                    );
                }
                if (fileConfig.enforceConfigFreeze !== true) needsSave = true;
                logger.info(`📋 Config loaded from ${this.configPath}`);
            }

            // Remove only from the active configuration. Historical run/exit
            // snapshots retain the old field and its original hash semantics.
            if (Object.prototype.hasOwnProperty.call(nextConfig, "maxOpenPositions")) {
                delete nextConfig.maxOpenPositions;
                needsSave = true;
            }

            if (this.persistenceFault) {
                // Reloading the old file in this process is not a repair: it
                // may still contain enableTrading=true from before the fault.
                nextConfig.enableTrading = false;
                needsSave = true;
            }
            nextConfig.enforceConfigFreeze = true;
            if (needsSave) this.save(nextConfig);
            this.config = nextConfig;

            // Apply config to services
            this.applyToServices();
        } catch (error) {
            logger.error(`❌ Config load error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Save current config to file
     */
    save(config = this.config) {
        if (this.persistenceFault && config.enableTrading === true) {
            const error = new Error("Durably save paused entries before enabling after a configuration persistence failure");
            error.code = "CONFIG_PERSISTENCE_FAULT_ACTIVE";
            throw error;
        }
        let temporaryPath;
        let descriptor;
        try {
            const dataDir = path.dirname(this.configPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            // Same-directory rename is atomic. Flush both the new contents and
            // directory entry before acknowledging a durable operator change.
            temporaryPath = `${this.configPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
            descriptor = fs.openSync(temporaryPath, "wx", 0o600);
            fs.writeFileSync(descriptor, JSON.stringify(config, null, 4));
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            fs.renameSync(temporaryPath, this.configPath);
            temporaryPath = undefined;
            const directoryDescriptor = fs.openSync(dataDir, "r");
            try {
                fs.fsyncSync(directoryDescriptor);
            } finally {
                fs.closeSync(directoryDescriptor);
            }
            logger.info("💾 Config saved");
            this.persistenceFault = null;
            return true;
        } catch (error) {
            if (descriptor !== undefined) {
                try { fs.closeSync(descriptor); } catch (_closeError) { /* preserve write error */ }
            }
            if (temporaryPath) {
                try { fs.unlinkSync(temporaryPath); } catch (_cleanupError) { /* preserve write error */ }
            }
            logger.error(`❌ Config save error: ${error.message}`);
            const persistenceError = new Error(`Configuration could not be durably saved: ${error.message}`, { cause: error });
            persistenceError.code = "CONFIG_PERSISTENCE_FAILED";
            this.pauseAfterPersistenceFailure(persistenceError);
            throw persistenceError;
        }
    }

    pauseAfterPersistenceFailure(error) {
        this.persistenceFault = {
            code: error.code,
            message: error.message,
            failedAt: Date.now(),
        };
        // A failed write must never leave the running process free to enter.
        // Preserve all other accepted values; this emergency pause is explicitly
        // not durable, because the old file may still enable entries on reboot.
        this.config = { ...this.config, enableTrading: false };
        try {
            this.emit("configChanged", this.config);
        } catch (subscriberError) {
            logger.error(`Emergency pause subscriber failed: ${subscriberError.message}`);
        }
        try {
            this.applyToServices();
        } catch (serviceError) {
            logger.error(`Emergency pause service synchronization failed: ${serviceError.message}`);
        }
    }

    getPersistenceStatus() {
        return {
            durable: this.persistenceFault === null,
            forcedPause: this.persistenceFault !== null,
            restartMayResumeTrading: this.persistenceFault !== null,
            fault: this.persistenceFault ? { ...this.persistenceFault } : null,
        };
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
        const protectedChanges = getProtectedConfigChanges(
            this.config,
            sanitizedConfig
        );

        if (protectedChanges.length > 0) {
            const error = new Error(
                `Configuration freeze active. Protected keys cannot change: ${protectedChanges.join(
                    ", "
                )}`
            );
            error.code = "CONFIG_FREEZE_VIOLATION";
            throw error;
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

        // Persist before changing runtime state or acknowledging the request.
        this.save(nextConfig);
        this.config = nextConfig;

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
        const nextConfig = normalizeTradingConfig(DEFAULT_CONFIG);
        nextConfig.enforceConfigFreeze = true;
        this.save(nextConfig);
        this.config = nextConfig;
        this.applyToServices();
        this.emit("configReset", this.config);
        logger.info("🔄 Config reset to defaults");
        return this.config;
    }
}

module.exports = ConfigService;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
module.exports.computeConfigHash = computeConfigHash;
