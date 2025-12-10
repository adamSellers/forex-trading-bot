// backend/src/services/LiveTradingEngine.js
const EventEmitter = require("events");
const logger = require("../utils/logger");
const TradeRepository = require("../repositories/tradeRepository");
const PortfolioRepository = require("../repositories/portfolioRepository");
const binanceClient = require("./binanceClient");

class LiveTradingEngine extends EventEmitter {
    constructor(config = {}, binanceDataService, riskManagementService) {
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
            enableVolatilityFilter: config.enableVolatilityFilter !== false,
            minVolatilityPercent: config.minVolatilityPercent || 2.0,
            ...config,
        };
        this.binanceData = binanceDataService;
        this.riskService = riskManagementService;
        this.tradeRepo = new TradeRepository();
        this.portfolioRepo = new PortfolioRepository();

        // PnL State
        this.livePortfolioState = {
            totalPnL: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };

        this.portfolioEmitThrottle = 2000;
        this.portfolioUpdateInterval = null;
        this.isActive = false;
        this.mode = "live";
        this.lastSnapshotSave = 0;
        this.tradeHistory = [];

        // Performance Metrics Initialization
        this.performanceMetrics = this.getInitialMetrics();
        this.config.assets.forEach((asset) => {
            this.performanceMetrics.assetPerformance[asset] = {
                trades: 0,
                wins: 0,
                totalPnL: 0,
                winRate: 0,
                avgPnL: 0,
            };
        });

        logger.info("🚀 Live Trading Engine Initialized - REAL MONEY MODE.");
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
                BUY_STRONG: { trades: 0, wins: 0, totalPnL: 0 },
                BUY_MEDIUM: { trades: 0, wins: 0, totalPnL: 0 },
                BUY_WEAK: { trades: 0, wins: 0, totalPnL: 0 },
            },
            holdingPeriodStats: { avgHoldingTime: 0, holdingTimes: [] },
            exitReasonStats: {
                TAKE_PROFIT: { count: 0, totalPnL: 0 },
                TRAILING_STOP: { count: 0, totalPnL: 0 },
                STOP_LOSS: { count: 0, totalPnL: 0 },
                SIGNAL_SELL: { count: 0, totalPnL: 0 },
            },
            assetPerformance: {},
            volatilityStats: { tradesBlocked: 0, avgVolatilityOnEntry: 0 },
        };
    }

    async initialize() {
        logger.info("🔄 Initializing Live Trading Engine...");
        const allLiveTrades = await this.tradeRepo.getAllTrades("live");
        const sellTrades = allLiveTrades.filter((t) => t.side === "SELL");
        this.tradeHistory = allLiveTrades;

        // Restore PnL State from Database History
        this.livePortfolioState.totalPnL = sellTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );

        const todayString = new Date().toDateString();
        const weekStart = new Date(this.getWeekStart(new Date()));

        this.livePortfolioState.dailyPnL = sellTrades
            .filter((t) => new Date(t.timestamp).toDateString() === todayString)
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        this.livePortfolioState.weeklyPnL = sellTrades
            .filter((t) => new Date(t.timestamp) >= weekStart)
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        this.recalculateLivePerformanceMetrics();
        logger.success("✅ Live Trading Engine ready.");
    }

    // ============================================================
    // 🧠 SMART EXECUTION (Limit -> Wait -> Market)
    // ============================================================

    async executeSmartOrder(symbol, side, quantity, quoteOrderQty = null) {
        try {
            // 1. Get Current Order Book Price
            const book = await binanceClient.bookTickers(symbol);
            if (!book) throw new Error("Failed to fetch order book");

            const price =
                side === "BUY"
                    ? parseFloat(book.bidPrice)
                    : parseFloat(book.askPrice);

            // Calculate specific quantity if only USDT amount (quoteOrderQty) was provided
            let limitQty = quantity;
            if (side === "BUY" && quoteOrderQty && !quantity) {
                limitQty = (quoteOrderQty / price).toFixed(8);
            }

            logger.info(
                `[LIVE] ⏳ SmartExec: Placing LIMIT ${side} ${symbol} @ ${price}`
            );

            // 2. Place Limit Order
            let orderResult;
            try {
                orderResult = await new Promise((resolve, reject) => {
                    const cb = (error, response) =>
                        error ? reject(error) : resolve(response);
                    if (side === "BUY") {
                        binanceClient.buy(
                            symbol,
                            limitQty,
                            price,
                            { type: "LIMIT" },
                            cb
                        );
                    } else {
                        binanceClient.sell(
                            symbol,
                            limitQty,
                            price,
                            { type: "LIMIT" },
                            cb
                        );
                    }
                });
            } catch (err) {
                logger.warn(
                    `[LIVE] Limit failed (${err.message}). Executing Market Fallback.`
                );
                return await this.executeMarketOrderFallback(
                    symbol,
                    side,
                    quantity,
                    quoteOrderQty
                );
            }

            const orderId = orderResult.orderId;

            // 3. Wait 10 Seconds for Fill
            await new Promise((r) => setTimeout(r, 10000));

            // 4. Check Status
            const checkStatus = () =>
                new Promise((resolve, reject) => {
                    binanceClient.orderStatus(
                        symbol,
                        orderId,
                        (error, orderStatus) =>
                            error ? reject(error) : resolve(orderStatus)
                    );
                });

            const updatedOrder = await checkStatus();

            if (updatedOrder.status === "FILLED") {
                logger.success(`[LIVE] ✅ LIMIT Order FILLED!`);
                return updatedOrder;
            }

            // 5. Cancel and Market Fallback
            logger.info(`[LIVE] ⏱️ Limit timed out. Cancelling...`);
            try {
                await binanceClient.cancel(symbol, orderId);
            } catch (e) {
                // If cancel fails, check if it filled in the split second before cancel
                const finalCheck = await checkStatus();
                if (finalCheck.status === "FILLED") return finalCheck;
                // Otherwise throw original cancel error
                throw e;
            }

            // Check for Partial Fills (Simplification: Treat partials as "Done" to avoid logic loops)
            if (parseFloat(updatedOrder.executedQty) > 0) {
                logger.warn(
                    `[LIVE] Partial fill detected. Treating as complete.`
                );
                return updatedOrder;
            }

            return await this.executeMarketOrderFallback(
                symbol,
                side,
                quantity,
                quoteOrderQty
            );
        } catch (error) {
            logger.error(`[LIVE] SmartExec Failed:`, error);
            throw error;
        }
    }

    async executeMarketOrderFallback(symbol, side, quantity, quoteOrderQty) {
        logger.info(`[LIVE] 🚀 Executing MARKET ${side} Fallback...`);
        if (side === "BUY") {
            if (quoteOrderQty) {
                return await binanceClient.marketBuy(symbol, null, {
                    quoteOrderQty,
                });
            }
            return await binanceClient.marketBuy(symbol, quantity);
        }
        return await binanceClient.marketSell(symbol, quantity);
    }

    // ============================================================
    // 🚦 CORE SIGNAL PROCESSING
    // ============================================================

    async processSignal(signal, currentPrice, atrValue) {
        this.checkAndResetCounters();

        // 1. Filter Invalid Signals
        if (signal.signal === "HOLD" || signal.signal === "COOLDOWN") {
            return { success: true, action: "HOLD", reason: signal.message };
        }
        if (!this.isValidSignal(signal)) {
            return { success: false, reason: "Signal Invalid" };
        }
        if (!this.isActive || !this.config.enableTrading) {
            return { success: false, reason: "Trading Disabled" };
        }
        if (this.riskService.isHalted()) {
            return { success: false, reason: "Risk Halt" };
        }

        // 2. Fetch Account Data
        const accountInfo = await this.binanceData.getAccountInfo();
        if (accountInfo.error) {
            return { success: false, reason: "Account Info Error" };
        }

        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        const openTrade = openTrades.find((t) => t.symbol === signal.symbol);

        // 3. Decision Logic
        if (signal.signal.includes("BUY") && !openTrade) {
            return this.executeLiveBuy(
                signal,
                currentPrice,
                atrValue,
                accountInfo
            );
        } else if (signal.signal.includes("SELL") && openTrade) {
            const baseAsset = signal.symbol.replace("USDT", "");
            const bal = accountInfo.balances.find(
                (b) => b.asset === baseAsset && parseFloat(b.free) > 0
            );

            if (bal) {
                return this.executeLiveSell(
                    signal,
                    currentPrice,
                    bal,
                    openTrade,
                    "SIGNAL_SELL"
                );
            } else {
                // Auto-fix Ghost Trades: DB says open, Wallet says 0
                await this.tradeRepo.updateTrade(openTrade.id, {
                    isOpen: false,
                    exitReason: "GHOST_FIX",
                });
                return {
                    success: false,
                    reason: "Ghost Trade Fixed (0 Balance)",
                };
            }
        }
        return { success: true, action: "HOLD" };
    }

    // ============================================================
    // 🛡️ ATOMIC EXECUTION (Prevents Ghost Trades)
    // ============================================================

    /**
     * Helper to get precise wallet balance for verification
     */
    async getAssetBalance(symbol) {
        const base = symbol.replace("USDT", "");
        const info = await this.binanceData.getAccountInfo();
        const bal = info.balances?.find((b) => b.asset === base);
        return bal ? parseFloat(bal.free) : 0;
    }

    async executeLiveBuy(signal, currentPrice, atrValue, accountInfo) {
        // Calculate Sizing
        const usdt =
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;
        const details = this.calculateLivePositionDetails(
            signal.symbol,
            currentPrice,
            atrValue,
            usdt
        );
        if (details.error) return { success: false, reason: details.error };

        // 1. Snapshot Balance BEFORE
        const preBalance = await this.getAssetBalance(signal.symbol);

        try {
            // 2. Execute
            const orderResult = await this.executeSmartOrder(
                signal.symbol,
                "BUY",
                null,
                details.usdtCost
            );

            // 3. Verify Status
            if (!orderResult || orderResult.status !== "FILLED") {
                throw new Error(
                    `Order Status: ${orderResult?.status || "Unknown"}`
                );
            }

            // 4. Snapshot Balance AFTER
            const postBalance = await this.getAssetBalance(signal.symbol);
            const delta = postBalance - preBalance;

            // 5. CRITICAL: Ghost Trade Prevention
            // If we didn't gain at least 10% of expected quantity, it's a Ghost Trade.
            const expectedMin = parseFloat(orderResult.executedQty) * 0.1;
            if (delta < expectedMin) {
                logger.error(
                    `[LIVE] 👻 GHOST TRADE BLOCKED! Binance said FILLED, but balance didn't change. Pre: ${preBalance}, Post: ${postBalance}`
                );
                return {
                    success: false,
                    reason: "Ghost Trade Detected - Balance Unchanged",
                };
            }

            // 6. Save Valid Trade
            const { totalFeeUsdt, avgPrice } = await this._parseOrderFills(
                orderResult.fills
            );
            const trade = {
                id: orderResult.orderId.toString(),
                symbol: signal.symbol,
                side: "BUY",
                quantity: parseFloat(orderResult.executedQty),
                price: avgPrice,
                usdtCost: parseFloat(orderResult.cummulativeQuoteQty),
                feeUsdtValue: totalFeeUsdt,
                timestamp: orderResult.transactTime,
                signal: signal.signal,
                signalStrength: signal.strength,
                mode: "live",
                atr: atrValue,
                isOpen: true,
                entryCost:
                    parseFloat(orderResult.cummulativeQuoteQty) + totalFeeUsdt,
                entryPrice: avgPrice,
                stopLoss: details.stopLoss,
                takeProfitPrice: details.takeProfit,
                trailingStopPrice: this.config.enableTrailingStops
                    ? details.stopLoss
                    : null,
                highestPrice: avgPrice,
                trailingStopPercent: this.config.trailingStopPercent,
            };

            await this.tradeRepo.save(trade);
            this.emit("tradeExecuted", trade);
            return { success: true, action: "BUY", trade };
        } catch (error) {
            logger.error(`[LIVE] Buy Failed:`, error);
            return { success: false, reason: error.message };
        }
    }

    async executeLiveSell(
        signal,
        currentPrice,
        position,
        entryTrade,
        exitReason
    ) {
        const stepSize =
            this.binanceData.symbolInfo.get(signal.symbol)?.stepSize ||
            0.000001;
        const quantityToSell = this.formatQuantity(position.free, stepSize);

        // 1. Snapshot Balance BEFORE
        const preBalance = await this.getAssetBalance(signal.symbol);

        try {
            // 2. Execute
            const orderResult = await this.executeSmartOrder(
                signal.symbol,
                "SELL",
                quantityToSell,
                null
            );

            if (!orderResult || orderResult.status !== "FILLED") {
                throw new Error(
                    `Order Status: ${orderResult?.status || "Unknown"}`
                );
            }

            // 3. Snapshot Balance AFTER
            const postBalance = await this.getAssetBalance(signal.symbol);

            // 4. Verify Sale (Balance should decrease)
            if (postBalance >= preBalance) {
                logger.error(
                    `[LIVE] 👻 GHOST SELL BLOCKED! Balance did not decrease.`
                );
                return { success: false, reason: "Ghost Sell Detected" };
            }

            // 5. Save Valid Trade
            const { totalFeeUsdt, avgPrice } = await this._parseOrderFills(
                orderResult.fills
            );
            const entryCost = entryTrade.entryCost || entryTrade.usdtCost;
            const pnl =
                parseFloat(orderResult.cummulativeQuoteQty) -
                entryCost -
                totalFeeUsdt;

            this.livePortfolioState.totalPnL += pnl;
            this.livePortfolioState.dailyPnL += pnl;
            this.livePortfolioState.weeklyPnL += pnl;

            const trade = {
                id: orderResult.orderId.toString(),
                symbol: signal.symbol,
                side: "SELL",
                quantity: parseFloat(orderResult.executedQty),
                price: avgPrice,
                usdtReceived: parseFloat(orderResult.cummulativeQuoteQty),
                feeUsdtValue: totalFeeUsdt,
                pnl,
                pnlPercent: (pnl / entryCost) * 100,
                holdingPeriod:
                    orderResult.transactTime -
                    new Date(entryTrade.timestamp).getTime(),
                entryCost,
                exitReason,
                signal: signal.signal,
                mode: "live",
                timestamp: orderResult.transactTime,
            };

            await this.tradeRepo.save(trade);
            await this.tradeRepo.updateTrade(entryTrade.id, { isOpen: false });
            this.emit("tradeExecuted", trade);
            this.updateLivePerformanceMetrics(trade);

            return { success: true, action: "SELL", trade };
        } catch (error) {
            logger.error(`[LIVE] Sell Failed:`, error);
            return { success: false, reason: error.message };
        }
    }

    // ============================================================
    // 🛠️ HELPERS & UTILITIES
    // ============================================================

    async _parseOrderFills(fills) {
        if (!fills || !fills.length) return { totalFeeUsdt: 0, avgPrice: 0 };
        let totalFeeUsdt = 0,
            totalQty = 0,
            totalQuote = 0;
        for (const fill of fills) {
            const p = parseFloat(fill.price),
                q = parseFloat(fill.qty),
                comm = parseFloat(fill.commission);
            totalQty += q;
            totalQuote += p * q;
            if (fill.commissionAsset === "USDT") totalFeeUsdt += comm;
            else if (fill.commissionAsset === "BNB") {
                const bnbData = this.binanceData.getCurrentPrice("BNBUSDT");
                totalFeeUsdt += comm * (bnbData ? bnbData.price : 250);
            } else totalFeeUsdt += comm * p;
        }
        return { totalFeeUsdt, avgPrice: totalQty ? totalQuote / totalQty : 0 };
    }

    calculateLivePositionDetails(symbol, currentPrice, atrValue, usdtBalance) {
        const alloc = this.config.allocation[symbol] || 0.1;
        const maxAlloc = this.config.maxCapitalAtRisk * alloc;
        const riskAmt = this.config.maxCapitalAtRisk * this.config.riskPerTrade;
        const stopLoss = atrValue
            ? currentPrice - atrValue * this.config.stopLossATR
            : currentPrice * 0.98;

        if (currentPrice - stopLoss <= 0) return { error: "Invalid Stop Loss" };

        let finalUSDT = Math.min(
            (riskAmt / (currentPrice - stopLoss)) * currentPrice,
            maxAlloc,
            usdtBalance * 0.95
        );
        const minNotional =
            this.binanceData.symbolInfo.get(symbol)?.minNotional || 10;

        if (finalUSDT < minNotional)
            return { error: `Below Min Notional ${minNotional}` };

        let takeProfit = null;
        if (atrValue && this.config.enableTrailingStops) {
            takeProfit =
                currentPrice + atrValue * this.config.takeProfitATRMultiplier;
        }

        return {
            quantity: parseFloat((finalUSDT / currentPrice).toFixed(8)),
            usdtCost: parseFloat(finalUSDT.toFixed(2)),
            stopLoss: parseFloat(stopLoss.toFixed(8)),
            takeProfit: takeProfit ? parseFloat(takeProfit.toFixed(8)) : null,
        };
    }

    formatQuantity(q, step) {
        if (!step) return q;
        const precision = Math.max(
            0,
            (step.toString().split(".")[1] || "").length
        );
        return parseFloat((Math.floor(q / step) * step).toFixed(precision));
    }

    isValidSignal(signal) {
        if (
            !signal ||
            !signal.signal ||
            ["ERROR", "COOLDOWN", "WEAK_SIGNAL", "LOW_VOLATILITY"].includes(
                signal.signal
            )
        )
            return false;
        if (signal.strength < this.config.minSignalStrength) return false;
        return true;
    }

    updateLivePerformanceMetrics(trade) {
        if (trade.side !== "SELL") return;
        this.performanceMetrics.totalTrades++;
        trade.pnl > 0
            ? this.performanceMetrics.winningTrades++
            : this.performanceMetrics.losingTrades++;
        const m = this.performanceMetrics;
        if (trade.pnl > 0)
            m.avgWin =
                (m.avgWin * (m.winningTrades - 1) + trade.pnl) /
                m.winningTrades;
        else
            m.avgLoss =
                (m.avgLoss * (m.losingTrades - 1) + Math.abs(trade.pnl)) /
                m.losingTrades;
        m.winRate = (m.winningTrades / m.totalTrades) * 100;
        m.profitFactor =
            m.avgLoss * m.losingTrades > 0
                ? (m.avgWin * m.winningTrades) / (m.avgLoss * m.losingTrades)
                : 0;
    }

    recalculateLivePerformanceMetrics() {
        this.performanceMetrics = this.getInitialMetrics();
        this.tradeHistory
            .filter((t) => t.side === "SELL")
            .forEach((t) => this.updateLivePerformanceMetrics(t));
    }

    checkAndResetCounters() {
        const today = new Date().toDateString();
        const week = this.getWeekStart(new Date());
        if (this.livePortfolioState.lastResetDate !== today) {
            this.livePortfolioState.lastResetDate = today;
            this.livePortfolioState.dailyPnL = 0;
            this.riskService.resetDailyLimit(today);
        }
        if (this.livePortfolioState.lastWeeklyReset !== week) {
            this.livePortfolioState.lastWeeklyReset = week;
            this.livePortfolioState.weeklyPnL = 0;
            this.riskService.resetWeeklyLimit(week);
        }
    }

    getWeekStart(d) {
        d = new Date(d);
        const diff = d.getDate() - d.getDay();
        return new Date(d.setDate(diff)).toDateString();
    }

    // ============================================================
    // 📊 PORTFOLIO MANAGEMENT
    // ============================================================

    async updatePortfolioValue(priceData) {
        this.checkAndResetCounters();
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        if (!openTrades.length) return;

        const positionsToClose = [];
        for (const trade of openTrades) {
            const currentPrice = priceData[trade.symbol]?.price;
            if (!currentPrice) continue;

            let exitReason = null;
            if (trade.takeProfitPrice && currentPrice >= trade.takeProfitPrice)
                exitReason = "TAKE_PROFIT";
            else if (
                this.config.enableTrailingStops &&
                trade.trailingStopPrice &&
                currentPrice <= trade.trailingStopPrice
            )
                exitReason = "TRAILING_STOP";
            else if (trade.stopLoss && currentPrice <= trade.stopLoss)
                exitReason = "STOP_LOSS";

            if (exitReason)
                positionsToClose.push({ trade, currentPrice, exitReason });
            else if (
                this.config.enableTrailingStops &&
                trade.trailingStopPrice &&
                currentPrice > trade.highestPrice
            ) {
                const newStop = currentPrice * (1 - trade.trailingStopPercent);
                if (newStop > trade.trailingStopPrice) {
                    await this.tradeRepo.updateTrade(trade.id, {
                        highestPrice: currentPrice,
                        trailingStopPrice: newStop,
                    });
                    trade.highestPrice = currentPrice;
                    trade.trailingStopPrice = newStop;
                }
            }
        }

        if (positionsToClose.length > 0) {
            const accountInfo = await this.binanceData.getAccountInfo();
            if (!accountInfo.error) {
                for (const p of positionsToClose) {
                    const baseAsset = p.trade.symbol.replace("USDT", "");
                    const pos = accountInfo.balances.find(
                        (b) => b.asset === baseAsset
                    );
                    if (pos && pos.free > 0) {
                        await this.executeLiveSell(
                            {
                                symbol: p.trade.symbol,
                                signal: "EXIT",
                                strength: 0,
                            },
                            p.currentPrice,
                            pos,
                            p.trade,
                            p.exitReason
                        );
                    }
                }
            }
        }
    }

    async getPortfolioSummary() {
        const accountInfo = await this.binanceData.getAccountInfo();
        if (accountInfo.error) return { error: accountInfo.error.message };

        const usdt = parseFloat(
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0
        );
        const prices = this.binanceData.getAllPrices();
        const openTrades = await this.tradeRepo.getOpenLiveTrades();

        const positions = openTrades.map((t) => {
            const cur = prices[t.symbol]?.price || t.price;
            return {
                symbol: t.symbol,
                quantity: t.quantity,
                avgPrice: t.entryPrice,
                currentPrice: cur,
                currentValue: t.quantity * cur,
                unrealizedPnL: t.quantity * cur - t.entryCost,
                mode: "live",
            };
        });

        const cryptoVal = positions.reduce((acc, p) => acc + p.currentValue, 0);
        return {
            mode: "live",
            totalValue: usdt + cryptoVal,
            usdtBalance: usdt,
            cryptoValue: cryptoVal,
            positions,
            ...this.livePortfolioState,
            performance: this.performanceMetrics,
        };
    }

    // ============================================================
    // 🕹️ CONTROL METHODS
    // ============================================================

    start() {
        this.isActive = true;
        this.config.enableTrading = true;
        logger.warn("🔴 LIVE TRADING ACTIVE.");
        this.emit("engineStarted");
        if (this.portfolioUpdateInterval)
            clearInterval(this.portfolioUpdateInterval);
        this.portfolioUpdateInterval = setInterval(async () => {
            if (!this.isActive) return;
            try {
                const summary = await this.getPortfolioSummary();
                if (summary && !summary.error) {
                    this.emit("portfolioUpdated", summary);
                    this.riskService.checkRiskLimits(summary);
                    if (Date.now() - this.lastSnapshotSave > 5 * 60000) {
                        await this.portfolioRepo.saveLiveSnapshot(summary);
                        this.lastSnapshotSave = Date.now();
                    }
                }
            } catch (e) {
                logger.error("[LIVE] Portfolio update error:", e);
            }
        }, this.portfolioEmitThrottle);
    }

    stop() {
        this.isActive = false;
        this.config.enableTrading = false;
        this.emit("engineStopped");
        if (this.portfolioUpdateInterval)
            clearInterval(this.portfolioUpdateInterval);
    }

    updateConfig(cfg) {
        this.config = { ...this.config, ...cfg };
        this.emit("configUpdated", this.config);
    }

    getStatus() {
        return {
            isActive: this.isActive,
            risk: this.riskService.getRiskStatus(),
            metrics: this.performanceMetrics,
        };
    }

    // REPLACEMENT for the existing reset() method
    async reset() {
        logger.warn(
            "⚠️ HARD RESET TRIGGERED: Wiping memory and closing all open database positions."
        );

        try {
            // 1. Close all open trades in DB (Fixes Ghost Trades)
            const openTrades = await this.tradeRepo.getOpenLiveTrades();
            for (const trade of openTrades) {
                await this.tradeRepo.updateTrade(trade.id, {
                    isOpen: false,
                    exitReason: "MANUAL_RESET",
                    pnl: 0, // Neutralize PnL effect
                });
                logger.info(`🧹 Cleared ghost trade: ${trade.symbol}`);
            }

            // 2. Reset Internal State
            this.livePortfolioState = {
                totalPnL: 0,
                dailyPnL: 0,
                weeklyPnL: 0,
                lastResetDate: new Date().toDateString(),
                lastWeeklyReset: this.getWeekStart(new Date()),
            };

            // 3. Reset Metrics
            this.recalculateLivePerformanceMetrics();

            // 4. Reset Risk Service
            if (
                this.riskService &&
                typeof this.riskService.reset === "function"
            ) {
                this.riskService.reset();
            }

            this.emit("engineReset");
            logger.success(
                "✅ Engine Hard Reset Complete. Ghost trades removed."
            );
        } catch (error) {
            logger.error("❌ Error during Hard Reset:", error);
        }
    }
}

module.exports = LiveTradingEngine;
