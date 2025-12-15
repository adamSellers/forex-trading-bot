// backend/src/services/analyticsService.js
const TradeRepository = require("../repositories/tradeRepository");
const SignalRepository = require("../repositories/signalRepository");
const awsS3Utils = require("../utils/awsS3Utils");
const logger = require("../utils/logger");
const UPLOAD_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

class AnalyticsService {
    constructor(tradingEngine) {
        this.tradeRepo = new TradeRepository();
        this.signalRepo = new SignalRepository();
        this.tradingEngine = tradingEngine;
        this.config = tradingEngine.config;

        // Buffer for S3 signal logs to reduce PUT requests
        this.signalLogBuffer = [];
        this.signalLogUploadInterval = 15 * 60 * 1000; // Upload every 15 minutes
        this.signalLogScheduler = null;
    }

    async getPerformanceAnalytics(period = "30d") {
        try {
            logger.debug(
                "Generating performance analytics (LIVE) for period:",
                period
            );

            const [tradeMetrics, signalStats] = await Promise.all([
                // FIX: Explicitly request 'live' mode to ignore old paper data
                this.tradeRepo.getPerformanceMetrics(period, "live"),
                this.signalRepo.getSignalStats(period),
            ]);

            const analytics = {
                period,
                timestamp: Date.now(),
                trading: tradeMetrics,
                signals: signalStats,
                efficiency: this.calculateEfficiency(tradeMetrics, signalStats),
            };

            return analytics;
        } catch (error) {
            logger.error("Error generating performance analytics:", error);
            throw error;
        }
    }

    calculateEfficiency(tradeMetrics, signalStats) {
        if (!tradeMetrics || !signalStats) return null;

        const signalToTradeRatio =
            signalStats.total > 0
                ? tradeMetrics.totalTrades / signalStats.total
                : 0;

        return {
            signalToTradeRatio,
            conversionRate: (signalToTradeRatio * 100).toFixed(1) + "%",
            avgTradesPerDay: this.calculateDailyTradingFrequency(tradeMetrics),
            signalQuality: this.assessSignalQuality(tradeMetrics, signalStats),
        };
    }

    calculateDailyTradingFrequency(tradeMetrics) {
        if (!tradeMetrics || tradeMetrics.totalTrades === 0) return 0;

        // Assuming 30-day period for now
        return (tradeMetrics.totalTrades / 30).toFixed(2);
    }

    assessSignalQuality(tradeMetrics, signalStats) {
        if (!tradeMetrics || !signalStats) return "Unknown";

        const winRate = tradeMetrics.winRate || 0;
        const avgStrength = signalStats.averageStrength || 0;

        if (winRate > 60 && avgStrength > 2.0) return "Excellent";
        if (winRate > 45 && avgStrength > 1.5) return "Good";
        if (winRate > 35 && avgStrength > 1.0) return "Fair";
        return "Poor";
    }

    async getAssetAnalytics() {
        try {
            const assets = [
                "BTCUSDT",
                "ETHUSDT",
                "BNBUSDT",
                "DOGEUSDT",
                "TRUMPUSDT",
            ];
            const analytics = {};

            for (const asset of assets) {
                const [trades, signals] = await Promise.all([
                    // FIX: Explicitly request 'live' mode
                    this.tradeRepo.getBySymbol(asset, 100, "live"),
                    this.signalRepo.getBySymbol(asset, 100),
                ]);

                analytics[asset] = {
                    totalTrades: trades.length,
                    totalSignals: signals.length,
                    performance: this.calculateAssetPerformance(trades),
                    signalDistribution: this.analyzeSignalDistribution(signals),
                };
            }

            return analytics;
        } catch (error) {
            logger.error("Error generating asset analytics:", error);
            throw error;
        }
    }

    calculateAssetPerformance(trades) {
        if (!trades.length) return null;

        const sellTrades = trades.filter(
            (t) => t.side === "SELL" && t.pnl !== null
        );
        if (!sellTrades.length) return null;

        const totalPnL = sellTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const winningTrades = sellTrades.filter((t) => t.pnl > 0);
        const winRate = (winningTrades.length / sellTrades.length) * 100;

        return {
            totalPnL,
            winRate,
            totalTrades: sellTrades.length,
            bestTrade: Math.max(...sellTrades.map((t) => t.pnl)),
            worstTrade: Math.min(...sellTrades.map((t) => t.pnl)),
        };
    }

    analyzeSignalDistribution(signals) {
        const distribution = {};

        signals.forEach((signal) => {
            const type = signal.signal;
            distribution[type] = (distribution[type] || 0) + 1;
        });

        return distribution;
    }

    async generateDailyReport() {
        try {
            logger.info("Generating daily performance report...");

            const [analytics, assetAnalytics] = await Promise.all([
                this.getPerformanceAnalytics("1d"),
                this.getAssetAnalytics(),
            ]);

            const report = {
                date: new Date().toISOString().split("T")[0],
                summary: analytics,
                assets: assetAnalytics,
                recommendations: this.generateRecommendations(
                    analytics,
                    assetAnalytics
                ),
            };

            logger.info("Daily report generated successfully");
            return report;
        } catch (error) {
            logger.error("Error generating daily report:", error);
            throw error;
        }
    }

    generateRecommendations(analytics, assetAnalytics) {
        const recommendations = [];

        // Check overall performance
        if (analytics.trading && analytics.trading.winRate < 40) {
            recommendations.push({
                type: "warning",
                message:
                    "Win rate below 40%. Consider adjusting strategy parameters.",
                priority: "high",
            });
        }

        // Check signal efficiency
        if (
            analytics.efficiency &&
            analytics.efficiency.signalToTradeRatio < 0.3
        ) {
            recommendations.push({
                type: "info",
                message:
                    "Low signal-to-trade conversion. Review signal strength thresholds.",
                priority: "medium",
            });
        }

        // Check asset-specific performance
        Object.entries(assetAnalytics).forEach(([asset, data]) => {
            if (data.performance && data.performance.totalPnL < -50) {
                recommendations.push({
                    type: "warning",
                    message: `${asset} showing significant losses. Consider reducing allocation.`,
                    priority: "high",
                });
            }
        });

        return recommendations;
    }

    /**
     * Uploads the performance report to S3.
     */
    async uploadPerformanceReportToS3() {
        if (process.env.ENABLE_S3_ANALYTICS !== "true") {
            logger.info("S3 analytics upload is disabled. Skipping upload.");
            return;
        }

        try {
            logger.info("Generating and uploading performance report to S3...");

            const report = await this.tradingEngine.getPortfolioSummary();
            report.reportGeneratedAt = new Date().toISOString();

            const s3Key = `performance-report-${
                new Date().toISOString().split("T")[0]
            }.json`;

            const uploadResult = await awsS3Utils.uploadJsonToS3(
                process.env.S3_BUCKET_NAME,
                s3Key,
                report
            );

            if (uploadResult) {
                logger.info(`Performance report uploaded to S3: ${s3Key}`);
            } else {
                logger.error("Failed to upload performance report to S3.");
            }
        } catch (error) {
            logger.error("Error during S3 performance report upload:", error);
        }
    }

    /**
     * Schedules the upload of the performance report to S3.
     */
    startS3UploadScheduler() {
        if (process.env.ENABLE_S3_ANALYTICS !== "true") {
            logger.info("S3 analytics upload is disabled. Skipping scheduler.");
            return;
        }

        logger.info(
            `Starting S3 upload scheduler. Interval: ${
                UPLOAD_INTERVAL / (60 * 60 * 1000)
            } hours`
        );
        setInterval(() => this.uploadPerformanceReportToS3(), UPLOAD_INTERVAL);

        if (this.config.enableS3SignalLogging) {
            logger.info(
                `Starting S3 signal log batch uploader. Interval: ${
                    this.signalLogUploadInterval / 60000
                } minutes`
            );
            this.signalLogScheduler = setInterval(
                () => this.uploadSignalLogBatchToS3(),
                this.signalLogUploadInterval
            );
        }
        this.uploadPerformanceReportToS3(); // Initial upload
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Buffers a raw signal for batch upload.
     */
    bufferSignalForS3(signal, currentPrice) {
        if (!this.config.enableS3SignalLogging) {
            return;
        }

        const signalData = {
            timestamp: new Date().toISOString(),
            price: currentPrice,
            signal: signal,
        };
        this.signalLogBuffer.push(signalData);
        logger.debug(
            `Signal for ${signal.symbol} buffered for S3 upload. Buffer size: ${this.signalLogBuffer.length}`
        );
    }

    /**
     * Uploads the buffered signals to S3 as a single batch file.
     */
    async uploadSignalLogBatchToS3() {
        if (this.signalLogBuffer.length === 0) {
            logger.debug(
                "S3 signal log buffer is empty. Skipping batch upload."
            );
            return;
        }

        const batchToUpload = [...this.signalLogBuffer];
        this.signalLogBuffer = [];

        logger.info(
            `Uploading signal batch of ${batchToUpload.length} signals to S3...`
        );

        try {
            const date = new Date();
            const dateString = date.toISOString().split("T")[0];
            const timeString = date.toISOString().replace(/:/g, "-");
            const s3Key = `signal-log/${dateString}/signals_${timeString}.json`;

            const bucketName =
                process.env.S3_SIGNAL_LOG_BUCKET_NAME ||
                process.env.S3_BUCKET_NAME;

            const uploadResult = await awsS3Utils.uploadJsonToS3(
                bucketName,
                s3Key,
                batchToUpload
            );

            if (uploadResult) {
                logger.info(
                    `Successfully uploaded signal batch to S3: ${s3Key}`
                );
            }
        } catch (error) {
            logger.error("Error logging signal to S3:", error);
            this.signalLogBuffer.unshift(...batchToUpload);
        }
    }
}

module.exports = AnalyticsService;
