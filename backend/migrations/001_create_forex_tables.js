/**
 * Forex Trading Bot - Initial Database Schema
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    // 1. Trades Table - Forex specific with pip-based fields
    await knex.schema.createTable("trades", (table) => {
        table.increments("id").primary();
        table.string("trade_id").unique().notNullable();
        table.string("oanda_trade_id").nullable(); // Oanda's trade ID
        table.string("instrument").notNullable(); // e.g., "AUD_USD"
        table.string("side").notNullable(); // BUY or SELL

        // Position sizing
        table.decimal("units", 18, 4).notNullable(); // Forex uses units, not quantity
        table.decimal("entry_price", 18, 6).notNullable(); // More decimal places for Forex
        table.decimal("exit_price", 18, 6).nullable();

        // Forex-specific: costs in account currency (AUD)
        table.decimal("entry_cost_aud", 18, 2).notNullable();
        table.decimal("exit_value_aud", 18, 2).nullable();

        // PnL
        table.decimal("pnl_aud", 18, 2).defaultTo(0); // PnL in account currency
        table.decimal("pnl_pips", 18, 2).defaultTo(0); // PnL in pips
        table.decimal("pnl_percent", 8, 4).defaultTo(0);

        // Signal info
        table.string("signal").nullable();
        table.decimal("signal_strength", 8, 4).nullable();
        table.string("entry_type").nullable(); // FRESH_FLIP or CONTINUATION

        // ATR in pips for Forex
        table.decimal("atr_pips", 18, 2).nullable();

        // Stop loss / Take profit in price
        table.decimal("stop_loss_price", 18, 6).nullable();
        table.decimal("take_profit_price", 18, 6).nullable();

        // Trailing stop
        table.decimal("trailing_stop_price", 18, 6).nullable();
        table.decimal("highest_price", 18, 6).nullable();
        table.decimal("trailing_stop_pips", 18, 2).nullable();

        // Leverage info
        table.decimal("leverage_used", 8, 2).defaultTo(1);
        table.decimal("margin_used_aud", 18, 2).nullable();

        // Costs (spread is built into Forex pricing)
        table.decimal("spread_pips", 18, 2).nullable();
        table.decimal("swap_aud", 18, 4).defaultTo(0); // Overnight interest
        table.decimal("commission_aud", 18, 4).defaultTo(0); // Usually 0 for Oanda

        // Timing
        table.bigInteger("holding_period_ms").nullable();
        table.bigInteger("entry_time").notNullable();
        table.bigInteger("exit_time").nullable();

        // Status
        table.string("exit_reason").nullable();
        table.string("mode").notNullable().defaultTo("live");
        table.boolean("is_open").defaultTo(true);

        // Timestamps
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("updated_at").defaultTo(knex.fn.now());

        // Indexes
        table.index(["instrument", "entry_time"]);
        table.index("trade_id");
        table.index("oanda_trade_id");
        table.index("created_at");
        table.index("side");
        table.index("mode");
        table.index("is_open");
    });

    // 2. Signals Table
    await knex.schema.createTable("signals", (table) => {
        table.increments("id").primary();
        table.string("instrument").notNullable();
        table.string("signal").notNullable();
        table.decimal("strength", 8, 4).notNullable(); // ADX value
        table.string("strategy").notNullable();
        table.string("timeframe").notNullable();
        table.decimal("price", 18, 6).nullable();
        table.text("message").nullable();
        table.decimal("atr_pips", 18, 2).nullable();
        table.decimal("rsi", 8, 2).nullable();
        table.decimal("adx", 8, 2).nullable();
        table.integer("supertrend_direction").nullable();
        table.string("entry_type").nullable();
        table.bigInteger("timestamp").notNullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());

        table.index(["instrument", "timestamp"]);
        table.index(["signal", "timestamp"]);
        table.index(["strategy", "timestamp"]);
    });

    // 3. Portfolio Snapshots Table
    await knex.schema.createTable("portfolio_snapshots", (table) => {
        table.increments("id").primary();
        table.decimal("total_value_aud", 18, 2).notNullable();
        table.decimal("balance_aud", 18, 2).notNullable();
        table.decimal("unrealized_pnl_aud", 18, 2).defaultTo(0);
        table.decimal("realized_pnl_aud", 18, 2).defaultTo(0);
        table.decimal("margin_used_aud", 18, 2).defaultTo(0);
        table.decimal("margin_available_aud", 18, 2).defaultTo(0);
        table.json("positions").nullable();
        table.integer("position_count").defaultTo(0);
        table.decimal("exposure_percent", 5, 2).defaultTo(0);
        table.bigInteger("snapshot_time").notNullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());

        table.index("snapshot_time");
    });

    // 4. Performance Metrics Table
    await knex.schema.createTable("performance", (table) => {
        table.increments("id").primary();
        table.integer("total_trades").defaultTo(0);
        table.integer("winning_trades").defaultTo(0);
        table.integer("losing_trades").defaultTo(0);
        table.decimal("win_rate", 5, 2).defaultTo(0);
        table.decimal("avg_win_aud", 18, 2).defaultTo(0);
        table.decimal("avg_loss_aud", 18, 2).defaultTo(0);
        table.decimal("avg_win_pips", 18, 2).defaultTo(0);
        table.decimal("avg_loss_pips", 18, 2).defaultTo(0);
        table.decimal("profit_factor", 8, 2).defaultTo(0);
        table.decimal("sharpe_ratio", 8, 2).defaultTo(0);
        table.decimal("max_drawdown_percent", 5, 2).defaultTo(0);
        table.decimal("current_drawdown_percent", 5, 2).defaultTo(0);
        table.decimal("total_pnl_aud", 18, 2).defaultTo(0);
        table.decimal("total_pnl_pips", 18, 2).defaultTo(0);
        table.decimal("total_swap_aud", 18, 4).defaultTo(0);
        table.bigInteger("avg_holding_period_ms").defaultTo(0);
        table.decimal("best_trade_aud", 18, 2).defaultTo(0);
        table.decimal("worst_trade_aud", 18, 2).defaultTo(0);
        table.bigInteger("calculated_at").notNullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());

        table.index("calculated_at");
    });

    // 5. Trading Config Table (persisted settings)
    await knex.schema.createTable("trading_config", (table) => {
        table.increments("id").primary();
        table.string("config_name").unique().notNullable();
        table.json("config_value").notNullable();
        table.timestamp("updated_at").defaultTo(knex.fn.now());
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("trading_config");
    await knex.schema.dropTableIfExists("performance");
    await knex.schema.dropTableIfExists("portfolio_snapshots");
    await knex.schema.dropTableIfExists("signals");
    await knex.schema.dropTableIfExists("trades");
};
