// backend/src/services/analyticsService.js
const TradeRepository = require("../repositories/tradeRepository");
const SignalRepository = require("../repositories/signalRepository");
const LiveTradingEngine = require("./LiveTradingEngine");
const awsS3Utils = require("../utils/awsS3Utils"); // NEW: Import S3 utilities
const logger = require("../utils/logger");
const UPLOAD_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

class AnalyticsService {
    constructor() {
        this.tradeRepo = new TradeRepository();
        this.signalRepo = new SignalRepository();
    }

    async getPerformanceAnalytics(period = "30d") {
        try {
            logger.debug(
                "Generating performance analytics for period:",
                period
            );

            const [tradeMetrics, signalStats] = await Promise.all([
                this.tradeRepo.getPerformanceMetrics(period),
                this.signalRepo.getSignalStats(period),
            ]);

            const analytics = {
                period,
                timestamp: Date.now(),
                trading: tradeMetrics, // OLD: Basic Trade Metrics
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
                    this.tradeRepo.getBySymbol(asset, 100),
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
     * NEW: Uploads the performance report to S3.
     */
    async uploadPerformanceReportToS3() {
        if (process.env.ENABLE_S3_ANALYTICS !== "true") {
            logger.info("S3 analytics upload is disabled. Skipping upload.");
            return;
        }

        try {
            logger.info("Generating and uploading performance report to S3...");

            // 1. Get the latest performance metrics from the LiveTradingEngine
            const tradingEngine = this.tradingEngine;
            const performanceMetrics = tradingEngine.performanceMetrics; // Use the direct, live performanceMetrics object.

            // 2. Generate a comprehensive report object
            const report = {
                timestamp: new Date().toISOString(),
                performanceMetrics,
                // Add other relevant data here (system status, config, etc.)
            };

            // 3. Define the S3 key (filename)
            const s3Key = `performance-report-${
                new Date().toISOString().split("T")[0]
            }.json`;

            // 4. Upload to S3
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
     * NEW: Schedules the upload of the performance report to S3.
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
        this.uploadPerformanceReportToS3(); // Initial upload
    }
}

module.exports = AnalyticsService;
