// backend/src/services/LiveTradingEngine.js - Forex Live Trading Engine
const EventEmitter = require("events");
const logger = require("../utils/logger");
const TradeRepository = require("../repositories/tradeRepository");

class LiveTradingEngine extends EventEmitter {
    constructor(config, dataService, riskService) {
        super();
        this.config = config;
        this.dataService = dataService;
        this.riskService = riskService;
        this.tradeRepo = new TradeRepository();
        this.mode = "live";

        this.portfolio = {
            balanceAud: 0,
            positions: [],
            totalValueAud: 0,
            unrealizedPnLAud: 0,
            realizedPnLAud: 0,
            marginUsedAud: 0,
            marginAvailableAud: 0,
            dailyPnLAud: 0,
            totalSwapAud: 0,
            stats: { winRate: 0, totalTrades: 0, winningTrades: 0 },
        };

        this._signalQueue = [];
        this._processingQueue = false;
        this._closingPositions = new Set();
        this._recoveryQueue = [];
        this._validateConfig();
    }

    _validateConfig() {
        if (this.config.leverage && this.config.leverage > 30) {
            logger.warn("Leverage capped at ASIC limit of 30:1");
            this.config.leverage = 30;
        }
    }

    async initialize() {
        logger.info("Forex Live Trading Engine Connecting...");
        const account = await this.dataService.getAccountInfo();
        if (account.error) throw new Error("Oanda Connection Failed");

        this.portfolio.balanceAud = account.balance;
        this.portfolio.marginUsedAud = account.marginUsed;
        this.portfolio.marginAvailableAud = account.marginAvailable;
        this.portfolio.totalValueAud = account.balance + account.unrealizedPL;
        logger.success(
            "Live Engine Online. Balance: $" +
                this.portfolio.balanceAud.toFixed(2) +
                " AUD"
        );

        try {
            const dbPositions = await this.tradeRepo.getOpenTrades("live");
            this.portfolio.positions = dbPositions.map((p) => ({
                ...p,
                currentPrice: p.entryPrice,
                unrealizedPnLAud: 0,
            }));
            logger.info(
                "Restored " +
                    this.portfolio.positions.length +
                    " positions from DB."
            );
        } catch (err) {
            this.portfolio.positions = [];
        }
        await this.calculatePerformanceStats();
    }

    updateConfig(config) {
        this.config = config;
        this._validateConfig();
    }
    async start() {
        logger.info("Live Trading STARTED");
        this.updatePortfolioValue(this.dataService.getAllPrices());
    }
    async stop() {
        logger.info("Live Trading STOPPED");
    }

    async processSignal(signal, currentPrice, atrPips) {
        this._signalQueue.push({
            signal,
            currentPrice,
            atrPips,
            timestamp: Date.now(),
        });
        if (!this._processingQueue) this._processSignalQueue();
        return { success: true, action: "QUEUED" };
    }

    async _processSignalQueue() {
        this._processingQueue = true;
        while (this._signalQueue.length > 0) {
            const { signal, currentPrice, atrPips } = this._signalQueue.shift();
            try {
                await this._executeSignal(signal, currentPrice, atrPips);
            } catch (err) {
                logger.error("Signal failed:", err.message);
            }
        }
        this._processingQueue = false;
    }

    _calculateCurrentEquity() {
        let unrealizedPnL = 0;
        this.portfolio.positions.forEach((pos) => {
            const priceData = this.dataService.getCurrentPrice(pos.instrument);
            if (priceData) {
                const priceDiff =
                    pos.side === "BUY"
                        ? priceData.price - pos.entryPrice
                        : pos.entryPrice - priceData.price;
                unrealizedPnL += priceDiff * pos.units;
            }
        });
        return this.portfolio.balanceAud + unrealizedPnL;
    }

    _calculateCurrentExposure() {
        const totalEquity = this._calculateCurrentEquity();
        if (totalEquity <= 0) return 0;
        let exposureValue = 0;
        this.portfolio.positions.forEach((pos) => {
            const priceData = this.dataService.getCurrentPrice(pos.instrument);
            if (priceData) exposureValue += pos.units * priceData.price;
        });
        return exposureValue / totalEquity;
    }

    async _executeSignal(signal, currentPrice, atrPips) {
        if (signal.signal !== "BUY" && signal.signal !== "SELL")
            return { success: false, action: "NONE" };
        const instrument = signal.symbol;
        const openPosition = this.portfolio.positions.find(
            (p) => p.instrument === instrument
        );

        if (signal.signal === "BUY") {
            if (openPosition)
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Position already open",
                };
            const maxExposure = this.config.maxPortfolioExposure || 0.95;
            if (this._calculateCurrentExposure() >= maxExposure)
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Exposure cap",
                };

            const totalEquity = this._calculateCurrentEquity();
            const riskPercent = this.config.riskPerTradePercent || 0.01;
            const riskAmountAud = totalEquity * riskPercent;
            const stopLossPips =
                this.config.stopLossType === "ATR"
                    ? atrPips * (this.config.stopLossATRMultiplier || 1.5)
                    : this.config.stopLossPips || 30;
            const pipValue = this.dataService.getPipValue(instrument);
            const stopLossPrice = currentPrice - stopLossPips * pipValue;
            let units = Math.floor(riskAmountAud / (stopLossPips * pipValue));
            const maxLeverage = this.config.leverage || 10;
            units = Math.min(units, (totalEquity * maxLeverage) / currentPrice);
            if (units < 1)
                return {
                    success: false,
                    action: "SKIP",
                    reason: "Trade size too small",
                };

            let order;
            try {
                order = await this.dataService.executeOrder(
                    instrument,
                    "BUY",
                    units,
                    { stopLossPrice }
                );
            } catch (err) {
                logger.error("Buy Execution Failed:", err.message);
                return { success: false, action: "ERROR", reason: err.message };
            }

            const tradeRecord = {
                id: order.orderId.toString(),
                oandaTradeId: order.tradeId,
                instrument,
                side: "BUY",
                units: order.executedQty,
                entryPrice: order.price,
                entryCostAud: units * order.price,
                stopLossPrice,
                atrPips,
                signal: signal.signal,
                signalStrength: signal.strength,
                entryType: signal.entryType,
                entryTime: Date.now(),
                isOpen: true,
                mode: "live",
            };
            await this.tradeRepo.save(tradeRecord).catch(() => {});
            this.portfolio.positions.push(tradeRecord);
            logger.forex.buy(
                instrument,
                tradeRecord.units,
                order.price.toFixed(5),
                stopLossPrice.toFixed(5),
                null
            );
            this.emit("tradeExecuted", tradeRecord);
            return { success: true, action: "BUY", order };
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
        const lockKey = position.instrument + "_" + position.id;
        if (this._closingPositions.has(lockKey))
            return { success: false, action: "SKIP" };
        this._closingPositions.add(lockKey);

        let result;
        try {
            result = position.oandaTradeId
                ? await this.dataService.closeTrade(position.oandaTradeId)
                : await this.dataService.executeOrder(
                      position.instrument,
                      "SELL",
                      position.units
                  );
        } catch (err) {
            this._closingPositions.delete(lockKey);
            return { success: false, action: "ERROR", reason: err.message };
        }

        const exitPrice = result.price || currentPrice;
        const pipValue = this.dataService.getPipValue(position.instrument);
        const priceDiff =
            position.side === "BUY"
                ? exitPrice - position.entryPrice
                : position.entryPrice - exitPrice;
        const pnlPips = priceDiff / pipValue;
        const pnlAud = priceDiff * position.units;

        await this.tradeRepo
            .updateTrade(position.id, {
                isOpen: false,
                exitPrice,
                exitTime: Date.now(),
                pnlAud,
                pnlPips,
                exitReason: reason,
            })
            .catch(() => {});
        this.portfolio.positions = this.portfolio.positions.filter(
            (p) => p.id !== position.id
        );
        this.portfolio.balanceAud += position.units * exitPrice;
        this.portfolio.dailyPnLAud += pnlAud;
        this.portfolio.realizedPnLAud += pnlAud;
        this.portfolio.stats.totalTrades++;
        if (pnlAud > 0) this.portfolio.stats.winningTrades++;
        this.portfolio.stats.winRate =
            (this.portfolio.stats.winningTrades /
                this.portfolio.stats.totalTrades) *
            100;

        logger.forex.sell(
            position.instrument,
            position.units,
            exitPrice.toFixed(5),
            pnlAud
        );
        this.emit("tradeExecuted", {
            ...position,
            side: "SELL",
            status: "CLOSED",
            pnlAud,
            pnlPips,
            exitPrice,
        });
        this._closingPositions.delete(lockKey);
        return { success: true, action: "SELL", pnlAud, pnlPips };
    }

    updatePortfolioValue(allPrices) {
        if (!allPrices) return;
        let totalUnrealizedPnL = 0;
        this.portfolio.positions.forEach((pos) => {
            const priceData = allPrices[pos.instrument];
            if (!priceData) return;
            const pipValue = this.dataService.getPipValue(pos.instrument);
            const priceDiff =
                pos.side === "BUY"
                    ? priceData.price - pos.entryPrice
                    : pos.entryPrice - priceData.price;
            pos.currentPrice = priceData.price;
            pos.unrealizedPnLPips = priceDiff / pipValue;
            pos.unrealizedPnLAud = priceDiff * pos.units;
            totalUnrealizedPnL += pos.unrealizedPnLAud;
            this.checkExitConditions(pos, priceData.price);
        });
        this.portfolio.unrealizedPnLAud = totalUnrealizedPnL;
        this.portfolio.totalValueAud =
            this.portfolio.balanceAud + totalUnrealizedPnL;
        this.emit("portfolioUpdated", this.getPortfolioSummary());
    }

    checkExitConditions(position, currentPrice) {
        if (this._closingPositions.has(position.instrument + "_" + position.id))
            return;
        if (position.stopLossPrice && currentPrice <= position.stopLossPrice) {
            logger.info("STOP LOSS: " + position.instrument);
            this.closePosition(position, currentPrice, "STOP_LOSS");
        }
    }

    async calculatePerformanceStats() {
        try {
            const allTrades = await this.tradeRepo.getAllTrades("live");
            const closedTrades = allTrades.filter(
                (t) => t.pnlAud !== null && !t.isOpen
            );
            this.portfolio.stats.totalTrades = closedTrades.length;
            this.portfolio.stats.winningTrades = closedTrades.filter(
                (t) => t.pnlAud > 0
            ).length;
            this.portfolio.stats.winRate =
                this.portfolio.stats.totalTrades > 0
                    ? (this.portfolio.stats.winningTrades /
                          this.portfolio.stats.totalTrades) *
                      100
                    : 0;
            this.portfolio.realizedPnLAud = closedTrades.reduce(
                (acc, t) => acc + (t.pnlAud || 0),
                0
            );
        } catch (e) {}
    }

    getPortfolioSummary() {
        return {
            ...this.portfolio,
            exposure: this._calculateCurrentExposure(),
            exposurePercent:
                (this._calculateCurrentExposure() * 100).toFixed(1) + "%",
            timestamp: Date.now(),
        };
    }

    getStatus() {
        return {
            mode: "live",
            isActive: true,
            positions: this.portfolio.positions.length,
            exposure: (this._calculateCurrentExposure() * 100).toFixed(1) + "%",
        };
    }
}

module.exports = LiveTradingEngine;
