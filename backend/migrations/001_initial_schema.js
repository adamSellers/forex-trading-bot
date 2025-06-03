export const up = async (knex) => {
    // Trades table
    await knex.schema.createTable("trades", (table) => {
        table.increments("id").primary();
        table.string("symbol").notNullable();
        table.string("side").notNullable(); // 'BUY' or 'SELL'
        table.decimal("quantity", 18, 8).notNullable();
        table.decimal("price", 18, 8).notNullable();
        table.decimal("total", 18, 8).notNullable();
        table.string("strategy").notNullable();
        table.string("order_id").nullable();
        table.string("status").defaultTo("PENDING");
        table.timestamp("created_at").defaultTo(knex.fn.now());
        table.timestamp("executed_at").nullable();
    });

    // Portfolio table
    await knex.schema.createTable("portfolio", (table) => {
        table.increments("id").primary();
        table.string("symbol").notNullable().unique();
        table.decimal("quantity", 18, 8).defaultTo(0);
        table.decimal("avg_price", 18, 8).defaultTo(0);
        table.decimal("total_invested", 18, 8).defaultTo(0);
        table.timestamp("updated_at").defaultTo(knex.fn.now());
    });

    // Performance metrics table
    await knex.schema.createTable("performance", (table) => {
        table.increments("id").primary();
        table.date("date").notNullable().unique();
        table.decimal("portfolio_value", 18, 8).notNullable();
        table.decimal("daily_pnl", 18, 8).defaultTo(0);
        table.decimal("total_pnl", 18, 8).defaultTo(0);
        table.integer("trades_count").defaultTo(0);
        table.decimal("win_rate", 5, 2).defaultTo(0);
    });

    // Trading signals table
    await knex.schema.createTable("signals", (table) => {
        table.increments("id").primary();
        table.string("symbol").notNullable();
        table.string("signal_type").notNullable(); // 'BUY', 'SELL', 'HOLD'
        table.string("strategy").notNullable();
        table.decimal("price", 18, 8).notNullable();
        table.decimal("ma_fast", 18, 8).nullable();
        table.decimal("ma_slow", 18, 8).nullable();
        table.decimal("strength", 5, 2).defaultTo(0);
        table.boolean("executed").defaultTo(false);
        table.timestamp("created_at").defaultTo(knex.fn.now());
    });
};

export const down = async (knex) => {
    await knex.schema.dropTableIfExists("signals");
    await knex.schema.dropTableIfExists("performance");
    await knex.schema.dropTableIfExists("portfolio");
    await knex.schema.dropTableIfExists("trades");
};
