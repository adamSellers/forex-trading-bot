// backend/knexfile.js - Knex Configuration
const path = require("path");

module.exports = {
    development: {
        client: "better-sqlite3",
        connection: {
            filename: path.join(__dirname, "data/trading.db"),
        },
        useNullAsDefault: true,
        migrations: {
            directory: path.join(__dirname, "migrations"),
        },
        pool: {
            afterCreate: (conn, cb) => {
                conn.pragma("journal_mode = WAL");
                cb();
            },
        },
    },

    production: {
        client: "better-sqlite3",
        connection: {
            filename: "/opt/forex-trading-bot/data/trading.db",
        },
        useNullAsDefault: true,
        migrations: {
            directory: path.join(__dirname, "migrations"),
        },
        pool: {
            afterCreate: (conn, cb) => {
                conn.pragma("journal_mode = WAL");
                conn.pragma("busy_timeout = 30000");
                cb();
            },
        },
    },
};
