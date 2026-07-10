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
        table.decimal('lowest_price', 10, 5);
        table.decimal('trailing_stop_pips', 10, 2);
        table.boolean('breakeven_hit');
        table.string('active_stop_type');
        table.string('close_price_source');
        table.string('reconciliation_status');
        table.string('broker_exit_reason');
        table.bigInteger('broker_closed_at');
        table.bigInteger('last_broker_sync_at');
        table.string('config_hash');
        table.json('broker_reconciliation_payload');
        table.string('run_id');
        table.string('owner_run_id');
        table.string('selection_id');
        table.string('strategy');
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
        table.string('reason_code');
        table.string('signal_class');
        table.string('intent');
        table.string('setup_id');
        table.bigInteger('signal_candle_time');
        table.boolean('unique_event');
        table.boolean('cooldown_suppressed');
        table.string('pending_direction');
        table.string('pending_state');
        table.string('pending_waiting_for');
        table.string('config_hash');
        table.json('decision_context');
        table.json('timesfm_context');
        table.string('run_id');
        table.string('selection_id');
        table.string('mode');
    });

    await db.schema.createTable('entry_decisions', (table) => {
        table.increments('id').primary();
        table.string('decision_id').notNullable().unique();
        table.string('setup_id');
        table.bigInteger('signal_candle_time');
        table.bigInteger('decision_time').notNullable();
        table.string('instrument').notNullable();
        table.string('side').notNullable();
        table.string('signal').notNullable();
        table.string('entry_type');
        table.string('config_hash');
        table.json('config_snapshot');
        table.string('outcome').notNullable().defaultTo('PENDING');
        table.string('stage').notNullable().defaultTo('RECEIVED');
        table.string('rejection_code');
        table.text('rejection_reason');
        table.decimal('spread_pips', 10, 2);
        table.bigInteger('price_age_ms');
        table.integer('open_positions');
        table.decimal('projected_exposure', 10, 4);
        table.decimal('signal_strength', 10, 4);
        table.decimal('adx', 10, 4);
        table.decimal('rsi', 10, 4);
        table.decimal('atr_pips', 10, 4);
        table.string('trade_id');
        table.string('run_id');
        table.string('selection_id');
        table.string('mode');
        table.string('strategy');
        table.json('timesfm_context');
        table.timestamp('created_at').defaultTo(db.fn.now());
        table.timestamp('updated_at').defaultTo(db.fn.now());
    });

    await db.schema.createTable('strategy_runs', (table) => {
        table.increments('id').primary();
        table.string('run_id').notNullable().unique();
        table.string('mode').notNullable();
        table.string('strategy').notNullable();
        table.string('status').notNullable();
        table.string('selection_id');
        table.string('shadow_of_run_id');
        table.string('parent_run_id');
        table.string('config_hash');
        table.json('config_snapshot');
        table.bigInteger('started_at').notNullable();
        table.bigInteger('stopped_at');
        table.json('metadata');
        table.timestamp('created_at').defaultTo(db.fn.now());
        table.timestamp('updated_at').defaultTo(db.fn.now());
    });

    // Create portfolio_snapshots table
    await db.schema.createTable('portfolio_snapshots', (table) => {
        table.increments('id').primary();
        table.decimal('total_value_aud', 10, 2);
        table.decimal('balance_aud', 10, 2);
        table.decimal('unrealized_pnl_aud', 10, 2);
        table.decimal('realized_pnl_aud', 10, 2);
        table.decimal('margin_used_aud', 10, 2);
        table.decimal('margin_available_aud', 10, 2);
        table.json('positions');
        table.integer('position_count');
        table.decimal('exposure_percent', 10, 2);
        table.bigInteger('snapshot_time').notNullable();
        table.string('run_id');
        table.string('selection_id');
        table.string('mode').defaultTo('live');
        table.string('strategy');
        table.timestamp('created_at').defaultTo(db.fn.now());
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
    await db('entry_decisions').del();
    await db('portfolio_snapshots').del();
    await db('strategy_runs').del();
};

/**
 * Destroy test database connection
 */
const destroyTestDb = async (db) => {
    if (!db?.destroy) {
        return;
    }

    await db.destroy();
};

module.exports = {
    createTestDb,
    runMigrations,
    seedTestData,
    cleanupTestDb,
    destroyTestDb,
};
