// backend/knexfile.js - Knex Migration Configuration
const path = require("path");

// =============================================================================
// DATABASE PATH CONFIGURATION
// =============================================================================
// Priority: DB_PATH env var → NODE_ENV-based default → dev fallback
// This MUST match the logic in config/database.js and ecosystem.config.js
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

    // 3. Development default (relative to this file in /backend/)
    return path.join(__dirname, "data/trading.db");
};

const dbPath = getDbPath();

// Shared configuration for all environments
const sharedConfig = {
    client: "better-sqlite3",
    connection: {
        filename: dbPath,
    },
    useNullAsDefault: true,
    migrations: {
        directory: path.join(__dirname, "migrations"),
    },
    pool: {
        afterCreate: (conn, cb) => {
            conn.pragma("journal_mode = WAL");
            conn.pragma("synchronous = NORMAL");
            conn.pragma("wal_autocheckpoint = 1000");
            conn.pragma("busy_timeout = 30000");
            cb();
        },
    },
};

// Export same config for both environments (path logic handles the difference)
module.exports = {
    development: sharedConfig,
    production: sharedConfig,
};
