// Tests for TradeRepository - Database operations
const TradeRepository = require('../tradeRepository');
const { createTestDb, seedTestData, cleanupTestDb, destroyTestDb } = require('../../../__tests__/helpers/testDb');
const { createMockTrade, createClosedTrade, createLosingTrade, createDbRecord } = require('../../../__tests__/fixtures/mockTrades');

// Store reference to test database for mock
let testDbInstance = null;

// Mock the database module - use a function that delegates to testDbInstance
jest.mock('../../../config/database', () => ({
    db: new Proxy(function() {}, {
        apply: (target, thisArg, args) => {
            // Handle db("tableName") calls
            if (testDbInstance) {
                return testDbInstance(args[0]);
            }
            throw new Error('Database not initialized');
        },
        get: (target, prop) => {
            // Handle db.fn, db.raw, etc.
            if (testDbInstance && testDbInstance[prop]) {
                return typeof testDbInstance[prop] === 'function'
                    ? testDbInstance[prop].bind(testDbInstance)
                    : testDbInstance[prop];
            }
            return undefined;
        },
    }),
}));

describe('TradeRepository', () => {
    let repository;
    let testDb;

    beforeAll(async () => {
        testDb = await createTestDb();
        testDbInstance = testDb;
    });

    afterAll(async () => {
        await destroyTestDb(testDb);
        testDbInstance = null;
    });

    beforeEach(async () => {
        repository = new TradeRepository();
        await cleanupTestDb(testDb);
    });

    describe('_mapToTradeObject', () => {
        test('should map database record to trade object', () => {
            const dbRecord = {
                trade_id: 'trade-123',
                oanda_trade_id: '489',
                instrument: 'AUD_USD',
                side: 'BUY',
                units: 795,
                entry_price: 1.16571,
                exit_price: 1.16784,
                entry_cost_aud: 926.74,
                exit_value_aud: 928.43,
                pnl_aud: 2.50,
                pnl_pips: 21.3,
                pnl_percent: 0.27,
                signal: 'BUY',
                signal_strength: 28.5,
                entry_type: 'FRESH_FLIP',
                atr_pips: 12.5,
                stop_loss_price: 1.16320,
                take_profit_price: 1.16918,
                trailing_stop_price: null,
                highest_price: 1.16800,
                trailing_stop_pips: null,
                leverage_used: 20,
                margin_used_aud: 46.17,
                spread_pips: 1.0,
                swap_aud: -0.02,
                commission_aud: 0,
                holding_period_ms: 3600000,
                entry_time: Date.now() - 3600000,
                exit_time: Date.now(),
                exit_reason: 'TAKE_PROFIT',
                mode: 'live',
                is_open: 0,
            };

            const trade = repository._mapToTradeObject(dbRecord);

            expect(trade.id).toBe('trade-123');
            expect(trade.oandaTradeId).toBe('489');
            expect(trade.instrument).toBe('AUD_USD');
            expect(trade.side).toBe('BUY');
            expect(trade.units).toBe(795);
            expect(trade.entryPrice).toBe(1.16571);
            expect(trade.exitPrice).toBe(1.16784);
            expect(trade.pnlAud).toBe(2.50);
            expect(trade.isOpen).toBe(false);
        });

        test('should return null for null input', () => {
            const result = repository._mapToTradeObject(null);
            expect(result).toBeNull();
        });

        test('should convert is_open to boolean', () => {
            const openRecord = { trade_id: 'trade-1', is_open: 1 };
            const closedRecord = { trade_id: 'trade-2', is_open: 0 };

            const openTrade = repository._mapToTradeObject(openRecord);
            const closedTrade = repository._mapToTradeObject(closedRecord);

            expect(openTrade.isOpen).toBe(true);
            expect(closedTrade.isOpen).toBe(false);
        });
    });

    describe('save', () => {
        test('should save a new trade to database', async () => {
            const trade = createMockTrade({ id: 'trade-save-1' });

            await repository.save(trade);

            const saved = await testDb('trades').where('trade_id', 'trade-save-1').first();
            expect(saved).toBeDefined();
            expect(saved.instrument).toBe('AUD_USD');
            expect(saved.units).toBe(795);
        });

        test('should save trade with all fields', async () => {
            const trade = createMockTrade({
                id: 'trade-save-2',
                oandaTradeId: '489',
                stopLossPrice: 1.16320,
                takeProfitPrice: 1.16918,
                marginUsedAud: 46.17,
            });

            await repository.save(trade);

            const saved = await testDb('trades').where('trade_id', 'trade-save-2').first();
            expect(saved.oanda_trade_id).toBe('489');
            expect(saved.stop_loss_price).toBe(1.16320);
            expect(saved.take_profit_price).toBe(1.16918);
            expect(saved.margin_used_aud).toBe(46.17);
        });

        test('should throw error on duplicate trade_id', async () => {
            const trade1 = createMockTrade({ id: 'trade-dup' });
            const trade2 = createMockTrade({ id: 'trade-dup' });

            await repository.save(trade1);

            await expect(repository.save(trade2)).rejects.toThrow();
        });
    });

    describe('getRecent', () => {
        test('should return recent trades in descending order', async () => {
            const now = Date.now();
            const trade1 = createMockTrade({ id: 'trade-1', entryTime: now - 3000 });
            const trade2 = createMockTrade({ id: 'trade-2', entryTime: now - 2000 });
            const trade3 = createMockTrade({ id: 'trade-3', entryTime: now - 1000 });

            await repository.save(trade1);
            await repository.save(trade2);
            await repository.save(trade3);

            const recent = await repository.getRecent(3, 'live');

            expect(recent).toHaveLength(3);
            expect(recent[0].id).toBe('trade-3'); // Most recent first
            expect(recent[2].id).toBe('trade-1'); // Oldest last
        });

        test('should respect limit parameter', async () => {
            for (let i = 0; i < 10; i++) {
                await repository.save(createMockTrade({ id: `trade-limit-${i}` }));
            }

            const recent = await repository.getRecent(5, 'live');

            expect(recent).toHaveLength(5);
        });

        test('should filter by mode', async () => {
            await repository.save(createMockTrade({ id: 'live-trade', mode: 'live' }));
            await repository.save(createMockTrade({ id: 'paper-trade', mode: 'paper' }));

            const liveTrades = await repository.getRecent(10, 'live');
            const paperTrades = await repository.getRecent(10, 'paper');

            expect(liveTrades).toHaveLength(1);
            expect(liveTrades[0].id).toBe('live-trade');
            expect(paperTrades).toHaveLength(1);
            expect(paperTrades[0].id).toBe('paper-trade');
        });
    });

    describe('getOpenTrades', () => {
        test('should return only open trades', async () => {
            await repository.save(createMockTrade({ id: 'open-1', isOpen: true }));
            await repository.save(createMockTrade({ id: 'open-2', isOpen: true }));
            await repository.save(createClosedTrade({ id: 'closed-1' }));

            const openTrades = await repository.getOpenTrades('live');

            expect(openTrades).toHaveLength(2);
            expect(openTrades.every(t => t.isOpen)).toBe(true);
        });

        test('should return empty array when no open trades', async () => {
            await repository.save(createClosedTrade({ id: 'closed-1' }));

            const openTrades = await repository.getOpenTrades('live');

            expect(openTrades).toHaveLength(0);
        });
    });

    describe('getByInstrument', () => {
        test('should filter trades by instrument', async () => {
            await repository.save(createMockTrade({ id: 'aud-1', instrument: 'AUD_USD' }));
            await repository.save(createMockTrade({ id: 'eur-1', instrument: 'EUR_USD' }));
            await repository.save(createMockTrade({ id: 'aud-2', instrument: 'AUD_USD' }));

            const audTrades = await repository.getByInstrument('AUD_USD', 10, 'live');

            expect(audTrades).toHaveLength(2);
            expect(audTrades.every(t => t.instrument === 'AUD_USD')).toBe(true);
        });
    });

    describe('getTradesSince', () => {
        test('should return trades since cutoff time', async () => {
            const now = Date.now();
            const oldTrade = createMockTrade({ id: 'old', entryTime: now - 100000 });
            const recentTrade = createMockTrade({ id: 'recent', entryTime: now - 1000 });

            await repository.save(oldTrade);
            await repository.save(recentTrade);

            const cutoff = now - 50000;
            const trades = await repository.getTradesSince(cutoff, 'live');

            expect(trades).toHaveLength(1);
            expect(trades[0].id).toBe('recent');
        });

        test('should accept Date object as cutoff', async () => {
            const now = Date.now();
            const trade = createMockTrade({ id: 'test', entryTime: now });
            await repository.save(trade);

            const cutoff = new Date(now - 1000);
            const trades = await repository.getTradesSince(cutoff, 'live');

            expect(trades).toHaveLength(1);
        });
    });

    describe('getAllTrades', () => {
        test('should return all trades in ascending order', async () => {
            const now = Date.now();
            await repository.save(createMockTrade({ id: 'trade-1', entryTime: now - 3000 }));
            await repository.save(createMockTrade({ id: 'trade-2', entryTime: now - 2000 }));
            await repository.save(createMockTrade({ id: 'trade-3', entryTime: now - 1000 }));

            const trades = await repository.getAllTrades('live');

            expect(trades).toHaveLength(3);
            expect(trades[0].id).toBe('trade-1'); // Oldest first
            expect(trades[2].id).toBe('trade-3'); // Newest last
        });
    });

    describe('updateTrade', () => {
        test('should update trade fields', async () => {
            const trade = createMockTrade({ id: 'trade-update' });
            await repository.save(trade);

            await repository.updateTrade('trade-update', {
                exitPrice: 1.16784,
                exitTime: Date.now(),
                pnlAud: 2.50,
                pnlPips: 21.3,
                isOpen: false,
                exitReason: 'TAKE_PROFIT',
            });

            const updated = await testDb('trades').where('trade_id', 'trade-update').first();
            expect(updated.exit_price).toBe(1.16784);
            expect(updated.pnl_aud).toBe(2.50);
            expect(updated.is_open).toBe(0);
            expect(updated.exit_reason).toBe('TAKE_PROFIT');
        });

        test('should update trailing stop price', async () => {
            const trade = createMockTrade({ id: 'trade-trailing' });
            await repository.save(trade);

            await repository.updateTrade('trade-trailing', {
                trailingStopPrice: 1.16450,
                highestPrice: 1.16700,
            });

            const updated = await testDb('trades').where('trade_id', 'trade-trailing').first();
            expect(updated.trailing_stop_price).toBe(1.16450);
            expect(updated.highest_price).toBe(1.16700);
        });

        test('should update swap fees', async () => {
            const trade = createMockTrade({ id: 'trade-swap' });
            await repository.save(trade);

            await repository.updateTrade('trade-swap', {
                swapAud: -0.05,
            });

            const updated = await testDb('trades').where('trade_id', 'trade-swap').first();
            expect(updated.swap_aud).toBe(-0.05);
        });

        test('should not update if no valid fields provided', async () => {
            const trade = createMockTrade({ id: 'trade-noop' });
            await repository.save(trade);

            const beforeUpdate = await testDb('trades').where('trade_id', 'trade-noop').first();

            await repository.updateTrade('trade-noop', {
                invalidField: 'value',
            });

            const afterUpdate = await testDb('trades').where('trade_id', 'trade-noop').first();

            // Only updated_at should change, but values should be same
            expect(afterUpdate.instrument).toBe(beforeUpdate.instrument);
        });
    });

    describe('getPerformanceMetrics', () => {
        test('should calculate correct metrics for closed trades', async () => {
            // Add winning trades
            await repository.save(createClosedTrade({
                id: 'win-1',
                pnlAud: 5.00,
                pnlPips: 25,
                entryTime: Date.now() - 100000,
            }));
            await repository.save(createClosedTrade({
                id: 'win-2',
                pnlAud: 3.00,
                pnlPips: 15,
                entryTime: Date.now() - 90000,
            }));

            // Add losing trades
            await repository.save(createLosingTrade({
                id: 'loss-1',
                pnlAud: -2.00,
                pnlPips: -10,
                entryTime: Date.now() - 80000,
            }));

            const metrics = await repository.getPerformanceMetrics('7d', 'live');

            expect(metrics.totalTrades).toBe(3);
            expect(metrics.winningTrades).toBe(2);
            expect(metrics.losingTrades).toBe(1);
            expect(metrics.winRate).toBeCloseTo(66.67, 1);
            expect(metrics.totalPnLAud).toBeCloseTo(6.00, 1);
        });

        test('should return null when no trades', async () => {
            const metrics = await repository.getPerformanceMetrics('7d', 'live');
            expect(metrics).toBeNull();
        });

        test('should exclude open trades from metrics', async () => {
            await repository.save(createClosedTrade({ id: 'closed', pnlAud: 5.00, entryTime: Date.now() - 1000 }));
            await repository.save(createMockTrade({ id: 'open', isOpen: true, entryTime: Date.now() - 1000 }));

            const metrics = await repository.getPerformanceMetrics('7d', 'live');

            expect(metrics.totalTrades).toBe(1);
        });
    });

    describe('parsePeriod', () => {
        test('should parse period strings correctly', () => {
            expect(repository.parsePeriod('1d')).toBe(24 * 60 * 60 * 1000);
            expect(repository.parsePeriod('7d')).toBe(7 * 24 * 60 * 60 * 1000);
            expect(repository.parsePeriod('30d')).toBe(30 * 24 * 60 * 60 * 1000);
            expect(repository.parsePeriod('90d')).toBe(90 * 24 * 60 * 60 * 1000);
        });

        test('should default to 30d for unknown period', () => {
            expect(repository.parsePeriod('invalid')).toBe(30 * 24 * 60 * 60 * 1000);
        });
    });

    describe('calculateMetrics', () => {
        test('should calculate profit factor correctly', () => {
            const trades = [
                { pnl_aud: 10, pnl_pips: 50, is_open: false },
                { pnl_aud: 5, pnl_pips: 25, is_open: false },
                { pnl_aud: -4, pnl_pips: -20, is_open: false },
                { pnl_aud: -2, pnl_pips: -10, is_open: false },
            ];

            const metrics = repository.calculateMetrics(trades);

            // Avg win = 7.5, Avg loss = 3
            // Profit factor = 7.5 / 3 = 2.5
            expect(metrics.profitFactor).toBeCloseTo(2.5, 1);
        });

        test('should return null for empty trades', () => {
            const metrics = repository.calculateMetrics([]);
            expect(metrics).toBeNull();
        });

        test('should calculate average win and loss', () => {
            const trades = [
                { pnl_aud: 10, pnl_pips: 50, is_open: false },
                { pnl_aud: 6, pnl_pips: 30, is_open: false },
                { pnl_aud: -4, pnl_pips: -20, is_open: false },
            ];

            const metrics = repository.calculateMetrics(trades);

            expect(metrics.avgWinAud).toBeCloseTo(8, 1); // (10 + 6) / 2
            expect(metrics.avgLossAud).toBeCloseTo(4, 1); // abs(-4) / 1
        });
    });
});
