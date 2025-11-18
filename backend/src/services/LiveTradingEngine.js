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

        // P&L State
        this.livePortfolioState = {
            totalPnL: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };

        this.lastFullSummary = null;
        this.lastSnapshotSave = 0;
        this.portfolioEmitThrottle = 2000;
        this.lightweightEmitThrottle = 500;
        this.lastPortfolioEmit = 0;
        this.portfolioUpdateInterval = null;
        this.isActive = false;
        this.mode = "live";

        logger.info("🚀 Live Trading Engine Initialized - REAL MONEY MODE.");

        // Performance Metrics
        this.performanceMetrics = this.getInitialMetrics();

        // Asset Performance Init
        this.config.assets.forEach((asset) => {
            this.performanceMetrics.assetPerformance[asset] = {
                trades: 0,
                wins: 0,
                totalPnL: 0,
                winRate: 0,
                avgPnL: 0,
            };
        });

        this.tradeHistory = [];
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
            sharpeRatio: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            signalPerformance: {
                BUY_STRONG: { trades: 0, wins: 0, totalPnL: 0 },
                BUY_MEDIUM: { trades: 0, wins: 0, totalPnL: 0 },
                BUY_WEAK: { trades: 0, wins: 0, totalPnL: 0 },
            },
            holdingPeriodStats: { avgHoldingTime: 0, holdingTimes: [] },
            exitReasonStats: {
                TAKE_PROFIT: { count: 0, totalPnL: 0, avgPnL: 0 },
                TRAILING_STOP: { count: 0, totalPnL: 0, avgPnL: 0 },
                STOP_LOSS: { count: 0, totalPnL: 0, avgPnL: 0 },
                SIGNAL_SELL: { count: 0, totalPnL: 0, avgPnL: 0 },
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

        this.livePortfolioState.totalPnL = sellTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );

        const todayString = new Date().toDateString();
        const weekStart = this.getWeekStart(new Date());

        this.livePortfolioState.dailyPnL = sellTrades
            .filter((t) => new Date(t.timestamp).toDateString() === todayString)
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        this.livePortfolioState.weeklyPnL = sellTrades
            .filter((t) => new Date(t.timestamp) >= new Date(weekStart))
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        this.recalculateLivePerformanceMetrics();
        logger.success("✅ Live Trading Engine ready.");
    }

    // --- SMART EXECUTION LOGIC ---

    /**
     * Attempts to fill an order via Limit first (Maker), falling back to Market (Taker)
     * This saves fees and reduces slippage in calm markets.
     */
    async executeSmartOrder(symbol, side, quantity, quoteOrderQty = null) {
        try {
            // 1. Get Best Price
            const book = await binanceClient.bookTickers(symbol);
            if (!book || !book.bidPrice || !book.askPrice)
                throw new Error("Could not fetch OrderBook");

            const price =
                side === "BUY"
                    ? parseFloat(book.bidPrice)
                    : parseFloat(book.askPrice);

            // 2. Place Limit Order
            logger.info(
                `[LIVE] ⏳ SmartExec: Placing LIMIT ${side} for ${symbol} @ ${price}...`
            );

            // Note: For Buys using quoteOrderQty (USDT amount), we must use Market usually.
            // To use Limit, we must calculate quantity manually.
            let limitQty = quantity;
            if (side === "BUY" && quoteOrderQty && !quantity) {
                limitQty = (quoteOrderQty / price).toFixed(8); // Approx
                // Re-validate min notional here if needed, but skipping for speed
            }

            // Params for 'buy' or 'sell' method
            // flags: { type: 'LIMIT', timeInForce: 'GTC' } implied usually, but we want strict control
            // node-binance-api signature: binance.buy(symbol, quantity, price, {type:'LIMIT'}, (error, response) => ...)

            let orderResult;

            // We wrap the Limit Order placement in a Promise
            const placeLimit = () =>
                new Promise((resolve, reject) => {
                    const callback = (error, response) => {
                        if (error) reject(error);
                        else resolve(response);
                    };
                    if (side === "BUY")
                        binanceClient.buy(
                            symbol,
                            limitQty,
                            price,
                            { type: "LIMIT" },
                            callback
                        );
                    else
                        binanceClient.sell(
                            symbol,
                            limitQty,
                            price,
                            { type: "LIMIT" },
                            callback
                        );
                });

            try {
                orderResult = await placeLimit();
            } catch (err) {
                logger.warn(
                    `[LIVE] Limit Order failed (${
                        err.body || err.message
                    }). Failing over to Market.`
                );
                return await this.executeMarketOrderFallback(
                    symbol,
                    side,
                    quantity,
                    quoteOrderQty
                );
            }

            const orderId = orderResult.orderId;

            // 3. Wait 10 Seconds
            await new Promise((r) => setTimeout(r, 10000));

            // 4. Check Status
            const statusParams = { symbol: symbol, orderId: orderId };
            const checkStatus = () =>
                new Promise((resolve, reject) => {
                    binanceClient.orderStatus(
                        symbol,
                        orderId,
                        (error, orderStatus, symbol) => {
                            if (error) reject(error);
                            else resolve(orderStatus);
                        }
                    );
                });

            const updatedOrder = await checkStatus();

            if (updatedOrder.status === "FILLED") {
                logger.success(`[LIVE] ✅ LIMIT Order FILLED! Saved fees.`);
                return updatedOrder; // Return structure matching standard response
            }

            // 5. Cancel and Market
            logger.info(
                `[LIVE] ⏱️ Limit Order timed out (${updatedOrder.status}). Cancelling and moving to Market.`
            );

            try {
                await binanceClient.cancel(symbol, orderId);
            } catch (e) {
                // If cancel fails, it might have filled in the last millisecond. Check one last time.
                const finalCheck = await checkStatus();
                if (finalCheck.status === "FILLED") return finalCheck;
                throw e; // Real error
            }

            // 6. Execute Market Fallback
            // Calculate remaining quantity if partially filled (advanced),
            // for now assuming 0 fill on timeout for simplicity or re-submitting full amount if 0 executed.
            const executedQty = parseFloat(updatedOrder.executedQty);

            if (executedQty > 0) {
                // Partial fill logic is complex.
                // For this "Simple Bot", we treat partials as "Done" to avoid over-buying.
                logger.warn(
                    `[LIVE] Order Partially Filled (${executedQty}). treating as complete to avoid complications.`
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
            logger.error(`[LIVE] SmartOrder Critical Fail:`, error);
            throw error;
        }
    }

    async executeMarketOrderFallback(symbol, side, quantity, quoteOrderQty) {
        logger.info(`[LIVE] 🚀 Executing MARKET ${side} Fallback...`);
        if (side === "BUY") {
            // For buys, we prefer quoteOrderQty (USDT amount) to be precise
            if (quoteOrderQty) {
                return await binanceClient.marketBuy(symbol, null, {
                    quoteOrderQty: quoteOrderQty,
                });
            } else {
                return await binanceClient.marketBuy(symbol, quantity);
            }
        } else {
            return await binanceClient.marketSell(symbol, quantity);
        }
    }

    // --- END SMART EXECUTION ---

    // --- EXISTING LOGIC (Refactored to use SmartOrder) ---

    async start() {
        this.isActive = true;
        this.config.enableTrading = true;
        logger.warn("🔴 LIVE TRADING ACTIVE. SMART EXECUTION ENABLED. 🔴");
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

                    const now = Date.now();
                    if (now - this.lastSnapshotSave > 5 * 60 * 1000) {
                        await this.portfolioRepo.saveLiveSnapshot(summary);
                        this.lastSnapshotSave = now;
                    }
                }
            } catch (error) {
                logger.error("[LIVE] Portfolio update error:", error);
            }
        }, this.portfolioEmitThrottle);
    }

    stop() {
        this.isActive = false;
        this.config.enableTrading = false;
        logger.info("📴 Live Trading Engine stopped.");
        this.emit("engineStopped");
        if (this.portfolioUpdateInterval)
            clearInterval(this.portfolioUpdateInterval);
    }

    async processSignal(signal, currentPrice, atrValue) {
        this.checkAndResetCounters();

        // Confluence Check: If generator says HOLD, we HOLD.
        // This prevents exiting simply because price dipped if trend (ADX) is still strong.
        if (signal.signal === "HOLD" || signal.signal === "COOLDOWN") {
            return {
                success: true,
                action: "HOLD",
                reason: signal.message || "Signal Generator says HOLD",
            };
        }

        if (!this.isValidSignal(signal))
            return { success: false, reason: "Signal Invalid" };

        if (!this.isActive || !this.config.enableTrading)
            return { success: false, reason: "Trading Disabled" };
        if (this.riskService.isHalted())
            return {
                success: false,
                reason: `Halted: ${this.riskService.getHaltReason()}`,
            };

        const accountInfo = await this.binanceData.getAccountInfo();
        if (accountInfo.error)
            return { success: false, reason: accountInfo.error.message };

        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        const openTradeForSymbol = openTrades.find(
            (t) => t.symbol === signal.symbol
        );

        const isBullish = signal.signal.includes("BUY");
        const isBearish = signal.signal.includes("SELL");

        if (isBullish && !openTradeForSymbol) {
            return this.executeLiveBuy(
                signal,
                currentPrice,
                atrValue,
                accountInfo
            );
        } else if (isBearish && openTradeForSymbol) {
            const baseAsset = signal.symbol.replace("USDT", "");
            const binancePosition = accountInfo.balances.find(
                (b) => b.asset === baseAsset && b.total > 0
            );

            if (binancePosition) {
                return this.executeLiveSell(
                    signal,
                    currentPrice,
                    binancePosition,
                    openTradeForSymbol,
                    "SIGNAL_SELL"
                );
            } else {
                // Fix ghost trades
                await this.tradeRepo.updateTrade(openTradeForSymbol.id, {
                    isOpen: false,
                    exitReason: "GHOST_TRADE_FIX",
                });
                return {
                    success: false,
                    reason: "Ghost trade fixed (DB says open, Wallet says 0)",
                };
            }
        }

        return { success: true, action: "HOLD", reason: "No Action Required" };
    }

    async executeLiveBuy(signal, currentPrice, atrValue, accountInfo) {
        const usdtBalance =
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;
        const posDetails = this.calculateLivePositionDetails(
            signal.symbol,
            currentPrice,
            atrValue,
            usdtBalance
        );

        if (posDetails.error)
            return { success: false, reason: posDetails.error };

        // Validation
        const validation = this.binanceData.validateOrderParams(
            signal.symbol,
            posDetails.quantity,
            currentPrice
        );
        if (!validation.valid)
            return {
                success: false,
                reason: `Validation: ${validation.errors.join(", ")}`,
            };

        try {
            // USE SMART EXECUTION
            const orderResult = await this.executeSmartOrder(
                signal.symbol,
                "BUY",
                null,
                posDetails.usdtCost
            );

            if (orderResult && orderResult.status === "FILLED") {
                const { totalFeeUsdt, avgPrice } = await this._parseOrderFills(
                    orderResult.fills
                );
                const trueCost =
                    parseFloat(orderResult.cummulativeQuoteQty) + totalFeeUsdt;

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
                    signalStrength: signal.strength, // Now storing ADX
                    mode: "live",
                    atr: atrValue,
                    isOpen: true,
                    entryCost: trueCost,
                    entryPrice: avgPrice,
                    stopLoss: posDetails.stopLoss,
                    takeProfitPrice: posDetails.takeProfit,
                    trailingStopPrice: this.config.enableTrailingStops
                        ? posDetails.stopLoss
                        : null,
                    highestPrice: avgPrice,
                    trailingStopPercent: this.config.trailingStopPercent,
                };

                await this.tradeRepo.save(trade);
                this.emit("tradeExecuted", trade);
                return { success: true, action: "BUY", trade };
            }
            throw new Error(`Order not filled: ${orderResult.status}`);
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

        if (quantityToSell <= 0)
            return { success: false, reason: "Zero Quantity" };

        try {
            // USE SMART EXECUTION
            const orderResult = await this.executeSmartOrder(
                signal.symbol,
                "SELL",
                quantityToSell,
                null
            );

            if (orderResult && orderResult.status === "FILLED") {
                const { totalFeeUsdt, avgPrice } = await this._parseOrderFills(
                    orderResult.fills
                );

                const entryCost = entryTrade.entryCost || entryTrade.usdtCost;
                const pnl =
                    parseFloat(orderResult.cummulativeQuoteQty) -
                    entryCost -
                    totalFeeUsdt;
                const pnlPercent = (pnl / entryCost) * 100;

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
                    pnlPercent,
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
                await this.tradeRepo.updateTrade(entryTrade.id, {
                    isOpen: false,
                });
                this.emit("tradeExecuted", trade);
                this.updateLivePerformanceMetrics(trade);

                return { success: true, action: "SELL", trade };
            }
            throw new Error(`Order not filled: ${orderResult.status}`);
        } catch (error) {
            logger.error(`[LIVE] Sell Failed:`, error);
            return { success: false, reason: error.message };
        }
    }

    // --- HELPERS ---

    async _parseOrderFills(fills) {
        if (!fills || !fills.length) return { totalFeeUsdt: 0, avgPrice: 0 };
        let totalFeeUsdt = 0,
            totalQty = 0,
            totalQuote = 0;

        for (const fill of fills) {
            const p = parseFloat(fill.price);
            const q = parseFloat(fill.qty);
            const comm = parseFloat(fill.commission);

            totalQty += q;
            totalQuote += p * q;

            if (fill.commissionAsset === "USDT") {
                totalFeeUsdt += comm;
            } else if (fill.commissionAsset === "BNB") {
                const bnbData = this.binanceData.getCurrentPrice("BNBUSDT");
                const bnbPrice = bnbData ? bnbData.price : 250; // Fallback
                totalFeeUsdt += comm * bnbPrice;
            } else {
                totalFeeUsdt += comm * p; // Asset fee
            }
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
        const riskPerUnit = currentPrice - stopLoss;

        if (riskPerUnit <= 0) return { error: "Invalid Stop Loss" };

        let finalUSDT = Math.min(
            (riskAmt / riskPerUnit) * currentPrice,
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
        if (!signal || !signal.symbol || !signal.signal) return false;
        if (
            [
                "ERROR",
                "INSUFFICIENT_DATA",
                "COOLDOWN",
                "WEAK_SIGNAL",
                "LOW_VOLATILITY",
            ].includes(signal.signal)
        )
            return false;

        // ADX Check (Strength)
        if (signal.strength < this.config.minSignalStrength) {
            logger.debug(
                `[LIVE] Weak Signal (ADX ${signal.strength.toFixed(1)})`
            );
            return false;
        }
        return true;
    }

    // --- METRICS & STATE ---

    updateLivePerformanceMetrics(trade) {
        if (trade.side !== "SELL") return;
        this.performanceMetrics.totalTrades++;
        const isWin = trade.pnl > 0;

        if (isWin) {
            this.performanceMetrics.winningTrades++;
            this.performanceMetrics.avgWin =
                (this.performanceMetrics.avgWin *
                    (this.performanceMetrics.winningTrades - 1) +
                    trade.pnl) /
                this.performanceMetrics.winningTrades;
        } else {
            this.performanceMetrics.losingTrades++;
            this.performanceMetrics.avgLoss =
                (this.performanceMetrics.avgLoss *
                    (this.performanceMetrics.losingTrades - 1) +
                    Math.abs(trade.pnl)) /
                this.performanceMetrics.losingTrades;
        }

        // Recalculate Win Rate & Profit Factor
        this.performanceMetrics.winRate =
            (this.performanceMetrics.winningTrades /
                this.performanceMetrics.totalTrades) *
            100;
        const grossProfit =
            this.performanceMetrics.avgWin *
            this.performanceMetrics.winningTrades;
        const grossLoss =
            this.performanceMetrics.avgLoss *
            this.performanceMetrics.losingTrades;
        this.performanceMetrics.profitFactor =
            grossLoss > 0 ? grossProfit / grossLoss : 0;
    }

    recalculateLivePerformanceMetrics() {
        this.performanceMetrics = this.getInitialMetrics();
        const sellTrades = this.tradeHistory.filter((t) => t.side === "SELL");
        sellTrades.forEach((t) => this.updateLivePerformanceMetrics(t));
    }

    checkAndResetCounters() {
        const today = new Date().toDateString();
        const currentWeek = this.getWeekStart(new Date());
        if (this.livePortfolioState.lastResetDate !== today) {
            this.livePortfolioState.lastResetDate = today;
            this.livePortfolioState.dailyPnL = 0;
            this.riskService.resetDailyLimit(today);
        }
        if (this.livePortfolioState.lastWeeklyReset !== currentWeek) {
            this.livePortfolioState.lastWeeklyReset = currentWeek;
            this.livePortfolioState.weeklyPnL = 0;
            this.riskService.resetWeeklyLimit(currentWeek);
        }
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff)).toDateString();
    }

    async updatePortfolioValue(priceData) {
        // Similar to Paper Engine but optimized for Live
        // This updates trailing stops in memory and DB
        this.checkAndResetCounters();
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        if (!openTrades.length) return;

        const positionsToClose = [];

        for (const trade of openTrades) {
            const currentPrice = priceData[trade.symbol]?.price;
            if (!currentPrice) continue;

            let exitReason = null;

            // Checks
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

            if (exitReason) {
                positionsToClose.push({ trade, currentPrice, exitReason });
            } else if (
                this.config.enableTrailingStops &&
                trade.trailingStopPrice
            ) {
                // Trailing Logic
                if (currentPrice > trade.highestPrice) {
                    const newStop =
                        currentPrice * (1 - trade.trailingStopPercent);
                    if (newStop > trade.trailingStopPrice) {
                        await this.tradeRepo.updateTrade(trade.id, {
                            highestPrice: currentPrice,
                            trailingStopPrice: newStop,
                        });
                        trade.highestPrice = currentPrice; // Local update
                        trade.trailingStopPrice = newStop;
                    }
                }
            }
        }

        // Execute Exits
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

        const usdt =
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;
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
            totalValue: parseFloat(usdt) + cryptoVal,
            usdtBalance: parseFloat(usdt),
            cryptoValue: cryptoVal,
            positions,
            ...this.livePortfolioState,
            performance: this.performanceMetrics,
        };
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

    async reset() {
        this.livePortfolioState.totalPnL = 0;
        this.recalculateLivePerformanceMetrics();
        this.emit("engineReset");
    }
}

module.exports = LiveTradingEngine;
