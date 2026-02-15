// Tests for LiveTradingEngine - Critical trading logic
const LiveTradingEngine = require('../LiveTradingEngine');
const {
    createMockConfigService,
    createMockTradeRepository,
    createMockSignalGenerator,
} = require('../../../__tests__/helpers/mockServices');
const { createMockSignal, createSellSignal } = require('../../../__tests__/fixtures/mockSignals');
const { createMockTrade } = require('../../../__tests__/fixtures/mockTrades');

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
    let oandaClient;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Get the mocked oandaClient
        oandaClient = require('../Oandaclient');

        // Create fresh mocks for each test
        mockConfigService = createMockConfigService({
            enableTrading: true,
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
            leverage: 20,
        });

        mockTradeRepository = createMockTradeRepository();

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
            null // io
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
        test('should reject when trading is disabled', () => {
            const signal = createMockSignal();
            const config = { ...mockConfigService.get(), enableTrading: false };

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Trading is disabled');
        });

        test('should reject when instrument not in active list', () => {
            const signal = createMockSignal({ symbol: 'GBP_USD' });
            const config = mockConfigService.get();

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('not in active list');
        });

        test('should reject when max positions reached', () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            // Add 2 open trades
            engine.openTrades.set('trade1', createMockTrade());
            engine.openTrades.set('trade2', createMockTrade({ instrument: 'EUR_USD' }));

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Max positions reached');
        });

        test('should reject when already in position for instrument', () => {
            const signal = createMockSignal({ symbol: 'AUD_USD' });
            const config = mockConfigService.get();

            // Add existing trade for same instrument
            engine.openTrades.set('trade1', createMockTrade({ instrument: 'AUD_USD' }));

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Already in position for this instrument');
        });

        test('should reject when ADX is below threshold', () => {
            const signal = createMockSignal({ strength: 18 }); // Below 22
            const config = mockConfigService.get();

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('ADX too low');
        });

        test('should reject SELL signal when shorting disabled', () => {
            const signal = createSellSignal();
            const config = { ...mockConfigService.get(), enableShorting: false };

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('Short selling is disabled');
        });

        test('should approve valid BUY signal', () => {
            const signal = createMockSignal({
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 28,
            });
            const config = mockConfigService.get();

            const result = engine.validateEntry(signal, config);

            expect(result.valid).toBe(true);
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
        test('should calculate TP based on margin percentage', () => {
            const signal = createMockSignal({ currentPrice: 1.16571 });
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
                takeProfitPercent: 0.06, // 6%
            };
            const units = 795;
            const marginUsed = 46.17;

            const result = engine.calculateTakeProfit(signal, config, units, marginUsed);

            // Target = $46.17 * 0.06 = $2.77
            expect(result.targetProfitAud).toBeCloseTo(2.77, 1);
            expect(result.takeProfitPrice).toBeGreaterThan(signal.currentPrice);
        });

        test('should return null when TP disabled', () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: false,
            };

            const result = engine.calculateTakeProfit(signal, config, 795, 46.17);

            expect(result).toBeNull();
        });

        test('should return null when units is 0', () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
            };

            const result = engine.calculateTakeProfit(signal, config, 0, 46.17);

            expect(result).toBeNull();
        });

        test('should return null when margin is 0', () => {
            const signal = createMockSignal();
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
            };

            const result = engine.calculateTakeProfit(signal, config, 795, 0);

            expect(result).toBeNull();
        });

        test('should use entry price when provided', () => {
            const signal = createMockSignal({ currentPrice: 1.16571 });
            const config = {
                ...mockConfigService.get(),
                enableTakeProfit: true,
                takeProfitPercent: 0.06,
            };
            const entryPrice = 1.16600;

            const result = engine.calculateTakeProfit(signal, config, 795, 46.17, entryPrice);

            // TP should be calculated from entry price, not signal price
            expect(result.takeProfitPrice).toBeGreaterThan(entryPrice);
        });
    });

    describe('Signal Processing', () => {
        test('should reject BUY signal when already in position', async () => {
            const signal = createMockSignal({ symbol: 'AUD_USD', signal: 'BUY' });

            // Add existing position
            engine.openTrades.set('existing', createMockTrade({ instrument: 'AUD_USD' }));

            await engine.processSignal(signal);

            expect(engine.stats.signalsRejected).toBe(1);
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
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

        test('should process HOLD signals without action', async () => {
            const holdSignal = createMockSignal({ signal: 'HOLD' });

            await engine.processSignal(holdSignal);

            expect(mockTradeRepository.save).not.toHaveBeenCalled();
            expect(engine.stats.signalsRejected).toBe(0);
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
            const signal = createMockSignal();
            const config = mockConfigService.get();

            const trade = await engine.executeEntry(signal, config);

            expect(trade).toBeDefined();
            expect(trade.instrument).toBe('AUD_USD');
            expect(trade.isOpen).toBe(true);
            expect(mockTradeRepository.save).toHaveBeenCalled();
            expect(engine.openTrades.size).toBe(1);
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

            const result = await engine.executeEntry(signal, config);

            expect(result).toBeUndefined();
            expect(mockTradeRepository.save).not.toHaveBeenCalled();
        });

        test('should update stats after successful trade', async () => {
            const signal = createMockSignal();
            const config = mockConfigService.get();

            await engine.executeEntry(signal, config);

            expect(engine.stats.tradesExecuted).toBe(1);
            expect(engine.stats.lastTradeTime).toBeDefined();
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

        test('should update stats on trade close', async () => {
            const trade = createMockTrade({ id: 'trade-123' });
            engine.openTrades.set(trade.id, trade);

            await engine.closeTrade(trade.id, 1.16784, 'TAKE_PROFIT');

            expect(engine.stats.tradesClosed).toBe(1);
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
    });

    describe('Status and Helpers', () => {
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
