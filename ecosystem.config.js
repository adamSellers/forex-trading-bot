module.exports = {
    apps: [
        {
            name: "crypto-trend-bot", // Using a more descriptive name
            // Use an absolute path to the wrapper script that handles secret decryption
            script: "/opt/crypto-trading-bot/scripts/start-wrapper.sh",
            interpreter: "bash", // Specify bash as the interpreter for the wrapper script
            cwd: "/opt/crypto-trading-bot/backend",
            instances: 1,
            exec_mode: "fork",

            env_production: {
                NODE_ENV: "production",
                PORT: 3001,

                // Database
                DB_PATH: "/opt/crypto-trading-bot/backend/data/trading.db",
                DB_BACKUP_PATH: "/opt/crypto-trading-bot/backend/backups",

                // Logging
                LOG_LEVEL: "debug",
                LOG_PATH: "/opt/crypto-trading-bot/backend/logs",

                // Binance API
                USE_REAL_BINANCE_DATA: "true",

                // Security
                CORS_ORIGIN:
                    "http://localhost:3000,https://localhost:3000,http://img.oakroad,https://img.oakroad",
                RATE_LIMIT_WINDOW: "15",
                RATE_LIMIT_MAX: "100",

                // Trading Safety
                MAX_DAILY_LOSS_OVERRIDE: "0.01",
                EMERGENCY_STOP_FILE: "/opt/crypto-trading-bot/.emergency_stop",

                // Performance for Pi
                UV_THREADPOOL_SIZE: "4",
                NODE_OPTIONS: "--max-old-space-size=512",
            },

            // Process Management
            autorestart: true,
            watch: false, // Set to true for development, false for production
            max_memory_restart: "400M", // Adjust for your Raspberry Pi model
            restart_delay: 5000,
            max_restarts: 10,
            min_uptime: "10s",

            // Logging
            log_file: "/opt/crypto-trading-bot/backend/logs/combined.log",
            out_file: "/opt/crypto-trading-bot/backend/logs/out.log",
            error_file: "/opt/crypto-trading-bot/backend/logs/error.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
            merge_logs: true,
        },
    ],
};
