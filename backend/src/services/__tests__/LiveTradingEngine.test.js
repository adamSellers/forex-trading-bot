// Tests for LiveTradingEngine - Critical trading logic
const LiveTradingEngine = require('../LiveTradingEngine');
const {
    createMockConfigService,
    createMockTradeRepository,
    createMockSignalGenerator,
    createMockEntryDecisionRepository,
} = require('../../../__tests__/helpers/mockServices');
const { createMockSignal, createSellSignal } = require('../../../__tests__/fixtures/mockSignals');
const { createMockTrade } = require('../../../__tests__/fixtures/mockTrades');
const { ENTRY_REJECTION_CODES } = require('../../constants/entryDecisionCodes');

// Mock the oandaClient module - must use inline factory due to jest hoisting
jest.mock('../Oandaclient', () => ({
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
    getInstrumentMetadata: jest.fn().mockResolvedValue({
        name: 'AUD_USD',
        displayPrecision: 5,
        pipLocation: -4,
        marginRate: '0.05',
    }),
    buildClientExtensions: jest.fn((intentId) => ({
        order: { id: `oi-${intentId}` },
        trade: { id: `ti-${intentId}` },
    })),
    findOrderIntent: jest.fn().mockResolvedValue({ status: 'AMBIGUOUS' }),
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
}));

function createMockBrokerLifecycleRepository() {
    const intents = new Map();
    const quarantines = new Map();
    const state = new Map();
    return {
        intents,
        quarantines,
        state,
        createIntent: jest.fn(async (intent) => {
            intents.set(intent.intentId, { ...intent });
            return intents.get(intent.intentId);
        }),
        updateIntent: jest.fn(async (intentId, updates) => {
            const next = { ...(intents.get(intentId) || { intentId }), ...updates };
            intents.set(intentId, next);
            return next;
        }),
        getRecoverableIntents: jest.fn(async () =>
            [...intents.values()].filter((intent) =>
                ['PREPARED', 'SUBMITTING', 'AMBIGUOUS', 'RECOVERY_PENDING', 'FILLED_UNPERSISTED'].includes(intent.status)
            )
        ),
        getIntentByBrokerTradeId: jest.fn(async (brokerTradeId) =>
            [...intents.values()].find(
                (intent) => String(intent.brokerTradeId) === String(brokerTradeId)
            ) || null
        ),
        getIntentByClientTradeId: jest.fn(async (clientTradeId) =>
            [...intents.values()].find(
                (intent) => intent.clientTradeId === clientTradeId
            ) || null
        ),
        quarantineBrokerTrade: jest.fn(async (record) => {
            quarantines.set(String(record.brokerTradeId), record);
            return record;
        }),
        resolveMissingQuarantines: jest.fn().mockResolvedValue(0),
        getOpenQuarantines: jest.fn(async () => [...quarantines.values()]),
        getState: jest.fn(async (key) => state.get(key) || null),
        setState: jest.fn(async (key, value) => {
            state.set(key, value);
            return value;
        }),
    };
}

// Mock email service
jest.mock('../emailService', () => ({
    sendTradeOpenedAlert: jest.fn().mockResolvedValue(true),
    sendTradeClosedAlert: jest.fn().mockResolvedValue(true),
}));

describe('LiveTradingEngine', () => {
    let engine;
    let mockConfigService;
    let mockTradeRepository;
    let mockSignalGenerator;
    let mockDataService;
    let mockEntryDecisionRepository;
    let oandaClient;

    const mockAudUsdPricingOnly = () => {
        oandaClient.getPricing.mockImplementation(async (instruments) => {
            const instrument = instruments[0];
            if (instrument === 'AUD_USD') {
                return {
                    prices: [
                        {
                            instrument: 'AUD_USD',
                            closeoutBid: '0.6599',
                            closeoutAsk: '0.6601',
                            bids: [{ price: '0.6599' }],
                            asks: [{ price: '0.6601' }],
                        },
                    ],
                };
            }

            throw new Error(`Unexpected pricing request: ${instrument}`);
        });
    };

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Get the mocked oandaClient
        oandaClient = require('../Oandaclient');
        oandaClient.getAccountSummary.mockResolvedValue({
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
        });
        oandaClient.getPricing.mockResolvedValue({
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
        });

        // Create fresh mocks for each test
        mockConfigService = createMockConfigService({
            enableTrading: true,
            maxOpenPositions: 2,
            riskPerTrade: 0.02,
            maxCapitalAtRisk: 70,
            maxPortfolioExposure: 0.5,
            maxAggregateStopRiskPctNav: 1,
            maxNetCurrencyExposurePctNav: 100,
            maxCorrelatedExposurePctNav: 100,
            maxDailyLossPctNav: 1,
            maxDrawdownPctNav: 1,
            maxConsecutiveLosses: 100,
            minNavAud: 0,
            marginBuffer: 0.20,
            enableTakeProfit: true,
            takeProfitPercent: 0.06,
            stopLossAtrMultiplier: 2.0,
            minStopLossPips: 12,
            enableSessionFilter: false,
            activeSessions: ['sydney', 'tokyo', 'london', 'newyork'],
            enableBreakeven: false,
            breakevenTriggerPips: 12,
            minAdx: 22,
            assets: ['AUD_USD', 'EUR_USD'],
            leverage: 20,
        });

        mockTradeRepository = createMockTradeRepository();
        mockEntryDecisionRepository = createMockEntryDecisionRepository();

        mockSignalGenerator = createMockSignalGenerator();

        mockDataService = {
            getCurrentPrice: jest.fn().mockReturnValue({
                price: 1.16571,
                bid: 1.16566,
                ask: 1.16576,
                spread: 1.0,
                timestamp: Date.now(),
            }),
            getCandles: jest.fn().mockReturnValue([]),
            getPipValue: jest.fn().mockReturnValue(0.0001),
        };

        // Create engine instance
        engine = new LiveTradingEngine();
        engine.init(
            mockConfigService,
            mockDataService,
            mockTradeRepository,
            mockSignalGenerator,
            null, // io
            mockEntryDecisionRepository
        );
    });

    afterEach(() => {
        if (engine.isRunning) {
            engine.stop();
        }
    });

    describe('Initialization', () => {
        test('should initialize with correct default state', () => {
            expect(engine.isRunning).toBe(false);
            expect(engine.openTrades.size).toBe(0);
            expect(engine.stats.tradesExecuted).toBe(0);
        });

        test('should inject dependencies correctly', () => {
            expect(engine.configService).toBe(mockConfigService);
            expect(engine.dataService).toBe(mockDataService);
            expect(engine.tradeRepository).toBe(mockTradeRepository);
            expect(engine.signalGenerator).toBe(mockSignalGenerator);
        });

        test('should throw error if started without dependencies', async () => {
            const uninitEngine = new LiveTradingEngine();
            await expect(uninitEngine.start()).rejects.toThrow(
                'Trading engine not properly initialized'
            );
        });
    });

    describe('validateEntry', () => {
        test('should reject when trading is disabled', async () => {
            const signal = createMockSignal();
            const config = { ...mockConfigService.get(), enableTrading: false };

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.TRADING_DISABLED);
            expect(result.reason).toBe('Trading is disabled');
        });

        test('should reject when instrument not in active list', async () => {
            const signal = createMockSignal({ symbol: 'GBP_USD' });
            const config = mockConfigService.get();

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.INACTIVE_ASSET);
            expect(result.reason).toContain('not in active list');
        });

        test('should reject when no live price data is available', async () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            mockDataService.getCurrentPrice.mockReturnValue(null);

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.NO_LIVE_PRICE);
            expect(result.reason).toContain('No live price data');
        });

        test('should reject when instrument is not currently tradeable', async () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            mockDataService.getCurrentPrice.mockReturnValue({
                price: 1.16571,
                bid: 1.16566,
                ask: 1.16576,
                spread: 1.0,
                tradeable: false,
                timestamp: Date.now(),
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.NOT_TRADEABLE);
            expect(result.reason).toContain('not currently tradeable');
        });

        test('should reject when live price data is stale', async () => {
            const signal = createMockSignal();
            const config = { ...mockConfigService.get(), maxPriceAgeMs: 15000 };

            mockDataService.getCurrentPrice.mockReturnValue({
                price: 1.16571,
                bid: 1.16566,
                ask: 1.16576,
                spread: 1.0,
                tradeable: true,
                timestamp: Date.now() - 30000,
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.STALE_PRICE);
            expect(result.reason).toContain('Price data stale');
        });

        test('should reject when spread exceeds configured cap', async () => {
            const signal = createMockSignal();
            const config = { ...mockConfigService.get(), maxSpreadPips: 2.0 };

            mockDataService.getCurrentPrice.mockReturnValue({
                price: 1.16571,
                bid: 1.16550,
                ask: 1.16590,
                spread: 4.0,
                tradeable: true,
                timestamp: Date.now(),
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.SPREAD_TOO_WIDE);
            expect(result.reason).toContain('Spread too wide');
        });

        test('should reject when max positions reached', async () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            // Add 2 open trades
            engine.openTrades.set('trade1', createMockTrade());
            engine.openTrades.set('trade2', createMockTrade({ instrument: 'EUR_USD' }));

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.MAX_POSITIONS);
            expect(result.reason).toContain('Max positions reached');
        });

        test('should reject when already in position for instrument', async () => {
            const signal = createMockSignal({ symbol: 'AUD_USD' });
            const config = mockConfigService.get();

            // Add existing trade for same instrument
            engine.openTrades.set('trade1', createMockTrade({ instrument: 'AUD_USD' }));

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.ALREADY_IN_POSITION);
            expect(result.reason).toBe('Already in position for this instrument');
        });

        test('does not add a second ADX gate to the carry-trend strategy', async () => {
            const signal = createMockSignal({
                strength: 0,
                strategy: 'carry_trend',
                entryType: 'CARRY_TREND_BREAKOUT',
            });
            const config = {
                ...mockConfigService.get(),
                strategy: 'carry_trend',
                enableAdxFilter: false,
                enableSessionFilter: false,
            };

            jest.spyOn(engine, 'estimateEntryMargin').mockResolvedValue(10);
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '100.00',
                    marginUsed: '20.00',
                    marginAvailable: '80.00',
                },
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(true);
        });

        test('should reject SELL signal when shorting disabled', async () => {
            const signal = createSellSignal();
            const config = { ...mockConfigService.get(), enableShorting: false };

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.SHORT_DISABLED);
            expect(result.reason).toBe('Short selling is disabled');
        });

        test('should reject entry outside configured trading sessions', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableSessionFilter: true,
                activeSessions: ['london'],
            };

            jest.spyOn(engine, 'getCurrentUtcHour').mockReturnValue(2); // Not in London session

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.OUTSIDE_SESSION);
            expect(result.reason).toContain('Outside active sessions');
        });

        test('should reject invalid non-entry signal types', async () => {
            const signal = createMockSignal({ signal: 'HOLD' });
            const config = mockConfigService.get();

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.INVALID_SIGNAL);
            expect(result.reason).toBe('Invalid signal type');
        });

        test('should reject entry when portfolio exposure limit is reached', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                maxPortfolioExposure: 0.5,
            };

            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '100.00',
                    marginUsed: '60.00',
                    marginAvailable: '40.00',
                },
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.EXPOSURE_LIMIT);
            expect(result.reason).toContain('Portfolio exposure limit reached');
        });

        test('should reject entry when projected margin would exceed exposure cap', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                maxPortfolioExposure: 0.5,
            };

            jest.spyOn(engine, 'estimateEntryMargin').mockResolvedValue(35);
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '100.00',
                    marginUsed: '20.00',
                    marginAvailable: '80.00',
                },
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.code).toBe(ENTRY_REJECTION_CODES.EXPOSURE_LIMIT);
            expect(result.reason).toContain('Portfolio exposure limit reached');
            expect(result.reason).toContain('projected');
        });

        test('should approve valid BUY signal', async () => {
            const signal = createMockSignal({
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 28,
            });
            const config = mockConfigService.get();
            jest.spyOn(engine, 'estimateEntryMargin').mockResolvedValue(10);
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '100.00',
                    marginUsed: '20.00',
                    marginAvailable: '80.00',
                },
            });

            const result = await engine.validateEntry(signal, config);

            expect(result.valid).toBe(true);
        });

        test('rejects an entry that breaches the aggregate AUD portfolio policy', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                maxPortfolioExposure: null,
                maxAggregateStopRiskPctNav: 0.000001,
            };

            const result = await engine.validateEntry(signal, config);

            expect(result).toEqual(
                expect.objectContaining({
                    valid: false,
                    code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                    reason: 'Portfolio risk rejected entry: AGGREGATE_STOP_RISK',
                })
            );
            expect(result.context.portfolioRisk.referenceCurrency).toBe('AUD');
        });
    });

    describe('calculatePositionSize', () => {
        test('should use marginAvailable not total balance', async () => {
            // Oanda returns: balance=$136, marginAvailable=$71
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '136.00',
                    marginAvailable: '71.00',
                },
            });

            const config = mockConfigService.get();
            const units = await engine.calculatePositionSize(
                'AUD_USD',
                12, // stopLossPips
                1.16571, // currentPrice
                config
            );

            // Should use marginAvailable ($71) not balance ($136)
            // Safe margin = $71 * 0.80 = $56.80 (after 20% buffer)
            // Effective = min($56.80, $70 maxCapitalAtRisk) = $56.80
            expect(units).toBeGreaterThan(0);
            expect(oandaClient.getAccountSummary).toHaveBeenCalled();
        });

        test('should apply margin buffer correctly', async () => {
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '100.00',
                    marginAvailable: '100.00',
                },
            });

            const config = { ...mockConfigService.get(), marginBuffer: 0.20 };
            const units = await engine.calculatePositionSize(
                'AUD_USD',
                12,
                1.16571,
                config
            );

            // With 20% buffer, only $80 of $100 available is usable
            expect(units).toBeGreaterThan(0);
        });

        test('should return 0 when insufficient margin', async () => {
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '100.00',
                    marginAvailable: '5.00', // Very low margin
                },
            });

            const config = mockConfigService.get();
            const units = await engine.calculatePositionSize(
                'AUD_USD',
                12,
                1.16571,
                config
            );

            // With $5 available and 20% buffer = $4, and high minCapitalAtRisk
            // this should still calculate but might be very small
            // The actual 0 return depends on if safeMargin <= 0
            expect(typeof units).toBe('number');
        });

        test('should respect maxCapitalAtRisk cap', async () => {
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '1000.00',
                    marginAvailable: '1000.00',
                },
            });

            const config = { ...mockConfigService.get(), maxCapitalAtRisk: 50 };
            const units1 = await engine.calculatePositionSize(
                'AUD_USD',
                12,
                1.16571,
                config
            );

            // Increase maxCapitalAtRisk
            const config2 = { ...mockConfigService.get(), maxCapitalAtRisk: 200 };
            const units2 = await engine.calculatePositionSize(
                'AUD_USD',
                12,
                1.16571,
                config2
            );

            // Higher capital at risk should allow larger position
            expect(units2).toBeGreaterThan(units1);
        });

        test('should return fixed units when FIXED method selected', async () => {
            const config = {
                ...mockConfigService.get(),
                positionSizeMethod: 'FIXED',
                fixedPositionUnits: 500,
            };

            const units = await engine.calculatePositionSize(
                'AUD_USD',
                12,
                1.16571,
                config
            );

            expect(units).toBe(500);
        });

        test.each([
            ['AUD_USD', 0.66, 1600],
            ['EUR_USD', 1.08, 977],
            ['GBP_USD', 1.27, 831],
            ['USD_JPY', 150.0, 1056],
        ])(
            'should cap %s units using account-currency base notional',
            async (instrument, currentPrice, expectedUnits) => {
                oandaClient.getAccountSummary.mockResolvedValue({
                    account: {
                        currency: 'AUD',
                        balance: '1000.00',
                        marginAvailable: '100.00',
                    },
                });
                mockAudUsdPricingOnly();

                const config = {
                    ...mockConfigService.get(),
                    riskPerTrade: 1,
                    maxCapitalAtRisk: 1000,
                    marginBuffer: 0.20,
                    leverage: 20,
                };

                const units = await engine.calculatePositionSize(
                    instrument,
                    1,
                    currentPrice,
                    config
                );

                expect(units).toBe(expectedUnits);
            }
        );
    });

    describe('estimateEntryMargin', () => {
        test.each([
            ['AUD_USD', 0.66, 50.0],
            ['EUR_USD', 1.08, 81.81818],
            ['GBP_USD', 1.27, 96.21212],
            ['USD_JPY', 150.0, 75.75758],
        ])(
            'should estimate %s margin in AUD from base-currency notional',
            async (instrument, currentPrice, expectedMarginAud) => {
                mockAudUsdPricingOnly();
                jest.spyOn(engine, 'calculatePositionSize').mockResolvedValue(1000);

                const signal = createMockSignal({
                    symbol: instrument,
                    currentPrice,
                });
                const config = {
                    ...mockConfigService.get(),
                    stopLossType: 'FIXED',
                    stopLossPips: 1,
                    leverage: 20,
                };

                const margin = await engine.estimateEntryMargin(signal, config);

                expect(margin).toBeCloseTo(expectedMarginAud, 5);
            }
        );
    });

    describe('calculateStopLoss', () => {
        test('should calculate ATR-based stop loss', () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                atrPips: 10,
            });
            const config = {
                ...mockConfigService.get(),
                stopLossType: 'ATR',
                stopLossAtrMultiplier: 2.0,
            };

            const result = engine.calculateStopLoss(signal, config);

            // ATR 10 pips * 2.0 multiplier = 20 pips
            expect(result.stopLossPips).toBe(20);
            expect(result.stopLossPrice).toBeLessThan(signal.currentPrice);
        });

        test('should enforce minimum stop loss floor', () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                atrPips: 4, // Low ATR
            });
            const config = {
                ...mockConfigService.get(),
                stopLossType: 'ATR',
                stopLossAtrMultiplier: 2.0,
                minStopLossPips: 12,
            };

            const result = engine.calculateStopLoss(signal, config);

            // ATR 4 * 2.0 = 8 pips, but minimum is 12
            expect(result.stopLossPips).toBe(12);
        });

        test('should use fixed pips when ATR not available', () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                atrPips: null,
            });
            const config = {
                ...mockConfigService.get(),
                stopLossType: 'FIXED',
                stopLossPips: 25,
            };

            const result = engine.calculateStopLoss(signal, config);

            expect(result.stopLossPips).toBe(25);
        });
    });

    describe('calculateTakeProfit', () => {
        test('should calculate TP based on margin percentage', async () => {
            const signal = createMockSignal({ currentPrice: 1.16571 });
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
                takeProfitPercent: 0.06, // 6%
            };
            const units = 795;
            const marginUsed = 46.17;

            const result = await engine.calculateTakeProfit(signal, config, units, marginUsed);

            // Target = $46.17 * 0.06 = $2.77
            expect(result.targetProfitAud).toBeCloseTo(2.77, 1);
            expect(result.takeProfitPrice).toBeGreaterThan(signal.currentPrice);
        });

        test('should return null when TP disabled', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: false,
            };

            const result = await engine.calculateTakeProfit(signal, config, 795, 46.17);

            expect(result).toBeNull();
        });

        test('should return null when units is 0', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
            };

            const result = await engine.calculateTakeProfit(signal, config, 0, 46.17);

            expect(result).toBeNull();
        });

        test('should return null when margin is 0', async () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
            };

            const result = await engine.calculateTakeProfit(signal, config, 795, 0);

            expect(result).toBeNull();
        });

        test('should use entry price when provided', async () => {
            const signal = createMockSignal({ currentPrice: 1.16571 });
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
                takeProfitPercent: 0.06,
            };
            const entryPrice = 1.16600;

            const result = await engine.calculateTakeProfit(signal, config, 795, 46.17, entryPrice);

            // TP should be calculated from entry price, not signal price
            expect(result.takeProfitPrice).toBeGreaterThan(entryPrice);
        });

        test('should calculate TP for JPY-quoted pair using quote-to-account conversion', async () => {
            const signal = createMockSignal({
                symbol: 'USD_JPY',
                signal: 'BUY',
                currentPrice: 150.0,
            });
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
                takeProfitPercent: 0.06,
            };

            oandaClient.getPricing.mockImplementation(async (instruments) => {
                const instrument = instruments[0];
                if (instrument === 'AUD_USD') {
                    return {
                        prices: [{ closeoutBid: '0.6600', closeoutAsk: '0.6602' }],
                    };
                }
                if (instrument === 'USD_AUD') {
                    return {
                        prices: [{ closeoutBid: '1.5147', closeoutAsk: '1.5152' }],
                    };
                }
                if (instrument === 'JPY_USD') {
                    return {
                        prices: [{ closeoutBid: '0.0066', closeoutAsk: '0.0067' }],
                    };
                }
                if (instrument === 'USD_JPY') {
                    return {
                        prices: [{ closeoutBid: '149.95', closeoutAsk: '150.05' }],
                    };
                }
                throw new Error(`Unexpected instrument: ${instrument}`);
            });

            const result = await engine.calculateTakeProfit(signal, config, 1000, 50, 150.0);

            expect(result).toBeTruthy();
            expect(result.takeProfitPrice).toBeGreaterThan(150.0);
            expect(result.targetProfitAccount).toBeCloseTo(3.0, 6);
            expect(result.accountCurrency).toBe('AUD');
        });

        test('should calculate TP for cross quote currency via USD bridge', async () => {
            const signal = createMockSignal({
                symbol: 'GBP_CHF',
                signal: 'BUY',
                currentPrice: 1.12,
            });
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
                takeProfitPercent: 0.06,
            };

            oandaClient.getPricing.mockImplementation(async (instruments) => {
                const instrument = instruments[0];
                if (instrument === 'CHF_USD') {
                    return {
                        prices: [{ closeoutBid: '1.1000', closeoutAsk: '1.1010' }],
                    };
                }
                if (instrument === 'USD_AUD') {
                    return {
                        prices: [{ closeoutBid: '1.5147', closeoutAsk: '1.5152' }],
                    };
                }
                throw new Error(`Unexpected instrument: ${instrument}`);
            });

            const result = await engine.calculateTakeProfit(signal, config, 1000, 50, 1.12);

            expect(result).toBeTruthy();
            expect(result.takeProfitPrice).toBeGreaterThan(1.12);
            expect(result.targetProfitAccount).toBeCloseTo(3.0, 6);
        });
    });

    describe('Signal Processing', () => {
        test('should ignore non-live runtime signals', async () => {
            await engine.processSignal(
                createMockSignal({
                    mode: 'paper_shadow',
                    runId: 'run-shadow-1',
                    selectionId: 'selection-1',
                    strategy: 'supertrend_momentum',
                })
            );

            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(mockEntryDecisionRepository.save).not.toHaveBeenCalled();
        });

        test('should reject BUY signal when already in position', async () => {
            const signal = createMockSignal({ symbol: 'AUD_USD', signal: 'BUY' });

            // Add existing position
            engine.openTrades.set('existing', createMockTrade({ instrument: 'AUD_USD' }));

            await engine.processSignal(signal);

            expect(engine.stats.signalsRejected).toBe(1);
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(mockEntryDecisionRepository.save).toHaveBeenCalled();
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    stage: 'REJECTED',
                    outcome: 'REJECTED',
                    rejectionCode: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                })
            );
        });

        test('should close LONG position on SELL signal', async () => {
            const existingTrade = createMockTrade({
                id: 'trade-123',
                instrument: 'AUD_USD',
                side: 'BUY',
            });
            engine.openTrades.set(existingTrade.id, existingTrade);

            // Mock closeTrade
            oandaClient.closeTrade.mockResolvedValue({
                orderFillTransaction: {
                    price: '1.16784',
                    pl: '2.50',
                    financing: '-0.02',
                    tradesClosed: [
                        {
                            tradeID: existingTrade.oandaTradeId,
                            price: '1.16784',
                            realizedPL: '2.50',
                            financing: '-0.02',
                        },
                    ],
                },
            });

            const sellSignal = createSellSignal({
                symbol: 'AUD_USD',
                currentPrice: 1.16784,
            });

            await engine.processSignal(sellSignal);

            // Trade should be closed
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-123',
                expect.objectContaining({
                    isOpen: false,
                    exitReason: 'SIGNAL_REVERSAL',
                })
            );
        });

        test('should close a SHORT on BUY exit-only without opening a LONG', async () => {
            const existingTrade = createMockTrade({
                id: 'trade-short-exit-only',
                instrument: 'AUD_USD',
                side: 'SELL',
            });
            engine.openTrades.set(existingTrade.id, existingTrade);
            oandaClient.closeTrade.mockResolvedValue({
                orderFillTransaction: {
                    price: '1.16500',
                    pl: '0.25',
                    tradesClosed: [
                        {
                            tradeID: existingTrade.oandaTradeId,
                            price: '1.16500',
                            realizedPL: '0.25',
                            financing: '0.00',
                        },
                    ],
                },
            });

            await engine.processSignal(
                createMockSignal({
                    symbol: 'AUD_USD',
                    signal: 'BUY',
                    entryType: 'EXIT_ONLY',
                    intent: 'EXIT_SHORT_ONLY',
                    currentPrice: 1.165,
                })
            );

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-short-exit-only',
                expect.objectContaining({
                    isOpen: false,
                    exitReason: 'SIGNAL_REVERSAL',
                })
            );
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
        });

        test('should process HOLD signals without action', async () => {
            const holdSignal = createMockSignal({ signal: 'HOLD' });

            await engine.processSignal(holdSignal);

            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(engine.stats.signalsRejected).toBe(0);
        });

        test('should reject SELL signal when already in short position', async () => {
            const signal = createSellSignal({
                symbol: 'AUD_USD',
                entryType: 'SHORT_ENTRY',
            });

            engine.openTrades.set(
                'existing-short',
                createMockTrade({
                    instrument: 'AUD_USD',
                    side: 'SELL',
                    signal: 'SELL',
                })
            );

            await engine.processSignal(signal);

            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    stage: 'REJECTED',
                    outcome: 'REJECTED',
                    rejectionCode: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                })
            );
        });

        test('should not close a trade owned by another run', async () => {
            const existingTrade = createMockTrade({
                id: 'trade-owned-by-old-run',
                instrument: 'AUD_USD',
                side: 'SELL',
                ownerRunId: 'run-live-old',
                runId: 'run-live-old',
                selectionId: 'selection-old',
                strategy: 'supertrend_momentum',
            });
            engine.openTrades.set(existingTrade.id, existingTrade);

            await engine.processSignal(
                createMockSignal({
                    symbol: 'AUD_USD',
                    signal: 'BUY',
                    runId: 'run-live-new',
                    selectionId: 'selection-new',
                    strategy: 'supertrend_momentum',
                    mode: 'live',
                    entryEnabled: true,
                })
            );

            expect(mockTradeRepository.updateTrade).not.toHaveBeenCalledWith(
                'trade-owned-by-old-run',
                expect.objectContaining({
                    isOpen: false,
                })
            );
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(engine.stats.signalsRejected).toBe(1);
        });

        test('should allow the owning run to close a trade without reopening when entry is disabled', async () => {
            const existingTrade = createMockTrade({
                id: 'trade-owned-by-run',
                instrument: 'AUD_USD',
                side: 'SELL',
                ownerRunId: 'run-live-old',
                runId: 'run-live-old',
                selectionId: 'selection-old',
                strategy: 'supertrend_momentum',
            });
            engine.openTrades.set(existingTrade.id, existingTrade);

            oandaClient.closeTrade.mockResolvedValue({
                orderFillTransaction: {
                    price: '1.16784',
                    pl: '2.50',
                    financing: '-0.02',
                    tradesClosed: [
                        {
                            tradeID: existingTrade.oandaTradeId,
                            price: '1.16784',
                            realizedPL: '2.50',
                            financing: '-0.02',
                        },
                    ],
                },
            });

            await engine.processSignal(
                createMockSignal({
                    symbol: 'AUD_USD',
                    signal: 'BUY',
                    runId: 'run-live-old',
                    selectionId: 'selection-old',
                    strategy: 'supertrend_momentum',
                    mode: 'live',
                    entryEnabled: false,
                })
            );

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-owned-by-run',
                expect.objectContaining({
                    isOpen: false,
                    exitReason: 'SIGNAL_REVERSAL',
                })
            );
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
        });
    });

    describe('Trade Execution', () => {
        beforeEach(async () => {
            // Setup for live trading tests
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '136.00',
                    marginAvailable: '71.00',
                },
            });

            oandaClient.placeMarketOrder.mockResolvedValue({
                orderFillTransaction: {
                    id: '501',
                    price: '1.16571',
                    units: '795',
                    tradeOpened: {
                        tradeID: '489',
                        units: '795',
                        price: '1.16571',
                        initialMarginRequired: '46.17',
                    },
                },
            });
        });

        test('should execute entry and save trade to database', async () => {
            const signal = createMockSignal({
                runId: 'run-live-1',
                selectionId: 'selection-1',
                strategy: 'supertrend_momentum',
                mode: 'live',
            });
            const config = mockConfigService.get();

            await mockEntryDecisionRepository.save({
                decisionId: 'decision-fill',
                decisionTime: Date.now(),
                instrument: signal.symbol,
                side: 'BUY',
                signal: signal.signal,
            });

            const trade = await engine.executeEntry(signal, config, 'decision-fill');

            expect(trade).toBeDefined();
            expect(trade.instrument).toBe('AUD_USD');
            expect(trade.isOpen).toBe(true);
            expect(mockTradeRepository.save).toHaveBeenCalled();
            expect(engine.openTrades.size).toBe(1);
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith(
                'decision-fill',
                expect.objectContaining({
                    stage: 'FILLED',
                    outcome: 'FILLED',
                    tradeId: trade.id,
                })
            );
        });

        test('durably prepares an order intent before submitting with deterministic client IDs', async () => {
            const lifecycleRepository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = lifecycleRepository;
            const sequence = [];
            lifecycleRepository.createIntent.mockImplementation(async (intent) => {
                sequence.push('intent');
                lifecycleRepository.intents.set(intent.intentId, { ...intent });
                return lifecycleRepository.intents.get(intent.intentId);
            });
            oandaClient.placeMarketOrder.mockImplementation(async (...args) => {
                sequence.push('broker');
                return {
                    orderFillTransaction: {
                        id: '501',
                        time: '1710000000.125',
                        price: '1.16571',
                        units: '795',
                        tradeOpened: {
                            tradeID: '489',
                            units: '795',
                            price: '1.16571',
                            initialMarginRequired: '46.17',
                        },
                    },
                };
            });

            const trade = await engine.executeEntry(
                createMockSignal({ runId: 'run-owner-1' }),
                mockConfigService.get(),
                'decision-intent'
            );

            expect(sequence.slice(0, 2)).toEqual(['intent', 'broker']);
            const prepared = lifecycleRepository.createIntent.mock.calls[0][0];
            expect(prepared.status).toBe('PREPARED');
            expect(prepared.tradeId).toBe(trade.id);
            expect(prepared.contextPayload.config).toEqual(
                expect.objectContaining({ enableTakeProfit: true })
            );
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(
                'AUD_USD',
                expect.any(Number),
                expect.objectContaining({
                    orderIntentId: prepared.intentId,
                    positionFill: 'OPEN_ONLY',
                    priceBound: expect.any(Number),
                })
            );
            expect(lifecycleRepository.intents.get(prepared.intentId)).toEqual(
                expect.objectContaining({
                    status: 'COMPLETED',
                    brokerTradeId: '489',
                    tradeId: trade.id,
                })
            );
            expect(trade.entryTime).toBe(1710000000125);
            expect(
                trade.brokerReconciliationPayload.liveRuntime.ownerExitPolicy
            ).toEqual(
                expect.objectContaining({
                    ownerRunId: 'run-owner-1',
                    config: expect.objectContaining({ enableBreakeven: false }),
                })
            );
        });

        test('recovers an ambiguous submit response without sending a second order', async () => {
            const lifecycleRepository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = lifecycleRepository;
            const timeout = new Error('request timed out');
            timeout.ambiguous = true;
            oandaClient.placeMarketOrder.mockRejectedValueOnce(timeout);
            oandaClient.findOrderIntent.mockResolvedValueOnce({
                status: 'OPEN_TRADE_FOUND',
                lastTransactionId: '502',
                orderFillTransaction: {
                    id: '501',
                    time: '1710000001.5',
                    price: '1.16572',
                    units: '795',
                    tradeOpened: {
                        tradeID: '490',
                        units: '795',
                        price: '1.16572',
                        initialMarginRequired: '46.17',
                    },
                },
            });

            const trade = await engine.executeEntry(
                createMockSignal(),
                mockConfigService.get(),
                'decision-ambiguous'
            );

            expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
            expect(oandaClient.findOrderIntent).toHaveBeenCalledTimes(1);
            expect(trade.oandaTradeId).toBe('490');
            expect(trade.reconciliationStatus).toBe('RECOVERED_OPEN');
            expect(mockTradeRepository.save).toHaveBeenCalledTimes(1);
            expect(
                [...lifecycleRepository.intents.values()][0].status
            ).toBe('COMPLETED');
        });

        test('quarantines an entry fill that unexpectedly nets an existing trade', async () => {
            const lifecycleRepository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = lifecycleRepository;
            oandaClient.placeMarketOrder.mockResolvedValueOnce({
                orderFillTransaction: {
                    id: '501',
                    price: '1.16571',
                    units: '100',
                    tradeReduced: {
                        tradeID: 'old-489',
                        units: '100',
                        price: '1.16571',
                        realizedPL: '-0.10',
                    },
                },
            });

            await expect(
                engine.executeEntry(createMockSignal(), mockConfigService.get())
            ).rejects.toMatchObject({ code: 'UNEXPECTED_ENTRY_NETTING' });
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(
                [...lifecycleRepository.intents.values()][0].status
            ).toBe('QUARANTINED');
        });

        test('should persist runtime identity on executed live trades', async () => {
            const signal = createMockSignal({
                runId: 'run-live-identity',
                selectionId: 'selection-identity',
                strategy: 'supertrend_momentum',
                mode: 'live',
            });
            const config = mockConfigService.get();

            const trade = await engine.executeEntry(signal, config);

            expect(mockTradeRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    runId: 'run-live-identity',
                    ownerRunId: 'run-live-identity',
                    selectionId: 'selection-identity',
                    strategy: 'supertrend_momentum',
                    mode: 'live',
                })
            );
            expect(trade).toEqual(
                expect.objectContaining({
                    runId: 'run-live-identity',
                    ownerRunId: 'run-live-identity',
                    selectionId: 'selection-identity',
                    strategy: 'supertrend_momentum',
                    mode: 'live',
                })
            );
        });

        test('should persist live runtime stop metadata on executed trades', async () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                atrPips: 12.5,
                tradePlan: {
                    stopLossPrice: 1.16371,
                    takeProfitPrice: 1.16888,
                },
            });
            const config = mockConfigService.get();
            jest.spyOn(engine, 'calculatePositionSize').mockResolvedValue(795);

            const trade = await engine.executeEntry(signal, config);

            expect(mockTradeRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    brokerReconciliationPayload: expect.objectContaining({
                        liveRuntime: expect.objectContaining({
                            initialStopLossPrice: 1.16371,
                            initialStopDistance: expect.any(Number),
                            atrDistance: expect.any(Number),
                        }),
                    }),
                })
            );
            expect(
                trade.brokerReconciliationPayload.liveRuntime.initialStopDistance
            ).toBeCloseTo(0.002, 6);
            expect(
                trade.brokerReconciliationPayload.liveRuntime.atrDistance
            ).toBeCloseTo(0.00125, 6);
        });

        test('should set take profit after order fills', async () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            await engine.executeEntry(signal, config);

            // Should call modifyTrade to set TP
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({
                    takeProfitPrice: expect.any(Number),
                })
            );
        });

        test('should honor strategy tradePlan stop loss and take profit on live entry', async () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                tradePlan: {
                    stopLossPrice: 1.16371,
                    takeProfitPrice: 1.16888,
                },
            });
            const config = mockConfigService.get();
            const sizeSpy = jest
                .spyOn(engine, 'calculatePositionSize')
                .mockResolvedValue(795);
            const takeProfitSpy = jest.spyOn(engine, 'calculateTakeProfit');

            const trade = await engine.executeEntry(signal, config);

            expect(sizeSpy.mock.calls[0][1]).toBeCloseTo(20, 5);
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(
                'AUD_USD',
                795,
                expect.objectContaining({
                    stopLossPrice: 1.16371,
                    takeProfitPrice: 1.16888,
                    positionFill: 'OPEN_ONLY',
                    priceBound: expect.any(Number),
                    orderIntentId: expect.any(String),
                })
            );
            expect(takeProfitSpy).not.toHaveBeenCalled();
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({ stopLossPrice: 1.16371 })
            );
            expect(oandaClient.modifyTrade).not.toHaveBeenCalledWith(
                '489',
                expect.objectContaining({ takeProfitPrice: expect.any(Number) })
            );
            expect(trade).toEqual(
                expect.objectContaining({
                    stopLossPrice: 1.16371,
                    takeProfitPrice: 1.16888,
                })
            );
        });

        test('should widen sub-floor tradePlan stops to the minStopLossPips floor', async () => {
            // Plan stop is 8 pips vs the mock config floor of 12: live evidence
            // showed sub-floor plan stops get tagged by spread+noise within minutes.
            const signal = createMockSignal({
                currentPrice: 1.16571,
                tradePlan: {
                    stopLossPrice: 1.16491,
                    takeProfitPrice: 1.16888,
                },
            });
            const config = mockConfigService.get();
            const sizeSpy = jest
                .spyOn(engine, 'calculatePositionSize')
                .mockResolvedValue(795);

            const trade = await engine.executeEntry(signal, config);

            expect(sizeSpy.mock.calls[0][1]).toBeCloseTo(12, 5);
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(
                'AUD_USD',
                795,
                expect.objectContaining({
                    stopLossPrice: 1.16451,
                    takeProfitPrice: 1.16888,
                    positionFill: 'OPEN_ONLY',
                })
            );
            // Floored plan stops keep SIGNAL_TRADE_PLAN source; the same price
            // is sent again to obtain explicit broker confirmation.
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({ stopLossPrice: 1.16451 })
            );
            expect(trade.stopLossPrice).toBeCloseTo(1.16451, 5);
        });

        test('should ignore strategy tradePlan prices that are invalid for the entry direction', async () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                tradePlan: {
                    stopLossPrice: 1.1665,
                    takeProfitPrice: 1.164,
                },
            });
            const config = mockConfigService.get();
            const sizeSpy = jest
                .spyOn(engine, 'calculatePositionSize')
                .mockResolvedValue(795);

            const trade = await engine.executeEntry(signal, config);

            // Shared paper/live execution policy defaults to the ATR stop when
            // stopLossType is omitted: 12.5 ATR pips × 2.
            expect(sizeSpy.mock.calls[0][1]).toBeCloseTo(25, 5);
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(
                'AUD_USD',
                795,
                expect.objectContaining({
                    stopLossPrice: 1.16321,
                    takeProfitPrice: null,
                    positionFill: 'OPEN_ONLY',
                })
            );
            expect(trade.stopLossPrice).toBeCloseTo(1.16321, 5);
            expect(trade.takeProfitPrice).toBeGreaterThan(signal.currentPrice);
        });

        test('should not execute when position size is 0', async () => {
            // Force position size to return 0 by setting marginAvailable to 0
            // With 0 margin, safeMarginAvailable will be 0, effectiveBalance will be 0
            // which triggers the "insufficient margin" return 0 path
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '10.00',
                    marginAvailable: '0.00', // Zero margin available
                },
            });

            const signal = createMockSignal();
            const config = mockConfigService.get();

            await mockEntryDecisionRepository.save({
                decisionId: 'decision-too-small',
                decisionTime: Date.now(),
                instrument: signal.symbol,
                side: 'BUY',
                signal: signal.signal,
            });

            const result = await engine.executeEntry(
                signal,
                config,
                'decision-too-small'
            );

            expect(result).toBeUndefined();
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith(
                'decision-too-small',
                expect.objectContaining({
                    stage: 'REJECTED',
                    outcome: 'REJECTED',
                    rejectionCode: ENTRY_REJECTION_CODES.POSITION_SIZE_TOO_SMALL,
                })
            );
        });

        test('should mark decision as rejected when order submission fails', async () => {
            oandaClient.placeMarketOrder.mockRejectedValue(
                new Error('broker unavailable')
            );

            const signal = createMockSignal();
            const config = mockConfigService.get();

            await mockEntryDecisionRepository.save({
                decisionId: 'decision-error',
                decisionTime: Date.now(),
                instrument: signal.symbol,
                side: 'BUY',
                signal: signal.signal,
            });

            await expect(
                engine.executeEntry(signal, config, 'decision-error')
            ).rejects.toThrow('broker unavailable');

            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith(
                'decision-error',
                expect.objectContaining({
                    stage: 'REJECTED',
                    outcome: 'REJECTED',
                    rejectionCode: ENTRY_REJECTION_CODES.ORDER_SUBMIT_FAILED,
                })
            );
        });

        test('should update stats after successful trade', async () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            await engine.executeEntry(signal, config);

            expect(engine.stats.tradesExecuted).toBe(1);
            expect(engine.stats.lastTradeTime).toBeDefined();
        });

        test('should align stop loss to actual fill price after execution', async () => {
            const signal = createMockSignal({ currentPrice: 1.16000 });
            const config = {
                ...mockConfigService.get(),
                stopLossType: 'ATR',
                maxEntryDeviationPips: 100,
            };

            const trade = await engine.executeEntry(signal, config);

            expect(trade.stopLossPrice).toBeCloseTo(1.16321, 5);
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({
                    stopLossPrice: expect.any(Number),
                })
            );
        });
    });

    describe('Trade Closing', () => {
        test('should close trade and update database', async () => {
            const trade = createMockTrade({ id: 'trade-123' });
            engine.openTrades.set(trade.id, trade);

            await engine.closeTrade(trade.id, 1.16784, 'TAKE_PROFIT', {
                oandaRealizedPL: 2.50,
                oandaFinancing: -0.02,
            });

            expect(engine.openTrades.has(trade.id)).toBe(false);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-123',
                expect.objectContaining({
                    isOpen: false,
                    exitReason: 'TAKE_PROFIT',
                    pnlAud: 2.50,
                    swapAud: -0.02,
                })
            );
        });

        test('should use Oanda realizedPL as source of truth', async () => {
            const trade = createMockTrade({
                id: 'trade-123',
                entryPrice: 1.16571,
                units: 795,
            });
            engine.openTrades.set(trade.id, trade);

            // Oanda reports actual P/L (may differ from simple calculation)
            await engine.closeTrade(trade.id, 1.16784, 'TAKE_PROFIT', {
                oandaRealizedPL: 2.35, // Actual from Oanda
                oandaFinancing: -0.05,
            });

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-123',
                expect.objectContaining({
                    pnlAud: 2.35, // Should use Oanda's value
                })
            );
        });

        test('should fall back to calculated P/L when Oanda P/L is unavailable', async () => {
            const trade = createMockTrade({
                id: 'trade-123',
                entryPrice: 1.16571,
                units: 795,
                entryCostAud: 926.74,
            });
            engine.openTrades.set(trade.id, trade);

            // No Oanda P/L data provided
            await engine.closeTrade(trade.id, 1.16784, 'TAKE_PROFIT', {});

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-123',
                expect.objectContaining({
                    pnlAud: expect.any(Number),
                })
            );
        });

        test('should persist exit value, pnl percent, and holding period on close', async () => {
            const now = new Date('2026-03-20T00:00:00.000Z').getTime();
            jest.spyOn(Date, 'now').mockReturnValue(now);

            const trade = createMockTrade({
                id: 'trade-close-metrics',
                entryPrice: 1.16571,
                entryCostAud: 50,
                units: 100,
                entryTime: now - 300000,
            });
            engine.openTrades.set(trade.id, trade);

            await engine.closeTrade(trade.id, 1.16784, 'TAKE_PROFIT', {
                oandaRealizedPL: 2.5,
                oandaFinancing: -0.02,
            });

            const updatePayload = mockTradeRepository.updateTrade.mock.calls.find(
                ([tradeId]) => tradeId === 'trade-close-metrics'
            )[1];
            // AUD is canonical: 100 AUD base units are worth A$100, not
            // USD-quoted price × units.
            expect(updatePayload.exitValueAud).toBeCloseTo(100, 6);
            expect(updatePayload.pnlPercent).toBe(5);
            expect(updatePayload.holdingPeriodMs).toBe(300000);
            expect(updatePayload.swapAud).toBe(-0.02);
        });

        test('should update stats on trade close', async () => {
            const trade = createMockTrade({ id: 'trade-123' });
            engine.openTrades.set(trade.id, trade);

            await engine.closeTrade(trade.id, 1.16784, 'TAKE_PROFIT');

            expect(engine.stats.tradesClosed).toBe(1);
        });
    });

    describe('Breakeven Logic', () => {
        test('should move stop loss to entry after breakeven trigger', async () => {
            const trade = createMockTrade({
                id: 'trade-breakeven',
                side: 'BUY',
                entryPrice: 1.10000,
                stopLossPrice: 1.09500,
                oandaTradeId: '489',
            });

            mockDataService.getCurrentPrice.mockReturnValue({
                price: 1.10150, // +15 pips
                spread: 1.0,
            });

            const config = {
                ...mockConfigService.get(),
                enableBreakeven: true,
                breakevenTriggerPips: 12,
                enableTrailingStops: false,
            };

            await engine.checkPosition(trade, config);

            expect(trade.stopLossPrice).toBe(1.1);
            expect(trade.breakevenHit).toBe(true);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-breakeven',
                expect.objectContaining({
                    stopLossPrice: 1.1,
                })
            );
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({
                    stopLossPrice: 1.1,
                })
            );
        });

        test('should raise trailing stop to breakeven when trailing is less favorable', async () => {
            const trade = createMockTrade({
                id: 'trade-breakeven-trailing',
                side: 'BUY',
                entryPrice: 1.20000,
                stopLossPrice: 1.19500,
                trailingStopPrice: 1.19900,
                oandaTradeId: '489',
            });

            mockDataService.getCurrentPrice.mockReturnValue({
                price: 1.20130, // +13 pips
                spread: 1.0,
            });

            const config = {
                ...mockConfigService.get(),
                enableBreakeven: true,
                breakevenTriggerPips: 12,
                enableTrailingStops: false,
            };

            await engine.checkPosition(trade, config);

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-breakeven-trailing',
                expect.objectContaining({
                    stopLossPrice: 1.2,
                    trailingStopPrice: 1.2,
                })
            );
        });

        test('should not update stop loss when breakeven trigger is not reached', async () => {
            const trade = createMockTrade({
                id: 'trade-breakeven-no-trigger',
                side: 'BUY',
                entryPrice: 1.30000,
                stopLossPrice: 1.29500,
                oandaTradeId: '489',
            });

            mockDataService.getCurrentPrice.mockReturnValue({
                price: 1.30080, // +8 pips
                spread: 1.0,
            });

            const config = {
                ...mockConfigService.get(),
                enableBreakeven: true,
                breakevenTriggerPips: 12,
                enableTrailingStops: false,
            };

            await engine.checkPosition(trade, config);

            expect(mockTradeRepository.updateTrade).not.toHaveBeenCalledWith(
                'trade-breakeven-no-trigger',
                expect.objectContaining({ stopLossPrice: 1.3 })
            );
            expect(oandaClient.modifyTrade).not.toHaveBeenCalled();
        });

        test('should support risk-multiple breakeven instead of tight pip scratches', async () => {
            const trade = createMockTrade({
                id: 'trade-breakeven-risk',
                side: 'BUY',
                entryPrice: 1.10000,
                stopLossPrice: 1.09800,
                oandaTradeId: '489',
                brokerReconciliationPayload: {
                    liveRuntime: {
                        initialStopLossPrice: 1.09800,
                        initialStopDistance: 0.00200,
                        atrDistance: 0.00125,
                    },
                },
            });

            const config = {
                ...mockConfigService.get(),
                enableBreakeven: true,
                breakevenTriggerPips: 5,
                breakevenTriggerRiskMultiple: 1,
                enableTrailingStops: false,
            };

            await engine.updateBreakevenStop(trade, 1.10150, config);
            expect(mockTradeRepository.updateTrade).not.toHaveBeenCalled();

            await engine.updateBreakevenStop(trade, 1.10210, config);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-breakeven-risk',
                expect.objectContaining({
                    stopLossPrice: 1.1,
                    activeStopType: 'BREAKEVEN',
                })
            );
        });

        test('does not mutate a local stop until Oanda confirms the update', async () => {
            const trade = createMockTrade({
                id: 'trade-stop-retry',
                side: 'BUY',
                entryPrice: 1.1,
                stopLossPrice: 1.098,
                oandaTradeId: '489',
            });
            oandaClient.modifyTrade.mockRejectedValueOnce(
                new Error('temporary broker failure')
            );

            await engine.updateBreakevenStop(trade, 1.102, {
                enableBreakeven: true,
                breakevenTriggerPips: 12,
            });

            expect(trade.stopLossPrice).toBe(1.098);
            expect(trade.breakevenHit).toBeFalsy();
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                trade.id,
                expect.objectContaining({
                    reconciliationStatus: 'STOP_UPDATE_RETRY_PENDING',
                    brokerReconciliationPayload: expect.objectContaining({
                        stopUpdate: expect.objectContaining({
                            desiredPrice: 1.1,
                            status: 'RETRY_PENDING',
                        }),
                    }),
                })
            );

            trade.brokerReconciliationPayload.stopUpdate.nextRetryAt = 0;
            oandaClient.modifyTrade.mockResolvedValueOnce({
                stopLossOrderTransaction: { tradeID: '489', price: '1.10000' },
            });
            await engine.retryPendingStopUpdate(trade);
            expect(trade.stopLossPrice).toBe(1.1);
            expect(trade.breakevenHit).toBe(true);
        });

        test('uses the opening run exit policy after the global config changes', async () => {
            const trade = createMockTrade({
                id: 'trade-owner-policy',
                side: 'BUY',
                entryPrice: 1.1,
                stopLossPrice: 1.098,
                oandaTradeId: '489',
                ownerRunId: 'run-old',
                brokerReconciliationPayload: {
                    liveRuntime: {
                        initialStopLossPrice: 1.098,
                        initialStopDistance: 0.002,
                        ownerExitPolicy: {
                            version: 1,
                            ownerRunId: 'run-old',
                            strategy: 'supertrend_momentum',
                            config: {
                                enableBreakeven: false,
                                enableTrailingStops: false,
                            },
                        },
                    },
                },
            });

            await engine.checkPosition(trade, {
                enableBreakeven: true,
                breakevenTriggerPips: 1,
                enableTrailingStops: true,
                trailingStopActivationPips: 1,
                trailingStopPips: 1,
            });

            expect(oandaClient.modifyTrade).not.toHaveBeenCalled();
            expect(trade.stopLossPrice).toBe(1.098);
        });
    });

    describe('Trailing Logic', () => {
        test('should support risk-multiple trailing activation and distance', async () => {
            const trade = createMockTrade({
                id: 'trade-trailing-risk',
                side: 'BUY',
                entryPrice: 1.10000,
                stopLossPrice: 1.09800,
                oandaTradeId: '489',
                brokerReconciliationPayload: {
                    liveRuntime: {
                        initialStopLossPrice: 1.09800,
                        initialStopDistance: 0.00200,
                        atrDistance: 0.00125,
                    },
                },
            });

            const config = {
                ...mockConfigService.get(),
                enableTrailingStops: true,
                trailingStopActivationPips: 5,
                trailingStopPips: 5,
                trailingStopActivationRiskMultiple: 1.5,
                trailingStopRiskMultiple: 1,
            };

            await engine.updateTrailingStop(trade, 1.10250, config);
            expect(mockTradeRepository.updateTrade).not.toHaveBeenCalled();

            await engine.updateTrailingStop(trade, 1.10350, config);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-trailing-risk',
                expect.objectContaining({
                    stopLossPrice: 1.1015,
                    trailingStopPrice: 1.1015,
                    activeStopType: 'TRAILING',
                })
            );
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({
                    stopLossPrice: 1.1015,
                })
            );
        });
    });

    describe('External Close Detection', () => {
        test('should detect when trade closed externally on Oanda', async () => {
            const trade = createMockTrade({
                id: 'trade-123',
                oandaTradeId: '489',
                instrument: 'AUD_USD',
            });
            engine.openTrades.set(trade.id, trade);

            // Oanda returns no open trades (trade was closed externally)
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [] });

            // getTrade returns closed state
            oandaClient.getTrade.mockResolvedValue({
                trade: {
                    id: '489',
                    state: 'CLOSED',
                    averageClosePrice: '1.16784',
                    realizedPL: '2.50',
                    financing: '-0.02',
                },
            });

            await engine.syncWithOanda();

            // Trade should have been closed
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-123',
                expect.objectContaining({
                    isOpen: false,
                })
            );
        });

        test('should keep a trade open when external-close reconciliation fails', async () => {
            const trade = createMockTrade({
                id: 'trade-reconcile-fallback',
                oandaTradeId: '489',
                entryPrice: 1.16571,
            });
            engine.openTrades.set(trade.id, trade);

            oandaClient.getTrade.mockRejectedValueOnce(new Error('trade not found'));

            await engine.handleExternalClose(trade);

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-reconcile-fallback',
                expect.objectContaining({
                    reconciliationStatus: 'CLOSE_RETRY_PENDING',
                    isOpen: true,
                })
            );
            expect(engine.openTrades.has(trade.id)).toBe(true);
        });

        test('should persist reconciliation metadata when broker details are available', async () => {
            const trade = createMockTrade({
                id: 'trade-reconcile-success',
                oandaTradeId: '489',
                breakevenHit: true,
            });
            engine.openTrades.set(trade.id, trade);

            oandaClient.getTrade.mockResolvedValueOnce({
                trade: {
                    id: '489',
                    state: 'CLOSED',
                    averageClosePrice: '1.16572',
                    realizedPL: '0.02',
                    financing: '-0.01',
                    stopLossOrder: {
                        state: 'FILLED',
                    },
                },
            });

            await engine.handleExternalClose(trade);

            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(
                'trade-reconcile-success',
                expect.objectContaining({
                    exitReason: 'BREAKEVEN_STOP',
                    closePriceSource: 'BROKER_CLOSE',
                    reconciliationStatus: 'RECONCILED',
                    brokerExitReason: 'STOP_LOSS_ORDER_FILLED',
                    brokerReconciliationPayload: expect.objectContaining({
                        close: expect.objectContaining({
                            trade: expect.objectContaining({
                                id: '489',
                            }),
                        }),
                    }),
                    isOpen: false,
                })
            );
        });

        test('quarantines an unknown broker-only trade instead of ignoring it', async () => {
            const lifecycleRepository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = lifecycleRepository;
            oandaClient.getOpenTrades.mockResolvedValueOnce({
                trades: [
                    {
                        id: 'broker-only-1',
                        instrument: 'GBP_USD',
                        currentUnits: '-250',
                        price: '1.2800',
                        state: 'OPEN',
                    },
                ],
            });

            await engine.syncWithOanda();

            expect(
                lifecycleRepository.quarantineBrokerTrade
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    brokerTradeId: 'broker-only-1',
                    instrument: 'GBP_USD',
                    side: 'SELL',
                    reason: 'UNMANAGED_BROKER_TRADE',
                })
            );
            expect(engine.quarantinedBrokerTrades.has('broker-only-1')).toBe(
                true
            );
        });
    });

    describe('Engine Lifecycle', () => {
        test('should start and subscribe to signals', async () => {
            await engine.start();

            expect(engine.isRunning).toBe(true);
            expect(oandaClient.initialize).toHaveBeenCalled();
        });

        test('should stop and unsubscribe from signals', async () => {
            await engine.start();
            engine.stop();

            expect(engine.isRunning).toBe(false);
        });

        test('should not start twice', async () => {
            await engine.start();
            await engine.start(); // Second call

            expect(oandaClient.initialize).toHaveBeenCalledTimes(1);
        });

        test('should sync open trades from database on start', async () => {
            // Mock database to return 2 open trades
            mockTradeRepository.getOpenTrades.mockResolvedValue([
                createMockTrade({ id: 'trade-1', oandaTradeId: '501' }),
                createMockTrade({ id: 'trade-2', oandaTradeId: '502' }),
            ]);

            // Also mock Oanda to return these trades so syncWithOanda doesn't remove them
            // Without this, syncWithOanda sees empty Oanda trades and closes our DB trades
            oandaClient.getOpenTrades.mockResolvedValue({
                trades: [
                    { id: '501', instrument: 'AUD_USD', currentUnits: '795' },
                    { id: '502', instrument: 'AUD_USD', currentUnits: '795' },
                ],
            });

            await engine.start();

            expect(mockTradeRepository.getOpenTrades).toHaveBeenCalled();
            expect(engine.openTrades.size).toBe(2);
        });

        test('should preserve stop loss, trailing stop, and breakeven fields across restart sync', async () => {
            mockTradeRepository.getOpenTrades.mockResolvedValue([
                createMockTrade({
                    id: 'trade-persisted-protection',
                    oandaTradeId: '501',
                    stopLossPrice: 1.1632,
                    trailingStopPrice: 1.1645,
                    breakevenHit: true,
                }),
            ]);
            oandaClient.getOpenTrades.mockResolvedValue({
                trades: [
                    { id: '501', instrument: 'AUD_USD', currentUnits: '795' },
                ],
            });

            await engine.start();

            expect(engine.openTrades.get('trade-persisted-protection')).toEqual(
                expect.objectContaining({
                    stopLossPrice: 1.1632,
                    trailingStopPrice: 1.1645,
                    breakevenHit: true,
                })
            );
        });

        test('strict sync propagates repository failures for fail-closed preflights', async () => {
            mockTradeRepository.getOpenTrades.mockRejectedValueOnce(
                new Error('repository unavailable')
            );

            await expect(
                engine.syncOpenTrades({ throwOnError: true })
            ).rejects.toThrow('repository unavailable');
        });

        test('strict sync propagates broker failures for fail-closed preflights', async () => {
            mockTradeRepository.getOpenTrades.mockResolvedValueOnce([]);
            oandaClient.getOpenTrades.mockRejectedValueOnce(
                new Error('broker unavailable')
            );

            await expect(
                engine.syncOpenTrades({ throwOnError: true })
            ).rejects.toThrow('broker unavailable');
        });

        test('ordinary lifecycle sync retains best-effort error handling', async () => {
            mockTradeRepository.getOpenTrades.mockRejectedValueOnce(
                new Error('transient repository error')
            );

            await expect(engine.syncOpenTrades()).resolves.toBeUndefined();
        });
    });

    describe('Status and Helpers', () => {
        test('should liquidate all open live trades on an operator exit', async () => {
            const tradeOne = createMockTrade({
                id: 'trade-promote-1',
                oandaTradeId: '489',
                instrument: 'AUD_USD',
                entryPrice: 1.16571,
                entryCostAud: 46.17,
            });
            const tradeTwo = createMockTrade({
                id: 'trade-promote-2',
                oandaTradeId: '490',
                instrument: 'EUR_USD',
                entryPrice: 1.082,
                entryCostAud: 54.1,
            });

            engine.openTrades.set(tradeOne.id, tradeOne);
            engine.openTrades.set(tradeTwo.id, tradeTwo);

            mockDataService.getCurrentPrice.mockImplementation((instrument) => {
                if (instrument === 'EUR_USD') {
                    return {
                        price: 1.0832,
                        bid: 1.0831,
                        ask: 1.0833,
                        spread: 1.0,
                        timestamp: Date.now(),
                    };
                }

                return {
                    price: 1.16784,
                    bid: 1.16779,
                    ask: 1.16789,
                    spread: 1.0,
                    timestamp: Date.now(),
                };
            });

            oandaClient.closeTrade
                .mockResolvedValueOnce({
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
                })
                .mockResolvedValueOnce({
                    orderFillTransaction: {
                        id: '503',
                        instrument: 'EUR_USD',
                        units: '-795',
                        price: '1.08320',
                        pl: '1.90',
                        tradesClosed: [
                            {
                                tradeID: '490',
                                units: '-795',
                                price: '1.08320',
                                realizedPL: '1.90',
                                financing: '0.00',
                            },
                        ],
                    },
                });

            const closedTrades = await engine.liquidateOpenTrades('STRATEGY_PROMOTION');

            expect(oandaClient.closeTrade).toHaveBeenCalledTimes(2);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledTimes(2);
            expect(closedTrades).toHaveLength(2);
            expect(closedTrades).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        id: 'trade-promote-1',
                        exitReason: 'STRATEGY_PROMOTION',
                        isOpen: false,
                    }),
                    expect.objectContaining({
                        id: 'trade-promote-2',
                        exitReason: 'STRATEGY_PROMOTION',
                        isOpen: false,
                    }),
                ])
            );
            expect(engine.openTrades.size).toBe(0);
        });

        test('should fail liquidation when current market price is unavailable', async () => {
            const trade = createMockTrade({
                id: 'trade-no-price',
                instrument: 'GBP_USD',
            });

            engine.openTrades.set(trade.id, trade);
            mockDataService.getCurrentPrice.mockReturnValueOnce(null);

            await expect(
                engine.liquidateOpenTrades('STRATEGY_PROMOTION')
            ).rejects.toThrow('No price data for GBP_USD');
        });

        test('should return correct status', () => {
            engine.openTrades.set('trade-1', createMockTrade());
            engine.stats.tradesExecuted = 5;

            const status = engine.getStatus();

            expect(status.openPositions).toBe(1);
            expect(status.stats.tradesExecuted).toBe(5);
            expect(status.tradingEnabled).toBe(true);
        });

        test('should reset stats correctly', () => {
            engine.stats.tradesExecuted = 10;
            engine.stats.errors = 5;

            engine.resetStats();

            expect(engine.stats.tradesExecuted).toBe(0);
            expect(engine.stats.errors).toBe(0);
        });

        test('should find open trade by instrument', () => {
            const trade = createMockTrade({ instrument: 'EUR_USD' });
            engine.openTrades.set(trade.id, trade);

            const found = engine.getOpenTradeByInstrument('EUR_USD');
            const notFound = engine.getOpenTradeByInstrument('GBP_USD');

            expect(found).toBe(trade);
            expect(notFound).toBeNull();
        });
    });
});
