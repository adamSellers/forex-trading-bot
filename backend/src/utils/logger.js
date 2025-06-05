// =====================================================
// 2. backend/src/utils/logger.js
// ENHANCED LOGGING SYSTEM
// =====================================================

const fs = require("fs");
const path = require("path");

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, "../../logs");
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

    log(level, message, data = null) {
        const formattedMessage = this.formatMessage(level, message, data);

        // Console output with colors
        const colors = {
            error: "\x1b[31m", // Red
            warn: "\x1b[33m", // Yellow
            info: "\x1b[36m", // Cyan
            debug: "\x1b[37m", // White
            success: "\x1b[32m", // Green
            reset: "\x1b[0m", // Reset
        };

        const color = colors[level] || colors.info;
        console.log(color + formattedMessage + colors.reset);

        // File output (async to avoid blocking)
        setImmediate(() => this.writeToFile(level, formattedMessage));
    }

    error(message, data = null) {
        this.log("error", message, data);
    }

    warn(message, data = null) {
        this.log("warn", message, data);
    }

    info(message, data = null) {
        this.log("info", message, data);
    }

    success(message, data = null) {
        this.log("success", message, data);
    }

    debug(message, data = null) {
        if (process.env.NODE_ENV === "development") {
            this.log("debug", message, data);
        }
    }
}

module.exports = new Logger();
