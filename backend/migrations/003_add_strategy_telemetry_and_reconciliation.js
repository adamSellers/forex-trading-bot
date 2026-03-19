/**
 * Add structured signal telemetry and trade reconciliation columns.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.alterTable("signals", (table) => {
        table.string("reason_code").nullable();
        table.string("signal_class").nullable();
        table.string("intent").nullable();
        table.string("setup_id").nullable();
        table.bigInteger("signal_candle_time").nullable();
        table.boolean("unique_event").nullable();
        table.boolean("cooldown_suppressed").nullable();
        table.string("pending_direction").nullable();
        table.string("pending_state").nullable();
        table.string("pending_waiting_for").nullable();
        table.string("config_hash").nullable();
        table.json("decision_context").nullable();

        table.index(["signal_class", "timestamp"]);
        table.index(["reason_code", "timestamp"]);
        table.index(["setup_id", "timestamp"]);
        table.index(["config_hash", "timestamp"]);
    });

    await knex.schema.alterTable("trades", (table) => {
        table.decimal("lowest_price", 18, 6).nullable();
        table.boolean("breakeven_hit").nullable();
        table.string("active_stop_type").nullable();
        table.string("close_price_source").nullable();
        table.string("reconciliation_status").nullable();
        table.string("broker_exit_reason").nullable();
        table.bigInteger("broker_closed_at").nullable();
        table.bigInteger("last_broker_sync_at").nullable();
        table.string("config_hash").nullable();
        table.json("broker_reconciliation_payload").nullable();

        table.index(["reconciliation_status", "entry_time"]);
        table.index(["config_hash", "entry_time"]);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.alterTable("trades", (table) => {
        table.dropIndex(["reconciliation_status", "entry_time"]);
        table.dropIndex(["config_hash", "entry_time"]);
        table.dropColumn("broker_reconciliation_payload");
        table.dropColumn("config_hash");
        table.dropColumn("last_broker_sync_at");
        table.dropColumn("broker_closed_at");
        table.dropColumn("broker_exit_reason");
        table.dropColumn("reconciliation_status");
        table.dropColumn("close_price_source");
        table.dropColumn("active_stop_type");
        table.dropColumn("breakeven_hit");
        table.dropColumn("lowest_price");
    });

    await knex.schema.alterTable("signals", (table) => {
        table.dropIndex(["signal_class", "timestamp"]);
        table.dropIndex(["reason_code", "timestamp"]);
        table.dropIndex(["setup_id", "timestamp"]);
        table.dropIndex(["config_hash", "timestamp"]);
        table.dropColumn("decision_context");
        table.dropColumn("config_hash");
        table.dropColumn("pending_waiting_for");
        table.dropColumn("pending_state");
        table.dropColumn("pending_direction");
        table.dropColumn("cooldown_suppressed");
        table.dropColumn("unique_event");
        table.dropColumn("signal_candle_time");
        table.dropColumn("setup_id");
        table.dropColumn("intent");
        table.dropColumn("signal_class");
        table.dropColumn("reason_code");
    });
};
