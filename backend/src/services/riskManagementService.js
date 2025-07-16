// backend/src/services/riskManagementService.js
const EventEmitter = require("events");
const logger = require("../utils/logger");

class RiskManagementService extends EventEmitter {
    constructor() {
        super();
        this.config = {};
        this.riskState = {};
        this.reset(); // Initialize state
    }

    initialize(config) {
        logger.info("🚀 Initializing Risk Management Service...");
        this.updateConfig(config);
        logger.info("✅ Risk Management Service initialized");
    }

    updateConfig(newConfig) {
        const oldCapital = this.config.maxCapitalAtRisk;
        this.config = { ...this.config, ...newConfig };

        // Recalculate risk limits based on the new config
        this.riskState.dailyLossLimit =
            this.config.maxCapitalAtRisk * this.config.maxDailyLoss;
        this.riskState.weeklyLossLimit =
            this.config.maxCapitalAtRisk * this.config.maxWeeklyLoss;

        if (oldCapital !== this.config.maxCapitalAtRisk) {
            logger.info(
                `💰 Risk capital updated to $${this.config.maxCapitalAtRisk}. Risk limits recalculated.`
            );
        }
    }

    checkRiskLimits(portfolioSummary) {
        try {
            if (!portfolioSummary) return true;

            const dailyLoss = Math.abs(
                Math.min(0, portfolioSummary.dailyPnL || 0)
            );
            const weeklyLoss = Math.abs(
                Math.min(0, portfolioSummary.weeklyPnL || 0)
            );

            // Check daily loss limit
            // FIX: Only halt if loss is strictly positive AND meets/exceeds the limit.
            // This prevents a $0.00 loss from halting if the limit is also 0.
            if (dailyLoss > 0 && dailyLoss >= this.riskState.dailyLossLimit) {
                this.haltTrading(
                    `Daily loss limit exceeded: $${dailyLoss.toFixed(2)}`
                );
                return false;
            }

            // Check weekly loss limit
            if (
                weeklyLoss > 0 &&
                weeklyLoss >= this.riskState.weeklyLossLimit
            ) {
                this.haltTrading(
                    `Weekly loss limit exceeded: $${weeklyLoss.toFixed(2)}`
                );
                return false;
            }

            // Note: Drawdown is a soft limit, checked but doesn't halt trading automatically.

            return true;
        } catch (error) {
            logger.error("Error checking risk limits:", error);
            return false;
        }
    }

    isHalted() {
        return this.riskState.isHalted;
    }

    getHaltReason() {
        return this.riskState.haltReason;
    }

    haltTrading(reason) {
        if (this.riskState.isHalted) return; // Already halted

        this.riskState.isHalted = true;
        this.riskState.haltReason = reason;

        const haltData = {
            reason,
            timestamp: Date.now(),
            riskMetrics: this.riskState,
        };

        this.emit("tradingHalted", haltData);
        logger.warn("🚨 Trading halted:", reason);
    }

    resumeTrading() {
        if (!this.riskState.isHalted) return;

        this.riskState.isHalted = false;
        this.riskState.haltReason = null;
        this.emit("tradingResumed");
        logger.info("✅ Trading resumed");
    }

    resetDailyLimit(today) {
        this.riskState.lastResetDate = today;
        if (this.riskState.haltReason?.includes("Daily")) {
            this.resumeTrading();
        }
    }

    resetWeeklyLimit(currentWeek) {
        this.riskState.lastWeeklyReset = currentWeek;
        if (this.riskState.haltReason?.includes("Weekly")) {
            this.resumeTrading();
        }
    }

    getRiskStatus(portfolioSummary = {}) {
        return {
            isHalted: this.riskState.isHalted,
            haltReason: this.riskState.haltReason,
            dailyLossUsed: Math.abs(
                Math.min(0, portfolioSummary.dailyPnL || 0)
            ),
            dailyLossLimit: this.riskState.dailyLossLimit,
            weeklyLossUsed: Math.abs(
                Math.min(0, portfolioSummary.weeklyPnL || 0)
            ),
            weeklyLossLimit: this.riskState.weeklyLossLimit,
        };
    }

    reset() {
        this.riskState = {
            dailyLossLimit: 0,
            weeklyLossLimit: 0,
            isHalted: false,
            haltReason: null,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };
        logger.info("🔄 Risk Management Service state has been reset.");
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff)).toDateString();
    }
}

module.exports = RiskManagementService;
