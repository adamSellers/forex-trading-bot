// backend/src/services/analyticsService.js - LIVE PRODUCTION
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

        // Buffer for S3 signal logs
        this.signalLogBuffer = [];
        this.signalLogUploadInterval = 15 * 60 * 1000; // 15 minutes
        this.signalLogScheduler = null;
    }

    /**
     * Generates aggregated performance stats for the Dashboard.
     * CRITICAL FIX: Ensures we look for closed trades, not just "SELL" sides.
     */
    async getPerformanceAnalytics(period = "30d") {
        try {
            const [tradeMetrics, signalStats] = await Promise.all([
                this.tradeRepo.getPerformanceMetrics(period, "live"),
                this.signalRepo.getSignalStats(period),
            ]);

            return {
                period,
                timestamp: Date.now(),
                trading: tradeMetrics,
                signals: signalStats,
                efficiency: this.calculateEfficiency(tradeMetrics, signalStats),
            };
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
            // Simplified: defaults to 30 days if not specified
            avgTradesPerDay: (tradeMetrics.totalTrades / 30).toFixed(2),
            signalQuality: this.assessSignalQuality(tradeMetrics, signalStats),
        };
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
            // Assets derived from live config or defaults
            const assets = this.config.assets || ["BTCUSDT", "ETHUSDT"];
            const analytics = {};

            for (const asset of assets) {
                const [trades, signals] = await Promise.all([
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
        if (!trades || !trades.length) return null;

        // --- FIX: Filter for CLOSED trades (Phantom Sell Fix) ---
        const completedTrades = trades.filter(
            (t) =>
                t.status === "CLOSED" || (t.pnl !== null && t.pnl !== undefined)
        );

        if (!completedTrades.length) return null;

        const totalPnL = completedTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );
        const winningTrades = completedTrades.filter((t) => t.pnl > 0);
        const winRate = (winningTrades.length / completedTrades.length) * 100;

        return {
            totalPnL,
            winRate,
            totalTrades: completedTrades.length,
            bestTrade: Math.max(
                ...completedTrades.map((t) => t.pnl || -Infinity)
            ),
            worstTrade: Math.min(
                ...completedTrades.map((t) => t.pnl || Infinity)
            ),
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
            const [analytics, assetAnalytics] = await Promise.all([
                this.getPerformanceAnalytics("1d"),
                this.getAssetAnalytics(),
            ]);

            return {
                date: new Date().toISOString().split("T")[0],
                summary: analytics,
                assets: assetAnalytics,
                recommendations: this.generateRecommendations(
                    analytics,
                    assetAnalytics
                ),
            };
        } catch (error) {
            logger.error("Error generating daily report:", error);
            throw error;
        }
    }

    generateRecommendations(analytics, assetAnalytics) {
        const recommendations = [];

        if (analytics.trading && analytics.trading.winRate < 40) {
            recommendations.push({
                type: "warning",
                message:
                    "Win rate below 40%. Consider adjusting strategy parameters.",
                priority: "high",
            });
        }

        // Alert on heavy asset losses
        Object.entries(assetAnalytics).forEach(([asset, data]) => {
            if (data.performance && data.performance.totalPnL < -50) {
                recommendations.push({
                    type: "warning",
                    message: `${asset} showing significant losses. Review allocation.`,
                    priority: "high",
                });
            }
        });

        return recommendations;
    }

    // --- S3 INTEGRATION ---

    async uploadPerformanceReportToS3() {
        if (process.env.ENABLE_S3_ANALYTICS !== "true") return;

        try {
            const report = await this.tradingEngine.getPortfolioSummary();
            report.reportGeneratedAt = new Date().toISOString();

            const s3Key = `performance-report-${
                new Date().toISOString().split("T")[0]
            }.json`;

            await awsS3Utils.uploadJsonToS3(
                process.env.S3_BUCKET_NAME,
                s3Key,
                report
            );
            logger.info(`S3: Performance report uploaded (${s3Key})`);
        } catch (error) {
            logger.error("S3 Upload Error:", error);
        }
    }

    startS3UploadScheduler() {
        if (process.env.ENABLE_S3_ANALYTICS !== "true") return;

        logger.info(
            `Starting S3 upload scheduler (${
                UPLOAD_INTERVAL / 3600000
            }h interval)`
        );
        setInterval(() => this.uploadPerformanceReportToS3(), UPLOAD_INTERVAL);

        if (this.config.enableS3SignalLogging) {
            this.signalLogScheduler = setInterval(
                () => this.uploadSignalLogBatchToS3(),
                this.signalLogUploadInterval
            );
        }
        // Initial upload on boot
        this.uploadPerformanceReportToS3();
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    // --- SIGNAL LOGGING ---

    bufferSignalForS3(signal, currentPrice) {
        if (!this.config.enableS3SignalLogging) return;

        this.signalLogBuffer.push({
            timestamp: new Date().toISOString(),
            price: currentPrice,
            signal: signal,
        });
    }

    async uploadSignalLogBatchToS3() {
        if (this.signalLogBuffer.length === 0) return;

        const batchToUpload = [...this.signalLogBuffer];
        this.signalLogBuffer = []; // Clear buffer immediately

        try {
            const date = new Date();
            const dateStr = date.toISOString().split("T")[0];
            const timeStr = date.toISOString().replace(/:/g, "-");
            const s3Key = `signal-log/${dateStr}/signals_${timeStr}.json`;

            // Simplified: Always use primary bucket
            await awsS3Utils.uploadJsonToS3(
                process.env.S3_BUCKET_NAME,
                s3Key,
                batchToUpload
            );
            logger.info(`S3: Uploaded ${batchToUpload.length} signals.`);
        } catch (error) {
            logger.error("S3 Signal Upload Error:", error);
            // Re-queue signals on failure
            this.signalLogBuffer.unshift(...batchToUpload);
        }
    }
}

module.exports = AnalyticsService;
