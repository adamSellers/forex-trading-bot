const { db } = require("../../config/database");
const logger = require("../utils/logger");

class EntryDecisionRepository {
    _toNumber(value) {
        if (value === null || value === undefined || value === "") {
            return value ?? null;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
    }

    _serializeJson(value) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return typeof value === "string" ? value : JSON.stringify(value);
    }

    _parseJson(value) {
        if (!value) return null;
        if (typeof value !== "string") return value;

        try {
            return JSON.parse(value);
        } catch (error) {
            logger.warn("Failed to parse entry decision JSON payload");
            return null;
        }
    }

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

    _buildRecord(decision) {
        return {
            decision_id: decision.decisionId,
            setup_id: decision.setupId || null,
            signal_candle_time:
                decision.signalCandleTime === undefined ||
                decision.signalCandleTime === null
                    ? null
                    : Number(decision.signalCandleTime),
            decision_time: decision.decisionTime || Date.now(),
            instrument: decision.instrument,
            side: decision.side,
            signal: decision.signal,
            entry_type: decision.entryType || null,
            config_hash: decision.configHash || null,
            config_snapshot: this._serializeJson(decision.configSnapshot),
            outcome: decision.outcome || "PENDING",
            stage: decision.stage || "RECEIVED",
            rejection_code: decision.rejectionCode || null,
            rejection_reason: decision.rejectionReason || null,
            spread_pips:
                decision.spreadPips === undefined ? null : decision.spreadPips,
            price_age_ms:
                decision.priceAgeMs === undefined ? null : decision.priceAgeMs,
            open_positions:
                decision.openPositions === undefined
                    ? null
                    : decision.openPositions,
            projected_exposure:
                decision.projectedExposure === undefined
                    ? null
                    : decision.projectedExposure,
            signal_strength:
                decision.signalStrength === undefined
                    ? null
                    : decision.signalStrength,
            adx: decision.adx === undefined ? null : decision.adx,
            rsi: decision.rsi === undefined ? null : decision.rsi,
            atr_pips:
                decision.atrPips === undefined ? null : decision.atrPips,
            trade_id: decision.tradeId || null,
            run_id: decision.runId || null,
            selection_id: decision.selectionId || null,
            mode: decision.mode || "live",
            strategy: decision.strategy || null,
            timesfm_context: this._serializeJson(decision.timesFmContext),
            created_at: new Date(),
            updated_at: new Date(),
        };
    }

    _mapRow(row) {
        if (!row) return null;

        return {
            id: row.id,
            decisionId: row.decision_id,
            setupId: row.setup_id,
            signalCandleTime: this._toNumber(row.signal_candle_time),
            decisionTime: this._toNumber(row.decision_time),
            instrument: row.instrument,
            side: row.side,
            signal: row.signal,
            entryType: row.entry_type,
            configHash: row.config_hash,
            configSnapshot: this._parseJson(row.config_snapshot),
            outcome: row.outcome,
            stage: row.stage,
            rejectionCode: row.rejection_code,
            rejectionReason: row.rejection_reason,
            spreadPips: this._toNumber(row.spread_pips),
            priceAgeMs: this._toNumber(row.price_age_ms),
            openPositions: this._toNumber(row.open_positions),
            projectedExposure: this._toNumber(row.projected_exposure),
            signalStrength: this._toNumber(row.signal_strength),
            adx: this._toNumber(row.adx),
            rsi: this._toNumber(row.rsi),
            atrPips: this._toNumber(row.atr_pips),
            tradeId: row.trade_id,
            runId: row.run_id,
            selectionId: row.selection_id,
            mode: row.mode || "live",
            strategy: row.strategy,
            timesFmContext: this._parseJson(row.timesfm_context),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async save(decision) {
        try {
            if (
                !decision?.decisionId ||
                !decision?.instrument ||
                !decision?.side ||
                !decision?.signal
            ) {
                logger.warn("Invalid entry decision data, skipping save");
                return null;
            }

            await db("entry_decisions").insert(this._buildRecord(decision));
            return decision;
        } catch (error) {
            logger.error("Error saving entry decision:", error);
            throw error;
        }
    }

    async updateDecision(decisionId, updates) {
        try {
            if (!decisionId) return;

            const dbUpdates = {
                updated_at: new Date(),
            };

            if (updates.setupId !== undefined) dbUpdates.setup_id = updates.setupId;
            if (updates.signalCandleTime !== undefined) {
                dbUpdates.signal_candle_time =
                    updates.signalCandleTime === null
                        ? null
                        : Number(updates.signalCandleTime);
            }
            if (updates.decisionTime !== undefined) {
                dbUpdates.decision_time = updates.decisionTime;
            }
            if (updates.entryType !== undefined) dbUpdates.entry_type = updates.entryType;
            if (updates.configHash !== undefined) dbUpdates.config_hash = updates.configHash;
            if (updates.configSnapshot !== undefined) {
                dbUpdates.config_snapshot = this._serializeJson(
                    updates.configSnapshot
                );
            }
            if (updates.outcome !== undefined) dbUpdates.outcome = updates.outcome;
            if (updates.stage !== undefined) dbUpdates.stage = updates.stage;
            if (updates.rejectionCode !== undefined) {
                dbUpdates.rejection_code = updates.rejectionCode;
            }
            if (updates.rejectionReason !== undefined) {
                dbUpdates.rejection_reason = updates.rejectionReason;
            }
            if (updates.spreadPips !== undefined) dbUpdates.spread_pips = updates.spreadPips;
            if (updates.priceAgeMs !== undefined) dbUpdates.price_age_ms = updates.priceAgeMs;
            if (updates.openPositions !== undefined) {
                dbUpdates.open_positions = updates.openPositions;
            }
            if (updates.projectedExposure !== undefined) {
                dbUpdates.projected_exposure = updates.projectedExposure;
            }
            if (updates.signalStrength !== undefined) {
                dbUpdates.signal_strength = updates.signalStrength;
            }
            if (updates.adx !== undefined) dbUpdates.adx = updates.adx;
            if (updates.rsi !== undefined) dbUpdates.rsi = updates.rsi;
            if (updates.atrPips !== undefined) dbUpdates.atr_pips = updates.atrPips;
            if (updates.tradeId !== undefined) dbUpdates.trade_id = updates.tradeId;
            if (updates.runId !== undefined) dbUpdates.run_id = updates.runId;
            if (updates.selectionId !== undefined) {
                dbUpdates.selection_id = updates.selectionId;
            }
            if (updates.mode !== undefined) dbUpdates.mode = updates.mode;
            if (updates.strategy !== undefined) dbUpdates.strategy = updates.strategy;
            if (updates.timesFmContext !== undefined) {
                dbUpdates.timesfm_context = this._serializeJson(
                    updates.timesFmContext
                );
            }

            if (Object.keys(dbUpdates).length <= 1) return;

            await db("entry_decisions")
                .where("decision_id", decisionId)
                .update(dbUpdates);
        } catch (error) {
            logger.error(`Error updating entry decision ${decisionId}:`, error);
            throw error;
        }
    }

    async getDecisionsSince(cutoffTime, filters = {}) {
        try {
            const timestamp =
                cutoffTime instanceof Date ? cutoffTime.getTime() : cutoffTime;
            const rows = await this._applyRuntimeFilters(
                db("entry_decisions").where("decision_time", ">=", timestamp),
                filters
            ).orderBy("decision_time", "desc");
            return rows.map((row) => this._mapRow(row));
        } catch (error) {
            logger.error("Error getting entry decisions since cutoff:", error);
            throw error;
        }
    }

    async deleteByRuntimeFilters(filters = {}) {
        try {
            return await this._applyRuntimeFilters(
                db("entry_decisions"),
                filters
            ).del();
        } catch (error) {
            logger.error(
                "Error deleting entry decisions by runtime filters:",
                error
            );
            throw error;
        }
    }
}

module.exports = EntryDecisionRepository;
