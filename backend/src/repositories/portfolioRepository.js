const { db } = require("../../config/database");
const logger = require("../utils/logger");

class PortfolioRepository {
    _applyRuntimeFilters(query, filters = {}) {
        const { mode, runId, selectionId, strategy } = filters || {};

        if (mode !== null && mode !== undefined) {
            query.where("mode", mode);
        }
        if (runId) {
            query.where("run_id", runId);
        }
        if (selectionId) {
            query.where("selection_id", selectionId);
        }
        if (strategy) {
            query.where("strategy", strategy);
        }

        return query;
    }

    _mapSnapshotRow(row) {
        if (!row) {
            return this._emptySnapshot();
        }

        return {
            totalValueAud: Number(row.total_value_aud || 0),
            balanceAud: Number(row.balance_aud || 0),
            unrealizedPnlAud: Number(row.unrealized_pnl_aud || 0),
            realizedPnlAud: Number(row.realized_pnl_aud || 0),
            marginUsedAud: Number(row.margin_used_aud || 0),
            marginAvailableAud: Number(row.margin_available_aud || 0),
            positions: row.positions ? JSON.parse(row.positions) : [],
            positionCount: Number(row.position_count || 0),
            exposurePercent: Number(row.exposure_percent || 0),
            snapshotTime: Number(row.snapshot_time || Date.now()),
            runId: row.run_id || null,
            selectionId: row.selection_id || null,
            mode: row.mode || "live",
            strategy: row.strategy || null,
        };
    }

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
                run_id: snapshot.runId || null,
                selection_id: snapshot.selectionId || null,
                mode: snapshot.mode || "live",
                strategy: snapshot.strategy || null,
            });
        } catch (error) {
            logger.error("Error saving portfolio snapshot:", error);
        }
    }

    async getCurrent(filters = {}) {
        try {
            const latest = await this._applyRuntimeFilters(
                db("portfolio_snapshots"),
                filters
            )
                .orderBy("snapshot_time", "desc")
                .first();

            if (!latest) {
                return this._emptySnapshot();
            }

            return this._mapSnapshotRow(latest);
        } catch (error) {
            logger.error("Error reading portfolio snapshot:", error);
            return this._emptySnapshot();
        }
    }

    async getHistory(limit = 100, filters = {}) {
        try {
            const rows = await this._applyRuntimeFilters(
                db("portfolio_snapshots"),
                filters
            )
                .orderBy("snapshot_time", "desc")
                .limit(limit);
            return rows.map((row) => this._mapSnapshotRow(row));
        } catch (error) {
            logger.error("Error reading portfolio history:", error);
            return [];
        }
    }

    async deleteByRunId(runId, filters = {}) {
        try {
            if (!runId) return 0;

            return await this._applyRuntimeFilters(db("portfolio_snapshots"), {
                ...filters,
                runId,
            }).del();
        } catch (error) {
            logger.error(
                `Error deleting portfolio snapshots for run ${runId}:`,
                error
            );
            throw error;
        }
    }

    async deleteByRuntimeFilters(filters = {}) {
        try {
            return await this._applyRuntimeFilters(
                db("portfolio_snapshots"),
                filters
            ).del();
        } catch (error) {
            logger.error(
                "Error deleting portfolio snapshots by runtime filters:",
                error
            );
            throw error;
        }
    }

    /**
     * Delete portfolio snapshots older than specified number of days
     * Snapshots are written every minute per active run and previously had
     * no retention at all; the daily sweep keeps this table bounded.
     * Returns 0 on error (never throws) so the sweep continues.
     * @param {number} days - Delete snapshots older than this many days
     * @returns {number} - Number of deleted records
     */
    async deleteOlderThan(days) {
        try {
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const deleted = await db("portfolio_snapshots")
                .where("snapshot_time", "<", cutoff)
                .del();
            if (deleted > 0) {
                logger.info(
                    `Cleaned up ${deleted} portfolio snapshots older than ${days} days`
                );
            }
            return deleted;
        } catch (error) {
            logger.error("Error deleting old portfolio snapshots:", error);
            return 0;
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
            runId: null,
            selectionId: null,
            mode: "live",
            strategy: null,
        };
    }
}

module.exports = PortfolioRepository;
