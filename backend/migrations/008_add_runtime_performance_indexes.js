/**
 * Add composite indexes for Pi-scale runtime reads.
 * These match the dashboard, paper comparison, analytics, and retention query shapes.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS signals_timestamp_index ON signals (timestamp)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS signals_mode_run_id_timestamp_index ON signals (mode, run_id, timestamp)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS signals_mode_strategy_timestamp_index ON signals (mode, strategy, timestamp)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS portfolio_snapshots_mode_run_id_snapshot_time_index ON portfolio_snapshots (mode, run_id, snapshot_time)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS trades_mode_entry_time_index ON trades (mode, entry_time)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS trades_mode_owner_run_id_is_open_entry_time_index ON trades (mode, owner_run_id, is_open, entry_time)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS trades_mode_owner_run_id_activity_index ON trades (mode, owner_run_id, COALESCE(exit_time, entry_time, 0) DESC)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS entry_decisions_mode_run_id_decision_time_index ON entry_decisions (mode, run_id, decision_time)"
    );
    await knex.raw(
        "CREATE INDEX IF NOT EXISTS strategy_runs_mode_strategy_status_started_at_index ON strategy_runs (mode, strategy, status, started_at)"
    );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.raw("DROP INDEX IF EXISTS strategy_runs_mode_strategy_status_started_at_index");
    await knex.raw("DROP INDEX IF EXISTS entry_decisions_mode_run_id_decision_time_index");
    await knex.raw("DROP INDEX IF EXISTS trades_mode_owner_run_id_activity_index");
    await knex.raw("DROP INDEX IF EXISTS trades_mode_owner_run_id_is_open_entry_time_index");
    await knex.raw("DROP INDEX IF EXISTS trades_mode_entry_time_index");
    await knex.raw("DROP INDEX IF EXISTS portfolio_snapshots_mode_run_id_snapshot_time_index");
    await knex.raw("DROP INDEX IF EXISTS signals_mode_strategy_timestamp_index");
    await knex.raw("DROP INDEX IF EXISTS signals_mode_run_id_timestamp_index");
    await knex.raw("DROP INDEX IF EXISTS signals_timestamp_index");
};
