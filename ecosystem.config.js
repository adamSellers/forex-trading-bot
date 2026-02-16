// ecosystem.config.js - PM2 Configuration for Forex Trading Bot
// Raspberry Pi 5 8GB deployment
// =============================================================================
// DB_PATH is set here and used by both database.js and knexfile.js
// =============================================================================

module.exports = {
    apps: [
        {
            name: "forex-backend",

            // Use wrapper script that handles secret decryption (Oanda API keys)
            script: "/opt/forex-trading-bot/scripts/start-wrapper.sh",
            interpreter: "bash",
            cwd: "/opt/forex-trading-bot/backend",

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
                DB_PATH: "/opt/forex-trading-bot/backend/data/trading.db",

                // Logging
                LOG_LEVEL: "info",
                LOG_PATH: "/opt/forex-trading-bot/backend/logs",

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
                CORS_ORIGIN: "http://localhost:3100,http://localhost:3101",

                // -------------------------------------------------------------
                // Pi 5 8GB Optimizations
                // -------------------------------------------------------------
                // With 7GB+ available RAM and 4 cores at near-zero load,
                // we can be generous for this forex backend on Pi 5.
                // -------------------------------------------------------------
                UV_THREADPOOL_SIZE: "4", // Use all 4 cores
                NODE_OPTIONS: "--max-old-space-size=512", // 512MB heap
                LANG: "en_AU.UTF-8",
                LC_ALL: "en_AU.UTF-8",
            },

            // =================================================================
            // PROCESS MANAGEMENT
            // =================================================================
            autorestart: true,
            watch: false,
            max_memory_restart: "512M", // Generous limit for Pi 5 8GB
            restart_delay: 4000,
            max_restarts: 10,
            min_uptime: "10s",

            // =================================================================
            // LOGGING
            // =================================================================
            log_file: "/opt/forex-trading-bot/backend/logs/combined.log",
            out_file: "/opt/forex-trading-bot/backend/logs/out.log",
            error_file: "/opt/forex-trading-bot/backend/logs/error.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: true,
        },
    ],
};
