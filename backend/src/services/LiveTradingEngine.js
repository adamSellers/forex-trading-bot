// backend/src/services/LiveTradingEngine.js - FIXED FOR FRONTEND COMPATIBILITY
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

        logger.info("🚀 Live Engine v3.1 (Frontend Compatible) Ready");
    }

    async initialize() {
        // Hydrate PnL & Stats from DB so Dashboard isn't empty on restart
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

        // Reset Daily PnL logic could go here (simplified for now)
    }

    // --- REQUIRED BY TRADING CONTROLLER/FRONTEND ---
    async getPortfolioSummary() {
        const accountInfo = await this.binanceData.getAccountInfo();
        const usdt =
            accountInfo.balances?.find((b) => b.asset === "USDT")?.free || 0;
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        const prices = this.binanceData.getAllPrices();

        // Calculate Unrealized PnL & Positions
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
            // FRONTEND EXPECTS 'performance' OBJECT
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
        } finally {
            this.processingLocks.delete(signal.symbol);
        }
    }

    async executeLiveBuy(signal, currentPrice, atrValue) {
        const accountInfo = await this.binanceData.getAccountInfo();
        const usdt =
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;

        // Position Sizing (Lean Logic)
        const stopLossDist = atrValue * this.config.stopLossATR;
        const riskAmount =
            this.config.maxCapitalAtRisk * this.config.riskPerTrade;
        let quantity = (riskAmount / stopLossDist).toFixed(8);
        const cost = quantity * currentPrice;

        if (cost > usdt * 0.95)
            quantity = ((usdt * 0.95) / currentPrice).toFixed(8);
        if (quantity * currentPrice < 10)
            return { success: false, reason: "Below Min Notional" };

        logger.info(
            `[LIVE] 🛒 Buying ${signal.symbol} Qty:${quantity} @ ${currentPrice}`
        );
        const order = await this.executeSmartOrder(
            signal.symbol,
            "BUY",
            quantity
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
        const sellQty = balance;

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

            // UPDATE STATS FOR FRONTEND
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
            this.processingLocks.add(trade.symbol); // Lock during check

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

    // START/STOP HANDLERS
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
}

module.exports = LiveTradingEngine;
