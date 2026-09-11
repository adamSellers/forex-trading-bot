// Keep the original price bound and the confirmed local outcome across restarts.
// Historical decisions remain non-reconsiderable; their missing quotes are unknown.
exports.up = async function (knex) {
    await knex.schema.alterTable("entry_decisions", (table) => {
        table.decimal("entry_reference_price", 18, 8).nullable();
        table.boolean("can_reconsider").notNullable().defaultTo(false);
        table.json("rejection_context").nullable();
        table.index(["run_id", "config_hash", "setup_id", "id"], "entry_setup_attempts_idx");
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("entry_decisions", (table) => {
        table.dropIndex([], "entry_setup_attempts_idx");
        table.dropColumn("entry_reference_price");
        table.dropColumn("can_reconsider");
        table.dropColumn("rejection_context");
    });
};
