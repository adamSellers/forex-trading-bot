// frontend/src/config/api.js - COMPLETELY FIXED VERSION
const API_CONFIG = {
    development: {
        baseURL: "http://localhost:3001",
        socketURL: "http://localhost:3001",
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

// FIXED: ALL endpoints now have correct /api prefix
export const API_ENDPOINTS = {
    trading: {
        status: "/api/trading/status",
        portfolio: "/api/trading/portfolio",
        signals: "/api/trading/signals",
        trades: "/api/trading/trades",
        prices: "/api/trading/prices",
        account: "/api/trading/account",
        config: "/api/trading/config",
        start: "/api/trading/start",
        stop: "/api/trading/stop",
        reset: "/api/trading/reset",
        holdings: "/api/trading/holdings",
        comparison: "/api/trading/comparison",
        riskStatus: "/api/trading/risk-status",
        performance: "/api/trading/performance",
        analytics: "/api/trading/analytics",
        candles: "/api/trading/candles", // For candle data
        paperStats: "/api/trading/paper-stats", // Paper trading stats
        testSignal: "/api/trading/test-signal", // Test signal generation
    },
    management: {
        health: "/api/management/health",
        system: "/api/management/system",
        logs: "/api/management/logs",
    },
    // Standalone health check
    health: "/api/health",
};

// Enhanced API helper function with better error handling
export const apiCall = async (endpoint, options = {}) => {
    const url = `${API_BASE_URL}${endpoint}`;

    const defaultOptions = {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        method: "GET", // Default method
        ...options,
    };

    try {
        console.log(`🔄 API Call: ${defaultOptions.method} ${url}`);

        const response = await fetch(url, defaultOptions);

        // Log response status
        console.log(
            `📡 API Response: ${response.status} ${response.statusText}`
        );

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

            try {
                const errorData = await response.json();
                errorMessage =
                    errorData.message || errorData.error || errorMessage;
            } catch (parseError) {
                // If we can't parse the error response, use the status text
                console.warn("Could not parse error response:", parseError);
            }

            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log(`✅ API Success: ${endpoint}`);
        return data;
    } catch (error) {
        console.error(`❌ API Error: ${endpoint}:`, error.message);

        // Enhanced error context
        if (error.name === "TypeError" && error.message.includes("fetch")) {
            throw new Error(
                `Network error: Cannot connect to server at ${url}`
            );
        }

        throw error;
    }
};

// Specific API helper functions for common operations
export const tradingAPI = {
    // Get system status
    getStatus: () => apiCall(API_ENDPOINTS.trading.status),

    // Get portfolio data
    getPortfolio: () => apiCall(API_ENDPOINTS.trading.portfolio),

    // Get trading signals
    getSignals: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.trading.signals}${query ? `?${query}` : ""}`
        );
    },

    // Get trade history
    getTrades: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.trading.trades}${query ? `?${query}` : ""}`
        );
    },

    // Get current prices
    getPrices: () => apiCall(API_ENDPOINTS.trading.prices),

    // Get account info
    getAccount: () => apiCall(API_ENDPOINTS.trading.account),

    // Control trading
    startTrading: () =>
        apiCall(API_ENDPOINTS.trading.start, { method: "POST" }),
    stopTrading: () => apiCall(API_ENDPOINTS.trading.stop, { method: "POST" }),
    resetTrading: () =>
        apiCall(API_ENDPOINTS.trading.reset, { method: "POST" }),

    // Update configuration
    updateConfig: (config) =>
        apiCall(API_ENDPOINTS.trading.config, {
            method: "POST",
            body: JSON.stringify(config),
        }),

    // Test signal generation
    testSignal: (signalData) =>
        apiCall(API_ENDPOINTS.trading.testSignal, {
            method: "POST",
            body: JSON.stringify(signalData),
        }),

    // Get analytics data
    getAnalytics: (period = "7d") => {
        const query = new URLSearchParams({ period }).toString();
        return apiCall(`${API_ENDPOINTS.trading.analytics}?${query}`);
    },
};

export const managementAPI = {
    // Health checks
    getHealth: () => apiCall(API_ENDPOINTS.health),
    getSystemHealth: () => apiCall(API_ENDPOINTS.management.health),

    // System information
    getSystemInfo: () => apiCall(API_ENDPOINTS.management.system),

    // Application logs
    getLogs: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.management.logs}${query ? `?${query}` : ""}`
        );
    },
};

// Export everything for convenience
export default {
    API_BASE_URL,
    SOCKET_URL,
    API_ENDPOINTS,
    apiCall,
    tradingAPI,
    managementAPI,
};
