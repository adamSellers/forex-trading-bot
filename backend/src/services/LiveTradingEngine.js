// backend/src/services/LiveTradingEngine.js
const EventEmitter = require("events");
const logger = require("../utils/logger");
const TradeRepository = require("../repositories/tradeRepository");
const PortfolioRepository = require("../repositories/portfolioRepository");
const binanceClient = require("./binanceClient"); // Import the raw client for placing orders

class LiveTradingEngine extends EventEmitter {
    constructor(config = {}, binanceDataService, riskManagementService) {
        super();
        this.config = {
            // Defaults from PaperTradingEngine for parity
            maxCapitalAtRisk: config.maxCapitalAtRisk || 5000,
            riskPerTrade: config.riskPerTrade || 0.01,
            maxDailyLoss: config.maxDailyLoss || 0.02,
            maxWeeklyLoss: config.maxWeeklyLoss || 0.05,
            allocation: config.allocation || {
                BTCUSDT: 0.35,
                ETHUSDT: 0.35,
                BNBUSDT: 0.2,
                DOGEUSDT: 0.1,
            },
            minOrderSize: config.minOrderSize || 10,
            stopLossATR: config.stopLossATR || 1.5,
            takeProfitATRMultiplier: config.takeProfitATRMultiplier || 2.5,
            enableTrailingStops: config.enableTrailingStops !== false,
            trailingStopPercent: config.trailingStopPercent || 0.02,
            minSignalStrength: config.minSignalStrength || 0.5,
            enableVolatilityFilter: config.enableVolatilityFilter !== false,
            minVolatilityPercent: config.minVolatilityPercent || 2.0,
            ...config,
        };
        this.binanceData = binanceDataService;
        this.riskService = riskManagementService;
        this.tradeRepo = new TradeRepository();
        this.portfolioRepo = new PortfolioRepository();

        // --- Live P&L and State Tracking ---
        this.livePortfolioState = {
            totalPnL: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };
        this.lastFullSummary = null; // Cache for lightweight updates
        this.lastSnapshotSave = 0;
        this.portfolioEmitThrottle = 2000; // For full, authoritative updates
        this.lightweightEmitThrottle = 500; // For fast, visual-only UI updates
        this.lastPortfolioEmit = 0; // Tracks the last lightweight emit
        this.portfolioUpdateInterval = null; // To hold the setInterval ID
        this.isActive = false;
        this.mode = "live"; // NEW: Explicitly set the mode for the engine
        logger.info("🚀 Live Trading Engine Initialized - REAL MONEY MODE.");
    }

    async initialize() {
        logger.info("🔄 Initializing Live Trading Engine...");
        // Load historical P&L to get the correct starting point
        const allLiveTrades = await this.tradeRepo.getAllTrades("live");
        const sellTrades = allLiveTrades.filter((t) => t.side === "SELL");

        // Correctly initialize all P&L states from historical data
        this.livePortfolioState.totalPnL = sellTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );

        const today = new Date();
        const todayString = today.toDateString();
        const weekStart = this.getWeekStart(today);

        this.livePortfolioState.dailyPnL = sellTrades
            .filter((t) => new Date(t.timestamp).toDateString() === todayString)
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        this.livePortfolioState.weeklyPnL = sellTrades
            .filter((t) => new Date(t.timestamp) >= new Date(weekStart))
            .reduce((sum, t) => sum + (t.pnl || 0), 0);

        logger.info(
            `[LIVE] Initial P&L loaded: Total=${this.livePortfolioState.totalPnL.toFixed(
                2
            )}, Daily=${this.livePortfolioState.dailyPnL.toFixed(
                2
            )}, Weekly=${this.livePortfolioState.weeklyPnL.toFixed(2)} USDT`
        );
        logger.success("✅ Live Trading Engine ready.");
    }

    /**
     * NEW: Calculates lifetime performance metrics from a list of completed sell trades.
     * @param {Array} sellTrades - An array of completed sell trade objects.
     * @returns {Object} A comprehensive performance metrics object.
     */
    _calculatePerformanceMetrics(sellTrades) {
        if (!sellTrades || sellTrades.length === 0) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                avgWin: 0,
                avgLoss: 0,
                profitFactor: 0,
                sharpeRatio: 0,
                maxDrawdown: 0, // Placeholder for now
                currentDrawdown: 0, // Placeholder
                avgHoldingPeriod: 0,
                bestTrade: null,
                worstTrade: null,
            };
        }

        const winningTrades = sellTrades.filter((t) => t.pnl > 0);
        const losingTrades = sellTrades.filter((t) => t.pnl <= 0);

        const totalGrossProfit = winningTrades.reduce(
            (sum, t) => sum + (t.pnl || 0),
            0
        );
        const totalGrossLoss = Math.abs(
            losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)
        );

        const avgWin =
            winningTrades.length > 0
                ? totalGrossProfit / winningTrades.length
                : 0;
        const avgLoss =
            losingTrades.length > 0 ? totalGrossLoss / losingTrades.length : 0;

        const profitFactor =
            totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : 0;

        // Per-trade Sharpe Ratio (not annualized)
        const returns = sellTrades.map((t) => t.pnlPercent || 0);
        let sharpeRatio = 0;
        if (returns.length >= 2) {
            const avgReturn =
                returns.reduce((sum, r) => sum + r, 0) / returns.length;
            const variance =
                returns.reduce(
                    (sum, r) => sum + Math.pow(r - avgReturn, 2),
                    0
                ) /
                (returns.length - 1);
            const stdDev = Math.sqrt(variance);
            if (stdDev > 0) {
                sharpeRatio = avgReturn / stdDev;
            }
        }

        return {
            totalTrades: sellTrades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: (winningTrades.length / sellTrades.length) * 100,
            avgWin,
            avgLoss,
            profitFactor,
            sharpeRatio,
            // Placeholders for now, as these require more complex historical analysis
            maxDrawdown: 0,
            currentDrawdown: 0,
        };
    }

    start() {
        this.isActive = true;
        this.config.enableTrading = true;
        logger.warn(
            "🔴 LIVE TRADING IS NOW ACTIVE. REAL ORDERS WILL BE PLACED. 🔴"
        );
        this.emit("engineStarted");

        // NEW: Start a dedicated, periodic loop for portfolio updates.
        // This is more reliable than throttling inside the high-frequency updatePortfolioValue method.
        if (this.portfolioUpdateInterval) {
            clearInterval(this.portfolioUpdateInterval);
        }
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
                logger.error(
                    "[LIVE] Error during periodic portfolio update:",
                    error
                );
            }
        }, this.portfolioEmitThrottle);
    }

    stop() {
        this.isActive = false;
        this.config.enableTrading = false;
        logger.info("📴 Live Trading Engine stopped.");
        this.emit("engineStopped");

        // NEW: Stop the periodic update loop
        if (this.portfolioUpdateInterval) {
            clearInterval(this.portfolioUpdateInterval);
            this.portfolioUpdateInterval = null;
        }
    }

    getStatus() {
        return {
            mode: "live",
            isActive: this.isActive,
            riskStatus: this.riskService.getRiskStatus(),
            config: this.config,
        };
    }

    async processSignal(signal, currentPrice, atrValue) {
        // Check and reset counters before processing
        this.checkAndResetCounters();

        // --- NEW: Add verbose logging for debugging missed trades ---
        logger.debug(`[LIVE] Processing signal for ${signal.symbol}`, {
            signal,
        });

        if (!this.isValidSignal(signal)) {
            // The reason is already logged inside isValidSignal
            return {
                success: false,
                reason: "Signal failed validation",
            };
        }
        // 1. --- SAFETY CHECKS ---
        if (!this.isActive || !this.config.enableTrading) {
            logger.warn(
                `[LIVE] 🚫 Trade for ${signal.symbol} skipped: Live trading is not active.`
            );
            return { success: false, reason: "Live trading is not active" };
        }
        if (this.riskService.isHalted()) {
            const reason = this.riskService.getHaltReason();
            logger.warn(
                `[LIVE] 🚫 Trade for ${signal.symbol} skipped: Trading is halted. Reason: ${reason}`
            );
            return {
                success: false,
                reason: `Trading halted: ${reason}`,
            };
        }
        if (!binanceClient) {
            logger.error(
                `[LIVE] 🚫 Trade for ${signal.symbol} skipped: Binance client not available.`
            );
            return { success: false, reason: "Binance client not available" };
        }

        // 2. --- GET REAL ACCOUNT STATE ---
        const accountInfo = await this.binanceData.getAccountInfo();
        if (accountInfo.error) {
            return { success: false, reason: accountInfo.error.message };
        }

        // --- LOGIC CORRECTION: Align with PaperTradingEngine's trend-following logic
        const isBullishSignal =
            signal.signal.includes("BUY") || signal.signal.includes("BULLISH");
        const isBearishSignal =
            signal.signal.includes("SELL") || signal.signal.includes("BEARISH");

        // --- FIX: Check for an open trade in the database, not just a non-zero balance ---
        // This prevents "dust" balances from blocking new trades.
        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        const openTradeForSymbol = openTrades.find(
            (t) => t.symbol === signal.symbol
        );

        // 3. --- EXECUTE LOGIC ---
        if (isBullishSignal && !openTradeForSymbol) {
            // --- ACTION: BUY ---
            // We have a bullish signal and no open trade record for this asset.
            return this.executeLiveBuy(
                signal,
                currentPrice,
                atrValue,
                accountInfo
            );
        } else if (isBearishSignal && openTradeForSymbol) {
            // --- ACTION: SELL ---
            // We have a bearish signal and an open trade record that needs to be closed.
            // We still need the actual balance from Binance to know how much to sell.
            const baseAsset = signal.symbol.replace("USDT", "");
            const binancePosition = accountInfo.balances.find(
                (b) => b.asset === baseAsset && b.total > 0
            );

            if (binancePosition) {
                return this.executeLiveSell(
                    signal,
                    currentPrice,
                    binancePosition, // Pass the balance object for quantity
                    openTradeForSymbol, // Pass the DB trade record for P&L calculation
                    "SIGNAL_SELL"
                );
            } else {
                // This is a state inconsistency. DB says we have a position, Binance says we don't.
                // This could happen if a trade was manually closed on Binance.
                logger.warn(
                    `[LIVE] State inconsistency for ${signal.symbol}: DB shows an open trade but Binance balance is zero. Closing trade record.`
                );
                await this.tradeRepo.updateTrade(openTradeForSymbol.id, {
                    isOpen: false,
                    exitReason: "INCONSISTENT_STATE_ZERO_BALANCE",
                });
                return {
                    success: false,
                    reason: "State inconsistency detected (zero balance for open trade).",
                };
            }
        } else {
            // --- ACTION: HOLD ---
            // - Bullish signal, but we already have a position.
            // - Bearish signal, but we have no position to sell.
            let reason = `Signal is ${signal.signal}, no trade action needed for current state.`;
            if (isBullishSignal && openTradeForSymbol) {
                reason = `HOLD: Bullish signal (${signal.signal}) received, but a position for ${signal.symbol} is already open.`;
            } else if (isBearishSignal && !openTradeForSymbol) {
                reason = `HOLD: Bearish signal (${signal.signal}) received, but no position for ${signal.symbol} to sell.`;
            } else if (signal.signal.includes("HOLD")) {
                reason = `HOLD: Trend-following signal (${signal.signal}) received, maintaining current state.`;
            }

            logger.debug(`[LIVE] ${reason}`);

            return {
                success: true,
                action: "HOLD",
                reason,
                signal,
            };
        }
    }

    /**
     * FIXED: Helper to parse fees from Binance order fills.
     * This is now async to handle fetching prices for commission assets like BNB.
     * @param {Array} fills - The 'fills' array from the Binance order response.
     * @returns {{totalFeeUsdt: number, avgPrice: number}}
     */
    async _parseOrderFills(fills) {
        if (!fills || fills.length === 0) {
            return { totalFeeUsdt: 0, avgPrice: 0 };
        }

        let totalFeeUsdt = 0;
        let totalQty = 0;
        let totalQuoteQty = 0;

        for (const fill of fills) {
            const price = parseFloat(fill.price);
            const qty = parseFloat(fill.qty);
            const commission = parseFloat(fill.commission);
            const commissionAsset = fill.commissionAsset;

            totalQty += qty;
            totalQuoteQty += price * qty;

            if (commissionAsset === "USDT") {
                totalFeeUsdt += commission;
            } else if (commissionAsset === "BNB") {
                // Fee is in BNB, we need the BNBUSDT price to convert to USDT
                const bnbPriceData =
                    this.binanceData.getCurrentPrice("BNBUSDT");
                const bnbPrice = bnbPriceData ? bnbPriceData.price : 0;
                if (bnbPrice > 0) {
                    totalFeeUsdt += commission * bnbPrice;
                } else {
                    // Fallback if we can't get live BNB price, estimate using a standard rate
                    logger.warn(
                        "Could not get live BNB price for fee calculation, estimating."
                    );
                    totalFeeUsdt += price * qty * 0.00075; // Binance's discounted fee rate (0.075%)
                }
            } else {
                // Assume fee is in the base asset (e.g., BTC for BTCUSDT).
                // The `price` in the fill is the price of the base asset in USDT.
                totalFeeUsdt += commission * price;
            }
        }

        const avgPrice = totalQty > 0 ? totalQuoteQty / totalQty : 0;

        return { totalFeeUsdt, avgPrice };
    }

    async executeLiveBuy(signal, currentPrice, atrValue, accountInfo) {
        const usdtBalance =
            accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;

        // 1. Calculate Position Size
        const positionSize = this.calculateLivePositionDetails(
            signal.symbol,
            currentPrice,
            atrValue,
            usdtBalance
        );
        if (positionSize.error) {
            return { success: false, reason: positionSize.error };
        }

        const { quantity, usdtCost } = positionSize;

        // 2. Validate Order with Binance rules
        const validation = this.binanceData.validateOrderParams(
            signal.symbol,
            quantity,
            currentPrice
        );
        if (!validation.valid) {
            const reason = `Order validation failed: ${validation.errors.join(
                ", "
            )}`;
            logger.error(`[LIVE] ${reason}`);
            return { success: false, reason };
        }

        // 3. --- EXECUTE REAL ORDER ---
        try {
            logger.warn(
                // Corrected log message
                `[LIVE] Attempting MARKET BUY for ${usdtCost.toFixed(
                    2
                )} USDT of ${signal.symbol}`
            );

            // CRITICAL FIX: Use quoteOrderQty to specify the amount in USDT to spend.
            // This is more reliable than calculating the quantity manually, as it avoids
            // precision (stepSize) and minimum notional value errors from Binance.
            const orderResult = await binanceClient.marketBuy(
                signal.symbol,
                null,
                {
                    quoteOrderQty: usdtCost,
                }
            );
            logger.debug(
                `[LIVE] binanceClient.marketBuy() result: ${JSON.stringify(
                    orderResult
                )}`
            );

            // ROBUSTNESS FIX: A real "FILLED" order from Binance will always have an orderId
            // and a non-empty 'fills' array. This check prevents saving a "ghost" trade
            // if the API returns a malformed or error response that isn't caught.
            if (
                orderResult &&
                orderResult.status === "FILLED" &&
                orderResult.orderId &&
                Array.isArray(orderResult.fills) &&
                orderResult.fills.length > 0
            ) {
                logger.success(
                    `[LIVE] MARKET BUY successful for ${signal.symbol}. Order ID: ${orderResult.orderId}`
                );

                // NEW: Parse fills to get accurate price and fees
                const { totalFeeUsdt, avgPrice } = await this._parseOrderFills(
                    orderResult.fills
                );

                const trade = {
                    id: orderResult.orderId.toString(),
                    symbol: signal.symbol,
                    side: "BUY",
                    quantity: parseFloat(orderResult.executedQty),
                    price: avgPrice, // Use more accurate average price from fills
                    usdtCost: parseFloat(orderResult.cummulativeQuoteQty),
                    feeUsdtValue: totalFeeUsdt, // NEW: Save the fee
                    timestamp: orderResult.transactTime,
                    signal: signal.signal,
                    signalStrength: signal.strength,
                    mode: "live",
                    atr: atrValue,
                    volatilityPercent: signal.atrPercent || 0,
                    isOpen: true,
                    entryCost: parseFloat(orderResult.cummulativeQuoteQty),
                    entryPrice: avgPrice, // Use more accurate average price
                    stopLoss: positionSize.stopLoss,
                    takeProfitPrice: positionSize.takeProfit, // from calculation
                    // CRITICAL FIX: Initial trailing stop should match the initial stop loss, like in paper engine.
                    trailingStopPrice: this.config.enableTrailingStops
                        ? positionSize.stopLoss
                        : null,
                    highestPrice: avgPrice,
                    trailingStopPercent: this.config.trailingStopPercent,
                };

                await this.tradeRepo.save(trade);
                this.emit("tradeExecuted", trade);
                // FIX: Add reason for clearer logging in TradingService
                return {
                    success: true,
                    action: "BUY",
                    trade,
                    reason: "Bullish signal with no open position.",
                };
            } else {
                throw new Error(
                    `Order status was not FILLED: ${
                        orderResult?.status || "Unknown"
                    }`
                );
            }
        } catch (error) {
            const errorMessage = error.body
                ? JSON.parse(error.body).msg
                : error.message;
            logger.error(
                `[LIVE] MARKET BUY FAILED for ${signal.symbol}:`,
                errorMessage
            );
            return {
                success: false,
                reason: `Binance API Error: ${errorMessage}`,
            };
        }
    }

    async executeLiveSell(
        signal,
        currentPrice,
        position,
        entryTrade,
        exitReason = "SIGNAL_SELL"
    ) {
        const quantityToSellRaw = position.free;

        // --- FIX: Format sell quantity to match Binance's stepSize rule ---
        const constraints = this.binanceData.symbolInfo.get(signal.symbol);
        const stepSize = constraints?.stepSize || 0.000001; // Fallback to high precision

        const quantityToSell = this.formatQuantity(quantityToSellRaw, stepSize);

        if (quantityToSell <= 0) {
            logger.warn(
                `[LIVE] Calculated sell quantity for ${signal.symbol} is zero after formatting. Aborting sell.`
            );
            return { success: false, reason: "Sell quantity is zero." };
        }

        // 1. Validate Order
        const validation = this.binanceData.validateOrderParams(
            signal.symbol,
            quantityToSell, // Use the formatted quantity
            currentPrice
        );
        if (!validation.valid) {
            const reason = `SELL Order validation failed: ${validation.errors.join(
                ", "
            )}`;
            // Also log the raw vs formatted quantity for debugging
            logger.error(`[LIVE] ${reason}`, {
                rawQty: quantityToSellRaw,
                formattedQty: quantityToSell,
                stepSize,
            });
            return { success: false, reason };
        }

        // 2. --- EXECUTE REAL SELL ORDER ---
        try {
            logger.warn(
                `[LIVE] Attempting MARKET SELL: ${quantityToSell} ${signal.symbol} (Raw: ${quantityToSellRaw})`
            );

            const orderResult = await binanceClient.marketSell(
                signal.symbol,
                quantityToSell
            );

            // ROBUSTNESS FIX: Apply the same strict check for sell orders to ensure
            // we only process and save trades that are genuinely confirmed by Binance.
            if (
                orderResult &&
                orderResult.status === "FILLED" &&
                orderResult.orderId &&
                Array.isArray(orderResult.fills) &&
                orderResult.fills.length > 0
            ) {
                logger.success(
                    `[LIVE] MARKET SELL successful for ${signal.symbol}. Order ID: ${orderResult.orderId}`
                );

                // NEW: Parse fills to get accurate price and fees
                const { totalFeeUsdt: sellFeeUsdt, avgPrice } =
                    await this._parseOrderFills(orderResult.fills);

                const entryCost = entryTrade.entryCost || entryTrade.usdtCost; // Use entryCost if available, fallback to usdtCost
                // CORRECTED P&L: Account for the fee on the sell side.
                // The buy-side fee is implicitly handled by receiving less crypto.
                const pnl =
                    parseFloat(orderResult.cummulativeQuoteQty) -
                    entryCost -
                    sellFeeUsdt;
                const pnlPercent = (pnl / entryCost) * 100;
                const holdingPeriod =
                    orderResult.transactTime -
                    new Date(entryTrade.timestamp).getTime();

                this.livePortfolioState.totalPnL += pnl;
                this.livePortfolioState.dailyPnL += pnl;
                this.livePortfolioState.weeklyPnL += pnl;

                const trade = {
                    id: orderResult.orderId.toString(),
                    symbol: signal.symbol,
                    side: "SELL",
                    quantity: parseFloat(orderResult.executedQty),
                    price: avgPrice, // Use more accurate average price
                    usdtReceived: parseFloat(orderResult.cummulativeQuoteQty),
                    feeUsdtValue: sellFeeUsdt, // NEW: Save the fee
                    pnl,
                    pnlPercent,
                    holdingPeriod,
                    entryCost,
                    entryPrice: entryTrade.price,
                    entrySignal: entryTrade.signal,
                    entrySignalStrength: entryTrade.signalStrength,
                    exitReason,
                    signal: signal.signal, // Store the exit signal type
                    signalStrength: signal.strength, // Store the exit signal strength
                    timestamp: orderResult.transactTime,
                    mode: "live",
                };

                await this.tradeRepo.save(trade);
                await this.tradeRepo.updateTrade(entryTrade.id, {
                    isOpen: false,
                });
                this.emit("tradeExecuted", trade);
                // FIX: Add reason for clearer logging in TradingService
                return {
                    success: true,
                    action: "SELL",
                    trade,
                    reason: `Exit due to ${exitReason}`,
                };
            } else {
                throw new Error(
                    `Order status was not FILLED: ${
                        orderResult?.status || "Unknown"
                    }`
                );
            }
        } catch (error) {
            const errorMessage = error.body
                ? JSON.parse(error.body).msg
                : error.message;
            logger.error(
                `[LIVE] MARKET SELL FAILED for ${signal.symbol}:`,
                errorMessage
            );
            return {
                success: false,
                reason: `Binance API Error: ${errorMessage}`,
            };
        }
    }

    /**
     * CRITICAL FIX: This method now correctly calculates position size based on risk,
     * mirroring the logic from the PaperTradingEngine.
     */
    calculateLivePositionDetails(symbol, currentPrice, atrValue, usdtBalance) {
        const allocationPercent = this.config.allocation[symbol] || 0.1;
        const maxAllocationUSDT =
            this.config.maxCapitalAtRisk * allocationPercent;
        const riskAmountUSDT =
            this.config.maxCapitalAtRisk * this.config.riskPerTrade;

        // Calculate stop loss price
        let stopLoss;
        if (atrValue) {
            stopLoss = currentPrice - atrValue * this.config.stopLossATR;
        } else {
            stopLoss = currentPrice * 0.98; // 2% fallback, matches paper engine
        }
        const riskPerUnit = currentPrice - stopLoss;

        if (riskPerUnit <= 0) {
            return {
                error: "Invalid stop loss calculation - stop loss is not below current price.",
            };
        }

        // This is the correct risk-based calculation
        const riskBasedQuantity = riskAmountUSDT / riskPerUnit;
        const riskBasedUSDT = riskBasedQuantity * currentPrice;

        // Determine final order size based on risk, allocation, and available balance
        const finalUSDT = Math.min(
            riskBasedUSDT,
            maxAllocationUSDT,
            usdtBalance * 0.95 // Match paper engine's 5% reserve
        );

        // DYNAMIC MINIMUM ORDER SIZE CHECK
        const constraints = this.binanceData.symbolInfo.get(symbol);
        const dynamicMinOrderSize =
            constraints?.minNotional || this.config.minOrderSize || 10;

        if (finalUSDT < dynamicMinOrderSize) {
            return {
                error: `Calculated order size $${finalUSDT.toFixed(
                    2
                )} is below minimum $${dynamicMinOrderSize}.`,
            };
        }

        // Calculate take-profit level - MATCHES PAPER ENGINE
        let takeProfit = null;
        if (atrValue && this.config.enableTrailingStops) {
            takeProfit =
                currentPrice + atrValue * this.config.takeProfitATRMultiplier;
        }

        // Return all details needed for the order
        const finalQuantity = finalUSDT / currentPrice;
        return {
            quantity: parseFloat(finalQuantity.toFixed(8)),
            usdtCost: parseFloat(finalUSDT.toFixed(2)),
            stopLoss: parseFloat(stopLoss.toFixed(8)),
            takeProfit: takeProfit ? parseFloat(takeProfit.toFixed(8)) : null,
            riskAmount: parseFloat((finalQuantity * riskPerUnit).toFixed(2)),
            allocation: allocationPercent,
            maxAllocation: maxAllocationUSDT,
            dynamicMinOrderSize,
        };
    }

    /**
     * Helper function to format a quantity according to Binance's stepSize rule.
     * This prevents precision-related API errors on SELL orders.
     * @param {number} quantity The raw quantity.
     * @param {number} stepSize The required step size for the symbol.
     * @returns {number} The formatted quantity.
     */
    formatQuantity(quantity, stepSize) {
        if (!stepSize || stepSize <= 0) {
            return quantity; // Avoid division by zero if stepSize is invalid
        }
        // Determine the number of decimal places from the stepSize
        const precision = Math.max(
            0,
            (stepSize.toString().split(".")[1] || "").length
        );
        // Floor the quantity to the nearest multiple of stepSize
        return parseFloat(
            (Math.floor(quantity / stepSize) * stepSize).toFixed(precision)
        );
    }

    /**
     * FIX: Aligned with paperTradingEngine to remove config fallbacks and improve logging.
     */
    isValidSignal(signal) {
        if (!signal || !signal.symbol || !signal.signal) return false;
        if (signal.signal === "ERROR" || signal.signal === "INSUFFICIENT_DATA")
            return false;
        if (signal.signal === "COOLDOWN" || signal.signal === "WEAK_SIGNAL")
            return false;
        if (signal.signal === "LOW_VOLATILITY") return false;

        // --- NEW: Add logging for why a signal is invalid ---
        if (signal.strength < this.config.minSignalStrength) {
            logger.debug(
                `[LIVE] 🔇 Blocking signal for ${
                    signal.symbol
                } due to weak strength: ${signal.strength?.toFixed(2)} < ${
                    this.config.minSignalStrength
                }`
            );
            return false;
        }

        if (
            this.config.enableVolatilityFilter &&
            signal.atrPercent !== undefined
        ) {
            const isEntrySignal = signal.signal === "BUY"; // Volatility filter only applies to initial entry
            if (
                isEntrySignal &&
                signal.atrPercent < this.config.minVolatilityPercent
            ) {
                logger.debug(
                    `[LIVE] 🔇 Blocking ENTRY signal for ${
                        signal.symbol
                    } due to low volatility: ${signal.atrPercent?.toFixed(
                        2
                    )}% < ${this.config.minVolatilityPercent}%`
                );
                return false;
            }
        }

        return true;
    }

    async updatePortfolioValue(priceData) {
        // NEW: Add a log to confirm position management continues during a halt.
        if (this.riskService.isHalted()) {
            logger.debug(
                `[LIVE] Position management is active during trading halt. Reason: ${this.riskService.getHaltReason()}`
            );
        }

        // FIX: Ensure daily/weekly counters are reset before any checks are made.
        this.checkAndResetCounters();

        const openTrades = await this.tradeRepo.getOpenLiveTrades();
        if (openTrades.length === 0) return;

        logger.debug(
            `[LIVE] Updating portfolio value for ${openTrades.length} open positions...`
        );

        // --- CONCURRENT EXIT HANDLING ---
        const positionsToClose = [];
        const tradesToUpdate = []; // NEW: Collect updates to run concurrently
        let totalUnrealizedPnL = 0;

        for (const trade of openTrades) {
            const currentPrice = priceData[trade.symbol]?.price;
            if (!currentPrice) continue;

            let exitReason = null;
            const syntheticSignal = {
                signal: "EXIT",
                strength: 5.0,
                symbol: trade.symbol,
            };

            // --- NEW: Calculate unrealized P&L for risk check ---
            const currentValue = trade.quantity * currentPrice;
            const unrealizedPnL =
                currentValue - (trade.entryCost || trade.usdtCost); // Use entryCost if available
            totalUnrealizedPnL += unrealizedPnL;
            // 1. Check Take Profit
            if (
                trade.takeProfitPrice &&
                currentPrice >= trade.takeProfitPrice
            ) {
                exitReason = "TAKE_PROFIT";
                syntheticSignal.signal = "SELL_TAKE_PROFIT";
            }
            // 2. Check Trailing Stop
            else if (
                this.config.enableTrailingStops && // Match paper engine check
                trade.trailingStopPrice &&
                currentPrice <= trade.trailingStopPrice
            ) {
                exitReason = "TRAILING_STOP";
                syntheticSignal.signal = "SELL_TRAILING_STOP";
            }
            // 3. Check initial Stop Loss (backup)
            else if (trade.stopLoss && currentPrice <= trade.stopLoss) {
                exitReason = "STOP_LOSS";
                syntheticSignal.signal = "SELL_STOP_LOSS";
            }

            if (exitReason) {
                logger.warn(
                    `[LIVE] ${exitReason} triggered for ${trade.symbol} at $${currentPrice}`
                );
                // Add to list to be closed concurrently after the loop
                positionsToClose.push({
                    signal: syntheticSignal,
                    currentPrice,
                    entryTrade: trade,
                    exitReason,
                });
            } else {
                // LOGIC PARITY FIX: Match the paper engine's atomic, in-memory update logic.
                // We update the local `trade` object and queue the DB update to run later.
                if (
                    this.config.enableTrailingStops &&
                    trade.trailingStopPrice !== null
                ) {
                    if (currentPrice > (trade.highestPrice || trade.price)) {
                        const newTrailingStop =
                            currentPrice * (1 - trade.trailingStopPercent);

                        if (newTrailingStop > trade.trailingStopPrice) {
                            const updates = {
                                highestPrice: currentPrice,
                                trailingStopPrice: newTrailingStop,
                            };
                            // 1. Queue the database update
                            tradesToUpdate.push({ id: trade.id, updates });

                            // 2. CRITICAL: Update the local object for this loop iteration,
                            // ensuring subsequent checks use the new value (mimics in-memory update).
                            trade.highestPrice = currentPrice;
                            trade.trailingStopPrice = newTrailingStop;

                            logger.info(
                                `[LIVE] Trailing stop for ${
                                    trade.symbol
                                } moved up to $${newTrailingStop.toFixed(2)}`
                            );
                        }
                    }
                }
            }
        }

        // --- NEW: Lightweight portfolio update for real-time UI responsiveness ---
        // This provides fast updates for position values without expensive API calls.
        const now = Date.now();
        if (
            this.lastFullSummary &&
            now - this.lastPortfolioEmit > this.lightweightEmitThrottle
        ) {
            // Create a mutable deep copy of the last known full summary
            const lightweightSummary = JSON.parse(
                JSON.stringify(this.lastFullSummary)
            );

            let newCryptoValue = 0;
            let hasChanges = false;

            // Update positions with new prices
            lightweightSummary.positions.forEach((pos) => {
                const currentPrice = priceData[pos.symbol]?.price;
                if (currentPrice && pos.currentPrice !== currentPrice) {
                    pos.currentPrice = currentPrice;
                    pos.currentValue = pos.quantity * currentPrice;
                    pos.unrealizedPnL = pos.currentValue - pos.entryCost;
                    hasChanges = true;
                }
                newCryptoValue += pos.currentValue;
            });

            if (hasChanges) {
                lightweightSummary.cryptoValue = newCryptoValue;
                lightweightSummary.totalValue =
                    lightweightSummary.usdtBalance + newCryptoValue;
                lightweightSummary.timestamp = now; // Mark as a fresh update

                this.emit("portfolioUpdated", lightweightSummary);
                this.lastPortfolioEmit = now;
                logger.debug("[LIVE] Emitted lightweight portfolio update.");
            }
        }

        // --- CONCURRENT EXIT EXECUTION ---
        if (positionsToClose.length > 0) {
            const accountInfo = await this.binanceData.getAccountInfo();
            if (accountInfo.error) {
                logger.error(
                    "[LIVE] Could not execute exits due to account info error:",
                    accountInfo.error
                );
            } else {
                const sellPromises = positionsToClose.map((p) => {
                    const baseAsset = p.entryTrade.symbol.replace("USDT", "");
                    const position = accountInfo.balances.find(
                        (b) => b.asset === baseAsset
                    );
                    if (position && position.free > 0) {
                        return this.executeLiveSell(
                            p.signal,
                            p.currentPrice,
                            position,
                            p.entryTrade,
                            p.exitReason
                        );
                    }
                    return Promise.resolve(); // Resolve promise if no position to sell
                });
                await Promise.all(sellPromises);
            }
        }

        // --- CONCURRENT DATABASE UPDATES ---
        if (tradesToUpdate.length > 0) {
            const updatePromises = tradesToUpdate.map((u) =>
                this.tradeRepo.updateTrade(u.id, u.updates)
            );
            // FIX: Await the updates to ensure state is persisted before the next price tick.
            // This matches the synchronous in-memory update behavior of the paper engine
            // and prevents race conditions where a trailing stop exit could be missed.
            try {
                await Promise.all(updatePromises);
            } catch (err) {
                logger.error("[LIVE] Batch trade update failed:", err);
            }
        }
    }

    async getPortfolioSummary() {
        try {
            const accountInfo = await this.binanceData.getAccountInfo();
            if (accountInfo.error) {
                logger.error(
                    "Could not get live portfolio summary due to account info error:",
                    accountInfo.error
                );
                return { error: accountInfo.error.message };
            }

            this.checkAndResetCounters();

            const prices = this.binanceData.getAllPrices();
            const usdtBalance =
                accountInfo.balances.find((b) => b.asset === "USDT")?.free || 0;
            const openTrades = await this.tradeRepo.getOpenLiveTrades();

            // NEW: Fetch all completed live trades for performance calculation
            const allSellTrades = (
                await this.tradeRepo.getAllTrades("live")
            ).filter((t) => t.side === "SELL");
            const performanceMetrics =
                this._calculatePerformanceMetrics(allSellTrades);

            let cryptoValue = 0;
            const positions = [];

            for (const trade of openTrades) {
                const currentPrice = prices[trade.symbol]?.price;
                if (!currentPrice) continue;

                const currentValue = trade.quantity * currentPrice;
                const unrealizedPnL = currentValue - trade.entryCost;
                cryptoValue += currentValue;

                positions.push({
                    symbol: trade.symbol,
                    quantity: trade.quantity,
                    avgPrice: trade.entryPrice, // Use the entry price from the DB
                    currentPrice: currentPrice,
                    currentValue: currentValue,
                    unrealizedPnL: unrealizedPnL,
                    entryCost: trade.entryCost,
                    entryTime: new Date(trade.timestamp).getTime(),
                    stopLoss: trade.stopLoss,
                    takeProfit: trade.takeProfitPrice,
                    trailingStop: trade.trailingStopPrice,
                    mode: "live", // Add the mode for the UI
                });
            }

            const totalValue = usdtBalance + cryptoValue;

            const summary = {
                mode: "live",
                totalValue,
                usdtBalance,
                cryptoValue,
                ...this.livePortfolioState,
                totalPnLPercent:
                    (this.livePortfolioState.totalPnL /
                        this.config.maxCapitalAtRisk) *
                    100,
                performance: performanceMetrics, // NEW: Attach the calculated metrics
                positions,
                positionCount: positions.length,
                riskStatus: this.riskService.getRiskStatus({
                    ...this.livePortfolioState,
                }),
            };

            // Cache the latest full summary for lightweight updates
            this.lastFullSummary = summary;

            return summary;
        } catch (error) {
            logger.error("Error getting live portfolio summary:", error);
            return { error: "Failed to fetch live portfolio summary." };
        }
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        logger.info("⚙️ Live Trading Engine config updated.");
        this.emit("configUpdated", this.config);
    }

    checkAndResetCounters() {
        const today = new Date().toDateString();
        const currentWeek = this.getWeekStart(new Date());

        // Reset daily counter
        if (this.livePortfolioState.lastResetDate !== today) {
            this.livePortfolioState.lastResetDate = today;
            this.livePortfolioState.dailyPnL = 0;
            this.riskService.resetDailyLimit(today);
            logger.debug("[LIVE] Daily P&L and Risk counter reset");
        }

        // Reset weekly counter
        if (this.livePortfolioState.lastWeeklyReset !== currentWeek) {
            this.livePortfolioState.lastWeeklyReset = currentWeek;
            this.livePortfolioState.weeklyPnL = 0;
            this.riskService.resetWeeklyLimit(currentWeek);
            logger.debug("[LIVE] Weekly P&L and Risk counter reset");
        }
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day;
        return new Date(d.setDate(diff)).toDateString();
    }

    /**
     * NEW: Resets the P&L and risk state of the live engine for a fresh start.
     * This does NOT delete historical trades from the database.
     */
    async reset() {
        logger.warn("[LIVE] Resetting Live Trading Engine P&L state...");
        this.livePortfolioState = {
            totalPnL: 0,
            dailyPnL: 0,
            weeklyPnL: 0,
            lastResetDate: new Date().toDateString(),
            lastWeeklyReset: this.getWeekStart(new Date()),
        };

        // Also reset the risk service state and re-initialize it
        if (this.riskService) {
            this.riskService.reset();
            this.riskService.initialize(this.config);
        }

        logger.success(
            "[LIVE] P&L state has been reset. Risk limits are fresh."
        );
        this.emit("engineReset");
    }
}

module.exports = LiveTradingEngine;
