jest.mock('../../utils/awsS3Utils', () => ({ uploadJsonToS3: jest.fn(), isS3Configured: () => true }));
jest.mock('../analyticsService');
const { uploadJsonToS3 } = require('../../utils/awsS3Utils');
const AnalyticsService = require('../analyticsService');
const Scheduler = require('../s3ReportScheduler');
const { completedInterval } = Scheduler;
const now = Date.UTC(2026, 8, 9, 8, 30); // Wednesday

describe('S3 immutable completed-period reports', () => {
    let scheduler;
    let state;
    beforeEach(() => {
        jest.clearAllMocks();
        state = null;
        process.env.S3_BUCKET_NAME = 'test-bucket';
        AnalyticsService.mockImplementation(() => ({ getAnalytics: jest.fn().mockResolvedValue({ summary: { totalTrades: 2 } }) }));
        scheduler = new Scheduler({}, {}, null, {
            getState: jest.fn(async () => state),
            setState: jest.fn(async (_, value) => { state = value; }),
        }, { reconcileForReport: jest.fn(async () => ({ brokerStateUncertain: false, lastBrokerReconciledAt: now + 86400000, pendingOrderIntentCount: 0, quarantinedBrokerPositions: 0, openTrades: [] })) });
    });
    afterEach(() => { scheduler.stop(); delete process.env.S3_BUCKET_NAME; });
    test('immutable reports wait for broker accounting and a post-boundary sync', async () => {
        uploadJsonToS3.mockResolvedValue(true);
        scheduler.reconcileForReport.mockResolvedValue({ brokerStateUncertain: true, pendingOrderIntentCount: 1 });
        await scheduler.checkAndUpload(now);
        expect(uploadJsonToS3).not.toHaveBeenCalled();
        expect(state).toBeNull();
        scheduler.reconcileForReport.mockResolvedValue({ brokerStateUncertain: false, lastBrokerReconciledAt: now - 14 * 86400000 });
        await scheduler.checkAndUpload(now);
        expect(uploadJsonToS3).not.toHaveBeenCalled();
    });
    test('UTC daily and Sunday-week boundaries do not depend on scheduler check time', () => {
        expect(completedInterval('daily', now)).toEqual({ start: Date.UTC(2026, 8, 8), end: Date.UTC(2026, 8, 9) });
        expect(completedInterval('weekly', now)).toEqual({ start: Date.UTC(2026, 7, 30), end: Date.UTC(2026, 8, 6) });
    });
    test('failure does not advance; next check retries the identical object', async () => {
        uploadJsonToS3.mockResolvedValue(false);
        await scheduler.checkAndUpload(now);
        expect(state).toBeNull();
        const firstKey = uploadJsonToS3.mock.calls[0][1];
        uploadJsonToS3.mockResolvedValue(true);
        await scheduler.checkAndUpload(now + 300000);
        expect(uploadJsonToS3.mock.calls[2][1]).toBe(firstKey);
        expect(state.daily.end).toBe(Date.UTC(2026, 8, 9));
        expect(scheduler.analyticsService.getAnalytics).toHaveBeenCalledWith('all', expect.objectContaining({ timeBasis: 'realized', startTime: Date.UTC(2026, 8, 8), endTime: Date.UTC(2026, 8, 9) }));
        expect(uploadJsonToS3.mock.calls[2][3]).toEqual({ immutable: true });
    });
    test('restart loads successful checkpoints and avoids uploading completed periods again', async () => {
        uploadJsonToS3.mockResolvedValue(true);
        await scheduler.checkAndUpload(now);
        scheduler.checkpointsLoaded = false;
        scheduler.checkpoints = {};
        uploadJsonToS3.mockClear();
        await scheduler.checkAndUpload(now + 600000);
        expect(uploadJsonToS3).not.toHaveBeenCalled();
    });
    test('a restart after missed days drains each completed interval in order', async () => {
        state = { daily: { end: Date.UTC(2026, 8, 6) }, weekly: { end: Date.UTC(2026, 8, 6) } };
        uploadJsonToS3.mockResolvedValue(true);
        await scheduler.checkAndUpload(now);
        expect(uploadJsonToS3.mock.calls.map((call) => call[2].endExclusive)).toEqual([
            '2026-09-07T00:00:00.000Z', '2026-09-08T00:00:00.000Z', '2026-09-09T00:00:00.000Z',
        ]);
    });
    test('failed checkpoint persistence retries safely and overlapping scheduler calls are skipped', async () => {
        let release;
        uploadJsonToS3.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const first = scheduler.checkAndUpload(now);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(await scheduler.checkAndUpload(now)).toBe(false);
        scheduler.stateRepository.setState.mockRejectedValue(new Error('disk full'));
        release(true);
        expect(await first).toBe(false);
        expect(scheduler.checkpoints).toEqual({});
    });
});
