// frontend/src/config/api.js - Forex Trading Bot
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
    transports: ["websocket", "polling"], // Allow fallback to polling
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
});

// Endpoints matching backend tradingRoutes.js
export const API_ENDPOINTS = {
    health: "/api/health",
    account: "/api/account",
    prices: "/api/prices",
    candles: "/api/candles", // /api/candles/:instrument
    signals: "/api/signals",
    portfolio: "/api/portfolio",
    trades: "/api/trades",
    analytics: "/api/analytics",
    config: "/api/config",
    closePosition: "/api/trade/close", // /api/trade/close/:id
    // System endpoints
    systemHealth: "/api/system/health",
    systemInfo: "/api/system/info",
};

// Enhanced API helper function
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
        console.error(`âŒ API Error: ${endpoint}:`, error.message);
        if (error.name === "TypeError" && error.message.includes("fetch")) {
            throw new Error(
                `Network error: Cannot connect to server at ${url}`
            );
        }
        throw error;
    }
};

// Trading API helper functions
export const tradingAPI = {
    // System
    getStatus: () => apiCall(API_ENDPOINTS.health),
    getHealth: () => apiCall(API_ENDPOINTS.health),

    // Account & Portfolio
    getAccount: () => apiCall(API_ENDPOINTS.account),
    getPortfolio: () => apiCall(API_ENDPOINTS.portfolio),

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

    // Trades
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

    // Prices
    getPrices: () => apiCall(API_ENDPOINTS.prices),

    // Analytics - comprehensive performance metrics
    getAnalytics: (period = "30d", mode = "live") => {
        const query = new URLSearchParams({ period, mode }).toString();
        return apiCall(`${API_ENDPOINTS.analytics}?${query}`);
    },

    // Candles - /api/candles/:instrument?granularity=M15&count=100
    getCandles: (instrument, granularity = "M15", count = 100) => {
        const query = new URLSearchParams({ granularity, count }).toString();
        return apiCall(`${API_ENDPOINTS.candles}/${instrument}?${query}`);
    },

    // Config
    getConfig: () => apiCall(API_ENDPOINTS.config),
    updateConfig: (config) =>
        apiCall(API_ENDPOINTS.config, {
            method: "POST",
            body: JSON.stringify(config),
        }),

    // Position Management
    closePosition: (tradeId) =>
        apiCall(`${API_ENDPOINTS.closePosition}/${tradeId}`, {
            method: "POST",
        }),

    // Trading Control (TODO: Add these routes to backend when LiveTradingEngine is built)
    startTrading: () => apiCall("/api/trading/start", { method: "POST" }),
    stopTrading: () => apiCall("/api/trading/stop", { method: "POST" }),
    resetTrading: () => apiCall("/api/trading/reset", { method: "POST" }),
};

// System API helper functions
export const systemAPI = {
    // Get comprehensive system health
    getSystemHealth: () => apiCall(API_ENDPOINTS.systemHealth),

    // Get system info (memory, environment, etc.)
    getSystemInfo: () => apiCall(API_ENDPOINTS.systemInfo),
};

export default {
    API_BASE_URL,
    SOCKET_URL,
    socket,
    API_ENDPOINTS,
    apiCall,
    tradingAPI,
    systemAPI,
};
