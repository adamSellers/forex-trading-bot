// backend/src/repositories/signalRepository.js
const db = require("../../config/database");
const logger = require("../utils/logger");

class SignalRepository {
    async save(signal) {
        try {
            if (!signal || !signal.symbol || !signal.signal) {
                logger.warn("Invalid signal data, skipping save");
                return;
            }

            await db("signals").insert({
                symbol: signal.symbol,
                signal: signal.signal,
                strength: signal.strength || 0,
                strategy: signal.strategy || "unknown",
                timeframe: signal.timeframe || "1h",
                current_price: signal.currentPrice || null,
                message: signal.message || "",
                atr: signal.atr || null,
                trend_data: signal.trend ? JSON.stringify(signal.trend) : null,
                timestamp: new Date(signal.timestamp || Date.now()),
                created_at: new Date(),
            });

            logger.debug(
                "Signal saved to database:",
                signal.symbol,
                signal.signal
            );
        } catch (error) {
            logger.error("Error saving signal:", error);
            // Don't throw - continue operation without database
        }
    }

    async saveBatch(signals) {
        try {
            const validSignals = signals.filter(
                (signal) => signal && signal.symbol && signal.signal
            );

            if (validSignals.length === 0) {
                logger.warn("No valid signals to save");
                return;
            }

            const signalRecords = validSignals.map((signal) => ({
                symbol: signal.symbol,
                signal: signal.signal,
                strength: signal.strength || 0,
                strategy: signal.strategy || "unknown",
                timeframe: signal.timeframe || "1h",
                current_price: signal.currentPrice || null,
                message: signal.message || "",
                atr: signal.atr || null,
                trend_data: signal.trend ? JSON.stringify(signal.trend) : null,
                timestamp: new Date(signal.timestamp || Date.now()),
                created_at: new Date(),
            }));

            await db("signals").insert(signalRecords);
            logger.debug(`${signalRecords.length} signals saved to database`);
        } catch (error) {
            logger.error("Error saving signal batch:", error);
            // Don't throw - continue operation without database
        }
    }

    async getRecent(limit = 50) {
        try {
            return await db("signals")
                .orderBy("timestamp", "desc")
                .limit(limit);
        } catch (error) {
            logger.error("Error getting recent signals:", error);
            return [];
        }
    }

    async getBySymbol(symbol, limit = 50) {
        try {
            return await db("signals")
                .where("symbol", symbol)
                .orderBy("timestamp", "desc")
                .limit(limit);
        } catch (error) {
            logger.error("Error getting signals by symbol:", error);
            return [];
        }
    }

    async getSignalsSince(cutoffTime) {
        try {
            return await db("signals")
                .where("timestamp", ">=", cutoffTime)
                .orderBy("timestamp", "desc");
        } catch (error) {
            logger.error("Error getting signals since cutoff:", error);
            throw error;
        }
    }

    async getSignalStats(period = "24h") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = new Date(Date.now() - periodMs);

            const signals = await db("signals").where(
                "timestamp",
                ">=",
                cutoffTime
            );

            return this.calculateSignalStats(signals);
        } catch (error) {
            logger.error("Error getting signal stats:", error);
            return null;
        }
    }

    parsePeriod(period) {
        const periods = {
            "1h": 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
        };
        return periods[period] || periods["24h"];
    }

    calculateSignalStats(signals) {
        const stats = {
            total: signals.length,
            byType: {},
            byAsset: {},
            averageStrength: 0,
        };

        let totalStrength = 0;

        signals.forEach((signal) => {
            // Count by signal type
            stats.byType[signal.signal] =
                (stats.byType[signal.signal] || 0) + 1;

            // Count by asset
            stats.byAsset[signal.symbol] =
                (stats.byAsset[signal.symbol] || 0) + 1;

            // Sum strength
            totalStrength += signal.strength || 0;
        });

        stats.averageStrength =
            signals.length > 0 ? totalStrength / signals.length : 0;

        return stats;
    }
}

module.exports = SignalRepository;
