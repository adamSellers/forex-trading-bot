// backend/src/repositories/tradeRepository.js - Forex Trade Repository
const { db } = require("../../config/database");
const logger = require("../utils/logger");

class TradeRepository {
    /**
     * Map DB record to trade object with consistent naming
     */
    _mapToTradeObject(record) {
        if (!record) return null;

        return {
            id: record.trade_id,
            oandaTradeId: record.oanda_trade_id,
            instrument: record.instrument,
            side: record.side,
            units: record.units,
            entryPrice: record.entry_price,
            exitPrice: record.exit_price,
            entryCostAud: record.entry_cost_aud,
            exitValueAud: record.exit_value_aud,
            pnlAud: record.pnl_aud,
            pnlPips: record.pnl_pips,
            pnlPercent: record.pnl_percent,
            signal: record.signal,
            signalStrength: record.signal_strength,
            entryType: record.entry_type,
            atrPips: record.atr_pips,
            stopLossPrice: record.stop_loss_price,
            takeProfitPrice: record.take_profit_price,
            trailingStopPrice: record.trailing_stop_price,
            highestPrice: record.highest_price,
            trailingStopPips: record.trailing_stop_pips,
            leverageUsed: record.leverage_used,
            marginUsedAud: record.margin_used_aud,
            spreadPips: record.spread_pips,
            swapAud: record.swap_aud,
            commissionAud: record.commission_aud,
            holdingPeriodMs: record.holding_period_ms,
            entryTime: record.entry_time,
            exitTime: record.exit_time,
            exitReason: record.exit_reason,
            mode: record.mode,
            isOpen: Boolean(record.is_open),
            createdAt: record.created_at,
            updatedAt: record.updated_at,
        };
    }

    /**
     * Save a new trade
     */
    async save(trade) {
        try {
            await db("trades").insert({
                trade_id: trade.id,
                oanda_trade_id: trade.oandaTradeId || null,
                instrument: trade.instrument,
                side: trade.side,
                units: trade.units,
                entry_price: trade.entryPrice,
                entry_cost_aud: trade.entryCostAud,
                pnl_aud: trade.pnlAud || 0,
                pnl_pips: trade.pnlPips || 0,
                pnl_percent: trade.pnlPercent || 0,
                signal: trade.signal,
                signal_strength: trade.signalStrength,
                entry_type: trade.entryType,
                atr_pips: trade.atrPips,
                stop_loss_price: trade.stopLossPrice,
                take_profit_price: trade.takeProfitPrice,
                trailing_stop_price: trade.trailingStopPrice,
                highest_price: trade.highestPrice,
                trailing_stop_pips: trade.trailingStopPips,
                leverage_used: trade.leverageUsed || 1,
                margin_used_aud: trade.marginUsedAud,
                spread_pips: trade.spreadPips,
                entry_time: trade.entryTime || Date.now(),
                exit_reason: trade.exitReason || null,
                mode: trade.mode || "live",
                is_open: trade.isOpen !== false,
                created_at: new Date(),
                updated_at: new Date(),
            });

            logger.debug(`Trade saved to database: ${trade.id}`);
        } catch (error) {
            logger.error("Error saving trade:", error);
            throw error;
        }
    }

    /**
     * Get recent trades
     */
    async getRecent(limit = 20, mode = "live") {
        try {
            // Ensure database connection is ready
            if (!db) {
                logger.error("Database connection not initialized");
                return [];
            }

            let query = db("trades").orderBy("entry_time", "desc").limit(limit);
            if (mode) {
                query = query.where("mode", mode);
            }
            const records = await query;
            
            // Handle empty result set gracefully
            if (!records || records.length === 0) {
                return [];
            }
            
            return records.map((r) => this._mapToTradeObject(r)).filter(Boolean);
        } catch (error) {
            logger.error("Error getting recent trades:", error);
            // Return empty array instead of throwing to prevent breaking the API
            return [];
        }
    }

    /**
     * Get trades by instrument
     */
    async getByInstrument(instrument, limit = 50, mode = "live") {
        try {
            let query = db("trades")
                .where("instrument", instrument)
                .orderBy("entry_time", "desc");

            if (mode) query = query.where("mode", mode);
            const records = await query.limit(limit);
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting trades by instrument:", error);
            throw error;
        }
    }

    /**
     * Get trades since a cutoff time
     */
    async getTradesSince(cutoffTime, mode = "live") {
        try {
            const timestamp =
                cutoffTime instanceof Date ? cutoffTime.getTime() : cutoffTime;

            let query = db("trades").where("entry_time", ">=", timestamp);
            if (mode) query = query.where("mode", mode);
            const records = await query.orderBy("entry_time", "desc");
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting trades since cutoff:", error);
            throw error;
        }
    }

    /**
     * Get all trades
     */
    async getAllTrades(mode = "live") {
        try {
            let query = db("trades").orderBy("entry_time", "asc");
            if (mode) query = query.where("mode", mode);
            const records = await query;
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting all trades:", error);
            throw error;
        }
    }

    /**
     * Get open trades
     */
    async getOpenTrades(mode = "live") {
        try {
            const records = await db("trades")
                .where("mode", mode)
                .where("is_open", true);
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting open trades:", error);
            return [];
        }
    }

    /**
     * Update a trade
     */
    async updateTrade(tradeId, updates) {
        try {
            const dbUpdates = { updated_at: new Date() };

            // Map camelCase to snake_case
            if (updates.isOpen !== undefined)
                dbUpdates.is_open = updates.isOpen;
            if (updates.exitPrice !== undefined)
                dbUpdates.exit_price = updates.exitPrice;
            if (updates.exitTime !== undefined)
                dbUpdates.exit_time = updates.exitTime;
            if (updates.exitValueAud !== undefined)
                dbUpdates.exit_value_aud = updates.exitValueAud;
            if (updates.exitReason !== undefined)
                dbUpdates.exit_reason = updates.exitReason;
            if (updates.pnlAud !== undefined)
                dbUpdates.pnl_aud = updates.pnlAud;
            if (updates.pnlPips !== undefined)
                dbUpdates.pnl_pips = updates.pnlPips;
            if (updates.pnlPercent !== undefined)
                dbUpdates.pnl_percent = updates.pnlPercent;
            if (updates.holdingPeriodMs !== undefined)
                dbUpdates.holding_period_ms = updates.holdingPeriodMs;
            if (updates.takeProfitPrice !== undefined)
                dbUpdates.take_profit_price = updates.takeProfitPrice;
            if (updates.trailingStopPrice !== undefined)
                dbUpdates.trailing_stop_price = updates.trailingStopPrice;
            if (updates.highestPrice !== undefined)
                dbUpdates.highest_price = updates.highestPrice;
            if (updates.trailingStopPips !== undefined)
                dbUpdates.trailing_stop_pips = updates.trailingStopPips;
            if (updates.swapAud !== undefined)
                dbUpdates.swap_aud = updates.swapAud;

            // Remove unchanged fields
            if (Object.keys(dbUpdates).length <= 1) {
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

    /**
     * Get performance metrics for a period
     */
    async getPerformanceMetrics(period = "30d", mode = "live") {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            const trades = await db("trades")
                .where("entry_time", ">=", cutoffTime)
                .where("mode", mode)
                .where("is_open", false)
                .orderBy("entry_time", "desc");

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

        const completedTrades = trades.filter(
            (t) => t.pnl_aud !== null && !t.is_open
        );
        if (completedTrades.length === 0) return null;

        const winningTrades = completedTrades.filter((t) => t.pnl_aud > 0);
        const losingTrades = completedTrades.filter((t) => t.pnl_aud < 0);

        const totalPnLAud = completedTrades.reduce(
            (sum, t) => sum + (t.pnl_aud || 0),
            0
        );
        const totalPnLPips = completedTrades.reduce(
            (sum, t) => sum + (t.pnl_pips || 0),
            0
        );

        const winRate =
            completedTrades.length > 0
                ? (winningTrades.length / completedTrades.length) * 100
                : 0;

        const avgWinAud =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + t.pnl_aud, 0) /
                  winningTrades.length
                : 0;

        const avgLossAud =
            losingTrades.length > 0
                ? Math.abs(
                      losingTrades.reduce((sum, t) => sum + t.pnl_aud, 0) /
                          losingTrades.length
                  )
                : 0;

        const avgWinPips =
            winningTrades.length > 0
                ? winningTrades.reduce((sum, t) => sum + (t.pnl_pips || 0), 0) /
                  winningTrades.length
                : 0;

        const avgLossPips =
            losingTrades.length > 0
                ? Math.abs(
                      losingTrades.reduce(
                          (sum, t) => sum + (t.pnl_pips || 0),
                          0
                      ) / losingTrades.length
                  )
                : 0;

        return {
            totalTrades: completedTrades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate,
            totalPnLAud,
            totalPnLPips,
            avgWinAud,
            avgLossAud,
            avgWinPips,
            avgLossPips,
            profitFactor: avgLossAud > 0 ? avgWinAud / avgLossAud : 0,
        };
    }
}

module.exports = TradeRepository;
