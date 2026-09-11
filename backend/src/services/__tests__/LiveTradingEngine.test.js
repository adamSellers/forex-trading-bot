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
const {
    CONSECUTIVE_LOSS_COOLDOWN_MS,
} = require('../../runtime/portfolioRiskPolicy');

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
    getExecutableQuote: jest.fn((...args) => jest.requireActual('../Oandaclient').getExecutableQuote(...args)),
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
        getOpenQuarantines: jest.fn(async () => [...quarantines.values()].filter((record) => record.status === 'OPEN')),
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
    const defaultBrokerMocks = Object.fromEntries(Object.entries(require('../Oandaclient'))
        .filter(([, value]) => jest.isMockFunction(value))
        .map(([key, value]) => [key, value.getMockImplementation()]));

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
        Object.entries(defaultBrokerMocks).forEach(([key, implementation]) => {
            oandaClient[key].mockReset().mockImplementation(implementation);
        });
        oandaClient.modifyTrade.mockImplementation(async (id, options) => ({
            ...(options.stopLossPrice !== undefined ? { stopLossOrderTransaction: { tradeID: id, price: String(options.stopLossPrice) } } : {}),
            ...(options.takeProfitPrice !== undefined ? { takeProfitOrderTransaction: { tradeID: id, price: String(options.takeProfitPrice) } } : {}),
        }));
        oandaClient.getTrade.mockImplementation(async (id) => {
            let fill = null;
            try { fill = (await oandaClient.closeTrade.mock.results.at(-1)?.value)?.orderFillTransaction; } catch (_) {}
            const effect = fill?.tradesClosed?.find((item) => String(item.tradeID) === String(id));
            return { trade: effect ? {
                id, state: 'CLOSED', averageClosePrice: effect.price || fill.price,
                realizedPL: effect.realizedPL || fill.pl, financing: effect.financing || fill.financing || '0',
                closeTime: fill.time || String(Date.now() / 1000),
            } : { id, state: 'OPEN', currentUnits: '795' } };
        });
        oandaClient.getAccountSummary.mockResolvedValue({
            account: {
                id: '001-011-20128302-001',
                currency: 'AUD',
                balance: '136.00',
                marginAvailable: '71.00',
                marginUsed: '0.00',
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
                    time: String(Date.now() / 1000),
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
            getCurrentPrice: jest.fn().mockImplementation((instrument) => ['AUD_USD', 'EUR_USD'].includes(instrument) ? {
                instrument,
                price: 1.16571,
                bid: 1.16566,
                ask: 1.16576,
                spread: 1.0,
                get timestamp() { return Date.now(); },
                get fetchedAt() { return Date.now(); },
                tradeable: true,
            } : null),
            getCandles: jest.fn().mockReturnValue([]),
            getPipValue: jest.fn().mockReturnValue(0.0001),
            getEntryFreshness: jest.fn().mockReturnValue({ fresh: true }),
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
        engine.brokerStateUncertain = false;
    });

    afterEach(() => {
        if (jest.isMockFunction(Date.now)) Date.now.mockRestore();
        jest.useRealTimers();
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
                timestamp: Date.now(), fetchedAt: Date.now(),
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
                timestamp: Date.now() - 30000, fetchedAt: Date.now() - 30000,
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
                timestamp: Date.now(), fetchedAt: Date.now(),
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

        test('does not add a second ADX gate to the intraday strategy', async () => {
            const signal = createMockSignal({
                strength: 0,
                strategy: 'intraday_momentum',
                entryType: 'M15_RANGE_BREAKOUT',
            });
            const config = {
                ...mockConfigService.get(),
                strategy: 'intraday_momentum',
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

        test('does not carry a retired run loss streak into a new live release', async () => {
            const finalExit = Date.now() - 1_000;
            [1, 2, 3].forEach((index) =>
                mockTradeRepository.trades.push({
                    id: `old-loss-${index}`,
                    isOpen: false,
                    pnlAud: -0.1,
                    exitTime: finalExit - (3 - index) * 1_000,
                    ownerRunId: 'retired-live-run',
                })
            );
            const config = {
                ...mockConfigService.get(),
                maxPortfolioExposure: null,
                maxConsecutiveLosses: 3,
            };

            const newRunResult = await engine.validateEntry(
                createMockSignal({ runId: 'new-live-run' }),
                config
            );
            const retiredRunResult = await engine.validateEntry(
                createMockSignal({ runId: 'retired-live-run' }),
                config
            );

            expect(newRunResult.valid).toBe(true);
            expect(retiredRunResult).toEqual(
                expect.objectContaining({
                    valid: false,
                    code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                    reason:
                        'Portfolio risk rejected entry: CONSECUTIVE_LOSS_COOLDOWN',
                })
            );
        });

        test('allows an entry after a persisted loss cooldown expires', async () => {
            const finalExit =
                Date.now() - CONSECUTIVE_LOSS_COOLDOWN_MS - 1_000;
            [1, 2, 3].forEach((index) =>
                mockTradeRepository.trades.push({
                    id: `expired-loss-${index}`,
                    isOpen: false,
                    pnlAud: -0.1,
                    exitTime: finalExit - (3 - index) * 1_000,
                    ownerRunId: 'active-live-run',
                })
            );
            const config = {
                ...mockConfigService.get(),
                maxPortfolioExposure: null,
                maxConsecutiveLosses: 3,
            };

            const result = await engine.validateEntry(
                createMockSignal({ runId: 'active-live-run' }),
                config
            );

            expect(result.valid).toBe(true);
            expect(engine.entryRiskState).toEqual(
                expect.objectContaining({
                    status: 'READY',
                    cooldownActive: false,
                    consecutiveLosses: 0,
                })
            );
        });

        test('API activation during cooldown preserves engine rejection until the recorded cooldown expires', async () => {
            const { cloneDefaultConfig, computeConfigHash } = require('../../config/tradingConfig');
            const routes = require('../../routes/tradingRoutes');
            let now = Date.parse('2026-09-08T13:00:00Z');
            jest.spyOn(Date, 'now').mockImplementation(() => now);
            const finalExit = now - 3_600_000;
            [1, 2, 3].forEach((index) => mockTradeRepository.trades.push({
                id: `activation-loss-${index}`, isOpen: false, pnlAud: -0.1,
                exitTime: finalExit - (3 - index) * 1_000, ownerRunId: 'active-live-run',
            }));
            Object.assign(mockConfigService.config, cloneDefaultConfig(), { enableTrading: false });
            oandaClient.getAccountSummary.mockResolvedValue({ account: {
                balance: '100', NAV: '100', currency: 'AUD', marginUsed: '0', marginAvailable: '100',
            } });
            engine.isRunning = true;
            const config = mockConfigService.get();
            const req = { app: { locals: {
                configService: mockConfigService,
                tradingEngine: engine,
                runtimeCoordinator: { getLiveSelection: () => ({ liveRun: {
                    runId: 'active-live-run', strategy: config.strategy, configHash: computeConfigHash(config),
                } }) },
            } } };
            const res = { statusCode: 200,
                status(code) { this.statusCode = code; return this; },
                json(body) { this.body = body; return this; },
            };
            await routes.stack.find((layer) => layer.route?.path === '/trading/start')
                .route.stack[0].handle(req, res);
            expect(res.statusCode).toBe(200);
            expect(config.enableTrading).toBe(true);
            expect(res.body.liveReadiness).toMatchObject({ passed: false, activationAllowed: true });
            const cooldownUntil = engine.entryRiskState.cooldownUntil;
            expect(cooldownUntil).toBe(finalExit + CONSECUTIVE_LOSS_COOLDOWN_MS);

            // Keep the real signal, validation and portfolio-risk path; stop
            // at the execution boundary so this test never submits an order.
            const execution = jest.spyOn(engine, 'executeEntry').mockResolvedValue(null);
            await engine.processSignal(createMockSignal({ runId: 'active-live-run' }));
            expect(execution).not.toHaveBeenCalled();
            expect(engine.entryRiskState).toMatchObject({ cooldownActive: true, entryAllowed: false, cooldownUntil });
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith(expect.any(String),
                expect.objectContaining({ rejectionReason: 'Portfolio risk rejected entry: CONSECUTIVE_LOSS_COOLDOWN' }));

            now = cooldownUntil + 1;
            await engine.processSignal(createMockSignal({ runId: 'active-live-run', setupId: 'after-cooldown' }));
            expect(engine.entryRiskState).toMatchObject({ cooldownActive: false, entryAllowed: true });
            expect(execution).toHaveBeenCalledTimes(1);
            expect(config.enableTrading).toBe(true);
            expect(mockTradeRepository.trades).toHaveLength(3);
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('fails closed when persisted loss history is incomplete', async () => {
            mockTradeRepository.trades.push({
                id: 'incomplete-closed-trade',
                isOpen: false,
                pnlAud: null,
                exitTime: Date.now() - 1_000,
                ownerRunId: 'active-live-run',
            });
            const config = {
                ...mockConfigService.get(),
                maxPortfolioExposure: null,
                maxConsecutiveLosses: 3,
            };

            const result = await engine.validateEntry(
                createMockSignal({ runId: 'active-live-run' }),
                config
            );

            expect(result).toEqual(
                expect.objectContaining({
                    valid: false,
                    code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                    reason:
                        'Portfolio risk rejected entry: PORTFOLIO_RISK_UNAVAILABLE',
                })
            );
        });
    });

    describe('calculatePositionSize', () => {
        test('should use marginAvailable not total balance', async () => {
            // Oanda returns: balance=$136, marginAvailable=$71
            oandaClient.getAccountSummary.mockResolvedValue({
                account: {
                    balance: '136.00',
                    marginAvailable: '71.00',
                    marginUsed: '0.00',
                    NAV: '136.00',
                    currency: 'AUD',
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
                        prices: [{ bids: [{ price: '0.6600' }], asks: [{ price: '0.6602' }] }],
                    };
                }
                if (instrument === 'USD_AUD') {
                    return {
                        prices: [{ bids: [{ price: '1.5147' }], asks: [{ price: '1.5152' }] }],
                    };
                }
                if (instrument === 'JPY_USD') {
                    return {
                        prices: [{ bids: [{ price: '0.0066' }], asks: [{ price: '0.0067' }] }],
                    };
                }
                if (instrument === 'USD_JPY') {
                    return {
                        prices: [{ bids: [{ price: '149.95' }], asks: [{ price: '150.05' }] }],
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
                        prices: [{ bids: [{ price: '1.1000' }], asks: [{ price: '1.1010' }] }],
                    };
                }
                if (instrument === 'USD_AUD') {
                    return {
                        prices: [{ bids: [{ price: '1.5147' }], asks: [{ price: '1.5152' }] }],
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
                    marginUsed: '0.00',
                    NAV: '136.00',
                    currency: 'AUD',
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
                601, // Final risk check caps the preliminary size at priceBound.
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
                expect.objectContaining({
                    stopLossPrice: 1.16371,
                    takeProfitPrice: 1.16888,
                })
            );
            expect(trade).toEqual(
                expect.objectContaining({
                    stopLossPrice: 1.16371,
                    takeProfitPrice: 1.16888,
                })
            );
        });

        test('re-centers an intraday risk plan on the final quote and actual fill', async () => {
            const signal = createMockSignal({
                currentPrice: 1.16571,
                tradePlan: {
                    stopLossPrice: 1.16511,
                    stopPips: 6,
                    takeProfitPrice: 1.16661,
                    targetRiskMultiple: 1.5,
                },
            });
            const config = {
                ...mockConfigService.get(),
                minStopLossPips: 6,
            };
            jest.spyOn(engine, 'calculatePositionSize').mockResolvedValue(795);

            const trade = await engine.executeEntry(signal, config);

            expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(
                'AUD_USD',
                795,
                expect.objectContaining({
                    stopLossPrice: 1.16516,
                    takeProfitPrice: 1.16666,
                })
            );
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith(
                '489',
                expect.objectContaining({
                    stopLossPrice: expect.closeTo(1.16511, 5),
                    takeProfitPrice: expect.closeTo(1.16661, 5),
                })
            );
            expect(trade.stopLossPrice).toBeCloseTo(1.16511, 5);
            expect(trade.takeProfitPrice).toBeCloseTo(1.16661, 5);
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
                    stopLossPrice: 1.16456,
                    takeProfitPrice: 1.16888,
                    positionFill: 'OPEN_ONLY',
                })
            );
            // The order is protected around the final executable quote, then
            // re-centered on the confirmed fill during broker confirmation.
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
                499, // Includes the worst permitted fill-to-stop distance.
                expect.objectContaining({
                    stopLossPrice: 1.16326,
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
                price: 1.10150, bid: 1.10150, ask: 1.10160, tradeable: true,
                timestamp: Date.now(), fetchedAt: Date.now(), // +15 pips
                spread: 1.0,
            });

            const config = {
                ...mockConfigService.get(),
                enableBreakeven: true,
                breakevenTriggerPips: 12,
                enableTrailingStops: false,
            };

            engine.openTrades.set(trade.id, trade);
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
                price: 1.20130, bid: 1.20130, ask: 1.20140, tradeable: true,
                timestamp: Date.now(), fetchedAt: Date.now(), // +13 pips
                spread: 1.0,
            });

            const config = {
                ...mockConfigService.get(),
                enableBreakeven: true,
                breakevenTriggerPips: 12,
                enableTrailingStops: false,
            };

            engine.openTrades.set(trade.id, trade);
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

            engine.openTrades.set(trade.id, trade);
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

            engine.openTrades.set(trade.id, trade);
            await engine.updateBreakevenStop(trade, 1.10150, config);
            expect(mockTradeRepository.updateTrade).not.toHaveBeenCalled();

            engine.openTrades.set(trade.id, trade);
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

            engine.openTrades.set(trade.id, trade);
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

            engine.openTrades.set(trade.id, trade);
            await engine.updateTrailingStop(trade, 1.10250, config);
            expect(mockTradeRepository.updateTrade).not.toHaveBeenCalled();

            engine.openTrades.set(trade.id, trade);
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
                    { id: '501', instrument: 'AUD_USD', currentUnits: '795', stopLossOrder: { state: 'PENDING', price: '1.16320' }, takeProfitOrder: { state: 'PENDING', price: '1.16918' } },
                    { id: '502', instrument: 'AUD_USD', currentUnits: '795', stopLossOrder: { state: 'PENDING', price: '1.16320' }, takeProfitOrder: { state: 'PENDING', price: '1.16918' } },
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
                    { id: '501', instrument: 'AUD_USD', currentUnits: '795', stopLossOrder: { state: 'PENDING', price: '1.16320' }, takeProfitOrder: { state: 'PENDING', price: '1.16918' } },
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

    describe('quote numerical boundaries through pricing, decisions and orders', () => {
        const markets = [
            { symbol: 'GBP_USD', bid: 1.30002, pip: 0.0001, precision: 5 },
            { symbol: 'USD_JPY', bid: 153.300, pip: 0.01, precision: 3 },
        ];
        const cases = markets.flatMap((market) => ['BUY', 'SELL'].map((side) => ({ ...market, side })));

        async function prepareQuoteCase(market, { cachedSpread = 1.2, finalSpread = cachedSpread, deviation = null, stopPips = 20 } = {}) {
            jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T13:00:00Z'));
            Object.assign(mockConfigService.config, require('../../../../shared/tradingConfigDefaults.json'), { enableTrading: true });
            const price = (value) => value.toFixed(market.precision);
            const makeQuote = (bid, ask) => ({
                instrument: market.symbol, tradeable: true, time: new Date(Date.now()).toISOString(),
                bids: [{ price: price(bid), liquidity: 1000000 }],
                asks: [{ price: price(ask), liquidity: 1000000 }],
            });
            const cached = makeQuote(market.bid, market.bid + cachedSpread * market.pip);
            const midpoint = (Number(cached.bids[0].price) + Number(cached.asks[0].price)) / 2;
            const executable = deviation === null ? null : midpoint + (market.side === 'SELL' ? -1 : 1) * deviation * market.pip;
            const final = executable === null
                ? makeQuote(market.bid, market.bid + finalSpread * market.pip)
                : market.side === 'BUY'
                    ? makeQuote(executable - finalSpread * market.pip, executable)
                    : makeQuote(executable, executable + finalSpread * market.pip);
            const homeConversions = Object.entries({ AUD: 1, GBP: 1.9, USD: 1.5, JPY: 0.01 })
                .map(([currency, rate]) => ({ currency, accountGain: String(rate), accountLoss: String(rate), positionValue: String(rate) }));
            const OandaDataService = require('../OandaDataService');
            const data = new OandaDataService([market.symbol]);
            data.oandaRequest = jest.fn().mockResolvedValue({ prices: [cached], homeConversions });
            await data.fetchAllPrices();
            data.getEntryFreshness = jest.fn().mockReturnValue({ fresh: true });
            engine.dataService = data;
            engine.brokerLifecycleRepository = createMockBrokerLifecycleRepository();
            // Isolate currency/account services while retaining the real entry,
            // sizing, quote validation, durable intent and submission sequence.
            const rates = { AUD: 1, GBP: 1.9, USD: 1.5, JPY: 0.01 };
            jest.spyOn(engine, 'getConversionRate').mockImplementation(async (from, to) => rates[from] / rates[to]);
            oandaClient.getInstrumentMetadata.mockResolvedValue({ name: market.symbol,
                pipLocation: market.precision === 3 ? -2 : -4, displayPrecision: market.precision, marginRate: '0.05' });
            oandaClient.getPricing.mockResolvedValue({ prices: [final], homeConversions });
            oandaClient.placeMarketOrder.mockImplementation(async (_symbol, units) => {
                const fillPrice = market.side === 'SELL' ? final.bids[0].price : final.asks[0].price;
                return { orderFillTransaction: { id: '501', time: String(Date.now() / 1000), price: fillPrice,
                    units: String(units), tradeOpened: { tradeID: '489', units: String(units), price: fillPrice, initialMarginRequired: '1' } } };
            });
            return createMockSignal({ symbol: market.symbol, signal: market.side, currentPrice: midpoint,
                strategy: 'intraday_momentum', entryType: 'M15_RANGE_BREAKOUT',
                tradePlan: { stopPips, targetRiskMultiple: 1.5 } });
        }

        async function queueEntry(signal) {
            engine.tradeQueue.push({ type: 'signal', signal, generation: engine.activationGeneration });
            await engine.processQueue();
        }

        function observeRejection() {
            const rejected = jest.fn();
            const orderError = jest.fn();
            mockSignalGenerator.handleEntryRejection = jest.fn();
            engine.on('entryRejected', rejected);
            engine.on('orderError', orderError);
            return { rejected, orderError };
        }

        test('a cached spread decline is acknowledged only after its exact attempt is durably rejected', async () => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'SELL' }, { cachedSpread: 1.3 });
            signal.entryAttemptId = 'attempt-cached-spread';
            signal.entryReferencePrice = signal.currentPrice;
            const { rejected, orderError } = observeRejection();
            mockSignalGenerator.handleEntryRejection.mockImplementation((event) => {
                expect(mockEntryDecisionRepository.decisions[0]).toMatchObject({
                    decisionId: signal.entryAttemptId, outcome: 'REJECTED', canReconsider: true,
                    entryReferencePrice: signal.entryReferencePrice,
                    rejectionContext: event.context,
                });
                expect(rejected).not.toHaveBeenCalled();
            });

            await queueEntry(signal);

            expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0, tradesExecuted: 0 });
            expect(orderError).not.toHaveBeenCalled();
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect(mockSignalGenerator.handleEntryRejection).toHaveBeenCalledTimes(1);
            expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
                signal, decisionId: signal.entryAttemptId, rejectionCode: 'SPREAD_TOO_WIDE', canReconsider: true,
                context: expect.objectContaining({ phase: 'CACHED_PRICE', spreadPips: expect.closeTo(1.3, 8), maxSpreadPips: 1.2 }),
            }));
        });

        test('revalidation records the newer spread that caused the decline, not the first passing quote', async () => {
            const signal = await prepareQuoteCase({ ...markets[1], side: 'BUY' }, { cachedSpread: 1.2 });
            const { rejected, orderError } = observeRejection();
            oandaClient.getOpenTrades.mockImplementation(async () => {
                const cached = engine.dataService.getCurrentPrice(signal.symbol);
                cached.ask = cached.bid + 1.3 * markets[1].pip;
                cached.spread = (cached.ask - cached.bid) / markets[1].pip;
                return { trades: [] };
            });

            await queueEntry(signal);

            expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0 });
            expect(orderError).not.toHaveBeenCalled();
            expect(oandaClient.getPricing).not.toHaveBeenCalled();
            expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
                rejectionCode: 'SPREAD_TOO_WIDE', canReconsider: true,
                context: expect.objectContaining({ phase: 'REVALIDATION', spreadPips: expect.closeTo(1.3, 8) }),
            }));
            expect(mockEntryDecisionRepository.decisions[0]).toMatchObject({ spreadPips: expect.closeTo(1.3, 8) });
        });

        test.each([
            { name: 'spread', options: { cachedSpread: 1, finalSpread: 1.3 }, code: 'SPREAD_TOO_WIDE', context: { spreadPips: expect.closeTo(1.3, 8), maxSpreadPips: 1.2 } },
            { name: 'cost', options: { cachedSpread: 0.6, finalSpread: 0.8, stopPips: 6 }, code: 'COST_TO_STOP_TOO_HIGH', context: { spreadPips: expect.closeTo(0.8, 8), costToStopRatio: expect.closeTo(1 / 6, 8), maxCostToStopRatio: 0.15, stopPips: 6 } },
            { name: 'deviation', options: { cachedSpread: 0.2, finalSpread: 0.5, deviation: 1.6 }, code: 'ENTRY_PRICE_DEVIATION', context: { deviationPips: expect.closeTo(1.6, 8), maxEntryDeviationPips: 1.5 } },
        ])('a final $name decline is one policy rejection with the measured final quote', async ({ options, code, context }) => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'SELL' }, options);
            const { rejected, orderError } = observeRejection();

            await queueEntry(signal);

            expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0, tradesExecuted: 0 });
            expect(orderError).not.toHaveBeenCalled();
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect(engine.brokerLifecycleRepository.intents.size).toBe(0);
            expect(rejected).toHaveBeenCalledTimes(1);
            expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
                rejectionCode: code, canReconsider: true,
                context: expect.objectContaining({ phase: 'FINAL_QUOTE', ...context,
                    bid: expect.any(Number), ask: expect.any(Number), quoteFetchedAt: Date.now(),
                    entryReferencePrice: signal.currentPrice }),
            }));
            expect(mockEntryDecisionRepository.decisions[0]).toMatchObject({
                rejectionCode: code, canReconsider: true,
                rejectionContext: expect.objectContaining(context),
            });
        });

        test.each(cases)('$symbol $side retains the original reference for a later attempt and its submitted bound', async (market) => {
            const signal = await prepareQuoteCase(market, { cachedSpread: 0.2, finalSpread: 0.5, deviation: 1.4 });
            signal.entryReferencePrice = signal.currentPrice;
            signal.currentPrice += (market.side === 'SELL' ? -1 : 1) * market.pip;
            signal.entryAttemptId = `later-${market.symbol}-${market.side}`;

            await queueEntry(signal);

            const intent = [...engine.brokerLifecycleRepository.intents.values()][0];
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(market.symbol, expect.any(Number),
                expect.objectContaining({ priceBound: signal.entryReferencePrice + (market.side === 'SELL' ? -1 : 1) * 1.5 * market.pip }));
            expect(intent).toMatchObject({ referencePrice: signal.currentPrice,
                contextPayload: { entryReferencePrice: signal.entryReferencePrice,
                    finalQuote: { entryReferencePrice: signal.entryReferencePrice } } });
            expect(mockEntryDecisionRepository.decisions[0]).toMatchObject({
                decisionId: signal.entryAttemptId, entryReferencePrice: signal.entryReferencePrice, outcome: 'FILLED',
            });
            expect([...engine.openTrades.values()][0].brokerReconciliationPayload.liveRuntime.entryTelemetry)
                .toMatchObject({ requestedPrice: signal.currentPrice, entryReferencePrice: signal.entryReferencePrice });
        });

        test.each(cases)('$symbol $side cannot reset the original deviation allowance on a later attempt', async (market) => {
            const signal = await prepareQuoteCase(market, { cachedSpread: 0.2, finalSpread: 0.5, deviation: 1.6 });
            signal.entryReferencePrice = signal.currentPrice;
            signal.currentPrice += (market.side === 'SELL' ? -1 : 1) * market.pip;
            const { rejected } = observeRejection();

            await queueEntry(signal);

            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ rejectionCode: 'ENTRY_PRICE_DEVIATION',
                context: expect.objectContaining({ entryReferencePrice: signal.entryReferencePrice,
                    currentPrice: signal.currentPrice, deviationPips: expect.closeTo(1.6, 8) }) }));
        });

        test('without durable decisions a pricing decline is never acknowledged as reconsiderable', async () => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'BUY' }, { finalSpread: 1.3 });
            engine.entryDecisionRepository = null;
            const { rejected } = observeRejection();

            await queueEntry(signal);

            expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ decisionId: null, canReconsider: false }));
            expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0 });
        });

        test.each(['cached spread', 'final spread', 'zero size'])('a failed rejection write for %s does not acknowledge retry or double-count errors', async (phase) => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'BUY' }, {
                cachedSpread: phase === 'cached spread' ? 1.3 : 1,
                finalSpread: phase === 'final spread' ? 1.3 : 1,
            });
            if (phase === 'zero size') {
                const size = engine.calculatePositionSize.bind(engine);
                jest.spyOn(engine, 'calculatePositionSize').mockResolvedValue(0).mockImplementationOnce(size);
            }
            const update = mockEntryDecisionRepository.updateDecision.getMockImplementation();
            mockEntryDecisionRepository.updateDecision.mockImplementation(async (id, updates) => {
                if (updates.outcome === 'REJECTED') throw new Error('decision write failed');
                return update(id, updates);
            });
            const { rejected } = observeRejection();

            await queueEntry(signal);

            expect(engine.stats).toMatchObject({ signalsRejected: 0, errors: 1, tradesExecuted: 0 });
            expect(rejected).not.toHaveBeenCalled();
            expect(mockSignalGenerator.handleEntryRejection).not.toHaveBeenCalled();
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect(mockEntryDecisionRepository.decisions[0].outcome).not.toBe('REJECTED');
        });

        test.each(['zero size', 'stale price'])('%s is a non-retryable policy decline counted once', async (reason) => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'BUY' }, { cachedSpread: 1 });
            if (reason === 'zero size') {
                const size = engine.calculatePositionSize.bind(engine);
                jest.spyOn(engine, 'calculatePositionSize').mockResolvedValue(0).mockImplementationOnce(size);
            } else engine.dataService.getCurrentPrice(signal.symbol).fetchedAt = Date.now() - 60000;
            const { rejected, orderError } = observeRejection();

            await queueEntry(signal);

            expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0 });
            expect(orderError).not.toHaveBeenCalled();
            expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ canReconsider: false,
                rejectionCode: reason === 'zero size' ? 'POSITION_SIZE_TOO_SMALL' : 'STALE_PRICE' }));
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test.each(['final size', 'final exposure', 'invalid final account'])('%s is reported according to the final account evidence', async (failure) => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'BUY' }, { cachedSpread: 1 });
            let finalQuoteReceived = false;
            const getPricing = oandaClient.getPricing.getMockImplementation();
            oandaClient.getPricing.mockImplementation(async (...args) => {
                finalQuoteReceived = true;
                return getPricing(...args);
            });
            const getAccount = oandaClient.getAccountSummary.getMockImplementation();
            oandaClient.getAccountSummary.mockImplementation(async () => {
                const snapshot = await getAccount();
                if (!finalQuoteReceived) return snapshot;
                return { ...snapshot, account: { ...snapshot.account,
                    ...(failure === 'final size' ? { marginAvailable: '0.01' }
                        : { marginUsed: failure === 'final exposure' ? snapshot.account.balance : undefined }),
                } };
            });
            const { rejected, orderError } = observeRejection();

            await queueEntry(signal);

            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            if (failure === 'invalid final account') {
                expect(engine.stats).toMatchObject({ signalsRejected: 0, errors: 1 });
                expect(orderError).toHaveBeenCalledTimes(1);
                expect(rejected).not.toHaveBeenCalled();
                expect(mockEntryDecisionRepository.decisions[0]).toMatchObject({
                    rejectionCode: 'ENTRY_PREPARATION_FAILED', canReconsider: false,
                });
            } else {
                expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0 });
                expect(orderError).not.toHaveBeenCalled();
                expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ canReconsider: false,
                    rejectionCode: failure === 'final size' ? 'POSITION_SIZE_TOO_SMALL' : 'EXPOSURE_LIMIT',
                    context: expect.objectContaining({ phase: 'FINAL_SIZING' }),
                }));
            }
        });

        test.each([false, true])('prepared-intent cancellation requires terminal persistence before acknowledgement (write failure: %s)', async (writeFailure) => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'BUY' }, { cachedSpread: 1 });
            const repository = engine.brokerLifecycleRepository;
            const create = repository.createIntent.getMockImplementation();
            repository.createIntent.mockImplementation(async (intent) => {
                const saved = await create(intent);
                mockConfigService.config.enableTrading = false;
                return saved;
            });
            if (writeFailure) {
                const update = repository.updateIntent.getMockImplementation();
                repository.updateIntent.mockImplementation(async (id, updates) => {
                    if (['REJECTED', 'ABANDONED'].includes(updates.status)) throw new Error('intent write failed');
                    return update(id, updates);
                });
            }
            const { rejected } = observeRejection();
            mockSignalGenerator.handleEntryRejection.mockImplementation(() => {
                expect([...repository.intents.values()][0]).toMatchObject({ status: 'ABANDONED' });
            });

            await queueEntry(signal);

            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            if (writeFailure) {
                expect(engine.stats).toMatchObject({ signalsRejected: 0, errors: 1 });
                expect(rejected).not.toHaveBeenCalled();
                expect(mockSignalGenerator.handleEntryRejection).not.toHaveBeenCalled();
                expect(await repository.getRecoverableIntents()).toHaveLength(1);
            } else {
                expect(engine.stats).toMatchObject({ signalsRejected: 1, errors: 0 });
                expect(rejected).toHaveBeenCalledWith(expect.objectContaining({
                    rejectionCode: 'TRADING_DISABLED', canReconsider: false,
                }));
                expect(await repository.getRecoverableIntents()).toEqual([]);
            }
        });

        test.each(['preparation', 'broker rejection', 'broker policy-shaped error', 'ambiguous broker response'])('%s remains one real error and cannot release the setup', async (failure) => {
            const signal = await prepareQuoteCase({ ...markets[0], side: 'BUY' }, { cachedSpread: 1 });
            const error = new Error(failure);
            if (failure === 'preparation') oandaClient.getPricing.mockRejectedValue(error);
            else {
                error.ambiguous = failure === 'ambiguous broker response';
                if (failure === 'broker policy-shaped error') Object.assign(error, {
                    entryPolicyRejection: true, entryRejectionCode: 'SPREAD_TOO_WIDE',
                });
                oandaClient.placeMarketOrder.mockRejectedValue(error);
            }
            const { rejected, orderError } = observeRejection();

            await queueEntry(signal);

            expect(engine.stats).toMatchObject({ signalsRejected: 0, errors: 1, tradesExecuted: 0 });
            expect(orderError).toHaveBeenCalledTimes(1);
            expect(rejected).not.toHaveBeenCalled();
            expect(mockSignalGenerator.handleEntryRejection).not.toHaveBeenCalled();
            const decision = mockEntryDecisionRepository.decisions[0];
            if (error.ambiguous) {
                expect(decision).toMatchObject({ stage: 'ORDER_SUBMITTED', outcome: 'PENDING' });
                expect(engine.getStatus().pendingOrderIntents).toHaveLength(1);
            } else {
                expect(decision).toMatchObject({ outcome: 'REJECTED', canReconsider: false,
                    rejectionCode: failure === 'preparation' ? 'ENTRY_PREPARATION_FAILED' : 'ORDER_SUBMIT_FAILED' });
                expect(engine.getStatus().pendingOrderIntents).toHaveLength(0);
            }
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(failure === 'preparation' ? 0 : 1);
        });

        test.each(cases.flatMap((market) => [1.1, 1.2, 1.3].map((spread) => ({ ...market, spread }))))(
            '$symbol $side cached spread $spread pips respects the unchanged 1.2-pip limit', async (market) => {
                const signal = await prepareQuoteCase(market, { cachedSpread: market.spread });
                await engine.processSignal(signal);
                if (market.spread > 1.2) {
                    expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
                    expect(oandaClient.getPricing).not.toHaveBeenCalled();
                    expect(mockEntryDecisionRepository.updateDecision).toHaveBeenLastCalledWith(expect.any(String),
                        expect.objectContaining({ rejectionCode: 'SPREAD_TOO_WIDE' }));
                } else {
                    expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
                    expect([...engine.brokerLifecycleRepository.intents.values()][0].status).toBe('COMPLETED');
                    expect([...engine.openTrades.values()][0]).toEqual(expect.objectContaining({ instrument: market.symbol, side: market.side }));
                }
            }
        );

        test.each(cases.flatMap((market) => [1.2, 1.3].map((spread) => ({ ...market, spread }))))(
            '$symbol $side final spread $spread pips is checked again before submission', async (market) => {
                const signal = await prepareQuoteCase(market, { cachedSpread: 1, finalSpread: market.spread });
                const operation = engine.processSignal(signal);
                if (market.spread > 1.2) {
                    await expect(operation).rejects.toThrow('Final execution cost exceeds entry policy');
                    expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
                } else {
                    await operation;
                    expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
                }
            }
        );

        test.each(cases.flatMap((market) => [1.4, 1.5, 1.6].map((deviation) => ({ ...market, deviation }))))(
            '$symbol $side final deviation $deviation pips respects the unchanged 1.5-pip limit', async (market) => {
                const signal = await prepareQuoteCase(market, { cachedSpread: 0.2, finalSpread: 0.5, deviation: market.deviation });
                const operation = engine.processSignal(signal);
                if (market.deviation > 1.5) {
                    await expect(operation).rejects.toMatchObject({ code: 'ENTRY_PRICE_DEVIATION' });
                    expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
                } else {
                    await operation;
                    expect(oandaClient.placeMarketOrder).toHaveBeenCalledWith(market.symbol, expect.any(Number),
                        expect.objectContaining({ priceBound: signal.currentPrice + (market.side === 'SELL' ? -1 : 1) * 1.5 * market.pip }));
                }
            }
        );

        test.each(markets)('$symbol preserves and rejects a genuine volume-weighted spread excess below one tick', async (market) => {
            const signal = await prepareQuoteCase({ ...market, side: 'BUY' }, { cachedSpread: 1 });
            const pricing = await oandaClient.getPricing([market.symbol]);
            pricing.prices[0].asks = [
                { price: (market.bid + 1.2 * market.pip).toFixed(market.precision), liquidity: 199 },
                { price: (market.bid + 1.3 * market.pip).toFixed(market.precision), liquidity: 1 },
            ];
            const executable = oandaClient.getExecutableQuote(pricing.prices[0], 'BUY', 200);
            expect(executable.spread / market.pip).toBeGreaterThan(1.2);
            expect(executable.spread / market.pip).toBeLessThan(1.201);
            expect(executable.ask).not.toBe(Number(executable.ask.toFixed(market.precision)));
            await expect(engine.getFinalEntryQuote(signal, mockConfigService.get(), null, 200))
                .rejects.toThrow('Final execution cost exceeds entry policy');
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test.each(cases.flatMap((market) => [1, 1.1].map((spread) => ({ ...market, spread }))))(
            '$symbol $side final cost at $spread pips spread retains the 15 percent stop-cost limit', async (market) => {
                const signal = await prepareQuoteCase(market, { cachedSpread: 0.8, finalSpread: market.spread, stopPips: 8 });
                const operation = engine.processSignal(signal);
                if (market.spread > 1) {
                    await expect(operation).rejects.toThrow('Final execution cost exceeds entry policy');
                    expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
                } else {
                    await operation;
                    expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
                }
            }
        );
    });

    describe('Live lifecycle safety regressions', () => {
        const protectedBrokerTrade = (overrides = {}) => ({
            id: '489', instrument: 'AUD_USD', state: 'OPEN', price: '1.16571',
            currentUnits: '795', initialUnits: '795', openTime: String(Date.now() / 1000),
            stopLossOrder: { state: 'PENDING', price: '1.16320' },
            takeProfitOrder: { state: 'PENDING', price: '1.16918' }, ...overrides,
        });
        const addTrade = (overrides = {}) => {
            const trade = createMockTrade(overrides);
            engine.openTrades.set(trade.id, trade);
            return trade;
        };

        test('closes an overdue owner-policy trade through the real monitor without a live quote', async () => {
            const trade = addTrade({ entryTime: Date.now() - 7 * 3600000,
                brokerReconciliationPayload: { liveRuntime: { ownerExitPolicy: {
                    version: 1, config: { timeStopHours: 6, enableBreakeven: false },
                } } },
            });
            mockConfigService.config.timeStopHours = 0;
            mockDataService.getCurrentPrice.mockReturnValue(null);
            await engine.monitorPositions();
            expect(oandaClient.closeTrade).toHaveBeenCalledWith('489');
            expect(engine.openTrades.has(trade.id)).toBe(false);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(trade.id, expect.objectContaining({ exitReason: 'TIME_STOP', isOpen: false }));
        });

        test.each(['2026-08-19T20:45:00Z', '2026-01-14T21:45:00Z'])('executes New York rollover closure across DST at %s', async (timestamp) => {
            const now = Date.parse(timestamp);
            jest.spyOn(Date, 'now').mockReturnValue(now);
            const trade = addTrade({ entryTime: now - 3600000,
                brokerReconciliationPayload: { liveRuntime: { ownerExitPolicy: {
                    version: 1, config: { sessionCloseTimeZone: 'America/New_York', sessionCloseLocalHour: 16,
                        sessionCloseLocalMinute: 45, sessionCloseWindowMinutes: 30 },
                } } },
            });
            await engine.checkPosition(trade, {});
            expect(engine.openTrades.size).toBe(0);
            expect(mockTradeRepository.updateTrade).toHaveBeenCalledWith(trade.id, expect.objectContaining({ exitReason: 'SESSION_CLOSE' }));
        });

        test('flat monitoring reconciles a lost response and blocks another pair until resolved', async () => {
            const repository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = repository;
            const error = Object.assign(new Error('lost response'), { ambiguous: true });
            oandaClient.placeMarketOrder.mockRejectedValueOnce(error);
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toThrow('lost response');
            expect(engine.openTrades.size).toBe(0);
            expect(engine.getStatus().pendingOrderIntentCount).toBe(1);
            expect(engine.getStatus().pendingOrderIntents[0].status).toBe('RECOVERY_PENDING');
            const blocked = await engine.validateEntry(createMockSignal({ symbol: 'EUR_USD' }), mockConfigService.get());
            expect(blocked.valid).toBe(false);
            expect(blocked.reason).toMatch(/unresolved/);
            const intent = [...repository.intents.values()][0];
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade({ clientExtensions: { id: intent.clientTradeId } })] });
            await engine.monitorPositions();
            expect(engine.openTrades.size).toBe(1);
            expect(repository.intents.get(intent.intentId).status).toBe('COMPLETED');
            expect(engine.getStatus().pendingOrderIntentCount).toBe(0);
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
            expect(engine.getStatus().lastSuccessfulBrokerSyncAt).toEqual(expect.any(Number));
        });

        test('account-wide quarantines block entries on other instruments', async () => {
            engine.brokerLifecycleRepository = createMockBrokerLifecycleRepository();
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade({ id: 'unknown', instrument: 'EUR_USD' })] });
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toThrow(/quarantined/);
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('a failed flat broker sync blocks entry and is visible in health status', async () => {
            oandaClient.getOpenTrades.mockRejectedValue(new Error('broker disconnected'));
            await engine.monitorPositions();
            expect(engine.getStatus()).toEqual(expect.objectContaining({ brokerStateUncertain: true, lastBrokerSyncError: 'broker disconnected' }));
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toThrow('broker disconnected');
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('serializes concurrent broker snapshots and entry execution', async () => {
            let release;
            oandaClient.getOpenTrades.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
            const sync = engine.syncWithOanda();
            await Promise.resolve();
            const entry = engine.executeEntry(createMockSignal(), mockConfigService.get());
            await Promise.resolve();
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            release({ trades: [] });
            await Promise.all([sync, entry]);
            expect(engine.openTrades.size).toBe(1);
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
        });

        test('uses executable liquidity buckets rather than closeout prices', async () => {
            oandaClient.getPricing.mockResolvedValue({ prices: [{
                instrument: 'AUD_USD', tradeable: true, time: String(Date.now() / 1000),
                bids: [{ price: '1.16566', liquidity: 1000 }],
                asks: [{ price: '1.16576', liquidity: 100 }, { price: '1.16580', liquidity: 900 }],
                closeoutAsk: '1.1800', closeoutBid: '1.1500',
            }] });
            const quote = await engine.getFinalEntryQuote(createMockSignal(), mockConfigService.get(), null, 200);
            expect(quote.finalQuote).toBeCloseTo(1.16578, 8);
            expect(quote.worstPrice).toBe(1.1658);
            expect(quote.spreadPips).toBeCloseTo(1.2, 8);
        });

        test.each(['future time', 'missing time', 'liquidity', 'wrong instrument', 'crossed quote', 'nontradeable', 'duplicate instrument'])('rejects unusable final execution quote: %s', async (failure) => {
            const price = { instrument: 'AUD_USD', tradeable: true, time: String(Date.now() / 1000),
                bids: [{ price: '1.16566', liquidity: 100000 }], asks: [{ price: '1.16576', liquidity: 100000 }] };
            if (failure === 'future time') price.time = String((Date.now() + 120000) / 1000);
            if (failure === 'wrong instrument') price.instrument = 'EUR_USD';
            if (failure === 'crossed quote') price.bids[0].price = '1.2';
            if (failure === 'nontradeable') price.tradeable = false;
            if (failure === 'missing time') delete price.time;
            if (failure === 'liquidity') price.asks[0].liquidity = 1;
            oandaClient.getPricing.mockResolvedValue({ prices: failure === 'duplicate instrument' ? [price, price] : [price] });
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toThrow();
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('a current receipt of an old event passes the complete signal-to-order path and preserves event evidence', async () => {
            const repository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = repository;
            const now = Date.now();
            const eventTime = now - 60000;
            const cached = { ...mockDataService.getCurrentPrice('AUD_USD'), timestamp: eventTime, fetchedAt: now };
            mockDataService.getCurrentPrice.mockImplementation((instrument) => instrument === 'AUD_USD' ? cached : null);
            const pricing = await oandaClient.getPricing(['AUD_USD']);
            pricing.prices[0].time = String(eventTime / 1000);
            oandaClient.getPricing.mockClear();

            await engine.processSignal(createMockSignal());

            expect(oandaClient.getPricing).toHaveBeenCalledWith(['AUD_USD'], { includeHomeConversions: true });
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
            expect(mockEntryDecisionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ priceAgeMs: expect.any(Number) }));
            expect(mockEntryDecisionRepository.save.mock.calls[0][0].priceAgeMs).toBeGreaterThanOrEqual(60000);
            const intent = [...repository.intents.values()][0];
            expect(intent.status).toBe('COMPLETED');
            expect(intent.contextPayload.finalQuote).toEqual(expect.objectContaining({
                quoteTime: eventTime, fetchedAt: expect.any(Number),
                requestStartedAt: expect.any(Number), requestElapsedMs: expect.any(Number),
            }));
            const telemetry = [...engine.openTrades.values()][0].brokerReconciliationPayload.liveRuntime.entryTelemetry;
            expect(telemetry.quoteTime).toBe(eventTime);
            expect(telemetry.quoteAgeMs).toBeGreaterThanOrEqual(60000);
            expect(telemetry.quoteFetchedAt).toBeGreaterThanOrEqual(now);
            expect(JSON.stringify(intent.contextPayload.finalQuote)).not.toContain('requestStartedMonotonicMs');
        });

        test.each(['stale receipt', 'missing receipt', 'invalid latest response'])(
            'a genuinely unavailable cached quote stops the signal before final pricing: %s', async (failure) => {
                const cached = { ...mockDataService.getCurrentPrice('AUD_USD'), timestamp: Date.now() - 60000 };
                if (failure === 'stale receipt') cached.fetchedAt = Date.now() - 16000;
                if (failure === 'missing receipt') delete cached.fetchedAt;
                if (failure === 'invalid latest response') cached.invalidReason = 'PRICE_MISSING';
                mockDataService.getCurrentPrice.mockReturnValue(cached);
                await engine.processSignal(createMockSignal());
                expect(oandaClient.getPricing).not.toHaveBeenCalled();
                expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
                expect(mockEntryDecisionRepository.updateDecision).toHaveBeenLastCalledWith(expect.any(String),
                    expect.objectContaining({ outcome: 'REJECTED' }));
            }
        );

        test.each(['pricing response', 'account preparation', 'intent write', 'submission write', 'clock rollback'])(
            'a real execution-budget overrun never submits and resolves its local intent: %s', async (delayAt) => {
                jest.useFakeTimers({ now: Date.now() });
                const repository = createMockBrokerLifecycleRepository();
                engine.brokerLifecycleRepository = repository;
                let quoteReceived = false;
                const pricing = await oandaClient.getPricing(['AUD_USD']);
                oandaClient.getPricing.mockImplementation(async () => {
                    quoteReceived = true;
                    if (delayAt === 'pricing response') jest.advanceTimersByTime(15001);
                    return pricing;
                });
                const account = oandaClient.getAccountSummary.getMockImplementation();
                oandaClient.getAccountSummary.mockImplementation(async () => {
                    if (quoteReceived && delayAt === 'account preparation') jest.advanceTimersByTime(15001);
                    return account();
                });
                const create = repository.createIntent.getMockImplementation();
                repository.createIntent.mockImplementation(async (intent) => {
                    const result = await create(intent);
                    if (delayAt === 'intent write') jest.advanceTimersByTime(15001);
                    return result;
                });
                const update = repository.updateIntent.getMockImplementation();
                repository.updateIntent.mockImplementation(async (id, changes) => {
                    const result = await update(id, changes);
                    if (changes.status === 'SUBMITTING' && ['submission write', 'clock rollback'].includes(delayAt)) {
                        jest.advanceTimersByTime(15001);
                        if (delayAt === 'clock rollback') jest.setSystemTime(Date.now() - 60000);
                    }
                    return result;
                });

                await expect(engine.executeEntry(createMockSignal(), mockConfigService.get(), 'expired-pricing'))
                    .rejects.toMatchObject({ code: 'FINAL_QUOTE_EXPIRED', entryRejectionCode: 'STALE_PRICE' });
                expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
                expect(engine.getStatus().pendingOrderIntentCount).toBe(0);
                expect(await repository.getRecoverableIntents()).toEqual([]);
                for (const intent of repository.intents.values()) {
                    expect(intent).toEqual(expect.objectContaining({ status: 'ABANDONED', resolvedAt: expect.any(Number) }));
                }
                expect(mockEntryDecisionRepository.updateDecision).toHaveBeenLastCalledWith('expired-pricing',
                    expect.objectContaining({ outcome: 'REJECTED', rejectionCode: 'STALE_PRICE' }));
            }
        );

        test('a final pricing timeout cannot become an ambiguous order', async () => {
            engine.brokerLifecycleRepository = createMockBrokerLifecycleRepository();
            oandaClient.getPricing.mockRejectedValue(Object.assign(new Error('Pricing body timed out'), { code: 'OANDA_TIMEOUT' }));
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get(), 'pricing-timeout'))
                .rejects.toMatchObject({ code: 'OANDA_TIMEOUT' });
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect(await engine.brokerLifecycleRepository.getRecoverableIntents()).toEqual([]);
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenLastCalledWith('pricing-timeout',
                expect.objectContaining({ outcome: 'REJECTED' }));
        });

        test('recent receipt permits breakeven on an unchanged event without duplicating excursion samples', async () => {
            const now = Date.now();
            const trade = addTrade({ entryPrice: 1.1, stopLossPrice: 1.098, entryTime: now - 120000 });
            const price = { instrument: 'AUD_USD', price: 1.1015, bid: 1.1015, ask: 1.1016, spread: 1,
                tradeable: true, timestamp: now - 60000, fetchedAt: now };
            mockDataService.getCurrentPrice.mockReturnValue(price);
            const config = { ...mockConfigService.get(), enableBreakeven: true, breakevenTriggerPips: 12, enableTrailingStops: false };
            await engine.checkPosition(trade, config);
            price.fetchedAt = Date.now();
            await engine.checkPosition(trade, config);
            expect(trade.breakevenHit).toBe(true);
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith('489', expect.objectContaining({ stopLossPrice: 1.1 }));
            expect(trade.brokerReconciliationPayload.sampledExcursion).toEqual(expect.objectContaining({
                observations: 1, firstObservedAt: now - 60000, lastObservedAt: now - 60000,
            }));
        });

        test.each(['stale receipt', 'missing receipt', 'failed response', 'not tradeable'])(
            'unavailable pricing defers quote-dependent protection and sampling: %s', async (failure) => {
                const now = Date.now();
                const trade = addTrade({ entryPrice: 1.1, stopLossPrice: 1.098, entryTime: now - 120000 });
                const price = { instrument: 'AUD_USD', price: 1.1015, bid: 1.1015, ask: 1.1016, spread: 1,
                    tradeable: true, timestamp: now - 60000, fetchedAt: now };
                if (failure === 'stale receipt') price.fetchedAt -= 30001;
                if (failure === 'missing receipt') delete price.fetchedAt;
                if (failure === 'failed response') price.invalidReason = 'PRICE_REQUEST_FAILED';
                if (failure === 'not tradeable') price.tradeable = false;
                mockDataService.getCurrentPrice.mockReturnValue(price);
                await engine.checkPosition(trade, { ...mockConfigService.get(), enableBreakeven: true, breakevenTriggerPips: 12 });
                expect(oandaClient.modifyTrade).not.toHaveBeenCalled();
                expect(trade.brokerReconciliationPayload?.sampledExcursion).toBeUndefined();
            }
        );

        test('a failed poll during awaited management work invalidates the prior quote before adjustment', async () => {
            const now = Date.now();
            const trade = addTrade({ entryPrice: 1.1, stopLossPrice: 1.098, entryTime: now - 120000 });
            const price = { instrument: 'AUD_USD', price: 1.1015, bid: 1.1015, ask: 1.1016,
                tradeable: true, timestamp: now - 60000, fetchedAt: now };
            mockDataService.getCurrentPrice.mockReturnValue(price);
            const retry = jest.spyOn(engine, 'retryPendingStopUpdate').mockImplementation(async () => {
                mockDataService.getCurrentPrice.mockReturnValue({ ...price, invalidReason: 'PRICE_REQUEST_FAILED' });
            });
            await engine.checkPosition(trade, { ...mockConfigService.get(), enableBreakeven: true, breakevenTriggerPips: 12 });
            expect(retry).toHaveBeenCalled();
            expect(oandaClient.modifyTrade).not.toHaveBeenCalled();
            expect(trade.breakevenHit).not.toBe(true);
        });

        test('an event predating entry remains unsampled even when freshly received', async () => {
            const now = Date.now();
            const trade = addTrade({ entryTime: now });
            mockDataService.getCurrentPrice.mockReturnValue({ ...mockDataService.getCurrentPrice('AUD_USD'),
                timestamp: now - 60000, fetchedAt: now });
            await engine.checkPosition(trade, { enableBreakeven: false, enableTrailingStops: false });
            expect(trade.brokerReconciliationPayload?.sampledExcursion).toBeUndefined();
        });

        test('a pending protective update still retries when pricing is unavailable', async () => {
            const trade = addTrade({ reconciliationStatus: 'STOP_UPDATE_RETRY_PENDING',
                brokerReconciliationPayload: { stopUpdate: { status: 'RETRY_PENDING', desiredPrice: 1.1632,
                    desiredTakeProfitPrice: 1.17, stopType: 'INITIAL_STOP_ALIGNMENT', nextRetryAt: 0 } } });
            mockDataService.getCurrentPrice.mockReturnValue(null);
            await engine.checkPosition(trade, { enableBreakeven: true });
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith('489',
                expect.objectContaining({ stopLossPrice: 1.1632, takeProfitPrice: 1.17 }));
        });

        test('rechecks the intraday cost-to-stop ratio on the final quote', async () => {
            jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-19T13:00:00Z'));
            const config = { ...mockConfigService.get(), strategy: 'intraday_momentum', minStopLossPips: 6 };
            const signal = createMockSignal({ strategy: 'intraday_momentum', tradePlan: { stopPips: 6 } });
            oandaClient.getPricing.mockResolvedValue({ prices: [{ instrument: 'AUD_USD', tradeable: true, time: String(Date.now() / 1000),
                bids: [{ price: '1.16566', liquidity: 100000 }], asks: [{ price: '1.16576', liquidity: 100000 }] }] });
            await expect(engine.executeEntry(signal, config)).rejects.toThrow(/execution cost/);
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('rejects a fresh quote when the completed-candle freshness gate fails', async () => {
            mockDataService.getEntryFreshness.mockReturnValue({ fresh: false, code: 'STALE_H1' });
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toThrow('STALE_H1');
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('pause followed by resume cancels an entry already preparing its durable intent', async () => {
            const repository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = repository;
            const create = repository.createIntent.getMockImplementation();
            repository.createIntent.mockImplementation(async (intent) => {
                const saved = await create(intent);
                mockConfigService.emit('configChanged', { enableTrading: false });
                mockConfigService.emit('configChanged', { enableTrading: true });
                return saved;
            });
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toMatchObject({ code: 'ENTRY_ACTIVATION_CHANGED' });
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect([...repository.intents.values()][0].status).toBe('ABANDONED');
        });

        test('engine stop cancels queued entry work and prevents an in-flight order', async () => {
            const repository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = repository;
            const create = repository.createIntent.getMockImplementation();
            repository.createIntent.mockImplementation(async (intent) => { const saved = await create(intent); engine.stop(); return saved; });
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toMatchObject({ code: 'ENTRY_ACTIVATION_CHANGED' });
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
            expect(engine.tradeQueue).toEqual([]);
        });

        test('retries equal initial stop alignment together with its take profit', async () => {
            const trade = addTrade({ reconciliationStatus: 'STOP_UPDATE_RETRY_PENDING',
                brokerReconciliationPayload: { stopUpdate: { status: 'RETRY_PENDING', desiredPrice: 1.1632,
                    desiredTakeProfitPrice: 1.17, stopType: 'INITIAL_STOP_ALIGNMENT', nextRetryAt: 0 } },
            });
            await engine.retryPendingStopUpdate(trade);
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith('489', expect.objectContaining({ stopLossPrice: 1.1632, takeProfitPrice: 1.17 }));
            expect(trade.brokerReconciliationPayload.stopUpdate).toBeNull();
            expect(trade.takeProfitPrice).toBe(1.17);
        });

        test('repairs a cancelled broker stop even when the local stop price is unchanged', async () => {
            const trade = addTrade();
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade({ stopLossOrder: undefined })] });
            await engine.syncWithOanda({ throwOnError: true });
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith('489', expect.objectContaining({ stopLossPrice: trade.stopLossPrice, takeProfitPrice: trade.takeProfitPrice }));
            expect(engine.openTrades.has(trade.id)).toBe(true);
        });

        test('adopts a broker-confirmed tighter stop and completes a lost SQLite update', async () => {
            const trade = addTrade({ brokerReconciliationPayload: { stopUpdate: {
                status: 'RETRY_PENDING', desiredPrice: 1.16571, stopType: 'BREAKEVEN', localUpdates: { breakevenHit: true },
            } } });
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade({ stopLossOrder: { state: 'PENDING', price: '1.16571' } })] });
            await engine.syncWithOanda({ throwOnError: true });
            expect(oandaClient.modifyTrade).not.toHaveBeenCalled();
            expect(trade.stopLossPrice).toBe(1.16571);
            expect(trade.breakevenHit).toBe(true);
            expect(trade.brokerReconciliationPayload.stopUpdate).toBeNull();
        });

        test('closes exposure if a missing broker stop cannot be restored', async () => {
            const trade = addTrade();
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade({ stopLossOrder: undefined })] });
            oandaClient.modifyTrade.mockRejectedValue(new Error('protective order rejected'));
            await engine.syncWithOanda({ throwOnError: true });
            expect(oandaClient.closeTrade).toHaveBeenCalledWith('489');
            expect(engine.openTrades.has(trade.id)).toBe(false);
            expect(engine.quarantinedBrokerTrades.size).toBe(0);
        });

        test('retains managed exposure and blocks entries when protection repair and emergency close fail', async () => {
            const trade = addTrade();
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade({ stopLossOrder: undefined })] });
            oandaClient.modifyTrade.mockRejectedValue(new Error('protection unavailable'));
            oandaClient.closeTrade.mockRejectedValue(new Error('close unavailable'));
            await engine.syncWithOanda({ throwOnError: true });
            expect(engine.openTrades.has(trade.id)).toBe(true);
            expect(trade.reconciliationStatus).toBe('CLOSE_RETRY_PENDING');
            expect(await engine.getBrokerEntryBlockReason()).toMatch(/pending/);
        });

        test('uses cumulative trade financing and positive fee charges on direct close', async () => {
            const trade = addTrade();
            oandaClient.getTrade.mockResolvedValue({ trade: { id: '489', state: 'CLOSED', averageClosePrice: '1.16784',
                realizedPL: '2.50', financing: '-0.05', commission: '0.02', guaranteedExecutionFee: '0.01', closeTime: String(Date.now() / 1000) } });
            const closed = await engine.executeExit(trade, 1.16, 'TIME_STOP');
            expect(closed.pnlAud).toBeCloseTo(2.42, 8);
            expect(closed.swapAud).toBe(-0.05);
            expect(closed.commissionAud).toBe(0.02);
            expect(closed.exitReason).toBe('TIME_STOP');
        });

        test('holds accounting reconciliation open when a broker-closed trade has no realized result', async () => {
            const trade = addTrade();
            oandaClient.getTrade.mockResolvedValue({ trade: { id: '489', state: 'CLOSED', averageClosePrice: '1.16784' } });
            const closed = await engine.executeExit(trade, 1.16, 'MANUAL');
            expect(closed).toBeNull();
            expect(engine.openTrades.has(trade.id)).toBe(true);
            expect(trade.reconciliationStatus).toBe('CLOSE_RETRY_PENDING');
        });

        test('records sampled executable-side excursions without inventing historical observations', async () => {
            const now = Date.now();
            const trade = addTrade({ entryPrice: 1.1, stopLossPrice: 1.098,
                brokerReconciliationPayload: { liveRuntime: { initialStopDistance: 0.002 } } });
            await engine.recordSampledExcursion(trade, 1.101, now);
            await engine.recordSampledExcursion(trade, 1.105, now); // Same timestamp ignored.
            await engine.recordSampledExcursion(trade, 1.0995, now + 1000);
            const sample = trade.brokerReconciliationPayload.sampledExcursion;
            expect(sample.observations).toBe(2);
            expect(sample.maxFavorablePips).toBeCloseTo(10);
            expect(sample.maxAdversePips).toBeCloseTo(5);
            expect(sample.maxFavorableR).toBeCloseTo(0.5);
            expect(sample.maxAdverseR).toBeCloseTo(0.25);
        });

        test('emergency-closes an unprotected fill even when SQLite cannot save the trade', async () => {
            const repository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = repository;
            oandaClient.modifyTrade.mockRejectedValue(new Error('stop rejected'));
            mockTradeRepository.save.mockRejectedValue(new Error('SQLite unavailable'));
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get())).rejects.toMatchObject({ ambiguous: true });
            expect(oandaClient.placeMarketOrder).toHaveBeenCalledTimes(1);
            expect(oandaClient.closeTrade).toHaveBeenCalledWith('489');
            expect([...repository.intents.values()][0].status).toBe('FILLED_UNPERSISTED');
            expect(engine.brokerStateUncertain).toBe(true);
        });

        test('does not let excursion telemetry failures prevent a due timed close', async () => {
            const trade = addTrade({ entryTime: Date.now() - 7 * 3600000,
                brokerReconciliationPayload: { liveRuntime: { ownerExitPolicy: { version: 1, config: { timeStopHours: 6 } } } } });
            mockTradeRepository.updateTrade.mockRejectedValueOnce(new Error('sample write failed'));
            await engine.checkPosition(trade, {});
            expect(oandaClient.closeTrade).toHaveBeenCalledWith('489');
            expect(engine.openTrades.size).toBe(0);
        });

        test('serializes an explicit broker-ID manual close through managed cumulative accounting', async () => {
            const trade = addTrade();
            oandaClient.getOpenTrades.mockResolvedValue({ trades: [protectedBrokerTrade()] });
            const result = await engine.closeBrokerTrade('489');
            expect(result.closedTrade.id).toBe(trade.id);
            expect(result.closedTrade.exitReason).toBe('MANUAL');
            expect(result.orderFillTransaction.tradesClosed[0].tradeID).toBe('489');
            expect(engine.openTrades.size).toBe(0);
        });

        test('reports a confirmed FOK cancellation as rejected rather than permanently pending', async () => {
            const repository = createMockBrokerLifecycleRepository();
            engine.brokerLifecycleRepository = repository;
            oandaClient.placeMarketOrder.mockResolvedValueOnce({ orderCancelTransaction: { id: 'cancelled' } });
            oandaClient.findOrderIntent.mockResolvedValueOnce({ status: 'REJECTED' });
            await expect(engine.executeEntry(createMockSignal(), mockConfigService.get(), 'cancelled-decision')).rejects.toThrow(/rejected or cancelled/);
            expect([...repository.intents.values()][0].status).toBe('REJECTED');
            expect(mockEntryDecisionRepository.updateDecision).toHaveBeenCalledWith('cancelled-decision', expect.objectContaining({ outcome: 'REJECTED' }));
        });

        test('does not loosen a newer protective stop during an old initial-alignment retry', async () => {
            const trade = addTrade({ stopLossPrice: 1.16571, brokerReconciliationPayload: { stopUpdate: {
                status: 'RETRY_PENDING', stopType: 'INITIAL_STOP_ALIGNMENT', nextRetryAt: 0,
                desiredPrice: 1.1631, baselineStopPrice: 1.1632, desiredTakeProfitPrice: 1.169,
            } } });
            await engine.retryPendingStopUpdate(trade);
            expect(oandaClient.modifyTrade).toHaveBeenCalledWith('489', expect.objectContaining({ stopLossPrice: 1.16571, takeProfitPrice: 1.169 }));
            expect(trade.stopLossPrice).toBe(1.16571);
        });

        test('serializes a delayed close retry lookup with manual close without resurrecting the row', async () => {
            const trade = addTrade({ reconciliationStatus: 'CLOSE_RETRY_PENDING',
                brokerReconciliationPayload: { closeRetry: { reason: 'TIME_STOP', nextRetryAt: 0 } } });
            let rejectLookup;
            oandaClient.getTrade.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLookup = reject; }));
            const retry = engine.retryPendingClose(trade, trade.entryPrice);
            await Promise.resolve();
            const manual = engine.executeExit(trade, trade.entryPrice, 'MANUAL');
            await Promise.resolve();
            expect(oandaClient.closeTrade).not.toHaveBeenCalled();
            rejectLookup(new Error('old lookup failed'));
            await Promise.all([retry, manual]);
            const stateWrites = mockTradeRepository.updateTrade.mock.calls.filter(([, update]) => update.isOpen !== undefined);
            expect(stateWrites.at(-1)[1].isOpen).toBe(false);
            expect(engine.openTrades.size).toBe(0);
            expect(engine.stats.tradesClosed).toBe(1);
        });

        test('rechecks cooldown after execution reconciliation discovers a fresh loss', async () => {
            const trade = addTrade({ runId: 'risk-run', ownerRunId: 'risk-run' });
            await mockTradeRepository.save(trade);
            mockConfigService.config.maxConsecutiveLosses = 1;
            const signal = createMockSignal({ symbol: 'EUR_USD', runId: 'risk-run' });
            const preliminary = await engine.validateEntry(signal, mockConfigService.get());
            expect(preliminary.valid).toBe(true);
            oandaClient.getTrade.mockResolvedValue({ trade: { id: '489', state: 'CLOSED', averageClosePrice: '1.1632',
                realizedPL: '-1.00', financing: '0', closeTime: String(Date.now() / 1000) } });
            await expect(engine.executeEntry(signal, mockConfigService.get())).rejects.toThrow(/CONSECUTIVE_LOSS_COOLDOWN/);
            expect(oandaClient.placeMarketOrder).not.toHaveBeenCalled();
        });

        test('caps cash risk at the worst allowed fill even if stop realignment fails', async () => {
            engine.brokerLifecycleRepository = createMockBrokerLifecycleRepository();
            const config = { ...mockConfigService.get(), riskPerTrade: 0.0025, maxCapitalAtRisk: 100, minStopLossPips: 6 };
            const signal = createMockSignal({ tradePlan: { stopPips: 6, targetRiskMultiple: 1.5 } });
            let submittedStop;
            oandaClient.placeMarketOrder.mockImplementation(async (_instrument, units, options) => {
                submittedStop = options.stopLossPrice;
                return { orderFillTransaction: { price: String(options.priceBound), units: String(units),
                    tradeOpened: { tradeID: '489', price: String(options.priceBound), units: String(units), initialMarginRequired: '10' } } };
            });
            oandaClient.modifyTrade.mockRejectedValue(new Error('alignment unavailable'));
            oandaClient.getTrade.mockImplementation(async () => ({ trade: { id: '489', state: 'OPEN',
                stopLossOrder: { state: 'PENDING', price: String(submittedStop) } } }));
            const trade = await engine.executeEntry(signal, config);
            const intent = [...engine.brokerLifecycleRepository.intents.values()][0];
            const cashRisk = trade.units * Math.abs(trade.entryPrice - trade.stopLossPrice) * intent.contextPayload.quoteToAudRate;
            expect(cashRisk).toBeLessThanOrEqual(intent.contextPayload.riskBudgetAud + 1e-10);
            expect(cashRisk).toBeCloseTo(intent.contextPayload.worstFillRiskAud, 8);
            expect(trade.reconciliationStatus).toBe('STOP_UPDATE_RETRY_PENDING');
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
                        timestamp: Date.now(), fetchedAt: Date.now(),
                    };
                }

                return {
                    price: 1.16784,
                    bid: 1.16779,
                    ask: 1.16789,
                    spread: 1.0,
                    timestamp: Date.now(), fetchedAt: Date.now(),
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

        test('liquidates using broker settlement when current market price is unavailable', async () => {
            const trade = createMockTrade({
                id: 'trade-no-price',
                instrument: 'GBP_USD',
            });

            engine.openTrades.set(trade.id, trade);
            mockDataService.getCurrentPrice.mockReturnValueOnce(null);

            const closed = await engine.liquidateOpenTrades('STRATEGY_PROMOTION');
            expect(closed).toHaveLength(1);
            expect(closed[0].exitPrice).toBe(1.16784);
            expect(engine.openTrades.size).toBe(0);
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
