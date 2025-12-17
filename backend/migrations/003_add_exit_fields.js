/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.alterTable("trades", (table) => {
        // Add missing columns in snake_case to match existing schema
        table.decimal("exit_price", 18, 8).nullable().after("entry_price");
        table.bigInteger("exit_time").nullable().after("holding_period");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.alterTable("trades", (table) => {
        table.dropColumn("exit_price");
        table.dropColumn("exit_time");
    });
};
