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
};

// Create and initialize the database connection
const db = knex(config);

// This function will now only run migrations, which is the correct way.
async function initializeDatabase() {
    try {
        console.log("🚀 Running database migrations...");
        await db.migrate.latest();
        console.log("✅ Database schema is up to date.");
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

// Export the database connection - KEEP IT SIMPLE
module.exports = db;
