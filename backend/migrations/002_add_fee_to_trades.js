/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    // This function is called when you run 'knex migrate:latest'
    await knex.schema.alterTable("trades", (table) => {
        // Add the new column for storing fees.
        // It's safe to add to an existing table.
        table
            .decimal("fee_usdt_value", 18, 8)
            .defaultTo(0)
            .after("total_value");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    // This function is called when you roll back a migration
    await knex.schema.alterTable("trades", (table) => {
        table.dropColumn("fee_usdt_value");
    });
};
