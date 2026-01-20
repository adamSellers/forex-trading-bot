// Mock service factories for testing

const EventEmitter = require('events');

/**
 * Create a mock Oanda client
 */
const createMockOandaClient = (overrides = {}) => {
    const mockClient = {
        apiKey: 'test-api-key',
        accountId: '001-011-20128302-001',
        baseUrl: 'https://api-fxtrade.oanda.com',
        isInitialized: true,

        initialize: jest.fn().mockResolvedValue({
            account: {
                id: '001-011-20128302-001',
                balance: '136.00',
                currency: 'AUD',
            },
        }),

        getAccountSummary: jest.fn().mockResolvedValue({
            account: {
                id: '001-011-20128302-001',
                currency: 'AUD',
                balance: '136.00',
                marginAvailable: '71.00',
                marginUsed: '65.00',
                unrealizedPL: '5.63',
                NAV: '141.63',
                openTradeCount: 1,
            },
        }),

        getAccountDetails: jest.fn().mockResolvedValue({
            account: {
                id: '001-011-20128302-001',
                currency: 'AUD',
                balance: '136.00',
                marginAvailable: '71.00',
            },
        }),

        getPricing: jest.fn().mockResolvedValue({
            prices: [
                {
                    instrument: 'AUD_USD',
                    bids: [{ price: '1.16566', liquidity: 1000000 }],
                    asks: [{ price: '1.16576', liquidity: 1000000 }],
                    closeoutBid: '1.16566',
                    closeoutAsk: '1.16576',
                    tradeable: true,
                },
            ],
        }),

        getCandles: jest.fn().mockResolvedValue({
            instrument: 'AUD_USD',
            granularity: 'M15',
            candles: [],
        }),

        placeMarketOrder: jest.fn().mockResolvedValue({
            orderFillTransaction: {
                id: '501',
                instrument: 'AUD_USD',
                units: '795',
                price: '1.16571',
                pl: '0.00',
                tradeOpened: {
                    tradeID: '489',
                    units: '795',
                    price: '1.16571',
                    initialMarginRequired: '46.17',
                },
            },
        }),

        closeTrade: jest.fn().mockResolvedValue({
            orderFillTransaction: {
                id: '502',
                instrument: 'AUD_USD',
                units: '-795',
                price: '1.16784',
                pl: '2.50',
                tradesClosed: [
                    {
                        tradeID: '489',
                        units: '-795',
                        price: '1.16784',
                        realizedPL: '2.50',
                        financing: '-0.02',
                    },
                ],
            },
        }),

        modifyTrade: jest.fn().mockResolvedValue({
            takeProfitOrderTransaction: {
                id: '503',
                tradeID: '489',
                price: '1.16918',
            },
        }),

        getOpenTrades: jest.fn().mockResolvedValue({
            trades: [],
        }),

        getPositions: jest.fn().mockResolvedValue({
            positions: [],
        }),

        getTrade: jest.fn().mockResolvedValue({
            trade: {
                id: '489',
                instrument: 'AUD_USD',
                price: '1.16571',
                currentUnits: '795',
                state: 'OPEN',
            },
        }),

        getPipValue: jest.fn((instrument) => {
            return instrument.includes('JPY') ? 0.01 : 0.0001;
        }),

        pipsToPrice: jest.fn((pips, instrument) => {
            const pipValue = instrument.includes('JPY') ? 0.01 : 0.0001;
            return pips * pipValue;
        }),

        calculatePositionSize: jest.fn().mockReturnValue(795),

        getStatus: jest.fn().mockReturnValue({
            isInitialized: true,
            accountId: '001-011-20128302-001',
            environment: 'LIVE',
            baseUrl: 'https://api-fxtrade.oanda.com',
        }),

        ...overrides,
    };

    return mockClient;
};

/**
 * Create a mock config service
 */
const createMockConfigService = (config = {}) => {
    const defaultConfig = {
        enableTrading: true,
        tradingMode: 'live',
        maxOpenPositions: 2,
        riskPerTrade: 0.02,
        maxCapitalAtRisk: 70,
        marginBuffer: 0.20,
        enableTakeProfit: true,
        takeProfitPercent: 0.06,
        stopLossAtrMultiplier: 2.0,
        minStopLossPips: 12,
        minAdx: 22,
        assets: ['AUD_USD', 'EUR_USD'],
        enableEmailAlerts: false,
        ...config,
    };

    const emitter = new EventEmitter();

    return {
        config: defaultConfig,
        get: jest.fn((key) => {
            if (key) return defaultConfig[key];
            return defaultConfig;
        }),
        load: jest.fn().mockResolvedValue(defaultConfig),
        update: jest.fn(async (updates) => {
            Object.assign(defaultConfig, updates);
            emitter.emit('configUpdated', defaultConfig);
            return defaultConfig;
        }),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        ...emitter,
    };
};

/**
 * Create a mock trade repository
 */
const createMockTradeRepository = (initialTrades = []) => {
    let trades = [...initialTrades];

    return {
        trades,
        save: jest.fn(async (trade) => {
            trades.push(trade);
            return trade;
        }),
        getRecent: jest.fn(async (limit = 20) => {
            return trades.slice(-limit).reverse();
        }),
        getOpenTrades: jest.fn(async () => {
            return trades.filter((t) => t.isOpen);
        }),
        updateTrade: jest.fn(async (tradeId, updates) => {
            const index = trades.findIndex((t) => t.id === tradeId);
            if (index !== -1) {
                trades[index] = { ...trades[index], ...updates };
            }
            return trades[index];
        }),
        getByInstrument: jest.fn(async (instrument) => {
            return trades.filter((t) => t.instrument === instrument);
        }),
        getAllTrades: jest.fn(async () => trades),
        getTradesSince: jest.fn(async (cutoff) => {
            return trades.filter((t) => t.entryTime >= cutoff);
        }),
        // Helper to reset state between tests
        _reset: () => {
            trades = [];
        },
    };
};

/**
 * Create a mock signal repository
 */
const createMockSignalRepository = (initialSignals = []) => {
    let signals = [...initialSignals];

    return {
        signals,
        save: jest.fn(async (signal) => {
            signals.push(signal);
            return signal;
        }),
        saveBatch: jest.fn(async (newSignals) => {
            signals.push(...newSignals);
            return newSignals;
        }),
        getRecent: jest.fn(async (limit = 50) => {
            return signals.slice(-limit).reverse();
        }),
        getByInstrument: jest.fn(async (instrument) => {
            return signals.filter((s) => s.instrument === instrument);
        }),
        // Helper to reset state between tests
        _reset: () => {
            signals = [];
        },
    };
};

/**
 * Create a mock email service
 */
const createMockEmailService = () => ({
    isConfigured: jest.fn().mockReturnValue(true),
    sendTradeOpenedEmail: jest.fn().mockResolvedValue(true),
    sendTradeClosedEmail: jest.fn().mockResolvedValue(true),
    sendTestEmail: jest.fn().mockResolvedValue(true),
});

/**
 * Create a mock signal generator
 */
const createMockSignalGenerator = (signals = []) => {
    const emitter = new EventEmitter();
    let latestSignals = signals;

    const generator = {
        isRunning: false,
        latestSignals,
        config: {
            assets: ['AUD_USD', 'EUR_USD'],
            minAdx: 22,
            rsiOverbought: 75,
        },
        start: jest.fn(function () {
            this.isRunning = true;
        }),
        stop: jest.fn(function () {
            this.isRunning = false;
        }),
        generateAllSignals: jest.fn().mockResolvedValue(latestSignals),
        generateSignal: jest.fn().mockResolvedValue(signals[0] || null),
        updateConfig: jest.fn((newConfig) => {
            Object.assign(generator.config, newConfig);
        }),
        getStatus: jest.fn(() => ({
            isActive: generator.isRunning,
            config: generator.config,
            activeSignals: latestSignals,
            pendingEntries: [],
        })),
        reset: jest.fn(() => {
            latestSignals = [];
        }),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        // Helper to emit test signals
        _emitSignal: (signal) => {
            emitter.emit('signalGenerated', signal);
        },
        _emitAllSignals: (signals) => {
            emitter.emit('allSignalsGenerated', signals);
        },
    };

    return generator;
};

module.exports = {
    createMockOandaClient,
    createMockConfigService,
    createMockTradeRepository,
    createMockSignalRepository,
    createMockEmailService,
    createMockSignalGenerator,
};
