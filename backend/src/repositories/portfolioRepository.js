// =====================================================
// 1. backend/src/repositories/portfolioRepository.js
// =====================================================
const db = require("../../config/database");
const logger = require("../utils/logger");

class PortfolioRepository {
    // =====================================================
    // Paper Trading Portfolio Methods
    // =====================================================
    async save(portfolioData) {
        try {
            await db("portfolio").insert({
                total_value: portfolioData.totalValue || 0,
                usdt_balance: portfolioData.usdtBalance || 0,
                crypto_value: portfolioData.cryptoValue || 0,
                total_pnl: portfolioData.totalPnL || 0,
                daily_pnl: portfolioData.dailyPnL || 0,
                weekly_pnl: portfolioData.weeklyPnL || 0,
                positions: portfolioData.positions
                    ? JSON.stringify(portfolioData.positions)
                    : null,
                position_count: portfolioData.positionCount || 0,
                allocation_usdt_percent: portfolioData.allocation?.usdt || 0,
                allocation_crypto_percent:
                    portfolioData.allocation?.crypto || 0,
                snapshot_time: new Date(),
            });

            logger.debug("Portfolio snapshot saved to database");
        } catch (error) {
            logger.error("Error saving portfolio:", error);
            // Don't throw - continue operation without database
        }
    }

    async getCurrent() {
        try {
            const latest = await db("portfolio")
                .orderBy("snapshot_time", "desc")
                .first();

            if (!latest) {
                // Return default portfolio structure
                return {
                    totalValue: 0,
                    usdtBalance: 0,
                    cryptoValue: 0,
                    totalPnL: 0,
                    dailyPnL: 0,
                    weeklyPnL: 0,
                    positions: [],
                    positionCount: 0,
                    allocation: { usdt: 100, crypto: 0 },
                    timestamp: Date.now(),
                };
            }

            return {
                totalValue: latest.total_value,
                usdtBalance: latest.usdt_balance,
                cryptoValue: latest.crypto_value,
                totalPnL: latest.total_pnl,
                dailyPnL: latest.daily_pnl,
                weeklyPnL: latest.weekly_pnl,
                positions: latest.positions ? JSON.parse(latest.positions) : [],
                positionCount: latest.position_count,
                allocation: {
                    usdt: latest.allocation_usdt_percent,
                    crypto: latest.allocation_crypto_percent,
                },
                timestamp: new Date(latest.snapshot_time).getTime(),
            };
        } catch (error) {
            logger.error("Error getting current portfolio:", error);
            // Return default portfolio on error
            return {
                totalValue: 0,
                usdtBalance: 0,
                cryptoValue: 0,
                totalPnL: 0,
                dailyPnL: 0,
                weeklyPnL: 0,
                positions: [],
                positionCount: 0,
                allocation: { usdt: 100, crypto: 0 },
                timestamp: Date.now(),
            };
        }
    }

    async update(portfolioData) {
        try {
            // Save new snapshot
            await this.save(portfolioData);

            // Clean old snapshots (keep last 1000)
            const count = await db("portfolio").count("id as total").first();
            if (count.total > 1000) {
                const cutoff = await db("portfolio")
                    .orderBy("snapshot_time", "desc")
                    .limit(1)
                    .offset(999)
                    .first();

                if (cutoff) {
                    await db("portfolio")
                        .where("snapshot_time", "<", cutoff.snapshot_time)
                        .del();
                }
            }

            logger.debug("Portfolio updated successfully");
        } catch (error) {
            logger.error("Error updating portfolio:", error);
            // Continue without throwing
        }
    }

    async getHistory(limit = 100) {
        try {
            return await db("portfolio")
                .orderBy("snapshot_time", "desc")
                .limit(limit);
        } catch (error) {
            logger.error("Error getting portfolio history:", error);
            return [];
        }
    }

    // =====================================================
    // Live Trading Portfolio Methods
    // =====================================================

    async saveLiveSnapshot(portfolioData) {
        try {
            await db("live_portfolio_snapshots").insert({
                total_value: portfolioData.totalValue || 0,
                usdt_balance: portfolioData.usdtBalance || 0,
                crypto_value: portfolioData.cryptoValue || 0,
                total_pnl: portfolioData.totalPnL || 0,
                daily_pnl: portfolioData.dailyPnL || 0,
                weekly_pnl: portfolioData.weeklyPnL || 0,
                positions: portfolioData.positions
                    ? JSON.stringify(portfolioData.positions)
                    : null,
                position_count: portfolioData.positionCount || 0,
                allocation_usdt_percent: portfolioData.allocation?.usdt || 0,
                allocation_crypto_percent:
                    portfolioData.allocation?.crypto || 0,
                snapshot_time: new Date(),
            });

            logger.debug("Live portfolio snapshot saved to database");
        } catch (error) {
            logger.error("Error saving live portfolio snapshot:", error);
        }
    }

    async getCurrentLive() {
        try {
            const latest = await db("live_portfolio_snapshots")
                .orderBy("snapshot_time", "desc")
                .first();

            if (!latest) {
                return {
                    totalValue: 0,
                    usdtBalance: 0,
                    cryptoValue: 0,
                    totalPnL: 0,
                    dailyPnL: 0,
                    weeklyPnL: 0,
                    positions: [],
                    positionCount: 0,
                    allocation: { usdt: 100, crypto: 0 },
                    timestamp: Date.now(),
                };
            }

            return {
                totalValue: latest.total_value,
                usdtBalance: latest.usdt_balance,
                cryptoValue: latest.crypto_value,
                totalPnL: latest.total_pnl,
                dailyPnL: latest.daily_pnl,
                weeklyPnL: latest.weekly_pnl,
                positions: latest.positions ? JSON.parse(latest.positions) : [],
                positionCount: latest.position_count,
                allocation: {
                    usdt: latest.allocation_usdt_percent,
                    crypto: latest.allocation_crypto_percent,
                },
                timestamp: new Date(latest.snapshot_time).getTime(),
            };
        } catch (error) {
            logger.error("Error getting current live portfolio:", error);
            return {
                totalValue: 0,
                usdtBalance: 0,
                cryptoValue: 0,
                totalPnL: 0,
                dailyPnL: 0,
                weeklyPnL: 0,
                positions: [],
                positionCount: 0,
                allocation: { usdt: 100, crypto: 0 },
                timestamp: Date.now(),
            };
        }
    }

    async getLiveHistory(limit = 100) {
        try {
            return await db("live_portfolio_snapshots")
                .orderBy("snapshot_time", "desc")
                .limit(limit);
        } catch (error) {
            logger.error("Error getting live portfolio history:", error);
            return [];
        }
    }
}

module.exports = PortfolioRepository;
