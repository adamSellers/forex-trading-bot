// backend/config/database.js - Fixed exports
const knex = require("knex");
const path = require("path");

// Database configuration
const config = {
    client: "sqlite3",
    connection: {
        filename: path.join(__dirname, "../../data/trading.db"),
    },
    useNullAsDefault: true,
    migrations: {
        directory: path.join(__dirname, "../migrations"),
    },
    seeds: {
        directory: path.join(__dirname, "../seeds"),
    },
};

// Create and initialize the database connection
const db = knex(config);

// Initialize database tables if they don't exist
async function initializeDatabase() {
    try {
        // Check if tables exist, create if they don't
        const hasTradesTable = await db.schema.hasTable("trades");
        const hasSignalsTable = await db.schema.hasTable("signals");
        const hasPortfolioTable = await db.schema.hasTable("portfolio");
        const hasPerformanceTable = await db.schema.hasTable("performance");

        if (!hasTradesTable) {
            await db.schema.createTable("trades", (table) => {
                table.increments("id").primary();
                table.string("trade_id").unique().notNullable();
                table.string("symbol").notNullable();
                table.string("side").notNullable(); // BUY or SELL
                table.decimal("quantity", 18, 8).notNullable();
                table.decimal("price", 18, 8).notNullable();
                table.decimal("total_value", 18, 2).notNullable(); // USDT amount (cost for BUY, received for SELL)
                table.decimal("pnl", 18, 2).defaultTo(0); // P&L in USDT
                table.decimal("pnl_percent", 8, 2).defaultTo(0); // P&L percentage
                table.string("signal").nullable();
                table.decimal("signal_strength", 8, 2).nullable();
                table.decimal("stop_loss", 18, 8).nullable(); // Stop loss price
                table.decimal("entry_cost", 18, 2).nullable(); // Original USDT cost basis (for SELL trades)
                table.integer("holding_period").nullable(); // Milliseconds held
                table.timestamp("timestamp").notNullable();
                table.timestamp("created_at").defaultTo(db.fn.now());

                table.index(["symbol", "timestamp"]);
                table.index(["trade_id"]);
                table.index(["created_at"]);
                table.index(["side", "timestamp"]);
            });
            console.log("✅ Created trades table with USDT-based schema");
        }

        if (!hasSignalsTable) {
            await db.schema.createTable("signals", (table) => {
                table.increments("id").primary();
                table.string("symbol").notNullable();
                table.string("signal").notNullable();
                table.decimal("strength", 8, 2).notNullable();
                table.string("strategy").notNullable();
                table.string("timeframe").notNullable();
                table.decimal("current_price", 18, 8).nullable();
                table.text("message").nullable();
                table.decimal("atr", 18, 8).nullable(); // ATR value for stop loss calculation
                table.json("trend_data").nullable(); // Additional trend analysis data
                table.timestamp("timestamp").notNullable();
                table.timestamp("created_at").defaultTo(db.fn.now());

                table.index(["symbol", "timestamp"]);
                table.index(["signal", "timestamp"]);
                table.index(["strategy", "timestamp"]);
            });
            console.log("✅ Created signals table");
        }

        if (!hasPortfolioTable) {
            await db.schema.createTable("portfolio", (table) => {
                table.increments("id").primary();
                table.decimal("total_value", 18, 2).notNullable(); // Total portfolio value in USDT
                table.decimal("usdt_balance", 18, 2).notNullable(); // Available USDT balance
                table.decimal("crypto_value", 18, 2).defaultTo(0); // Value of crypto holdings in USDT
                table.decimal("total_pnl", 18, 2).defaultTo(0); // Total P&L in USDT
                table.decimal("daily_pnl", 18, 2).defaultTo(0); // Daily P&L in USDT
                table.decimal("weekly_pnl", 18, 2).defaultTo(0); // Weekly P&L in USDT
                table.json("positions").nullable(); // Current positions data
                table.integer("position_count").defaultTo(0); // Number of open positions
                table.decimal("allocation_usdt_percent", 5, 2).defaultTo(0); // % in USDT
                table.decimal("allocation_crypto_percent", 5, 2).defaultTo(0); // % in crypto
                table.timestamp("snapshot_time").defaultTo(db.fn.now());

                table.index(["snapshot_time"]);
            });
            console.log("✅ Created portfolio table with USDT accounting");
        }

        if (!hasPerformanceTable) {
            await db.schema.createTable("performance", (table) => {
                table.increments("id").primary();
                table.integer("total_trades").defaultTo(0);
                table.integer("winning_trades").defaultTo(0);
                table.integer("losing_trades").defaultTo(0);
                table.decimal("win_rate", 5, 2).defaultTo(0);
                table.decimal("avg_win_usdt", 18, 2).defaultTo(0); // Average win in USDT
                table.decimal("avg_loss_usdt", 18, 2).defaultTo(0); // Average loss in USDT
                table.decimal("profit_factor", 8, 2).defaultTo(0);
                table.decimal("sharpe_ratio", 8, 2).defaultTo(0);
                table.decimal("max_drawdown", 5, 2).defaultTo(0);
                table.decimal("current_drawdown", 5, 2).defaultTo(0);
                table.decimal("total_fees_usdt", 18, 2).defaultTo(0); // Total trading fees in USDT
                table.integer("avg_holding_period").defaultTo(0); // Average holding period in milliseconds
                table.decimal("best_trade_usdt", 18, 2).defaultTo(0); // Best trade P&L in USDT
                table.decimal("worst_trade_usdt", 18, 2).defaultTo(0); // Worst trade P&L in USDT
                table.timestamp("calculated_at").defaultTo(db.fn.now());

                table.index(["calculated_at"]);
            });
            console.log("✅ Created performance table with USDT metrics");
        }

        // Check if we need to add new columns to existing tables (migration logic)
        await migrateExistingTables();

        console.log("✅ Database initialized successfully");
    } catch (error) {
        console.error("❌ Database initialization error:", error);
        throw error;
    }
}

// Migration function to add new columns to existing tables
async function migrateExistingTables() {
    try {
        // Check and add new columns to trades table
        const tradesColumns = await db("trades").columnInfo();

        if (!tradesColumns.pnl_percent) {
            await db.schema.alterTable("trades", (table) => {
                table.decimal("pnl_percent", 8, 2).defaultTo(0);
            });
            console.log("✅ Added pnl_percent column to trades table");
        }

        if (!tradesColumns.entry_cost) {
            await db.schema.alterTable("trades", (table) => {
                table.decimal("entry_cost", 18, 2).nullable();
            });
            console.log("✅ Added entry_cost column to trades table");
        }

        if (!tradesColumns.holding_period) {
            await db.schema.alterTable("trades", (table) => {
                table.integer("holding_period").nullable();
            });
            console.log("✅ Added holding_period column to trades table");
        }

        if (!tradesColumns.stop_loss) {
            await db.schema.alterTable("trades", (table) => {
                table.decimal("stop_loss", 18, 8).nullable();
            });
            console.log("✅ Added stop_loss column to trades table");
        }

        // Check and add new columns to portfolio table
        const portfolioColumns = await db("portfolio").columnInfo();

        if (!portfolioColumns.usdt_balance) {
            await db.schema.alterTable("portfolio", (table) => {
                table.decimal("usdt_balance", 18, 2).notNullable().defaultTo(0);
            });
            console.log("✅ Added usdt_balance column to portfolio table");
        }

        if (!portfolioColumns.crypto_value) {
            await db.schema.alterTable("portfolio", (table) => {
                table.decimal("crypto_value", 18, 2).defaultTo(0);
            });
            console.log("✅ Added crypto_value column to portfolio table");
        }

        if (!portfolioColumns.position_count) {
            await db.schema.alterTable("portfolio", (table) => {
                table.integer("position_count").defaultTo(0);
            });
            console.log("✅ Added position_count column to portfolio table");
        }

        if (!portfolioColumns.allocation_usdt_percent) {
            await db.schema.alterTable("portfolio", (table) => {
                table.decimal("allocation_usdt_percent", 5, 2).defaultTo(0);
                table.decimal("allocation_crypto_percent", 5, 2).defaultTo(0);
            });
            console.log("✅ Added allocation columns to portfolio table");
        }

        // Check and add new columns to signals table
        const signalsColumns = await db("signals").columnInfo();

        if (!signalsColumns.atr) {
            await db.schema.alterTable("signals", (table) => {
                table.decimal("atr", 18, 8).nullable();
            });
            console.log("✅ Added atr column to signals table");
        }

        if (!signalsColumns.trend_data) {
            await db.schema.alterTable("signals", (table) => {
                table.json("trend_data").nullable();
            });
            console.log("✅ Added trend_data column to signals table");
        }

        // Check and add new columns to performance table
        const performanceColumns = await db("performance").columnInfo();

        if (!performanceColumns.avg_win_usdt) {
            await db.schema.alterTable("performance", (table) => {
                table.decimal("avg_win_usdt", 18, 2).defaultTo(0);
                table.decimal("avg_loss_usdt", 18, 2).defaultTo(0);
                table.decimal("total_fees_usdt", 18, 2).defaultTo(0);
                table.integer("avg_holding_period").defaultTo(0);
                table.decimal("best_trade_usdt", 18, 2).defaultTo(0);
                table.decimal("worst_trade_usdt", 18, 2).defaultTo(0);
            });
            console.log("✅ Added USDT-based columns to performance table");
        }
    } catch (error) {
        console.warn("⚠️ Migration warning:", error.message);
        // Don't throw error for migration issues - continue with what we have
    }
}

// Initialize database on module load
initializeDatabase().catch(console.error);

// Test database connection
db.raw("SELECT 1")
    .then(() => {
        console.log("✅ Database connection established");
    })
    .catch((error) => {
        console.error("❌ Database connection failed:", error);
    });

// Export the database connection - KEEP IT SIMPLE
module.exports = db;
