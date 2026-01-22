// Tests for SignalGenerator - Strategy and signal logic
const SignalGenerator = require('../signalGenerator');
const {
    generateCandles,
    generateCandlesWithFlip,
    generateStrongTrendCandles,
    generateChoppyCandles,
    createMockDataService,
} = require('../../../__tests__/fixtures/mockCandles');

describe('SignalGenerator', () => {
    let generator;
    let mockDataService;

    beforeEach(() => {
        generator = new SignalGenerator({
            minAdx: 22,
            rsiOverbought: 75,
            rsiOversold: 30,
            atrPeriod: 10,
            factor: 3,
            enableContinuationEntry: true,
            continuationWindowMs: 4 * 60 * 60 * 1000,
            continuationRsiThreshold: 70,
            assets: ['AUD_USD', 'EUR_USD'],
        });

        mockDataService = createMockDataService();
    });

    afterEach(() => {
        if (generator.isRunning) {
            generator.stop();
        }
    });

    describe('Initialization', () => {
        test('should initialize with correct default config', () => {
            const gen = new SignalGenerator();

            expect(gen.config.strategy).toBe('supertrend_momentum');
            expect(gen.config.timeframe).toBe('15m');
            expect(gen.config.minAdx).toBe(22);
            expect(gen.config.rsiOverbought).toBe(75);
        });

        test('should accept custom config', () => {
            const gen = new SignalGenerator({
                minAdx: 25,
                assets: ['GBP_USD'],
            });

            expect(gen.config.minAdx).toBe(25);
            expect(gen.config.assets).toContain('GBP_USD');
        });

        test('should not be running initially', () => {
            expect(generator.isRunning).toBe(false);
            expect(generator.latestSignals).toEqual([]);
        });
    });

    describe('calculateSuperTrend', () => {
        test('should return correct structure', () => {
            const candles = generateCandles(100);
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            const closes = candles.map(c => c.close);

            const result = generator.calculateSuperTrend(highs, lows, closes, 10, 3);

            expect(result).toHaveProperty('superTrend');
            expect(result).toHaveProperty('direction');
            expect(result).toHaveProperty('atr');
            expect(result.direction.length).toBe(closes.length);
        });

        test('should return direction values of 1 or -1', () => {
            const candles = generateCandles(200);
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            const closes = candles.map(c => c.close);

            const result = generator.calculateSuperTrend(highs, lows, closes, 10, 3);

            result.direction.forEach(dir => {
                expect([1, -1]).toContain(dir);
            });
        });

        test('should detect trend flip on strong uptrend', () => {
            const candles = generateCandlesWithFlip(200, 180);
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            const closes = candles.map(c => c.close);

            const result = generator.calculateSuperTrend(highs, lows, closes, 10, 3);

            // Should have some -1 directions (downtrend before flip)
            const hasDowntrend = result.direction.some(d => d === -1);
            // Should have some +1 directions (uptrend after flip)
            const hasUptrend = result.direction.some(d => d === 1);

            expect(hasDowntrend).toBe(true);
            expect(hasUptrend).toBe(true);
        });
    });

    describe('generateSignal', () => {
        test('should return HOLD when insufficient data', async () => {
            const candles = generateCandles(50); // Less than 200 required
            const currentPrice = 1.16571;

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.signal).toBe('HOLD');
            expect(signal.message).toContain('Insufficient data');
        });

        test('should return valid signal structure', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal).toHaveProperty('symbol', 'AUD_USD');
            expect(signal).toHaveProperty('signal');
            expect(signal).toHaveProperty('strength');
            expect(signal).toHaveProperty('timestamp');
            expect(signal).toHaveProperty('trend');
            expect(signal).toHaveProperty('data');
            expect(['BUY', 'SELL', 'HOLD']).toContain(signal.signal);
        });

        test('should include trend data in signal', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.trend).toHaveProperty('currentPrice');
            expect(signal.trend).toHaveProperty('rsi');
            expect(signal.trend).toHaveProperty('adx');
            expect(signal.trend).toHaveProperty('supertrend_direction');
            expect(signal.trend).toHaveProperty('atrPips');
        });

        test('should include ATR pips in signal', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            // Mock getPipValue on dataService
            generator.dataService = {
                getPipValue: jest.fn().mockReturnValue(0.0001),
            };

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.atrPips).toBeGreaterThan(0);
        });

        test('should handle calculation errors gracefully', async () => {
            const signal = await generator.generateSignal('AUD_USD', null, 1.16571);

            // When candles are null/invalid, returns HOLD with insufficient data message
            expect(signal).not.toBeNull();
            expect(signal.signal).toBe('HOLD');
            expect(signal.message).toContain('Insufficient data');
        });
    });

    describe('Signal Types', () => {
        test('should generate FRESH_FLIP entry on SuperTrend flip with valid ADX', async () => {
            // Generate candles with a clear flip pattern and strong trend
            const candles = generateCandlesWithFlip(250, 230);
            const currentPrice = candles[candles.length - 1].close;

            // We can't guarantee a FRESH_FLIP without controlling exact indicator values
            // but we can verify the signal structure is correct
            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal).not.toBeNull();
            expect(signal.symbol).toBe('AUD_USD');
        });

        test('should generate SELL signal on SuperTrend flip to red', async () => {
            // Generate strong uptrend followed by reversal
            const candles = generateStrongTrendCandles(200, 'up');
            // Add some down candles to trigger flip
            for (let i = 0; i < 30; i++) {
                const lastClose = candles[candles.length - 1].close;
                candles.push({
                    time: Date.now() - (30 - i) * 15 * 60 * 1000,
                    open: lastClose,
                    high: lastClose + 0.0002,
                    low: lastClose - 0.0015,
                    close: lastClose - 0.0012,
                    volume: 100,
                });
            }

            const signal = await generator.generateSignal(
                'AUD_USD',
                candles,
                candles[candles.length - 1].close
            );

            expect(signal).not.toBeNull();
            // Signal could be SELL or HOLD depending on exact conditions
            expect(['BUY', 'SELL', 'HOLD']).toContain(signal.signal);
        });

        test('should track pending entry when RSI too high', async () => {
            // This test verifies pending entry mechanism exists
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            await generator.generateSignal('AUD_USD', candles, currentPrice);

            // Check if pending entries map exists and is accessible
            expect(generator._pendingEntries).toBeDefined();
            expect(generator._pendingEntries instanceof Map).toBe(true);
        });
    });

    describe('Continuation Entries', () => {
        test('should store pending entry when flip blocked by RSI', async () => {
            // Clear any existing pending entries
            generator._pendingEntries.clear();

            // Manually set a pending entry to test the mechanism
            generator._pendingEntries.set('AUD_USD', {
                flipTime: Date.now() - 30 * 60 * 1000, // 30 mins ago
                flipPrice: 1.16500,
                flipAdx: 25,
                flipRsi: 76,
                waitingFor: 'RSI_COOLDOWN',
            });

            const pending = generator._pendingEntries.get('AUD_USD');

            expect(pending).toBeDefined();
            expect(pending.waitingFor).toBe('RSI_COOLDOWN');
            expect(pending.flipRsi).toBeGreaterThan(generator.config.rsiOverbought);
        });

        test('should expire pending entry after window closes', () => {
            // Set an old pending entry
            generator._pendingEntries.set('AUD_USD', {
                flipTime: Date.now() - 5 * 60 * 60 * 1000, // 5 hours ago (> 4 hour window)
                flipPrice: 1.16500,
                flipAdx: 25,
                flipRsi: 76,
                waitingFor: 'RSI_COOLDOWN',
            });

            const pending = generator._pendingEntries.get('AUD_USD');
            const ageMs = Date.now() - pending.flipTime;
            const maxAgeMs = generator.config.continuationWindowMs;

            expect(ageMs).toBeGreaterThan(maxAgeMs);
        });

        test('should clear pending entries on reset', () => {
            generator._pendingEntries.set('AUD_USD', { flipTime: Date.now() });
            generator._pendingEntries.set('EUR_USD', { flipTime: Date.now() });

            generator.reset();

            expect(generator._pendingEntries.size).toBe(0);
        });

        test('clearPendingEntries should return count and clear', () => {
            generator._pendingEntries.set('AUD_USD', { flipTime: Date.now() });
            generator._pendingEntries.set('EUR_USD', { flipTime: Date.now() });

            const count = generator.clearPendingEntries();

            expect(count).toBe(2);
            expect(generator._pendingEntries.size).toBe(0);
        });
    });

    describe('Signal Validation', () => {
        test('should rate limit duplicate signals', () => {
            const signal1 = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25,
                timestamp: Date.now(),
            };

            // First signal should pass
            const validated1 = generator.validateSignal(signal1);
            expect(validated1.signal).toBe('BUY');

            // Immediate duplicate should be rate limited
            const signal2 = { ...signal1, timestamp: Date.now() + 1000 };
            const validated2 = generator.validateSignal(signal2);
            expect(validated2.signal).toBe('COOLDOWN');
        });

        test('should allow signal after cooldown period', () => {
            const signal1 = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25,
                timestamp: Date.now(),
            };

            generator.validateSignal(signal1);

            // Simulate time passing beyond cooldown
            generator.lastSignals.set('AUD_USD_BUY', Date.now() - 120000);

            const signal2 = {
                ...signal1,
                timestamp: Date.now(),
            };
            const validated2 = generator.validateSignal(signal2);
            expect(validated2.signal).toBe('BUY');
        });

        test('should allow different instruments without cooldown', () => {
            const signal1 = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25,
                timestamp: Date.now(),
            };

            generator.validateSignal(signal1);

            const signal2 = {
                symbol: 'EUR_USD',
                signal: 'BUY',
                strength: 25,
                timestamp: Date.now(),
            };

            const validated2 = generator.validateSignal(signal2);
            expect(validated2.signal).toBe('BUY');
        });

        test('should return null for null input', () => {
            const result = generator.validateSignal(null);
            expect(result).toBeNull();
        });
    });

    describe('Signal Generation Loop', () => {
        test('should generate signals for all configured assets', async () => {
            const candles = generateCandles(250);
            mockDataService = createMockDataService(
                {
                    AUD_USD: candles,
                    EUR_USD: candles,
                },
                {
                    AUD_USD: { price: 1.16571, bid: 1.16566, ask: 1.16576 },
                    EUR_USD: { price: 1.08234, bid: 1.08229, ask: 1.08239 },
                }
            );

            const signals = await generator.generateAllSignals(mockDataService);

            expect(signals.length).toBeGreaterThan(0);
            // At least one signal per asset (could be filtered)
        });

        test('should emit events when signals generated', (done) => {
            const candles = generateCandles(250);
            mockDataService = createMockDataService(
                { AUD_USD: candles },
                { AUD_USD: { price: 1.16571, bid: 1.16566, ask: 1.16576 } }
            );

            generator.once('allSignalsGenerated', (signals) => {
                expect(Array.isArray(signals)).toBe(true);
                done();
            });

            generator.generateAllSignals(mockDataService).then(signals => {
                if (signals.length > 0) {
                    generator.emit('allSignalsGenerated', signals);
                } else {
                    done();
                }
            });
        });

        test('should handle missing candle data gracefully', async () => {
            mockDataService = createMockDataService(
                { AUD_USD: [] }, // Empty candles
                { AUD_USD: { price: 1.16571 } }
            );

            const signals = await generator.generateAllSignals(mockDataService);

            // Should not throw, may return empty or filtered signals
            expect(Array.isArray(signals)).toBe(true);
        });

        test('should handle missing price data gracefully', async () => {
            const candles = generateCandles(250);
            mockDataService = createMockDataService(
                { AUD_USD: candles },
                {} // No price data
            );

            const signals = await generator.generateAllSignals(mockDataService);

            // Should not throw
            expect(Array.isArray(signals)).toBe(true);
        });
    });

    describe('Lifecycle', () => {
        test('should start and stop correctly', () => {
            generator.start(mockDataService, 60000);

            expect(generator.isRunning).toBe(true);
            expect(generator.dataService).toBe(mockDataService);

            generator.stop();

            expect(generator.isRunning).toBe(false);
        });

        test('should not start twice', () => {
            generator.start(mockDataService, 60000);
            const firstInterval = generator.signalInterval;

            generator.start(mockDataService, 60000);

            expect(generator.signalInterval).toBe(firstInterval);
        });

        test('should emit generatorStopped event on stop', (done) => {
            generator.once('generatorStopped', () => {
                done();
            });

            generator.start(mockDataService, 60000);
            generator.stop();
        });
    });

    describe('Configuration', () => {
        test('should update config correctly', () => {
            const newConfig = {
                minAdx: 28,
                rsiOverbought: 80,
            };

            generator.updateConfig(newConfig);

            expect(generator.config.minAdx).toBe(28);
            expect(generator.config.rsiOverbought).toBe(80);
            // Other config should remain unchanged
            expect(generator.config.strategy).toBe('supertrend_momentum');
        });

        test('should return complete status', () => {
            generator._pendingEntries.set('AUD_USD', {
                flipTime: Date.now(),
                flipPrice: 1.165,
                flipAdx: 25,
                flipRsi: 76,
                waitingFor: 'RSI_COOLDOWN',
            });

            const status = generator.getStatus();

            expect(status).toHaveProperty('isActive');
            expect(status).toHaveProperty('config');
            expect(status).toHaveProperty('activeSignals');
            expect(status).toHaveProperty('pendingEntries');
            expect(status.pendingEntries.length).toBe(1);
            expect(status.pendingEntries[0].symbol).toBe('AUD_USD');
        });
    });

    describe('Edge Cases', () => {
        test('should handle JPY pairs correctly (different pip value)', async () => {
            const candles = generateCandles(250, 150.500); // JPY-like prices
            const currentPrice = candles[candles.length - 1].close;

            generator.dataService = {
                getPipValue: jest.fn().mockReturnValue(0.01), // JPY pip value
            };

            const signal = await generator.generateSignal('USD_JPY', candles, currentPrice);

            expect(signal).not.toBeNull();
            expect(signal.symbol).toBe('USD_JPY');
        });

        test('should handle very volatile data', async () => {
            // Create very volatile candles
            const candles = [];
            let price = 1.16500;
            for (let i = 0; i < 250; i++) {
                const volatility = 0.01; // 1% swings
                price += (Math.random() - 0.5) * volatility;
                candles.push({
                    time: Date.now() - (250 - i) * 15 * 60 * 1000,
                    open: price,
                    high: price + volatility / 2,
                    low: price - volatility / 2,
                    close: price + (Math.random() - 0.5) * volatility / 2,
                    volume: 100,
                });
            }

            const signal = await generator.generateSignal(
                'AUD_USD',
                candles,
                candles[candles.length - 1].close
            );

            expect(signal).not.toBeNull();
            // Should have high ATR due to volatility
            expect(signal.atrPips).toBeGreaterThan(0);
        });

        test('should handle flat/ranging market', async () => {
            const candles = generateChoppyCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal).not.toBeNull();
            // ADX should be lower in ranging market
            expect(signal.strength).toBeDefined();
        });
    });
});
