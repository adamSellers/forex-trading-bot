/**
 * Backtest Results Table - Stores backtest run results for comparison
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.createTable("backtest_results", (table) => {
        table.increments("id").primary();
        table.string("backtest_id").unique().notNullable();
        table.string("instrument").notNullable();
        table.string("granularity").notNullable();
        table.bigInteger("start_date").notNullable();
        table.bigInteger("end_date").notNullable();

        // Summary stats
        table.integer("total_trades").defaultTo(0);
        table.integer("winners").defaultTo(0);
        table.integer("losers").defaultTo(0);
        table.decimal("win_rate", 5, 2).defaultTo(0);
        table.decimal("total_pnl", 18, 2).defaultTo(0);
        table.decimal("avg_win", 18, 2).defaultTo(0);
        table.decimal("avg_loss", 18, 2).defaultTo(0);
        table.decimal("profit_factor", 8, 2).defaultTo(0);
        table.decimal("max_drawdown_percent", 5, 2).defaultTo(0);
        table.decimal("avg_rr", 8, 2).defaultTo(0);
        table.decimal("expectancy", 18, 4).defaultTo(0);
        table.decimal("start_balance", 18, 2).defaultTo(500);
        table.decimal("end_balance", 18, 2).defaultTo(500);
        table.decimal("return_percent", 8, 2).defaultTo(0);

        // Detailed data (JSON blobs)
        table.json("config").nullable();
        table.json("summary_by_entry_type").nullable();
        table.json("summary_by_exit_reason").nullable();
        table.text("trades_json").nullable();
        table.text("equity_curve_json").nullable();

        // User annotation
        table.string("label").nullable();

        table.timestamp("created_at").defaultTo(knex.fn.now());

        // Indexes
        table.index("backtest_id");
        table.index("instrument");
        table.index("created_at");
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists("backtest_results");
};
