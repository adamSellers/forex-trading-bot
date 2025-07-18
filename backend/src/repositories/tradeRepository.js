// backend/src/repositories/tradeRepository.js
const { db } = require("../../config/database");
const logger = require("../utils/logger");

class TradeRepository {
    // Private helper to map DB records to consistent trade objects
    _mapToTradeObject(record) {
        if (!record) return null;
        const trade = {
            id: record.trade_id,
            symbol: record.symbol,
            side: record.side,
            quantity: record.quantity,
            price: record.price,
            pnl: record.pnl,
            feeUsdtValue: record.fee_usdt_value, // NEW: Map fee value
            pnlPercent: record.pnl_percent,
            signal: record.signal,
            signalStrength: record.signal_strength,
            atr: record.atr,
            volatilityPercent: record.volatility_percent,
            stopLoss: record.stop_loss,
            entryCost: record.entry_cost,
            holdingPeriod: record.holding_period,
            exitReason: record.exit_reason,
            timestamp: record.timestamp,
            entryPrice: record.entry_price,
            mode: record.mode,
            isOpen: record.is_open,
            takeProfitPrice: record.take_profit_price,
            trailingStopPrice: record.trailing_stop_price,
            highestPrice: record.highest_price,
            trailingStopPercent: record.trailing_stop_percent,
        };

        // Correctly assign cost/received based on trade side
        if (trade.side === "BUY") {
            trade.usdtCost = record.total_value;
        } else {
            trade.usdtReceived = record.total_value;
        }
        return trade;
    }

    async save(trade) {
        try {
            await db("trades").insert({
                trade_id: trade.id,
                symbol: trade.symbol,
                side: trade.side,
                quantity: trade.quantity,
                price: trade.price,
                total_value: trade.usdtCost || trade.usdtReceived || 0,
                fee_usdt_value: trade.feeUsdtValue || 0, // NEW: Save fee value
                pnl: trade.pnl || 0,
                pnl_percent: trade.pnlPercent || 0,
                signal: trade.signal,
                signal_strength: trade.signalStrength,
                atr: trade.atr || null,
                volatility_percent: trade.volatilityPercent || null,
                stop_loss: trade.stopLoss || null,
                entry_cost: trade.entryCost || null,
                holding_period: trade.holdingPeriod || null,
                entry_price: trade.entryPrice || null,
                exit_reason: trade.exitReason || "UNKNOWN",
                timestamp: new Date(trade.timestamp),
                mode: trade.mode || "paper", // Add mode, default to paper
                is_open: trade.isOpen || false,
                take_profit_price: trade.takeProfitPrice || null,
                trailing_stop_price: trade.trailingStopPrice || null,
                highest_price: trade.highestPrice || null,
                trailing_stop_percent: trade.trailingStopPercent || null,
                created_at: new Date(),
            });

            logger.debug("Trade saved to database:", trade.id);
        } catch (error) {
            logger.error("Error saving trade:", error);
            throw error;
        }
    }

    async getRecent(limit = 20, mode = null) {
        try {
            let query = db("trades").orderBy("timestamp", "desc").limit(limit);
            if (mode) query = query.where("mode", mode);
            const records = await query;
            return records.map((record) => this._mapToTradeObject(record));
        } catch (error) {
            logger.error("Error getting recent trades:", error);
            throw error;
        }
    }

    async getBySymbol(symbol, limit = 50, mode = null) {
        try {
            let query = db("trades")
                .where("symbol", symbol)
                .orderBy("timestamp", "desc");

            if (mode) {
                query = query.where("mode", mode);
            }
            const records = await query.limit(limit);
            return records.map((record) => this._mapToTradeObject(record));
        } catch (error) {
            logger.error("Error getting trades by symbol:", error);
            throw error;
        }
    }

    async getTradesSince(cutoffTime, mode = null) {
        try {
            let query = db("trades").where("timestamp", ">=", cutoffTime);
            if (mode) {
                query = query.where("mode", mode);
            }
            const records = await query.orderBy("timestamp", "desc");
            return records.map((record) => this._mapToTradeObject(record));
        } catch (error) {
            logger.error("Error getting trades since cutoff:", error);
            throw error;
        }
    }

    async getAllTrades(mode = null) {
        try {
            // Returns all trades, ordered by time, for full recalculation
            let query = db("trades").orderBy("timestamp", "asc");
            if (mode) query = query.where("mode", mode);
            const records = await query;
            return records.map((record) => this._mapToTradeObject(record));
        } catch (error) {
            logger.error("Error getting all trades for recalculation:", error);
            throw error;
        }
    }

    async getOpenLiveTrades() {
        try {
            const records = await db("trades")
                .where("mode", "live")
                .where("is_open", true);
            return records.map((record) => this._mapToTradeObject(record));
        } catch (error) {
            logger.error("Error getting open live trades:", error);
            return [];
        }
    }

    async updateTrade(tradeId, updates) {
        try {
            // Knex requires snake_case for column names
            const dbUpdates = { ...updates };
            if (dbUpdates.takeProfitPrice) {
                dbUpdates.take_profit_price = dbUpdates.takeProfitPrice;
                delete dbUpdates.takeProfitPrice;
            }
            if (dbUpdates.trailingStopPrice) {
                dbUpdates.trailing_stop_price = dbUpdates.trailingStopPrice;
                delete dbUpdates.trailingStopPrice;
            }
            if (dbUpdates.highestPrice) {
                dbUpdates.highest_price = dbUpdates.highestPrice;
                delete dbUpdates.highestPrice;
            }
            if (dbUpdates.isOpen !== undefined) {
                dbUpdates.is_open = dbUpdates.isOpen;
                delete dbUpdates.isOpen;
            }
            if (dbUpdates.trailingStopPercent !== undefined) {
                dbUpdates.trailing_stop_percent = dbUpdates.trailingStopPercent;
                delete dbUpdates.trailingStopPercent;
            }

            await db("trades").where("trade_id", tradeId).update(dbUpdates);
            // FIX: Make this log more specific to reduce noise and add clarity.
            // It's primarily used for trailing stop updates.
            logger.debug(`Trade ${tradeId} updated in database.`, {
                updates: dbUpdates,
            });
        } catch (error) {
            logger.error(`Error updating trade ${tradeId}:`, error);
            throw error;
        }
    }

    async getPerformanceMetrics(period = "30d", mode = "paper") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = new Date(Date.now() - periodMs);

            const trades = await db("trades")
                .where("timestamp", ">=", cutoffTime)
                .where("mode", mode)
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
