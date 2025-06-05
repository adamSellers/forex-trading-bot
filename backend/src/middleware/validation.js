// =====================================================
// 4. backend/src/middleware/validation.js
// INPUT VALIDATION & SANITIZATION
// =====================================================

const logger = require("../utils/logger");

class ValidationMiddleware {
    static validateTradingConfig(req, res, next) {
        const { body } = req;
        const errors = [];

        try {
            // Validate strategy
            if (
                body.strategy &&
                !["conservative", "balanced", "responsive"].includes(
                    body.strategy
                )
            ) {
                errors.push(
                    "Invalid strategy. Must be: conservative, balanced, or responsive"
                );
            }

            // Validate risk parameters
            if (body.riskPerTrade !== undefined) {
                const risk = parseFloat(body.riskPerTrade);
                if (isNaN(risk) || risk < 0.001 || risk > 0.1) {
                    errors.push("Risk per trade must be between 0.1% and 10%");
                }
            }

            if (body.maxDailyLoss !== undefined) {
                const maxDaily = parseFloat(body.maxDailyLoss);
                if (isNaN(maxDaily) || maxDaily < 0.01 || maxDaily > 0.2) {
                    errors.push("Max daily loss must be between 1% and 20%");
                }
            }

            // More validation rules...
            if (errors.length > 0) {
                logger.warn("Trading config validation errors:", {
                    errors,
                    body,
                });
                return res.status(400).json({
                    error: "Validation failed",
                    details: errors,
                    timestamp: new Date().toISOString(),
                });
            }

            next();
        } catch (error) {
            logger.error("Validation middleware error:", error);
            return res.status(500).json({
                error: "Validation system error",
                timestamp: new Date().toISOString(),
            });
        }
    }

    static validateQueryParams(allowedParams) {
        return (req, res, next) => {
            const { query } = req;
            const errors = [];

            try {
                // Check for unknown parameters
                Object.keys(query).forEach((param) => {
                    if (!allowedParams.includes(param)) {
                        errors.push(`Unknown parameter: ${param}`);
                    }
                });

                // Validate limit parameter
                if (query.limit !== undefined) {
                    const limit = parseInt(query.limit);
                    if (isNaN(limit) || limit < 1 || limit > 1000) {
                        errors.push("Limit must be between 1 and 1000");
                    }
                }

                if (errors.length > 0) {
                    logger.warn("Query parameter validation errors:", {
                        errors,
                        query,
                    });
                    return res.status(400).json({
                        error: "Invalid query parameters",
                        details: errors,
                        timestamp: new Date().toISOString(),
                    });
                }

                next();
            } catch (error) {
                logger.error("Query validation error:", error);
                return res.status(500).json({
                    error: "Query validation system error",
                    timestamp: new Date().toISOString(),
                });
            }
        };
    }

    static sanitizeInput(req, res, next) {
        try {
            // Remove potentially dangerous characters and patterns
            const sanitize = (obj) => {
                if (typeof obj === "string") {
                    return obj
                        .replace(
                            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
                            ""
                        ) // Remove scripts
                        .replace(/javascript:/gi, "") // Remove javascript: protocol
                        .replace(/on\w+\s*=/gi, "") // Remove event handlers
                        .trim();
                }
                if (
                    typeof obj === "object" &&
                    obj !== null &&
                    !Array.isArray(obj)
                ) {
                    const sanitized = {};
                    Object.keys(obj).forEach((key) => {
                        const sanitizedKey = key.replace(/[<>\"'&]/g, "");
                        sanitized[sanitizedKey] = sanitize(obj[key]);
                    });
                    return sanitized;
                }
                if (Array.isArray(obj)) {
                    return obj.map((item) => sanitize(item));
                }
                return obj;
            };

            req.body = sanitize(req.body);
            req.query = sanitize(req.query);
            req.params = sanitize(req.params);

            next();
        } catch (error) {
            logger.error("Input sanitization error:", error);
            return res.status(500).json({
                error: "Input processing error",
                timestamp: new Date().toISOString(),
            });
        }
    }
}

module.exports = ValidationMiddleware;
