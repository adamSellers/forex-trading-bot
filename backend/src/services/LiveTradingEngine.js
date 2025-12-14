// backend/src/services/LiveTradingEngine.js - FINAL CLEAN ARCHITECTURE
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

        // State
        this.portfolio = {
            usdtBalance: 0,
            positions: [],
            totalValue: 0,
            totalPnL: 0,
            dailyPnL: 0,
            // Stats for Dashboard
            stats: {
                winRate: 0,
                totalTrades: 0,
                winningTrades: 0,
            },
        };
    }

    async initialize() {
        logger.info("🔌 Live Trading Engine Connecting...");

        // 1. Verify Binance Connection & Get Balance
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

        // 2. Load "OPEN" positions (State Recovery)
        const dbPositions = await this.tradeRepo.getOpenPositions("live");
        this.portfolio.positions = dbPositions.map((p) => ({
            ...p,
            currentPrice: p.price,
            unrealizedPnL: 0,
        }));

        logger.info(
            `🔄 Restored ${this.portfolio.positions.length} active positions.`
        );

        // 3. Hydrate Historical Stats
        await this.calculatePerformanceStats();
    }

    async calculatePerformanceStats() {
        try {
            const allTrades = await this.tradeRepo.getAllTrades("live");
            const closedTrades = allTrades.filter((t) => t.status === "CLOSED");

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
        } catch (e) {
            logger.warn("⚠️ Could not load stats, starting fresh.");
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

    // --- CORE TRADING LOGIC ---

    async processSignal(signal, currentPrice, atr) {
        if (signal.signal !== "BUY" && signal.signal !== "SELL")
            return { success: false, action: "NONE" };

        // 1. Global Risk Check
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

        // --- BUY SIGNAL ---
        if (signal.signal === "BUY") {
            if (openPosition)
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Position already open",
                };

            // Allocation: Use config % or default 15%
            const allocationPct =
                this.config.allocation?.[signal.symbol] || 0.15;
            const maxAllocatedUsdt = this.portfolio.usdtBalance * allocationPct;

            // Cap at Max Risk Capital
            const tradeAmountUsdt = Math.min(
                maxAllocatedUsdt,
                this.config.maxCapitalAtRisk || 999999
            );

            if (tradeAmountUsdt < 15)
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Insufficient allocated capital (<$15)",
                };

            // CALL NEW SERVICE METHOD
            let quantity = tradeAmountUsdt / currentPrice;
            quantity = this.binanceData.stepSize(signal.symbol, quantity);

            logger.info(
                `⚖️ Sizing: Bal $${this.portfolio.usdtBalance.toFixed(2)} * ${
                    allocationPct * 100
                }% = $${tradeAmountUsdt.toFixed(2)} -> ${quantity} ${
                    signal.symbol
                }`
            );

            try {
                // CALL NEW SERVICE METHOD
                const order = await this.binanceData.executeOrder(
                    signal.symbol,
                    "BUY",
                    quantity
                );

                // Construct Record
                const tradeRecord = {
                    symbol: signal.symbol,
                    side: "BUY",
                    price: parseFloat(order.fills?.[0]?.price || currentPrice),
                    quantity: parseFloat(order.executedQty),
                    usdtCost: parseFloat(order.cummulativeQuoteQty),
                    orderId: order.orderId,
                    timestamp: Date.now(),
                    status: "OPEN",
                    stopLoss:
                        currentPrice - atr * (this.config.stopLossATR || 1.5),
                    trailingStop: this.config.enableTrailingStops
                        ? currentPrice * (1 - this.config.trailingStopPercent)
                        : null,
                    mode: "live",
                };

                // Safe DB Write
                try {
                    const id = await this.tradeRepo.create(tradeRecord);
                    tradeRecord.id = id;
                } catch (dbErr) {
                    logger.error(
                        "⚠️ Ghost Trade averted: Order filled but DB write failed.",
                        dbErr.message
                    );
                }

                // Update Local State
                this.portfolio.positions.push(tradeRecord);
                this.portfolio.usdtBalance -= tradeRecord.usdtCost;

                this.emit("tradeExecuted", tradeRecord);
                return { success: true, action: "BUY", order };
            } catch (err) {
                logger.error("❌ Buy Execution Failed:", err.message);
                return { success: false, action: "ERROR", reason: err.message };
            }
        }

        // --- SELL SIGNAL ---
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

            // CALL NEW SERVICE METHOD
            const order = await this.binanceData.executeOrder(
                position.symbol,
                "SELL",
                quantity
            );

            const exitPrice = parseFloat(
                order.fills?.[0]?.price || currentPrice
            );
            const usdtReceived = parseFloat(order.cummulativeQuoteQty);
            const pnl = usdtReceived - position.usdtCost;

            await this.tradeRepo.updateStatus(position.id, "CLOSED", {
                exitPrice,
                exitTime: Date.now(),
                pnl,
                reason,
            });

            // Update State
            this.portfolio.positions = this.portfolio.positions.filter(
                (p) => p.symbol !== position.symbol
            );
            this.portfolio.usdtBalance += usdtReceived;
            this.portfolio.dailyPnL += pnl;
            this.portfolio.totalPnL += pnl;

            // Update Stats
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
            };
            this.emit("tradeExecuted", tradeRecord);

            logger.info(`✅ Sold ${position.symbol}. PnL: $${pnl.toFixed(2)}`);
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
            const currentPrice = allPrices[pos.symbol];
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
        // Hard Stop
        if (position.stopLoss && currentPrice <= position.stopLoss) {
            this.closePosition(position, currentPrice, "STOP_LOSS");
            return;
        }
        // Trailing Stop
        if (this.config.enableTrailingStops && position.trailingStop) {
            const trailingPercent = this.config.trailingStopPercent || 0.03;
            const newStop = currentPrice * (1 - trailingPercent);
            if (newStop > position.trailingStop)
                position.trailingStop = newStop;
            if (currentPrice <= position.trailingStop) {
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
        return { mode: "live", active: true };
    }
}

module.exports = LiveTradingEngine;
