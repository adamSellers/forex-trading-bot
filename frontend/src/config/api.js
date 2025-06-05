// frontend/src/config/api.js - NEW FILE
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
    },
};

// Helper function for making API calls
export const apiCall = async (endpoint, options = {}) => {
    const url = `${API_BASE_URL}${endpoint}`;
    const defaultOptions = {
        headers: {
            "Content-Type": "application/json",
        },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (!response.ok) {
        throw new Error(
            `API call failed: ${response.status} ${response.statusText}`
        );
    }

    return response.json();
};
