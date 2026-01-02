// backend/config/database.js - Database Connection
const knex = require("knex");
const path = require("path");
const fs = require("fs");

// =============================================================================
// DATABASE PATH CONFIGURATION
// =============================================================================
// Priority: DB_PATH env var → NODE_ENV-based default → dev fallback
// This MUST match the logic in knexfile.js and ecosystem.config.js
// =============================================================================

const PRODUCTION_DB_PATH = "/opt/forex-trading-bot/backend/data/trading.db";

const getDbPath = () => {
    // 1. Explicit DB_PATH takes priority (set in ecosystem.config.js for production)
    if (process.env.DB_PATH) {
        return process.env.DB_PATH;
    }

    // 2. Production default
    if (process.env.NODE_ENV === "production") {
        return PRODUCTION_DB_PATH;
    }

    // 3. Development default (relative to this file in /backend/config/)
    return path.join(__dirname, "../data/trading.db");
};

const dbPath = getDbPath();

// Ensure the database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created database directory: ${dbDir}`);
}

// Log database configuration on startup
console.log("DATABASE CONFIG:");
console.log(
    "  DB_PATH env:",
    process.env.DB_PATH || "(not set - using default)"
);
console.log("  NODE_ENV:", process.env.NODE_ENV || "(not set)");
console.log("  Resolved path:", dbPath);
console.log("  File exists:", fs.existsSync(dbPath));

// Database configuration
const config = {
    client: "better-sqlite3",
    connection: {
        filename: dbPath,
    },
    useNullAsDefault: true,
    pool: {
        afterCreate: (conn, cb) => {
            conn.pragma("journal_mode = WAL");
            conn.pragma("busy_timeout = 30000");
            cb();
        },
    },
};

// Create database connection
const db = knex(config);

// Export db connection and resolved path (for debugging/testing)
module.exports = { db, dbPath };
