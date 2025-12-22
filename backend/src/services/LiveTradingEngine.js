// backend/src/services/LiveTradingEngine.js - ADDED FEE TRACKING
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
            totalFees: 0, // [NEW] Track cumulative fees in memory
            stats: { winRate: 0, totalTrades: 0, winningTrades: 0 },
        };
    }

    async initialize() {
        logger.info("🔌 Live Trading Engine Connecting...");
        const account = await this.binanceData.getAccountInfo();
        if (account.error) throw new Error("Binance Connection Failed");

        this.portfolio.usdtBalance = parseFloat(
            account.balances.find((b) => b.asset === "USDT")?.free || 0
        );
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
        logger.info("🔁 Live Engine Config Updated");
    }

    // [NEW] Helper to parse commission from Binance response
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
                        // Get real-time BNB price for conversion
                        const bnbPrice =
                            this.binanceData.getCurrentPrice("BNBUSDT")
                                ?.price || 0;
                        totalUsdtFee += feeAmount * bnbPrice;
                    } else {
                        // Fallback for asset-based fees (rare if paying in BNB)
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

            // [NEW] Hydrate historical fees
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

            const allocationPct =
                this.config.allocation?.[signal.symbol] ?? 0.15;

            if (allocationPct === 0) {
                return {
                    success: false,
                    action: "SKIP",
                    reason: `Allocation set to 0% for ${signal.symbol}`,
                };
            }

            const maxAllocatedUsdt = this.portfolio.usdtBalance * allocationPct;
            const riskRatio = this.config.riskPerTrade || 0.98;
            const tradeAmountUsdt = Math.min(
                maxAllocatedUsdt * riskRatio,
                this.config.maxCapitalAtRisk || 999999
            );

            if (tradeAmountUsdt < (this.config.minOrderSize || 10))
                return {
                    success: false,
                    action: "SKIP",
                    reason: `Insufficient allocated capital ($${tradeAmountUsdt.toFixed(
                        2
                    )})`,
                };

            let quantity = tradeAmountUsdt / currentPrice;
            quantity = this.binanceData.stepSize(signal.symbol, quantity);

            logger.info(
                `⚖️ Sizing: ${quantity} ${
                    signal.symbol
                } ($${tradeAmountUsdt.toFixed(2)})`
            );

            try {
                const order = await this.binanceData.executeOrder(
                    signal.symbol,
                    "BUY",
                    quantity
                );

                // [NEW] Capture Entry Fee
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

                    // [NEW] Store the fee
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

                // [NEW] Update memory stats
                this.portfolio.totalFees += entryFee;

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

    async closePosition(position, currentPrice, reason) {
        try {
            logger.info(`📉 Closing ${position.symbol} due to ${reason}...`);
            const quantity = position.quantity;

            const order = await this.binanceData.executeOrder(
                position.symbol,
                "SELL",
                quantity
            );

            // [NEW] Capture Exit Fee
            const exitFee = this.calculateOrderFee(order);

            const exitPrice = parseFloat(
                order.fills?.[0]?.price || currentPrice
            );
            const usdtReceived = parseFloat(order.cummulativeQuoteQty);
            const pnl = usdtReceived - position.usdtCost;

            // Calculate total fee for this trade (Entry + Exit)
            const totalTradeFee = (position.fee_usdt_value || 0) + exitFee;

            await this.tradeRepo.updateTrade(position.id, {
                is_open: 0,
                exit_price: exitPrice,
                exit_time: Date.now(),
                pnl: pnl,
                exit_reason: reason,
                // [NEW] Update DB with cumulative fee
                fee_usdt_value: totalTradeFee,
            });

            this.portfolio.positions = this.portfolio.positions.filter(
                (p) => p.symbol !== position.symbol
            );
            this.portfolio.usdtBalance += usdtReceived;
            this.portfolio.dailyPnL += pnl;
            this.portfolio.totalPnL += pnl;

            // [NEW] Update memory stats
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
                fee_usdt_value: totalTradeFee, // Pass to frontend
            };
            this.emit("tradeExecuted", tradeRecord);

            logger.info(
                `✅ Sold ${position.symbol}. PnL: $${pnl.toFixed(
                    2
                )} (Fees: $${totalTradeFee.toFixed(3)})`
            );
            return { success: true, action: "SELL", order };
        } catch (err) {
            logger.error(`❌ Failed to close ${position.symbol}:`, err.message);
            return { success: false, action: "ERROR", reason: err.message };
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
                    .updateTrade(position.id, { trailingStopPrice: newStop })
                    .catch((e) => logger.error("Failed to update TS:", e));
            }

            if (currentPrice <= position.trailingStopPrice) {
                this.closePosition(position, currentPrice, "TRAILING_STOP");
                return;
            }
        }
    }

    getPortfolioSummary() {
        return {
            ...this.portfolio,
            cryptoValue: this.portfolio.totalValue - this.portfolio.usdtBalance,
            dailyPnL: this.portfolio.dailyPnL,
            // [NEW] Send fee stat to Frontend
            totalFees: this.portfolio.totalFees,
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
        };
    }
}

module.exports = LiveTradingEngine;
