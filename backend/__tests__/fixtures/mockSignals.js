// Mock signal data for testing

/**
 * Create a mock signal object
 */
const createMockSignal = (overrides = {}) => ({
    symbol: 'AUD_USD',
    signal: 'BUY',
    strength: 28.5, // ADX value
    message: 'BUY: ST Flip GREEN | ADX 28.5 | RSI 65.2',
    timestamp: Date.now(),
    atr: 0.00125, // Raw ATR value
    atrPips: 12.5,
    currentPrice: 1.16571,
    entryType: 'FRESH_FLIP',
    timeframe: '15m',
    trend: {
        currentPrice: 1.16571,
        rsi: 65.2,
        adx: 28.5,
        supertrend_direction: 1,
        atrPips: 12.5,
    },
    data: {
        currentPrice: 1.16571,
        rsi: 65.2,
        adx: 28.5,
        stDirection: 1,
        atrPips: 12.5,
    },
    pendingEntry: null,
    ...overrides,
});

/**
 * Create a HOLD signal
 */
const createHoldSignal = (overrides = {}) =>
    createMockSignal({
        signal: 'HOLD',
        message: 'ST: ADX:22.1 RSI:58.3 ATR:11.2pips',
        entryType: null,
        ...overrides,
    });

/**
 * Create a SELL signal
 */
const createSellSignal = (overrides = {}) =>
    createMockSignal({
        signal: 'SELL',
        message: 'SELL: ST Flip RED',
        entryType: null,
        trend: {
            ...createMockSignal().trend,
            supertrend_direction: -1,
        },
        data: {
            ...createMockSignal().data,
            stDirection: -1,
        },
        ...overrides,
    });

/**
 * Create a continuation signal (RSI cooldown)
 */
const createContinuationSignal = (overrides = {}) =>
    createMockSignal({
        signal: 'BUY',
        entryType: 'CONTINUATION_RSI',
        message: 'BUY: Continuation (RSI Cooldown) | RSI 68.5 < 70 | Price: 0.5% from flip | Wait: 45min',
        ...overrides,
    });

/**
 * Create a pending entry signal
 */
const createPendingSignal = (overrides = {}) =>
    createMockSignal({
        signal: 'HOLD',
        message: 'PENDING: ST Flip blocked by RSI (76.2 >= 75) - waiting for cooldown',
        entryType: null,
        pendingEntry: {
            flipTime: Date.now() - 1800000, // 30 mins ago
            flipPrice: 1.16500,
            flipAdx: 25.5,
            flipRsi: 76.2,
            waitingFor: 'RSI_COOLDOWN',
            ageMinutes: '30',
        },
        ...overrides,
    });

/**
 * Create a signal with weak ADX (below threshold)
 */
const createWeakAdxSignal = (overrides = {}) =>
    createMockSignal({
        signal: 'HOLD',
        strength: 18.5, // Below 22 threshold
        message: 'PENDING: ST Flip blocked by ADX (18.5 < 22) - waiting for trend strength',
        entryType: null,
        trend: {
            ...createMockSignal().trend,
            adx: 18.5,
        },
        data: {
            ...createMockSignal().data,
            adx: 18.5,
        },
        pendingEntry: {
            flipTime: Date.now() - 600000, // 10 mins ago
            flipPrice: 1.16550,
            flipAdx: 18.5,
            flipRsi: 62.0,
            waitingFor: 'ADX_STRENGTHEN',
            ageMinutes: '10',
        },
        ...overrides,
    });

/**
 * Create a cooldown signal (rate limited)
 */
const createCooldownSignal = (overrides = {}) =>
    createMockSignal({
        signal: 'COOLDOWN',
        message: 'Signal Spam Filter',
        entryType: null,
        ...overrides,
    });

/**
 * Create signals for multiple instruments
 */
const createMultiInstrumentSignals = () => [
    createMockSignal({ symbol: 'AUD_USD' }),
    createHoldSignal({ symbol: 'EUR_USD', currentPrice: 1.08234 }),
];

module.exports = {
    createMockSignal,
    createHoldSignal,
    createSellSignal,
    createContinuationSignal,
    createPendingSignal,
    createWeakAdxSignal,
    createCooldownSignal,
    createMultiInstrumentSignals,
};
