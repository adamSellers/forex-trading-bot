// backend/config/database.js
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
                table.decimal("total_value", 18, 2).notNullable();
                table.decimal("pnl", 18, 2).defaultTo(0);
                table.string("signal").nullable();
                table.decimal("signal_strength", 8, 2).nullable();
                table.timestamp("timestamp").notNullable();
                table.timestamp("created_at").defaultTo(db.fn.now());

                table.index(["symbol", "timestamp"]);
                table.index(["trade_id"]);
                table.index(["created_at"]);
            });
            console.log("✅ Created trades table");
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
                table.decimal("total_value", 18, 2).notNullable();
                table.decimal("cash_balance", 18, 2).notNullable();
                table.decimal("total_pnl", 18, 2).defaultTo(0);
                table.decimal("daily_pnl", 18, 2).defaultTo(0);
                table.decimal("weekly_pnl", 18, 2).defaultTo(0);
                table.json("positions").nullable();
                table.timestamp("snapshot_time").defaultTo(db.fn.now());

                table.index(["snapshot_time"]);
            });
            console.log("✅ Created portfolio table");
        }

        if (!hasPerformanceTable) {
            await db.schema.createTable("performance", (table) => {
                table.increments("id").primary();
                table.integer("total_trades").defaultTo(0);
                table.integer("winning_trades").defaultTo(0);
                table.integer("losing_trades").defaultTo(0);
                table.decimal("win_rate", 5, 2).defaultTo(0);
                table.decimal("profit_factor", 8, 2).defaultTo(0);
                table.decimal("sharpe_ratio", 8, 2).defaultTo(0);
                table.decimal("max_drawdown", 5, 2).defaultTo(0);
                table.timestamp("calculated_at").defaultTo(db.fn.now());

                table.index(["calculated_at"]);
            });
            console.log("✅ Created performance table");
        }

        console.log("✅ Database initialized successfully");
    } catch (error) {
        console.error("❌ Database initialization error:", error);
        throw error;
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

module.exports = db;
