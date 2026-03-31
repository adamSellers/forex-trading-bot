/**
 * Historical placeholder migration.
 *
 * The legacy offline backtest results table was retired in Phase 5. This file
 * now remains as a no-op so existing Knex migration history stays stable while
 * fresh databases avoid recreating the retired schema.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (_knex) {
    // No-op by design.
};

/**
 * Historical placeholder rollback.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (_knex) {
    // No-op by design.
};
