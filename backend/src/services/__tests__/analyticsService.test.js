// Tests for AnalyticsService - Performance metrics and analysis
const AnalyticsService = require('../analyticsService');
const { createClosedTrade, createLosingTrade, createMockTrade } = require('../../../__tests__/fixtures/mockTrades');
const { createMockSignal, createHoldSignal, createSellSignal } = require('../../../__tests__/fixtures/mockSignals');

describe('AnalyticsService', () => {
    let service;
    let mockTradeRepo;
    let mockSignalRepo;

    beforeEach(() => {
        mockTradeRepo = {
            getTradesSince: jest.fn().mockResolvedValue([]),
        };
        mockSignalRepo = {
            getSignalsSince: jest.fn().mockResolvedValue([]),
        };
        service = new AnalyticsService(mockTradeRepo, mockSignalRepo);
    });

    describe('getAnalytics', () => {
        test('should return complete analytics object', async () => {
            const result = await service.getAnalytics('7d', 'live');

            expect(result).toHaveProperty('period', '7d');
            expect(result).toHaveProperty('mode', 'live');
            expect(result).toHaveProperty('generatedAt');
            expect(result).toHaveProperty('summary');
            expect(result).toHaveProperty('pairPerformance');
            expect(result).toHaveProperty('sessionPerformance');
            expect(result).toHaveProperty('signalAnalysis');
            expect(result).toHaveProperty('exitAnalysis');
            expect(result).toHaveProperty('equityData');
            expect(result).toHaveProperty('adxAnalysis');
            expect(result).toHaveProperty('rawCounts');
        });

        test('should filter out open trades for metrics', async () => {
            mockTradeRepo.getTradesSince.mockResolvedValue([
                createClosedTrade({ id: 'closed-1', pnlAud: 5.00 }),
                createMockTrade({ id: 'open-1', isOpen: true }),
            ]);

            const result = await service.getAnalytics('7d', 'live');

            expect(result.rawCounts.totalTrades).toBe(2);
            expect(result.rawCounts.closedTrades).toBe(1);
            expect(result.rawCounts.openTrades).toBe(1);
            expect(result.summary.totalTrades).toBe(1);
        });

        test('should handle empty data', async () => {
            const result = await service.getAnalytics('7d', 'live');

            expect(result.summary.totalTrades).toBe(0);
            expect(result.summary.winRate).toBe(0);
            expect(result.summary.totalPnLAud).toBe(0);
        });
    });

    describe('calculateSummary', () => {
        test('should calculate correct win rate', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00 }),
                createClosedTrade({ pnlAud: 3.00 }),
                createLosingTrade({ pnlAud: -2.00 }),
            ];

            const summary = service.calculateSummary(trades);

            expect(summary.totalTrades).toBe(3);
            expect(summary.winningTrades).toBe(2);
            expect(summary.losingTrades).toBe(1);
            expect(summary.winRate).toBeCloseTo(66.67, 1);
        });

        test('should calculate profit factor', () => {
            const trades = [
                createClosedTrade({ pnlAud: 10.00 }),
                createClosedTrade({ pnlAud: 5.00 }),
                createLosingTrade({ pnlAud: -3.00 }),
                createLosingTrade({ pnlAud: -2.00 }),
            ];

            const summary = service.calculateSummary(trades);

            // Gross win = 15, Gross loss = 5
            // Profit factor = 15 / 5 = 3.0
            expect(summary.profitFactor).toBe(3.0);
        });

        test('should calculate average P/L correctly', () => {
            const trades = [
                createClosedTrade({ pnlAud: 10.00, pnlPips: 50 }),
                createClosedTrade({ pnlAud: 6.00, pnlPips: 30 }),
                createLosingTrade({ pnlAud: -4.00, pnlPips: -20 }),
            ];

            const summary = service.calculateSummary(trades);

            expect(summary.totalPnLAud).toBe(12.00);
            expect(summary.avgPnLAud).toBe(4.00); // 12 / 3
            expect(summary.avgWinAud).toBe(8.00); // (10 + 6) / 2
            expect(summary.avgLossAud).toBe(4.00); // abs(-4) / 1
        });

        test('should find largest win and loss', () => {
            const trades = [
                createClosedTrade({ pnlAud: 10.00 }),
                createClosedTrade({ pnlAud: 3.00 }),
                createLosingTrade({ pnlAud: -5.00 }),
                createLosingTrade({ pnlAud: -2.00 }),
            ];

            const summary = service.calculateSummary(trades);

            expect(summary.largestWinAud).toBe(10.00);
            expect(summary.largestLossAud).toBe(-5.00);
        });

        test('should calculate average holding time', () => {
            const trades = [
                createClosedTrade({ holdingPeriodMs: 3600000 }), // 1 hour
                createClosedTrade({ holdingPeriodMs: 7200000 }), // 2 hours
            ];

            const summary = service.calculateSummary(trades);

            expect(summary.avgHoldingTimeMs).toBe(5400000); // 1.5 hours
        });

        test('should return zeros for empty trades', () => {
            const summary = service.calculateSummary([]);

            expect(summary.totalTrades).toBe(0);
            expect(summary.winRate).toBe(0);
            expect(summary.profitFactor).toBe(0);
            expect(summary.avgPnLAud).toBe(0);
        });

        test('should handle profit factor with no losses', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00 }),
                createClosedTrade({ pnlAud: 3.00 }),
            ];

            const summary = service.calculateSummary(trades);

            expect(summary.profitFactor).toBe(999); // No losses = infinite profit factor
        });
    });

    describe('calculateSharpeRatio', () => {
        test('should return 0 for insufficient data', () => {
            const trades = [createClosedTrade()];

            const sharpe = service.calculateSharpeRatio(trades);

            expect(sharpe).toBe(0);
        });

        test('should calculate positive Sharpe for consistent profits', () => {
            const now = Date.now();
            const trades = [
                createClosedTrade({ pnlAud: 5.00, exitTime: now - 86400000 * 4 }),
                createClosedTrade({ pnlAud: 6.00, exitTime: now - 86400000 * 3 }),
                createClosedTrade({ pnlAud: 4.00, exitTime: now - 86400000 * 2 }),
                createClosedTrade({ pnlAud: 5.50, exitTime: now - 86400000 }),
            ];

            const sharpe = service.calculateSharpeRatio(trades);

            expect(sharpe).toBeGreaterThan(0);
        });
    });

    describe('calculatePairPerformance', () => {
        test('should group trades by instrument', () => {
            const trades = [
                createClosedTrade({ instrument: 'AUD_USD', pnlAud: 5.00 }),
                createClosedTrade({ instrument: 'AUD_USD', pnlAud: 3.00 }),
                createClosedTrade({ instrument: 'EUR_USD', pnlAud: -2.00 }),
            ];

            const performance = service.calculatePairPerformance(trades);

            const audStats = performance.find(p => p.instrument === 'AUD_USD');
            const eurStats = performance.find(p => p.instrument === 'EUR_USD');

            expect(audStats.totalTrades).toBe(2);
            expect(audStats.totalPnLAud).toBe(8.00);
            expect(audStats.wins).toBe(2);
            expect(audStats.winRate).toBe(100);

            expect(eurStats.totalTrades).toBe(1);
            expect(eurStats.totalPnLAud).toBe(-2.00);
            expect(eurStats.losses).toBe(1);
        });

        test('should track best and worst trades per pair', () => {
            const trades = [
                createClosedTrade({ instrument: 'AUD_USD', pnlAud: 10.00 }),
                createClosedTrade({ instrument: 'AUD_USD', pnlAud: 2.00 }),
                createLosingTrade({ instrument: 'AUD_USD', pnlAud: -3.00 }),
            ];

            const performance = service.calculatePairPerformance(trades);
            const audStats = performance.find(p => p.instrument === 'AUD_USD');

            expect(audStats.bestTradeAud).toBe(10.00);
            expect(audStats.worstTradeAud).toBe(-3.00);
        });

        test('should calculate average signal strength', () => {
            const trades = [
                createClosedTrade({ instrument: 'AUD_USD', signalStrength: 25 }),
                createClosedTrade({ instrument: 'AUD_USD', signalStrength: 30 }),
            ];

            const performance = service.calculatePairPerformance(trades);
            const audStats = performance.find(p => p.instrument === 'AUD_USD');

            expect(audStats.avgSignalStrength).toBe(27.5);
        });
    });

    describe('calculateSessionPerformance', () => {
        test('should categorize trades by trading session', () => {
            const trades = [
                // Sydney session (21:00-06:00 UTC)
                createClosedTrade({
                    entryTime: new Date('2026-01-20T22:00:00Z').getTime(),
                    pnlAud: 5.00,
                }),
                // London session (07:00-16:00 UTC)
                createClosedTrade({
                    entryTime: new Date('2026-01-20T10:00:00Z').getTime(),
                    pnlAud: 3.00,
                }),
                // New York session (12:00-21:00 UTC)
                createClosedTrade({
                    entryTime: new Date('2026-01-20T14:00:00Z').getTime(),
                    pnlAud: -2.00,
                }),
            ];

            const performance = service.calculateSessionPerformance(trades);

            expect(performance.length).toBeGreaterThan(0);
            // Verify structure
            performance.forEach(session => {
                expect(session).toHaveProperty('session');
                expect(session).toHaveProperty('trades');
                expect(session).toHaveProperty('wins');
                expect(session).toHaveProperty('pnlAud');
                expect(session).toHaveProperty('winRate');
            });
        });

        test('should only include sessions with trades', () => {
            const trades = [
                createClosedTrade({
                    entryTime: new Date('2026-01-20T14:00:00Z').getTime(), // NY session
                    pnlAud: 5.00,
                }),
            ];

            const performance = service.calculateSessionPerformance(trades);

            // Should only have sessions with trades
            expect(performance.every(s => s.trades > 0)).toBe(true);
        });
    });

    describe('calculateSignalAnalysis', () => {
        test('should count triggered vs filtered signals', () => {
            const signals = [
                createMockSignal({ signal: 'BUY' }),
                createMockSignal({ signal: 'BUY' }),
                createHoldSignal({ message: 'ADX too low - filtered' }),
                createHoldSignal({ message: 'RSI overbought' }),
            ];

            const analysis = service.calculateSignalAnalysis(signals);

            expect(analysis.total).toBe(4);
            expect(analysis.triggered).toBe(2);
        });

        test('should categorize filter reasons', () => {
            const signals = [
                createHoldSignal({ message: 'choppy market' }),
                createHoldSignal({ message: 'weak ADX trend' }),
                createHoldSignal({ message: 'RSI overbought' }),
                createHoldSignal({ message: 'HOLD - waiting' }),
            ];

            const analysis = service.calculateSignalAnalysis(signals);

            expect(analysis.filteredChoppy).toBeGreaterThanOrEqual(1);
            expect(analysis.filterBreakdown).toBeDefined();
            expect(Array.isArray(analysis.filterBreakdown)).toBe(true);
        });

        test('should count signals by type and pair', () => {
            const signals = [
                createMockSignal({ signal: 'BUY', symbol: 'AUD_USD' }),
                createMockSignal({ signal: 'BUY', symbol: 'EUR_USD' }),
                createSellSignal({ symbol: 'AUD_USD' }),
            ];

            const analysis = service.calculateSignalAnalysis(signals);

            expect(analysis.byType['BUY']).toBe(2);
            expect(analysis.byType['SELL']).toBe(1);
            expect(analysis.byPair['AUD_USD']).toBe(2);
            expect(analysis.byPair['EUR_USD']).toBe(1);
        });

        test('should calculate average signal strength', () => {
            const signals = [
                createMockSignal({ strength: 25 }),
                createMockSignal({ strength: 30 }),
                createMockSignal({ strength: 28 }),
            ];

            const analysis = service.calculateSignalAnalysis(signals);

            expect(analysis.avgStrength).toBeCloseTo(27.67, 1);
        });
    });

    describe('calculateExitAnalysis', () => {
        test('should count exit reasons', () => {
            const trades = [
                createClosedTrade({ exitReason: 'TAKE_PROFIT' }),
                createClosedTrade({ exitReason: 'TAKE_PROFIT' }),
                createLosingTrade({ exitReason: 'STOP_LOSS' }),
                createClosedTrade({ exitReason: 'SIGNAL_REVERSAL' }),
            ];

            const analysis = service.calculateExitAnalysis(trades);

            expect(analysis.total).toBe(4);
            expect(analysis.breakdown.length).toBeGreaterThan(0);

            const tpBreakdown = analysis.breakdown.find(b => b.reason === 'Take Profit');
            expect(tpBreakdown.count).toBe(2);
            expect(tpBreakdown.percentage).toBe(50);
        });

        test('should sort breakdown by count descending', () => {
            const trades = [
                createClosedTrade({ exitReason: 'TAKE_PROFIT' }),
                createClosedTrade({ exitReason: 'TAKE_PROFIT' }),
                createClosedTrade({ exitReason: 'TAKE_PROFIT' }),
                createLosingTrade({ exitReason: 'STOP_LOSS' }),
                createClosedTrade({ exitReason: 'MANUAL' }),
            ];

            const analysis = service.calculateExitAnalysis(trades);

            expect(analysis.breakdown[0].reason).toBe('Take Profit');
            expect(analysis.breakdown[0].count).toBe(3);
        });

        test('should handle unknown exit reasons', () => {
            const trades = [
                createClosedTrade({ exitReason: null }),
                createClosedTrade({ exitReason: undefined }),
            ];

            const analysis = service.calculateExitAnalysis(trades);

            const unknown = analysis.breakdown.find(b => b.reason === 'Unknown');
            expect(unknown).toBeDefined();
        });
    });

    describe('calculateEquityData', () => {
        test('should calculate cumulative equity curve', () => {
            const now = Date.now();
            const trades = [
                createClosedTrade({ pnlAud: 5.00, exitTime: now - 3000 }),
                createClosedTrade({ pnlAud: -2.00, exitTime: now - 2000 }),
                createClosedTrade({ pnlAud: 3.00, exitTime: now - 1000 }),
            ];

            const equityData = service.calculateEquityData(trades);

            expect(equityData.equityCurve.length).toBe(3);
            expect(equityData.equityCurve[0].pnlAud).toBe(5.00);
            expect(equityData.equityCurve[1].pnlAud).toBe(3.00); // 5 - 2
            expect(equityData.equityCurve[2].pnlAud).toBe(6.00); // 5 - 2 + 3
        });

        test('should aggregate daily P/L', () => {
            const day1 = new Date('2026-01-19T10:00:00Z').getTime();
            const day2 = new Date('2026-01-20T10:00:00Z').getTime();

            const trades = [
                createClosedTrade({ pnlAud: 5.00, exitTime: day1, pnlPips: 25 }),
                createClosedTrade({ pnlAud: 3.00, exitTime: day1, pnlPips: 15 }),
                createClosedTrade({ pnlAud: -2.00, exitTime: day2, pnlPips: -10 }),
            ];

            const equityData = service.calculateEquityData(trades);

            expect(equityData.dailyPnL.length).toBe(2);

            const day1Stats = equityData.dailyPnL.find(d => d.date === '2026-01-19');
            expect(day1Stats.pnlAud).toBe(8.00);
            expect(day1Stats.trades).toBe(2);
        });

        test('should sort equity curve by exit time', () => {
            const now = Date.now();
            const trades = [
                createClosedTrade({ pnlAud: 1.00, exitTime: now - 1000, id: 'late' }),
                createClosedTrade({ pnlAud: 2.00, exitTime: now - 3000, id: 'early' }),
                createClosedTrade({ pnlAud: 3.00, exitTime: now - 2000, id: 'middle' }),
            ];

            const equityData = service.calculateEquityData(trades);

            expect(equityData.equityCurve[0].tradeId).toBe('early');
            expect(equityData.equityCurve[1].tradeId).toBe('middle');
            expect(equityData.equityCurve[2].tradeId).toBe('late');
        });
    });

    describe('calculateAdxAnalysis', () => {
        test('should compare ADX between winners and losers', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00, signalStrength: 30 }),
                createClosedTrade({ pnlAud: 3.00, signalStrength: 28 }),
                createLosingTrade({ pnlAud: -2.00, signalStrength: 22 }),
            ];

            const analysis = service.calculateAdxAnalysis(trades);

            expect(analysis.avgAdxWinners).toBeCloseTo(29, 0);
            expect(analysis.avgAdxLosers).toBe(22);
            expect(analysis.sampleSize).toBe(3);
        });

        test('should detect positive correlation', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00, signalStrength: 35 }),
                createClosedTrade({ pnlAud: 3.00, signalStrength: 32 }),
                createLosingTrade({ pnlAud: -2.00, signalStrength: 23 }),
            ];

            const analysis = service.calculateAdxAnalysis(trades);

            // Winners have much higher ADX
            expect(analysis.correlation).toBe('positive');
        });

        test('should detect inverted correlation', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00, signalStrength: 22 }),
                createLosingTrade({ pnlAud: -3.00, signalStrength: 35 }),
                createLosingTrade({ pnlAud: -2.00, signalStrength: 30 }),
            ];

            const analysis = service.calculateAdxAnalysis(trades);

            // Losers have higher ADX - suggests ADX filter needs adjustment
            expect(analysis.correlation).toBe('inverted');
        });

        test('should return insufficient_data for no trades with ADX', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00, signalStrength: 0 }),
                createClosedTrade({ pnlAud: 3.00, signalStrength: null }),
            ];

            const analysis = service.calculateAdxAnalysis(trades);

            expect(analysis.correlation).toBe('insufficient_data');
        });

        test('should provide recommendation based on correlation', () => {
            const trades = [
                createClosedTrade({ pnlAud: 5.00, signalStrength: 30 }),
                createLosingTrade({ pnlAud: -2.00, signalStrength: 22 }),
            ];

            const analysis = service.calculateAdxAnalysis(trades);

            expect(analysis.recommendation).toBeDefined();
            expect(typeof analysis.recommendation).toBe('string');
        });
    });

    describe('Edge Cases', () => {
        test('should handle trades with missing P/L data', () => {
            const trades = [
                createClosedTrade({ pnlAud: null }),
                createClosedTrade({ pnlAud: undefined }),
                createClosedTrade({ pnlAud: 5.00 }),
            ];

            const summary = service.calculateSummary(trades);

            // Should handle gracefully
            expect(summary.totalTrades).toBe(3);
            expect(summary.totalPnLAud).toBe(5.00);
        });

        test('should handle empty signals array', () => {
            const analysis = service.calculateSignalAnalysis([]);

            expect(analysis.total).toBe(0);
            expect(analysis.avgStrength).toBe(0);
        });

        test('should handle trades without exit time', () => {
            const trades = [
                { ...createClosedTrade({ pnlAud: 5.00 }), exitTime: null, entryTime: Date.now() },
            ];

            const equityData = service.calculateEquityData(trades);

            // Should handle trades without exit time
            expect(equityData.equityCurve).toBeDefined();
        });
    });
});
