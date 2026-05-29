// frontend/src/config/api.js - Forex Trading Bot API Client
import { io } from "socket.io-client";

const API_CONFIG = {
    development: {
        baseURL: "http://localhost:3101", // Forex bot backend port
        socketURL: "http://localhost:3101",
    },
    production: {
        baseURL: "", // Same origin in production (nginx proxy)
        socketURL: "", // Same origin in production
    },
};

const environment = import.meta.env.MODE || "development";
const config = API_CONFIG[environment];

export const API_BASE_URL = config.baseURL;
export const SOCKET_URL = config.socketURL;

// Initialize Socket with reconnection settings
export const socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
});

// API Endpoints - organized by route file
export const API_ENDPOINTS = {
    // systemRoutes.js
    health: "/api/health",
    systemHealth: "/api/system/health",
    systemInfo: "/api/system/info",

    // marketRoutes.js
    prices: "/api/prices",
    candles: "/api/candles", // /api/candles/:instrument
    signals: "/api/signals",

    // accountRoutes.js
    account: "/api/account",
    portfolio: "/api/portfolio",
    trades: "/api/trades",
    closePosition: "/api/trade/close", // /api/trade/close/:id
    tradingStart: "/api/trading/start",
    tradingStop: "/api/trading/stop",
    tradingReset: "/api/trading/reset",

    // configRoutes.js
    config: "/api/config",
    configReset: "/api/config/reset",

    // engineRoutes.js
    engineStatus: "/api/engine/status",
    engineTrades: "/api/engine/trades",
    engineClose: "/api/engine/close", // /api/engine/close/:tradeId
    engineSync: "/api/engine/sync",
    engineResetStats: "/api/engine/reset-stats",
    engineStats: "/api/engine/stats",
    engineStart: "/api/engine/start",
    engineStop: "/api/engine/stop",

    // emailRoutes.js
    emailTest: "/api/email/test",

    // analyticsRoutes.js
    analytics: "/api/analytics",
    analyticsSummary: "/api/analytics/summary",
    analyticsEquity: "/api/analytics/equity",
    analyticsInstruments: "/api/analytics/instruments",

    // runtime/strategy routes
    strategiesCatalog: "/api/strategies/catalog",
    runtimeLiveSelection: "/api/runtime/live-selection",
    runtimeRuns: "/api/runtime/runs",
    runtimeRunStop: "/api/runtime/runs", // /:runId/stop
    runtimeRunReset: "/api/runtime/runs", // /:runId/reset
    runtimeRunPromote: "/api/runtime/runs", // /:runId/promote
    runtimeRunTrades: "/api/runtime/runs", // /:runId/trades
    runtimeRunSignals: "/api/runtime/runs", // /:runId/signals
    runtimeRunEquity: "/api/runtime/runs", // /:runId/equity
    runtimePaperReset: "/api/runtime/paper/reset",

    // S3 Reports
    reportsStatus: "/api/reports/status",
    reportsUpload: "/api/reports/upload",
};

/**
 * Enhanced API helper function with error handling
 */
export const apiCall = async (endpoint, options = {}) => {
    const url = `${API_BASE_URL}${endpoint}`;

    const defaultOptions = {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        method: "GET",
        ...options,
    };

    try {
        const response = await fetch(url, defaultOptions);

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMessage =
                    errorData.message || errorData.error || errorMessage;
            } catch (parseError) {
                console.warn("Could not parse error response:", parseError);
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`❌ API Error: ${endpoint}:`, error.message);
        if (error.name === "TypeError" && error.message.includes("fetch")) {
            throw new Error(
                `Network error: Cannot connect to server at ${url}`
            );
        }
        throw error;
    }
};

/**
 * Trading API - Market data, account, trades
 */
export const tradingAPI = {
    // Health & Status
    getStatus: () => apiCall(API_ENDPOINTS.health),
    getHealth: () => apiCall(API_ENDPOINTS.health),

    // Account & Portfolio
    getAccount: () => apiCall(API_ENDPOINTS.account),
    getPortfolio: () => apiCall(API_ENDPOINTS.portfolio),

    // Market Data
    getPrices: () => apiCall(API_ENDPOINTS.prices),
    getCandles: (instrument, granularity = "M15", count = 100) => {
        const query = new URLSearchParams({ granularity, count }).toString();
        return apiCall(`${API_ENDPOINTS.candles}/${instrument}?${query}`);
    },

    // Signals
    getSignals: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.signals}${query ? `?${query}` : ""}`
        ).then((data) => {
            if (data && Array.isArray(data.signals)) return data.signals;
            if (data && Array.isArray(data)) return data;
            return [];
        });
    },

    // Trade History
    getTrades: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.trades}${query ? `?${query}` : ""}`
        ).then((data) => {
            if (data && Array.isArray(data.trades)) return data.trades;
            if (data && Array.isArray(data)) return data;
            return [];
        });
    },

    // Position Management (via Oanda directly)
    closePosition: (tradeId) =>
        apiCall(`${API_ENDPOINTS.closePosition}/${tradeId}`, {
            method: "POST",
        }),

    // Trading Control (enables/disables trading in config)
    startTrading: (payload = {}) =>
        apiCall(API_ENDPOINTS.tradingStart, {
            method: "POST",
            body: JSON.stringify(payload),
        }),
    stopTrading: () => apiCall(API_ENDPOINTS.tradingStop, { method: "POST" }),
    resetSignals: () => apiCall(API_ENDPOINTS.tradingReset, { method: "POST" }),
};

/**
 * Config API - Configuration management
 */
export const configAPI = {
    // Get full config
    get: () => apiCall(API_ENDPOINTS.config),

    // Update config (partial update)
    update: (config) =>
        apiCall(API_ENDPOINTS.config, {
            method: "POST",
            body: JSON.stringify(config),
        }),

    // Reset to defaults
    reset: () => apiCall(API_ENDPOINTS.configReset, { method: "POST" }),

    // Get specific config value
    getValue: (key) => apiCall(`${API_ENDPOINTS.config}/${key}`),

    // Update specific config value
    setValue: (key, value) =>
        apiCall(`${API_ENDPOINTS.config}/${key}`, {
            method: "PUT",
            body: JSON.stringify({ value }),
        }),
};

/**
 * Engine API - Trading engine control
 */
export const engineAPI = {
    // Get engine status & stats
    getStatus: () => apiCall(API_ENDPOINTS.engineStatus),
    getStats: () => apiCall(API_ENDPOINTS.engineStats),

    // Get open trades from engine
    getTrades: () => apiCall(API_ENDPOINTS.engineTrades),

    // Close a trade via engine
    closeTrade: (tradeId) =>
        apiCall(`${API_ENDPOINTS.engineClose}/${tradeId}`, { method: "POST" }),

    // Sync engine with Oanda
    sync: () => apiCall(API_ENDPOINTS.engineSync, { method: "POST" }),

    // Reset engine statistics
    resetStats: () =>
        apiCall(API_ENDPOINTS.engineResetStats, { method: "POST" }),

    // Start/stop the engine itself
    start: () => apiCall(API_ENDPOINTS.engineStart, { method: "POST" }),
    stop: () => apiCall(API_ENDPOINTS.engineStop, { method: "POST" }),
};

export const strategiesAPI = {
    getCatalog: () =>
        apiCall(API_ENDPOINTS.strategiesCatalog).then((data) => {
            if (data && Array.isArray(data.strategies)) return data.strategies;
            return [];
        }),
};

export const runtimeAPI = {
    getLiveSelection: (params = {}) => {
        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
        ).toString();
        return apiCall(
            `${API_ENDPOINTS.runtimeLiveSelection}${query ? `?${query}` : ""}`
        );
    },
    setLiveSelection: (payload) =>
        apiCall(API_ENDPOINTS.runtimeLiveSelection, {
            method: "POST",
            body: JSON.stringify(payload),
        }),
    getRuns: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.runtimeRuns}${query ? `?${query}` : ""}`
        );
    },
    createRun: (payload) =>
        apiCall(API_ENDPOINTS.runtimeRuns, {
            method: "POST",
            body: JSON.stringify(payload),
        }),
    stopRun: (runId) =>
        apiCall(`${API_ENDPOINTS.runtimeRunStop}/${runId}/stop`, {
            method: "POST",
        }),
    resetRun: (runId) =>
        apiCall(`${API_ENDPOINTS.runtimeRunReset}/${runId}/reset`, {
            method: "POST",
        }),
    resetAllPaper: () =>
        apiCall(API_ENDPOINTS.runtimePaperReset, {
            method: "POST",
            body: JSON.stringify({ confirm: "RESET_PAPER" }),
        }),
    promoteRun: (runId) =>
        apiCall(`${API_ENDPOINTS.runtimeRunPromote}/${runId}/promote`, {
            method: "POST",
        }),
    getRunTrades: (runId, params = {}) => {
        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
        ).toString();
        return apiCall(
            `${API_ENDPOINTS.runtimeRunTrades}/${runId}/trades${query ? `?${query}` : ""}`
        );
    },
    getRunSignals: (runId, params = {}) => {
        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
        ).toString();
        return apiCall(
            `${API_ENDPOINTS.runtimeRunSignals}/${runId}/signals${query ? `?${query}` : ""}`
        );
    },
    getRunEquity: (runId, params = {}) => {
        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
        ).toString();
        return apiCall(
            `${API_ENDPOINTS.runtimeRunEquity}/${runId}/equity${query ? `?${query}` : ""}`
        );
    },
};

/**
 * Analytics API - Performance metrics
 */
export const analyticsAPI = {
    // Comprehensive analytics
    get: (periodOrParams = "30d") => {
        const params =
            typeof periodOrParams === "string"
                ? { period: periodOrParams }
                : { ...(periodOrParams || {}) };
        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
        ).toString();
        return apiCall(`${API_ENDPOINTS.analytics}?${query}`);
    },

    // Quick summary
    getSummary: (period = "30d") => {
        const query = new URLSearchParams({ period }).toString();
        return apiCall(`${API_ENDPOINTS.analyticsSummary}?${query}`);
    },

    // Equity curve data
    getEquity: (period = "30d") => {
        const query = new URLSearchParams({ period }).toString();
        return apiCall(`${API_ENDPOINTS.analyticsEquity}?${query}`);
    },

    // Per-instrument breakdown
    getInstruments: (period = "30d") => {
        const query = new URLSearchParams({ period }).toString();
        return apiCall(`${API_ENDPOINTS.analyticsInstruments}?${query}`);
    },
};

/**
 * Email API - Notifications
 */
export const emailAPI = {
    sendTest: (email) =>
        apiCall(API_ENDPOINTS.emailTest, {
            method: "POST",
            body: JSON.stringify({ email }),
        }),
};

/**
 * Reports API - S3 Analytics Reports
 */
export const reportsAPI = {
    // Get S3 scheduler status (returns null if not configured)
    getStatus: () => apiCall(API_ENDPOINTS.reportsStatus).catch(() => null),

    // Manual upload with period (24h, 7d, 30d)
    upload: (period = "24h") =>
        apiCall(API_ENDPOINTS.reportsUpload, {
            method: "POST",
            body: JSON.stringify({ period }),
        }),
};

/**
 * System API - Health & monitoring
 */
export const systemAPI = {
    // Basic health check
    getHealth: () => apiCall(API_ENDPOINTS.health),

    // Comprehensive system health with Oanda latency
    getSystemHealth: () => apiCall(API_ENDPOINTS.systemHealth),

    // System info (memory, environment, etc.)
    getSystemInfo: () => apiCall(API_ENDPOINTS.systemInfo),
};

// Backwards compatibility - keep tradingAPI.getConfig/updateConfig working
tradingAPI.getConfig = configAPI.get;
tradingAPI.updateConfig = configAPI.update;
tradingAPI.getAnalytics = analyticsAPI.get;

export default {
    API_BASE_URL,
    SOCKET_URL,
    socket,
    API_ENDPOINTS,
    apiCall,
    tradingAPI,
    configAPI,
    engineAPI,
    analyticsAPI,
    emailAPI,
    reportsAPI,
    systemAPI,
};
