// =====================================================
// 3. backend/src/middleware/errorHandler.js
// CENTRALIZED ERROR HANDLING
// =====================================================

const logger = require("../utils/logger");

class ErrorHandler {
    static handle(error, req, res, next) {
        logger.error("API Error:", {
            error: error.message,
            stack:
                process.env.NODE_ENV === "development"
                    ? error.stack
                    : undefined,
            url: req.url,
            method: req.method,
            body: req.body,
            timestamp: new Date().toISOString(),
        });

        // Determine error status
        const status = error.status || error.statusCode || 500;

        // Don't expose internal errors in production
        const isDev = process.env.NODE_ENV === "development";

        const errorResponse = {
            error: true,
            message: isDev ? error.message : "Internal server error",
            status,
            timestamp: new Date().toISOString(),
            ...(isDev && {
                stack: error.stack,
                details: error.details || null,
            }),
        };

        res.status(status).json(errorResponse);
    }

    static asyncWrapper(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    static notFound(req, res, next) {
        const error = new Error(
            `Route not found: ${req.method} ${req.originalUrl}`
        );
        error.status = 404;
        next(error);
    }

    static validationError(message, details = null) {
        const error = new Error(message);
        error.status = 400;
        error.details = details;
        return error;
    }

    static unauthorizedError(message = "Unauthorized") {
        const error = new Error(message);
        error.status = 401;
        return error;
    }

    static forbiddenError(message = "Forbidden") {
        const error = new Error(message);
        error.status = 403;
        return error;
    }

    static conflictError(message = "Resource conflict") {
        const error = new Error(message);
        error.status = 409;
        return error;
    }

    static serviceUnavailableError(
        message = "Service temporarily unavailable"
    ) {
        const error = new Error(message);
        error.status = 503;
        return error;
    }
}

module.exports = ErrorHandler;
