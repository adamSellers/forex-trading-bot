const { db } = require("../../config/database");
const logger = require("../utils/logger");

class PortfolioRepository {
    async save(snapshot = {}) {
        try {
            await db("portfolio_snapshots").insert({
                total_value_aud: snapshot.totalValueAud || snapshot.totalValue || 0,
                balance_aud: snapshot.balanceAud || snapshot.balance || 0,
                unrealized_pnl_aud:
                    snapshot.unrealizedPnlAud || snapshot.unrealizedPnL || 0,
                realized_pnl_aud:
                    snapshot.realizedPnlAud || snapshot.realizedPnL || 0,
                margin_used_aud: snapshot.marginUsedAud || snapshot.marginUsed || 0,
                margin_available_aud:
                    snapshot.marginAvailableAud || snapshot.marginAvailable || 0,
                positions: snapshot.positions
                    ? JSON.stringify(snapshot.positions)
                    : null,
                position_count:
                    snapshot.positionCount || snapshot.positions?.length || 0,
                exposure_percent: snapshot.exposurePercent || 0,
                snapshot_time: snapshot.snapshotTime || Date.now(),
            });
        } catch (error) {
            logger.error("Error saving portfolio snapshot:", error);
        }
    }

    async getCurrent() {
        try {
            const latest = await db("portfolio_snapshots")
                .orderBy("snapshot_time", "desc")
                .first();

            if (!latest) {
                return this._emptySnapshot();
            }

            return {
                totalValueAud: Number(latest.total_value_aud || 0),
                balanceAud: Number(latest.balance_aud || 0),
                unrealizedPnlAud: Number(latest.unrealized_pnl_aud || 0),
                realizedPnlAud: Number(latest.realized_pnl_aud || 0),
                marginUsedAud: Number(latest.margin_used_aud || 0),
                marginAvailableAud: Number(latest.margin_available_aud || 0),
                positions: latest.positions ? JSON.parse(latest.positions) : [],
                positionCount: Number(latest.position_count || 0),
                exposurePercent: Number(latest.exposure_percent || 0),
                snapshotTime: Number(latest.snapshot_time || Date.now()),
            };
        } catch (error) {
            logger.error("Error reading portfolio snapshot:", error);
            return this._emptySnapshot();
        }
    }

    async getHistory(limit = 100) {
        try {
            return await db("portfolio_snapshots")
                .orderBy("snapshot_time", "desc")
                .limit(limit);
        } catch (error) {
            logger.error("Error reading portfolio history:", error);
            return [];
        }
    }

    _emptySnapshot() {
        return {
            totalValueAud: 0,
            balanceAud: 0,
            unrealizedPnlAud: 0,
            realizedPnlAud: 0,
            marginUsedAud: 0,
            marginAvailableAud: 0,
            positions: [],
            positionCount: 0,
            exposurePercent: 0,
            snapshotTime: Date.now(),
        };
    }
}

module.exports = PortfolioRepository;
