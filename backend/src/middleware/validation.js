// backend/src/middleware/validation.js - Input Validation & Sanitization
import logger from "../utils/logger.js";

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

            if (body.maxWeeklyLoss !== undefined) {
                const maxWeekly = parseFloat(body.maxWeeklyLoss);
                if (isNaN(maxWeekly) || maxWeekly < 0.02 || maxWeekly > 0.5) {
                    errors.push("Max weekly loss must be between 2% and 50%");
                }
            }

            // Validate starting capital
            if (body.startingCapital !== undefined) {
                const capital = parseFloat(body.startingCapital);
                if (isNaN(capital) || capital < 100 || capital > 1000000) {
                    errors.push(
                        "Starting capital must be between $100 and $1,000,000"
                    );
                }
            }

            // Validate allocation
            if (body.allocation) {
                const allocation = body.allocation;
                const totalAllocation = Object.values(allocation).reduce(
                    (sum, val) => {
                        const value = parseFloat(val);
                        return isNaN(value) ? sum : sum + value;
                    },
                    0
                );

                if (Math.abs(totalAllocation - 1.0) > 0.01) {
                    errors.push("Portfolio allocation must total 100%");
                }

                // Validate individual allocations
                Object.entries(allocation).forEach(([asset, percent]) => {
                    const value = parseFloat(percent);
                    if (isNaN(value) || value < 0 || value > 1) {
                        errors.push(
                            `Invalid allocation for ${asset}: must be between 0% and 100%`
                        );
                    }
                });
            }

            // Validate timeframe
            if (
                body.timeframe &&
                !["1h", "4h", "1d"].includes(body.timeframe)
            ) {
                errors.push("Invalid timeframe. Must be: 1h, 4h, or 1d");
            }

            // Validate stop loss ATR
            if (body.stopLossATR !== undefined) {
                const atr = parseFloat(body.stopLossATR);
                if (isNaN(atr) || atr < 0.5 || atr > 5.0) {
                    errors.push("Stop loss ATR must be between 0.5 and 5.0");
                }
            }

            // Validate minimum order size
            if (body.minOrderSize !== undefined) {
                const minOrder = parseFloat(body.minOrderSize);
                if (isNaN(minOrder) || minOrder < 5 || minOrder > 1000) {
                    errors.push(
                        "Minimum order size must be between $5 and $1,000"
                    );
                }
            }

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

                // Validate period parameter
                if (query.period !== undefined) {
                    if (
                        !["1h", "1d", "7d", "30d", "90d"].includes(query.period)
                    ) {
                        errors.push(
                            "Invalid period. Must be: 1h, 1d, 7d, 30d, or 90d"
                        );
                    }
                }

                // Validate symbol parameter
                if (query.symbol !== undefined) {
                    const validSymbols = [
                        "BTCUSDT",
                        "ETHUSDT",
                        "BNBUSDT",
                        "DOGEUSDT",
                    ];
                    if (!validSymbols.includes(query.symbol)) {
                        errors.push(
                            `Invalid symbol. Must be one of: ${validSymbols.join(
                                ", "
                            )}`
                        );
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
                        // Sanitize key names too
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

    static rateLimiter(windowMs = 60000, maxRequests = 100) {
        const requests = new Map();

        return (req, res, next) => {
            const clientId =
                req.ip || req.connection.remoteAddress || "unknown";
            const now = Date.now();

            // Clean old entries
            const cutoff = now - windowMs;
            requests.forEach((timestamps, id) => {
                const validTimestamps = timestamps.filter(
                    (time) => time > cutoff
                );
                if (validTimestamps.length === 0) {
                    requests.delete(id);
                } else {
                    requests.set(id, validTimestamps);
                }
            });

            // Check current client
            const clientRequests = requests.get(clientId) || [];
            const recentRequests = clientRequests.filter(
                (time) => time > cutoff
            );

            if (recentRequests.length >= maxRequests) {
                logger.warn("Rate limit exceeded:", {
                    clientId,
                    requests: recentRequests.length,
                });
                return res.status(429).json({
                    error: "Rate limit exceeded",
                    message: `Too many requests. Limit: ${maxRequests} per ${
                        windowMs / 1000
                    } seconds`,
                    retryAfter: Math.ceil(windowMs / 1000),
                    timestamp: new Date().toISOString(),
                });
            }

            // Add current request
            recentRequests.push(now);
            requests.set(clientId, recentRequests);

            next();
        };
    }
}

export default ValidationMiddleware;
