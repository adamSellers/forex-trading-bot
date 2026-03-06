// Mock candle/price data for testing

/**
 * Generate realistic-looking candle data
 * @param {number} count - Number of candles to generate
 * @param {number} startPrice - Starting price
 * @param {string} instrument - Instrument name
 * @param {string} trend - 'up', 'down', or 'sideways'
 */
const generateCandles = (count = 200, startPrice = 1.16500, instrument = 'AUD_USD', trend = 'up') => {
    const candles = [];
    let price = startPrice;
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000; // 15 minutes

    // Trend bias
    const trendBias = trend === 'up' ? 0.00005 : trend === 'down' ? -0.00005 : 0;

    for (let i = 0; i < count; i++) {
        // Price movement with trend bias and noise
        const noise = (Math.random() - 0.5) * 0.002;
        price += trendBias + noise;

        // Ensure price stays reasonable
        price = Math.max(0.5, Math.min(2.0, price));

        const volatility = 0.0015; // Typical forex volatility
        const open = price;
        const high = price + Math.random() * volatility;
        const low = price - Math.random() * volatility;
        const close = price + (Math.random() - 0.5) * volatility;

        candles.push({
            time: now - (count - i) * intervalMs,
            open: parseFloat(open.toFixed(5)),
            high: parseFloat(Math.max(open, close, high).toFixed(5)),
            low: parseFloat(Math.min(open, close, low).toFixed(5)),
            close: parseFloat(close.toFixed(5)),
            volume: Math.floor(Math.random() * 1000) + 100,
        });

        // Update price for next candle
        price = close;
    }

    return candles;
};

/**
 * Generate candles with a SuperTrend flip (uptrend starting)
 * Creates a pattern where direction changes from -1 to 1
 */
const generateCandlesWithFlip = (count = 200, flipIndex = 180) => {
    const candles = [];
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000;
    let price = 1.16000;

    for (let i = 0; i < count; i++) {
        // Downtrend before flip, uptrend after
        const trendBias = i < flipIndex ? -0.00008 : 0.00012;
        const noise = (Math.random() - 0.5) * 0.0015;
        price += trendBias + noise;
        price = Math.max(1.10, Math.min(1.25, price));

        const volatility = 0.0012;
        const open = price;
        const high = price + Math.random() * volatility;
        const low = price - Math.random() * volatility;

        // Strong close in direction of trend
        const closeDirection = i < flipIndex ? -0.0003 : 0.0005;
        const close = price + closeDirection + (Math.random() - 0.5) * 0.0003;

        candles.push({
            time: now - (count - i) * intervalMs,
            open: parseFloat(open.toFixed(5)),
            high: parseFloat(Math.max(open, close, high).toFixed(5)),
            low: parseFloat(Math.min(open, close, low).toFixed(5)),
            close: parseFloat(close.toFixed(5)),
            volume: Math.floor(Math.random() * 1000) + 100,
        });

        price = close;
    }

    return candles;
};

/**
 * Generate candles for a strong trend (high ADX)
 */
const generateStrongTrendCandles = (count = 200, direction = 'up') => {
    const candles = [];
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000;
    let price = direction === 'up' ? 1.15000 : 1.18000;

    for (let i = 0; i < count; i++) {
        // Strong consistent trend
        const trendMove = direction === 'up' ? 0.00015 : -0.00015;
        const noise = (Math.random() - 0.5) * 0.0008;
        price += trendMove + noise;
        price = Math.max(1.10, Math.min(1.25, price));

        const volatility = 0.001;
        const open = price;
        const high = direction === 'up'
            ? price + Math.random() * volatility * 1.5
            : price + Math.random() * volatility * 0.5;
        const low = direction === 'up'
            ? price - Math.random() * volatility * 0.5
            : price - Math.random() * volatility * 1.5;
        const close = price + (direction === 'up' ? 0.0002 : -0.0002);

        candles.push({
            time: now - (count - i) * intervalMs,
            open: parseFloat(open.toFixed(5)),
            high: parseFloat(Math.max(open, close, high).toFixed(5)),
            low: parseFloat(Math.min(open, close, low).toFixed(5)),
            close: parseFloat(close.toFixed(5)),
            volume: Math.floor(Math.random() * 1000) + 200,
        });

        price = close;
    }

    return candles;
};

/**
 * Generate choppy/sideways candles (low ADX)
 */
const generateChoppyCandles = (count = 200) => {
    const candles = [];
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000;
    let price = 1.16500;
    const basePrice = price;

    for (let i = 0; i < count; i++) {
        // Oscillate around base price
        const oscillation = Math.sin(i / 10) * 0.002;
        const noise = (Math.random() - 0.5) * 0.001;
        price = basePrice + oscillation + noise;

        const volatility = 0.0008;
        const open = price;
        const high = price + Math.random() * volatility;
        const low = price - Math.random() * volatility;
        const close = price + (Math.random() - 0.5) * 0.0005;

        candles.push({
            time: now - (count - i) * intervalMs,
            open: parseFloat(open.toFixed(5)),
            high: parseFloat(Math.max(open, close, high).toFixed(5)),
            low: parseFloat(Math.min(open, close, low).toFixed(5)),
            close: parseFloat(close.toFixed(5)),
            volume: Math.floor(Math.random() * 500) + 50,
        });
    }

    return candles;
};

/**
 * Create a mock data service for testing signal generator
 */
const createMockDataService = (candleData = {}, priceData = {}) => ({
    getCandles: jest.fn((instrument, timeframe) => {
        const timeframeKey = timeframe
            ? `${instrument}_${timeframe}`
            : instrument;
        if (candleData[timeframeKey]) {
            return candleData[timeframeKey];
        }
        return candleData[instrument] || generateCandles(200);
    }),
    getCurrentPrice: jest.fn((instrument) => {
        if (priceData[instrument]) {
            return priceData[instrument];
        }
        return {
            price: 1.16571,
            bid: 1.16566,
            ask: 1.16576,
            spread: 1.0,
            timestamp: Date.now(),
        };
    }),
    getPipValue: jest.fn((instrument) => {
        return instrument.includes('JPY') ? 0.01 : 0.0001;
    }),
});

module.exports = {
    generateCandles,
    generateCandlesWithFlip,
    generateStrongTrendCandles,
    generateChoppyCandles,
    createMockDataService,
};
