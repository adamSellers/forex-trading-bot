// =====================================================
// 2. backend/src/utils/logger.js
// ENHANCED LOGGING SYSTEM
// =====================================================

const fs = require("fs");
const path = require("path");

class Logger {
    constructor() {
        this.logDir =
            process.env.LOG_PATH || path.join(__dirname, "../../logs");
        this.ensureLogDir();

        // Define logging levels hierarchy
        this.levels = {
            error: 0,
            warn: 1,
            success: 2,
            info: 2,
            debug: 3,
        };

        // Set the current log level from environment variables, default to 'info'
        const envLogLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
        this.currentLogLevel = this.levels[envLogLevel] ?? this.levels.info;
        this.ensureLogDir();
    }

    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            ...(data && { data }),
        };

        return JSON.stringify(logEntry);
    }

    writeToFile(level, formattedMessage) {
        try {
            const filename = `${level}-${
                new Date().toISOString().split("T")[0]
            }.log`;
            const filepath = path.join(this.logDir, filename);
            fs.appendFileSync(filepath, formattedMessage + "\n");
        } catch (error) {
            // Fail silently to avoid logging loops
            console.error("Failed to write to log file:", error.message);
        }
    }

    // This is the core method that writes to the console, which PM2 captures.
    _logToConsole(level, formattedMessage) {
        const formattedMessage = this.formatMessage(level, message, data);

        // Console output with colors
        const colors = {
            error: "\x1b[31m", // Red
            warn: "\x1b[33m", // Yellow
            info: "\x1b[36m", // Cyan
            debug: "\x1b[90m", // Gray for debug
            success: "\x1b[32m", // Green
            reset: "\x1b[0m", // Reset
        };

        const color = colors[level] || colors.info;
        console.log(color + formattedMessage + colors.reset);

        // File output (async to avoid blocking)
        setImmediate(() => this.writeToFile(level, formattedMessage));
    }

    error(message, data = null) {
        if (this.levels.error <= this.currentLogLevel) {
            this._logToConsole(
                "error",
                this.formatMessage("error", message, data)
            );
        }
    }

    warn(message, data = null) {
        if (this.levels.warn <= this.currentLogLevel) {
            this._logToConsole(
                "warn",
                this.formatMessage("warn", message, data)
            );
        }
    }

    info(message, data = null) {
        if (this.levels.info <= this.currentLogLevel) {
            this._logToConsole(
                "info",
                this.formatMessage("info", message, data)
            );
        }
    }

    success(message, data = null) {
        if (this.levels.success <= this.currentLogLevel) {
            this._logToConsole(
                "success",
                this.formatMessage("success", message, data)
            );
        }
    }

    debug(message, data = null) {
        // This is the key change: it now respects LOG_LEVEL
        if (this.levels.debug <= this.currentLogLevel) {
            this._logToConsole(
                "debug",
                this.formatMessage("debug", message, data)
            );
        }
    }
}

module.exports = new Logger();
