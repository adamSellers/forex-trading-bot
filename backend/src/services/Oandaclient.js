// backend/src/services/OandaClient.js - Oanda REST v20 API Client
const logger = require("../utils/logger");
const { buildOandaApiError } = require("../utils/oandaErrors");

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const EXPECTED_ACCOUNT_CURRENCY = "AUD";

function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeClientExtensionId(value, prefix = "intent") {
    const normalized = String(value || "")
        .trim()
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .slice(0, 110);
    return `${prefix}-${normalized || "unknown"}`.slice(0, 128);
}

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
        this.accountCurrency = EXPECTED_ACCOUNT_CURRENCY;
        this.requestTimeoutMs = Math.max(
            1000,
            toFiniteNumber(
                process.env.OANDA_REQUEST_TIMEOUT_MS,
                DEFAULT_REQUEST_TIMEOUT_MS
            )
        );
        this.instrumentMetadata = new Map();

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
            const accountCurrency = String(
                account?.account?.currency || EXPECTED_ACCOUNT_CURRENCY
            ).toUpperCase();
            if (accountCurrency !== EXPECTED_ACCOUNT_CURRENCY) {
                throw new Error(
                    `Oanda account currency must be ${EXPECTED_ACCOUNT_CURRENCY}; received ${accountCurrency}`
                );
            }
            this.accountCurrency = accountCurrency;
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
    async _request(
        method,
        endpoint,
        body = null,
        isStream = false,
        requestOptions = {}
    ) {
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

        const controller = new AbortController();
        const timeoutMs = Math.max(
            1,
            toFiniteNumber(requestOptions.timeoutMs, this.requestTimeoutMs)
        );
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        options.signal = controller.signal;

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
            if (error?.message?.includes("Oanda API Error")) {
                throw error;
            }
            const isTimeout =
                error?.name === "AbortError" || controller.signal.aborted;
            const wrapped = new Error(
                isTimeout
                    ? `Oanda request timed out after ${timeoutMs}ms`
                    : `Oanda request failed: ${error?.message || "Unknown error"}`
            );
            wrapped.name = isTimeout ? "OandaTimeoutError" : "OandaRequestError";
            wrapped.code = isTimeout ? "OANDA_TIMEOUT" : "OANDA_REQUEST_FAILED";
            // A timed-out mutating request may have reached Oanda even though the
            // response did not reach us. Callers must reconcile before retrying.
            wrapped.ambiguous = ["POST", "PUT", "PATCH", "DELETE"].includes(
                method
            );
            wrapped.cause = error;
            throw wrapped;
        } finally {
            clearTimeout(timeout);
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
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}/instruments`
        );
        for (const instrument of response?.instruments || []) {
            if (instrument?.name) {
                this.instrumentMetadata.set(instrument.name, instrument);
            }
        }
        return response;
    }

    async getInstrumentMetadata(instrument, { refresh = false } = {}) {
        if (!refresh && this.instrumentMetadata.has(instrument)) {
            return this.instrumentMetadata.get(instrument);
        }

        await this.getInstruments();
        const metadata = this.instrumentMetadata.get(instrument);
        if (!metadata) {
            throw new Error(`Oanda instrument metadata unavailable for ${instrument}`);
        }
        return metadata;
    }

    // ==================== PRICING ENDPOINTS ====================

    /**
     * Get current prices for instruments
     * @param {string[]} instruments - Array of instrument names (e.g., ["AUD_USD", "EUR_USD"])
     */
    async getPricing(instruments, options = {}) {
        const instrumentStr = instruments.join(",");
        const includeHomeConversions =
            options.includeHomeConversions === true
                ? "&includeHomeConversions=true"
                : "";
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/pricing?instruments=${encodeURIComponent(
                instrumentStr
            )}${includeHomeConversions}`
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
        const clientExtensions = options.orderIntentId
            ? this.buildClientExtensions(options.orderIntentId)
            : null;
        const orderData = {
            order: {
                type: "MARKET",
                instrument: instrument,
                units: units.toString(),
                timeInForce: "FOK", // Fill or Kill
                // Never allow a new-entry request to silently reduce an existing
                // net position. Reduction/closure effects are still parsed and
                // quarantined by the engine if Oanda returns them.
                positionFill: options.positionFill || "OPEN_ONLY",
            },
        };

        if (clientExtensions) {
            orderData.order.clientExtensions = clientExtensions.order;
            orderData.order.tradeClientExtensions = clientExtensions.trade;
        }

        if (Number.isFinite(Number(options.priceBound))) {
            orderData.order.priceBound = this.formatPrice(
                instrument,
                Number(options.priceBound),
                options.instrumentMetadata
            );
        }

        // Add stop loss if specified
        if (options.stopLossPrice) {
            orderData.order.stopLossOnFill = {
                price: this.formatPrice(
                    instrument,
                    options.stopLossPrice,
                    options.instrumentMetadata
                ),
                timeInForce: "GTC", // Good Till Cancelled
            };
        }

        // Add take profit if specified
        if (options.takeProfitPrice) {
            orderData.order.takeProfitOnFill = {
                price: this.formatPrice(
                    instrument,
                    options.takeProfitPrice,
                    options.instrumentMetadata
                ),
                timeInForce: "GTC",
            };
        }

        // Add trailing stop if specified (in pips)
        if (options.trailingStopDistance) {
            orderData.order.trailingStopLossOnFill = {
                distance: this.formatPrice(
                    instrument,
                    options.trailingStopDistance,
                    options.instrumentMetadata
                ),
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
        const clientExtensions = options.orderIntentId
            ? this.buildClientExtensions(options.orderIntentId)
            : null;
        const orderData = {
            order: {
                type: "LIMIT",
                instrument: instrument,
                units: units.toString(),
                price: this.formatPrice(
                    instrument,
                    price,
                    options.instrumentMetadata
                ),
                timeInForce: options.timeInForce || "GTC",
                positionFill: "DEFAULT",
            },
        };

        if (clientExtensions) {
            orderData.order.clientExtensions = clientExtensions.order;
            orderData.order.tradeClientExtensions = clientExtensions.trade;
        }

        if (options.stopLossPrice) {
            orderData.order.stopLossOnFill = {
                price: this.formatPrice(
                    instrument,
                    options.stopLossPrice,
                    options.instrumentMetadata
                ),
                timeInForce: "GTC",
            };
        }

        if (options.takeProfitPrice) {
            orderData.order.takeProfitOnFill = {
                price: this.formatPrice(
                    instrument,
                    options.takeProfitPrice,
                    options.instrumentMetadata
                ),
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
        let instrumentMetadata = options.instrumentMetadata || null;
        let instrument = options.instrument || instrumentMetadata?.name || null;

        if (!instrument && options.resolveInstrument === true) {
            const details = await this.getTrade(tradeId);
            instrument = details?.trade?.instrument || null;
            if (instrument) {
                instrumentMetadata = await this.getInstrumentMetadata(instrument);
            }
        }

        const formatTradePrice = (value) =>
            instrument
                ? this.formatPrice(instrument, value, instrumentMetadata)
                : Number(value).toFixed(5);

        if (options.stopLossPrice !== undefined) {
            if (options.stopLossPrice === null) {
                body.stopLoss = null; // Remove stop loss
            } else {
                body.stopLoss = {
                    price: formatTradePrice(options.stopLossPrice),
                    timeInForce: "GTC",
                };
            }
        }

        if (options.takeProfitPrice !== undefined) {
            if (options.takeProfitPrice === null) {
                body.takeProfit = null;
            } else {
                body.takeProfit = {
                    price: formatTradePrice(options.takeProfitPrice),
                    timeInForce: "GTC",
                };
            }
        }

        if (options.trailingStopDistance !== undefined) {
            if (options.trailingStopDistance === null) {
                body.trailingStopLoss = null;
            } else {
                body.trailingStopLoss = {
                    distance: formatTradePrice(options.trailingStopDistance),
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

        if (from) params.push(`from=${encodeURIComponent(from)}`);
        if (to) params.push(`to=${encodeURIComponent(to)}`);
        if (type) params.push(`type=${encodeURIComponent(type)}`);

        if (params.length > 0) {
            endpoint += "?" + params.join("&");
        }

        return this._request("GET", endpoint);
    }

    async getTransactionsSince(transactionId) {
        if (!transactionId) {
            throw new Error("A transaction ID is required for incremental retrieval");
        }
        return this._request(
            "GET",
            `/v3/accounts/${this.accountId}/transactions/sinceid?id=${encodeURIComponent(
                transactionId
            )}`
        );
    }

    buildClientExtensions(orderIntentId) {
        const orderId = sanitizeClientExtensionId(orderIntentId, "oi");
        const tradeId = sanitizeClientExtensionId(orderIntentId, "ti");
        return {
            order: {
                id: orderId,
                tag: "forex-bot-entry",
                comment: `intent:${String(orderIntentId).slice(0, 100)}`,
            },
            trade: {
                id: tradeId,
                tag: "forex-bot-trade",
                comment: `intent:${String(orderIntentId).slice(0, 100)}`,
            },
        };
    }

    getTransactionClientIds(transaction = {}) {
        return new Set(
            [
                transaction?.clientOrderID,
                transaction?.clientExtensions?.id,
                transaction?.tradeClientExtensions?.id,
                transaction?.tradeOpened?.clientExtensions?.id,
            ].filter(Boolean)
        );
    }

    /**
     * Resolve the outcome of an order whose HTTP response was lost.
     * Open trades are checked first, then the incremental transaction stream.
     */
    async findOrderIntent(orderIntentId, sinceTransactionId = null) {
        const extensions = this.buildClientExtensions(orderIntentId);
        const expectedIds = new Set([
            extensions.order.id,
            extensions.trade.id,
        ]);
        const open = await this.getOpenTrades();
        const trade = (open?.trades || []).find((candidate) =>
            expectedIds.has(candidate?.clientExtensions?.id)
        );

        let transactions = [];
        let lastTransactionId = sinceTransactionId || null;
        if (sinceTransactionId) {
            const response = await this.getTransactionsSince(sinceTransactionId);
            transactions = response?.transactions || [];
            lastTransactionId = response?.lastTransactionID || lastTransactionId;
        }

        const related = transactions.filter((transaction) => {
            const ids = this.getTransactionClientIds(transaction);
            return [...ids].some((id) => expectedIds.has(id));
        });
        const orderTransaction = related.find((tx) =>
            String(tx?.type || "").endsWith("_ORDER")
        );
        const orderId = orderTransaction?.id || null;
        const fillTransaction = transactions.find(
            (tx) =>
                tx?.type === "ORDER_FILL" &&
                (related.includes(tx) ||
                    (orderId && String(tx?.orderID) === String(orderId)))
        );
        const terminalTransaction = transactions.find(
            (tx) =>
                ["ORDER_CANCEL", "MARKET_ORDER_REJECT"].includes(tx?.type) &&
                (related.includes(tx) ||
                    (orderId && String(tx?.orderID) === String(orderId)))
        );

        if (fillTransaction) {
            return {
                status: "FILLED",
                orderFillTransaction: fillTransaction,
                orderTransaction,
                trade,
                transactions: related,
                lastTransactionId,
            };
        }
        if (trade) {
            return {
                status: "OPEN_TRADE_FOUND",
                orderFillTransaction: {
                    id: trade.openTime || null,
                    time: trade.openTime || null,
                    instrument: trade.instrument,
                    units: trade.initialUnits || trade.currentUnits,
                    price: trade.price,
                    tradeOpened: {
                        tradeID: trade.id,
                        units: trade.initialUnits || trade.currentUnits,
                        price: trade.price,
                        initialMarginRequired: trade.initialMarginRequired,
                    },
                },
                orderTransaction,
                trade,
                transactions: related,
                lastTransactionId,
            };
        }
        if (terminalTransaction) {
            return {
                status: "REJECTED",
                terminalTransaction,
                orderTransaction,
                transactions: related,
                lastTransactionId,
            };
        }

        return {
            status: "AMBIGUOUS",
            orderTransaction,
            transactions: related,
            lastTransactionId,
        };
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Calculate pip value for an instrument
     * @param {string} instrument - Instrument name
     * @returns {number} - Pip value (0.0001 for most pairs, 0.01 for JPY pairs)
     */
    getPipValue(instrument) {
        const metadata = this.instrumentMetadata.get(instrument);
        const pipLocation = toFiniteNumber(metadata?.pipLocation, null);
        if (Number.isInteger(pipLocation)) {
            return 10 ** pipLocation;
        }
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
     * @param {number|null} quoteToAudRate - AUD per unit of quote currency
     * @returns {number} - Position size in units
     */
    calculatePositionSize(
        accountBalance,
        riskPercent,
        stopLossPips,
        instrument,
        currentPrice,
        quoteToAudRate = null
    ) {
        const pipValue = this.getPipValue(instrument);
        const riskAmount = accountBalance * riskPercent;

        const stopLossPrice = stopLossPips * pipValue;
        const [baseCurrency, quoteCurrency] = String(instrument).split("_");
        let conversion = toFiniteNumber(quoteToAudRate, null);
        if (!Number.isFinite(conversion) && quoteCurrency === "AUD") {
            conversion = 1;
        }
        if (
            !Number.isFinite(conversion) &&
            baseCurrency === "AUD" &&
            Number(currentPrice) > 0
        ) {
            conversion = 1 / Number(currentPrice);
        }
        if (!Number.isFinite(conversion) || conversion <= 0) {
            throw new Error(
                `AUD quote conversion is required to size ${instrument}`
            );
        }
        const positionSize = riskAmount / (stopLossPrice * conversion);

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

    formatPrice(instrument, price, metadata = null) {
        const resolvedMetadata =
            metadata || this.instrumentMetadata.get(instrument) || null;
        const fallbackPrecision = String(instrument || "").endsWith("_JPY")
            ? 3
            : 5;
        const displayPrecision = Math.max(
            0,
            Math.min(
                12,
                Math.trunc(
                    toFiniteNumber(
                        resolvedMetadata?.displayPrecision,
                        fallbackPrecision
                    )
                )
            )
        );
        return Number(price).toFixed(displayPrecision);
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
            accountCurrency: this.accountCurrency,
            requestTimeoutMs: this.requestTimeoutMs,
        };
    }
}

// Export singleton instance
const oandaClient = new OandaClient();
module.exports = oandaClient;
