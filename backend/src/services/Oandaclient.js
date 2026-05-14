// backend/src/services/OandaClient.js - Oanda REST v20 API Client
const logger = require("../utils/logger");
const { buildOandaApiError } = require("../utils/oandaErrors");

class OandaClient {
    constructor() {
        this.apiKey = process.env.OANDA_API_KEY;
        this.accountId = process.env.OANDA_ACCOUNT_ID || "001-011-20128302-001";

        // Use live API (not practice)
        this.baseUrl =
            process.env.OANDA_ENVIRONMENT === "practice"
                ? "https://api-fxpractice.oanda.com"
                : "https://api-fxtrade.oanda.com";

        this.streamUrl =
            process.env.OANDA_ENVIRONMENT === "practice"
                ? "https://stream-fxpractice.oanda.com"
                : "https://stream-fxtrade.oanda.com";

        this.isInitialized = false;

        if (!this.apiKey) {
            logger.warn(
                "⚠️ No Oanda API key found in environment variables. Trading features will be disabled."
            );
        } else {
            const visibleKey =
                this.apiKey.length > 8
                    ? `${this.apiKey.substring(0, 4)}...${this.apiKey.slice(
                          -4
                      )}`
                    : "INVALID/SHORT";
            logger.info(`🔑 Oanda API Key detected: ${visibleKey}`);
            logger.info(
                `🌐 Using Oanda ${
                    process.env.OANDA_ENVIRONMENT === "practice"
                        ? "PRACTICE"
                        : "LIVE"
                } environment`
            );
        }
    }

    /**
     * Initialize and verify connection to Oanda
     */
    async initialize() {
        if (!this.apiKey) {
            throw new Error("Oanda API key not configured");
        }

        try {
            const account = await this.getAccountSummary();
            logger.success(
                `✅ Oanda connection verified. Account: ${account.account.id}, Balance: ${account.account.balance} ${account.account.currency}`
            );
            this.isInitialized = true;
            return account;
        } catch (error) {
            logger.error("❌ Oanda connection failed:", error.message);
            throw error;
        }
    }

    /**
     * Make authenticated request to Oanda API
     */
    async _request(method, endpoint, body = null, isStream = false) {
        const url = `${isStream ? this.streamUrl : this.baseUrl}${endpoint}`;

        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Accept-Datetime-Format": "UNIX",
        };

        const options = {
            method,
            headers,
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                throw await buildOandaApiError(response);
            }

            return await response.json();
        } catch (error) {
            if (error.message.includes("Oanda API Error")) {
                throw error;
            }
            throw new Error(`Oanda request failed: ${error.message}`);
        }
    }

    // ==================== ACCOUNT ENDPOINTS ====================

    /**
     * Get account summary (balance, margin, etc.)
     */
    async getAccountSummary() {
        return this._request("GET", `/v3/accounts/${this.accountId}/summary`);
    }

    /**
     * Get detailed account info including positions
     */
    async getAccountDetails() {
        return this._request("GET", `/v3/accounts/${this.accountId}`);
    }

    /**
     * Get account instruments (tradeable pairs)
     */
    async getInstruments() {
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/instruments`
        );
    }

    // ==================== PRICING ENDPOINTS ====================

    /**
     * Get current prices for instruments
     * @param {string[]} instruments - Array of instrument names (e.g., ["AUD_USD", "EUR_USD"])
     */
    async getPricing(instruments) {
        const instrumentStr = instruments.join(",");
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/pricing?instruments=${instrumentStr}`
        );
    }

    /**
     * Get candlestick data
     * @param {string} instrument - Instrument name (e.g., "AUD_USD")
     * @param {string} granularity - Candle size (M1, M5, M15, H1, H4, D, etc.)
     * @param {number} count - Number of candles (max 5000)
     * @param {object} options - Additional options (from, to, etc.)
     */
    async getCandles(
        instrument,
        granularity = "M15",
        count = 500,
        options = {}
    ) {
        let endpoint = `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}`;

        if (options.from) {
            endpoint += `&from=${options.from}`;
        }
        if (options.to) {
            endpoint += `&to=${options.to}`;
        }
        if (options.price) {
            endpoint += `&price=${options.price}`; // M=mid, B=bid, A=ask, BA=bid+ask
        } else {
            endpoint += "&price=M"; // Default to mid prices
        }

        return this._request("GET", endpoint);
    }

    // ==================== ORDER ENDPOINTS ====================

    /**
     * Place a market order
     * @param {string} instrument - Instrument name (e.g., "AUD_USD")
     * @param {number} units - Positive for buy, negative for sell
     * @param {object} options - Stop loss, take profit, etc.
     */
    async placeMarketOrder(instrument, units, options = {}) {
        const orderData = {
            order: {
                type: "MARKET",
                instrument: instrument,
                units: units.toString(),
                timeInForce: "FOK", // Fill or Kill
                positionFill: "DEFAULT",
            },
        };

        // Add stop loss if specified
        if (options.stopLossPrice) {
            orderData.order.stopLossOnFill = {
                price: options.stopLossPrice.toFixed(5),
                timeInForce: "GTC", // Good Till Cancelled
            };
        }

        // Add take profit if specified
        if (options.takeProfitPrice) {
            orderData.order.takeProfitOnFill = {
                price: options.takeProfitPrice.toFixed(5),
                timeInForce: "GTC",
            };
        }

        // Add trailing stop if specified (in pips)
        if (options.trailingStopDistance) {
            orderData.order.trailingStopLossOnFill = {
                distance: options.trailingStopDistance.toFixed(5),
                timeInForce: "GTC",
            };
        }

        return this._request(
            "POST",
            `/v3/accounts/${this.accountId}/orders`,
            orderData
        );
    }

    /**
     * Place a limit order
     */
    async placeLimitOrder(instrument, units, price, options = {}) {
        const orderData = {
            order: {
                type: "LIMIT",
                instrument: instrument,
                units: units.toString(),
                price: price.toFixed(5),
                timeInForce: options.timeInForce || "GTC",
                positionFill: "DEFAULT",
            },
        };

        if (options.stopLossPrice) {
            orderData.order.stopLossOnFill = {
                price: options.stopLossPrice.toFixed(5),
                timeInForce: "GTC",
            };
        }

        if (options.takeProfitPrice) {
            orderData.order.takeProfitOnFill = {
                price: options.takeProfitPrice.toFixed(5),
                timeInForce: "GTC",
            };
        }

        return this._request(
            "POST",
            `/v3/accounts/${this.accountId}/orders`,
            orderData
        );
    }

    /**
     * Get pending orders
     */
    async getPendingOrders() {
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/pendingOrders`
        );
    }

    /**
     * Cancel an order
     */
    async cancelOrder(orderId) {
        return this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/orders/${orderId}/cancel`
        );
    }

    // ==================== TRADE ENDPOINTS ====================

    /**
     * Get open trades
     */
    async getOpenTrades() {
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/openTrades`
        );
    }

    /**
     * Get a specific trade
     */
    async getTrade(tradeId) {
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/trades/${tradeId}`
        );
    }

    /**
     * Close a trade (partially or fully)
     * @param {string} tradeId - Trade ID
     * @param {number|string} units - Units to close ("ALL" for full close)
     */
    async closeTrade(tradeId, units = "ALL") {
        const body = units === "ALL" ? {} : { units: units.toString() };
        return this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/trades/${tradeId}/close`,
            body
        );
    }

    /**
     * Modify trade stop loss / take profit
     */
    async modifyTrade(tradeId, options = {}) {
        const body = {};

        if (options.stopLossPrice !== undefined) {
            if (options.stopLossPrice === null) {
                body.stopLoss = null; // Remove stop loss
            } else {
                body.stopLoss = {
                    price: options.stopLossPrice.toFixed(5),
                    timeInForce: "GTC",
                };
            }
        }

        if (options.takeProfitPrice !== undefined) {
            if (options.takeProfitPrice === null) {
                body.takeProfit = null;
            } else {
                body.takeProfit = {
                    price: options.takeProfitPrice.toFixed(5),
                    timeInForce: "GTC",
                };
            }
        }

        if (options.trailingStopDistance !== undefined) {
            if (options.trailingStopDistance === null) {
                body.trailingStopLoss = null;
            } else {
                body.trailingStopLoss = {
                    distance: options.trailingStopDistance.toFixed(5),
                    timeInForce: "GTC",
                };
            }
        }

        return this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/trades/${tradeId}/orders`,
            body
        );
    }

    // ==================== POSITION ENDPOINTS ====================

    /**
     * Get all positions
     */
    async getPositions() {
        return this._request("GET", `/v3/accounts/${this.accountId}/positions`);
    }

    /**
     * Get position for specific instrument
     */
    async getPosition(instrument) {
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/positions/${instrument}`
        );
    }

    /**
     * Close a position (all units for an instrument)
     * @param {string} instrument - Instrument name
     * @param {string} side - "long" or "short" or "all"
     */
    async closePosition(instrument, side = "all") {
        const body = {};
        if (side === "long" || side === "all") {
            body.longUnits = "ALL";
        }
        if (side === "short" || side === "all") {
            body.shortUnits = "ALL";
        }
        return this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/positions/${instrument}/close`,
            body
        );
    }

    // ==================== TRANSACTION ENDPOINTS ====================

    /**
     * Get recent transactions
     */
    async getTransactions(from = null, to = null, type = null) {
        let endpoint = `/v3/accounts/${this.accountId}/transactions`;
        const params = [];

        if (from) params.push(`from=${from}`);
        if (to) params.push(`to=${to}`);
        if (type) params.push(`type=${type}`);

        if (params.length > 0) {
            endpoint += "?" + params.join("&");
        }

        return this._request("GET", endpoint);
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Calculate pip value for an instrument
     * @param {string} instrument - Instrument name
     * @returns {number} - Pip value (0.0001 for most pairs, 0.01 for JPY pairs)
     */
    getPipValue(instrument) {
        // JPY pairs have pip at 2nd decimal place
        if (instrument.includes("JPY")) {
            return 0.01;
        }
        // All other pairs have pip at 4th decimal place
        return 0.0001;
    }

    /**
     * Calculate position size based on risk
     * @param {number} accountBalance - Account balance in base currency
     * @param {number} riskPercent - Risk percentage (e.g., 0.01 for 1%)
     * @param {number} stopLossPips - Stop loss distance in pips
     * @param {string} instrument - Instrument name
     * @param {number} currentPrice - Current price of the instrument
     * @returns {number} - Position size in units
     */
    calculatePositionSize(
        accountBalance,
        riskPercent,
        stopLossPips,
        instrument,
        currentPrice
    ) {
        const pipValue = this.getPipValue(instrument);
        const riskAmount = accountBalance * riskPercent;

        // For AUD account trading pairs:
        // Risk = Position Size × Stop Loss (in price) × Conversion Factor
        // Position Size = Risk / (Stop Loss × Conversion Factor)

        const stopLossPrice = stopLossPips * pipValue;

        // Simplified calculation - assumes quote currency conversion
        // For more accuracy, would need to factor in account currency conversion
        const positionSize = riskAmount / (stopLossPrice * currentPrice);

        // Round to whole units (Oanda accepts fractional units, but we'll use whole)
        return Math.floor(positionSize);
    }

    /**
     * Convert pips to price distance
     */
    pipsToPrice(pips, instrument) {
        return pips * this.getPipValue(instrument);
    }

    /**
     * Convert price distance to pips
     */
    priceToPips(priceDistance, instrument) {
        return priceDistance / this.getPipValue(instrument);
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            accountId: this.accountId,
            environment:
                process.env.OANDA_ENVIRONMENT === "practice"
                    ? "PRACTICE"
                    : "LIVE",
            baseUrl: this.baseUrl,
        };
    }
}

// Export singleton instance
const oandaClient = new OandaClient();
module.exports = oandaClient;
