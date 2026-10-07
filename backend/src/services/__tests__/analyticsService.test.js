// Tests for AnalyticsService - Performance metrics and analysis
const AnalyticsService = require('../analyticsService');
const { createClosedTrade, createLosingTrade, createMockTrade } = require('../../../__tests__/fixtures/mockTrades');
const { createMockSignal, createHoldSignal, createSellSignal } = require('../../../__tests__/fixtures/mockSignals');

describe('AnalyticsService', () => {
    let service;
    let mockTradeRepo;
    let mockSignalRepo;
    let mockEntryDecisionRepo;

    beforeEach(() => {
        mockTradeRepo = {
            getTradesSince: jest.fn().mockResolvedValue([]),
        };
        mockSignalRepo = {
            getSignalsSince: jest.fn().mockResolvedValue([]),
            getSignalsSinceCompact: jest.fn().mockResolvedValue([]),
        };
        mockEntryDecisionRepo = {
            getDecisionsSince: jest.fn().mockResolvedValue([]),
        };
        service = new AnalyticsService(
            mockTradeRepo,
            mockSignalRepo,
            mockEntryDecisionRepo
        );
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
            expect(result).toHaveProperty('sidePerformance');
            expect(result).toHaveProperty('cohortExpectancy');
            expect(result).toHaveProperty('entryFunnel');
            expect(result).toHaveProperty('strategyFunnel');
            expect(result).toHaveProperty('rejectionBreakdown');
            expect(result).toHaveProperty('executionGapByCohort');
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

        test('reports verified excursion coverage without mixing historical or open observations', async () => {
            mockTradeRepo.getTradesSince.mockResolvedValue([
                createClosedTrade({ brokerReconciliationPayload: JSON.stringify({ sampledExcursion: {
                    version: 2, lifetimeStatus: 'VERIFIED', observations: 3, maxFavorableR: 1.25, maxAdverseR: 0.5,
                } }) }),
                createClosedTrade({ brokerReconciliationPayload: { sampledExcursion: {
                    version: 1, observations: 10, maxFavorableR: 99, maxAdverseR: 99,
                } } }),
                createMockTrade({ brokerReconciliationPayload: { sampledExcursion: {
                    version: 2, lifetimeStatus: 'PROVISIONAL', observations: 2, maxFavorableR: 50, maxAdverseR: 50,
                } } }),
            ]);
            const result = await service.getAnalytics('7d', 'live');
            expect(result.excursionCoverage).toMatchObject({
                totalTrades: 2, measuredTrades: 2, verifiedTrades: 1, unverifiedTrades: 1,
                favorableRMeasuredTrades: 1, adverseRMeasuredTrades: 1,
                avgFavorableR: 1.25, avgAdverseR: 0.5,
            });
        });

        test('should handle empty data', async () => {
            const result = await service.getAnalytics('7d', 'live');

            expect(result.summary.totalTrades).toBe(0);
            expect(result.summary.winRate).toBe(0);
            expect(result.summary.totalPnLAud).toBe(0);
        });

        test('dashboard uses compact signals while retaining entry decisions and execution evidence', async () => {
            const result = await service.getAnalytics('7d', {
                mode: 'live',
                profile: 'dashboard',
            });

            expect(result.profile).toBe('dashboard');
            expect(mockSignalRepo.getSignalsSinceCompact).toHaveBeenCalledWith(
                expect.any(Number),
                expect.objectContaining({ mode: 'live' })
            );
            expect(mockSignalRepo.getSignalsSince).not.toHaveBeenCalled();
            expect(mockEntryDecisionRepo.getDecisionsSince).toHaveBeenCalled();
            expect(result).not.toHaveProperty('executionGapByCohort');
            expect(result).toHaveProperty('entryFunnel');
        });

        test('should pass a matched cutoff to repositories using their expected argument types', async () => {
            const now = new Date('2026-03-20T00:00:00.000Z').getTime();
            jest.spyOn(Date, 'now').mockReturnValue(now);

            await service.getAnalytics('24h');

            const expectedCutoff = now - 24 * 60 * 60 * 1000;
            expect(mockTradeRepo.getTradesSince).toHaveBeenCalledWith(
                expectedCutoff,
                expect.objectContaining({ mode: 'live' })
            );
            expect(mockSignalRepo.getSignalsSince).toHaveBeenCalledTimes(1);
            expect(mockEntryDecisionRepo.getDecisionsSince).toHaveBeenCalledWith(
                expectedCutoff,
                expect.objectContaining({ mode: 'live' })
            );

            const signalCutoff = mockSignalRepo.getSignalsSince.mock.calls[0][0];
            expect(signalCutoff).toBeInstanceOf(Date);
            expect(signalCutoff.getTime()).toBe(expectedCutoff);
            expect(mockSignalRepo.getSignalsSince.mock.calls[0][1]).toEqual(
                expect.objectContaining({ mode: 'live' })
            );
        });

        test('keeps run-scoped analytics on live mode', async () => {
            await service.getAnalytics('30d', {
                mode: 'retired_mode',
                runId: 'live-run-7',
                strategy: 'carry_trend',
            });

            expect(mockTradeRepo.getTradesSince).toHaveBeenCalledWith(
                expect.any(Number),
                expect.objectContaining({
                    mode: 'live',
                    ownerRunId: 'live-run-7',
                    strategy: 'carry_trend',
                })
            );
            expect(mockTradeRepo.getTradesSince.mock.calls[0][1]).not.toHaveProperty(
                'runId'
            );
            expect(mockSignalRepo.getSignalsSince).toHaveBeenCalledWith(
                expect.any(Date),
                expect.objectContaining({
                    mode: 'live',
                    runId: 'live-run-7',
                    strategy: 'carry_trend',
                })
            );
        });

        test('forces explicitly requested all-mode analytics back to live', async () => {
            const result = await service.getAnalytics('7d', {
                mode: 'all',
                strategy: 'carry_trend',
            });

            expect(mockTradeRepo.getTradesSince).toHaveBeenCalledWith(
                expect.any(Number),
                expect.objectContaining({
                    mode: 'live',
                    strategy: 'carry_trend',
                })
            );
            expect(result.mode).toBe('live');
            expect(result.filters).toEqual(
                expect.objectContaining({
                    mode: 'live',
                    strategy: 'carry_trend',
                })
            );
        });

        test('forces unscoped all-mode analytics to live', async () => {
            const result = await service.getAnalytics('7d', {
                mode: 'all',
            });

            expect(mockTradeRepo.getTradesSince).toHaveBeenCalledWith(
                expect.any(Number),
                expect.objectContaining({ mode: 'live' })
            );
            expect(mockSignalRepo.getSignalsSince).toHaveBeenCalledWith(
                expect.any(Date),
                expect.objectContaining({ mode: 'live' })
            );
            expect(result.mode).toBe('live');
            expect(result.filters.mode).toBe('live');
        });
    });

    describe('calculateSummary', () => {
        test('keeps the observed singleton result and Wilson interval without a false expectancy interval', () => {
            const trade = createClosedTrade({ pnlAud: -0.1787, pnlPips: -14.5,
                brokerReconciliationPayload: JSON.stringify({ liveRuntime: { initialRiskAud: 0.17829655 } }) });
            const summary = service.calculateSummary([trade]);
            expect(summary).toMatchObject({ totalTrades: 1, totalPnLAud: -0.1787, avgPnLAud: -0.1787,
                winRate95: { lower: 0, upper: 79.3 },
                expectancy95Aud: { lower: null, upper: null, observations: 1, samples: 0, status: 'SINGLE_OBSERVATION' },
                netR: { observations: 1, mean: -1.0023, lower95: null, upper95: null,
                    intervalStatus: 'SINGLE_OBSERVATION', intervalSamples: 0, missingRiskTrades: 0 } });
        });

        test('AUD and R interval availability use their respective observed distributions', () => {
            const summary = service.calculateSummary([
                createClosedTrade({ pnlAud: -0.2, brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.2 } } }),
                createClosedTrade({ pnlAud: -0.2, brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.4 } } }),
            ]);
            expect(summary.expectancy95Aud).toMatchObject({ lower: null, upper: null,
                samples: 0, observations: 2, status: 'NO_OBSERVED_VARIATION' });
            expect(summary.netR).toMatchObject({ observations: 2, mean: -0.75,
                intervalStatus: 'AVAILABLE', intervalSamples: 500, lower95: -1, upper95: -0.5 });
        });

        test('missing original risk reduces only R coverage, not realized net AUD totals', () => {
            const summary = service.calculateSummary([
                createClosedTrade({ pnlAud: 0.3, brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.2 } } }),
                createClosedTrade({ pnlAud: -0.1, brokerReconciliationPayload: {} }),
            ]);
            expect(summary).toMatchObject({ totalTrades: 2, totalPnLAud: 0.2, avgPnLAud: 0.1,
                expectancy95Aud: { status: 'AVAILABLE', samples: 500, observations: 2 },
                netR: { observations: 1, missingRiskTrades: 1, mean: 1.5,
                    lower95: null, upper95: null, intervalStatus: 'SINGLE_OBSERVATION' } });
        });

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
            expect(summary.winRate95.lower).toBeLessThan(summary.winRate);
            expect(summary.expectancy95Aud.samples).toBe(500);
            expect(summary.referenceCurrency).toBe('AUD');
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

        test('reports explicit costs, drawdown, streak, and concentration', () => {
            const summary = service.calculateSummary([
                createClosedTrade({
                    instrument: 'AUD_USD',
                    pnlAud: 5,
                    swapAud: -0.2,
                    commissionAud: -0.1,
                    exitTime: 1,
                }),
                createLosingTrade({
                    instrument: 'AUD_USD',
                    pnlAud: -3,
                    swapAud: -0.1,
                    exitTime: 2,
                }),
                createLosingTrade({
                    instrument: 'EUR_AUD',
                    pnlAud: -2,
                    exitTime: 3,
                }),
            ]);

            expect(summary.maxDrawdownAud).toBe(5);
            expect(summary.longestLosingStreak).toBe(2);
            expect(summary.costs.financingAud).toBeCloseTo(-0.3);
            expect(summary.concentration.topInstrument).toBe('AUD_USD');
            expect(summary.statisticalSampleAdequate).toBe(false);
        });
    });

    describe('calculateSignalAnalysis', () => {
        test('should separate actionable signals from cooldown-suppressed signals in its top-level breakdown', () => {
            const signals = [
                createMockSignal({
                    signalClass: 'ACTIONABLE',
                    intent: 'ENTER_LONG',
                    reasonCode: 'LONG_FRESH_FLIP_ACTIONABLE',
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                }),
                createSellSignal({
                    entryType: 'EXIT_ONLY',
                    signalClass: 'EXIT_ONLY',
                    intent: 'EXIT_LONG_ONLY',
                    reasonCode: 'SHORT_FRESH_FLIP_BLOCKED_HTF',
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                }),
                createMockSignal({
                    signal: 'COOLDOWN',
                    signalClass: 'COOLDOWN',
                    intent: 'ENTER_LONG',
                    reasonCode: 'COOLDOWN_DUPLICATE_CANDLE',
                    uniqueEvent: false,
                    cooldownSuppressed: true,
                }),
                createHoldSignal({
                    signalClass: 'PENDING',
                    intent: 'WAIT',
                    reasonCode: 'LONG_PULLBACK_WAIT',
                }),
            ];

            const analysis = service.calculateSignalAnalysis(signals);

            expect(analysis.actionableTotal).toBe(1);
            expect(analysis.actionableUnique).toBe(1);
            expect(analysis.triggered).toBe(1);
            expect(analysis.exitOnlyTotal).toBe(1);
            expect(analysis.exitOnlyUnique).toBe(1);
            expect(analysis.cooldownDuplicates).toBe(1);
            expect(analysis.pending).toBe(1);
            expect(analysis.filterBreakdown).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        label: 'Triggered',
                        value: 1,
                    }),
                    expect.objectContaining({
                        label: 'Exit Only',
                        value: 1,
                    }),
                    expect.objectContaining({
                        label: 'Cooldown Duplicates',
                        value: 1,
                    }),
                ])
            );
        });

        test('deduplicates repeated closed-candle decisions and does not label market state as an ADX rejection', () => {
            const signalCandleTime = Date.parse('2026-08-03T10:15:00Z');
            const baseState = createHoldSignal({
                symbol: 'EUR_USD',
                signalClass: 'INFO',
                intent: 'WAIT',
                reasonCode: 'BASE_TREND_STATE',
                signalCandleTime,
                uniqueEvent: true,
                message: 'Base trend state | ADX 24.2 | RSI 55.0',
            });
            const analysis = service.calculateSignalAnalysis([
                baseState,
                { ...baseState, timestamp: baseState.timestamp + 60_000 },
            ]);

            expect(analysis.rawTotal).toBe(2);
            expect(analysis.decisionTotal).toBe(1);
            expect(analysis.marketState).toBe(1);
            expect(analysis.filteredChoppy).toBe(0);
            expect(analysis.pending).toBe(0);
            expect(analysis.decisionFunnel.summary).toEqual(
                expect.objectContaining({
                    rawObservations: 2,
                    uniqueStrategyDecisions: 1,
                    marketState: 1,
                })
            );
        });

        test('deduplicates actionable events even when every persisted poll row says uniqueEvent', () => {
            const signalCandleTime = Date.parse('2026-08-03T10:15:00Z');
            const actionable = createMockSignal({
                signalClass: 'ACTIONABLE',
                intent: 'ENTER_LONG',
                reasonCode: 'LONG_ENTRY_ACTIONABLE',
                signalCandleTime,
                uniqueEvent: true,
            });
            const analysis = service.calculateSignalAnalysis([
                actionable,
                { ...actionable, timestamp: actionable.timestamp + 60_000 },
            ]);

            expect(analysis.actionableTotal).toBe(2);
            expect(analysis.actionableUnique).toBe(1);
            expect(analysis.triggered).toBe(1);
        });
    });

    describe('entry decision analytics', () => {
        test('should calculate entry funnel and rejection breakdown from entry decisions', () => {
            const signals = [
                createMockSignal({
                    symbol: 'GBP_USD',
                    signalClass: 'ACTIONABLE',
                    intent: 'ENTER_LONG',
                    reasonCode: 'LONG_FRESH_FLIP_ACTIONABLE',
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    selectionId: 'selection-1',
                }),
                createMockSignal({
                    symbol: 'EUR_USD',
                    signalClass: 'ACTIONABLE',
                    intent: 'ENTER_LONG',
                    entryType: 'HTF_CONFIRMATION',
                    reasonCode: 'LONG_HTF_CONFIRMED_ENTRY',
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    selectionId: 'selection-1',
                }),
            ];
            const summary = service.extractSignalEventSummary(signals);
            const entryDecisions = [
                {
                    instrument: 'GBP_USD',
                    side: 'BUY',
                    signal: 'BUY',
                    entryType: 'FRESH_FLIP',
                    configHash: 'cfg-1',
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    selectionId: 'selection-1',
                    stage: 'REJECTED',
                    outcome: 'REJECTED',
                    rejectionCode: 'SPREAD_TOO_WIDE',
                    spreadPips: 1.7,
                },
                {
                    instrument: 'EUR_USD',
                    side: 'BUY',
                    signal: 'BUY',
                    entryType: 'HTF_CONFIRMATION',
                    configHash: 'cfg-1',
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    selectionId: 'selection-1',
                    stage: 'FILLED',
                    outcome: 'FILLED',
                    tradeId: 'trade-1',
                },
            ];
            const closedTrades = [
                createClosedTrade({
                    instrument: 'EUR_USD',
                    entryType: 'HTF_CONFIRMATION',
                    configHash: 'cfg-1',
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    ownerRunId: 'run-live-1',
                    selectionId: 'selection-1',
                }),
            ];

            const funnel = service.calculateEntryFunnel(
                summary.uniqueActionableSignals,
                entryDecisions,
                closedTrades
            );
            const rejectionBreakdown =
                service.calculateRejectionBreakdown(entryDecisions);
            const executionGap = service.calculateExecutionGapByCohort(
                summary.uniqueActionableSignals,
                entryDecisions,
                closedTrades
            );

            expect(funnel.summary.generatedSignals).toBe(2);
            expect(funnel.summary.filledTrades).toBe(1);
            expect(funnel.summary.rejectedEntries).toBe(1);
            expect(rejectionBreakdown.breakdown).toEqual([
                expect.objectContaining({
                    rejectionCode: 'SPREAD_TOO_WIDE',
                    count: 1,
                }),
            ]);
            expect(executionGap.byCohort).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        instrument: 'EUR_USD',
                        runId: 'run-live-1',
                        selectionId: 'selection-1',
                        filledTrades: 1,
                        closedTrades: 1,
                    }),
                    expect.objectContaining({
                        instrument: 'GBP_USD',
                        runId: 'run-live-1',
                        selectionId: 'selection-1',
                        rejectedEntries: 1,
                        executionRatePct: 0,
                    }),
                ])
            );
        });

        test('should keep identical cohorts from different runs separated', () => {
            const signals = [
                createMockSignal({
                    symbol: 'AUD_USD',
                    signalClass: 'ACTIONABLE',
                    intent: 'ENTER_LONG',
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                    configHash: 'cfg-1',
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    selectionId: 'selection-1',
                }),
                createMockSignal({
                    symbol: 'AUD_USD',
                    signalClass: 'ACTIONABLE',
                    intent: 'ENTER_LONG',
                    uniqueEvent: true,
                    cooldownSuppressed: false,
                    configHash: 'cfg-1',
                    mode: 'paper_shadow',
                    strategy: 'supertrend_momentum',
                    runId: 'run-shadow-1',
                    selectionId: 'selection-1',
                }),
            ];
            const summary = service.extractSignalEventSummary(signals);
            const closedTrades = [
                createClosedTrade({
                    instrument: 'AUD_USD',
                    configHash: 'cfg-1',
                    mode: 'live',
                    strategy: 'supertrend_momentum',
                    runId: 'run-live-1',
                    ownerRunId: 'run-live-1',
                    selectionId: 'selection-1',
                }),
                createClosedTrade({
                    instrument: 'AUD_USD',
                    configHash: 'cfg-1',
                    mode: 'paper_shadow',
                    strategy: 'supertrend_momentum',
                    runId: 'run-shadow-1',
                    ownerRunId: 'run-shadow-1',
                    selectionId: 'selection-1',
                }),
            ];

            const executionGap = service.calculateExecutionGapByCohort(
                summary.uniqueActionableSignals,
                [],
                closedTrades
            );

            expect(
                executionGap.byCohort.filter((row) => row.instrument === 'AUD_USD')
            ).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        mode: 'live',
                        runId: 'run-live-1',
                    }),
                    expect.objectContaining({
                        mode: 'paper_shadow',
                        runId: 'run-shadow-1',
                    }),
                ])
            );
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

        test('should include zero-return days when explicit period bounds are provided', () => {
            const now = Date.now();
            const trades = [
                createClosedTrade({ pnlAud: 5.00, exitTime: now - 86400000 * 3 }),
                createClosedTrade({ pnlAud: 5.00, exitTime: now - 86400000 * 2 }),
            ];

            const defaultSharpe = service.calculateSharpeRatio(trades);
            const boundedSharpe = service.calculateSharpeRatio(trades, {
                startTime: now - 86400000 * 6,
                endTime: now,
            });

            expect(defaultSharpe).toBe(999);
            expect(boundedSharpe).toBeGreaterThan(0);
            expect(boundedSharpe).toBeLessThan(999);
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

    describe('calculateSidePerformance', () => {
        test('should split performance by BUY and SELL sides', () => {
            const trades = [
                createClosedTrade({ side: 'BUY', pnlAud: 5.00, pnlPips: 20, entryType: 'FRESH_FLIP' }),
                createLosingTrade({ side: 'BUY', pnlAud: -2.00, pnlPips: -10, entryType: 'CONTINUATION_RSI' }),
                createClosedTrade({ side: 'SELL', pnlAud: 3.00, pnlPips: 15, entryType: 'SHORT_ENTRY' }),
                createLosingTrade({ side: 'SELL', pnlAud: -1.00, pnlPips: -8, entryType: 'SHORT_ENTRY' }),
            ];

            const analysis = service.calculateSidePerformance(trades);

            expect(analysis.buy.totalTrades).toBe(2);
            expect(analysis.buy.wins).toBe(1);
            expect(analysis.buy.totalPnLAud).toBe(3.0);
            expect(analysis.sell.totalTrades).toBe(2);
            expect(analysis.sell.wins).toBe(1);
            expect(analysis.sell.totalPnLAud).toBe(2.0);
            expect(analysis.sellSharePercent).toBe(50.0);
        });

        test('should aggregate by entry type and side', () => {
            const trades = [
                createClosedTrade({ side: 'BUY', pnlAud: 4.00, entryType: 'FRESH_FLIP' }),
                createLosingTrade({ side: 'SELL', pnlAud: -2.00, entryType: 'SHORT_ENTRY' }),
                createClosedTrade({ side: 'SELL', pnlAud: 3.00, entryType: 'SHORT_ENTRY' }),
            ];

            const analysis = service.calculateSidePerformance(trades);
            const shortEntry = analysis.byEntryType.find((e) => e.entryType === 'SHORT_ENTRY');
            const freshFlip = analysis.byEntryType.find((e) => e.entryType === 'FRESH_FLIP');

            expect(shortEntry.sellTrades).toBe(2);
            expect(shortEntry.sellWinRate).toBe(50.0);
            expect(shortEntry.sellPnLAud).toBe(1.0);
            expect(freshFlip.buyTrades).toBe(1);
            expect(freshFlip.buyWinRate).toBe(100.0);
        });
    });

    describe('review regressions', () => {
        test('reconsidered attempts count once each while the strategy setup remains one decision', () => {
            const setup = createMockSignal({ signalClass: 'ACTIONABLE', intent: 'ENTER_LONG',
                setupId: 'same-setup', signalCandleTime: Date.parse('2026-09-11T00:00:00Z'),
                uniqueEvent: true, reasonCode: 'INTRADAY_MOMENTUM_LONG_ENTRY' });
            const first = { ...setup, entryAttemptId: 'attempt-1' };
            const second = { ...setup, decisionContext: { entryAttemptId: 'attempt-2' } };
            const signals = [first, second, { ...second }];
            const summary = service.extractSignalEventSummary(signals);
            expect(summary.uniqueActionableSignals).toHaveLength(2);
            expect(service.calculateSignalAnalysis(signals).decisionTotal).toBe(1);
            const funnel = service.calculateEntryFunnel(summary.uniqueActionableSignals,
                [{ outcome: 'REJECTED' }, { outcome: 'FILLED', stage: 'FILLED' }], []);
            expect(funnel.summary).toMatchObject({ generatedSignals: 2, trackedDecisions: 2, telemetryCoveragePct: 100 });
            expect(funnel.rates).toMatchObject({ fillRatePct: 50, rejectionRatePct: 50 });
        });
        test('same setup in distinct releases remains two distinct actionable events', () => {
            const setup = createMockSignal({ signalClass: 'ACTIONABLE', intent: 'ENTER_LONG', setupId: 'same-setup', uniqueEvent: true });
            const result = service.calculateSignalAnalysis([{ ...setup, runId: 'v2-run' }, { ...setup, runId: 'v3-run' }]);
            expect(result.actionableUnique).toBe(2);
        });
        test('unmatched period totals never become a closure conversion rate', () => {
            const result = service.calculateEntryFunnel([], [{ outcome: 'FILLED', tradeId: 'one' }], [createClosedTrade(), createClosedTrade()]);
            expect(result.rates.closeRatePct).toBeNull();
        });
        test('empty sample has no zero-width confidence interval', () => {
            expect(service.calculateSummary([]).expectancy95Aud).toMatchObject({
                lower: null, upper: null, samples: 0, observations: 0, status: 'EMPTY_SAMPLE',
            });
        });
        test('net financing loss counts as a loss even with zero price pips', () => {
            const trade = createClosedTrade({ pnlAud: -0.05, pnlPips: 0,
                brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.2 } } });
            expect(service.calculateCohortExpectancy([trade]).summary).toMatchObject({ wins: 0, losses: 1, flat: 0, avgR: -0.25 });
        });
        test('moving stops do not invent original risk', () => {
            const trade = createClosedTrade({ stopLossPrice: 1.1, entryPrice: 1.11, brokerReconciliationPayload: {} });
            expect(service.getInitialRiskAud(trade)).toBeNull();
            expect(service.getInitialRiskPips(trade)).toBeNull();
        });
        test('raw overlap and pure triggers survive the display entry label', () => {
            const trade = (flags) => createClosedTrade({ entryType: 'INTRADAY_PULLBACK',
                brokerReconciliationPayload: { liveRuntime: { entryTelemetry: { strategyContext: { m15: { trigger: flags } } } } } });
            const groups = service.calculateTriggerPerformance([
                trade({ longPullback: true, longBreakout: true }), trade({ longPullback: true, longBreakout: false }),
            ]);
            expect(groups.map((row) => row.trigger)).toEqual(['BOTH', 'PULLBACK_ONLY']);
            expect(groups.every((row) => row.entryClass === 'TREND')).toBe(true);
        });
        test('trend and post-TP fade outcomes remain separate for the same original raw trigger', () => {
            const trade = (entryType, pnlAud) => createClosedTrade({ entryType, pnlAud,
                brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.2,
                    entryTelemetry: { strategyContext: { m15: { trigger: {
                        longPullback: true, longBreakout: true, shortPullback: false, shortBreakout: false,
                    } } } } } } });
            const trades = [trade('M15_PULLBACK_RESUMPTION', 0.3), trade('M15_POST_TP_FADE', -0.2),
                trade('M15_PULLBACK_RESUMPTION', -0.1), trade('M15_POST_TP_FADE', 0.05)];
            const original = JSON.stringify(trades);

            const groups = service.calculateTriggerPerformance(trades);

            expect(groups).toEqual([
                expect.objectContaining({ entryClass: 'TREND', trigger: 'BOTH', trades: 2,
                    totalPnLAud: 0.2, wins: 1, losses: 1, avgR: 0.5 }),
                expect.objectContaining({ entryClass: 'POST_TP_FADE', trigger: 'BOTH', trades: 2,
                    totalPnLAud: -0.15, wins: 1, losses: 1, avgR: -0.375 }),
            ]);
            const overall = service.calculateCohortExpectancy(trades).summary;
            expect(groups.reduce((sum, group) => sum + group.trades, 0)).toBe(overall.trades);
            expect(groups.reduce((sum, group) => sum + group.totalPnLAud, 0)).toBeCloseTo(overall.totalPnLAud, 10);
            expect(overall).toMatchObject({ trades: 4, totalPnLAud: 0.05, wins: 2, losses: 2 });
            expect(JSON.stringify(trades)).toBe(original);
        });
        test.each(['dashboard', 'full'])('SELL retest results remain a distinct entry class in %s analytics and reports', async (profile) => {
            const trade = (id, entryType, pnlAud, flags) => createClosedTrade({ id, entryType, pnlAud,
                side: 'SELL', brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.2,
                    entryTelemetry: { strategyContext: { m15: { trigger: flags } } } } } });
            const both = { shortPullback: true, shortBreakout: true, longPullback: false, longBreakout: false };
            const neither = { shortPullback: false, shortBreakout: false, longPullback: false, longBreakout: false };
            const trades = [
                trade('old-trend', 'M15_PULLBACK_RESUMPTION', -0.2, both),
                trade('old-fade', 'M15_POST_TP_FADE', 0.1, both),
                trade('new-retest-overlap', 'M15_BREAK_RETEST_REJECTION', 0.3, both),
                trade('new-retest-independent', 'M15_BREAK_RETEST_REJECTION', -0.1, neither),
            ];
            const originalPayloads = trades.map((row) => JSON.stringify(row.brokerReconciliationPayload));
            mockTradeRepo.getTradesSince.mockResolvedValue(trades);

            const result = await service.getAnalytics('all', { profile, timeBasis: 'realized' });

            expect(result.triggerPerformance).toEqual([
                expect.objectContaining({ entryClass: 'TREND', trigger: 'BOTH', trades: 1, totalPnLAud: -0.2 }),
                expect.objectContaining({ entryClass: 'POST_TP_FADE', trigger: 'BOTH', trades: 1, totalPnLAud: 0.1 }),
                expect.objectContaining({ entryClass: 'SELL_RETEST', trigger: 'BOTH', trades: 1, totalPnLAud: 0.3, avgR: 1.5 }),
                expect.objectContaining({ entryClass: 'SELL_RETEST', trigger: 'NEITHER', trades: 1, totalPnLAud: -0.1, avgR: -0.5 }),
            ]);
            expect(result.sidePerformance.byEntryType).toContainEqual(expect.objectContaining({
                entryType: 'M15_BREAK_RETEST_REJECTION', sellTrades: 2, sellPnLAud: 0.2,
            }));
            expect(result.triggerPerformance.reduce((sum, group) => sum + group.trades, 0)).toBe(result.summary.totalTrades);
            expect(result.triggerPerformance.reduce((sum, group) => sum + group.totalPnLAud, 0)).toBeCloseTo(result.summary.totalPnLAud, 10);
            expect(trades.map((row) => JSON.stringify(row.brokerReconciliationPayload))).toEqual(originalPayloads);
        });
        test.each(['dashboard', 'full'])('BUY retest results keep historical trend/fade attribution in %s analytics', async (profile) => {
            const flags = { longPullback: true, longBreakout: false, shortPullback: false, shortBreakout: false };
            const trade = (id, entryType, pnlAud) => createClosedTrade({ id, entryType, pnlAud,
                side: 'BUY', brokerReconciliationPayload: { liveRuntime: { initialRiskAud: 0.2,
                    entryTelemetry: { strategyContext: { m15: { trigger: flags } } } } } });
            const trades = [trade('old-buy', 'M15_PULLBACK_RESUMPTION', -0.2),
                trade('old-buy-fade', 'M15_POST_TP_FADE', 0.1),
                trade('new-buy-retest', 'M15_BREAK_RETEST_CONFIRMATION', 0.3)];
            const original = trades.map((row) => JSON.stringify(row.brokerReconciliationPayload));
            mockTradeRepo.getTradesSince.mockResolvedValue(trades);
            const result = await service.getAnalytics('all', { profile, timeBasis: 'realized' });
            expect(result.triggerPerformance).toEqual([
                expect.objectContaining({ entryClass: 'TREND', trades: 1, totalPnLAud: -0.2 }),
                expect.objectContaining({ entryClass: 'POST_TP_FADE', trades: 1, totalPnLAud: 0.1 }),
                expect.objectContaining({ entryClass: 'BUY_RETEST', trades: 1, totalPnLAud: 0.3, avgR: 1.5 }),
            ]);
            expect(result.sidePerformance.byEntryType).toContainEqual(expect.objectContaining({
                entryType: 'M15_BREAK_RETEST_CONFIRMATION', buyTrades: 1, buyPnLAud: 0.3,
            }));
            expect(result.triggerPerformance.reduce((sum, group) => sum + group.trades, 0)).toBe(result.summary.totalTrades);
            expect(result.triggerPerformance.reduce((sum, group) => sum + group.totalPnLAud, 0)).toBeCloseTo(result.summary.totalPnLAud, 10);
            expect(trades.map((row) => JSON.stringify(row.brokerReconciliationPayload))).toEqual(original);
        });
        test('positive commissions and fees are added back to derive gross P/L', () => {
            const result = service.calculateSummary([createClosedTrade({ pnlAud: 0.55, swapAud: -0.1, commissionAud: 0.3,
                brokerReconciliationPayload: { closeCosts: { guaranteedExecutionFee: 0.05 } } })]);
            expect(result.costs.grossBeforeExplicitCostsAud).toBe(1);
        });
        test('realized interval is explicit, end exclusive, and all is unbounded history', async () => {
            const endTime = Date.UTC(2026, 8, 6);
            await service.getAnalytics('all', { timeBasis: 'realized', endTime });
            expect(mockTradeRepo.getTradesSince).toHaveBeenCalledWith(0, { mode: 'live', timeBasis: 'realized', endTime });
        });
        test('ADX comparison never claims filter effectiveness', () => {
            const result = service.calculateAdxAnalysis([createClosedTrade({ signalStrength: 40 }), createLosingTrade({ signalStrength: 20 })]);
            expect(result.recommendation).toContain('do not establish');
        });
        test('sampled price excursions do not invent missing risk multiples', () => {
            const trade = (value) => createClosedTrade({ brokerReconciliationPayload: { sampledExcursion: {
                version: 2, lifetimeStatus: 'VERIFIED', observations: 3,
                maxFavorableR: value, maxAdverseR: value,
            } } });
            expect(service.calculateExcursionCoverage([trade(null), trade(2)])).toMatchObject({
                measuredTrades: 2, verifiedTrades: 2, unverifiedTrades: 0,
                favorableRMeasuredTrades: 1, adverseRMeasuredTrades: 1,
                avgFavorableR: 2, avgAdverseR: 2,
            });
        });
        test.each([
            ['legacy aggregate', { version: 1 }],
            ['unversioned historical aggregate', {}],
            ['provisional observations', { version: 2, lifetimeStatus: 'PROVISIONAL' }],
            ['missing broker closure time', { version: 2, lifetimeStatus: 'UNVERIFIED_CLOSE_TIME' }],
            ['partial legacy coverage', { version: 2, lifetimeStatus: 'VERIFIED', legacyAggregate: { version: 1, observations: 2 } }],
        ])('excludes %s from verified excursion averages while retaining measured coverage', (_description, unverified) => {
            const trade = (sample) => createClosedTrade({ brokerReconciliationPayload: { sampledExcursion: sample } });
            const result = service.calculateExcursionCoverage([
                trade({ observations: 3, maxFavorableR: 100, maxAdverseR: 100, ...unverified }),
                trade({ version: 2, lifetimeStatus: 'VERIFIED', observations: 2, maxFavorableR: 1.5, maxAdverseR: 0.5 }),
            ]);
            expect(result).toMatchObject({
                totalTrades: 2, measuredTrades: 2, verifiedTrades: 1, unverifiedTrades: 1,
                favorableRMeasuredTrades: 1, adverseRMeasuredTrades: 1,
                avgFavorableR: 1.5, avgAdverseR: 0.5,
            });
            expect(result.method).toContain('Historical aggregates, partial legacy coverage and unverified samples are excluded');
        });
        test('open trades cannot contribute to verified closed-lifetime excursion averages', () => {
            const trade = createMockTrade({ brokerReconciliationPayload: { sampledExcursion: {
                version: 2, lifetimeStatus: 'VERIFIED', observations: 1, maxFavorableR: 99, maxAdverseR: 99,
            } } });
            expect(service.calculateExcursionCoverage([trade])).toMatchObject({
                measuredTrades: 1, verifiedTrades: 0, unverifiedTrades: 1,
                favorableRMeasuredTrades: 0, adverseRMeasuredTrades: 0,
                avgFavorableR: null, avgAdverseR: null,
            });
        });
        test('legitimate zero excursions remain measured in verified averages', () => {
            const trade = createClosedTrade({ brokerReconciliationPayload: { sampledExcursion: {
                version: 2, lifetimeStatus: 'VERIFIED', observations: 1, maxFavorableR: 0, maxAdverseR: 0,
            } } });
            expect(service.calculateExcursionCoverage([trade])).toMatchObject({
                measuredTrades: 1, verifiedTrades: 1, unverifiedTrades: 0,
                favorableRMeasuredTrades: 1, adverseRMeasuredTrades: 1,
                avgFavorableR: 0, avgAdverseR: 0,
            });
        });
        test('finalization with no in-lifetime observations cannot create measured zero excursions', () => {
            const trade = createClosedTrade({ brokerReconciliationPayload: { sampledExcursion: {
                version: 2, lifetimeStatus: 'VERIFIED', observations: 0, maxFavorableR: 0, maxAdverseR: 0,
            } } });
            expect(service.calculateExcursionCoverage([trade])).toMatchObject({
                totalTrades: 1, measuredTrades: 0, verifiedTrades: 0, unverifiedTrades: 0,
                favorableRMeasuredTrades: 0, adverseRMeasuredTrades: 0,
                avgFavorableR: null, avgAdverseR: null,
            });
        });
        test('retains unverified legacy coverage when all new observations were outside the lifetime', () => {
            const trade = createClosedTrade({ brokerReconciliationPayload: { sampledExcursion: {
                version: 2, lifetimeStatus: 'VERIFIED', observations: 0, maxFavorableR: 0, maxAdverseR: 0,
                legacyAggregate: { version: 1, observations: 3, maxFavorableR: 10, maxAdverseR: 5 },
            } } });
            expect(service.calculateExcursionCoverage([trade])).toMatchObject({
                totalTrades: 1, measuredTrades: 1, verifiedTrades: 0, unverifiedTrades: 1,
                favorableRMeasuredTrades: 0, adverseRMeasuredTrades: 0,
                avgFavorableR: null, avgAdverseR: null,
            });
        });
        test('missing sampled excursions are explicitly uncovered', () => {
            expect(service.calculateExcursionCoverage([createClosedTrade()])).toMatchObject({
                measuredTrades: 0, totalTrades: 1, verifiedTrades: 0, unverifiedTrades: 0,
                favorableRMeasuredTrades: 0, adverseRMeasuredTrades: 0,
                avgFavorableR: null, avgAdverseR: null,
            });
        });
    });

    describe('calculateCohortExpectancy', () => {
        test('realized win/loss/flat weighting reconciles the direct ledger mean', () => {
            const trades = [
                createClosedTrade({ pnlAud: 3, pnlPips: 30 }),
                createClosedTrade({ pnlAud: -1, pnlPips: -10 }),
                createClosedTrade({ pnlAud: 0, pnlPips: 0, exitReason: 'BREAKEVEN_STOP' }),
            ];
            const { summary } = service.calculateCohortExpectancy(trades);
            expect(summary).toMatchObject({ trades: 3, wins: 1, losses: 1, flat: 1,
                netExpectancyAud: 0.6667, netExpectancyPips: 6.67,
                expectedEdge: null, expectedEdgeDeprecated: true });
            for (const [basis, expectedMean] of [['aud', 2 / 3], ['pips', 20 / 3]]) {
                const observed = summary.observedExpectancy[basis];
                expect(observed).toMatchObject({ observations: 3, missingObservations: 0, wins: 1, losses: 1, flat: 1 });
                expect(observed.mean).toBeCloseTo(expectedMean, 12);
                expect(observed.winProbability * observed.meanWin +
                    observed.lossProbability * observed.meanLoss).toBeCloseTo(observed.mean, 12);
            }
        });

        test('net AUD and executable pip outcome signs have independent denominators', () => {
            const { summary } = service.calculateCohortExpectancy([
                createClosedTrade({ pnlAud: -0.05, pnlPips: 4, swapAud: -0.09 }),
                createClosedTrade({ pnlAud: 0.3, pnlPips: 30 }),
                createClosedTrade({ pnlAud: -0.1, pnlPips: -10 }),
                createClosedTrade({ pnlAud: 0, pnlPips: 0 }),
            ]);
            expect(summary).toMatchObject({ wins: 1, losses: 2, flat: 1,
                pipWins: 2, pipLosses: 1, pipFlat: 1, avgWinPips: 17, avgLossPips: 10,
                netExpectancyAud: 0.0375, netExpectancyPips: 6 });
            expect(summary.observedExpectancy.aud).toMatchObject({ basis: 'REALIZED_NET_AUD',
                meanWin: 0.3, winProbability: 0.25, lossProbability: 0.5, flatProbability: 0.25 });
            expect(summary.observedExpectancy.aud.meanLoss).toBeCloseTo(-0.075, 12);
            expect(summary.observedExpectancy.pips).toMatchObject({ basis: 'EXECUTABLE_PRICE_PIPS',
                meanWin: 17, meanLoss: -10, winProbability: 0.5, lossProbability: 0.25, flatProbability: 0.25 });
        });

        test('a financing-only loss is a net AUD loss and a flat price movement', () => {
            const { summary } = service.calculateCohortExpectancy([
                createClosedTrade({ pnlAud: -0.05, pnlPips: 0, swapAud: -0.05 }),
            ]);
            expect(summary.observedExpectancy.aud).toMatchObject({ observations: 1,
                wins: 0, losses: 1, flat: 0, mean: -0.05, meanWin: null, meanLoss: -0.05 });
            expect(summary.observedExpectancy.pips).toMatchObject({ observations: 1,
                wins: 0, losses: 0, flat: 1, mean: 0, meanWin: null, meanLoss: null });
        });

        test('all-flat and empty observed samples do not manufacture winning or losing payoffs', () => {
            const flat = service.calculateCohortExpectancy([
                createClosedTrade({ pnlAud: 0, pnlPips: 0 }),
                createClosedTrade({ pnlAud: 0, pnlPips: 0 }),
            ]).summary;
            for (const observed of Object.values(flat.observedExpectancy)) {
                expect(observed).toMatchObject({ observations: 2, wins: 0, losses: 0, flat: 2,
                    mean: 0, meanWin: null, meanLoss: null, flatProbability: 1 });
            }
            const empty = service.calculateCohortExpectancy([]).summary;
            for (const observed of Object.values(empty.observedExpectancy)) {
                expect(observed).toMatchObject({ observations: 0, mean: null,
                    meanWin: null, meanLoss: null, winProbability: null, lossProbability: null, flatProbability: null });
            }
        });

        test('missing pip evidence is uncovered rather than counted as flat in observed distributions', () => {
            const trades = [null, undefined, '', ' ', NaN].map((pnlPips) => createClosedTrade({ pnlAud: 0.1, pnlPips }));
            trades.push(createClosedTrade({ pnlAud: 0.1, pnlPips: '3' }));
            const { summary } = service.calculateCohortExpectancy(trades);
            expect(summary.netExpectancyPips).toBe(0.5); // Retained legacy denominator: all six closed trades.
            expect(summary.observedExpectancy.pips).toMatchObject({ observations: 1,
                missingObservations: 5, wins: 1, losses: 0, flat: 0, mean: 3 });
            expect(summary.observedExpectancy.aud).toMatchObject({ observations: 6, missingObservations: 0 });
        });

        test.each(['full', 'dashboard'])('unavailable intervals and retrospective metadata survive %s analytics/report JSON', async (profile) => {
            mockTradeRepo.getTradesSince.mockResolvedValue([
                createClosedTrade({ pnlAud: -0.1787, pnlPips: -14.5,
                    brokerReconciliationPayload: JSON.stringify({ liveRuntime: { initialRiskAud: 0.17829655 } }) }),
            ]);
            const analytics = await service.getAnalytics('all', { mode: 'live', profile, timeBasis: 'realized' });
            // S3 reports embed this analytics object as JSON; nulls must remain
            // null, not become zero-money values or absent keys.
            const report = JSON.parse(JSON.stringify({ schemaVersion: 2, analytics }));
            expect(report.analytics.summary.expectancy95Aud).toMatchObject({ lower: null, upper: null,
                samples: 0, status: 'SINGLE_OBSERVATION', observations: 1 });
            expect(report.analytics.summary.netR).toMatchObject({ lower95: null, upper95: null,
                intervalStatus: 'SINGLE_OBSERVATION', mean: -1.0023 });
            expect(report.analytics.cohortExpectancy.summary).toMatchObject({ expectedEdge: null,
                expectedEdgeDeprecated: true, netExpectancyAud: -0.1787,
                observedExpectancy: { aud: { basis: 'REALIZED_NET_AUD', mean: -0.1787 },
                    pips: { basis: 'EXECUTABLE_PRICE_PIPS', mean: -14.5 } } });
            expect(report.analytics.triggerPerformance[0].expectedEdge).toBeNull();
            expect(report.analytics.triggerPerformance[0].expectedEdgeDeprecated).toBe(true);
        });

        test('groups net expectancy by side, instrument, session, entry type, and combined cohort', () => {
            const entryTime = Date.UTC(2026, 0, 1, 13, 0, 0);
            const stopMetadata = {
                liveRuntime: {
                    initialStopDistance: 0.002,
                    initialRiskAud: 2,
                },
            };
            const trades = [
                createClosedTrade({
                    side: 'BUY',
                    instrument: 'EUR_USD',
                    entryType: 'FRESH_FLIP',
                    entryTime,
                    pnlAud: 3,
                    pnlPips: 30,
                    brokerReconciliationPayload: stopMetadata,
                }),
                createLosingTrade({
                    side: 'BUY',
                    instrument: 'EUR_USD',
                    entryType: 'FRESH_FLIP',
                    entryTime,
                    pnlAud: -1,
                    pnlPips: -10,
                    brokerReconciliationPayload: stopMetadata,
                }),
                createClosedTrade({
                    side: 'SELL',
                    instrument: 'GBP_USD',
                    entryType: 'SHORT_ENTRY',
                    entryTime,
                    pnlAud: 2,
                    pnlPips: 20,
                    brokerReconciliationPayload: stopMetadata,
                }),
            ];

            const expectancy = service.calculateCohortExpectancy(trades);

            expect(expectancy.summary).toEqual(
                expect.objectContaining({
                    trades: 3,
                    wins: 2,
                    losses: 1,
                    totalPnLPips: 40,
                    netExpectancyPips: 13.33,
                    avgR: 0.667,
                })
            );
            expect(expectancy.bySide).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        side: 'BUY',
                        trades: 2,
                        winRatePct: 50,
                        totalPnLPips: 20,
                        netExpectancyPips: 10,
                        avgR: 0.5,
                        expectedEdge: null,
                        expectedEdgeDeprecated: true,
                        observedExpectancy: expect.objectContaining({
                            aud: expect.objectContaining({ basis: 'REALIZED_NET_AUD', mean: 1 }),
                            pips: expect.objectContaining({ basis: 'EXECUTABLE_PRICE_PIPS', mean: 10 }),
                        }),
                    }),
                    expect.objectContaining({
                        side: 'SELL',
                        trades: 1,
                        netExpectancyPips: 20,
                    }),
                ])
            );
            expect(expectancy.bySession).toEqual([
                expect.objectContaining({
                    session: 'London + New York',
                    trades: 3,
                }),
            ]);
            expect(expectancy.byInstrument).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        instrument: 'EUR_USD',
                        trades: 2,
                        netExpectancyPips: 10,
                    }),
                ])
            );
            expect(expectancy.byEntryType).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        entryType: 'FRESH_FLIP',
                        trades: 2,
                    }),
                ])
            );
            expect(expectancy.byCohort).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        cohort: 'BUY|London + New York|FRESH_FLIP|EUR_USD',
                        side: 'BUY',
                        session: 'London + New York',
                        entryType: 'FRESH_FLIP',
                        instrument: 'EUR_USD',
                        trades: 2,
                    }),
                ])
            );
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
