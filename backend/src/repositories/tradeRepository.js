// backend/src/repositories/tradeRepository.js - Forex Trade Repository
const { db } = require("../../config/database");
const logger = require("../utils/logger");

class TradeRepository {
    _toNumber(value) {
        if (value === null || value === undefined || value === "") {
            return value ?? null;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
    }

    _serializeJson(value) {
        if (value === undefined) return undefined;
        if (value === null) return null;
        return typeof value === "string" ? value : JSON.stringify(value);
    }

    _parseJson(value) {
        if (!value) return null;
        if (typeof value !== "string") return value;

        try {
            return JSON.parse(value);
        } catch (error) {
            logger.warn("Failed to parse trade repository JSON payload");
            return null;
        }
    }

    _toInteger(value, fallback = 0) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    _applyRuntimeFilters(query, filters = {}) {
        const {
            mode = "live",
            runId,
            ownerRunId,
            selectionId,
            strategy,
        } = filters || {};

        if (mode !== null && mode !== undefined) {
            query.where("mode", mode);
        }
        if (runId) {
            query.where("run_id", runId);
        }
        if (ownerRunId) {
            query.where("owner_run_id", ownerRunId);
        }
        if (selectionId) {
            query.where("selection_id", selectionId);
        }
        if (strategy) {
            query.where("strategy", strategy);
        }

        return query;
    }

    _buildTradeRecord(trade) {
        return {
            trade_id: trade.id,
            oanda_trade_id: trade.oandaTradeId || null,
            instrument: trade.instrument,
            side: trade.side,
            units: trade.units,
            entry_price: trade.entryPrice,
            exit_price: trade.exitPrice ?? null,
            entry_cost_aud: trade.entryCostAud,
            exit_value_aud: trade.exitValueAud ?? null,
            pnl_aud: trade.pnlAud || 0,
            pnl_pips: trade.pnlPips || 0,
            pnl_percent: trade.pnlPercent || 0,
            signal: trade.signal,
            signal_strength: trade.signalStrength,
            entry_type: trade.entryType,
            atr_pips: trade.atrPips,
            stop_loss_price: trade.stopLossPrice ?? null,
            take_profit_price: trade.takeProfitPrice ?? null,
            trailing_stop_price: trade.trailingStopPrice ?? null,
            highest_price: trade.highestPrice ?? null,
            lowest_price: trade.lowestPrice ?? null,
            trailing_stop_pips: trade.trailingStopPips ?? null,
            leverage_used: trade.leverageUsed || 1,
            margin_used_aud: trade.marginUsedAud ?? null,
            spread_pips: trade.spreadPips ?? null,
            swap_aud: trade.swapAud ?? 0,
            commission_aud: trade.commissionAud ?? 0,
            holding_period_ms: trade.holdingPeriodMs ?? null,
            entry_time: trade.entryTime || Date.now(),
            exit_time: trade.exitTime ?? null,
            exit_reason: trade.exitReason || null,
            mode: trade.mode || "live",
            is_open: trade.isOpen !== false,
            breakeven_hit:
                trade.breakevenHit === undefined
                    ? null
                    : Boolean(trade.breakevenHit),
            active_stop_type: trade.activeStopType || null,
            close_price_source: trade.closePriceSource || null,
            reconciliation_status: trade.reconciliationStatus || null,
            broker_exit_reason: trade.brokerExitReason || null,
            broker_closed_at: trade.brokerClosedAt ?? null,
            last_broker_sync_at: trade.lastBrokerSyncAt ?? null,
            config_hash: trade.configHash || null,
            run_id: trade.runId || trade.ownerRunId || null,
            owner_run_id: trade.ownerRunId || trade.runId || null,
            selection_id: trade.selectionId || null,
            strategy: trade.strategy || null,
            broker_reconciliation_payload: this._serializeJson(
                trade.brokerReconciliationPayload
            ),
            created_at: new Date(),
            updated_at: new Date(),
        };
    }

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
            units: this._toNumber(record.units),
            entryPrice: this._toNumber(record.entry_price),
            exitPrice: this._toNumber(record.exit_price),
            entryCostAud: this._toNumber(record.entry_cost_aud),
            exitValueAud: this._toNumber(record.exit_value_aud),
            pnlAud: this._toNumber(record.pnl_aud),
            pnlPips: this._toNumber(record.pnl_pips),
            pnlPercent: this._toNumber(record.pnl_percent),
            signal: record.signal,
            signalStrength: this._toNumber(record.signal_strength),
            entryType: record.entry_type,
            atrPips: this._toNumber(record.atr_pips),
            stopLossPrice: this._toNumber(record.stop_loss_price),
            takeProfitPrice: this._toNumber(record.take_profit_price),
            trailingStopPrice: this._toNumber(record.trailing_stop_price),
            highestPrice: this._toNumber(record.highest_price),
            lowestPrice: this._toNumber(record.lowest_price),
            trailingStopPips: this._toNumber(record.trailing_stop_pips),
            leverageUsed: this._toNumber(record.leverage_used),
            marginUsedAud: this._toNumber(record.margin_used_aud),
            spreadPips: this._toNumber(record.spread_pips),
            swapAud: this._toNumber(record.swap_aud),
            commissionAud: this._toNumber(record.commission_aud),
            holdingPeriodMs: this._toNumber(record.holding_period_ms),
            entryTime: this._toNumber(record.entry_time),
            exitTime: this._toNumber(record.exit_time),
            exitReason: record.exit_reason,
            mode: record.mode,
            isOpen: Boolean(record.is_open),
            breakevenHit:
                record.breakeven_hit === null ||
                record.breakeven_hit === undefined
                    ? null
                    : Boolean(record.breakeven_hit),
            activeStopType: record.active_stop_type,
            closePriceSource: record.close_price_source,
            reconciliationStatus: record.reconciliation_status,
            brokerExitReason: record.broker_exit_reason,
            brokerClosedAt: this._toNumber(record.broker_closed_at),
            lastBrokerSyncAt: this._toNumber(record.last_broker_sync_at),
            configHash: record.config_hash,
            runId: record.run_id,
            ownerRunId: record.owner_run_id,
            selectionId: record.selection_id,
            strategy: record.strategy,
            brokerReconciliationPayload: this._parseJson(
                record.broker_reconciliation_payload
            ),
            createdAt: record.created_at,
            updatedAt: record.updated_at,
        };
    }

    /**
     * Save a new trade
     */
    async save(trade) {
        try {
            await db("trades").insert(this._buildTradeRecord(trade));

            logger.debug(`Trade saved to database: ${trade.id}`);
        } catch (error) {
            logger.error("Error saving trade:", error);
            throw error;
        }
    }

    /**
     * Get recent trades
     */
    async getRecent(limit = 20, filters = {}) {
        try {
            const records = await this._applyRuntimeFilters(db("trades"), filters)
                .orderBy("entry_time", "desc")
                .limit(limit);
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting recent trades:", error);
            throw error;
        }
    }

    /**
     * Get trades by instrument
     */
    async getByInstrument(instrument, limit = 50, filters = {}) {
        try {
            const records = await this._applyRuntimeFilters(
                db("trades").where("instrument", instrument),
                filters
            )
                .orderBy("entry_time", "desc")
                .limit(limit);
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting trades by instrument:", error);
            throw error;
        }
    }

    /**
     * Get trades since a cutoff time
     */
    async getTradesSince(cutoffTime, filters = {}) {
        try {
            const timestamp =
                cutoffTime instanceof Date ? cutoffTime.getTime() : cutoffTime;

            const records = await this._applyRuntimeFilters(
                db("trades").where("entry_time", ">=", timestamp),
                filters
            ).orderBy("entry_time", "desc");
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting trades since cutoff:", error);
            throw error;
        }
    }

    /**
     * Get all trades
     */
    async getAllTrades(filters = {}) {
        try {
            const records = await this._applyRuntimeFilters(db("trades"), filters)
                .orderBy("entry_time", "asc");
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting all trades:", error);
            throw error;
        }
    }

    async getRecentByActivity(limit = 200, filters = {}) {
        try {
            const records = await this._applyRuntimeFilters(db("trades"), filters)
                .orderByRaw("COALESCE(exit_time, entry_time, 0) DESC")
                .limit(limit);
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting recent trades by activity:", error);
            throw error;
        }
    }

    async getClosedTrades(limit = 1000, filters = {}) {
        try {
            const records = await this._applyRuntimeFilters(
                db("trades").where("is_open", false),
                filters
            )
                .orderByRaw("COALESCE(exit_time, entry_time, 0) DESC")
                .limit(limit);
            return records.map((r) => this._mapToTradeObject(r));
        } catch (error) {
            logger.error("Error getting closed trades:", error);
            throw error;
        }
    }

    async getTradeSummary(filters = {}) {
        try {
            const row = await this._applyRuntimeFilters(db("trades"), filters)
                .select(
                    db.raw("COUNT(*) AS total_trades"),
                    db.raw(
                        "SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END) AS open_trades"
                    ),
                    db.raw(
                        "SUM(CASE WHEN is_open = 0 THEN 1 ELSE 0 END) AS closed_trades"
                    ),
                    db.raw(
                        "SUM(CASE WHEN is_open = 0 AND COALESCE(pnl_aud, 0) > 0 THEN 1 ELSE 0 END) AS winning_trades"
                    ),
                    db.raw(
                        "SUM(CASE WHEN is_open = 0 AND COALESCE(pnl_aud, 0) < 0 THEN 1 ELSE 0 END) AS losing_trades"
                    ),
                    db.raw(
                        "SUM(CASE WHEN is_open = 0 AND COALESCE(pnl_aud, 0) = 0 THEN 1 ELSE 0 END) AS flat_trades"
                    ),
                    db.raw(
                        "SUM(CASE WHEN is_open = 0 THEN COALESCE(pnl_aud, 0) ELSE 0 END) AS realized_pnl_aud"
                    ),
                    db.raw(
                        "SUM(CASE WHEN is_open = 0 THEN COALESCE(pnl_pips, 0) ELSE 0 END) AS realized_pnl_pips"
                    )
                )
                .first();

            return {
                totalTrades: this._toInteger(row?.total_trades),
                openTradeCount: this._toInteger(row?.open_trades),
                closedTradeCount: this._toInteger(row?.closed_trades),
                winningTrades: this._toInteger(row?.winning_trades),
                losingTrades: this._toInteger(row?.losing_trades),
                flatTrades: this._toInteger(row?.flat_trades),
                realizedPnlAud: this._toNumber(row?.realized_pnl_aud) || 0,
                realizedPnlPips: this._toNumber(row?.realized_pnl_pips) || 0,
            };
        } catch (error) {
            logger.error("Error getting trade summary:", error);
            throw error;
        }
    }

    /**
     * Get open trades
     */
    async getOpenTrades(filters = {}) {
        try {
            const records = await this._applyRuntimeFilters(
                db("trades").where("is_open", true),
                filters
            );
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
            if (updates.stopLossPrice !== undefined)
                dbUpdates.stop_loss_price = updates.stopLossPrice;
            if (updates.takeProfitPrice !== undefined)
                dbUpdates.take_profit_price = updates.takeProfitPrice;
            if (updates.trailingStopPrice !== undefined)
                dbUpdates.trailing_stop_price = updates.trailingStopPrice;
            if (updates.highestPrice !== undefined)
                dbUpdates.highest_price = updates.highestPrice;
            if (updates.lowestPrice !== undefined)
                dbUpdates.lowest_price = updates.lowestPrice;
            if (updates.trailingStopPips !== undefined)
                dbUpdates.trailing_stop_pips = updates.trailingStopPips;
            if (updates.swapAud !== undefined)
                dbUpdates.swap_aud = updates.swapAud;
            if (updates.commissionAud !== undefined)
                dbUpdates.commission_aud = updates.commissionAud;
            if (updates.breakevenHit !== undefined)
                dbUpdates.breakeven_hit = Boolean(updates.breakevenHit);
            if (updates.activeStopType !== undefined)
                dbUpdates.active_stop_type = updates.activeStopType;
            if (updates.closePriceSource !== undefined)
                dbUpdates.close_price_source = updates.closePriceSource;
            if (updates.reconciliationStatus !== undefined)
                dbUpdates.reconciliation_status = updates.reconciliationStatus;
            if (updates.brokerExitReason !== undefined)
                dbUpdates.broker_exit_reason = updates.brokerExitReason;
            if (updates.brokerClosedAt !== undefined)
                dbUpdates.broker_closed_at = updates.brokerClosedAt;
            if (updates.lastBrokerSyncAt !== undefined)
                dbUpdates.last_broker_sync_at = updates.lastBrokerSyncAt;
            if (updates.configHash !== undefined)
                dbUpdates.config_hash = updates.configHash;
            if (updates.runId !== undefined) dbUpdates.run_id = updates.runId;
            if (updates.ownerRunId !== undefined)
                dbUpdates.owner_run_id = updates.ownerRunId;
            if (updates.selectionId !== undefined)
                dbUpdates.selection_id = updates.selectionId;
            if (updates.strategy !== undefined)
                dbUpdates.strategy = updates.strategy;
            if (updates.brokerReconciliationPayload !== undefined)
                dbUpdates.broker_reconciliation_payload =
                    this._serializeJson(updates.brokerReconciliationPayload);

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

    async deleteByRunId(runId, filters = {}) {
        try {
            if (!runId) return 0;

            return await this._applyRuntimeFilters(db("trades"), {
                ...filters,
                runId,
            }).del();
        } catch (error) {
            logger.error(`Error deleting trades for run ${runId}:`, error);
            throw error;
        }
    }

    async deleteByRuntimeFilters(filters = {}) {
        try {
            return await this._applyRuntimeFilters(db("trades"), filters).del();
        } catch (error) {
            logger.error("Error deleting trades by runtime filters:", error);
            throw error;
        }
    }

    /**
     * Get performance metrics for a period
     */
    async getPerformanceMetrics(period = "30d", filters = {}) {
        try {
            const periodMs = this.parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            const trades = await this._applyRuntimeFilters(
                db("trades")
                    .where("entry_time", ">=", cutoffTime)
                    .where("is_open", false),
                filters
            ).orderBy("entry_time", "desc");

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
