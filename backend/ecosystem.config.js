module.exports = {
    apps: [
        {
            name: "img-backend",
            script: "server.js",
            cwd: "/opt/crypto-trading-bot/backend",
            instances: 1,
            exec_mode: "fork",

            env_production: {
                NODE_ENV: "production",
                PORT: 3001,

                // Database
                DB_PATH: "/opt/crypto-trading-bot/backend/data/trading_bot.db",
                DB_BACKUP_PATH: "/opt/crypto-trading-bot/backend/backups",

                // Logging
                LOG_LEVEL: "info",
                LOG_PATH: "/opt/crypto-trading-bot/backend/logs",

                // Binance API
                USE_REAL_BINANCE_DATA: "true",

                // Security
                CORS_ORIGIN:
                    "http://localhost:3000,https://localhost:3000,http://192.168.1.100,https://192.168.1.100",
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
            watch: false,
            max_memory_restart: "400M",
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
