// backend/src/services/LiveTradingEngine.js - V3.2.2 EXPOSURE CAP FIX
const EventEmitter = require("events");
const logger = require("../utils/logger");
const TradeRepository = require("../repositories/tradeRepository");

class LiveTradingEngine extends EventEmitter {
    constructor(config, binanceData, riskService) {
        super();
        this.config = config;
        this.binanceData = binanceData;
        this.riskService = riskService;
        this.tradeRepo = new TradeRepository();
        this.mode = "live";

        this.portfolio = {
            usdtBalance: 0,
            positions: [],
            totalValue: 0,
            totalPnL: 0,
            dailyPnL: 0,
            totalFees: 0,
            stats: { winRate: 0, totalTrades: 0, winningTrades: 0 },
        };

        // Signal queue for sequential processing
        this._signalQueue = [];
        this._processingQueue = false;

        // FIX #1: Track positions currently being closed to prevent race conditions
        this._closingPositions = new Set();

        // FIX #2: Validate allocation config on construction
        this._validateAllocationConfig();
    }

    /**
     * FIX #2: Validate that allocation percentages don't exceed 100%
     * Logs a warning but doesn't auto-correct (user should fix config)
     */
    _validateAllocationConfig() {
        if (this.config.allocation) {
            const totalAllocation = Object.values(
                this.config.allocation
            ).reduce((sum, pct) => sum + pct, 0);
            if (totalAllocation > 1.0) {
                logger.warn(
                    `⚠️ ALLOCATION WARNING: Total allocation is ${(
                        totalAllocation * 100
                    ).toFixed(1)}% (exceeds 100%). ` +
                        `This may cause unexpected position sizing. Please review your config.`
                );
            }
        }
    }

    async initialize() {
        logger.info("📌 Live Trading Engine Connecting...");
        const account = await this.binanceData.getAccountInfo();
        if (account.error) throw new Error("Binance Connection Failed");

        this.portfolio.usdtBalance = parseFloat(
            account.balances.find((b) => b.asset === "USDT")?.free || 0
        );

        this.portfolio.totalValue = this.portfolio.usdtBalance;

        logger.success(
            `✅ Live Engine Online. USDT Balance: $${this.portfolio.usdtBalance.toFixed(
                2
            )}`
        );

        try {
            const dbPositions = await this.tradeRepo.getOpenLiveTrades();
            this.portfolio.positions = dbPositions.map((p) => ({
                ...p,
                currentPrice: p.price || p.entryPrice,
                unrealizedPnL: 0,
                trailingStopPrice: p.trailing_stop_price || p.trailingStopPrice,
            }));
            logger.info(
                `🔄 Restored ${this.portfolio.positions.length} active positions.`
            );
        } catch (err) {
            logger.warn(
                "⚠️ Could not restore positions (likely empty DB): " +
                    err.message
            );
            this.portfolio.positions = [];
        }

        await this.calculatePerformanceStats();
    }

    updateConfig(config) {
        this.config = config;
        // FIX #2: Re-validate allocations when config updates
        this._validateAllocationConfig();
        logger.info("🔄 Live Engine Config Updated");
    }

    calculateOrderFee(order) {
        let totalUsdtFee = 0;
        try {
            if (order && order.fills && Array.isArray(order.fills)) {
                for (const fill of order.fills) {
                    const feeAmount = parseFloat(fill.commission);
                    const asset = fill.commissionAsset;

                    if (asset === "USDT") {
                        totalUsdtFee += feeAmount;
                    } else if (asset === "BNB") {
                        const bnbPrice =
                            this.binanceData.getCurrentPrice("BNBUSDT")
                                ?.price || 0;
                        totalUsdtFee += feeAmount * bnbPrice;
                    } else {
                        const assetPrice =
                            this.binanceData.getCurrentPrice(`${asset}USDT`)
                                ?.price || 0;
                        totalUsdtFee += feeAmount * assetPrice;
                    }
                }
            }
        } catch (e) {
            logger.warn("⚠️ Failed to calc fees: " + e.message);
        }
        return totalUsdtFee;
    }

    async calculatePerformanceStats() {
        try {
            const allTrades = await this.tradeRepo.getAllTrades("live");
            const closedTrades = allTrades.filter(
                (t) => t.pnl !== null && t.pnl !== undefined
            );

            this.portfolio.stats.totalTrades = closedTrades.length;
            this.portfolio.stats.winningTrades = closedTrades.filter(
                (t) => t.pnl > 0
            ).length;
            this.portfolio.stats.winRate =
                this.portfolio.stats.totalTrades > 0
                    ? (this.portfolio.stats.winningTrades /
                          this.portfolio.stats.totalTrades) *
                      100
                    : 0;

            this.portfolio.totalPnL = closedTrades.reduce(
                (acc, t) => acc + (t.pnl || 0),
                0
            );

            this.portfolio.totalFees = allTrades.reduce(
                (acc, t) => acc + (t.fee_usdt_value || 0),
                0
            );
        } catch (e) {
            logger.warn("⚠️ Stats hydration skipped: " + e.message);
        }
    }

    async start() {
        logger.info("🟢 Live Trading STARTED");
        const prices = this.binanceData.getAllPrices();
        this.updatePortfolioValue(prices);
    }

    async stop() {
        logger.info("🔴 Live Trading STOPPED");
    }

    /**
     * Force close a position manually (from UI or API)
     * FIX #1: Added same atomic lock protection as closePosition()
     */
    async forceClosePosition(tradeId) {
        const position = this.portfolio.positions.find(
            (p) =>
                p.id == tradeId || p.trade_id == tradeId || p.orderId == tradeId
        );

        if (!position) {
            throw new Error(
                `Position ${tradeId} not found in active portfolio.`
            );
        }

        // FIX #1: Check if position is already being closed
        const lockKey = `${position.symbol}_${position.id}`;
        if (this._closingPositions.has(lockKey)) {
            logger.warn(
                `⚠️ FORCE CLOSE BLOCKED: ${position.symbol} (${position.id}) is already being closed.`
            );
            throw new Error(
                `Position ${position.symbol} is already being closed. Please wait.`
            );
        }

        const priceData = this.binanceData.getCurrentPrice(position.symbol);
        if (!priceData || !priceData.price) {
            throw new Error(`Current price unavailable for ${position.symbol}`);
        }

        logger.warn(
            `🚨 MANUAL FORCE CLOSE triggered for ${position.symbol} (ID: ${tradeId})`
        );
        return await this.closePosition(
            position,
            priceData.price,
            "MANUAL_FORCE"
        );
    }

    async processSignal(signal, currentPrice, atr) {
        this._signalQueue.push({
            signal,
            currentPrice,
            atr,
            timestamp: Date.now(),
        });

        if (!this._processingQueue) {
            this._processSignalQueue();
        }

        return { success: true, action: "QUEUED" };
    }

    async _processSignalQueue() {
        this._processingQueue = true;

        while (this._signalQueue.length > 0) {
            const { signal, currentPrice, atr } = this._signalQueue.shift();

            try {
                await this._executeSignal(signal, currentPrice, atr);
            } catch (err) {
                logger.error(
                    `Signal processing failed for ${signal.symbol}:`,
                    err.message
                );
            }
        }

        this._processingQueue = false;
    }

    /**
     * FIX #2: Calculate current portfolio exposure (value of all open positions)
     * Returns exposure as a decimal (0.0 to 1.0+)
     */
    _calculateCurrentExposure() {
        const totalEquity = this._calculateCurrentEquity();
        if (totalEquity <= 0) return 0;

        let exposureValue = 0;
        this.portfolio.positions.forEach((pos) => {
            const price =
                this.binanceData.getCurrentPrice(pos.symbol)?.price ||
                pos.currentPrice;
            exposureValue += pos.quantity * price;
        });

        return exposureValue / totalEquity;
    }

    async _executeSignal(signal, currentPrice, atr) {
        if (signal.signal !== "BUY" && signal.signal !== "SELL")
            return { success: false, action: "NONE" };

        if (
            this.riskService &&
            !this.riskService.checkRiskLimits(this.getPortfolioSummary())
        ) {
            return {
                success: false,
                action: "SKIP",
                reason: "Global Risk Halt Active",
            };
        }

        const openPosition = this.portfolio.positions.find(
            (p) => p.symbol === signal.symbol
        );

        if (signal.signal === "BUY") {
            if (openPosition)
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Position already open",
                };

            // FIX #2: Calculate current exposure and remaining capacity
            const maxExposure = this.config.maxPortfolioExposure ?? 0.95; // Default 95%
            const currentExposure = this._calculateCurrentExposure();
            const remainingExposure = Math.max(
                0,
                maxExposure - currentExposure
            );

            // FIX #2: Check if we've hit the exposure cap
            if (remainingExposure <= 0.01) {
                // Less than 1% remaining
                logger.warn(
                    `⚠️ EXPOSURE CAP: Cannot open ${signal.symbol}. ` +
                        `Current exposure: ${(currentExposure * 100).toFixed(
                            1
                        )}%, ` +
                        `Max: ${(maxExposure * 100).toFixed(1)}%`
                );
                return {
                    success: false,
                    action: "SKIP",
                    reason: `Portfolio exposure cap reached (${(
                        currentExposure * 100
                    ).toFixed(1)}%)`,
                };
            }

            const allocationPct =
                this.config.allocation?.[signal.symbol] ?? 0.15;

            if (allocationPct === 0) {
                return {
                    success: false,
                    action: "SKIP",
                    reason: `Allocation set to 0% for ${signal.symbol}`,
                };
            }

            const totalEquity = this._calculateCurrentEquity();

            // FIX #2: Target size is the MINIMUM of allocation % and remaining exposure capacity
            const targetByAllocation = totalEquity * allocationPct;
            const targetByCapacity = totalEquity * remainingExposure;
            let targetPositionSize = Math.min(
                targetByAllocation,
                targetByCapacity
            );

            // Log if we're being capped by exposure limit
            if (targetByCapacity < targetByAllocation) {
                logger.info(
                    `📊 ${signal.symbol}: Allocation capped by exposure limit. ` +
                        `Wanted: $${targetByAllocation.toFixed(2)} (${(
                            allocationPct * 100
                        ).toFixed(1)}%), ` +
                        `Allowed: $${targetByCapacity.toFixed(2)} (${(
                            remainingExposure * 100
                        ).toFixed(1)}% remaining)`
                );
            }

            const riskRatio = this.config.riskPerTrade || 0.98;
            let tradeAmountUsdt = targetPositionSize * riskRatio;

            tradeAmountUsdt = Math.min(
                tradeAmountUsdt,
                this.config.maxCapitalAtRisk || 999999
            );

            if (tradeAmountUsdt > this.portfolio.usdtBalance) {
                const discrepancy =
                    tradeAmountUsdt - this.portfolio.usdtBalance;
                const discrepancyPct = (discrepancy / tradeAmountUsdt) * 100;

                if (discrepancyPct > 10) {
                    logger.error(
                        `🚨 ALLOCATION INTEGRITY VIOLATION: Expected $${tradeAmountUsdt.toFixed(
                            2
                        )}, have $${this.portfolio.usdtBalance.toFixed(
                            2
                        )} (${discrepancyPct.toFixed(1)}% gap)`
                    );
                    this.emit("allocationError", {
                        symbol: signal.symbol,
                        expected: tradeAmountUsdt,
                        available: this.portfolio.usdtBalance,
                        discrepancyPct,
                    });
                    return {
                        success: false,
                        action: "HALT",
                        reason: "Allocation integrity violation",
                    };
                }

                const cashAvailable = this.portfolio.usdtBalance * 0.99;
                logger.warn(
                    `⚠️ Cash-Constrained: Scaling ${
                        signal.symbol
                    } from $${tradeAmountUsdt.toFixed(
                        2
                    )} → $${cashAvailable.toFixed(2)}`
                );
                tradeAmountUsdt = cashAvailable;
            }

            if (tradeAmountUsdt < 10) {
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Trade size below minimum ($10)",
                };
            }

            const quantity = tradeAmountUsdt / currentPrice;

            try {
                const order = await this.binanceData.executeOrder(
                    signal.symbol,
                    "BUY",
                    quantity
                );

                const entryFee = this.calculateOrderFee(order);

                let stopLossPrice;
                if (this.config.stopLossType === "FIXED") {
                    stopLossPrice =
                        currentPrice *
                        (1 - (this.config.stopLossPercent || 0.05));
                } else {
                    stopLossPrice =
                        currentPrice -
                        (atr || 0) * (this.config.stopLossATR || 1.5);
                }

                const trailingStopDist =
                    this.config.trailingStopPercent || 0.03;

                const tradeRecord = {
                    id: order.orderId.toString(),
                    symbol: signal.symbol,
                    side: "BUY",
                    price: parseFloat(order.fills?.[0]?.price || currentPrice),
                    quantity: parseFloat(order.executedQty),
                    usdtCost: parseFloat(order.cummulativeQuoteQty),
                    orderId: order.orderId,
                    timestamp: Date.now(),
                    signal: signal.signal,
                    signalStrength: signal.strength,
                    atr: signal.atr || atr,
                    isOpen: true,
                    mode: "live",
                    stopLoss: stopLossPrice,
                    trailingStopPrice: this.config.enableTrailingStops
                        ? currentPrice * (1 - trailingStopDist)
                        : null,
                    fee_usdt_value: entryFee,
                };

                try {
                    await this.tradeRepo.save(tradeRecord);
                } catch (dbErr) {
                    logger.error(
                        "❌ CRITICAL: Failed to save trade to DB!",
                        dbErr
                    );
                }

                this.portfolio.positions.push(tradeRecord);
                this.portfolio.usdtBalance -= tradeRecord.usdtCost;
                this.portfolio.totalFees += entryFee;

                // FIX #2: Log new exposure after trade
                const newExposure = this._calculateCurrentExposure();
                logger.info(
                    `✅ BUY ${signal.symbol}: $${tradeRecord.usdtCost.toFixed(
                        2
                    )}. ` +
                        `Portfolio exposure: ${(newExposure * 100).toFixed(1)}%`
                );

                this.emit("tradeExecuted", tradeRecord);
                return { success: true, action: "BUY", order };
            } catch (err) {
                logger.error("❌ Buy Execution Failed:", err.message);
                return { success: false, action: "ERROR", reason: err.message };
            }
        }

        if (signal.signal === "SELL" && openPosition) {
            return await this.closePosition(
                openPosition,
                currentPrice,
                "SIGNAL_EXIT"
            );
        }

        return { success: false, action: "NONE" };
    }

    _calculateCurrentEquity() {
        let cryptoValue = 0;
        this.portfolio.positions.forEach((pos) => {
            const price =
                this.binanceData.getCurrentPrice(pos.symbol)?.price ||
                pos.currentPrice;
            cryptoValue += pos.quantity * price;
        });
        return this.portfolio.usdtBalance + cryptoValue;
    }

    /**
     * Close an open position
     * FIX #1: Added atomic lock to prevent race conditions during simultaneous exit triggers
     */
    async closePosition(position, currentPrice, reason) {
        // FIX #1: Create a unique lock key for this position
        const lockKey = `${position.symbol}_${position.id}`;

        // FIX #1: Check if this position is already being closed
        if (this._closingPositions.has(lockKey)) {
            logger.warn(
                `⚠️ DUPLICATE CLOSE BLOCKED: ${position.symbol} (${position.id}) already closing. Reason attempted: ${reason}`
            );
            return {
                success: false,
                action: "SKIP",
                reason: "Position already being closed",
            };
        }

        // FIX #1: Verify position still exists in portfolio before proceeding
        const existingPosition = this.portfolio.positions.find(
            (p) => p.symbol === position.symbol && p.id === position.id
        );
        if (!existingPosition) {
            logger.warn(
                `⚠️ CLOSE SKIPPED: Position ${position.symbol} (${position.id}) no longer exists in portfolio.`
            );
            return {
                success: false,
                action: "SKIP",
                reason: "Position not found in portfolio",
            };
        }

        // FIX #1: Acquire the lock
        this._closingPositions.add(lockKey);
        logger.info(
            `🔒 Lock acquired for ${position.symbol} (${position.id}). Reason: ${reason}`
        );

        try {
            logger.info(`📉 Closing ${position.symbol} due to ${reason}...`);
            const quantity = position.quantity;

            const order = await this.binanceData.executeOrder(
                position.symbol,
                "SELL",
                quantity
            );

            const exitFee = this.calculateOrderFee(order);

            const exitPrice = parseFloat(
                order.fills?.[0]?.price || currentPrice
            );
            const usdtReceived = parseFloat(order.cummulativeQuoteQty);
            const pnl = usdtReceived - position.usdtCost;

            const totalTradeFee = (position.fee_usdt_value || 0) + exitFee;

            await this.tradeRepo.updateTrade(position.id, {
                is_open: 0,
                exit_price: exitPrice,
                exit_time: Date.now(),
                pnl: pnl,
                exit_reason: reason,
                fee_usdt_value: totalTradeFee,
            });

            // FIX #1: Remove position by BOTH symbol AND id for precision
            this.portfolio.positions = this.portfolio.positions.filter(
                (p) => !(p.symbol === position.symbol && p.id === position.id)
            );
            this.portfolio.usdtBalance += usdtReceived;
            this.portfolio.dailyPnL += pnl;
            this.portfolio.totalPnL += pnl;
            this.portfolio.totalFees += exitFee;

            this.portfolio.stats.totalTrades++;
            if (pnl > 0) this.portfolio.stats.winningTrades++;
            this.portfolio.stats.winRate =
                (this.portfolio.stats.winningTrades /
                    this.portfolio.stats.totalTrades) *
                100;

            const tradeRecord = {
                ...position,
                side: "SELL",
                status: "CLOSED",
                pnl,
                exitPrice,
                reason,
                fee_usdt_value: totalTradeFee,
            };
            this.emit("tradeExecuted", tradeRecord);

            // FIX #2: Log exposure after closing
            const newExposure = this._calculateCurrentExposure();
            logger.info(
                `✅ Sold ${position.symbol}. PnL: $${pnl.toFixed(
                    2
                )} (Fees: $${totalTradeFee.toFixed(3)}). ` +
                    `Portfolio exposure: ${(newExposure * 100).toFixed(1)}%`
            );
            return { success: true, action: "SELL", order };
        } catch (err) {
            logger.error(`❌ Failed to close ${position.symbol}:`, err.message);
            return { success: false, action: "ERROR", reason: err.message };
        } finally {
            // FIX #1: Always release the lock, even if an error occurred
            this._closingPositions.delete(lockKey);
            logger.debug(
                `🔓 Lock released for ${position.symbol} (${position.id})`
            );
        }
    }

    updatePortfolioValue(allPrices) {
        if (!allPrices) return;

        let totalCryptoValue = 0;
        let unrealizedPnL = 0;

        this.portfolio.positions.forEach((pos) => {
            const currentPrice = allPrices[pos.symbol]?.price;
            if (!currentPrice) return;

            const currentValue = pos.quantity * currentPrice;
            const posPnL = currentValue - pos.usdtCost;

            pos.currentPrice = currentPrice;
            pos.unrealizedPnL = posPnL;
            totalCryptoValue += currentValue;
            unrealizedPnL += posPnL;

            this.checkExitConditions(pos, currentPrice);
        });

        this.portfolio.totalValue =
            this.portfolio.usdtBalance + totalCryptoValue;
        this.emit("portfolioUpdated", this.getPortfolioSummary());
    }

    checkExitConditions(position, currentPrice) {
        // FIX #1: Skip exit checks if position is already being closed
        const lockKey = `${position.symbol}_${position.id}`;
        if (this._closingPositions.has(lockKey)) {
            return;
        }

        if (position.stopLoss && currentPrice <= position.stopLoss) {
            this.closePosition(position, currentPrice, "STOP_LOSS");
            return;
        }

        if (
            this.config.enableTrailingStops &&
            (position.trailingStopPrice || position.trailing_stop_price)
        ) {
            let currentTrailingStop =
                position.trailingStopPrice || position.trailing_stop_price;

            const trailingPercent = this.config.trailingStopPercent || 0.03;
            const newStop = currentPrice * (1 - trailingPercent);

            if (newStop > currentTrailingStop) {
                position.trailingStopPrice = newStop;
                this.tradeRepo
                    .updateTrade(position.id, { trailing_stop_price: newStop })
                    .catch((e) => logger.error("Failed to update TS:", e));
            }

            if (currentPrice <= position.trailingStopPrice) {
                this.closePosition(position, currentPrice, "TRAILING_STOP");
                return;
            }
        }
    }

    getPortfolioSummary() {
        // FIX #2: Include exposure in portfolio summary
        const currentExposure = this._calculateCurrentExposure();

        return {
            ...this.portfolio,
            cryptoValue: this.portfolio.totalValue - this.portfolio.usdtBalance,
            dailyPnL: this.portfolio.dailyPnL,
            totalFees: this.portfolio.totalFees,
            exposure: currentExposure, // FIX #2: New field
            exposurePercent: (currentExposure * 100).toFixed(1) + "%", // FIX #2: Human-readable
            performance: {
                winRate: this.portfolio.stats.winRate,
                totalTrades: this.portfolio.stats.totalTrades,
                dailyPnL: this.portfolio.dailyPnL,
            },
            riskStatus: this.riskService.getRiskStatus(this.portfolio),
            timestamp: Date.now(),
        };
    }

    getStatus() {
        return {
            mode: "live",
            isActive: true,
            positions: this.portfolio.positions.length,
            closingPositions: this._closingPositions.size,
            exposure: (this._calculateCurrentExposure() * 100).toFixed(1) + "%", // FIX #2
        };
    }
}

module.exports = LiveTradingEngine;
