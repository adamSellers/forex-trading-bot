const path = require("path");

// Use a consistent database name, which can be overridden by an environment variable.
const dbName = "trading.db";

const connection = {
    filename: path.join(__dirname, "./data/", dbName),
};

module.exports = {
    development: {
        client: "sqlite3",
        connection,
        useNullAsDefault: true,
        migrations: { directory: "./migrations" },
    },
    production: {
        client: "sqlite3",
        connection,
        useNullAsDefault: true,
        migrations: { directory: "./migrations" },
    },
};
