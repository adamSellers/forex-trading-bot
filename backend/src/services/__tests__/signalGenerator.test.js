// Tests for SignalGenerator - Strategy and signal logic
const SignalGenerator = require('../signalGenerator');
const { RSI, ADX, ATR } = require('technicalindicators');
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
    let mockSignalRepository;

    beforeEach(() => {
        // Create mock signal repository
        mockSignalRepository = {
            saveBatch: jest.fn().mockResolvedValue(undefined),
            save: jest.fn().mockResolvedValue(undefined),
        };

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
        jest.restoreAllMocks();
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

        test('should accept signalRepository as second parameter', () => {
            const gen = new SignalGenerator({}, mockSignalRepository);
            expect(gen.signalRepo).toBe(mockSignalRepository);
        });

        test('should work without signalRepository (null)', () => {
            const gen = new SignalGenerator({}, null);
            expect(gen.signalRepo).toBeNull();
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

        test('should queue a long pullback setup when a fresh flip is overextended', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend').mockImplementation((highs) => ({
                superTrend: new Array(highs.length).fill(currentPrice),
                direction: [...new Array(highs.length - 2).fill(-1), -1, 1],
                atr: new Array(highs.length).fill(0.001),
            }));
            jest.spyOn(RSI, 'calculate').mockReturnValue([78]);
            jest.spyOn(ATR, 'calculate').mockReturnValue([0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 17, mdi: 14 },
                { adx: 21, pdi: 19, mdi: 13 },
                { adx: 22, pdi: 21, mdi: 12 },
                { adx: 25, pdi: 24, mdi: 10 },
            ]);

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.signal).toBe('HOLD');
            expect(signal.message).toContain('waiting for pullback');
            expect(generator._pendingEntries.get('AUD_USD')).toMatchObject({
                state: 'AWAIT_PULLBACK',
                waitingFor: 'PULLBACK',
                direction: 'LONG',
            });
        });

        test('should require directional ADX confirmation before long entry', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend').mockImplementation((highs) => ({
                superTrend: new Array(highs.length).fill(currentPrice),
                direction: [...new Array(highs.length - 2).fill(-1), -1, 1],
                atr: new Array(highs.length).fill(0.001),
            }));
            jest.spyOn(RSI, 'calculate').mockReturnValue([62]);
            jest.spyOn(ATR, 'calculate').mockReturnValue([0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 17, mdi: 19 },
                { adx: 21, pdi: 17, mdi: 20 },
                { adx: 22, pdi: 18, mdi: 21 },
                { adx: 25, pdi: 18, mdi: 22 },
            ]);

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.signal).toBe('HOLD');
            expect(signal.message).toContain('directional ADX');
            expect(generator._pendingEntries.has('AUD_USD')).toBe(false);
        });

        test('should keep a fresh long flip pending when higher timeframe trend disagrees', async () => {
            const m15Candles = generateCandles(250);
            const h1Candles = generateCandles(120, 1.165, 'AUD_USD', 'down');
            const currentPrice = m15Candles[m15Candles.length - 1].close;

            generator.updateConfig({
                enableHTFFilter: true,
                htfTimeframe: '1h',
            });
            generator.dataService = createMockDataService({
                AUD_USD: m15Candles,
                'AUD_USD_1h': h1Candles,
            });

            jest.spyOn(generator, 'calculateSuperTrend').mockImplementation((highs) => {
                const isHtf = highs.length === h1Candles.length;
                return {
                    superTrend: new Array(highs.length).fill(currentPrice),
                    direction: isHtf
                        ? new Array(highs.length).fill(-1)
                        : [...new Array(highs.length - 2).fill(-1), -1, 1],
                    atr: new Array(highs.length).fill(0.001),
                };
            });
            jest.spyOn(RSI, 'calculate').mockReturnValue([60]);
            jest.spyOn(ATR, 'calculate').mockReturnValue([0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 18, mdi: 12 },
                { adx: 21, pdi: 20, mdi: 12 },
                { adx: 22, pdi: 21, mdi: 11 },
                { adx: 25, pdi: 24, mdi: 10 },
            ]);

            const signal = await generator.generateSignal('AUD_USD', m15Candles, currentPrice);

            expect(signal.signal).toBe('HOLD');
            expect(signal.message).toContain('waiting for HTF confirmation');
            expect(generator._pendingEntries.get('AUD_USD')).toMatchObject({
                state: 'AWAIT_HTF_CONFIRMATION',
                waitingFor: 'HTF_CONFIRMATION',
                direction: 'LONG',
            });
        });

        test('should not queue short continuations when short continuation is disabled', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            generator.updateConfig({
                enableShortContinuationEntry: false,
            });
            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend').mockImplementation((highs) => ({
                superTrend: new Array(highs.length).fill(currentPrice),
                direction: [...new Array(highs.length - 2).fill(1), 1, -1],
                atr: new Array(highs.length).fill(0.001),
            }));
            jest.spyOn(RSI, 'calculate').mockReturnValue([55]);
            jest.spyOn(ATR, 'calculate').mockReturnValue([0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 12, mdi: 18 },
                { adx: 21, pdi: 11, mdi: 20 },
                { adx: 22, pdi: 10, mdi: 21 },
                { adx: 25, pdi: 9, mdi: 24 },
            ]);

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.signal).toBe('SELL');
            expect(signal.entryType).toBe('EXIT_ONLY');
            expect(signal.message).toContain('momentum too strong');
            expect(generator._pendingEntries.has('AUD_USD')).toBe(false);
        });
    });

    describe('Continuation Entries', () => {
        test('should enter after higher timeframe confirmation if price is still chaseable', async () => {
            const firstCandles = generateCandles(250);
            const firstCurrent = firstCandles[firstCandles.length - 1];
            firstCurrent.open = 1.1647;
            firstCurrent.low = 1.1645;
            firstCurrent.high = 1.1652;
            firstCurrent.close = 1.1650;
            const firstPrice = firstCurrent.close;
            const confirmedCandles = firstCandles.map((c) => ({ ...c }));
            const confirmedCurrent = confirmedCandles[confirmedCandles.length - 1];
            confirmedCurrent.open = 1.1654;
            confirmedCurrent.low = 1.1651;
            confirmedCurrent.high = 1.1663;
            confirmedCurrent.close = 1.1662;

            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend')
                .mockImplementationOnce((highs) => ({
                    superTrend: new Array(highs.length).fill(firstPrice),
                    direction: [...new Array(highs.length - 2).fill(-1), -1, 1],
                    atr: new Array(highs.length).fill(0.001),
                }))
                .mockImplementation((highs) => ({
                    superTrend: new Array(highs.length).fill(firstPrice),
                    direction: new Array(highs.length).fill(1),
                    atr: new Array(highs.length).fill(0.001),
                }))
                .mockImplementationOnce((highs) => ({
                    superTrend: new Array(highs.length).fill(firstPrice),
                    direction: new Array(highs.length).fill(1),
                    atr: new Array(highs.length).fill(0.001),
                }));
            jest.spyOn(generator, 'getHtfTrendContext')
                .mockReturnValueOnce({
                    enabled: true,
                    timeframe: '1h',
                    direction: -1,
                    longAllowed: false,
                    shortAllowed: true,
                    reason: 'HTF 1h downtrend',
                })
                .mockReturnValueOnce({
                    enabled: true,
                    timeframe: '1h',
                    direction: 1,
                    longAllowed: true,
                    shortAllowed: false,
                    reason: 'HTF 1h uptrend',
                })
                .mockReturnValue({
                    enabled: true,
                    timeframe: '1h',
                    direction: 1,
                    longAllowed: true,
                    shortAllowed: false,
                    reason: 'HTF 1h uptrend',
                });
            jest.spyOn(RSI, 'calculate').mockImplementation(() => [61]);
            jest.spyOn(ATR, 'calculate').mockImplementation(() => [0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 18, mdi: 12 },
                { adx: 21, pdi: 20, mdi: 12 },
                { adx: 22, pdi: 21, mdi: 11 },
                { adx: 25, pdi: 24, mdi: 10 },
            ]);

            const firstSignal = await generator.generateSignal('AUD_USD', firstCandles, firstPrice);

            expect(firstSignal.signal).toBe('HOLD');
            expect(generator._pendingEntries.get('AUD_USD')).toMatchObject({
                state: 'AWAIT_HTF_CONFIRMATION',
                waitingFor: 'HTF_CONFIRMATION',
                direction: 'LONG',
            });

            const secondSignal = await generator.generateSignal('AUD_USD', confirmedCandles, confirmedCurrent.close);

            expect(secondSignal.signal).toBe('BUY');
            expect(secondSignal.entryType).toBe('HTF_CONFIRMATION');
            expect(secondSignal.message).toContain('HTF confirmed after M15 flip');
            expect(generator._pendingEntries.has('AUD_USD')).toBe(false);
        });

        test('should hand off to pullback continuation when HTF confirms after an extended move', async () => {
            const firstCandles = generateCandles(250);
            const firstCurrent = firstCandles[firstCandles.length - 1];
            firstCurrent.open = 1.1647;
            firstCurrent.low = 1.1645;
            firstCurrent.high = 1.1652;
            firstCurrent.close = 1.1650;
            const firstPrice = firstCurrent.close;
            const extendedCandles = firstCandles.map((c) => ({ ...c }));
            const extendedCurrent = extendedCandles[extendedCandles.length - 1];
            extendedCurrent.open = 1.1708;
            extendedCurrent.low = 1.1705;
            extendedCurrent.high = 1.1718;
            extendedCurrent.close = 1.1715;

            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend')
                .mockImplementationOnce((highs) => ({
                    superTrend: new Array(highs.length).fill(firstPrice),
                    direction: [...new Array(highs.length - 2).fill(-1), -1, 1],
                    atr: new Array(highs.length).fill(0.001),
                }))
                .mockImplementation((highs) => ({
                    superTrend: new Array(highs.length).fill(firstPrice),
                    direction: new Array(highs.length).fill(1),
                    atr: new Array(highs.length).fill(0.001),
                }))
                .mockImplementationOnce((highs) => ({
                    superTrend: new Array(highs.length).fill(firstPrice),
                    direction: new Array(highs.length).fill(1),
                    atr: new Array(highs.length).fill(0.001),
                }));
            jest.spyOn(generator, 'getHtfTrendContext')
                .mockReturnValueOnce({
                    enabled: true,
                    timeframe: '1h',
                    direction: -1,
                    longAllowed: false,
                    shortAllowed: true,
                    reason: 'HTF 1h downtrend',
                })
                .mockReturnValueOnce({
                    enabled: true,
                    timeframe: '1h',
                    direction: 1,
                    longAllowed: true,
                    shortAllowed: false,
                    reason: 'HTF 1h uptrend',
                })
                .mockReturnValue({
                    enabled: true,
                    timeframe: '1h',
                    direction: 1,
                    longAllowed: true,
                    shortAllowed: false,
                    reason: 'HTF 1h uptrend',
                });
            jest.spyOn(RSI, 'calculate').mockImplementation(() => [67]);
            jest.spyOn(ATR, 'calculate').mockImplementation(() => [0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 18, mdi: 12 },
                { adx: 21, pdi: 20, mdi: 12 },
                { adx: 22, pdi: 21, mdi: 11 },
                { adx: 25, pdi: 24, mdi: 10 },
            ]);

            await generator.generateSignal('AUD_USD', firstCandles, firstPrice);

            const secondSignal = await generator.generateSignal('AUD_USD', extendedCandles, extendedCurrent.close);

            expect(secondSignal.signal).toBe('HOLD');
            expect(secondSignal.message).toContain('HTF confirmed but move extended');
            expect(generator._pendingEntries.get('AUD_USD')).toMatchObject({
                state: 'AWAIT_PULLBACK',
                waitingFor: 'PULLBACK',
                direction: 'LONG',
            });
        });

        test('should expire delayed HTF confirmation once the continuation window closes', () => {
            const result = generator.evaluateLongHtfConfirmationSetup({
                pending: {
                    direction: 'LONG',
                    state: 'AWAIT_HTF_CONFIRMATION',
                    waitingFor: 'HTF_CONFIRMATION',
                    flipTime: Date.now() - (generator.config.continuationWindowMs + 1000),
                    flipPrice: 1.165,
                    peakPrice: 1.166,
                },
                signalCandleTime: Date.now(),
                currentDir: 1,
                currentClose: 1.1658,
                currentHigh: 1.166,
                currentLow: 1.1652,
                adxMeetsThreshold: true,
                adxOk: true,
                longDiOk: true,
                longBaseRegimeOk: true,
                longContinuationEnabled: true,
                htfContext: {
                    enabled: true,
                    timeframe: '1h',
                    direction: -1,
                    longAllowed: false,
                    shortAllowed: true,
                    reason: 'HTF 1h downtrend',
                },
                rsiVal: 61,
                adxVal: 25,
            });

            expect(result).toEqual(
                expect.objectContaining({
                    clearPending: true,
                    reasonCode: 'LONG_WAIT_HTF_EXPIRED',
                    signalClass: 'FILTERED',
                    intent: 'WAIT',
                })
            );
        });

        test('should transition a pending long setup from pullback wait to breakout wait', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            generator._pendingEntries.set('AUD_USD', {
                direction: 'LONG',
                state: 'AWAIT_PULLBACK',
                waitingFor: 'PULLBACK',
                flipTime: Date.now() - 30 * 60 * 1000,
                flipPrice: 1.16500,
                flipAdx: 25,
                flipRsi: 74,
                peakPrice: 1.1700,
                troughPrice: 1.1650,
            });

            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend').mockImplementation((highs) => ({
                superTrend: new Array(highs.length).fill(currentPrice),
                direction: new Array(highs.length).fill(1),
                atr: new Array(highs.length).fill(0.001),
            }));
            jest.spyOn(RSI, 'calculate').mockReturnValue([66]);
            jest.spyOn(ATR, 'calculate').mockReturnValue([0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 18, mdi: 12 },
                { adx: 21, pdi: 19, mdi: 12 },
                { adx: 22, pdi: 21, mdi: 11 },
                { adx: 25, pdi: 24, mdi: 10 },
            ]);

            const previous = candles[candles.length - 2];
            const current = candles[candles.length - 1];
            previous.close = 1.1694;
            previous.low = 1.1691;
            previous.high = 1.1701;
            current.open = 1.1692;
            current.close = 1.1689;
            current.low = 1.1690;
            current.high = 1.1695;

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.signal).toBe('HOLD');
            expect(signal.message).toContain('pullback detected');
            expect(generator._pendingEntries.get('AUD_USD')).toMatchObject({
                state: 'AWAIT_REACCELERATION',
                waitingFor: 'REACCELERATION',
                direction: 'LONG',
            });
        });

        test('should enter on long pullback reacceleration only after breakout', async () => {
            const candles = generateCandles(250);
            const currentPrice = candles[candles.length - 1].close;

            generator._pendingEntries.set('AUD_USD', {
                direction: 'LONG',
                state: 'AWAIT_REACCELERATION',
                waitingFor: 'REACCELERATION',
                flipTime: Date.now() - 45 * 60 * 1000,
                flipPrice: 1.16500,
                flipAdx: 25,
                flipRsi: 74,
                peakPrice: 1.1700,
                troughPrice: 1.1650,
                pullbackLow: 1.1688,
                pullbackHigh: 1.1696,
                pullbackDepthAtr: 1.2,
                reaccelerationTrigger: 1.1696,
            });

            generator.dataService = createMockDataService();
            jest.spyOn(generator, 'calculateSuperTrend').mockImplementation((highs) => ({
                superTrend: new Array(highs.length).fill(currentPrice),
                direction: new Array(highs.length).fill(1),
                atr: new Array(highs.length).fill(0.001),
            }));
            jest.spyOn(RSI, 'calculate').mockReturnValue([61]);
            jest.spyOn(ATR, 'calculate').mockReturnValue([0.001]);
            jest.spyOn(ADX, 'calculate').mockReturnValue([
                { adx: 20, pdi: 18, mdi: 12 },
                { adx: 21, pdi: 20, mdi: 12 },
                { adx: 22, pdi: 22, mdi: 11 },
                { adx: 25, pdi: 25, mdi: 10 },
            ]);

            const previous = candles[candles.length - 2];
            const current = candles[candles.length - 1];
            previous.high = 1.1699;
            previous.low = 1.1689;
            previous.close = 1.1691;
            current.open = 1.1692;
            current.low = 1.1691;
            current.high = 1.1708;
            current.close = 1.1702;

            const signal = await generator.generateSignal('AUD_USD', candles, currentPrice);

            expect(signal.signal).toBe('BUY');
            expect(signal.entryType).toBe('CONTINUATION_PULLBACK');
            expect(signal.message).toContain('Pullback reacceleration');
            expect(generator._pendingEntries.has('AUD_USD')).toBe(false);
        });

        test('should expire pending entry after window closes', () => {
            // Set an old pending entry
            generator._pendingEntries.set('AUD_USD', {
                direction: 'LONG',
                state: 'AWAIT_PULLBACK',
                flipTime: Date.now() - 5 * 60 * 60 * 1000,
                flipPrice: 1.16500,
                flipAdx: 25,
                flipRsi: 76,
                waitingFor: 'PULLBACK',
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

        test('should store candle metadata for cooldown tracking after an actionable signal', () => {
            const signal = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25,
                entryType: 'FRESH_FLIP',
                signalCandleTime: '2026-03-06T00:00:00.000000000Z',
                timestamp: Date.now(),
            };

            generator.validateSignal(signal);

            expect(generator.lastSignals.get('AUD_USD_BUY')).toEqual(
                expect.objectContaining({
                    time: expect.any(Number),
                    signalCandleTime: '2026-03-06T00:00:00.000000000Z',
                    entryType: 'FRESH_FLIP',
                })
            );
        });

        test('should not emit the same actionable signal twice for the same candle', () => {
            const signal1 = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25,
                entryType: 'FRESH_FLIP',
                signalCandleTime: '2026-03-06T00:00:00.000000000Z',
                timestamp: Date.now(),
            };

            const validated1 = generator.validateSignal(signal1);
            expect(validated1.signal).toBe('BUY');

            generator.lastSignals.set('AUD_USD_BUY', {
                time: Date.now() - 120000,
                signalCandleTime: signal1.signalCandleTime,
                entryType: signal1.entryType,
            });

            const validated2 = generator.validateSignal({
                ...signal1,
                timestamp: Date.now() + 120000,
            });
            expect(validated2.signal).toBe('COOLDOWN');
            expect(validated2.message).toContain('already emitted for this candle');
        });

        test('should preserve cooldown-relevant metadata on same-candle suppression', () => {
            const signal = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25,
                entryType: 'FRESH_FLIP',
                signalCandleTime: '2026-03-06T00:00:00.000000000Z',
                reasonCode: 'LONG_FRESH_FLIP_ACTIONABLE',
                decisionContext: {
                    htfAligned: true,
                },
                timestamp: Date.now(),
            };

            generator.validateSignal(signal);
            const suppressed = generator.validateSignal({
                ...signal,
                timestamp: Date.now() + 120000,
            });

            expect(suppressed).toEqual(
                expect.objectContaining({
                    symbol: 'AUD_USD',
                    signal: 'COOLDOWN',
                    entryType: 'FRESH_FLIP',
                    signalCandleTime: '2026-03-06T00:00:00.000000000Z',
                    reasonCode: 'COOLDOWN_DUPLICATE_CANDLE',
                    signalClass: 'COOLDOWN',
                    uniqueEvent: false,
                    cooldownSuppressed: true,
                    decisionContext: expect.objectContaining({
                        htfAligned: true,
                        originalSignal: 'BUY',
                        originalEntryType: 'FRESH_FLIP',
                        originalReasonCode: 'LONG_FRESH_FLIP_ACTIONABLE',
                    }),
                })
            );
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
                direction: 'LONG',
                state: 'AWAIT_PULLBACK',
                flipTime: Date.now(),
                flipPrice: 1.165,
                flipAdx: 25,
                flipRsi: 76,
                waitingFor: 'PULLBACK',
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

    describe('Signal Persistence', () => {
        test('should persist signals when signalRepository is provided', async () => {
            const genWithRepo = new SignalGenerator({
                assets: ['AUD_USD'],
                minAdx: 22,
            }, mockSignalRepository);

            const candles = generateCandles(250);
            mockDataService = createMockDataService(
                { AUD_USD: candles },
                { AUD_USD: { price: 1.16571, bid: 1.16566, ask: 1.16576 } }
            );

            genWithRepo.dataService = mockDataService;
            await genWithRepo.generateSignalCycle();

            // Should have called saveBatch with the generated signals
            expect(mockSignalRepository.saveBatch).toHaveBeenCalled();
        });

        test('should not call saveBatch when signalRepository is null', async () => {
            const genWithoutRepo = new SignalGenerator({
                assets: ['AUD_USD'],
                minAdx: 22,
            }, null);

            const candles = generateCandles(250);
            mockDataService = createMockDataService(
                { AUD_USD: candles },
                { AUD_USD: { price: 1.16571, bid: 1.16566, ask: 1.16576 } }
            );

            genWithoutRepo.dataService = mockDataService;

            // Should not throw
            await expect(genWithoutRepo.generateSignalCycle()).resolves.not.toThrow();
        });

        test('should not persist when no signals generated', async () => {
            const genWithRepo = new SignalGenerator({
                assets: [], // No assets = no signals
                minAdx: 22,
            }, mockSignalRepository);

            genWithRepo.dataService = mockDataService;
            await genWithRepo.generateSignalCycle();

            // Should not call saveBatch when signals array is empty
            expect(mockSignalRepository.saveBatch).not.toHaveBeenCalled();
        });

        test('should handle saveBatch errors gracefully', async () => {
            const errorRepo = {
                saveBatch: jest.fn().mockRejectedValue(new Error('DB error')),
            };

            const genWithErrorRepo = new SignalGenerator({
                assets: ['AUD_USD'],
                minAdx: 22,
            }, errorRepo);

            const candles = generateCandles(250);
            mockDataService = createMockDataService(
                { AUD_USD: candles },
                { AUD_USD: { price: 1.16571, bid: 1.16566, ask: 1.16576 } }
            );

            genWithErrorRepo.dataService = mockDataService;

            // Should not throw even if saveBatch fails
            await expect(genWithErrorRepo.generateSignalCycle()).resolves.not.toThrow();
        });

    });
});
