// backend/src/repositories/backtestRepository.js - CRUD for backtest results
// Stores and retrieves backtest run results from the backtest_results table
const { db } = require("../../config/database");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");

class BacktestRepository {
    /**
     * Save a backtest result to the database
     * @param {object} result - BacktestEngine result object { trades, summary, equityCurve, config }
     * @param {string} instrument
     * @param {string} granularity
     * @param {number} startDate - UNIX timestamp (seconds)
     * @param {number} endDate - UNIX timestamp (seconds)
     * @param {string} [label] - Optional user note
     * @returns {Promise<string>} backtestId
     */
    async save(result, instrument, granularity, startDate, endDate, label = null) {
        const backtestId = uuidv4();
        const { summary, config } = result;

        try {
            await db("backtest_results").insert({
                backtest_id: backtestId,
                instrument,
                granularity,
                start_date: startDate,
                end_date: endDate,
                total_trades: summary.totalTrades,
                winners: summary.winners,
                losers: summary.losers,
                win_rate: summary.winRate,
                total_pnl: summary.totalPnl,
                avg_win: summary.avgWin,
                avg_loss: summary.avgLoss,
                profit_factor: summary.profitFactor === Infinity ? 9999.99 : summary.profitFactor,
                max_drawdown_percent: summary.maxDrawdownPercent,
                avg_rr: summary.avgRR,
                expectancy: summary.expectancy,
                start_balance: summary.startBalance,
                end_balance: summary.endBalance,
                return_percent: summary.returnPercent,
                config: JSON.stringify(config),
                summary_by_entry_type: JSON.stringify(summary.byEntryType),
                summary_by_exit_reason: JSON.stringify(summary.byExitReason),
                trades_json: JSON.stringify(result.trades),
                equity_curve_json: JSON.stringify(result.equityCurve),
                label,
            });

            logger.info(`Backtest saved: ${backtestId} (${instrument} ${granularity}, ${summary.totalTrades} trades)`);
            return backtestId;
        } catch (error) {
            logger.error("Error saving backtest result:", error);
            throw error;
        }
    }

    /**
     * Get recent backtest results (summary only, excludes large JSON fields)
     * @param {number} limit
     * @param {string} [instrument] - Optional filter by instrument
     * @returns {Promise<Array>}
     */
    async getRecent(limit = 20, instrument = null) {
        try {
            let query = db("backtest_results")
                .select(
                    "backtest_id", "instrument", "granularity",
                    "start_date", "end_date", "total_trades",
                    "winners", "losers", "win_rate", "total_pnl",
                    "avg_win", "avg_loss", "profit_factor",
                    "max_drawdown_percent", "avg_rr", "expectancy",
                    "start_balance", "end_balance", "return_percent",
                    "label", "created_at"
                )
                .orderBy("created_at", "desc")
                .limit(limit);

            if (instrument) {
                query = query.where("instrument", instrument);
            }

            const rows = await query;
            return rows.map(this._mapToResult);
        } catch (error) {
            logger.error("Error fetching recent backtests:", error);
            throw error;
        }
    }

    /**
     * Get a single backtest result by ID (includes full trades and equity curve)
     * @param {string} backtestId
     * @returns {Promise<object|null>}
     */
    async getById(backtestId) {
        try {
            const row = await db("backtest_results")
                .where("backtest_id", backtestId)
                .first();

            if (!row) return null;

            const result = this._mapToResult(row);
            result.config = this._parseJson(row.config);
            result.summaryByEntryType = this._parseJson(row.summary_by_entry_type);
            result.summaryByExitReason = this._parseJson(row.summary_by_exit_reason);
            result.trades = this._parseJson(row.trades_json);
            result.equityCurve = this._parseJson(row.equity_curve_json);

            return result;
        } catch (error) {
            logger.error(`Error fetching backtest ${backtestId}:`, error);
            throw error;
        }
    }

    /**
     * Delete a backtest result by ID
     * @param {string} backtestId
     * @returns {Promise<boolean>}
     */
    async delete(backtestId) {
        try {
            const deleted = await db("backtest_results")
                .where("backtest_id", backtestId)
                .del();

            if (deleted > 0) {
                logger.info(`Backtest deleted: ${backtestId}`);
            }
            return deleted > 0;
        } catch (error) {
            logger.error(`Error deleting backtest ${backtestId}:`, error);
            throw error;
        }
    }

    /**
     * Delete backtest results older than N days
     * @param {number} days
     * @returns {Promise<number>} Number of rows deleted
     */
    async deleteOlderThan(days) {
        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);

            const deleted = await db("backtest_results")
                .where("created_at", "<", cutoff.toISOString())
                .del();

            if (deleted > 0) {
                logger.info(`Cleaned up ${deleted} backtest results older than ${days} days`);
            }
            return deleted;
        } catch (error) {
            logger.error("Error cleaning up old backtest results:", error);
            throw error;
        }
    }

    /**
     * Map a database row to a result object (snake_case → camelCase)
     */
    _mapToResult(row) {
        return {
            backtestId: row.backtest_id,
            instrument: row.instrument,
            granularity: row.granularity,
            startDate: row.start_date,
            endDate: row.end_date,
            totalTrades: row.total_trades,
            winners: row.winners,
            losers: row.losers,
            winRate: row.win_rate,
            totalPnl: row.total_pnl,
            avgWin: row.avg_win,
            avgLoss: row.avg_loss,
            profitFactor: row.profit_factor,
            maxDrawdownPercent: row.max_drawdown_percent,
            avgRR: row.avg_rr,
            expectancy: row.expectancy,
            startBalance: row.start_balance,
            endBalance: row.end_balance,
            returnPercent: row.return_percent,
            label: row.label,
            createdAt: row.created_at,
        };
    }

    _parseJson(str) {
        if (!str) return null;
        try {
            return JSON.parse(str);
        } catch {
            return null;
        }
    }
}

module.exports = BacktestRepository;
