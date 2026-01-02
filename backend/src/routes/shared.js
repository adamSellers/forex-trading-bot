// backend/src/routes/shared.js - Shared utilities for routes

// Oanda configuration
const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";
const OANDA_BASE_URL =
    process.env.OANDA_ENVIRONMENT === "practice"
        ? "https://api-fxpractice.oanda.com"
        : "https://api-fxtrade.oanda.com";

/**
 * Make authenticated request to Oanda API
 */
async function oandaRequest(endpoint, options = {}) {
    const url = `${OANDA_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
        method: options.method || "GET",
        headers: {
            Authorization: `Bearer ${OANDA_API_KEY}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Oanda API error: ${response.status} - ${error}`);
    }

    return response.json();
}

/**
 * Calculate pip value for an instrument
 */
function getPipValue(instrument) {
    return instrument.includes("JPY") ? 0.01 : 0.0001;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Format uptime to human readable
 */
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

/**
 * Middleware to check if Oanda API is configured
 */
function requireOandaApi(req, res, next) {
    if (!OANDA_API_KEY) {
        return res.status(503).json({ error: "Oanda API key not configured" });
    }
    next();
}

/**
 * Middleware to check if a service is available
 */
function requireService(serviceName) {
    return (req, res, next) => {
        const service = req.app.locals[serviceName];
        if (!service) {
            return res
                .status(503)
                .json({ error: `${serviceName} not available` });
        }
        req[serviceName] = service;
        next();
    };
}

module.exports = {
    OANDA_API_KEY,
    OANDA_ACCOUNT_ID,
    OANDA_BASE_URL,
    oandaRequest,
    getPipValue,
    formatBytes,
    formatUptime,
    requireOandaApi,
    requireService,
};
