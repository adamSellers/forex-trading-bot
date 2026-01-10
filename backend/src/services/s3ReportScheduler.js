// backend/src/services/s3ReportScheduler.js
// Scheduled upload of analytics reports to S3

const { uploadJsonToS3 } = require("../utils/awsS3Utils");
const AnalyticsService = require("./analyticsService");
const logger = require("../utils/logger");

class S3ReportScheduler {
    constructor(tradeRepository, signalRepository) {
        this.tradeRepo = tradeRepository;
        this.signalRepo = signalRepository;
        this.analyticsService = new AnalyticsService(tradeRepository, signalRepository);
        this.schedulerInterval = null;
        this.isRunning = false;

        // Buckets from environment
        this.performanceBucket = process.env.S3_BUCKET_NAME;
        this.signalBucket = process.env.S3_BUCKET_FOR_SIGNALS;

        // Track last upload times
        this.lastDailyUpload = null;
        this.lastWeeklyUpload = null;
    }

    /**
     * Start the scheduler - checks every hour if reports need uploading
     */
    start() {
        if (process.env.ENABLE_S3_ANALYTICS !== "true") {
            logger.info("☁️  S3 report scheduler disabled (ENABLE_S3_ANALYTICS !== true)");
            return;
        }

        if (!this.performanceBucket) {
            logger.warn("⚠️  S3_BUCKET_NAME not set - report uploads disabled");
            return;
        }

        this.isRunning = true;

        // Check every hour if we need to upload
        this.schedulerInterval = setInterval(() => {
            this.checkAndUpload();
        }, 60 * 60 * 1000); // 1 hour

        // Also run immediately on start
        this.checkAndUpload();

        logger.info(`☁️  S3 report scheduler started (bucket: ${this.performanceBucket})`);
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
        this.isRunning = false;
        logger.info("☁️  S3 report scheduler stopped");
    }

    /**
     * Check if reports need uploading and do so
     */
    async checkAndUpload() {
        const now = new Date();
        const hour = now.getUTCHours();
        const dayOfWeek = now.getUTCDay(); // 0 = Sunday

        // Daily report at 00:00 UTC (or first check after midnight)
        if (this.shouldUploadDaily(now)) {
            await this.uploadDailyReport();
            this.lastDailyUpload = now;
        }

        // Weekly report on Sunday at 00:00 UTC
        if (dayOfWeek === 0 && this.shouldUploadWeekly(now)) {
            await this.uploadWeeklyReport();
            this.lastWeeklyUpload = now;
        }
    }

    /**
     * Check if we should upload daily report
     */
    shouldUploadDaily(now) {
        if (!this.lastDailyUpload) return true;

        const lastDate = this.lastDailyUpload.toISOString().split("T")[0];
        const nowDate = now.toISOString().split("T")[0];

        return lastDate !== nowDate;
    }

    /**
     * Check if we should upload weekly report
     */
    shouldUploadWeekly(now) {
        if (!this.lastWeeklyUpload) return true;

        // Check if it's been at least 6 days since last weekly
        const daysSinceLastWeekly = (now - this.lastWeeklyUpload) / (1000 * 60 * 60 * 24);
        return daysSinceLastWeekly >= 6;
    }

    /**
     * Upload daily analytics report
     */
    async uploadDailyReport() {
        try {
            const analytics = await this.analyticsService.getAnalytics("24h", "live");
            const dateStr = new Date().toISOString().split("T")[0];
            const key = `daily/${dateStr}/analytics.json`;

            const report = {
                reportType: "daily",
                date: dateStr,
                generatedAt: new Date().toISOString(),
                analytics,
            };

            const success = await uploadJsonToS3(this.performanceBucket, key, report);

            if (success) {
                logger.info(`☁️  Daily report uploaded to S3: ${key}`);
            }

            return success;
        } catch (error) {
            logger.error("Failed to upload daily report:", error);
            return false;
        }
    }

    /**
     * Upload weekly analytics report
     */
    async uploadWeeklyReport() {
        try {
            const analytics = await this.analyticsService.getAnalytics("7d", "live");
            const dateStr = new Date().toISOString().split("T")[0];
            const weekNum = this.getWeekNumber(new Date());
            const key = `weekly/${new Date().getFullYear()}/week-${weekNum}/analytics.json`;

            const report = {
                reportType: "weekly",
                weekNumber: weekNum,
                endDate: dateStr,
                generatedAt: new Date().toISOString(),
                analytics,
            };

            const success = await uploadJsonToS3(this.performanceBucket, key, report);

            if (success) {
                logger.info(`☁️  Weekly report uploaded to S3: ${key}`);
            }

            return success;
        } catch (error) {
            logger.error("Failed to upload weekly report:", error);
            return false;
        }
    }

    /**
     * Force upload current analytics (for manual trigger)
     */
    async forceUpload(period = "24h") {
        try {
            const analytics = await this.analyticsService.getAnalytics(period, "live");
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const key = `manual/${timestamp}/analytics-${period}.json`;

            const report = {
                reportType: "manual",
                period,
                generatedAt: new Date().toISOString(),
                analytics,
            };

            const success = await uploadJsonToS3(this.performanceBucket, key, report);

            if (success) {
                logger.info(`☁️  Manual report uploaded to S3: ${key}`);
            }

            return { success, key };
        } catch (error) {
            logger.error("Failed to upload manual report:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get ISO week number
     */
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            enabled: process.env.ENABLE_S3_ANALYTICS === "true",
            performanceBucket: this.performanceBucket || "not configured",
            signalBucket: this.signalBucket || "not configured",
            lastDailyUpload: this.lastDailyUpload?.toISOString() || null,
            lastWeeklyUpload: this.lastWeeklyUpload?.toISOString() || null,
        };
    }
}

module.exports = S3ReportScheduler;
