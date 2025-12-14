// backend/src/services/LiveTradingEngine.js - FIXED LOT_SIZE ERROR
const EventEmitter = require("events");
const logger = require("../utils/logger");
const TradeRepository = require("../repositories/tradeRepository");
const PortfolioRepository = require("../repositories/portfolioRepository");
const binanceClient = require("./binanceClient");

class LiveTradingEngine extends EventEmitter {
    constructor(config = {}, binanceDataService, riskService) {
        super();
        this.config = {
            maxCapitalAtRisk: config.maxCapitalAtRisk || 1000,
            riskPerTrade: config.riskPerTrade || 0.02,
            stopLossATR: 1.5,
            takeProfitATR: 3.0,
            ...config,
        };
        this.binanceData = binanceDataService;
        this.riskService = riskService;
        this.tradeRepo = new TradeRepository();
        this.portfolioRepo = new PortfolioRepository();

        this.processingLocks = new Set();
        this.mode = "live";

        // --- RESTORED STATE FOR FRONTEND ---
        this.livePortfolioState = {
            totalPnL: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
            totalTrades: 0,
            winningTrades: 0,
            winRate: 0,
        };

        logger.info("🚀 Live Engine v3.2 (LOT_SIZE Fix) Ready");
    }

    async initialize() {
        // Hydrate PnL & Stats from DB
        const allLiveTrades = await this.tradeRepo.getAllTrades("live");
        const sellTrades = allLiveTrades.filter((t) => t.side === "SELL");

        this.livePortfolioState.totalPnL = sellTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );
        this.livePortfolioState.totalTrades = sellTrades.length;
        this.livePortfolioState.winningTrades = sellTrades.filter(
            (t) => t.pnl > 0
        ).length;
        this.livePortfolioState.winRate =
            this.livePortfolioState.totalTrades > 0
                ? (this.livePortfolioState.winningTrades /
                      this.livePortfolioState.totalTrades) *
                  100
                : 0;
    }

    // --- REQUIRED BY TRADING CONTROLLER/FRONTEND ---
    async getPortfolioSummary() {
        const accountInfo = await this.binanceData.getAccountInfo();
        const usdt =
            accountInfo.balances?.find((b) => b.asset === "USDT")?.free || 0;
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        const prices = this.binanceData.getAllPrices();

        const positions = openTrades.map((t) => {
            const curPrice = prices[t.symbol]?.price || t.entryPrice;
            const curVal = t.quantity * curPrice;
            return {
                symbol: t.symbol,
                quantity: t.quantity,
                entryPrice: t.entryPrice,
                currentPrice: curPrice,
                currentValue: curVal,
                unrealizedPnL: curVal - t.entryCost,
                stopLoss: t.stopLoss,
                takeProfit: t.takeProfit,
            };
        });

        const cryptoValue = positions.reduce(
            (sum, p) => sum + p.currentValue,
            0
        );

        return {
            mode: "live",
            totalValue: parseFloat(usdt) + cryptoValue,
            usdtBalance: parseFloat(usdt),
            cryptoValue: cryptoValue,
            positions: positions,
            dailyPnL: this.livePortfolioState.dailyPnL,
            performance: {
                winRate: this.livePortfolioState.winRate,
                totalTrades: this.livePortfolioState.totalTrades,
                dailyPnL: this.livePortfolioState.dailyPnL,
            },
            riskStatus: this.riskService.getRiskStatus(),
        };
    }

    async processSignal(signal, currentPrice, atrValue) {
        if (this.processingLocks.has(signal.symbol))
            return { success: false, reason: "Locked" };
        this.processingLocks.add(signal.symbol);

        try {
            if (this.riskService.isHalted())
                return { success: false, reason: "Risk Halt" };

            const openTrades = await this.tradeRepo.getOpenLiveTrades();
            const openTrade = openTrades.find(
                (t) => t.symbol === signal.symbol
            );

            if (signal.signal === "BUY" && !openTrade) {
                // SAFETY: Double-check if we actually have enough USDT before trying
                const balance = await this.getAssetBalance("USDT");
                if (balance < 15) {
                    logger.error(
                        `[LIVE] 🛑 STOPPING BUY: Insufficient USDT (${balance})`
                    );
                    return { success: false, reason: "Insufficient Funds" };
                }
                return await this.executeLiveBuy(
                    signal,
                    currentPrice,
                    atrValue
                );
            } else if (signal.signal === "SELL" && openTrade) {
                return await this.executeLiveSell(
                    signal.symbol,
                    "SIGNAL_EXIT",
                    openTrade
                );
            }
            return { success: true, action: "HOLD" };
        } catch (error) {
            logger.error(
                `[LIVE] 💥 CRITICAL EXECUTION ERROR (${signal.symbol}):`,
                error
            );
            return { success: false, reason: "Execution Error" };
        } finally {
            this.processingLocks.delete(signal.symbol);
        }
    }

    async executeLiveBuy(signal, currentPrice, atrValue) {
        const accountInfo = await this.binanceData.getAccountInfo();
        const usdt =
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;

        // Position Sizing
        const stopLossDist = atrValue * this.config.stopLossATR;
        const riskAmount =
            this.config.maxCapitalAtRisk * this.config.riskPerTrade;
        let quantity = riskAmount / stopLossDist;
        const cost = quantity * currentPrice;

        if (cost > usdt * 0.95) quantity = (usdt * 0.95) / currentPrice;
        if (quantity * currentPrice < 10)
            return { success: false, reason: "Below Min Notional" };

        // FIX: Format Quantity to correct LOT_SIZE
        const stepSize =
            this.binanceData.symbolInfo.get(signal.symbol)?.stepSize ||
            "0.00000001";
        const formattedQty = this.formatQuantity(quantity, stepSize);

        logger.info(
            `[LIVE] 🛒 Buying ${signal.symbol} Qty:${formattedQty} @ ${currentPrice}`
        );
        const order = await this.executeSmartOrder(
            signal.symbol,
            "BUY",
            formattedQty
        );

        if (order.status !== "FILLED")
            return { success: false, reason: "Order Not Filled" };

        const { avgPrice } = await this._parseOrderFills(order.fills);

        const trade = {
            id: order.orderId.toString(),
            symbol: signal.symbol,
            side: "BUY",
            quantity: parseFloat(order.executedQty),
            entryPrice: avgPrice || currentPrice,
            stopLoss: currentPrice - stopLossDist,
            takeProfit: currentPrice + atrValue * this.config.takeProfitATR,
            isOpen: true,
            timestamp: Date.now(),
            entryCost: parseFloat(order.cummulativeQuoteQty),
            mode: "live",
        };

        await this.tradeRepo.save(trade);
        this.emit("tradeExecuted", trade);
        return { success: true, trade };
    }

    async executeLiveSell(symbol, reason, trade) {
        const balance = await this.getAssetBalance(symbol.replace("USDT", ""));

        // FIX: Format Quantity to correct LOT_SIZE for sell as well
        const stepSize =
            this.binanceData.symbolInfo.get(symbol)?.stepSize || "0.00000001";
        const sellQty = this.formatQuantity(balance, stepSize);

        if (sellQty * this.binanceData.getCurrentPrice(symbol).price < 10) {
            logger.warn(`[LIVE] Dust balance, cannot exit ${symbol}`);
            return { success: false, reason: "Dust Balance" };
        }

        logger.info(
            `[LIVE] 📉 Selling ${symbol} (FULL EXIT) | Reason: ${reason}`
        );
        const order = await this.executeSmartOrder(symbol, "SELL", sellQty);

        if (order.status === "FILLED") {
            const pnl = parseFloat(order.cummulativeQuoteQty) - trade.entryCost;

            this.livePortfolioState.totalPnL += pnl;
            this.livePortfolioState.dailyPnL += pnl;
            this.livePortfolioState.totalTrades++;
            if (pnl > 0) this.livePortfolioState.winningTrades++;
            this.livePortfolioState.winRate =
                (this.livePortfolioState.winningTrades /
                    this.livePortfolioState.totalTrades) *
                100;

            await this.tradeRepo.updateTrade(trade.id, {
                isOpen: false,
                exitReason: reason,
                pnl: pnl,
                pnlPercent: (pnl / trade.entryCost) * 100,
            });

            this.emit("tradeExecuted", { symbol, side: "SELL", pnl, reason });
            return { success: true };
        }
        return { success: false, reason: "Order Fail" };
    }

    async updatePortfolioValue(priceData) {
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        for (const trade of openTrades) {
            if (this.processingLocks.has(trade.symbol)) continue;
            this.processingLocks.add(trade.symbol);

            try {
                const currentPrice = priceData[trade.symbol]?.price;
                if (!currentPrice) continue;

                if (currentPrice <= trade.stopLoss) {
                    await this.executeLiveSell(
                        trade.symbol,
                        "STOP_LOSS",
                        trade
                    );
                } else if (currentPrice >= trade.takeProfit) {
                    logger.success(`🎯 TP HIT for ${trade.symbol}! Full Exit.`);
                    await this.executeLiveSell(
                        trade.symbol,
                        "TAKE_PROFIT",
                        trade
                    );
                }
            } catch (e) {
                logger.error(`Portfolio Error ${trade.symbol}`, e);
            } finally {
                this.processingLocks.delete(trade.symbol);
            }
        }
    }

    // --- UTILS ---

    // Helper to format quantity based on stepSize
    formatQuantity(qty, stepSize) {
        const step = parseFloat(stepSize);
        if (!step) return qty.toFixed(8);

        // Calculate precision from step size (e.g. 0.001 -> 3 decimals)
        const precision = Math.max(0, Math.log10(1 / step));

        // Floor to the nearest step
        const formatted = Math.floor(qty / step) * step;

        return formatted.toFixed(precision);
    }

    async executeSmartOrder(symbol, side, quantity) {
        try {
            const book = await binanceClient.bookTickers(symbol);
            const price =
                side === "BUY"
                    ? parseFloat(book.bidPrice)
                    : parseFloat(book.askPrice);
            let order;
            try {
                order = await new Promise((resolve, reject) => {
                    const cb = (e, r) => (e ? reject(e) : resolve(r));
                    if (side === "BUY")
                        binanceClient.buy(
                            symbol,
                            quantity,
                            price,
                            { type: "LIMIT" },
                            cb
                        );
                    else
                        binanceClient.sell(
                            symbol,
                            quantity,
                            price,
                            { type: "LIMIT" },
                            cb
                        );
                });
            } catch (e) {
                return await binanceClient[
                    side === "BUY" ? "marketBuy" : "marketSell"
                ](symbol, quantity);
            }
            await new Promise((r) => setTimeout(r, 5000));
            const status = await new Promise((res, rej) =>
                binanceClient.orderStatus(symbol, order.orderId, (e, s) =>
                    e ? rej(e) : res(s)
                )
            );
            if (status.status === "FILLED") return status;
            try {
                await binanceClient.cancel(symbol, order.orderId);
            } catch (e) {}
            return await binanceClient[
                side === "BUY" ? "marketBuy" : "marketSell"
            ](symbol, quantity);
        } catch (e) {
            throw e;
        }
    }

    async getAssetBalance(asset) {
        const info = await this.binanceData.getAccountInfo();
        return info.balances?.find((b) => b.asset === asset)?.free || 0;
    }

    async _parseOrderFills(fills) {
        if (!fills || !fills.length) return { avgPrice: 0 };
        let totalQty = 0,
            totalQuote = 0;
        for (const fill of fills) {
            totalQty += parseFloat(fill.qty);
            totalQuote += parseFloat(fill.price) * parseFloat(fill.qty);
        }
        return { avgPrice: totalQty ? totalQuote / totalQty : 0 };
    }

    getStatus() {
        return { isActive: true, pnl: this.livePortfolioState };
    }

    start() {
        if (this.portfolioUpdateInterval)
            clearInterval(this.portfolioUpdateInterval);
        this.portfolioUpdateInterval = setInterval(() => {
            this.updatePortfolioValue(this.binanceData.getAllPrices());
        }, 2000);
    }
    stop() {
        clearInterval(this.portfolioUpdateInterval);
    }
    updateConfig(c) {
        this.config = { ...this.config, ...c };
    }

    // --- RESET & RECOVERY ---
    async reset() {
        logger.warn("⚠️ ENGINE RESET TRIGGERED.");

        // 1. Unlock everything
        this.processingLocks.clear();

        // 2. Reset Memory State
        this.livePortfolioState = {
            totalPnL: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
            totalTrades: 0,
            winningTrades: 0,
            winRate: 0,
        };

        // 3. Close open trades in DB (Safety Measure)
        // If we reset, we assume we want a clean slate.
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        for (const t of openTrades) {
            await this.tradeRepo.updateTrade(t.id, {
                isOpen: false,
                exitReason: "MANUAL_RESET",
            });
        }

        logger.success("✅ Engine State Wiped.");
    }
}

module.exports = LiveTradingEngine;
