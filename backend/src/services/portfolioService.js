// =====================================================
// 2. Updated backend/src/services/portfolioService.js
// Fix the import to match existing structure
// =====================================================

const EventEmitter = require("events");
const PortfolioRepository = require("../repositories/portfolioRepository");
const logger = require("../utils/logger");

class PortfolioService extends EventEmitter {
    constructor() {
        super();
        this.portfolioRepo = new PortfolioRepository();
        this.currentPortfolio = null;
    }

    async initialize() {
        logger.info("🚀 Initializing Portfolio Service...");

        try {
            this.currentPortfolio = await this.portfolioRepo.getCurrent();
            logger.success("✅ Portfolio Service initialized");
        } catch (error) {
            logger.error("❌ Portfolio Service initialization failed:", error);
            throw error;
        }
    }

    async getPortfolio() {
        try {
            return await this.portfolioRepo.getCurrent();
        } catch (error) {
            logger.error("Error getting portfolio:", error);
            throw error;
        }
    }

    async updatePortfolio(portfolioData) {
        try {
            this.currentPortfolio = portfolioData;
            await this.portfolioRepo.update(portfolioData);
            this.emit("portfolioUpdated", portfolioData);
        } catch (error) {
            logger.error("Error updating portfolio:", error);
            throw error;
        }
    }

    async getCombinedHoldings(binanceAccount, paperPortfolio) {
        try {
            const holdings = {
                timestamp: Date.now(),
                real: null,
                paper: null,
            };

            if (binanceAccount) {
                holdings.real = {
                    balances: binanceAccount.balances || [],
                    accountType: binanceAccount.accountType,
                    totalValue: this.calculatePortfolioValue(
                        binanceAccount.balances
                    ),
                };
            }

            if (paperPortfolio) {
                holdings.paper = {
                    usdtBalance: paperPortfolio.usdtBalance,
                    positions: paperPortfolio.positions,
                    totalValue: paperPortfolio.totalValue,
                    totalPnL: paperPortfolio.totalPnL,
                };
            }

            return holdings;
        } catch (error) {
            logger.error("Error getting combined holdings:", error);
            throw error;
        }
    }

    calculatePortfolioValue(balances, prices = {}) {
        if (!balances) return 0;

        return balances.reduce((total, balance) => {
            if (balance.asset === "USDT") {
                return total + balance.total;
            }

            const symbol = `${balance.asset}USDT`;
            const price = prices[symbol]?.price || 0;
            return total + balance.total * price;
        }, 0);
    }

    async cleanup() {
        logger.info("🧹 Cleaning up Portfolio Service...");
        this.currentPortfolio = null;
        logger.success("✅ Portfolio Service cleaned up");
    }
}

module.exports = PortfolioService;
