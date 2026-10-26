// Tests for TradeRepository - Database operations
const TradeRepository = require('../tradeRepository');
const { createTestDb, seedTestData, cleanupTestDb, destroyTestDb } = require('../../../__tests__/helpers/testDb');
const { createMockTrade, createClosedTrade, createLosingTrade, createDbRecord } = require('../../../__tests__/fixtures/mockTrades');
const { buildOwnerRunExitPolicy, resolveOwnerRunExitPolicy, evaluatePeakProfitTrail } = require('../../runtime/exitPolicy');

// Store reference to test database for mock
// IMPORTANT: Variable must be prefixed with 'mock' for Jest hoisting to work
let mockTestDbInstance = null;

// Mock the database module - use a function that delegates to mockTestDbInstance
jest.mock('../../../config/database', () => ({
    db: new Proxy(function() {}, {
        apply: (target, thisArg, args) => {
            // Handle db("tableName") calls
            if (mockTestDbInstance) {
                return mockTestDbInstance(args[0]);
            }
            throw new Error('Database not initialized');
        },
        get: (target, prop) => {
            // Handle db.fn, db.raw, etc.
            if (mockTestDbInstance && mockTestDbInstance[prop]) {
                return typeof mockTestDbInstance[prop] === 'function'
                    ? mockTestDbInstance[prop].bind(mockTestDbInstance)
                    : mockTestDbInstance[prop];
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
        mockTestDbInstance = testDb;
    });

    afterAll(async () => {
        await destroyTestDb(testDb);
        mockTestDbInstance = null;
    });

    beforeEach(async () => {
        repository = new TradeRepository();
        await cleanupTestDb(testDb);
    });

    test('realized periods include old entries closed inside the interval and exclude the end boundary', async () => {
        await repository.save(createClosedTrade({ id: 'old-entry', entryTime: 1000, exitTime: 5000 }));
        await repository.save(createClosedTrade({ id: 'end-boundary', entryTime: 2000, exitTime: 6000 }));
        await repository.save(createMockTrade({ id: 'still-open', entryTime: 4500, isOpen: true }));
        const trades = await repository.getTradesSince(4000, { timeBasis: 'realized', endTime: 6000 });
        expect(trades.map((trade) => trade.id)).toEqual(['old-entry']);
        const entries = await repository.getTradesSince(4000, { timeBasis: 'entry', endTime: 6000 });
        expect(entries.map((trade) => trade.id)).toEqual(['still-open']);
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

        test('should map runtime identity fields', () => {
            const trade = repository._mapToTradeObject({
                trade_id: 'trade-runtime-1',
                mode: 'paper_shadow',
                run_id: 'run-shadow-1',
                owner_run_id: 'run-live-1',
                selection_id: 'selection-live-1',
                strategy: 'supertrend_momentum',
                is_open: 1,
            });

            expect(trade).toEqual(
                expect.objectContaining({
                    mode: 'paper_shadow',
                    runId: 'run-shadow-1',
                    ownerRunId: 'run-live-1',
                    selectionId: 'selection-live-1',
                    strategy: 'supertrend_momentum',
                })
            );
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

        test('should persist currently wired trade telemetry fields on save', async () => {
            const trade = createMockTrade({
                id: 'trade-save-telemetry',
                trailingStopPrice: 1.1645,
                highestPrice: 1.167,
                trailingStopPips: 18,
                leverageUsed: 15,
                spreadPips: 1.4,
                swapAud: -0.0123,
                exitReason: 'TRAILING_STOP',
            });

            await repository.save(trade);

            const saved = await testDb('trades')
                .where('trade_id', 'trade-save-telemetry')
                .first();
            expect(saved.trailing_stop_price).toBe(1.1645);
            expect(saved.highest_price).toBe(1.167);
            expect(saved.trailing_stop_pips).toBe(18);
            expect(saved.leverage_used).toBe(15);
            expect(saved.spread_pips).toBe(1.4);
            expect(saved.exit_reason).toBe('TRAILING_STOP');
        });

        test('should persist runtime identity fields on save', async () => {
            await repository.save(
                createMockTrade({
                    id: 'trade-runtime-save',
                    mode: 'paper_candidate',
                    runId: 'run-candidate-1',
                    ownerRunId: 'run-live-1',
                    selectionId: 'selection-1',
                    strategy: 'mean_reversion',
                })
            );

            const saved = await testDb('trades')
                .where('trade_id', 'trade-runtime-save')
                .first();
            expect(saved.mode).toBe('paper_candidate');
            expect(saved.run_id).toBe('run-candidate-1');
            expect(saved.owner_run_id).toBe('run-live-1');
            expect(saved.selection_id).toBe('selection-1');
            expect(saved.strategy).toBe('mean_reversion');
        });

        test('should throw error on duplicate trade_id', async () => {
            const trade1 = createMockTrade({ id: 'trade-dup' });
            const trade2 = createMockTrade({ id: 'trade-dup' });

            await repository.save(trade1);

            // The native addon may retain SqliteError from an earlier Jest
            // realm. Assert the actual constraint failure, not instanceof Error.
            await expect(repository.save(trade2)).rejects.toMatchObject({
                code: 'SQLITE_CONSTRAINT_UNIQUE',
                message: expect.stringContaining('UNIQUE constraint failed: trades.trade_id'),
            });
            expect(await testDb('trades').where('trade_id', 'trade-dup')).toHaveLength(1);
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

            const recent = await repository.getRecent(3);

            expect(recent).toHaveLength(3);
            expect(recent[0].id).toBe('trade-3'); // Most recent first
            expect(recent[2].id).toBe('trade-1'); // Oldest last
        });

        test('should respect limit parameter', async () => {
            for (let i = 0; i < 10; i++) {
                await repository.save(createMockTrade({ id: `trade-limit-${i}` }));
            }

            const recent = await repository.getRecent(5);

            expect(recent).toHaveLength(5);
        });

        test('should return live-mode trades only', async () => {
            await repository.save(createMockTrade({ id: 'live-trade', mode: 'live' }));
            await repository.save(createMockTrade({ id: 'legacy-paper-trade', mode: 'paper' }));

            const liveTrades = await repository.getRecent(10);

            expect(liveTrades).toHaveLength(1);
            expect(liveTrades[0].id).toBe('live-trade');
        });
    });

    describe('getOpenTrades', () => {
        test('should return only open trades', async () => {
            await repository.save(createMockTrade({ id: 'open-1', isOpen: true }));
            await repository.save(createMockTrade({ id: 'open-2', isOpen: true }));
            await repository.save(createClosedTrade({ id: 'closed-1' }));

            const openTrades = await repository.getOpenTrades();

            expect(openTrades).toHaveLength(2);
            expect(openTrades.every(t => t.isOpen)).toBe(true);
        });

        test('should return empty array when no open trades', async () => {
            await repository.save(createClosedTrade({ id: 'closed-1' }));

            const openTrades = await repository.getOpenTrades();

            expect(openTrades).toHaveLength(0);
        });
    });

    describe('getByInstrument', () => {
        test('should filter trades by instrument', async () => {
            await repository.save(createMockTrade({ id: 'aud-1', instrument: 'AUD_USD' }));
            await repository.save(createMockTrade({ id: 'eur-1', instrument: 'EUR_USD' }));
            await repository.save(createMockTrade({ id: 'aud-2', instrument: 'AUD_USD' }));

            const audTrades = await repository.getByInstrument('AUD_USD', 10);

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
            const trades = await repository.getTradesSince(cutoff);

            expect(trades).toHaveLength(1);
            expect(trades[0].id).toBe('recent');
        });

        test('should accept Date object as cutoff', async () => {
            const now = Date.now();
            const trade = createMockTrade({ id: 'test', entryTime: now });
            await repository.save(trade);

            const cutoff = new Date(now - 1000);
            const trades = await repository.getTradesSince(cutoff);

            expect(trades).toHaveLength(1);
        });
    });

    describe('getAllTrades', () => {
        test('should return all trades in ascending order', async () => {
            const now = Date.now();
            await repository.save(createMockTrade({ id: 'trade-1', entryTime: now - 3000 }));
            await repository.save(createMockTrade({ id: 'trade-2', entryTime: now - 2000 }));
            await repository.save(createMockTrade({ id: 'trade-3', entryTime: now - 1000 }));

            const trades = await repository.getAllTrades();

            expect(trades).toHaveLength(3);
            expect(trades[0].id).toBe('trade-1'); // Oldest first
            expect(trades[2].id).toBe('trade-3'); // Newest last
        });
    });

    describe('getRecentByActivity', () => {
        test('should return bounded trades ordered by exit time then entry time', async () => {
            const now = Date.now();
            await repository.save(createClosedTrade({
                id: 'older-close',
                entryTime: now - 5000,
                exitTime: now - 4000,
            }));
            await repository.save(createMockTrade({
                id: 'open-recent',
                entryTime: now - 1000,
                exitTime: null,
            }));
            await repository.save(createClosedTrade({
                id: 'newer-close',
                entryTime: now - 3000,
                exitTime: now - 500,
            }));

            const trades = await repository.getRecentByActivity(2);

            expect(trades).toHaveLength(2);
            expect(trades[0].id).toBe('newer-close');
            expect(trades[1].id).toBe('open-recent');
        });
    });

    describe('getTradeSummary', () => {
        test('should calculate counts and realized P/L in SQL', async () => {
            await repository.save(createClosedTrade({ id: 'summary-win', pnlAud: 5, pnlPips: 20 }));
            await repository.save(createLosingTrade({ id: 'summary-loss', pnlAud: -2, pnlPips: -10 }));
            await repository.save(createClosedTrade({ id: 'summary-flat', pnlAud: 0, pnlPips: 0 }));
            await repository.save(createMockTrade({ id: 'summary-open', isOpen: true }));

            const summary = await repository.getTradeSummary();

            expect(summary).toEqual(
                expect.objectContaining({
                    totalTrades: 4,
                    openTradeCount: 1,
                    closedTradeCount: 3,
                    winningTrades: 1,
                    losingTrades: 1,
                    flatTrades: 1,
                    realizedPnlAud: 3,
                    realizedPnlPips: 10,
                })
            );
        });

        test('should honor runtime owner filters', async () => {
            await repository.save(createClosedTrade({
                id: 'summary-run-a',
                pnlAud: 5,
                mode: 'paper_candidate',
                runId: 'run-a',
                ownerRunId: 'run-a',
            }));
            await repository.save(createClosedTrade({
                id: 'summary-run-b',
                pnlAud: 7,
                mode: 'paper_candidate',
                runId: 'run-b',
                ownerRunId: 'run-b',
            }));

            const summary = await repository.getTradeSummary({
                mode: 'paper_candidate',
                ownerRunId: 'run-a',
            });

            expect(summary.totalTrades).toBe(1);
            expect(summary.realizedPnlAud).toBe(5);
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

        test('should update exit valuation and holding metrics', async () => {
            const trade = createMockTrade({ id: 'trade-close-metrics' });
            await repository.save(trade);

            await repository.updateTrade('trade-close-metrics', {
                exitValueAud: 928.43,
                pnlPercent: 2.75,
                holdingPeriodMs: 3600000,
                takeProfitPrice: 1.16918,
            });

            const updated = await testDb('trades')
                .where('trade_id', 'trade-close-metrics')
                .first();
            expect(updated.exit_value_aud).toBe(928.43);
            expect(updated.pnl_percent).toBe(2.75);
            expect(updated.holding_period_ms).toBe(3600000);
            expect(updated.take_profit_price).toBe(1.16918);
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

        test('should persist and map reconciliation and stop-state telemetry fields', async () => {
            const trade = createMockTrade({
                id: 'trade-telemetry-fields',
                lowestPrice: 1.1628,
                breakevenHit: true,
                activeStopType: 'BREAKEVEN',
                closePriceSource: 'BROKER_CLOSE',
                reconciliationStatus: 'RECONCILED',
                brokerExitReason: 'STOP_LOSS_ORDER_FILLED',
                brokerClosedAt: 1710000000000,
                lastBrokerSyncAt: 1710000001000,
                configHash: 'cfg-telemetry',
                brokerReconciliationPayload: {
                    trade: { id: '489', state: 'CLOSED' },
                },
            });
            await repository.save(trade);

            await repository.updateTrade('trade-telemetry-fields', {
                activeStopType: 'TRAILING',
                closePriceSource: 'ACTIVE_STOP_FALLBACK',
                reconciliationStatus: 'UNRESOLVED',
                brokerExitReason: 'BROKER_REPORTED_CLOSED',
                brokerClosedAt: 1710000002000,
                lastBrokerSyncAt: 1710000003000,
                brokerReconciliationPayload: {
                    error: 'lookup failed',
                },
            });

            const [mappedTrade] = await repository.getOpenTrades();
            expect(mappedTrade).toEqual(
                expect.objectContaining({
                    lowestPrice: 1.1628,
                    breakevenHit: true,
                    activeStopType: 'TRAILING',
                    closePriceSource: 'ACTIVE_STOP_FALLBACK',
                    reconciliationStatus: 'UNRESOLVED',
                    brokerExitReason: 'BROKER_REPORTED_CLOSED',
                    brokerClosedAt: 1710000002000,
                    lastBrokerSyncAt: 1710000003000,
                    configHash: 'cfg-telemetry',
                    brokerReconciliationPayload: {
                        error: 'lookup failed',
                    },
                })
            );
        });

        test('SQLite reload preserves the v3 owner, original risk, executable peak and pending protection independently of the moving stop', async () => {
            const ownerExitPolicy = buildOwnerRunExitPolicy({ ownerRunId: 'h4-peak-owner', config: {
                strategy: 'multi_day_trend', liveReleaseVersion: 'h4-channel-v2',
                executionPolicyVersion: 'h4-channel-risk-v2', enablePeakProfitTrail: true,
                peakProfitTrailActivationRiskMultiple: 1, peakProfitTrailRiskMultiple: 0.5,
            } });
            expect(ownerExitPolicy.version).toBe(3);
            const liveRuntime = { initialStopLossPrice: 157.762, initialStopDistance: 0.721, ownerExitPolicy };
            await repository.save(createMockTrade({ id: 'h4-durable-peak', oandaTradeId: '3550',
                instrument: 'USD_JPY', side: 'SELL', units: 28, entryPrice: 157.041,
                stopLossPrice: 157.762, activeStopType: 'INITIAL', ownerRunId: 'h4-peak-owner',
                strategy: 'multi_day_trend', brokerReconciliationPayload: { liveRuntime } }));
            const peakProfitTrail = { version: 1, peakPrice: 156.085,
                observedAt: 1792715965490, quoteEventAt: 1792715963490 };
            const stopUpdate = { status: 'RETRY_PENDING', desiredPrice: 156.446,
                stopType: 'PEAK_PROFIT', nextRetryAt: 1792715970490,
                localUpdates: { trailingStopPrice: 156.446 } };
            await repository.updateTrade('h4-durable-peak', { reconciliationStatus: 'STOP_UPDATE_RETRY_PENDING',
                brokerReconciliationPayload: { liveRuntime, peakProfitTrail, stopUpdate } });

            const [restored] = await new TradeRepository().getOpenTrades({ ownerRunId: 'h4-peak-owner' });
            expect(restored.brokerReconciliationPayload).toEqual({ liveRuntime, peakProfitTrail, stopUpdate });
            expect(restored.reconciliationStatus).toBe('STOP_UPDATE_RETRY_PENDING');
            const restoredPolicy = resolveOwnerRunExitPolicy(restored, { strategy: 'intraday_momentum' });
            expect(restoredPolicy).toEqual(ownerExitPolicy);
            expect(evaluatePeakProfitTrail({ trade: restored, policy: restoredPolicy,
                runtimeMetadata: restored.brokerReconciliationPayload.liveRuntime,
                peakPrice: restored.brokerReconciliationPayload.peakProfitTrail.peakPrice }).stopLossPrice).toBeCloseTo(156.4455);

            await repository.updateTrade(restored.id, { stopLossPrice: 156.446, trailingStopPrice: 156.446,
                activeStopType: 'PEAK_PROFIT', reconciliationStatus: 'OPEN',
                brokerReconciliationPayload: { ...restored.brokerReconciliationPayload, stopUpdate: null } });
            const [confirmed] = await new TradeRepository().getOpenTrades({ ownerRunId: 'h4-peak-owner' });
            expect(confirmed).toMatchObject({ stopLossPrice: 156.446, trailingStopPrice: 156.446,
                activeStopType: 'PEAK_PROFIT', reconciliationStatus: 'OPEN',
                brokerReconciliationPayload: { liveRuntime, peakProfitTrail, stopUpdate: null } });
            expect(confirmed.brokerReconciliationPayload.liveRuntime.initialStopDistance).toBe(0.721);
        });

        test('should update runtime identity fields', async () => {
            await repository.save(createMockTrade({ id: 'trade-runtime-update' }));

            await repository.updateTrade('trade-runtime-update', {
                runId: 'run-live-2',
                ownerRunId: 'run-live-2',
                selectionId: 'selection-2',
                strategy: 'supertrend_momentum',
            });

            const updated = await testDb('trades')
                .where('trade_id', 'trade-runtime-update')
                .first();
            expect(updated.run_id).toBe('run-live-2');
            expect(updated.owner_run_id).toBe('run-live-2');
            expect(updated.selection_id).toBe('selection-2');
            expect(updated.strategy).toBe('supertrend_momentum');
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

            const metrics = await repository.getPerformanceMetrics('7d');

            expect(metrics.totalTrades).toBe(3);
            expect(metrics.winningTrades).toBe(2);
            expect(metrics.losingTrades).toBe(1);
            expect(metrics.winRate).toBeCloseTo(66.67, 1);
            expect(metrics.totalPnLAud).toBeCloseTo(6.00, 1);
        });

        test('should return null when no trades', async () => {
            const metrics = await repository.getPerformanceMetrics('7d');
            expect(metrics).toBeNull();
        });

        test('should exclude open trades from metrics', async () => {
            await repository.save(createClosedTrade({ id: 'closed', pnlAud: 5.00, entryTime: Date.now() - 1000 }));
            await repository.save(createMockTrade({ id: 'open', isOpen: true, entryTime: Date.now() - 1000 }));

            const metrics = await repository.getPerformanceMetrics('7d');

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
