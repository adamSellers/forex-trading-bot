/**
 * Add TimesFM forecast context to signals and entry decisions.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.alterTable("signals", (table) => {
        table.json("timesfm_context").nullable();
    });

    await knex.schema.alterTable("entry_decisions", (table) => {
        table.json("timesfm_context").nullable();
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.alterTable("entry_decisions", (table) => {
        table.dropColumn("timesfm_context");
    });

    await knex.schema.alterTable("signals", (table) => {
        table.dropColumn("timesfm_context");
    });
};
