/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    // 1. Trades Table
    await knex.schema.createTable("trades", (table) => {
        table.increments("id").primary();
        table.string("trade_id").unique().notNullable();
        table.string("symbol").notNullable();
        table.string("side").notNullable(); // BUY or SELL
        table.decimal("quantity", 18, 8).notNullable();
        table.decimal("price", 18, 8).notNullable();
        table.decimal("total_value", 18, 8).notNullable(); // USDT amount
        table.decimal("pnl", 18, 8).defaultTo(0);
        table.decimal("pnl_percent", 8, 4).defaultTo(0);
        table.string("signal").nullable();
        table.decimal("signal_strength", 8, 4).nullable();
        table.decimal("atr", 18, 8).nullable();
        table.decimal("volatility_percent", 8, 4).nullable();
        table.decimal("stop_loss", 18, 8).nullable();
        table.decimal("entry_cost", 18, 8).nullable();
        table.decimal("entry_price", 18, 8).nullable();
        table.bigInteger("holding_period").nullable(); // Milliseconds
        table.string("exit_reason").nullable();
        table.string("mode").notNullable().defaultTo("paper");
        table.boolean("is_open").defaultTo(false);
        table.decimal("take_profit_price", 18, 8).nullable();
        table.decimal("trailing_stop_price", 18, 8).nullable();
        table.decimal("highest_price", 18, 8).nullable();
        table.decimal("trailing_stop_percent", 18, 8).nullable();
        table.timestamp("timestamp").notNullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());

        table.index(["symbol", "timestamp"]);
        table.index("trade_id");
        table.index("created_at");
        table.index("side");
        table.index("mode");
        table.index("is_open");
    });

    // 2. Signals Table
    await knex.schema.createTable("signals", (table) => {
        table.increments("id").primary();
        table.string("symbol").notNullable();
        table.string("signal").notNullable();
        table.decimal("strength", 8, 4).notNullable();
        table.string("strategy").notNullable();
        table.string("timeframe").notNullable();
        table.decimal("current_price", 18, 8).nullable();
        table.text("message").nullable();
        table.decimal("atr", 18, 8).nullable();
        table.json("trend_data").nullable();
        table.timestamp("timestamp").notNullable();
        table.timestamp("created_at").defaultTo(knex.fn.now());

        table.index(["symbol", "timestamp"]);
        table.index(["signal", "timestamp"]);
        table.index(["strategy", "timestamp"]);
    });

    // 3. Portfolio Table (Paper Trading Snapshots)
    await knex.schema.createTable("portfolio", (table) => {
        table.increments("id").primary();
        table.decimal("total_value", 18, 8).notNullable();
        table.decimal("usdt_balance", 18, 8).notNullable();
        table.decimal("crypto_value", 18, 8).defaultTo(0);
        table.decimal("total_pnl", 18, 8).defaultTo(0);
        table.decimal("daily_pnl", 18, 8).defaultTo(0);
        table.decimal("weekly_pnl", 18, 8).defaultTo(0);
        table.json("positions").nullable();
        table.integer("position_count").defaultTo(0);
        table.decimal("allocation_usdt_percent", 5, 2).defaultTo(0);
        table.decimal("allocation_crypto_percent", 5, 2).defaultTo(0);
        table.timestamp("snapshot_time").defaultTo(knex.fn.now());

        table.index("snapshot_time");
    });

    // 4. Performance Table
    await knex.schema.createTable("performance", (table) => {
        table.increments("id").primary();
        table.integer("total_trades").defaultTo(0);
        table.integer("winning_trades").defaultTo(0);
        table.integer("losing_trades").defaultTo(0);
        table.decimal("win_rate", 5, 2).defaultTo(0);
        table.decimal("avg_win_usdt", 18, 8).defaultTo(0);
        table.decimal("avg_loss_usdt", 18, 8).defaultTo(0);
        table.decimal("profit_factor", 8, 2).defaultTo(0);
        table.decimal("sharpe_ratio", 8, 2).defaultTo(0);
        table.decimal("max_drawdown", 5, 2).defaultTo(0);
        table.decimal("current_drawdown", 5, 2).defaultTo(0);
        table.decimal("total_fees_usdt", 18, 8).defaultTo(0);
        table.bigInteger("avg_holding_period").defaultTo(0);
        table.decimal("best_trade_usdt", 18, 8).defaultTo(0);
        table.decimal("worst_trade_usdt", 18, 8).defaultTo(0);
        table.timestamp("calculated_at").defaultTo(knex.fn.now());

        table.index("calculated_at");
    });

    // 5. Live Portfolio Snapshots Table
    await knex.schema.createTable("live_portfolio_snapshots", (table) => {
        table.increments("id").primary();
        table.decimal("total_value", 18, 8).notNullable();
        table.decimal("usdt_balance", 18, 8).notNullable();
        table.decimal("crypto_value", 18, 8).notNullable();
        table.decimal("total_pnl", 18, 8).notNullable();
        table.decimal("daily_pnl", 18, 8).notNullable();
        table.decimal("weekly_pnl", 18, 8).notNullable();
        table.json("positions").nullable();
        table.integer("position_count").notNullable();
        table.decimal("allocation_usdt_percent", 5, 2).nullable();
        table.decimal("allocation_crypto_percent", 5, 2).nullable();
        table.timestamp("snapshot_time").defaultTo(knex.fn.now());

        table.index("snapshot_time");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("live_portfolio_snapshots");
    await knex.schema.dropTableIfExists("performance");
    await knex.schema.dropTableIfExists("portfolio");
    await knex.schema.dropTableIfExists("signals");
    await knex.schema.dropTableIfExists("trades");
};
