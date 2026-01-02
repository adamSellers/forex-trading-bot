// backend/config/database.js - Database Connection
const knex = require("knex");
const path = require("path");

// Determine database path based on environment
const dbPath =
    process.env.NODE_ENV === "production"
        ? "/opt/forex-trading-bot/data/trading.db"
        : path.join(__dirname, "../data/trading.db");

console.log("DATABASE DEBUG:");
console.log("  __dirname:", __dirname);
console.log("  dbPath:", dbPath);
console.log("  exists:", require("fs").existsSync(dbPath));
console.log("  dir exists:", require("fs").existsSync(path.dirname(dbPath)));

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

module.exports = { db };
