const path = require("path");

module.exports = {
    development: {
        client: "sqlite3",
        connection: {
            filename: path.join(__dirname, "../data/trading_bot.db"),
        },
        useNullAsDefault: true,
        migrations: {
            directory: "./migrations",
        },
    },

    production: {
        client: "sqlite3",
        connection: {
            filename: path.join(__dirname, "./data/trading.db"),
        },
        useNullAsDefault: true,
        migrations: {
            directory: "./migrations",
        },
    },
};
