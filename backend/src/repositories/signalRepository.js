// backend/src/repositories/signalRepository.js
const { db } = require("../../config/database");
const logger = require("../utils/logger");

class SignalRepository {
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

    _buildLegacySignalRecord(signal) {
        const trend = signal.trend || {};

        return {
            instrument: signal.symbol,
            signal: signal.signal,
            strength: signal.strength || 0,
            strategy: signal.strategy || "supertrend_momentum",
            timeframe: signal.timeframe || "15m",
            price: signal.currentPrice || null,
            message: signal.message || "",
            atr_pips: signal.atrPips || signal.atr || null,
            rsi: trend.rsi || null,
            adx: trend.adx || signal.strength || null,
            supertrend_direction: trend.supertrend_direction || null,
            entry_type: signal.entryType || null,
            timestamp: signal.timestamp || Date.now(),
        };
    }

    _isMissingColumnError(error) {
        const message = error?.message || "";
        return (
            message.includes("has no column named") ||
            message.includes("no such column")
        );
    }

    _buildSignalRecord(signal) {
        const trend = signal.trend || {};
        const decisionContext = signal.decisionContext || null;

        return {
            instrument: signal.symbol,
            signal: signal.signal,
            strength: signal.strength || 0,
            strategy: signal.strategy || "supertrend_momentum",
            timeframe: signal.timeframe || "15m",
            price: signal.currentPrice || null,
            message: signal.message || "",
            atr_pips: signal.atrPips || signal.atr || null,
            rsi: trend.rsi || null,
            adx: trend.adx || signal.strength || null,
            supertrend_direction: trend.supertrend_direction || null,
            entry_type: signal.entryType || null,
            timestamp: signal.timestamp || Date.now(),
            reason_code: signal.reasonCode || null,
            signal_class: signal.signalClass || null,
            intent: signal.intent || null,
            setup_id: signal.setupId || null,
            signal_candle_time: signal.signalCandleTime
                ? Number(signal.signalCandleTime)
                : null,
            unique_event:
                signal.uniqueEvent === undefined
                    ? null
                    : Boolean(signal.uniqueEvent),
            cooldown_suppressed:
                signal.cooldownSuppressed === undefined
                    ? null
                    : Boolean(signal.cooldownSuppressed),
            pending_direction:
                signal.pendingState?.direction ||
                signal.pendingEntry?.direction ||
                null,
            pending_state:
                signal.pendingState?.state ||
                signal.pendingEntry?.state ||
                null,
            pending_waiting_for:
                signal.pendingState?.waitingFor ||
                signal.pendingEntry?.waitingFor ||
                null,
            config_hash: signal.configHash || null,
            run_id: signal.runId || null,
            selection_id: signal.selectionId || null,
            mode: signal.mode || "live",
            decision_context: decisionContext
                ? JSON.stringify(decisionContext)
                : null,
        };
    }

    _mapRow(row) {
        return {
            ...row,
            symbol: row.instrument,
            reasonCode: row.reason_code,
            signalClass: row.signal_class,
            intent: row.intent,
            setupId: row.setup_id,
            signalCandleTime: row.signal_candle_time,
            uniqueEvent:
                row.unique_event === null || row.unique_event === undefined
                    ? null
                    : Boolean(row.unique_event),
            cooldownSuppressed:
                row.cooldown_suppressed === null ||
                row.cooldown_suppressed === undefined
                    ? null
                    : Boolean(row.cooldown_suppressed),
            pendingDirection: row.pending_direction,
            pendingStateCode: row.pending_state,
            pendingWaitingFor: row.pending_waiting_for,
            configHash: row.config_hash,
            runId: row.run_id,
            selectionId: row.selection_id,
            mode: row.mode || "live",
            pendingState:
                row.pending_state || row.pending_direction || row.pending_waiting_for
                    ? {
                          direction: row.pending_direction,
                          state: row.pending_state,
                          waitingFor: row.pending_waiting_for,
                      }
                    : null,
            decisionContext: row.decision_context
                ? typeof row.decision_context === "string"
                    ? JSON.parse(row.decision_context)
                    : row.decision_context
                : null,
        };
    }

    async save(signal) {
        try {
            if (!signal || !signal.symbol || !signal.signal) {
                logger.warn("Invalid signal data, skipping save");
                return;
            }

            try {
                await db("signals").insert(this._buildSignalRecord(signal));
            } catch (error) {
                if (!this._isMissingColumnError(error)) {
                    throw error;
                }

                await db("signals").insert(this._buildLegacySignalRecord(signal));
            }

            logger.debug(
                "Signal saved to database:",
                signal.symbol,
                signal.signal
            );
        } catch (error) {
            logger.error("Error saving signal:", error);
            // Don't throw - continue operation without database
        }
    }

    async saveBatch(signals) {
        try {
            const validSignals = signals.filter(
                (signal) => signal && signal.symbol && signal.signal
            );

            if (validSignals.length === 0) {
                logger.warn("No valid signals to save");
                return;
            }

            const signalRecords = validSignals.map((signal) =>
                this._buildSignalRecord(signal)
            );

            try {
                await db("signals").insert(signalRecords);
            } catch (error) {
                if (!this._isMissingColumnError(error)) {
                    throw error;
                }

                const legacyRecords = validSignals.map((signal) =>
                    this._buildLegacySignalRecord(signal)
                );
                await db("signals").insert(legacyRecords);
            }
            logger.debug(`${signalRecords.length} signals saved to database`);
        } catch (error) {
            logger.error("Error saving signal batch:", error);
            // Don't throw - continue operation without database
        }
    }

    async getRecent(limit = 50, filters = {}) {
        try {
            const rows = await this._applyRuntimeFilters(db("signals"), filters)
                .orderBy("timestamp", "desc")
                .limit(limit);
            return rows.map((row) => this._mapRow(row));
        } catch (error) {
            logger.error("Error getting recent signals:", error);
            return [];
        }
    }

    async getBySymbol(symbol, limit = 50, filters = {}) {
        try {
            const rows = await this._applyRuntimeFilters(
                db("signals").where("instrument", symbol),
                filters
            )
                .orderBy("timestamp", "desc")
                .limit(limit);
            return rows.map((row) => this._mapRow(row));
        } catch (error) {
            logger.error("Error getting signals by symbol:", error);
            return [];
        }
    }

    async getSignalsSince(cutoffTime, filters = {}) {
        try {
            const timestamp =
                cutoffTime instanceof Date ? cutoffTime.getTime() : cutoffTime;
            const rows = await this._applyRuntimeFilters(
                db("signals").where("timestamp", ">=", timestamp),
                filters
            ).orderBy("timestamp", "desc");
            return rows.map((row) => this._mapRow(row));
        } catch (error) {
            logger.error("Error getting signals since cutoff:", error);
            throw error;
        }
    }

    /**
     * Delete signals older than specified number of days
     * Used for retention policy to keep signals table bounded
     * @param {number} days - Delete signals older than this many days
     * @returns {number} - Number of deleted records
     */
    async deleteOlderThan(days) {
        try {
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const deleted = await db("signals").where("timestamp", "<", cutoff).del();
            if (deleted > 0) {
                logger.info(`Cleaned up ${deleted} signals older than ${days} days`);
            }
            return deleted;
        } catch (error) {
            logger.error("Error deleting old signals:", error);
            return 0;
        }
    }

    async deleteByRunId(runId, filters = {}) {
        try {
            if (!runId) return 0;

            return await this._applyRuntimeFilters(db("signals"), {
                ...filters,
                runId,
            }).del();
        } catch (error) {
            logger.error(`Error deleting signals for run ${runId}:`, error);
            throw error;
        }
    }

    async getSignalStats(period = "24h") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            const rows = await db("signals").where(
                "timestamp",
                ">=",
                cutoffTime
            );
            const signals = rows.map((row) => this._mapRow(row));

            return this.calculateSignalStats(signals);
        } catch (error) {
            logger.error("Error getting signal stats:", error);
            return null;
        }
    }

    parsePeriod(period) {
        const periods = {
            "1h": 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
        };
        return periods[period] || periods["24h"];
    }

    calculateSignalStats(signals) {
        const stats = {
            total: signals.length,
            byType: {},
            byAsset: {},
            averageStrength: 0,
        };

        let totalStrength = 0;

        signals.forEach((signal) => {
            // Count by signal type
            stats.byType[signal.signal] =
                (stats.byType[signal.signal] || 0) + 1;

            // Count by asset
            stats.byAsset[signal.symbol] =
                (stats.byAsset[signal.symbol] || 0) + 1;

            // Sum strength
            totalStrength += signal.strength || 0;
        });

        stats.averageStrength =
            signals.length > 0 ? totalStrength / signals.length : 0;

        return stats;
    }
}

module.exports = SignalRepository;
