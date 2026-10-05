const path = require('path');
const knex = require('knex');
const express = require('express');
const SignalGenerator = require('../signalGenerator');
const AnalyticsService = require('../analyticsService');
const SignalRepository = require('../../repositories/signalRepository');
const EntryDecisionRepository = require('../../repositories/entryDecisionRepository');
const TradeRepository = require('../../repositories/tradeRepository');

let mockSqlite = null;
jest.mock('../../../config/database', () => ({
    db: new Proxy(function () {}, {
        apply: (_target, _thisArg, args) => {
            if (!mockSqlite) throw new Error('Isolated analytics database is unavailable');
            return mockSqlite(...args);
        },
        get: (_target, key) => typeof mockSqlite?.[key] === 'function'
            ? mockSqlite[key].bind(mockSqlite) : mockSqlite?.[key],
    }),
}));

const START = Date.parse('2026-10-01T06:00:00Z');
const END = START + 8 * 60 * 60_000;
const CURRENT = { mode: 'live', strategy: 'intraday_momentum', runId: 'live-current',
    selectionId: 'selection-current', configHash: 'config-current' };
const PREVIOUS = { ...CURRENT, runId: 'live-previous', selectionId: 'selection-previous',
    configHash: 'config-previous' };
const PULLBACK = 'M15_PULLBACK_RESUMPTION';

async function requestAnalyticsJson(app, query) {
    const route = require('../../routes/tradingRoutes').stack.find((layer) =>
        layer.route?.path === '/analytics' && layer.route.methods.get);
    const req = { app, query, method: 'GET', fresh: false };
    const headers = {};
    // Exercise the real handler and Express JSON response serializer without
    // binding a TCP port. Only the response's transport boundary is replaced.
    const res = Object.create(express.response);
    Object.assign(res, {
        app, req, statusCode: 200,
        setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
        getHeader: (key) => headers[key.toLowerCase()],
        removeHeader: (key) => { delete headers[key.toLowerCase()]; },
        end: (body) => { res.serializedBody = body.toString(); },
    });
    await route.route.stack[0].handle(req, res);
    return { status: res.statusCode, headers, body: JSON.parse(res.serializedBody) };
}

describe('persisted signal, decision and trade cohort integration', () => {
    let signals;
    let decisions;
    let trades;
    let analytics;
    let generator;

    beforeEach(async () => {
        // Use production migrations and real repository queries, with no import
        // of the developer/production database or broker credentials.
        mockSqlite = knex({ client: 'better-sqlite3',
            connection: { filename: ':memory:' }, useNullAsDefault: true,
            pool: { min: 1, max: 1 } });
        await mockSqlite.migrate.latest({ directory: path.resolve(__dirname, '../../../migrations') });
        signals = new SignalRepository();
        decisions = new EntryDecisionRepository();
        trades = new TradeRepository();
        analytics = new AnalyticsService(trades, signals, decisions);
        generator = new SignalGenerator();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        if (mockSqlite) await mockSqlite.destroy();
        mockSqlite = null;
    });

    async function saveAttempt({ id, candle, entryType = PULLBACK, identity = CURRENT,
        side = 'BUY', filled = false, pnlAud = -0.1787, context = {} }) {
        const signal = {
            ...generator.buildSignal('USD_JPY', {
                signalType: side, signalClass: 'ACTIONABLE',
                intent: side === 'BUY' ? 'ENTER_LONG' : 'ENTER_SHORT', entryType,
                signalCandleTime: new Date(candle).toISOString(),
                adxVal: 27.95, rsiVal: side === 'BUY' ? 60 : 40,
                strategyContext: context,
            }, { version: '1.3.0' }, 150),
            ...identity,
            timestamp: candle + 15 * 60_000 + 1000,
            entryAttemptId: id,
        };
        signal.decisionContext = { ...signal.decisionContext, entryAttemptId: id };
        await signals.save(signal);
        const tradeId = filled ? `trade-${id}` : null;
        await decisions.save({
            ...identity, decisionId: id, setupId: signal.setupId,
            signalCandleTime: signal.signalCandleTime, decisionTime: signal.timestamp + 100,
            instrument: signal.symbol, side, signal: side, entryType,
            stage: filled ? 'FILLED' : 'REJECTED', outcome: filled ? 'FILLED' : 'REJECTED',
            rejectionCode: filled ? null : 'ALREADY_IN_POSITION', tradeId,
        });
        if (filled) {
            const priceMove = pnlAud < 0 ? -0.145 : 0.15;
            await trades.save({
                ...identity, id: tradeId, oandaTradeId: `broker-${id}`,
                // Analytics must attribute results to the owner, even when a
                // recovered record's run_id is different.
                runId: `recording-${identity.runId}`, ownerRunId: identity.runId,
                instrument: signal.symbol, side, signal: side, entryType,
                units: 100, entryPrice: 150, exitPrice: 150 + (side === 'BUY' ? priceMove : -priceMove),
                entryCostAud: 1, pnlAud, pnlPips: pnlAud < 0 ? -14.5 : 15,
                signalStrength: signal.strength, atrPips: 10,
                entryTime: signal.timestamp + 200, exitTime: signal.timestamp + 30 * 60_000,
                exitReason: pnlAud < 0 ? 'STOP_LOSS' : 'TAKE_PROFIT', isOpen: false,
                brokerReconciliationPayload: { liveRuntime: {
                    initialRiskAud: 0.1783,
                    entryTelemetry: { strategyContext: context },
                } },
            });
        }
        return signal;
    }

    test.each([
        ['full', true], ['dashboard', true], ['full', false], ['dashboard', false],
    ])('%s analytics joins persisted setups in %s run-scoped mode', async (profile, currentOnly) => {
        const first = await saveAttempt({ id: 'filled', candle: START, filled: true });
        const second = await saveAttempt({ id: 'occupied', candle: START + 15 * 60_000 });
        await saveAttempt({ id: 'prior', candle: START - 60 * 60_000,
            identity: PREVIOUS, filled: true, pnlAud: 0.2 });
        expect(first.setupId).not.toBe(second.setupId);
        expect(first.signalCandleTime).not.toBe(second.signalCandleTime);

        const rawBefore = await mockSqlite('signals').orderBy('id');
        const gap = jest.spyOn(analytics, 'calculateExecutionGapByCohort');
        const report = await analytics.getAnalytics('all', {
            mode: 'live', profile, endTime: END, timeBasis: 'realized',
            ...(currentOnly ? { runId: CURRENT.runId } : {}),
        });
        const count = currentOnly ? 2 : 3;
        expect(report.rawCounts).toMatchObject({ totalSignals: count,
            uniqueActionableSignals: count, entryDecisions: count,
            closedTrades: currentOnly ? 1 : 2 });
        expect(report.entryFunnel.summary).toMatchObject({ generatedSignals: count,
            trackedDecisions: count, filledTrades: currentOnly ? 1 : 2, rejectedEntries: 1 });
        expect(report.rejectionBreakdown.breakdown).toEqual([
            expect.objectContaining({ rejectionCode: 'ALREADY_IN_POSITION', count: 1 }),
        ]);

        // The dashboard discards deep diagnostics from its response, but still
        // computes them from its compact repository read. Inspect that real
        // result so compact-only mapping cannot regress unnoticed.
        const persistedSignals = gap.mock.calls[0][0];
        expect(persistedSignals).toHaveLength(count);
        expect(persistedSignals.every((row) => row.entryType === PULLBACK &&
            row.entry_type === PULLBACK && row.intent === 'ENTER_LONG')).toBe(true);
        expect(persistedSignals.every((row) => profile === 'full'
            ? row.decisionContext !== null : row.decisionContext === null)).toBe(true);
        const computedGap = gap.mock.results[0].value;
        expect(computedGap.byCohort).toHaveLength(currentOnly ? 1 : 2);
        expect(computedGap.byCohort.find((row) => row.runId === CURRENT.runId)).toMatchObject({
            configHash: CURRENT.configHash, selectionId: CURRENT.selectionId,
            cohort: `USD_JPY|BUY|${PULLBACK}`, cohortType: PULLBACK,
            expectedSignals: 2, trackedDecisions: 2, filledTrades: 1,
            rejectedEntries: 1, closedTrades: 1, executionRatePct: 50, rejectionRatePct: 50,
        });
        if (!currentOnly) {
            expect(computedGap.byCohort.find((row) => row.runId === PREVIOUS.runId)).toMatchObject({
                configHash: PREVIOUS.configHash, selectionId: PREVIOUS.selectionId,
                expectedSignals: 1, trackedDecisions: 1, filledTrades: 1, closedTrades: 1,
                executionRatePct: 100,
            });
        }
        if (profile === 'full') {
            expect(report.expectationVsActual.byConfigAndCohort).toHaveLength(currentOnly ? 1 : 2);
            expect(report.expectationVsActual.byConfigAndCohort.find((row) => row.runId === CURRENT.runId))
                .toMatchObject({ cohortType: PULLBACK, expectedSignals: 2, actualTrades: 1,
                    executionRatePct: 50 });
            expect(report.executionGapByCohort).toEqual(computedGap);
        } else {
            expect(report).not.toHaveProperty('expectationVsActual');
            expect(report).not.toHaveProperty('executionGapByCohort');
        }
        expect(await mockSqlite('signals').orderBy('id')).toEqual(rawBefore);
    });

    test('normal, fade and SELL retest entry types remain separate through persisted analytics', async () => {
        const entries = [
            [PULLBACK, 'BUY'], ['M15_RANGE_BREAKOUT', 'BUY'],
            ['M15_POST_TP_FADE', 'BUY'], ['M15_BREAK_RETEST_REJECTION', 'SELL'],
        ];
        for (const [index, [entryType, side]] of entries.entries()) {
            await saveAttempt({ id: `type-${index}`, candle: START + index * 60 * 60_000,
                entryType, side, filled: true,
                context: entryType === 'M15_POST_TP_FADE'
                    ? { reentry: { anchor: { tradeId: 'original-short-tp' }, originalSide: 'SELL', executedSide: 'BUY' } }
                    : {},
            });
        }
        const report = await analytics.getAnalytics('all', { runId: CURRENT.runId,
            profile: 'full', endTime: END });
        expect(report.executionGapByCohort.byCohort).toHaveLength(entries.length);
        for (const [entryType, side] of entries) {
            expect(report.executionGapByCohort.byCohort).toContainEqual(expect.objectContaining({
                cohort: `USD_JPY|${side}|${entryType}`, side, cohortType: entryType,
                expectedSignals: 1, trackedDecisions: 1, filledTrades: 1,
                closedTrades: 1, executionRatePct: 100,
            }));
        }
        expect(report.triggerPerformance.map((row) => row.entryClass)).toContain('POST_TP_FADE');
        expect(report.triggerPerformance.map((row) => row.entryClass)).toContain('SELL_RETEST');
    });

    test.each([
        ['current', 'full'], ['run', 'full'], ['all-live', 'full'],
        ['current', 'dashboard'], ['run', 'dashboard'], ['all-live', 'dashboard'],
    ])('the real analytics route serializes joined %s %s results', async (scope, profile) => {
        await saveAttempt({ id: 'route-filled', candle: START, filled: true });
        await saveAttempt({ id: 'route-occupied', candle: START + 15 * 60_000 });
        await saveAttempt({ id: 'route-prior', candle: START - 60 * 60_000,
            identity: PREVIOUS, filled: true, pnlAud: 0.2 });
        jest.spyOn(Date, 'now').mockReturnValue(END);
        const app = express();
        app.locals.tradeRepository = trades;
        app.locals.signalRepository = signals;
        app.locals.entryDecisionRepository = decisions;
        app.locals.runtimeCoordinator = {
            getLiveSelection: () => ({ liveRun: CURRENT }),
            getRunSession: (runId) => runId === CURRENT.runId ? { run: CURRENT } : null,
        };
        const response = await requestAnalyticsJson(app, {
            scope, profile, period: 'all', timeBasis: 'realized',
            ...(scope === 'run' ? { runId: CURRENT.runId } : {}),
        });
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/application\/json/);
        expect(response.body.scope).toBe(scope);
        expect(response.body.rawCounts).toMatchObject({
            uniqueActionableSignals: scope === 'all-live' ? 3 : 2,
            entryDecisions: scope === 'all-live' ? 3 : 2,
            closedTrades: scope === 'all-live' ? 2 : 1,
        });
        if (profile === 'full') {
            expect(response.body.executionGapByCohort.byCohort).toHaveLength(scope === 'all-live' ? 2 : 1);
            expect(response.body.executionGapByCohort.byCohort.find((row) => row.runId === CURRENT.runId))
                .toMatchObject({ cohortType: PULLBACK, expectedSignals: 2,
                    trackedDecisions: 2, filledTrades: 1, rejectedEntries: 1, executionRatePct: 50 });
            expect(response.body.expectationVsActual.byConfigAndCohort.find((row) => row.runId === CURRENT.runId))
                .toMatchObject({ cohortType: PULLBACK, expectedSignals: 2, actualTrades: 1, executionRatePct: 50 });
        } else {
            expect(response.body).not.toHaveProperty('executionGapByCohort');
            expect(response.body.entryFunnel.summary).toMatchObject({
                trackedDecisions: scope === 'all-live' ? 3 : 2,
                filledTrades: scope === 'all-live' ? 2 : 1, rejectedEntries: 1,
            });
        }
    });

    test.each(['daily', 'manual'])('the %s S3 path uploads real serialized joined analytics', async (kind) => {
        await saveAttempt({ id: 'report-filled', candle: START, filled: true });
        await saveAttempt({ id: 'report-occupied', candle: START + 15 * 60_000 });
        await saveAttempt({ id: 'report-prior', candle: START - 60 * 60_000,
            identity: PREVIOUS, filled: true, pnlAud: 0.2 });
        const interval = { start: Date.parse('2026-10-01T00:00:00Z'),
            end: Date.parse('2026-10-02T00:00:00Z') };
        jest.spyOn(Date, 'now').mockReturnValue(interval.end + 60_000);
        const testEnvironment = {
            ENABLE_S3_ANALYTICS: 'true', S3_BUCKET_NAME: 'isolated-analytics-bucket',
            AWS_REGION: 'ap-southeast-2', AWS_ACCESS_KEY_ID: 'isolated-test-key',
            AWS_SECRET_ACCESS_KEY: 'isolated-test-secret',
        };
        const savedEnvironment = Object.fromEntries(Object.keys(testEnvironment)
            .map((key) => [key, process.env[key]]));
        Object.assign(process.env, testEnvironment);
        try {
            // Keep the real report scheduler, analytics service, AWS command and
            // JSON serializer; replace only the external S3 send operation.
            const { S3Client } = require('@aws-sdk/client-s3');
            const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({});
            const S3ReportScheduler = require('../s3ReportScheduler');
            const scheduler = new S3ReportScheduler(trades, signals, decisions, null, {
                reconcileForReport: async () => ({ brokerStateUncertain: false,
                    lastBrokerReconciledAt: interval.end + 1000, pendingOrderIntentCount: 0,
                    quarantinedBrokerPositions: 0, openTrades: [] }),
            });
            const result = kind === 'daily' ? await scheduler.uploadInterval(kind, interval)
                : await scheduler.forceUpload('all');
            expect(kind === 'daily' ? result : result.success).toBe(true);
            expect(send).toHaveBeenCalledTimes(1);
            const command = send.mock.calls[0][0].input;
            expect(command).toMatchObject({ Bucket: testEnvironment.S3_BUCKET_NAME,
                ContentType: 'application/json', IfNoneMatch: '*' });
            expect(command.Key).toMatch(kind === 'daily'
                ? /^v2\/daily\/2026-10-01_to_2026-10-02\/analytics\.json$/
                : /^manual\/.+\/analytics-all\.json$/);
            const report = JSON.parse(command.Body);
            expect(report).toMatchObject({ schemaVersion: 2, reportType: kind, scope: 'all-live' });
            expect(report.analytics.rawCounts).toMatchObject({ uniqueActionableSignals: 3,
                entryDecisions: 3, closedTrades: 2 });
            expect(report.analytics.executionGapByCohort.byCohort).toHaveLength(2);
            expect(report.analytics.executionGapByCohort.byCohort.find((row) => row.runId === CURRENT.runId))
                .toMatchObject({ cohortType: PULLBACK, expectedSignals: 2,
                    trackedDecisions: 2, filledTrades: 1, rejectedEntries: 1, executionRatePct: 50 });
            expect(report.analytics.expectationVsActual.byConfigAndCohort.find((row) => row.runId === CURRENT.runId))
                .toMatchObject({ cohortType: PULLBACK, expectedSignals: 2, actualTrades: 1, executionRatePct: 50 });
        } finally {
            for (const [key, value] of Object.entries(savedEnvironment)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
    });

    test('legacy null entry type stays unknown without rewriting its raw row or inventing an entry', async () => {
        await signals.save({ ...CURRENT, symbol: 'USD_JPY', signal: 'HOLD', strength: 20,
            entryType: null, intent: 'WAIT', signalClass: 'FILTERED',
            reasonCode: 'LEGACY_UNKNOWN', timestamp: START, signalCandleTime: START,
            setupId: 'legacy-unknown', uniqueEvent: true });
        const rawBefore = await mockSqlite('signals').first();
        for (const profile of ['full', 'dashboard']) {
            const read = profile === 'full' ? await signals.getSignalsSince(0)
                : await signals.getSignalsSinceCompact(0);
            expect(read).toHaveLength(1);
            expect(read[0]).toMatchObject({ entryType: null, entry_type: null, intent: 'WAIT' });
            const report = await analytics.getAnalytics('all', { runId: CURRENT.runId, profile, endTime: END });
            expect(report.rawCounts).toMatchObject({ totalSignals: 1,
                uniqueActionableSignals: 0, entryDecisions: 0, closedTrades: 0 });
        }
        expect(await mockSqlite('signals').first()).toEqual(rawBefore);
    });
});
