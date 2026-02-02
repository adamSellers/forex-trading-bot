// backend/src/repositories/signalRepository.js
const { db } = require("../../config/database");
const logger = require("../utils/logger");

class SignalRepository {
    async save(signal) {
        try {
            if (!signal || !signal.symbol || !signal.signal) {
                logger.warn("Invalid signal data, skipping save");
                return;
            }

            // Extract trend data fields
            const trend = signal.trend || {};

            await db("signals").insert({
                instrument: signal.symbol,
                signal: signal.signal,
                strength: signal.strength || 0,
                strategy: signal.strategy || "supertrend_momentum",
                timeframe: signal.timeframe || "15m",
                price: signal.currentPrice || null,
                message: signal.message || "",
                atr_pips: signal.atrPips || signal.atr || null,
                rsi: trend.rsi || null,
                adx: trend.adx || signal.strength || null,
                supertrend_direction: trend.supertrend_direction || null,
                entry_type: signal.entryType || null,
                timestamp: signal.timestamp || Date.now(),
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

            const signalRecords = validSignals.map((signal) => {
                const trend = signal.trend || {};
                return {
                    instrument: signal.symbol,
                    signal: signal.signal,
                    strength: signal.strength || 0,
                    strategy: signal.strategy || "supertrend_momentum",
                    timeframe: signal.timeframe || "15m",
                    price: signal.currentPrice || null,
                    message: signal.message || "",
                    atr_pips: signal.atrPips || signal.atr || null,
                    rsi: trend.rsi || null,
                    adx: trend.adx || signal.strength || null,
                    supertrend_direction: trend.supertrend_direction || null,
                    entry_type: signal.entryType || null,
                    timestamp: signal.timestamp || Date.now(),
                };
            });

            await db("signals").insert(signalRecords);
            logger.debug(`${signalRecords.length} signals saved to database`);
        } catch (error) {
            logger.error("Error saving signal batch:", error);
            // Don't throw - continue operation without database
        }
    }

    async getRecent(limit = 50) {
        try {
            const rows = await db("signals")
                .orderBy("timestamp", "desc")
                .limit(limit);
            // Map instrument back to symbol for frontend consistency
            return rows.map(row => ({ ...row, symbol: row.instrument }));
        } catch (error) {
            logger.error("Error getting recent signals:", error);
            return [];
        }
    }

    async getBySymbol(symbol, limit = 50) {
        try {
            const rows = await db("signals")
                .where("instrument", symbol)
                .orderBy("timestamp", "desc")
                .limit(limit);
            // Map instrument back to symbol for frontend consistency
            return rows.map(row => ({ ...row, symbol: row.instrument }));
        } catch (error) {
            logger.error("Error getting signals by symbol:", error);
            return [];
        }
    }

    async getSignalsSince(cutoffTime) {
        try {
            const rows = await db("signals")
                .where("timestamp", ">=", cutoffTime)
                .orderBy("timestamp", "desc");
            // Map instrument back to symbol for frontend consistency
            return rows.map(row => ({ ...row, symbol: row.instrument }));
        } catch (error) {
            logger.error("Error getting signals since cutoff:", error);
            throw error;
        }
    }

    /**
     * Delete signals older than specified number of days
     * Used for retention policy to keep signals table bounded
     * @param {number} days - Delete signals older than this many days
     * @returns {number} - Number of deleted records
     */
    async deleteOlderThan(days) {
        try {
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            const deleted = await db("signals").where("timestamp", "<", cutoff).del();
            if (deleted > 0) {
                logger.info(`Cleaned up ${deleted} signals older than ${days} days`);
            }
            return deleted;
        } catch (error) {
            logger.error("Error deleting old signals:", error);
            return 0;
        }
    }

    async getSignalStats(period = "24h") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            const rows = await db("signals").where(
                "timestamp",
                ">=",
                cutoffTime
            );
            // Map instrument back to symbol for consistency
            const signals = rows.map(row => ({ ...row, symbol: row.instrument }));

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
