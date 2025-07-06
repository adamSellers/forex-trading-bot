// backend/src/repositories/tradeRepository.js
const db = require("../../config/database");
const logger = require("../utils/logger");

class TradeRepository {
    async save(trade) {
        try {
            await db("trades").insert({
                trade_id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                total_value: trade.usdtCost || trade.usdtReceived || 0,
                pnl: trade.pnl || 0,
                pnl_percent: trade.pnlPercent || 0,
                signal: trade.signal,
                signal_strength: trade.signalStrength,
                stop_loss: trade.stopLoss || null,
                entry_cost: trade.entryCost || null,
                holding_period: trade.holdingPeriod || null,
                timestamp: new Date(trade.timestamp),
                created_at: new Date(),
            });

            logger.debug("Trade saved to database:", trade.id);
        } catch (error) {
            logger.error("Error saving trade:", error);
            throw error;
        }
    }

    async getRecent(limit = 20) {
        try {
            return await db("trades").orderBy("timestamp", "desc").limit(limit);
        } catch (error) {
            logger.error("Error getting recent trades:", error);
            throw error;
        }
    }

    async getBySymbol(symbol, limit = 50) {
        try {
            return await db("trades")
                .where("symbol", symbol)
                .orderBy("timestamp", "desc")
                .limit(limit);
        } catch (error) {
            logger.error("Error getting trades by symbol:", error);
            throw error;
        }
    }

    async getPerformanceMetrics(period = "30d") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = new Date(Date.now() - periodMs);

            const trades = await db("trades")
                .where("timestamp", ">=", cutoffTime)
                .where("side", "SELL")
                .orderBy("timestamp", "desc");

            return this.calculateMetrics(trades);
        } catch (error) {
            logger.error("Error getting performance metrics:", error);
            throw error;
        }
    }

    parsePeriod(period) {
        const periods = {
            "1d": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000,
            "90d": 90 * 24 * 60 * 60 * 1000,
        };
        return periods[period] || periods["30d"];
    }

    calculateMetrics(trades) {
        if (!trades.length) return null;

        const winningTrades = trades.filter((t) => t.pnl > 0);
        const losingTrades = trades.filter((t) => t.pnl < 0);

        const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const winRate = (winningTrades.length / trades.length) * 100;

        const avgWin =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) /
                  winningTrades.length
                : 0;

        const avgLoss =
            losingTrades.length > 0
                ? Math.abs(
                      losingTrades.reduce((sum, t) => sum + t.pnl, 0) /
                          losingTrades.length
                  )
                : 0;

        return {
            totalTrades: trades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            totalPnL,
            avgWin,
            avgLoss,
            profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
        };
    }
}

module.exports = TradeRepository;
