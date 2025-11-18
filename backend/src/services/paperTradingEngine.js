// backend/src/services/paperTradingEngine.js
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const TradeRepository = require("../repositories/tradeRepository");

const STATE_FILE_PATH = path.join(
    __dirname,
    "../../data/paper_portfolio_state.json"
);

class PaperTradingEngine extends EventEmitter {
    constructor(config = {}, riskManagementService) {
        super();

        this.config = {
            maxCapitalAtRisk: config.maxCapitalAtRisk || 5000,
            riskPerTrade: config.riskPerTrade || 0.01,
            maxDailyLoss: config.maxDailyLoss || 0.02,
            maxWeeklyLoss: config.maxWeeklyLoss || 0.05,
            allocation: config.allocation || {
                BTCUSDT: 0.3,
                ETHUSDT: 0.3,
                BNBUSDT: 0.15,
                DOGEUSDT: 0.1,
                TRUMPUSDT: 0.15,
            },
            minOrderSize: config.minOrderSize || 10,
            stopLossATR: config.stopLossATR || 1.5,
            takeProfitATRMultiplier: config.takeProfitATRMultiplier || 2.5,
            enableTrailingStops: config.enableTrailingStops !== false,
            trailingStopPercent: config.trailingStopPercent || 0.05,
            minSignalStrength: config.minSignalStrength || 0.5,
            ...config,
        };

        this.riskService = riskManagementService;
        this.tradeRepo = new TradeRepository();

        // Initial State
        this.portfolio = {
            usdtBalance: this.config.maxCapitalAtRisk,
            totalValue: this.config.maxCapitalAtRisk,
            positions: new Map(),
            dailyPnL: 0,
            weeklyPnL: 0,
            totalPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };

        this.tradeHistory = [];
        this.performanceMetrics = this.getInitialMetrics();
        this.isActive = false;
        this.lastStateSave = 0;
        this.mode = "paper";

        logger.info(
            `🚀 Paper Trading Engine Initialized - $${this.config.maxCapitalAtRisk} USDT`
        );
    }

    getInitialMetrics() {
        return {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            avgWin: 0,
            avgLoss: 0,
            profitFactor: 0,
            signalPerformance: {
                BUY_STRONG: { trades: 0, wins: 0, totalPnL: 0 }, // ADX > 50
                BUY_MEDIUM: { trades: 0, wins: 0, totalPnL: 0 }, // ADX 25-50
                BUY_WEAK: { trades: 0, wins: 0, totalPnL: 0 }, // ADX < 25
            },
            assetPerformance: {},
            exitReasonStats: {},
        };
    }

    async initialize() {
        await this.loadStateFromFile();
        await this.loadTradeHistory();
        this.recalculateMetrics();
        logger.success("✅ Paper Trading Engine Ready.");
    }

    // --- SIGNAL PROCESSING ---

    async processSignal(signal, currentPrice, atrValue) {
        if (!this.isActive || !this.config.enableTrading)
            return { success: false, reason: "Trading Disabled" };
        if (this.riskService.isHalted())
            return {
                success: false,
                reason: `Halted: ${this.riskService.getHaltReason()}`,
            };

        this.checkAndResetCounters();

        // 1. Confluence Check (Respect the Generator!)
        if (signal.signal === "HOLD" || signal.signal === "COOLDOWN") {
            return {
                success: true,
                action: "HOLD",
                reason: signal.message || "Signal Generator says HOLD",
            };
        }

        const position = this.portfolio.positions.get(signal.symbol);
        const isBullish = signal.signal.includes("BUY");
        const isBearish = signal.signal.includes("SELL");

        if (isBullish && !position) {
            return await this.executeBuy(signal, currentPrice, atrValue);
        } else if (isBearish && position) {
            return await this.executeSell(
                signal,
                currentPrice,
                position,
                "SIGNAL_SELL"
            );
        }

        return {
            success: true,
            action: "HOLD",
            reason: "No actionable signal",
        };
    }

    // --- EXECUTION LOGIC ---

    async executeBuy(signal, currentPrice, atrValue) {
        // 1. Calculate Size (Same logic as Live)
        const alloc = this.config.allocation[signal.symbol] || 0.1;
        const maxAlloc = this.config.maxCapitalAtRisk * alloc;
        const riskAmt = this.config.maxCapitalAtRisk * this.config.riskPerTrade;

        // Stop Loss Calculation
        const stopLoss = atrValue
            ? currentPrice - atrValue * this.config.stopLossATR
            : currentPrice * 0.98;
        const riskPerUnit = currentPrice - stopLoss;

        if (riskPerUnit <= 0) return { error: "Invalid Stop Loss" };

        let usdtCost = Math.min(
            (riskAmt / riskPerUnit) * currentPrice,
            maxAlloc,
            this.portfolio.usdtBalance * 0.95
        );

        // Min Order Size Check
        if (usdtCost < this.config.minOrderSize)
            return { error: "Below Min Order Size" };

        // 2. Execute (Simulated)
        const quantity = parseFloat((usdtCost / currentPrice).toFixed(8));

        // Recalculate exact cost based on precision
        usdtCost = quantity * currentPrice;

        if (usdtCost > this.portfolio.usdtBalance)
            return { error: "Insufficient Funds" };

        // Take Profit
        let takeProfit = null;
        if (atrValue && this.config.enableTrailingStops) {
            takeProfit =
                currentPrice + atrValue * this.config.takeProfitATRMultiplier;
        }

        const trade = {
            id: `paper_${Date.now()}`,
            symbol: signal.symbol,
            side: "BUY",
            quantity,
            price: currentPrice,
            usdtCost,
            timestamp: Date.now(),
            signal: signal.signal,
            signalStrength: signal.strength, // ADX
            mode: "paper",
            stopLoss,
            takeProfit,
            trailingStopPrice: this.config.enableTrailingStops
                ? stopLoss
                : null,
            highestPrice: currentPrice,
            trailingStopPercent: this.config.trailingStopPercent,
        };

        // Update State
        this.portfolio.usdtBalance -= usdtCost;
        this.portfolio.positions.set(signal.symbol, {
            ...trade,
            entryCost: usdtCost,
            entryPrice: currentPrice,
            currentValue: usdtCost,
            unrealizedPnL: 0,
        });

        this.tradeHistory.push(trade);
        await this.tradeRepo.save(trade);
        this.saveStateToFile();
        this.emit("tradeExecuted", trade);

        logger.info(
            `[PAPER] BUY ${
                signal.symbol
            } @ $${currentPrice} (ADX: ${signal.strength.toFixed(1)})`
        );
        return { success: true, action: "BUY", trade };
    }

    async executeSell(signal, currentPrice, position, exitReason) {
        const { quantity, entryCost } = position;

        // Simulate 0.1% Fee (Standard Binance Taker)
        const grossReceive = quantity * currentPrice;
        const fee = grossReceive * 0.001;
        const netReceive = grossReceive - fee;

        const pnl = netReceive - entryCost;
        const pnlPercent = (pnl / entryCost) * 100;

        // Update Portfolio
        this.portfolio.usdtBalance += netReceive;
        this.portfolio.totalPnL += pnl;
        this.portfolio.dailyPnL += pnl;
        this.portfolio.weeklyPnL += pnl;
        this.portfolio.positions.delete(signal.symbol);

        const trade = {
            id: `paper_sell_${Date.now()}`,
            symbol: signal.symbol,
            side: "SELL",
            quantity,
            price: currentPrice,
            usdtReceived: netReceive,
            pnl,
            pnlPercent,
            timestamp: Date.now(),
            signal: signal.signal,
            exitReason,
            entryPrice: position.entryPrice,
            mode: "paper",
        };

        this.tradeHistory.push(trade);
        await this.tradeRepo.save(trade);
        this.updateMetrics(trade);
        this.saveStateToFile();
        this.emit("tradeExecuted", trade);

        logger.info(
            `[PAPER] SELL ${
                signal.symbol
            } @ $${currentPrice} (${exitReason}) PnL: $${pnl.toFixed(2)}`
        );
        return { success: true, action: "SELL", trade };
    }

    // --- STATE MANAGEMENT ---

    updatePortfolioValue(priceData) {
        this.checkAndResetCounters();
        const positionsToClose = [];
        let totalCryptoVal = 0;

        this.portfolio.positions.forEach((pos, symbol) => {
            const price = priceData[symbol]?.price;
            if (!price) return;

            // Value Update
            pos.currentPrice = price;
            pos.currentValue = pos.quantity * price;
            pos.unrealizedPnL = pos.currentValue - pos.entryCost;
            totalCryptoVal += pos.currentValue;

            // Trailing Stop Update
            if (this.config.enableTrailingStops && pos.trailingStopPrice) {
                if (price > pos.highestPrice) {
                    pos.highestPrice = price;
                    const newStop = price * (1 - pos.trailingStopPercent);
                    if (newStop > pos.trailingStopPrice)
                        pos.trailingStopPrice = newStop;
                }
            }

            // Exit Checks
            let exitReason = null;
            if (pos.takeProfit && price >= pos.takeProfit)
                exitReason = "TAKE_PROFIT";
            else if (pos.trailingStopPrice && price <= pos.trailingStopPrice)
                exitReason = "TRAILING_STOP";
            else if (price <= pos.stopLoss) exitReason = "STOP_LOSS";

            if (exitReason)
                positionsToClose.push({ symbol, price, pos, exitReason });
        });

        this.portfolio.totalValue = this.portfolio.usdtBalance + totalCryptoVal;

        // Batch Exits
        positionsToClose.forEach(async (p) => {
            await this.executeSell(
                { symbol: p.symbol, signal: "EXIT", strength: 0 },
                p.price,
                p.pos,
                p.exitReason
            );
        });

        this.emit("portfolioUpdated", this.getPortfolioSummary());
        this.riskService.checkRiskLimits(this.getPortfolioSummary());
    }

    // --- METRICS ---

    updateMetrics(trade) {
        if (trade.side !== "SELL") return;
        const m = this.performanceMetrics;

        m.totalTrades++;
        trade.pnl > 0 ? m.winningTrades++ : m.losingTrades++;

        // Averages
        if (trade.pnl > 0)
            m.avgWin =
                (m.avgWin * (m.winningTrades - 1) + trade.pnl) /
                m.winningTrades;
        else
            m.avgLoss =
                (m.avgLoss * (m.losingTrades - 1) + Math.abs(trade.pnl)) /
                m.losingTrades;

        // ADX Categorization (New Logic)
        // ADX: <25 Weak, 25-50 Medium, >50 Strong
        const adx = trade.entrySignalStrength || 0; // Retrieved from DB/Trade obj
        let cat = "BUY_MEDIUM";
        if (adx > 50) cat = "BUY_STRONG";
        else if (adx < 25) cat = "BUY_WEAK";

        const catStats = m.signalPerformance[cat];
        if (catStats) {
            catStats.trades++;
            if (trade.pnl > 0) catStats.wins++;
            catStats.totalPnL += trade.pnl;
        }

        // Win Rate / Profit Factor
        m.winRate = (m.winningTrades / m.totalTrades) * 100;
        const grossWin = m.avgWin * m.winningTrades;
        const grossLoss = m.avgLoss * m.losingTrades;
        m.profitFactor = grossLoss > 0 ? grossWin / grossLoss : 0;
    }

    recalculateMetrics() {
        this.performanceMetrics = this.getInitialMetrics();
        const sells = this.tradeHistory.filter((t) => t.side === "SELL");
        sells.forEach((t) => this.updateMetrics(t));
    }

    // --- UTILS ---

    checkAndResetCounters() {
        const today = new Date().toDateString();
        const week = this.getWeekStart(new Date());
        if (this.portfolio.lastResetDate !== today) {
            this.portfolio.lastResetDate = today;
            this.portfolio.dailyPnL = 0;
            this.riskService.resetDailyLimit(today);
        }
        if (this.portfolio.lastWeeklyReset !== week) {
            this.portfolio.lastWeeklyReset = week;
            this.portfolio.weeklyPnL = 0;
            this.riskService.resetWeeklyLimit(week);
        }
    }

    getWeekStart(d) {
        d = new Date(d);
        const day = d.getDay(),
            diff = d.getDate() - day;
        return new Date(d.setDate(diff)).toDateString();
    }

    getPortfolioSummary() {
        return {
            mode: "paper",
            totalValue: this.portfolio.totalValue,
            usdtBalance: this.portfolio.usdtBalance,
            positions: Array.from(this.portfolio.positions.values()), // For UI
            totalPnL: this.portfolio.totalPnL,
            performance: this.performanceMetrics,
            dailyPnL: this.portfolio.dailyPnL,
        };
    }

    getStatus() {
        return {
            isActive: this.isActive,
            risk: this.riskService.getRiskStatus(),
        };
    }
    start() {
        this.isActive = true;
        this.config.enableTrading = true;
        this.emit("engineStarted");
    }
    stop() {
        this.isActive = false;
        this.config.enableTrading = false;
        this.saveStateToFile();
        this.emit("engineStopped");
    }

    // Persistence
    saveStateToFile() {
        try {
            const data = {
                portfolio: {
                    ...this.portfolio,
                    positions: Array.from(this.portfolio.positions.entries()),
                },
            };
            fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(data));
        } catch (e) {
            logger.error("Save State Failed", e);
        }
    }

    async loadStateFromFile() {
        if (fs.existsSync(STATE_FILE_PATH)) {
            try {
                const data = JSON.parse(fs.readFileSync(STATE_FILE_PATH));
                this.portfolio = {
                    ...data.portfolio,
                    positions: new Map(data.portfolio.positions),
                };
            } catch (e) {
                logger.error("Load State Failed", e);
            }
        }
    }

    async loadTradeHistory() {
        this.tradeHistory = (await this.tradeRepo.getAllTrades("paper")) || [];
    }
}

module.exports = PaperTradingEngine;
