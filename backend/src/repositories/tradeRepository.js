// backend/src/repositories/tradeRepository.js - V3.2.7 TRAILING STOP FIX
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
            feeUsdtValue: record.fee_usdt_value,
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
            isOpen: Boolean(record.is_open),
            takeProfitPrice: record.take_profit_price,
            // FIX #7: Use consistent camelCase for application layer
            trailingStopPrice: record.trailing_stop_price,
            highestPrice: record.highest_price,
            trailingStopPercent: record.trailing_stop_percent,
            // Map Exit Fields back to CamelCase for App
            exitPrice: record.exit_price,
            exitTime: record.exit_time,
        };

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
                fee_usdt_value: trade.feeUsdtValue || trade.fee_usdt_value || 0,
                pnl: trade.pnl || 0,
                pnl_percent: trade.pnlPercent || 0,
                signal: trade.signal,
                signal_strength: trade.signalStrength,
                atr: trade.atr || null,
                volatility_percent: trade.volatilityPercent || null,
                stop_loss: trade.stopLoss || null,
                entry_cost: trade.entryCost || null,
                holding_period: trade.holdingPeriod || null,
                entry_price: trade.entryPrice || trade.price || null,
                exit_reason: trade.exitReason || "UNKNOWN",
                // FIX: Force timestamp to Integer (milliseconds)
                timestamp: new Date(trade.timestamp).getTime(),
                mode: trade.mode || "live",
                is_open: trade.isOpen || false,
                take_profit_price: trade.takeProfitPrice || null,
                // FIX #7: Allow null/0 values - use !== undefined check
                trailing_stop_price: trade.trailingStopPrice ?? null,
                highest_price: trade.highestPrice ?? null,
                trailing_stop_percent: trade.trailingStopPercent ?? null,
                created_at: new Date(),
            });

            logger.debug("Trade saved to database:", trade.id);
        } catch (error) {
            logger.error("Error saving trade:", error);
            throw error;
        }
    }

    async getRecent(limit = 20, mode = "live") {
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

    async getBySymbol(symbol, limit = 50, mode = "live") {
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

    async getTradesSince(cutoffTime, mode = "live") {
        try {
            // FIX: Ensure cutoffTime is a Number (Integer) for comparison
            const timestamp =
                cutoffTime instanceof Date ? cutoffTime.getTime() : cutoffTime;

            let query = db("trades").where("timestamp", ">=", timestamp);
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

    async getAllTrades(mode = "live") {
        try {
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
            const dbUpdates = {};

            // FIX #7: Map camelCase to snake_case with proper undefined checks
            // Use !== undefined to allow null and 0 values to be saved

            if (updates.isOpen !== undefined) {
                dbUpdates.is_open = updates.isOpen;
            }
            if (updates.exitPrice !== undefined) {
                dbUpdates.exit_price = updates.exitPrice;
            }
            if (updates.exitTime !== undefined) {
                dbUpdates.exit_time = updates.exitTime;
            }
            if (updates.exitReason !== undefined) {
                dbUpdates.exit_reason = updates.exitReason;
            }
            if (updates.pnl !== undefined) {
                dbUpdates.pnl = updates.pnl;
            }
            if (updates.pnlPercent !== undefined) {
                dbUpdates.pnl_percent = updates.pnlPercent;
            }
            if (updates.holdingPeriod !== undefined) {
                dbUpdates.holding_period = updates.holdingPeriod;
            }
            if (updates.takeProfitPrice !== undefined) {
                dbUpdates.take_profit_price = updates.takeProfitPrice;
            }
            // FIX #7: Use !== undefined to allow 0 and null values
            if (updates.trailingStopPrice !== undefined) {
                dbUpdates.trailing_stop_price = updates.trailingStopPrice;
            }
            // Also handle snake_case input (for consistency)
            if (updates.trailing_stop_price !== undefined) {
                dbUpdates.trailing_stop_price = updates.trailing_stop_price;
            }
            if (updates.highestPrice !== undefined) {
                dbUpdates.highest_price = updates.highestPrice;
            }
            if (updates.highest_price !== undefined) {
                dbUpdates.highest_price = updates.highest_price;
            }
            if (updates.trailingStopPercent !== undefined) {
                dbUpdates.trailing_stop_percent = updates.trailingStopPercent;
            }

            // SAFETY: Remove fields that shouldn't be updated
            delete dbUpdates.status;
            delete dbUpdates.trade_id;
            delete dbUpdates.symbol;
            delete dbUpdates.side;

            // Only update if we have fields to update
            if (Object.keys(dbUpdates).length === 0) {
                logger.debug(`No valid fields to update for trade ${tradeId}`);
                return;
            }

            await db("trades").where("trade_id", tradeId).update(dbUpdates);
            logger.debug(
                `Trade ${tradeId} updated:`,
                Object.keys(dbUpdates).join(", ")
            );
        } catch (error) {
            logger.error(`Error updating trade ${tradeId}:`, error);
            throw error;
        }
    }

    async getPerformanceMetrics(period = "30d", mode = "live") {
        try {
            const periodMs = this.parsePeriod(period);
            // FIX: Use Number (Date.now()) instead of Date Object for cutoff
            const cutoffTime = Date.now() - periodMs;

            const trades = await db("trades")
                .where("timestamp", ">=", cutoffTime)
                .where("mode", mode)
                .where((builder) => {
                    builder.where("is_open", false).orWhereNotNull("pnl");
                })
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

        // FIX: Strictly exclude Open positions (isOpen=true) to prevent skewing stats
        const completedTrades = trades.filter(
            (t) => t.pnl !== null && t.pnl !== undefined && !t.is_open
        );

        // If no closed trades exist, return null so UI shows "N/A" instead of 0s
        if (completedTrades.length === 0) return null;

        const winningTrades = completedTrades.filter((t) => t.pnl > 0);
        const losingTrades = completedTrades.filter((t) => t.pnl < 0);

        const totalPnL = completedTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );
        const winRate =
            completedTrades.length > 0
                ? (winningTrades.length / completedTrades.length) * 100
                : 0;

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
            totalTrades: completedTrades.length,
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
