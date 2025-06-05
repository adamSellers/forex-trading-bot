// backend/src/services/riskManagementService.js
const EventEmitter = require("events");
const logger = require("../utils/logger");

class RiskManagementService extends EventEmitter {
    constructor() {
        super();
        this.riskLimits = {
            dailyLossLimit: 100, // $100
            weeklyLossLimit: 250, // $250
            maxDrawdown: 20, // 20%
            isHalted: false,
            haltReason: null,
        };
        this.currentRisk = {
            dailyLoss: 0,
            weeklyLoss: 0,
            currentDrawdown: 0,
        };
    }

    async initialize() {
        logger.info("🚀 Initializing Risk Management Service...");
        // Load risk settings from database if needed
        logger.info("✅ Risk Management Service initialized");
    }

    checkRiskLimits(portfolio) {
        try {
            // Update current risk metrics
            this.updateRiskMetrics(portfolio);

            // Check daily loss limit
            if (this.currentRisk.dailyLoss >= this.riskLimits.dailyLossLimit) {
                this.haltTrading(
                    `Daily loss limit exceeded: $${this.currentRisk.dailyLoss}`
                );
                return false;
            }

            // Check weekly loss limit
            if (
                this.currentRisk.weeklyLoss >= this.riskLimits.weeklyLossLimit
            ) {
                this.haltTrading(
                    `Weekly loss limit exceeded: $${this.currentRisk.weeklyLoss}`
                );
                return false;
            }

            // Check drawdown limit
            if (
                this.currentRisk.currentDrawdown >= this.riskLimits.maxDrawdown
            ) {
                this.haltTrading(
                    `Drawdown limit exceeded: ${this.currentRisk.currentDrawdown}%`
                );
                return false;
            }

            return true;
        } catch (error) {
            logger.error("Error checking risk limits:", error);
            return false;
        }
    }

    updateRiskMetrics(portfolio) {
        if (!portfolio) return;

        this.currentRisk.dailyLoss = Math.abs(
            Math.min(0, portfolio.dailyPnL || 0)
        );
        this.currentRisk.weeklyLoss = Math.abs(
            Math.min(0, portfolio.weeklyPnL || 0)
        );
        this.currentRisk.currentDrawdown =
            portfolio.performance?.currentDrawdown || 0;
    }

    haltTrading(reason) {
        this.riskLimits.isHalted = true;
        this.riskLimits.haltReason = reason;

        const haltData = {
            reason,
            timestamp: Date.now(),
            riskMetrics: this.currentRisk,
        };

        this.emit("tradingHalted", haltData);
        logger.warn("🚨 Trading halted:", reason);
    }

    resumeTrading() {
        this.riskLimits.isHalted = false;
        this.riskLimits.haltReason = null;
        this.emit("tradingResumed");
        logger.info("✅ Trading resumed");
    }

    getRiskStatus() {
        return {
            limits: this.riskLimits,
            current: this.currentRisk,
            utilization: {
                daily:
                    (this.currentRisk.dailyLoss /
                        this.riskLimits.dailyLossLimit) *
                    100,
                weekly:
                    (this.currentRisk.weeklyLoss /
                        this.riskLimits.weeklyLossLimit) *
                    100,
                drawdown:
                    (this.currentRisk.currentDrawdown /
                        this.riskLimits.maxDrawdown) *
                    100,
            },
        };
    }

    async cleanup() {
        logger.info("🧹 Cleaning up Risk Management Service...");
        this.currentRisk = { dailyLoss: 0, weeklyLoss: 0, currentDrawdown: 0 };
        logger.info("✅ Risk Management Service cleaned up");
    }
}

module.exports = RiskManagementService;
