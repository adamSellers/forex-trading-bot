// Test database helper - creates in-memory SQLite for isolated testing
const knex = require('knex');

/**
 * Create a fresh in-memory test database
 */
const createTestDb = async () => {
    const db = knex({
        client: 'better-sqlite3',
        connection: {
            filename: ':memory:',
        },
        useNullAsDefault: true,
    });

    // Run migrations to create schema
    await runMigrations(db);

    return db;
};

/**
 * Run database migrations
 */
const runMigrations = async (db) => {
    // Create trades table
    await db.schema.createTable('trades', (table) => {
        table.increments('id').primary();
        table.string('trade_id').unique().notNullable();
        table.string('oanda_trade_id');
        table.string('instrument').notNullable();
        table.string('side').notNullable();
        table.integer('units').notNullable();
        table.decimal('entry_price', 10, 5);
        table.decimal('exit_price', 10, 5);
        table.decimal('entry_cost_aud', 10, 2);
        table.decimal('exit_value_aud', 10, 2);
        table.decimal('pnl_aud', 10, 2);
        table.decimal('pnl_pips', 10, 1);
        table.decimal('pnl_percent', 10, 2);
        table.string('signal');
        table.decimal('signal_strength', 10, 2);
        table.string('entry_type');
        table.decimal('atr_pips', 10, 2);
        table.decimal('stop_loss_price', 10, 5);
        table.decimal('take_profit_price', 10, 5);
        table.decimal('trailing_stop_price', 10, 5);
        table.decimal('highest_price', 10, 5);
        table.decimal('trailing_stop_pips', 10, 2);
        table.decimal('leverage_used', 10, 2);
        table.decimal('margin_used_aud', 10, 2);
        table.decimal('spread_pips', 10, 2);
        table.decimal('swap_aud', 10, 4);
        table.decimal('commission_aud', 10, 4);
        table.bigInteger('holding_period_ms');
        table.bigInteger('entry_time');
        table.bigInteger('exit_time');
        table.string('exit_reason');
        table.string('mode').defaultTo('live');
        table.boolean('is_open').defaultTo(true);
        table.timestamp('created_at').defaultTo(db.fn.now());
        table.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Create signals table
    await db.schema.createTable('signals', (table) => {
        table.increments('id').primary();
        table.string('instrument').notNullable();
        table.string('signal').notNullable();
        table.decimal('strength', 10, 2);
        table.string('strategy');
        table.string('timeframe');
        table.decimal('price', 10, 5);
        table.decimal('atr_pips', 10, 2);
        table.decimal('rsi', 10, 2);
        table.decimal('adx', 10, 2);
        table.integer('supertrend_direction');
        table.bigInteger('timestamp');
        table.string('entry_type');
    });

    // Create portfolio_snapshots table
    await db.schema.createTable('portfolio_snapshots', (table) => {
        table.increments('id').primary();
        table.bigInteger('timestamp').notNullable();
        table.decimal('balance', 10, 2);
        table.decimal('total_value', 10, 2);
        table.decimal('unrealized_pnl', 10, 2);
        table.decimal('margin_used', 10, 2);
        table.decimal('margin_available', 10, 2);
        table.integer('position_count');
        table.string('mode').defaultTo('live');
    });
};

/**
 * Seed database with test data
 */
const seedTestData = async (db, trades = [], signals = []) => {
    if (trades.length > 0) {
        await db('trades').insert(trades);
    }
    if (signals.length > 0) {
        await db('signals').insert(signals);
    }
};

/**
 * Clean up test database
 */
const cleanupTestDb = async (db) => {
    await db('trades').del();
    await db('signals').del();
    await db('portfolio_snapshots').del();
};

/**
 * Destroy test database connection
 */
const destroyTestDb = async (db) => {
    await db.destroy();
};

module.exports = {
    createTestDb,
    runMigrations,
    seedTestData,
    cleanupTestDb,
    destroyTestDb,
};
