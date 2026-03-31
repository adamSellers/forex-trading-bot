/**
 * Add shared strategy run registry and unified runtime identity columns.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.createTable("strategy_runs", (table) => {
        table.increments("id").primary();
        table.string("run_id").notNullable().unique();
        table.string("mode").notNullable();
        table.string("strategy").notNullable();
        table.string("status").notNullable();
        table.string("selection_id").nullable();
        table.string("shadow_of_run_id").nullable();
        table.string("config_hash").nullable();
        table.json("config_snapshot").nullable();
        table.bigInteger("started_at").notNullable();
        table.bigInteger("stopped_at").nullable();
        table.json("metadata").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.index(["mode", "started_at"]);
        table.index(["strategy", "started_at"]);
        table.index(["status", "started_at"]);
        table.index(["selection_id", "started_at"]);
        table.index(["shadow_of_run_id", "started_at"]);
        table.index(["config_hash", "started_at"]);
    });

    await knex.schema.alterTable("trades", (table) => {
        table.string("run_id").nullable();
        table.string("owner_run_id").nullable();
        table.string("selection_id").nullable();
        table.string("strategy").nullable();

        table.index(["run_id", "entry_time"]);
        table.index(["owner_run_id", "entry_time"]);
        table.index(["selection_id", "entry_time"]);
        table.index(["strategy", "entry_time"]);
    });

    await knex.schema.alterTable("signals", (table) => {
        table.string("run_id").nullable();
        table.string("selection_id").nullable();
        table.string("mode").nullable();

        table.index(["run_id", "timestamp"]);
        table.index(["selection_id", "timestamp"]);
        table.index(["mode", "timestamp"]);
    });

    await knex.schema.alterTable("entry_decisions", (table) => {
        table.string("run_id").nullable();
        table.string("selection_id").nullable();
        table.string("mode").nullable();
        table.string("strategy").nullable();

        table.index(["run_id", "decision_time"]);
        table.index(["selection_id", "decision_time"]);
        table.index(["mode", "decision_time"]);
        table.index(["strategy", "decision_time"]);
    });

    await knex.schema.alterTable("portfolio_snapshots", (table) => {
        table.string("run_id").nullable();
        table.string("selection_id").nullable();
        table.string("mode").nullable().defaultTo("live");
        table.string("strategy").nullable();

        table.index(["run_id", "snapshot_time"]);
        table.index(["selection_id", "snapshot_time"]);
        table.index(["mode", "snapshot_time"]);
        table.index(["strategy", "snapshot_time"]);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.alterTable("portfolio_snapshots", (table) => {
        table.dropIndex(["strategy", "snapshot_time"]);
        table.dropIndex(["mode", "snapshot_time"]);
        table.dropIndex(["selection_id", "snapshot_time"]);
        table.dropIndex(["run_id", "snapshot_time"]);
        table.dropColumn("strategy");
        table.dropColumn("mode");
        table.dropColumn("selection_id");
        table.dropColumn("run_id");
    });

    await knex.schema.alterTable("entry_decisions", (table) => {
        table.dropIndex(["strategy", "decision_time"]);
        table.dropIndex(["mode", "decision_time"]);
        table.dropIndex(["selection_id", "decision_time"]);
        table.dropIndex(["run_id", "decision_time"]);
        table.dropColumn("strategy");
        table.dropColumn("mode");
        table.dropColumn("selection_id");
        table.dropColumn("run_id");
    });

    await knex.schema.alterTable("signals", (table) => {
        table.dropIndex(["mode", "timestamp"]);
        table.dropIndex(["selection_id", "timestamp"]);
        table.dropIndex(["run_id", "timestamp"]);
        table.dropColumn("mode");
        table.dropColumn("selection_id");
        table.dropColumn("run_id");
    });

    await knex.schema.alterTable("trades", (table) => {
        table.dropIndex(["strategy", "entry_time"]);
        table.dropIndex(["selection_id", "entry_time"]);
        table.dropIndex(["owner_run_id", "entry_time"]);
        table.dropIndex(["run_id", "entry_time"]);
        table.dropColumn("strategy");
        table.dropColumn("selection_id");
        table.dropColumn("owner_run_id");
        table.dropColumn("run_id");
    });

    await knex.schema.dropTableIfExists("strategy_runs");
};
