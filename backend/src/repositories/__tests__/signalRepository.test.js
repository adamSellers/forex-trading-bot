// Tests for SignalRepository - Signal database operations
const SignalRepository = require('../signalRepository');

// Store reference to test database for mock
let mockTestDbInstance = null;

// Mock the database module
jest.mock('../../../config/database', () => ({
    db: new Proxy(function() {}, {
        apply: (target, thisArg, args) => {
            if (mockTestDbInstance) {
                return mockTestDbInstance(args[0]);
            }
            throw new Error('Database not initialized');
        },
        get: (target, prop) => {
            if (mockTestDbInstance && mockTestDbInstance[prop]) {
                return typeof mockTestDbInstance[prop] === 'function'
                    ? mockTestDbInstance[prop].bind(mockTestDbInstance)
                    : mockTestDbInstance[prop];
            }
            return undefined;
        },
    }),
}));

describe('SignalRepository', () => {
    let repository;

    beforeEach(() => {
        repository = new SignalRepository();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // Retention methods delete/update via batched whereIn-id-subquery chains:
    // db('signals').whereIn('id', db('signals').select('id').where(...).limit(n)).del()
    // The mock builder below records the chain and returns per-batch results
    // so the loop accumulation/termination logic is what gets verified here.
    const makeBatchBuilder = (batchResults) => {
        const builder = {
            capturedWhere: null,
            capturedLimit: null,
            whereNotNullCalls: [],
        };
        builder.select = jest.fn(() => builder);
        builder.where = jest.fn((column, op, value) => {
            builder.capturedWhere = { column, op, value };
            return builder;
        });
        builder.whereNotNull = jest.fn((column) => {
            builder.whereNotNullCalls.push(column);
            return builder;
        });
        builder.limit = jest.fn((n) => {
            builder.capturedLimit = n;
            return builder;
        });
        builder.whereIn = jest.fn(() => builder);
        builder.del = jest.fn(() => {
            const next = batchResults.shift();
            return next instanceof Error
                ? Promise.reject(next)
                : Promise.resolve(next ?? 0);
        });
        builder.update = jest.fn(() => {
            const next = batchResults.shift();
            return next instanceof Error
                ? Promise.reject(next)
                : Promise.resolve(next ?? 0);
        });
        return builder;
    };

    describe('deleteOlderThan', () => {
        test('should delete signals older than specified days', async () => {
            const builder = makeBatchBuilder([5]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(5);
            expect(mockTestDbInstance).toHaveBeenCalledWith('signals');
            expect(builder.capturedWhere).toEqual({
                column: 'timestamp',
                op: '<',
                value: expect.any(Number),
            });
            expect(builder.whereIn).toHaveBeenCalledWith('id', builder);
            expect(builder.del).toHaveBeenCalledTimes(1);
        });

        test('should calculate correct cutoff date for 90 days', async () => {
            const builder = makeBatchBuilder([0]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const now = Date.now();
            await repository.deleteOlderThan(90);

            // Cutoff should be approximately 90 days ago (timestamp in ms)
            const expectedCutoff = now - 90 * 24 * 60 * 60 * 1000;

            // Allow 1 second tolerance for test execution time
            expect(
                Math.abs(builder.capturedWhere.value - expectedCutoff)
            ).toBeLessThan(1000);
        });

        test('should loop batches until a batch comes back short', async () => {
            // Two full batches then a short one -> three delete calls total
            const builder = makeBatchBuilder([5000, 5000, 123]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const deleted = await repository.deleteOlderThan(30);

            expect(deleted).toBe(10123);
            expect(builder.del).toHaveBeenCalledTimes(3);
            expect(builder.capturedLimit).toBe(5000);
        });

        test('should respect a custom batchSize', async () => {
            const builder = makeBatchBuilder([2, 1]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const deleted = await repository.deleteOlderThan(30, { batchSize: 2 });

            expect(deleted).toBe(3);
            expect(builder.del).toHaveBeenCalledTimes(2);
            expect(builder.capturedLimit).toBe(2);
        });

        test('should return 0 when no signals deleted', async () => {
            const builder = makeBatchBuilder([0]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(0);
        });

        test('should handle database errors gracefully', async () => {
            const builder = makeBatchBuilder([new Error('DB connection failed')]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const deleted = await repository.deleteOlderThan(90);

            // Should return 0 on error, not throw
            expect(deleted).toBe(0);
        });
    });

    describe('clearTimesFmContextOlderThan', () => {
        test('should null context on rows older than the cutoff', async () => {
            const builder = makeBatchBuilder([4]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const now = Date.now();
            const cleared = await repository.clearTimesFmContextOlderThan(7);

            expect(cleared).toBe(4);
            // Only rows that still have context are targeted
            expect(builder.whereNotNullCalls).toContain('timesfm_context');
            expect(builder.update).toHaveBeenCalledWith({ timesfm_context: null });
            const expectedCutoff = now - 7 * 24 * 60 * 60 * 1000;
            expect(
                Math.abs(builder.capturedWhere.value - expectedCutoff)
            ).toBeLessThan(1000);
        });

        test('should loop batches until a batch comes back short', async () => {
            const builder = makeBatchBuilder([2, 2, 1]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const cleared = await repository.clearTimesFmContextOlderThan(7, {
                batchSize: 2,
            });

            expect(cleared).toBe(5);
            expect(builder.update).toHaveBeenCalledTimes(3);
        });

        test('should handle database errors gracefully', async () => {
            const builder = makeBatchBuilder([new Error('DB connection failed')]);
            mockTestDbInstance = jest.fn().mockReturnValue(builder);

            const cleared = await repository.clearTimesFmContextOlderThan(7);

            expect(cleared).toBe(0);
        });
    });

    describe('save', () => {
        test('should save valid signal to database', async () => {
            const mockInsert = jest.fn().mockResolvedValue([1]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            const signal = {
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 25.5,
                strategy: 'supertrend_momentum',
                timeframe: '15m',
                currentPrice: 1.16571,
                message: 'BUY signal',
                atr: 0.0015,
                trend: { rsi: 55, adx: 25.5 },
                timestamp: Date.now(),
            };

            await repository.save(signal);

            expect(mockInsert).toHaveBeenCalled();
        });

        test('should persist structured telemetry fields and cooldown metadata', async () => {
            const mockInsert = jest.fn().mockResolvedValue([1]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            await repository.save({
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 31.2,
                strategy: 'supertrend_momentum',
                timeframe: '15m',
                currentPrice: 1.16571,
                message: 'BUY signal',
                atrPips: 12.4,
                trend: {
                    rsi: 61.5,
                    adx: 31.2,
                    supertrend_direction: 1,
                },
                entryType: 'FRESH_FLIP',
                timestamp: 1710000000123,
                reasonCode: 'TREND_CONFIRMED',
                signalClass: 'ACTIONABLE',
                intent: 'ENTER_LONG',
                setupId: 'setup-123',
                signalCandleTime: '1710000000000',
                uniqueEvent: true,
                cooldownSuppressed: false,
                pendingState: {
                    direction: 'LONG',
                    state: 'AWAIT_PULLBACK',
                    waitingFor: 'PULLBACK',
                },
                configHash: 'cfg-123',
                decisionContext: {
                    htfAligned: true,
                    momentumSlope: 'rising',
                },
                timesFm: {
                    available: true,
                    direction: 'BULLISH',
                    confidence: 0.82,
                    volatilityRegime: 'NORMAL',
                },
            });

            expect(mockInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    instrument: 'AUD_USD',
                    signal: 'BUY',
                    reason_code: 'TREND_CONFIRMED',
                    signal_class: 'ACTIONABLE',
                    intent: 'ENTER_LONG',
                    setup_id: 'setup-123',
                    signal_candle_time: 1710000000000,
                    unique_event: true,
                    cooldown_suppressed: false,
                    pending_direction: 'LONG',
                    pending_state: 'AWAIT_PULLBACK',
                    pending_waiting_for: 'PULLBACK',
                    config_hash: 'cfg-123',
                })
            );
            expect(mockInsert.mock.calls[0][0].decision_context).toBe(
                JSON.stringify({
                    htfAligned: true,
                    momentumSlope: 'rising',
                })
            );
            expect(mockInsert.mock.calls[0][0].timesfm_context).toBe(
                JSON.stringify({
                    available: true,
                    direction: 'BULLISH',
                    confidence: 0.82,
                    volatilityRegime: 'NORMAL',
                })
            );
        });

        test('should persist runtime identity fields when provided', async () => {
            const mockInsert = jest.fn().mockResolvedValue([1]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            await repository.save({
                symbol: 'AUD_USD',
                signal: 'BUY',
                strength: 31.2,
                strategy: 'supertrend_momentum',
                timeframe: '15m',
                mode: 'paper_shadow',
                runId: 'run-shadow-1',
                selectionId: 'selection-live-1',
                timestamp: 1710000000123,
            });

            expect(mockInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    mode: 'paper_shadow',
                    run_id: 'run-shadow-1',
                    selection_id: 'selection-live-1',
                })
            );
        });

        test('should skip invalid signals', async () => {
            const mockInsert = jest.fn().mockResolvedValue([1]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            // Missing symbol
            await repository.save({ signal: 'BUY' });
            expect(mockInsert).not.toHaveBeenCalled();

            // Missing signal type
            await repository.save({ symbol: 'AUD_USD' });
            expect(mockInsert).not.toHaveBeenCalled();

            // Null input
            await repository.save(null);
            expect(mockInsert).not.toHaveBeenCalled();
        });
    });

    describe('saveBatch', () => {
        test('should save multiple signals', async () => {
            const mockInsert = jest.fn().mockResolvedValue([1, 2]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            const signals = [
                { symbol: 'AUD_USD', signal: 'BUY', strength: 25.5, timestamp: Date.now() },
                { symbol: 'EUR_USD', signal: 'HOLD', strength: 18.2, timestamp: Date.now() },
            ];

            await repository.saveBatch(signals);

            expect(mockInsert).toHaveBeenCalled();
            const insertedRecords = mockInsert.mock.calls[0][0];
            expect(insertedRecords.length).toBe(2);
        });

        test('should filter out invalid signals in batch', async () => {
            const mockInsert = jest.fn().mockResolvedValue([1]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            const signals = [
                { symbol: 'AUD_USD', signal: 'BUY', strength: 25.5, timestamp: Date.now() },
                { symbol: null, signal: 'HOLD' }, // Invalid
                { signal: 'SELL' }, // Invalid - no symbol
            ];

            await repository.saveBatch(signals);

            expect(mockInsert).toHaveBeenCalled();
            const insertedRecords = mockInsert.mock.calls[0][0];
            expect(insertedRecords.length).toBe(1);
        });

        test('should not insert when all signals invalid', async () => {
            const mockInsert = jest.fn().mockResolvedValue([]);
            mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

            const signals = [
                { symbol: null, signal: 'BUY' },
                { symbol: 'AUD_USD' }, // Missing signal
            ];

            await repository.saveBatch(signals);

            expect(mockInsert).not.toHaveBeenCalled();
        });
    });

    describe('getSignalStats', () => {
        test('should parse period correctly', () => {
            expect(repository.parsePeriod('1h')).toBe(60 * 60 * 1000);
            expect(repository.parsePeriod('24h')).toBe(24 * 60 * 60 * 1000);
            expect(repository.parsePeriod('7d')).toBe(7 * 24 * 60 * 60 * 1000);
            expect(repository.parsePeriod('invalid')).toBe(24 * 60 * 60 * 1000); // Default
        });

        test('should calculate stats correctly', () => {
            const signals = [
                { symbol: 'AUD_USD', signal: 'BUY', strength: 25 },
                { symbol: 'AUD_USD', signal: 'HOLD', strength: 20 },
                { symbol: 'EUR_USD', signal: 'BUY', strength: 30 },
            ];

            const stats = repository.calculateSignalStats(signals);

            expect(stats.total).toBe(3);
            expect(stats.byType.BUY).toBe(2);
            expect(stats.byType.HOLD).toBe(1);
            expect(stats.byAsset.AUD_USD).toBe(2);
            expect(stats.byAsset.EUR_USD).toBe(1);
            expect(stats.averageStrength).toBe(25); // (25 + 20 + 30) / 3
        });

        test('should handle empty signals array', () => {
            const stats = repository.calculateSignalStats([]);

            expect(stats.total).toBe(0);
            expect(stats.byType).toEqual({});
            expect(stats.byAsset).toEqual({});
            expect(stats.averageStrength).toBe(0);
        });
    });

    describe('getSignalsSince', () => {
        test('should convert Date cutoffs to timestamps and map structured fields back out', async () => {
            const row = {
                id: 1,
                instrument: 'AUD_USD',
                signal: 'COOLDOWN',
                strength: 0,
                timestamp: 1710000000123,
                reason_code: 'DUPLICATE_SIGNAL',
                signal_class: 'SUPPRESSED',
                intent: 'DEFER',
                setup_id: 'setup-123',
                signal_candle_time: 1710000000000,
                unique_event: 1,
                cooldown_suppressed: 0,
                pending_direction: 'LONG',
                pending_state: 'AWAIT_PULLBACK',
                pending_waiting_for: 'PULLBACK',
                config_hash: 'cfg-123',
                run_id: 'run-live-1',
                selection_id: 'selection-live-1',
                mode: 'live',
                decision_context: JSON.stringify({
                    htfAligned: true,
                    momentumSlope: 'rising',
                }),
                timesfm_context: JSON.stringify({
                    available: true,
                    direction: 'BULLISH',
                    confidence: 0.81,
                }),
            };
            const mockOrderBy = jest.fn().mockResolvedValue([row]);
            const mockWhere = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
            mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

            const cutoff = new Date(1710000000000);
            const results = await repository.getSignalsSince(cutoff);

            expect(mockWhere).toHaveBeenCalledWith(
                'timestamp',
                '>=',
                cutoff.getTime()
            );
            expect(results).toEqual([
                expect.objectContaining({
                    symbol: 'AUD_USD',
                    reasonCode: 'DUPLICATE_SIGNAL',
                    signalClass: 'SUPPRESSED',
                    intent: 'DEFER',
                    setupId: 'setup-123',
                    signalCandleTime: 1710000000000,
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                    pendingDirection: 'LONG',
                    pendingStateCode: 'AWAIT_PULLBACK',
                    pendingState: {
                        direction: 'LONG',
                        state: 'AWAIT_PULLBACK',
                        waitingFor: 'PULLBACK',
                    },
                    pendingWaitingFor: 'PULLBACK',
                    configHash: 'cfg-123',
                    runId: 'run-live-1',
                    selectionId: 'selection-live-1',
                    mode: 'live',
                    decisionContext: {
                        htfAligned: true,
                        momentumSlope: 'rising',
                    },
                    timesFm: {
                        available: true,
                        direction: 'BULLISH',
                        confidence: 0.81,
                    },
                }),
            ]);
        });
    });
});
