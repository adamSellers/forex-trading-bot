const { db } = require("../../config/database");
const logger = require("../utils/logger");

class StrategyRunRepository {
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
            logger.warn("Failed to parse strategy run JSON payload");
            return null;
        }
    }

    _applyFilters(query, filters = {}) {
        const {
            mode,
            strategy,
            status,
            statuses,
            runId,
            selectionId,
            shadowOfRunId,
            parentRunId,
        } = filters || {};

        if (mode) {
            query.where("mode", mode);
        }
        if (strategy) {
            query.where("strategy", strategy);
        }
        if (status) {
            query.where("status", status);
        }
        if (Array.isArray(statuses) && statuses.length > 0) {
            query.whereIn("status", statuses);
        }
        if (runId) {
            query.where("run_id", runId);
        }
        if (selectionId) {
            query.where("selection_id", selectionId);
        }
        if (shadowOfRunId) {
            query.where("shadow_of_run_id", shadowOfRunId);
        }
        if (parentRunId) {
            query.where("parent_run_id", parentRunId);
        }

        return query;
    }

    _mapRow(row) {
        if (!row) return null;

        return {
            id: row.id,
            runId: row.run_id,
            mode: row.mode,
            strategy: row.strategy,
            status: row.status,
            selectionId: row.selection_id,
            shadowOfRunId: row.shadow_of_run_id,
            parentRunId: row.parent_run_id || null,
            configHash: row.config_hash,
            configSnapshot: this._parseJson(row.config_snapshot),
            startedAt: Number(row.started_at),
            stoppedAt:
                row.stopped_at === null || row.stopped_at === undefined
                    ? null
                    : Number(row.stopped_at),
            metadata: this._parseJson(row.metadata),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    _buildRecord(run = {}) {
        return {
            run_id: run.runId,
            mode: run.mode,
            strategy: run.strategy,
            status: run.status,
            selection_id: run.selectionId || null,
            shadow_of_run_id: run.shadowOfRunId || null,
            parent_run_id: run.parentRunId || null,
            config_hash: run.configHash || null,
            config_snapshot: this._serializeJson(run.configSnapshot),
            started_at: run.startedAt || Date.now(),
            stopped_at: run.stoppedAt ?? null,
            metadata: this._serializeJson(run.metadata),
            created_at: new Date(),
            updated_at: new Date(),
        };
    }

    async create(run = {}) {
        await db("strategy_runs").insert(this._buildRecord(run));
        return this.getByRunId(run.runId);
    }

    async update(runId, updates = {}) {
        if (!runId) return null;

        const immutableKeys = [
            "mode",
            "strategy",
            "selectionId",
            "shadowOfRunId",
            "parentRunId",
            "configHash",
            "configSnapshot",
            "startedAt",
        ];
        const attemptedImmutableKeys = immutableKeys.filter(
            (key) => updates[key] !== undefined
        );
        if (attemptedImmutableKeys.length > 0) {
            const error = new Error(
                `Strategy run identity is immutable: ${attemptedImmutableKeys.join(
                    ", "
                )}`
            );
            error.code = "IMMUTABLE_STRATEGY_RUN";
            throw error;
        }

        const dbUpdates = {
            updated_at: new Date(),
        };

        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.stoppedAt !== undefined) dbUpdates.stopped_at = updates.stoppedAt;
        if (updates.metadata !== undefined) {
            dbUpdates.metadata = this._serializeJson(updates.metadata);
        }

        await db("strategy_runs").where("run_id", runId).update(dbUpdates);
        return this.getByRunId(runId);
    }

    async getByRunId(runId) {
        const row = await db("strategy_runs").where("run_id", runId).first();
        return this._mapRow(row);
    }

    async list(filters = {}) {
        const rows = await this._applyFilters(db("strategy_runs"), filters)
            .orderBy("started_at", "desc");
        return rows.map((row) => this._mapRow(row));
    }
}

module.exports = StrategyRunRepository;
