// Mock Oanda API responses for testing

/**
 * Mock account summary response
 */
const mockAccountSummary = (overrides = {}) => ({
    account: {
        id: '001-011-20128302-001',
        currency: 'AUD',
        balance: '136.00',
        openTradeCount: 1,
        openPositionCount: 1,
        pendingOrderCount: 0,
        pl: '-7.44',
        resettablePL: '-7.44',
        financing: '-0.12',
        commission: '0.00',
        guaranteedStopLossOrderMode: 'DISABLED',
        unrealizedPL: '5.63',
        NAV: '141.63',
        marginUsed: '65.00',
        marginAvailable: '71.00',
        positionValue: '0.00',
        marginCloseoutUnrealizedPL: '5.63',
        marginCloseoutNAV: '141.63',
        marginCloseoutMarginUsed: '65.00',
        marginCloseoutPositionValue: '0.00',
        marginCloseoutPercent: '0.23',
        marginCallMarginUsed: '65.00',
        marginCallPercent: '0.46',
        ...overrides,
    },
});

/**
 * Mock market order fill response
 */
const mockOrderFill = (overrides = {}) => ({
    orderCreateTransaction: {
        id: '500',
        accountID: '001-011-20128302-001',
        userID: 12345678,
        time: Date.now().toString(),
        type: 'MARKET_ORDER',
        instrument: 'AUD_USD',
        units: '795',
        timeInForce: 'FOK',
        positionFill: 'DEFAULT',
        reason: 'CLIENT_ORDER',
    },
    orderFillTransaction: {
        id: '501',
        accountID: '001-011-20128302-001',
        userID: 12345678,
        time: Date.now().toString(),
        type: 'ORDER_FILL',
        orderID: '500',
        instrument: 'AUD_USD',
        units: '795',
        requestedUnits: '795',
        price: '1.16571',
        pl: '0.00',
        financing: '0.00',
        commission: '0.00',
        accountBalance: '136.00',
        gainQuoteHomeConversionFactor: '1.0',
        lossQuoteHomeConversionFactor: '1.0',
        guaranteedExecutionFee: '0.00',
        halfSpreadCost: '0.15',
        fullVWAP: '1.16571',
        reason: 'MARKET_ORDER',
        tradeOpened: {
            tradeID: '489',
            units: '795',
            price: '1.16571',
            guaranteedExecutionFee: '0.00',
            halfSpreadCost: '0.15',
            initialMarginRequired: '46.17',
        },
        fullPrice: {
            closeoutBid: '1.16566',
            closeoutAsk: '1.16576',
            timestamp: Date.now().toString(),
            bids: [{ price: '1.16566', liquidity: 1000000 }],
            asks: [{ price: '1.16576', liquidity: 1000000 }],
        },
        ...overrides,
    },
    relatedTransactionIDs: ['500', '501'],
    lastTransactionID: '501',
});

/**
 * Mock trade close response
 */
const mockTradeClose = (overrides = {}) => ({
    orderCreateTransaction: {
        type: 'MARKET_ORDER',
        instrument: 'AUD_USD',
        units: '-795',
        timeInForce: 'FOK',
        positionFill: 'REDUCE_ONLY',
        reason: 'TRADE_CLOSE',
    },
    orderFillTransaction: {
        type: 'ORDER_FILL',
        instrument: 'AUD_USD',
        units: '-795',
        price: '1.16784',
        pl: '2.50',
        financing: '-0.02',
        commission: '0.00',
        accountBalance: '138.48',
        tradesClosed: [
            {
                tradeID: '489',
                units: '-795',
                price: '1.16784',
                realizedPL: '2.50',
                financing: '-0.02',
                guaranteedExecutionFee: '0.00',
                halfSpreadCost: '0.15',
            },
        ],
        ...overrides,
    },
});

/**
 * Mock modify trade response (SL/TP)
 */
const mockModifyTrade = (overrides = {}) => ({
    takeProfitOrderTransaction: {
        id: '502',
        type: 'TAKE_PROFIT_ORDER',
        tradeID: '489',
        price: '1.16918',
        timeInForce: 'GTC',
        triggerCondition: 'DEFAULT',
        reason: 'CLIENT_ORDER',
    },
    relatedTransactionIDs: ['502'],
    lastTransactionID: '502',
    ...overrides,
});

/**
 * Mock open trades response
 */
const mockOpenTrades = (trades = []) => ({
    trades: trades.length > 0 ? trades : [
        {
            id: '489',
            instrument: 'AUD_USD',
            price: '1.16571',
            openTime: (Date.now() - 3600000).toString(),
            initialUnits: '795',
            initialMarginRequired: '46.17',
            state: 'OPEN',
            currentUnits: '795',
            realizedPL: '0.00',
            financing: '-0.02',
            unrealizedPL: '2.50',
            marginUsed: '46.17',
            averageClosePrice: '0.00',
            closingTransactionIDs: [],
            takeProfitOrder: {
                id: '490',
                createTime: Date.now().toString(),
                type: 'TAKE_PROFIT',
                tradeID: '489',
                price: '1.16918',
                timeInForce: 'GTC',
                triggerCondition: 'DEFAULT',
                state: 'PENDING',
            },
            stopLossOrder: {
                id: '491',
                createTime: Date.now().toString(),
                type: 'STOP_LOSS',
                tradeID: '489',
                price: '1.16320',
                timeInForce: 'GTC',
                triggerCondition: 'DEFAULT',
                state: 'PENDING',
            },
        },
    ],
    lastTransactionID: '491',
});

/**
 * Mock positions response
 */
const mockPositions = (positions = []) => ({
    positions: positions.length > 0 ? positions : [
        {
            instrument: 'AUD_USD',
            pl: '-2.50',
            resettablePL: '-2.50',
            financing: '-0.05',
            commission: '0.00',
            guaranteedExecutionFees: '0.00',
            unrealizedPL: '2.50',
            long: {
                units: '795',
                averagePrice: '1.16571',
                pl: '-2.50',
                resettablePL: '-2.50',
                financing: '-0.05',
                guaranteedExecutionFees: '0.00',
                unrealizedPL: '2.50',
            },
            short: {
                units: '0',
                averagePrice: '0.00000',
                pl: '0.00',
                resettablePL: '0.00',
                financing: '0.00',
                guaranteedExecutionFees: '0.00',
                unrealizedPL: '0.00',
            },
        },
    ],
    lastTransactionID: '491',
});

/**
 * Mock pricing response
 */
const mockPricing = (instruments = ['AUD_USD']) => ({
    prices: instruments.map(instrument => ({
        asks: [{ price: '1.16576', liquidity: 1000000 }],
        bids: [{ price: '1.16566', liquidity: 1000000 }],
        closeoutAsk: '1.16576',
        closeoutBid: '1.16566',
        instrument: instrument,
        status: 'tradeable',
        time: Date.now().toString(),
        tradeable: true,
    })),
    time: Date.now().toString(),
});

/**
 * Mock candles response
 */
const mockCandles = (instrument = 'AUD_USD', count = 100) => {
    const candles = [];
    let basePrice = 1.16500;
    const now = Date.now();

    for (let i = 0; i < count; i++) {
        // Simulate some price movement
        const change = (Math.random() - 0.5) * 0.002;
        basePrice += change;

        const open = basePrice;
        const high = basePrice + Math.random() * 0.001;
        const low = basePrice - Math.random() * 0.001;
        const close = basePrice + (Math.random() - 0.5) * 0.0005;
        const volume = Math.floor(Math.random() * 1000) + 100;

        candles.push({
            complete: i < count - 1,
            volume: volume,
            time: (now - (count - i) * 15 * 60 * 1000).toString(),
            mid: {
                o: open.toFixed(5),
                h: high.toFixed(5),
                l: low.toFixed(5),
                c: close.toFixed(5),
            },
        });
    }

    return {
        instrument: instrument,
        granularity: 'M15',
        candles: candles,
    };
};

/**
 * Mock API error response
 */
const mockApiError = (code = 401, message = 'Unauthorized') => ({
    errorCode: code.toString(),
    errorMessage: message,
});

module.exports = {
    mockAccountSummary,
    mockOrderFill,
    mockTradeClose,
    mockModifyTrade,
    mockOpenTrades,
    mockPositions,
    mockPricing,
    mockCandles,
    mockApiError,
};
