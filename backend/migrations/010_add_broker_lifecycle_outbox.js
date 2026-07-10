/**
 * Durable broker order outbox and quarantine registry.
 *
 * The order intent is committed before a mutating Oanda request is sent. This
 * lets startup reconciliation prove whether an ambiguous request filled instead
 * of blindly retrying it and potentially doubling exposure.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.createTable("broker_order_intents", (table) => {
        table.increments("id").primary();
        table.string("intent_id").notNullable().unique();
        table.string("client_order_id").notNullable().unique();
        table.string("client_trade_id").notNullable().unique();
        table.string("decision_id").nullable();
        table.string("trade_id").nullable();
        table.string("broker_trade_id").nullable();
        table.string("broker_order_id").nullable();
        table.string("last_transaction_id").nullable();
        table.string("status").notNullable();
        table.string("instrument").notNullable();
        table.string("side").notNullable();
        table.decimal("units", 18, 4).notNullable();
        table.decimal("reference_price", 18, 8).nullable();
        table.decimal("final_quote", 18, 8).nullable();
        table.decimal("price_bound", 18, 8).nullable();
        table.integer("attempt_count").notNullable().defaultTo(0);
        table.bigInteger("next_retry_at").nullable();
        table.text("last_error").nullable();
        table.json("request_payload").nullable();
        table.json("response_payload").nullable();
        table.json("context_payload").nullable();
        table.bigInteger("created_at_ms").notNullable();
        table.bigInteger("submitted_at_ms").nullable();
        table.bigInteger("resolved_at_ms").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.index(["status", "created_at_ms"]);
        table.index(["broker_trade_id", "status"]);
        table.index(["instrument", "status"]);
        table.index(["decision_id", "created_at_ms"]);
    });

    await knex.schema.createTable("broker_position_quarantines", (table) => {
        table.increments("id").primary();
        table.string("broker_trade_id").notNullable().unique();
        table.string("intent_id").nullable();
        table.string("instrument").notNullable();
        table.string("side").nullable();
        table.decimal("units", 18, 4).nullable();
        table.string("status").notNullable().defaultTo("OPEN");
        table.string("reason").notNullable();
        table.json("broker_payload").nullable();
        table.bigInteger("first_seen_at").notNullable();
        table.bigInteger("last_seen_at").notNullable();
        table.bigInteger("resolved_at").nullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        table.index(["status", "last_seen_at"]);
        table.index(["instrument", "status"]);
        table.index(["intent_id", "status"]);
    });

    await knex.schema.createTable("broker_runtime_state", (table) => {
        table.string("state_key").primary();
        table.json("state_value").nullable();
        table.bigInteger("updated_at_ms").notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("broker_runtime_state");
    await knex.schema.dropTableIfExists("broker_position_quarantines");
    await knex.schema.dropTableIfExists("broker_order_intents");
};
