/**
 * Preserve immutable experiment lineage when a paper run is restarted.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.alterTable("strategy_runs", (table) => {
        table.string("parent_run_id").nullable();
        table.index(["parent_run_id", "started_at"]);
    });
};

/** @param { import("knex").Knex } knex */
exports.down = async function (knex) {
    await knex.schema.alterTable("strategy_runs", (table) => {
        table.dropIndex(["parent_run_id", "started_at"]);
        table.dropColumn("parent_run_id");
    });
};
