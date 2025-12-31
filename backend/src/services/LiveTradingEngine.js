// backend/src/services/LiveTradingEngine.js - V3.2.3 TRANSACTION ATOMICITY FIX
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

        // FIX #3: Recovery queue for failed DB operations
        this._recoveryQueue = [];

        // FIX #2: Validate allocation config on construction
        this._validateAllocationConfig();
    }

    /**
     * FIX #2: Validate that allocation percentages don't exceed 100%
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

    /**
     * FIX #3: Retry wrapper for database operations with exponential backoff
     */
    async _retryDbOperation(operation, operationName, maxAttempts = 3) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await operation();
                return { success: true };
            } catch (err) {
                const delay = Math.min(100 * Math.pow(2, attempt), 2000); // 200ms, 400ms, 800ms...
                logger.warn(
                    `⚠️ DB ${operationName} attempt ${attempt}/${maxAttempts} failed: ${err.message}. ` +
                        `${
                            attempt < maxAttempts
                                ? `Retrying in ${delay}ms...`
                                : "Giving up."
                        }`
                );
                if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, delay));
                } else {
                    return { success: false, error: err };
                }
            }
        }
        return { success: false, error: new Error("Max retries exceeded") };
    }

    /**
     * FIX #3: Add trade to recovery queue for manual review
     */
    _addToRecoveryQueue(tradeRecord, reason) {
        const recoveryEntry = {
            timestamp: Date.now(),
            reason,
            trade: tradeRecord,
        };
        this._recoveryQueue.push(recoveryEntry);
        logger.error(
            `🚨 RECOVERY QUEUE: Added ${tradeRecord.symbol} (${tradeRecord.id}). ` +
                `Reason: ${reason}. Queue size: ${this._recoveryQueue.length}`
        );
        this.emit("recoveryQueueUpdated", {
            entry: recoveryEntry,
            queueSize: this._recoveryQueue.length,
        });
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
                `🔄 Restored ${this.portfolio.positions.length} active positions from DB.`
            );
        } catch (err) {
            logger.warn(
                "⚠️ Could not restore positions (likely empty DB): " +
                    err.message
            );
            this.portfolio.positions = [];
        }

        // FIX #3: Reconcile with exchange to detect orphaned positions
        await this._reconcileWithExchange(account);

        await this.calculatePerformanceStats();
    }

    /**
     * FIX #3: Reconcile local state with actual Binance holdings
     * Detects "zombie" positions (crypto we own but isn't tracked)
     */
    async _reconcileWithExchange(account) {
        logger.info("🔍 Reconciling with Binance exchange...");

        if (!account || account.error || !account.balances) {
            logger.warn("⚠️ Cannot reconcile: No account data available");
            return;
        }

        const trackedSymbols = new Set(
            this.portfolio.positions.map((p) => p.symbol)
        );
        const configuredAssets = this.config.assets || [];
        const orphanedPositions = [];
        const zombiePositions = [];

        // Check each configured asset for untracked holdings
        for (const symbol of configuredAssets) {
            const baseAsset = symbol.replace("USDT", "");
            const balance = account.balances.find((b) => b.asset === baseAsset);

            if (balance && balance.total > 0) {
                const priceData = this.binanceData.getCurrentPrice(symbol);
                const usdtValue = priceData
                    ? balance.total * priceData.price
                    : 0;

                // Only flag if value is significant (> $5)
                if (usdtValue > 5) {
                    if (!trackedSymbols.has(symbol)) {
                        // We have crypto that's NOT in our tracked positions
                        orphanedPositions.push({
                            symbol,
                            asset: baseAsset,
                            quantity: balance.total,
                            estimatedValue: usdtValue,
                        });
                    }
                }
            }
        }

        // Check for DB positions where we no longer hold the crypto
        for (const position of this.portfolio.positions) {
            const baseAsset = position.symbol.replace("USDT", "");
            const balance = account.balances.find((b) => b.asset === baseAsset);

            if (!balance || balance.total < position.quantity * 0.99) {
                // 1% tolerance for dust
                zombiePositions.push({
                    dbPosition: position,
                    actualBalance: balance?.total || 0,
                });
            }
        }

        // Report findings
        if (orphanedPositions.length > 0) {
            logger.warn(
                `🚨 ORPHANED CRYPTO DETECTED: Found ${orphanedPositions.length} untracked position(s):`
            );
            for (const orphan of orphanedPositions) {
                logger.warn(
                    `   - ${orphan.symbol}: ${orphan.quantity.toFixed(6)} ${
                        orphan.asset
                    } (~$${orphan.estimatedValue.toFixed(2)})`
                );

                // Create recovery record for manual review
                this._addToRecoveryQueue(
                    {
                        id: `ORPHAN_${orphan.symbol}_${Date.now()}`,
                        symbol: orphan.symbol,
                        quantity: orphan.quantity,
                        side: "ORPHAN",
                        estimatedValue: orphan.estimatedValue,
                    },
                    "Untracked crypto found on exchange"
                );
            }

            this.emit("orphanedPositionsDetected", orphanedPositions);
        }

        if (zombiePositions.length > 0) {
            logger.warn(
                `🧟 ZOMBIE POSITIONS DETECTED: Found ${zombiePositions.length} DB record(s) without matching crypto:`
            );
            for (const zombie of zombiePositions) {
                logger.warn(
                    `   - ${
                        zombie.dbPosition.symbol
                    }: DB shows ${zombie.dbPosition.quantity.toFixed(6)}, ` +
                        `Exchange has ${zombie.actualBalance.toFixed(6)}`
                );

                // Auto-fix: Mark as closed in DB if crypto is gone
                try {
                    logger.info(
                        `🔧 Auto-closing zombie position ${zombie.dbPosition.symbol} in DB...`
                    );
                    await this.tradeRepo.updateTrade(zombie.dbPosition.id, {
                        is_open: 0,
                        exit_reason: "ZOMBIE_RECONCILE",
                        exit_time: Date.now(),
                        pnl: 0, // Unknown PnL - manual review needed
                    });

                    // Remove from in-memory positions
                    this.portfolio.positions = this.portfolio.positions.filter(
                        (p) => p.id !== zombie.dbPosition.id
                    );

                    logger.success(
                        `✅ Zombie ${zombie.dbPosition.symbol} removed from tracking.`
                    );
                } catch (err) {
                    logger.error(
                        `❌ Failed to auto-fix zombie: ${err.message}`
                    );
                }
            }

            this.emit("zombiePositionsDetected", zombiePositions);
        }

        if (orphanedPositions.length === 0 && zombiePositions.length === 0) {
            logger.success(
                "✅ Reconciliation complete: DB and Exchange are in sync."
            );
        }
    }

    updateConfig(config) {
        this.config = config;
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
     * FIX #2: Calculate current portfolio exposure
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

            // FIX #2: Exposure cap check
            const maxExposure = this.config.maxPortfolioExposure ?? 0.95;
            const currentExposure = this._calculateCurrentExposure();
            const remainingExposure = Math.max(
                0,
                maxExposure - currentExposure
            );

            if (remainingExposure <= 0.01) {
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

            // FIX #2: Cap by remaining exposure
            const targetByAllocation = totalEquity * allocationPct;
            const targetByCapacity = totalEquity * remainingExposure;
            let targetPositionSize = Math.min(
                targetByAllocation,
                targetByCapacity
            );

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
                        )}, ` +
                            `have $${this.portfolio.usdtBalance.toFixed(
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

            // FIX #3: Execute order with proper atomicity
            let order;
            try {
                order = await this.binanceData.executeOrder(
                    signal.symbol,
                    "BUY",
                    quantity
                );
            } catch (err) {
                logger.error("❌ Buy Execution Failed:", err.message);
                return { success: false, action: "ERROR", reason: err.message };
            }

            // Order succeeded - now we MUST track this position
            const entryFee = this.calculateOrderFee(order);

            let stopLossPrice;
            if (this.config.stopLossType === "FIXED") {
                stopLossPrice =
                    currentPrice * (1 - (this.config.stopLossPercent || 0.05));
            } else {
                stopLossPrice =
                    currentPrice -
                    (atr || 0) * (this.config.stopLossATR || 1.5);
            }

            const trailingStopDist = this.config.trailingStopPercent || 0.03;

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

            // FIX #3: Try to save to DB with retries
            const dbResult = await this._retryDbOperation(
                () => this.tradeRepo.save(tradeRecord),
                `SAVE trade ${tradeRecord.symbol}`
            );

            if (!dbResult.success) {
                // DB save failed after retries - add to recovery queue but keep in memory
                logger.error(
                    `🚨 CRITICAL: Failed to save ${signal.symbol} trade to DB after retries! ` +
                        `Position is tracked in memory but NOT persisted. Manual intervention required.`
                );
                this._addToRecoveryQueue(
                    tradeRecord,
                    "DB save failed after 3 retries"
                );
            }

            // Always update in-memory state (we own the crypto now)
            this.portfolio.positions.push(tradeRecord);
            this.portfolio.usdtBalance -= tradeRecord.usdtCost;
            this.portfolio.totalFees += entryFee;

            const newExposure = this._calculateCurrentExposure();
            logger.info(
                `✅ BUY ${signal.symbol}: $${tradeRecord.usdtCost.toFixed(
                    2
                )}. ` +
                    `Portfolio exposure: ${(newExposure * 100).toFixed(1)}%` +
                    `${
                        !dbResult.success
                            ? " ⚠️ DB SAVE FAILED - IN RECOVERY QUEUE"
                            : ""
                    }`
            );

            this.emit("tradeExecuted", tradeRecord);
            return {
                success: true,
                action: "BUY",
                order,
                dbSaved: dbResult.success,
            };
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
     * FIX #1: Atomic lock, FIX #3: DB retry logic
     */
    async closePosition(position, currentPrice, reason) {
        const lockKey = `${position.symbol}_${position.id}`;

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

        this._closingPositions.add(lockKey);
        logger.info(
            `🔒 Lock acquired for ${position.symbol} (${position.id}). Reason: ${reason}`
        );

        let order;
        try {
            logger.info(`📉 Closing ${position.symbol} due to ${reason}...`);
            const quantity = position.quantity;

            // Execute SELL order first
            order = await this.binanceData.executeOrder(
                position.symbol,
                "SELL",
                quantity
            );
        } catch (err) {
            logger.error(
                `❌ Failed to execute SELL for ${position.symbol}:`,
                err.message
            );
            this._closingPositions.delete(lockKey);
            return { success: false, action: "ERROR", reason: err.message };
        }

        // SELL succeeded - now update records
        const exitFee = this.calculateOrderFee(order);
        const exitPrice = parseFloat(order.fills?.[0]?.price || currentPrice);
        const usdtReceived = parseFloat(order.cummulativeQuoteQty);
        const pnl = usdtReceived - position.usdtCost;
        const totalTradeFee = (position.fee_usdt_value || 0) + exitFee;

        // FIX #3: Try to update DB with retries
        const dbResult = await this._retryDbOperation(
            () =>
                this.tradeRepo.updateTrade(position.id, {
                    is_open: 0,
                    exit_price: exitPrice,
                    exit_time: Date.now(),
                    pnl: pnl,
                    exit_reason: reason,
                    fee_usdt_value: totalTradeFee,
                }),
            `UPDATE trade ${position.symbol} (close)`
        );

        if (!dbResult.success) {
            logger.error(
                `🚨 CRITICAL: Failed to update ${position.symbol} close in DB after retries! ` +
                    `Position will be removed from memory but DB shows it as open. Manual intervention required.`
            );
            this._addToRecoveryQueue(
                {
                    ...position,
                    exitPrice,
                    pnl,
                    exitReason: reason,
                    fee_usdt_value: totalTradeFee,
                },
                "DB update failed after 3 retries (SELL succeeded)"
            );
        }

        // Always update in-memory state (we no longer own the crypto)
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

        const newExposure = this._calculateCurrentExposure();
        logger.info(
            `✅ Sold ${position.symbol}. PnL: $${pnl.toFixed(
                2
            )} (Fees: $${totalTradeFee.toFixed(3)}). ` +
                `Portfolio exposure: ${(newExposure * 100).toFixed(1)}%` +
                `${
                    !dbResult.success
                        ? " ⚠️ DB UPDATE FAILED - IN RECOVERY QUEUE"
                        : ""
                }`
        );

        this._closingPositions.delete(lockKey);
        logger.debug(
            `🔓 Lock released for ${position.symbol} (${position.id})`
        );

        return {
            success: true,
            action: "SELL",
            order,
            dbSaved: dbResult.success,
        };
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
        const currentExposure = this._calculateCurrentExposure();

        return {
            ...this.portfolio,
            cryptoValue: this.portfolio.totalValue - this.portfolio.usdtBalance,
            dailyPnL: this.portfolio.dailyPnL,
            totalFees: this.portfolio.totalFees,
            exposure: currentExposure,
            exposurePercent: (currentExposure * 100).toFixed(1) + "%",
            recoveryQueueSize: this._recoveryQueue.length, // FIX #3: Expose recovery queue
            performance: {
                winRate: this.portfolio.stats.winRate,
                totalTrades: this.portfolio.stats.totalTrades,
                dailyPnL: this.portfolio.dailyPnL,
            },
            riskStatus: this.riskService.getRiskStatus(this.portfolio),
            timestamp: Date.now(),
        };
    }

    /**
     * FIX #3: Get recovery queue for manual review/retry
     */
    getRecoveryQueue() {
        return [...this._recoveryQueue];
    }

    /**
     * FIX #3: Clear an item from recovery queue after manual resolution
     */
    clearRecoveryQueueItem(index) {
        if (index >= 0 && index < this._recoveryQueue.length) {
            const removed = this._recoveryQueue.splice(index, 1);
            logger.info(
                `🗑️ Removed item from recovery queue: ${removed[0]?.trade?.symbol}`
            );
            return true;
        }
        return false;
    }

    /**
     * FIX #3: Retry saving all items in recovery queue
     */
    async retryRecoveryQueue() {
        if (this._recoveryQueue.length === 0) {
            logger.info("Recovery queue is empty.");
            return { processed: 0, succeeded: 0 };
        }

        logger.info(
            `🔄 Retrying ${this._recoveryQueue.length} items in recovery queue...`
        );
        let succeeded = 0;
        const toRemove = [];

        for (let i = 0; i < this._recoveryQueue.length; i++) {
            const item = this._recoveryQueue[i];
            try {
                if (item.trade.side === "BUY" || item.trade.side === "ORPHAN") {
                    await this.tradeRepo.save(item.trade);
                } else {
                    await this.tradeRepo.updateTrade(item.trade.id, {
                        is_open: 0,
                        exit_price: item.trade.exitPrice,
                        exit_time: Date.now(),
                        pnl: item.trade.pnl,
                        exit_reason: item.trade.exitReason || "RECOVERY_RETRY",
                    });
                }
                toRemove.push(i);
                succeeded++;
                logger.success(
                    `✅ Recovery succeeded for ${item.trade.symbol}`
                );
            } catch (err) {
                logger.warn(
                    `⚠️ Recovery still failing for ${item.trade.symbol}: ${err.message}`
                );
            }
        }

        // Remove succeeded items (in reverse order to preserve indices)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            this._recoveryQueue.splice(toRemove[i], 1);
        }

        return {
            processed: toRemove.length + this._recoveryQueue.length,
            succeeded,
        };
    }

    getStatus() {
        return {
            mode: "live",
            isActive: true,
            positions: this.portfolio.positions.length,
            closingPositions: this._closingPositions.size,
            exposure: (this._calculateCurrentExposure() * 100).toFixed(1) + "%",
            recoveryQueueSize: this._recoveryQueue.length, // FIX #3
        };
    }
}

module.exports = LiveTradingEngine;
