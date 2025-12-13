// frontend/src/config/api.js - MERGED FIX
import { io } from "socket.io-client"; // <--- ADDED IMPORT

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

// --- FIXED: Initialize and Export Socket ---
export const socket = io(SOCKET_URL, {
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
});
// -------------------------------------------

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
        candles: "/api/trading/candles",
        paperStats: "/api/trading/paper-stats",
        testSignal: "/api/trading/test-signal",
    },
    management: {
        health: "/api/management/health",
        system: "/api/management/system",
        logs: "/api/management/logs",
    },
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
        // console.log(`🔄 API Call: ${defaultOptions.method} ${url}`);

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

// Specific API helper functions
export const tradingAPI = {
    getStatus: () => apiCall(API_ENDPOINTS.trading.status),
    getPortfolio: () => apiCall(API_ENDPOINTS.trading.portfolio),

    // Inside api.js > tradingAPI object
    getSignals: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.trading.signals}${query ? `?${query}` : ""}`
        ).then((data) => {
            // Safety wrapper to ensure we always return an array
            if (data && Array.isArray(data.signals)) return data.signals;
            if (data && Array.isArray(data)) return data;
            return [];
        });
    },

    getTrades: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.trading.trades}${query ? `?${query}` : ""}`
        ).then((data) => {
            if (data && Array.isArray(data.trades)) return data.trades;
            if (data && Array.isArray(data)) return data;
            return [];
        });
    },

    getPrices: () => apiCall(API_ENDPOINTS.trading.prices),
    getAccount: () => apiCall(API_ENDPOINTS.trading.account),

    startTrading: () =>
        apiCall(API_ENDPOINTS.trading.start, { method: "POST" }),
    stopTrading: () => apiCall(API_ENDPOINTS.trading.stop, { method: "POST" }),
    resetTrading: () =>
        apiCall(API_ENDPOINTS.trading.reset, { method: "POST" }),

    updateConfig: (config) =>
        apiCall(API_ENDPOINTS.trading.config, {
            method: "POST",
            body: JSON.stringify(config),
        }),

    testSignal: (signalData) =>
        apiCall(API_ENDPOINTS.trading.testSignal, {
            method: "POST",
            body: JSON.stringify(signalData),
        }),

    getAnalytics: (period = "7d") => {
        const query = new URLSearchParams({ period }).toString();
        return apiCall(`${API_ENDPOINTS.trading.analytics}?${query}`);
    },

    getCandles: (symbol, timeframe) => {
        const endpoint = `${API_ENDPOINTS.trading.candles}/${symbol}/${timeframe}`;
        return apiCall(endpoint);
    },
};

export const managementAPI = {
    getHealth: () => apiCall(API_ENDPOINTS.health),
    getSystemHealth: () => apiCall(API_ENDPOINTS.management.health),
    getSystemInfo: () => apiCall(API_ENDPOINTS.management.system),
    getLogs: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(
            `${API_ENDPOINTS.management.logs}${query ? `?${query}` : ""}`
        );
    },
};

export default {
    API_BASE_URL,
    SOCKET_URL,
    socket, // <--- ADDED TO DEFAULT EXPORT
    API_ENDPOINTS,
    apiCall,
    tradingAPI,
    managementAPI,
};
