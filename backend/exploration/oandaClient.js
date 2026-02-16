// oandaClient.js - Oanda Forex API Client
// Equivalent to legacy exchange clients, adapted for Forex trading

const https = require("https");

class OandaClient {
    constructor(apiKey, accountId, isLive = true) {
        this.apiKey = apiKey;
        this.accountId = accountId;
        this.baseUrl = isLive
            ? "api-fxtrade.oanda.com"
            : "api-fxpractice.oanda.com";

        console.log(
            `🔗 Oanda Client initialized (${isLive ? "LIVE" : "PRACTICE"})`
        );
    }

    /**
     * Make authenticated request to Oanda API
     */
    async _request(method, endpoint, body = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.baseUrl,
                path: endpoint,
                method: method,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "Accept-Datetime-Format": "UNIX",
                },
            };

            const req = https.request(options, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        const json = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            reject(
                                new Error(
                                    json.errorMessage ||
                                        `HTTP ${res.statusCode}`
                                )
                            );
                        } else {
                            resolve(json);
                        }
                    } catch (e) {
                        reject(new Error(`Parse error: ${data}`));
                    }
                });
            });

            req.on("error", reject);

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    // ============== ACCOUNT ==============

    /**
     * Get account summary (balance, margin, P&L)
     */
    async getAccountSummary() {
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}/summary`
        );
        return response.account;
    }

    /**
     * Get full account details including positions
     */
    async getAccount() {
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}`
        );
        return response.account;
    }

    // ============== PRICING ==============

    /**
     * Get current price for instrument(s)
     * @param {string|string[]} instruments - e.g., 'AUD_USD' or ['AUD_USD', 'EUR_USD']
     */
    async getPrice(instruments) {
        const instrumentList = Array.isArray(instruments)
            ? instruments.join(",")
            : instruments;
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}/pricing?instruments=${instrumentList}`
        );
        return response.prices;
    }

    /**
     * Get current price formatted simply
     */
    async getCurrentPrice(instrument) {
        const prices = await this.getPrice(instrument);
        if (prices && prices.length > 0) {
            const p = prices[0];
            return {
                instrument: p.instrument,
                bid: parseFloat(p.bids[0]?.price || 0),
                ask: parseFloat(p.asks[0]?.price || 0),
                mid:
                    (parseFloat(p.bids[0]?.price || 0) +
                        parseFloat(p.asks[0]?.price || 0)) /
                    2,
                spread:
                    parseFloat(p.asks[0]?.price || 0) -
                    parseFloat(p.bids[0]?.price || 0),
                time: p.time,
            };
        }
        return null;
    }

    // ============== CANDLES ==============

    /**
     * Get historical candles
     * @param {string} instrument - e.g., 'AUD_USD'
     * @param {string} granularity - e.g., 'M15', 'H1', 'H4', 'D'
     * @param {number} count - Number of candles (max 5000)
     */
    async getCandles(instrument, granularity = "M15", count = 500) {
        const response = await this._request(
            "GET",
            `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
        );

        // Transform to match your existing candle format
        return response.candles
            .filter((c) => c.complete) // Only completed candles
            .map((c) => ({
                timestamp: Math.floor(parseFloat(c.time) * 1000), // Convert to ms
                open: parseFloat(c.mid.o),
                high: parseFloat(c.mid.h),
                low: parseFloat(c.mid.l),
                close: parseFloat(c.mid.c),
                volume: c.volume,
            }));
    }

    /**
     * Get candles with date range
     */
    async getCandlesRange(instrument, granularity, from, to) {
        const fromTime = from instanceof Date ? from.toISOString() : from;
        const toTime = to instanceof Date ? to.toISOString() : to;

        const response = await this._request(
            "GET",
            `/v3/instruments/${instrument}/candles?granularity=${granularity}&from=${fromTime}&to=${toTime}&price=M`
        );

        return response.candles
            .filter((c) => c.complete)
            .map((c) => ({
                timestamp: Math.floor(parseFloat(c.time) * 1000),
                open: parseFloat(c.mid.o),
                high: parseFloat(c.mid.h),
                low: parseFloat(c.mid.l),
                close: parseFloat(c.mid.c),
                volume: c.volume,
            }));
    }

    // ============== TRADING ==============

    /**
     * Place a market order
     * @param {string} instrument - e.g., 'AUD_USD'
     * @param {number} units - Positive for buy, negative for sell
     * @param {object} options - stopLoss, takeProfit, trailingStop
     */
    async marketOrder(instrument, units, options = {}) {
        const order = {
            type: "MARKET",
            instrument: instrument,
            units: String(units), // Oanda wants string
            timeInForce: "FOK", // Fill or Kill
            positionFill: "DEFAULT",
        };

        // Add stop loss if specified
        if (options.stopLoss) {
            order.stopLossOnFill = {
                price: String(options.stopLoss.toFixed(5)),
            };
        }

        // Add take profit if specified
        if (options.takeProfit) {
            order.takeProfitOnFill = {
                price: String(options.takeProfit.toFixed(5)),
            };
        }

        // Add trailing stop if specified (in price distance)
        if (options.trailingStopDistance) {
            order.trailingStopLossOnFill = {
                distance: String(options.trailingStopDistance.toFixed(5)),
            };
        }

        const response = await this._request(
            "POST",
            `/v3/accounts/${this.accountId}/orders`,
            { order }
        );

        return response;
    }

    /**
     * Close a specific trade
     * @param {string} tradeId - The trade ID to close
     * @param {number} units - Units to close (optional, closes all if not specified)
     */
    async closeTrade(tradeId, units = null) {
        const body = units ? { units: String(Math.abs(units)) } : {};

        const response = await this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/trades/${tradeId}/close`,
            body
        );

        return response;
    }

    /**
     * Close all units of a position for an instrument
     * @param {string} instrument - e.g., 'AUD_USD'
     * @param {string} side - 'long' or 'short'
     */
    async closePosition(instrument, side = "long") {
        const body =
            side === "long" ? { longUnits: "ALL" } : { shortUnits: "ALL" };

        const response = await this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/positions/${instrument}/close`,
            body
        );

        return response;
    }

    /**
     * Get open trades
     */
    async getOpenTrades() {
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}/openTrades`
        );
        return response.trades;
    }

    /**
     * Get open positions
     */
    async getOpenPositions() {
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}/openPositions`
        );
        return response.positions;
    }

    /**
     * Modify an existing trade (update stop loss, take profit)
     */
    async modifyTrade(tradeId, options = {}) {
        const body = {};

        if (options.stopLoss !== undefined) {
            body.stopLoss = options.stopLoss
                ? { price: String(options.stopLoss.toFixed(5)) }
                : null; // null removes the stop loss
        }

        if (options.takeProfit !== undefined) {
            body.takeProfit = options.takeProfit
                ? { price: String(options.takeProfit.toFixed(5)) }
                : null;
        }

        if (options.trailingStopDistance !== undefined) {
            body.trailingStopLoss = options.trailingStopDistance
                ? { distance: String(options.trailingStopDistance.toFixed(5)) }
                : null;
        }

        const response = await this._request(
            "PUT",
            `/v3/accounts/${this.accountId}/trades/${tradeId}/orders`,
            body
        );

        return response;
    }

    // ============== UTILITIES ==============

    /**
     * Get available instruments (currency pairs)
     */
    async getInstruments() {
        const response = await this._request(
            "GET",
            `/v3/accounts/${this.accountId}/instruments`
        );
        return response.instruments;
    }

    /**
     * Calculate pip value for an instrument
     * Note: Most pairs have pip at 4th decimal (0.0001), JPY pairs at 2nd (0.01)
     */
    getPipSize(instrument) {
        if (instrument.includes("JPY")) {
            return 0.01;
        }
        return 0.0001;
    }

    /**
     * Convert price movement to pips
     */
    priceToPips(instrument, priceChange) {
        return priceChange / this.getPipSize(instrument);
    }

    /**
     * Convert pips to price movement
     */
    pipsToPrice(instrument, pips) {
        return pips * this.getPipSize(instrument);
    }
}

module.exports = OandaClient;
