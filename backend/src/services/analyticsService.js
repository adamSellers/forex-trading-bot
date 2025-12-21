// backend/src/services/analyticsService.js - COMPLETE & UNIFIED
const TradeRepository = require("../repositories/tradeRepository");
const SignalRepository = require("../repositories/signalRepository");
const awsS3Utils = require("../utils/awsS3Utils");
const logger = require("../utils/logger");

const UPLOAD_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const CRYPTO_TRADING_DAYS_PER_YEAR = 365;

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
     * Core Method: Generates aggregated performance stats for Dashboard & Reporting.
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

    /**
     * New Method: Calculates Advanced Stats (Sharpe, Volatility) for the /performance route.
     * Replaces manual math previously done in trading.js routes.
     */
    async getDetailedPerformance(period = "30d") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            // Fetch raw trades to calculate standard deviation/holding period
            const trades = await this.tradeRepo.getTradesSince(
                cutoffTime,
                "live"
            );

            // Filter strictly for CLOSED trades
            const completedTrades = trades.filter(
                (t) => t.pnl !== null && t.pnl !== undefined && !t.isOpen
            );

            // Get basic metrics from repo
            const metrics =
                (await this.tradeRepo.calculateMetrics(completedTrades)) || {};

            // Calculate Advanced Metrics
            const tradeReturns = completedTrades.map((t) => t.pnlPercent || 0);
            const tradingFrequency = this.calculateTradingFrequency(
                completedTrades,
                period
            );

            return {
                ...metrics,
                sharpeRatio: this.calculateSharpeRatio(
                    tradeReturns,
                    tradingFrequency
                ),
                volatility: this.calculateVolatility(
                    tradeReturns,
                    tradingFrequency
                ),
                avgHoldingPeriod:
                    this.calculateAvgHoldingPeriod(completedTrades),
                tradingFrequency,
                totalReturn: metrics.totalPnL || 0,
                // Pass through best/worst from repo logic or calculate if missing
                bestTrade:
                    metrics.avgWin > 0
                        ? Math.max(...completedTrades.map((t) => t.pnl))
                        : 0,
                worstTrade:
                    metrics.avgLoss > 0
                        ? Math.min(...completedTrades.map((t) => t.pnl))
                        : 0,
            };
        } catch (error) {
            logger.error("Error generating detailed performance:", error);
            throw error;
        }
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

    // --- MATH HELPERS (Moved from Routes) ---

    calculateSharpeRatio(returns, frequency) {
        if (returns.length < 2) return 0;
        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
        const std = Math.sqrt(
            returns.reduce((a, b) => a + Math.pow(b - avg, 2), 0) /
                (returns.length - 1)
        );
        return std === 0
            ? 0
            : (avg / std) * Math.sqrt(frequency * CRYPTO_TRADING_DAYS_PER_YEAR);
    }

    calculateVolatility(returns, frequency) {
        if (returns.length < 2) return 0;
        const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
        const std = Math.sqrt(
            returns.reduce((a, b) => a + Math.pow(b - avg, 2), 0) /
                (returns.length - 1)
        );
        return std * Math.sqrt(frequency * CRYPTO_TRADING_DAYS_PER_YEAR);
    }

    calculateTradingFrequency(trades, period) {
        if (trades.length < 2) return 0;
        const days =
            { "1h": 1 / 24, "24h": 1, "7d": 7, "30d": 30 }[period] || 30;
        return trades.length / days;
    }

    calculateAvgHoldingPeriod(trades) {
        const valid = trades.filter((x) => x.holdingPeriod);
        return valid.length
            ? valid.reduce((a, b) => a + b.holdingPeriod, 0) / valid.length
            : 0;
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

    calculateAssetPerformance(trades) {
        if (!trades || !trades.length) return null;

        const completedTrades = trades.filter(
            (t) => t.pnl !== null && t.pnl !== undefined && !t.isOpen
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

    parsePeriod(p) {
        const m = {
            "1h": 3600000,
            "24h": 86400000,
            "7d": 604800000,
            "30d": 2592000000,
        };
        return m[p] || m["30d"];
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
        this.signalLogBuffer = [];

        try {
            const date = new Date();
            const dateStr = date.toISOString().split("T")[0];
            const timeStr = date.toISOString().replace(/:/g, "-");
            const s3Key = `signal-log/${dateStr}/signals_${timeStr}.json`;

            await awsS3Utils.uploadJsonToS3(
                process.env.S3_BUCKET_NAME,
                s3Key,
                batchToUpload
            );
            logger.info(`S3: Uploaded ${batchToUpload.length} signals.`);
        } catch (error) {
            logger.error("S3 Signal Upload Error:", error);
            this.signalLogBuffer.unshift(...batchToUpload);
        }
    }
}

module.exports = AnalyticsService;
