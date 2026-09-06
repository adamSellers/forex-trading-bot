// Reports use completed UTC intervals and immutable object keys. Upload success is
// checkpointed only after S3 acknowledgement; restart/retry never advances on failure.
const { uploadJsonToS3, isS3Configured } = require("../utils/awsS3Utils");
const AnalyticsService = require("./analyticsService");
const logger = require("../utils/logger");
const DAY = 86400000;
const STATE_KEY = "analytics-report-checkpoints-v2";

function completedInterval(kind, nowMs = Date.now()) {
    const day = Math.floor(nowMs / DAY) * DAY;
    const end = kind === "weekly" ? day - new Date(day).getUTCDay() * DAY : day;
    return { start: end - (kind === "weekly" ? 7 : 1) * DAY, end };
}

class S3ReportScheduler {
    constructor(tradeRepository, signalRepository, entryDecisionRepository = null, stateRepository = null, options = {}) {
        this.analyticsService = new AnalyticsService(tradeRepository, signalRepository, entryDecisionRepository);
        this.stateRepository = stateRepository;
        this.reconcileForReport = options.reconcileForReport;
        this.performanceBucket = process.env.S3_BUCKET_NAME;
        this.signalBucket = process.env.S3_BUCKET_FOR_SIGNALS;
        this.isRunning = false;
        this.schedulerInterval = null;
        this.inFlight = false;
        this.checkpoints = {};
        this.checkpointsLoaded = false;
        this.lastError = null;
        this.lastDailyUpload = null;
        this.lastWeeklyUpload = null;
    }

    start() {
        if (this.isRunning) return;
        const status = this.getStatus();
        if (!status.configured) { logger.warn(`S3 reports disabled: ${status.disabledReason}`); return; }
        this.isRunning = true;
        this.schedulerInterval = setInterval(() => this.checkAndUpload(), 5 * 60 * 1000);
        this.schedulerInterval.unref?.();
        void this.checkAndUpload();
    }

    stop() {
        if (this.schedulerInterval) clearInterval(this.schedulerInterval);
        this.schedulerInterval = null;
        this.isRunning = false;
    }

    async checkAndUpload(nowMs = Date.now()) {
        if (this.inFlight) return false;
        this.inFlight = true;
        try {
            if (!this.checkpointsLoaded) {
                this.checkpoints = await this.stateRepository?.getState(STATE_KEY) || {};
                this.checkpointsLoaded = true;
            }
            for (const kind of ["daily", "weekly"]) {
                const latest = completedInterval(kind, nowMs);
                const width = kind === "weekly" ? 7 * DAY : DAY;
                let end = this.checkpoints[kind]?.end ? this.checkpoints[kind].end + width : latest.end;
                // Bound each pass on the Pi; persistent checkpoints drain an outage
                // backlog over later checks without skipping completed intervals.
                for (let attempt = 0; attempt < 14 && end <= latest.end; attempt++, end += width) {
                    if (!await this.uploadInterval(kind, { start: end - width, end })) break;
                    const checkpoint = { end, uploadedAt: nowMs };
                    const next = { ...this.checkpoints, [kind]: checkpoint };
                    if (this.stateRepository) await this.stateRepository.setState(STATE_KEY, next);
                    this.checkpoints = next;
                    this[kind === "daily" ? "lastDailyUpload" : "lastWeeklyUpload"] = new Date(nowMs);
                }
            }
            return true;
        } catch (error) {
            this.lastError = error.message;
            logger.error("Report checkpoint/upload failed", { message: error.message });
            return false;
        } finally { this.inFlight = false; }
    }

    async uploadInterval(kind, interval) {
        try {
            if (!this.reconcileForReport) throw new Error("Report finalization requires broker reconciliation");
            const broker = await this.reconcileForReport();
            if (!broker || broker.brokerStateUncertain !== false ||
                !(broker.lastBrokerReconciledAt >= interval.end) ||
                Number(broker.pendingOrderIntentCount) > 0 || broker.pendingOrderIntents?.length ||
                Number(broker.quarantinedBrokerPositions) > 0 ||
                broker.openTrades?.some((trade) => /PENDING|UNRESOLVED|UNPERSISTED|PARTIAL/.test(trade.reconciliationStatus || ""))) {
                throw new Error("Report finalization deferred: broker accounting is unresolved after the interval boundary");
            }
            const start = new Date(interval.start).toISOString();
            const endExclusive = new Date(interval.end).toISOString();
            const analytics = await this.analyticsService.getAnalytics("all", {
                mode: "live", startTime: interval.start, endTime: interval.end, timeBasis: "realized",
            });
            const key = `v2/${kind}/${start.slice(0, 10)}_to_${endExclusive.slice(0, 10)}/analytics.json`;
            const success = await uploadJsonToS3(this.performanceBucket, key, {
                schemaVersion: 2, reportType: kind, scope: "all-live", start, endExclusive,
                generatedAt: new Date().toISOString(), analytics,
            }, { immutable: true });
            this.lastError = success ? null : `Upload failed: ${key}`;
            return success;
        } catch (error) {
            this.lastError = error.message;
            logger.error("Analytics report failed", { message: error.message });
            return false;
        }
    }

    uploadDailyReport() { return this.uploadInterval("daily", completedInterval("daily")); }
    uploadWeeklyReport() { return this.uploadInterval("weekly", completedInterval("weekly")); }

    async forceUpload(period = "24h") {
        try {
            if (!["24h", "7d", "30d", "90d", "all"].includes(period)) throw new Error("Invalid report period");
            const analytics = await this.analyticsService.getAnalytics(period, { mode: "live", timeBasis: "realized" });
            const key = `manual/${new Date().toISOString().replace(/[:.]/g, "-")}/analytics-${period}.json`;
            const success = await uploadJsonToS3(this.performanceBucket, key, {
                schemaVersion: 2, reportType: "manual", scope: "all-live", period, analytics,
            }, { immutable: true });
            return { success, key };
        } catch (error) { return { success: false, error: error.message }; }
    }

    getStatus() {
        const enabled = process.env.ENABLE_S3_ANALYTICS === "true";
        const configured = enabled && Boolean(this.performanceBucket) && isS3Configured();
        return {
            isRunning: this.isRunning, enabled, configured, inFlight: this.inFlight,
            disabledReason: !enabled ? "Configuration disabled" : !this.performanceBucket ? "Bucket missing" : !isS3Configured() ? "Credentials/region incomplete" : null,
            performanceBucket: this.performanceBucket || null,
            signalBucket: this.signalBucket || null,
            lastDailyUpload: this.lastDailyUpload?.toISOString() || null,
            lastWeeklyUpload: this.lastWeeklyUpload?.toISOString() || null,
            checkpoints: this.checkpoints, lastError: this.lastError,
            schedule: "Completed UTC days and Sunday-to-Sunday weeks; retries every 5 minutes; immutable v2 keys",
        };
    }
}
module.exports = S3ReportScheduler;
module.exports.completedInterval = completedInterval;
