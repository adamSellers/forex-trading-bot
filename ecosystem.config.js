// ecosystem.config.js - PM2 Configuration for Forex Trading Bot
// Mac Mini deployment
// =============================================================================
// DB_PATH is set here and used by both database.js and knexfile.js
// =============================================================================

const path = require("path");

// Detect project root (this file is in project root)
const PROJECT_ROOT = __dirname;
const BACKEND_DIR = path.join(PROJECT_ROOT, "backend");
const SCRIPTS_DIR = path.join(PROJECT_ROOT, "scripts");

module.exports = {
    apps: [
        {
            name: "forex-backend",

            // Use wrapper script that handles secret decryption (Oanda API keys)
            script: path.join(SCRIPTS_DIR, "start-wrapper.sh"),
            interpreter: "bash",
            cwd: BACKEND_DIR,

            instances: 1,
            exec_mode: "fork",

            // =================================================================
            // ENVIRONMENT VARIABLES
            // =================================================================
            env_production: {
                NODE_ENV: "production",
                PORT: 3101,

                // Database - SINGLE SOURCE OF TRUTH
                // This path is used by database.js and knexfile.js
                DB_PATH: path.join(BACKEND_DIR, "data", "trading.db"),

                // Logging
                LOG_LEVEL: "info",
                LOG_PATH: path.join(BACKEND_DIR, "logs"),

                // Oanda API credentials (injected by start-wrapper.sh)
                // OANDA_API_KEY: injected
                // OANDA_ACCOUNT_ID: injected
                // OANDA_ENVIRONMENT: injected

                // AWS S3 Analytics (credentials injected by start-wrapper.sh)
                ENABLE_S3_ANALYTICS: "true",
                // AWS_REGION: injected
                // AWS_ACCESS_KEY_ID: injected
                // AWS_SECRET_ACCESS_KEY: injected
                // S3_BUCKET_NAME: injected

                // Security
                CORS_ORIGIN: "http://localhost:3100,http://localhost:3101,http://mac-mini.bunny.hq,https://mac-mini.bunny.hq,http://192.168.1.15:3101",

                // Performance for Mac Mini
                UV_THREADPOOL_SIZE: "4",
                NODE_OPTIONS: "--max-old-space-size=2048",
            },

            // =================================================================
            // PROCESS MANAGEMENT
            // =================================================================
            autorestart: true,
            watch: false,
            max_memory_restart: "512M", // Mac Mini has more memory available
            restart_delay: 5000,
            max_restarts: 10,
            min_uptime: "10s",

            // =================================================================
            // LOGGING
            // =================================================================
            log_file: path.join(BACKEND_DIR, "logs", "combined.log"),
            out_file: path.join(BACKEND_DIR, "logs", "out.log"),
            error_file: path.join(BACKEND_DIR, "logs", "error.log"),
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: true,
        },
    ],
};
