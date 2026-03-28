/**
 * Add entry decision funnel tracking for live execution analysis.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.createTable("entry_decisions", (table) => {
        table.increments("id").primary();
        table.string("decision_id").notNullable().unique();
        table.string("setup_id").nullable();
        table.bigInteger("signal_candle_time").nullable();
        table.bigInteger("decision_time").notNullable();
        table.string("instrument").notNullable();
        table.string("side").notNullable();
        table.string("signal").notNullable();
        table.string("entry_type").nullable();
        table.string("config_hash").nullable();
        table.json("config_snapshot").nullable();
        table.string("outcome").notNullable().defaultTo("PENDING");
        table.string("stage").notNullable().defaultTo("RECEIVED");
        table.string("rejection_code").nullable();
        table.text("rejection_reason").nullable();
        table.decimal("spread_pips", 18, 2).nullable();
        table.bigInteger("price_age_ms").nullable();
        table.integer("open_positions").nullable();
        table.decimal("projected_exposure", 10, 4).nullable();
        table.decimal("signal_strength", 8, 4).nullable();
        table.decimal("adx", 8, 4).nullable();
        table.decimal("rsi", 8, 4).nullable();
        table.decimal("atr_pips", 18, 4).nullable();
        table.string("trade_id").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.index(["decision_time"]);
        table.index(["instrument", "decision_time"]);
        table.index(["config_hash", "decision_time"]);
        table.index(["outcome", "decision_time"]);
        table.index(["stage", "decision_time"]);
        table.index(["rejection_code", "decision_time"]);
        table.index(["trade_id", "decision_time"]);
        table.index(["setup_id", "decision_time"]);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("entry_decisions");
};
