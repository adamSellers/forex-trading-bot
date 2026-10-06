// Research-only broker adapter. Prices are supplied quote observations, never
// inferred intrabar ticks. No credentials, network or production database access.
const { priceDistanceError, exceedsQuoteLimit } = require('../src/runtime/quoteMath');

const copy = (value) => JSON.parse(JSON.stringify(value));
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

class ReplayDataError extends Error {
    constructor(message, code = 'REPLAY_DATA_UNAVAILABLE') {
        super(message);
        this.name = 'ReplayDataError';
        this.code = code;
    }
}

class ReplayBroker {
    constructor({ clock, market, initialBalanceAud = 100, metadata = {}, slippagePips = 0, commissionAud = 0 } = {}) {
        if (typeof clock?.nowMs !== 'function' || typeof market?.getQuote !== 'function' ||
            typeof market?.getHomeConversions !== 'function') {
            throw new ReplayDataError('ReplayBroker requires a clock, quote provider and home-conversion provider');
        }
        for (const [name, value] of Object.entries({ initialBalanceAud, slippagePips, commissionAud })) {
            if (!finite(value) || Number(value) < 0) throw new ReplayDataError(`Invalid ${name}`);
        }
        this.clock = clock;
        this.market = market;
        this.initialBalanceAud = Number(initialBalanceAud);
        this.balanceAud = this.initialBalanceAud;
        this.metadata = metadata instanceof Map ? new Map(metadata) : new Map(Object.entries(metadata));
        this.slippagePips = Number(slippagePips); // Adverse pips per execution.
        this.commissionAud = Number(commissionAud); // Fixed AUD per execution, including entry.
        this.trades = new Map();
        this.intents = new Map();
        this.transactions = [];
        this.ledger = [];
        this.financingEvents = new Map();
        this.nextTransactionId = 1;
        this.nextTradeId = 1;
        this.isInitialized = false;
    }

    nowMs() {
        const now = this.clock.nowMs();
        if (!finite(now)) throw new ReplayDataError('Replay clock is unavailable');
        return Number(now);
    }

    _metadata(instrument, override = null) {
        const value = override || this.metadata.get(instrument);
        if (!value || (value.name && value.name !== instrument) ||
            !Number.isInteger(Number(value.displayPrecision)) || !finite(value.displayPrecision) ||
            Number(value.displayPrecision) < 0 || Number(value.displayPrecision) > 12 ||
            !Number.isInteger(Number(value.pipLocation)) || !finite(value.pipLocation) ||
            !finite(value.marginRate) || Number(value.marginRate) <= 0) {
            throw new ReplayDataError(`Explicit valid instrument metadata is required for ${instrument}`, 'REPLAY_METADATA_UNAVAILABLE');
        }
        return { ...value, name: instrument, displayPrecision: Number(value.displayPrecision),
            pipLocation: Number(value.pipLocation), marginRate: String(value.marginRate) };
    }

    _quote(instrument, supplied = null) {
        const quote = supplied || this.market.getQuote(instrument);
        if (!quote || quote.instrument !== instrument || !quote.time) {
            throw new ReplayDataError(`Quote observation unavailable for ${instrument}`, 'REPLAY_QUOTE_UNAVAILABLE');
        }
        // Validate a real executable book. An unavailable row with empty buckets
        // cannot masquerade as a zero-spread quote.
        this.getExecutableQuote(quote, 'BUY', 1);
        return copy(quote);
    }

    _rate(currency, purpose, amount = 0) {
        if (currency === 'AUD') return 1; // Account currency identity, not an FX assumption.
        const rows = this.market.getHomeConversions();
        if (!Array.isArray(rows)) throw new ReplayDataError('Home-conversion observations are unavailable', 'REPLAY_CONVERSION_UNAVAILABLE');
        const matches = rows.filter((row) => row?.currency === currency);
        const field = purpose === 'position' ? 'positionValue' : amount < 0 ? 'accountLoss' : 'accountGain';
        const value = matches.length === 1 ? matches[0][field] : null;
        if (!finite(value) || Number(value) <= 0) {
            throw new ReplayDataError(`${currency} ${field} conversion to AUD is unavailable`, 'REPLAY_CONVERSION_UNAVAILABLE');
        }
        return Number(value);
    }

    _currencies(instrument) {
        const currencies = String(instrument).split('_');
        if (currencies.length !== 2 || currencies.some((currency) => !/^[A-Z]{3}$/.test(currency))) {
            throw new ReplayDataError(`Invalid research instrument ${instrument}`);
        }
        return currencies;
    }

    _isTradeable(quote) {
        if (quote.tradeable === true || quote.status === 'tradeable') return true;
        if (quote.tradeable === false || (quote.status && quote.status !== 'tradeable')) return false;
        throw new ReplayDataError('Quote tradeability is unobserved; declare the pricing assumption explicitly', 'REPLAY_TRADEABILITY_UNAVAILABLE');
    }

    _transaction(type, fields = {}) {
        const transaction = { id: String(this.nextTransactionId++), type,
            time: new Date(this.nowMs()).toISOString(), accountID: 'research-account', ...fields };
        this.transactions.push(copy(transaction));
        return transaction;
    }

    _record(type, details = {}) {
        this.ledger.push({ sequence: this.ledger.length + 1, atMs: this.nowMs(), type,
            ...copy(details), balanceAud: this.balanceAud });
    }

    _response(transactions, fields) {
        return { ...fields, relatedTransactionIDs: transactions.map((transaction) => transaction.id),
            lastTransactionID: String(this.nextTransactionId - 1) };
    }

    _trade(id, requireOpen = false) {
        const trade = this.trades.get(String(id));
        if (!trade || (requireOpen && trade.state !== 'OPEN')) {
            throw new ReplayDataError(`Research trade ${id} ${requireOpen ? 'is not open' : 'is unavailable'}`, 'REPLAY_TRADE_UNAVAILABLE');
        }
        return trade;
    }

    getPipValue(instrument) { return 10 ** this._metadata(instrument).pipLocation; }

    formatPrice(instrument, price, metadata = null) {
        if (!finite(price)) throw new ReplayDataError(`Invalid price for ${instrument}`);
        return Number(price).toFixed(this._metadata(instrument, metadata).displayPrecision);
    }

    formatPriceBound(instrument, price, side, metadata = null) {
        const formatted = this.formatPrice(instrument, price, metadata);
        const rounded = Number(formatted);
        const direction = side === 'SELL' ? -1 : 1;
        if (exceedsQuoteLimit(direction * (rounded - Number(price)), 0, priceDistanceError(rounded, Number(price), 1))) {
            return this.formatPrice(instrument, rounded - direction * 10 ** -this._metadata(instrument, metadata).displayPrecision, metadata);
        }
        return formatted;
    }

    getExecutableQuote(price, side, units = 1) {
        const requested = Math.abs(Number(units));
        if (!finite(units) || requested <= 0) throw new ReplayDataError('Executable quote requires positive units');
        if (!['BUY', 'SELL'].includes(side)) throw new ReplayDataError('Executable side must be BUY or SELL');
        const consume = (buckets, descending) => {
            const levels = (Array.isArray(buckets) ? buckets : [])
                .filter((bucket) => finite(bucket?.price) && Number(bucket.price) > 0 &&
                    finite(bucket.liquidity) && Number(bucket.liquidity) > 0)
                .map((bucket) => ({ price: Number(bucket.price), liquidity: Number(bucket.liquidity) }))
                .sort((a, b) => descending ? b.price - a.price : a.price - b.price);
            if (!levels.length) throw new ReplayDataError('Executable price observation is unavailable', 'REPLAY_QUOTE_UNAVAILABLE');
            let remaining = requested;
            let value = 0;
            let worstPrice = null;
            for (const level of levels) {
                const consumed = Math.min(remaining, level.liquidity);
                value += consumed * level.price;
                remaining -= consumed;
                worstPrice = level.price;
                if (remaining <= 0) break;
            }
            if (remaining > 0) throw new ReplayDataError('Insufficient executable pricing liquidity', 'REPLAY_LIQUIDITY_UNAVAILABLE');
            return { price: value / requested, worstPrice };
        };
        const bid = consume(price?.bids, true);
        const ask = consume(price?.asks, false);
        if (ask.price < bid.price) throw new ReplayDataError('Crossed executable pricing book', 'REPLAY_QUOTE_UNAVAILABLE');
        const selected = side === 'SELL' ? bid : ask;
        return { executablePrice: selected.price, worstPrice: selected.worstPrice,
            bid: bid.price, ask: ask.price, spread: ask.price - bid.price, units: requested };
    }

    buildClientExtensions(orderIntentId) {
        const suffix = String(orderIntentId || '').trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 110);
        if (!suffix) throw new ReplayDataError('An order intent ID is required');
        return { order: { id: `oi-${suffix}`.slice(0, 128), tag: 'forex-bot-entry', comment: `intent:${String(orderIntentId).slice(0, 100)}` },
            trade: { id: `ti-${suffix}`.slice(0, 128), tag: 'forex-bot-trade', comment: `intent:${String(orderIntentId).slice(0, 100)}` } };
    }

    _liquidationPrice(trade, quote) {
        const isLong = Number(trade.currentUnits) > 0;
        const closeout = isLong ? quote.closeoutBid : quote.closeoutAsk;
        if (closeout !== undefined && closeout !== null) {
            if (!finite(closeout) || Number(closeout) <= 0) throw new ReplayDataError('Invalid closeout price observation');
            return Number(closeout);
        }
        return this.getExecutableQuote(quote, isLong ? 'SELL' : 'BUY', trade.currentUnits).executablePrice;
    }

    _valuation(trade, quote = null) {
        const observation = this._quote(trade.instrument, quote);
        const exit = this._liquidationPrice(trade, observation);
        const quoteProfit = (exit - Number(trade.price)) * Number(trade.currentUnits);
        const [base, counter] = this._currencies(trade.instrument);
        const pnlAud = quoteProfit === 0 ? 0 : quoteProfit * this._rate(counter, 'pnl', quoteProfit);
        const marginAud = Math.abs(Number(trade.currentUnits)) * this._rate(base, 'position') * Number(this._metadata(trade.instrument).marginRate);
        return { quote: observation, exit, pnlAud, marginAud };
    }

    async initialize() { this.isInitialized = true; return this.getAccountSummary(); }

    async getAccountSummary() {
        let unrealizedPL = 0;
        let marginUsed = 0;
        for (const trade of this.trades.values()) {
            if (trade.state !== 'OPEN') continue;
            const value = this._valuation(trade);
            unrealizedPL += value.pnlAud;
            marginUsed += value.marginAud;
        }
        const NAV = this.balanceAud + unrealizedPL;
        return { account: { id: 'research-account', currency: 'AUD', balance: String(this.balanceAud),
            NAV: String(NAV), unrealizedPL: String(unrealizedPL), marginUsed: String(marginUsed),
            marginAvailable: String(Math.max(0, NAV - marginUsed)), openTradeCount: [...this.trades.values()].filter((trade) => trade.state === 'OPEN').length,
            lastTransactionID: String(this.nextTransactionId - 1) }, lastTransactionID: String(this.nextTransactionId - 1) };
    }

    async getOpenTrades() {
        return { trades: [...this.trades.values()].filter((trade) => trade.state === 'OPEN').map((trade) => {
            const value = this._valuation(trade);
            return { ...copy(trade), unrealizedPL: String(value.pnlAud), marginUsed: String(value.marginAud) };
        }), lastTransactionID: String(this.nextTransactionId - 1) };
    }

    async getPricing(instruments, options = {}) {
        const prices = instruments.map((instrument) => this._quote(instrument));
        const result = { prices, time: new Date(this.nowMs()).toISOString() };
        if (options.includeHomeConversions === true) {
            const rows = this.market.getHomeConversions();
            if (!Array.isArray(rows)) throw new ReplayDataError('Home-conversion observations are unavailable', 'REPLAY_CONVERSION_UNAVAILABLE');
            result.homeConversions = copy(rows);
        }
        return result;
    }

    async getTrade(id) {
        const trade = this._trade(id);
        const value = trade.state === 'OPEN' ? this._valuation(trade) : { pnlAud: 0, marginAud: 0 };
        return { trade: { ...copy(trade), unrealizedPL: String(value.pnlAud), marginUsed: String(value.marginAud) },
            lastTransactionID: String(this.nextTransactionId - 1) };
    }

    async getInstrumentMetadata(instrument) { return copy(this._metadata(instrument)); }

    _rejectOrder(instrument, units, options, reason) {
        const extensions = options.orderIntentId ? this.buildClientExtensions(options.orderIntentId) : null;
        const transaction = this._transaction('MARKET_ORDER_REJECT', { instrument, units: String(units),
            reason, rejectReason: reason, ...(extensions ? { clientExtensions: extensions.order } : {}) });
        const result = this._response([transaction], { orderRejectTransaction: transaction, errorCode: reason });
        if (options.orderIntentId) this.intents.set(String(options.orderIntentId), { status: 'REJECTED', terminalTransaction: transaction });
        this._record('ORDER_REJECTED', { instrument, units, reason, orderIntentId: options.orderIntentId || null });
        return result;
    }

    _protection(trade, kind, price) {
        const type = kind === 'stopLoss' ? 'STOP_LOSS' : 'TAKE_PROFIT';
        const transaction = this._transaction(type, { tradeID: trade.id,
            price: this.formatPrice(trade.instrument, price), timeInForce: 'GTC', triggerCondition: 'DEFAULT' });
        const order = { ...transaction, state: 'PENDING', createTime: transaction.time };
        return { transaction, order };
    }

    async placeMarketOrder(instrument, units, options = {}) {
        this._metadata(instrument);
        if (options.orderIntentId && this.intents.has(String(options.orderIntentId))) {
            throw new ReplayDataError('An order intent was already submitted; recover its outcome rather than resubmit', 'REPLAY_DUPLICATE_INTENT');
        }
        if (!finite(units) || !Number.isInteger(Number(units)) || Number(units) === 0) {
            return this._rejectOrder(instrument, units, options, 'UNITS_INVALID');
        }
        units = Number(units);
        const quote = this._quote(instrument);
        if (!this._isTradeable(quote)) {
            return this._rejectOrder(instrument, units, options, 'INSTRUMENT_NOT_TRADEABLE');
        }
        const side = units < 0 ? 'SELL' : 'BUY';
        let executable;
        try { executable = this.getExecutableQuote(quote, side, units); }
        catch (error) {
            if (error.code === 'REPLAY_LIQUIDITY_UNAVAILABLE') return this._rejectOrder(instrument, units, options, 'INSUFFICIENT_LIQUIDITY');
            throw error;
        }
        const direction = units < 0 ? -1 : 1;
        const fill = Number(this.formatPrice(instrument, executable.executablePrice + direction * this.slippagePips * this.getPipValue(instrument)));
        if (!(fill > 0)) throw new ReplayDataError('Slippage assumption implies an invalid execution price');
        if (options.priceBound !== undefined && options.priceBound !== null) {
            if (!finite(options.priceBound)) throw new ReplayDataError('Invalid price bound');
            const bound = Number(this.formatPriceBound(instrument, options.priceBound, side));
            // A bound limits every consumed price level, rather than only the
            // volume-weighted mean. The whole order is fill-or-kill.
            const worstFill = Number(this.formatPrice(instrument, executable.worstPrice + direction * this.slippagePips * this.getPipValue(instrument)));
            if (exceedsQuoteLimit(direction * (worstFill - bound), 0, priceDistanceError(worstFill, bound, 1))) {
                return this._rejectOrder(instrument, units, options, 'PRICE_BOUND_EXCEEDED');
            }
        }
        const [base, counter] = this._currencies(instrument);
        const margin = Math.abs(units) * this._rate(base, 'position') * Number(this._metadata(instrument).marginRate);
        // Require both P/L conversion directions before accepting exposure.
        this._rate(counter, 'pnl', -1);
        this._rate(counter, 'pnl', 1);
        const account = (await this.getAccountSummary()).account;
        const liquidation = this._liquidationPrice({ instrument, currentUnits: String(units) }, quote);
        const initialQuotePL = (liquidation - fill) * units;
        const initialPnlAud = initialQuotePL === 0 ? 0 : initialQuotePL * this._rate(counter, 'pnl', initialQuotePL);
        if (margin > Number(account.marginAvailable) - this.commissionAud + initialPnlAud) {
            return this._rejectOrder(instrument, units, options, 'INSUFFICIENT_MARGIN');
        }
        for (const [kind, value] of [['stopLoss', options.stopLossPrice], ['takeProfit', options.takeProfitPrice]]) {
            if (value === undefined || value === null) continue;
            const price = Number(this.formatPrice(instrument, value));
            if (!(price > 0) || (kind === 'stopLoss' ? direction * (price - fill) >= 0 : direction * (price - fill) <= 0)) {
                return this._rejectOrder(instrument, units, options, 'PROTECTION_PRICE_INVALID');
            }
        }
        const extensions = options.orderIntentId ? this.buildClientExtensions(options.orderIntentId) : null;
        const create = this._transaction('MARKET_ORDER', { instrument, units: String(units), positionFill: options.positionFill || 'OPEN_ONLY',
            ...(extensions ? { clientExtensions: extensions.order, tradeClientExtensions: extensions.trade } : {}) });
        const id = String(this.nextTradeId++);
        const trade = { id, instrument, state: 'OPEN', price: this.formatPrice(instrument, fill),
            initialUnits: String(units), currentUnits: String(units), openTime: new Date(this.nowMs()).toISOString(),
            initialMarginRequired: String(margin), realizedPL: '0', financing: '0', commission: String(this.commissionAud),
            guaranteedExecutionFee: '0', dividendAdjustment: '0', closingTransactionIDs: [],
            ...(extensions ? { clientExtensions: extensions.trade } : {}) };
        const fillTransaction = this._transaction('ORDER_FILL', { orderID: create.id, reason: 'MARKET_ORDER', instrument,
            units: String(units), price: trade.price, commission: String(this.commissionAud), pl: '0', financing: '0',
            ...(extensions ? { clientOrderID: extensions.order.id } : {}),
            tradeOpened: { tradeID: id, units: String(units), price: trade.price,
                initialMarginRequired: String(margin), ...(extensions ? { clientExtensions: extensions.trade } : {}) } });
        this.trades.set(id, trade);
        this.balanceAud -= this.commissionAud;
        const transactions = [create, fillTransaction];
        const result = { orderCreateTransaction: create, orderFillTransaction: fillTransaction };
        for (const [kind, value] of [['stopLoss', options.stopLossPrice], ['takeProfit', options.takeProfitPrice]]) {
            if (value === undefined || value === null) continue;
            const protection = this._protection(trade, kind, value);
            trade[`${kind}Order`] = protection.order;
            result[`${kind}OrderTransaction`] = protection.transaction;
            transactions.push(protection.transaction);
        }
        if (options.orderIntentId) this.intents.set(String(options.orderIntentId), { status: 'FILLED', orderTransaction: create,
            orderFillTransaction: fillTransaction, tradeId: id });
        this._record('TRADE_OPENED', { tradeId: id, instrument, units, fillPrice: fill, marginAud: margin,
            commissionAud: this.commissionAud, quoteEventTime: quote.time, orderIntentId: options.orderIntentId || null });
        return this._response(transactions, result);
    }

    async modifyTrade(id, options = {}) {
        const trade = this._trade(id, true);
        const response = {};
        const transactions = [];
        // Validate all requested prices before changing any protection.
        for (const kind of ['stopLoss', 'takeProfit']) {
            const value = options[`${kind}Price`];
            if (value !== undefined && value !== null && !(Number(this.formatPrice(trade.instrument, value)) > 0)) {
                throw new ReplayDataError('Protection price must be positive');
            }
        }
        if (options.trailingStopDistance !== undefined) throw new ReplayDataError('Broker trailing orders are unsupported in this replay adapter');
        for (const kind of ['stopLoss', 'takeProfit']) {
            const value = options[`${kind}Price`];
            if (value === undefined) continue;
            if (trade[`${kind}Order`]?.state === 'PENDING') {
                const cancelled = this._transaction('ORDER_CANCEL', { orderID: trade[`${kind}Order`].id, tradeID: trade.id, reason: 'CLIENT_REQUEST' });
                transactions.push(cancelled);
                response[`${kind}OrderCancelTransaction`] = cancelled;
            }
            if (value === null) { delete trade[`${kind}Order`]; continue; }
            const protection = this._protection(trade, kind, value);
            trade[`${kind}Order`] = protection.order;
            response[`${kind}OrderTransaction`] = protection.transaction;
            transactions.push(protection.transaction);
        }
        this._record('PROTECTION_CHANGED', { tradeId: trade.id, instrument: trade.instrument, options });
        return this._response(transactions, response);
    }

    _close(trade, quote, reason, triggeredOrder = null) {
        const liquidation = this._liquidationPrice(trade, quote);
        const units = Number(trade.currentUnits);
        const direction = units > 0 ? -1 : 1;
        let price = Number(this.formatPrice(trade.instrument, liquidation + direction * this.slippagePips * this.getPipValue(trade.instrument)));
        // OANDA TakeProfitOrder closes at the threshold or better. Adverse
        // market-slippage sensitivity must not turn a target into a worse fill.
        // Contract: https://developer.oanda.com/rest-live-v20/order-df/
        if (reason === 'TAKE_PROFIT_ORDER') {
            price = units > 0 ? Math.max(price, Number(triggeredOrder.price)) : Math.min(price, Number(triggeredOrder.price));
        }
        if (!(price > 0)) throw new ReplayDataError('Slippage assumption implies an invalid execution price');
        const quotePL = (price - Number(trade.price)) * units;
        const [, counter] = this._currencies(trade.instrument);
        const grossPL = quotePL === 0 ? 0 : quotePL * this._rate(counter, 'pnl', quotePL);
        const fill = this._transaction('ORDER_FILL', { reason, instrument: trade.instrument, units: String(-units), price: String(price),
            ...(triggeredOrder ? { orderID: triggeredOrder.id } : {}), pl: String(grossPL), financing: '0', commission: String(this.commissionAud),
            tradesClosed: [{ tradeID: trade.id, units: String(-units), price: String(price), realizedPL: String(grossPL), financing: '0',
                commission: String(this.commissionAud), guaranteedExecutionFee: '0', dividendAdjustment: '0' }] });
        this.balanceAud += grossPL - this.commissionAud;
        trade.state = 'CLOSED';
        trade.currentUnits = '0';
        trade.realizedPL = String(Number(trade.realizedPL) + grossPL);
        trade.commission = String(Number(trade.commission) + this.commissionAud);
        trade.averageClosePrice = this.formatPrice(trade.instrument, price);
        trade.closeTime = fill.time;
        trade.closingTransactionIDs.push(fill.id);
        for (const key of ['stopLossOrder', 'takeProfitOrder']) {
            const order = trade[key];
            if (order) { order.state = order === triggeredOrder ? 'FILLED' : 'CANCELLED'; order.filledTime = order === triggeredOrder ? fill.time : undefined; }
        }
        this._record('TRADE_CLOSED', { tradeId: trade.id, instrument: trade.instrument, units, fillPrice: price,
            grossRealizedAud: grossPL, commissionAud: this.commissionAud, lifetimeFinancingAud: Number(trade.financing),
            lifetimeCommissionAud: Number(trade.commission), reason, quoteEventTime: quote.time });
        return this._response([fill], { orderFillTransaction: fill });
    }

    async closeTrade(id, units = 'ALL') {
        const trade = this._trade(id, true);
        if (units !== 'ALL' && (!finite(units) || Math.abs(Number(units)) !== Math.abs(Number(trade.currentUnits)))) {
            throw new ReplayDataError('Partial trade closure is unsupported; this adapter models full-close execution only');
        }
        const quote = this._quote(trade.instrument);
        if (!this._isTradeable(quote)) throw new ReplayDataError('Observed market is not tradeable; full close has no modeled fill', 'REPLAY_MARKET_NOT_TRADEABLE');
        return this._close(trade, quote, 'TRADE_CLOSE');
    }

    observePrice(instrument, quote = null) {
        const observation = this._quote(instrument, quote);
        const results = [];
        if (!this._isTradeable(observation)) {
            this._record('QUOTE_OBSERVED', { instrument, quoteEventTime: observation.time, closedTrades: 0, tradeable: false });
            return results;
        }
        for (const trade of this.trades.values()) {
            if (trade.state !== 'OPEN' || trade.instrument !== instrument) continue;
            const direction = Number(trade.currentUnits) > 0 ? 1 : -1;
            const price = this.getExecutableQuote(observation, direction > 0 ? 'SELL' : 'BUY', trade.currentUnits).executablePrice;
            const stop = trade.stopLossOrder;
            const target = trade.takeProfitOrder;
            const stopTriggered = stop?.state === 'PENDING' && direction * (price - Number(stop.price)) <= 0;
            const targetTriggered = target?.state === 'PENDING' && direction * (price - Number(target.price)) >= 0;
            // This only compares one supplied point, so it supplies no evidence
            // about which boundary was touched between observations.
            if (stopTriggered && targetTriggered) throw new ReplayDataError('Both protection boundaries match this quote; ordering is unresolved');
            if (stopTriggered || targetTriggered) results.push(this._close(trade, observation,
                stopTriggered ? 'STOP_LOSS_ORDER' : 'TAKE_PROFIT_ORDER', stopTriggered ? stop : target));
        }
        this._record('QUOTE_OBSERVED', { instrument, quoteEventTime: observation.time, closedTrades: results.length });
        return results;
    }

    applyFinancing({ id, tradeId, amountAud, atMs = this.nowMs() } = {}) {
        if (!id || !finite(amountAud) || Number(atMs) !== this.nowMs()) {
            throw new ReplayDataError('Financing requires an event ID, finite AUD amount and current replay event time');
        }
        const event = { tradeId: String(tradeId), amountAud: Number(amountAud), atMs: Number(atMs) };
        if (this.financingEvents.has(String(id))) {
            if (JSON.stringify(this.financingEvents.get(String(id))) !== JSON.stringify(event)) {
                throw new ReplayDataError('A financing event ID was reused with different contents');
            }
            return false;
        }
        const trade = this._trade(tradeId, true);
        this.balanceAud += Number(amountAud);
        trade.financing = String(Number(trade.financing) + Number(amountAud));
        this.financingEvents.set(String(id), event);
        const transaction = this._transaction('DAILY_FINANCING', { financing: String(amountAud),
            positionFinancings: [{ instrument: trade.instrument, tradeFinancings: [{ tradeID: trade.id, financing: String(amountAud) }] }] });
        this._record('FINANCING_APPLIED', { eventId: String(id), tradeId: trade.id, amountAud: Number(amountAud), transactionId: transaction.id });
        return true;
    }

    async findOrderIntent(orderIntentId, sinceTransactionId = null) {
        const result = this.intents.get(String(orderIntentId));
        if (!result) return { status: 'AMBIGUOUS', transactions: [], lastTransactionId: String(this.nextTransactionId - 1) };
        const { tradeId, ...outcome } = result;
        const expected = this.buildClientExtensions(orderIntentId).order.id;
        const transactions = this.transactions.filter((transaction) =>
            (!sinceTransactionId || Number(transaction.id) > Number(sinceTransactionId)) &&
            (transaction.clientExtensions?.id === expected || transaction.clientOrderID === expected ||
                transaction.orderID === result.orderTransaction?.id));
        return { ...copy(outcome), ...(tradeId ? { trade: copy(this._trade(tradeId)) } : {}),
            transactions: copy(transactions), lastTransactionId: String(this.nextTransactionId - 1) };
    }

    getLedger() { return copy(this.ledger); }
    snapshot() {
        return { initialBalanceAud: this.initialBalanceAud, balanceAud: this.balanceAud,
            trades: [...this.trades.values()].map(copy), transactions: copy(this.transactions), ledger: this.getLedger(),
            assumptions: { priceEvidence: 'supplied_quote_points_only', slippagePipsPerExecution: this.slippagePips,
                commissionAudPerExecution: this.commissionAud, financing: 'explicit_timestamped_events_only', partialCloses: 'unsupported' } };
    }
}

module.exports = { ReplayBroker, ReplayDataError };
