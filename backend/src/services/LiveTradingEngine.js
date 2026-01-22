// backend/src/services/LiveTradingEngine.js - Forex Live Trading Engine
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const oandaClient = require("./Oandaclient");
const slackService = require("./slackService");
const emailService = require("./emailService");

/**
 * LiveTradingEngine - Executes trades based on signals from SignalGenerator
 *
 * Responsibilities:
 * - Listen for signals from SignalGenerator
 * - Validate entry conditions (trading enabled, max positions, margin, etc.)
 * - Calculate position size based on risk parameters
 * - Execute trades via Oanda API
 * - Manage stop loss, take profit, and trailing stops
 * - Log trades to database and broadcast events via Socket.IO
 * - Handle exit signals and position management
 */
class LiveTradingEngine extends EventEmitter {
    constructor(options = {}) {
        super();

        // Dependencies (injected via init())
        this.configService = null;
        this.dataService = null;
        this.tradeRepository = null;
        this.signalGenerator = null;
        this.io = null;

        // Engine state
        this.isRunning = false;
        this.openTrades = new Map(); // tradeId -> trade object
        this.tradeQueue = []; // Queue for sequential processing
        this.isProcessingQueue = false;

        // Position monitoring
        this.monitorInterval = null;
        this.monitorIntervalMs = options.monitorIntervalMs || 10000; // 10s default

        // Stats
        this.stats = {
            tradesExecuted: 0,
            tradesClosed: 0,
            signalsReceived: 0,
            signalsRejected: 0,
            errors: 0,
            lastSignalTime: null,
            lastTradeTime: null,
        };

        logger.info("⚙️ LiveTradingEngine v1.0 initialized");
    }

    /**
     * Initialize with dependencies
     */
    init(configService, dataService, tradeRepository, signalGenerator, io) {
        this.configService = configService;
        this.dataService = dataService;
        this.tradeRepository = tradeRepository;
        this.signalGenerator = signalGenerator;
        this.io = io;

        logger.info("⚙️ LiveTradingEngine dependencies injected");
        return this;
    }

    /**
     * Start the trading engine
     */
    async start() {
        if (this.isRunning) {
            logger.warn("⚠️ Trading engine already running");
            return;
        }

        // Verify dependencies
        if (!this.configService || !this.dataService || !this.tradeRepository) {
            throw new Error(
                "Trading engine not properly initialized - missing dependencies"
            );
        }

        // Initialize Oanda client
        try {
            await oandaClient.initialize();
        } catch (error) {
            logger.error(
                "❌ Failed to initialize Oanda client:",
                error.message
            );
            throw error;
        }

        this.isRunning = true;

        // Load any existing open trades from database
        await this.syncOpenTrades();

        // Subscribe to signals from SignalGenerator
        // Store bound handler reference so we can remove it later
        if (this.signalGenerator) {
            this._boundSignalHandler = this.handleSignal.bind(this);
            this.signalGenerator.on(
                "signalGenerated",
                this._boundSignalHandler
            );
            logger.info("📡 Subscribed to signal generator events");
        }

    }

    /**
     * Stop the trading engine
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        // Unsubscribe from signals using stored reference
        if (this.signalGenerator && this._boundSignalHandler) {
            this.signalGenerator.removeListener(
                "signalGenerated",
                this._boundSignalHandler
            );
            this._boundSignalHandler = null;
        }

        // Stop monitoring
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        logger.info("⏹️ LiveTradingEngine stopped");
        this.emit("engineStopped", { timestamp: Date.now() });
    }

    /**
     * Sync open trades from database with local state
     */
    async syncOpenTrades() {
        try {
            const config = this.configService.get();
            const dbTrades = await this.tradeRepository.getOpenTrades(
                config.tradingMode || "live"
            );

            this.openTrades.clear();
            for (const trade of dbTrades) {
                this.openTrades.set(trade.id, trade);
            }

            logger.info(
                `📊 Synced ${this.openTrades.size} open trades from database`
            );

            // Also sync with Oanda to verify positions
            await this.syncWithOanda();
        } catch (error) {
            logger.error("❌ Failed to sync open trades:", error.message);
        }
    }

    /**
     * Sync local state with actual Oanda positions
     */
    async syncWithOanda() {
        try {
            const oandaTrades = await oandaClient.getOpenTrades();
            const oandaTradeIds = new Set(oandaTrades.trades.map((t) => t.id));

            // Check for trades that closed externally (stop loss hit, etc.)
            for (const [tradeId, trade] of this.openTrades) {
                if (
                    trade.oandaTradeId &&
                    !oandaTradeIds.has(trade.oandaTradeId)
                ) {
                    logger.warn(
                        `⚠️ Trade ${tradeId} closed externally on Oanda`
                    );
                    await this.handleExternalClose(trade);
                }
            }
        } catch (error) {
            logger.error("❌ Failed to sync with Oanda:", error.message);
        }
    }

    /**
     * Handle a trade that was closed externally (stop loss, take profit hit)
     */
    async handleExternalClose(trade) {
        try {
            // Get trade details from Oanda to determine exit price and reason
            const tradeDetails = await oandaClient.getTrade(trade.oandaTradeId);

            const exitPrice = parseFloat(
                tradeDetails.trade?.averageClosePrice || trade.entryPrice
            );
            const exitReason = this.determineExitReason(tradeDetails);

            // Extract Oanda's actual P/L (includes spreads, conversion, etc.)
            const oandaRealizedPL = tradeDetails.trade?.realizedPL
                ? parseFloat(tradeDetails.trade.realizedPL)
                : null;
            const oandaFinancing = tradeDetails.trade?.financing
                ? parseFloat(tradeDetails.trade.financing)
                : 0;

            await this.closeTrade(trade.id, exitPrice, exitReason, {
                oandaRealizedPL,
                oandaFinancing,
            });
        } catch (error) {
            // Trade might not exist anymore, mark as closed with unknown reason
            logger.warn(
                `⚠️ Could not get details for externally closed trade ${trade.id}`
            );
            await this.closeTrade(trade.id, trade.entryPrice, "EXTERNAL");
        }
    }

    /**
     * Determine exit reason from Oanda trade details
     */
    determineExitReason(tradeDetails) {
        const state = tradeDetails.trade?.state;
        if (state === "CLOSED") {
            // Check if there was a stop loss or take profit order that triggered
            // This is a simplified check - could be enhanced
            return "EXTERNAL";
        }
        return "UNKNOWN";
    }

    // ==================== SIGNAL HANDLING ====================

    /**
     * Handle incoming signal from SignalGenerator
     */
    async handleSignal(signal) {
        this.stats.signalsReceived++;
        this.stats.lastSignalTime = Date.now();

        logger.debug(
            `📨 Received signal: ${signal.symbol} - ${signal.signal
            } (ADX: ${signal.strength?.toFixed(1)})`
        );

        // Queue signal for processing
        this.tradeQueue.push({ type: "signal", signal, timestamp: Date.now() });
        this.processQueue();
    }

    /**
     * Process the trade queue sequentially
     */
    async processQueue() {
        if (this.isProcessingQueue || this.tradeQueue.length === 0) return;

        this.isProcessingQueue = true;

        while (this.tradeQueue.length > 0) {
            const item = this.tradeQueue.shift();

            try {
                if (item.type === "signal") {
                    await this.processSignal(item.signal);
                }
            } catch (error) {
                logger.error(`❌ Queue processing error:`, error.message);
                this.stats.errors++;
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Process a signal and decide action
     */
    async processSignal(signal) {
        const {
            symbol,
            signal: signalType,
            strength,
            entryType,
            currentPrice,
            atr,
            atrPips,
        } = signal;

        // Get current config
        const config = this.configService.get();

        // Check if we have an open position for this instrument
        const existingTrade = this.getOpenTradeByInstrument(symbol);

        if (signalType === "BUY") {
            // Entry signal
            if (existingTrade) {
                logger.debug(
                    `⏸️ Skipping BUY for ${symbol} - already in position`
                );
                this.stats.signalsRejected++;
                return;
            }

            // Validate and execute entry
            const validation = this.validateEntry(signal, config);
            if (!validation.valid) {
                logger.info(
                    `⏸️ Entry rejected for ${symbol}: ${validation.reason}`
                );
                this.stats.signalsRejected++;
                this.emit("entryRejected", {
                    signal,
                    reason: validation.reason,
                });
                return;
            }

            await this.executeEntry(signal, config);
        } else if (signalType === "SELL") {
            // Check if we have an open position for this instrument
            if (existingTrade) {
                // Close existing LONG position if we get a SELL signal
                if (existingTrade.side === "BUY") {
                    await this.executeExit(
                        existingTrade,
                        currentPrice,
                        "SIGNAL_REVERSAL"
                    );
                }
            }

            // Execute SHORT Entry if shorting is enabled
            if (config.enableShorting) {
                if (existingTrade && existingTrade.side === "SELL") {
                    logger.debug(
                        `⏸️ Skipping SELL for ${symbol} - already in short position`
                    );
                    this.stats.signalsRejected++;
                    return;
                }

                // Validate and execute entry
                const validation = this.validateEntry(signal, config);
                if (!validation.valid) {
                    logger.info(
                        `⏸️ Short Entry rejected for ${symbol}: ${validation.reason}`
                    );
                    this.stats.signalsRejected++;
                    this.emit("entryRejected", {
                        signal,
                        reason: validation.reason,
                    });
                    return;
                }

                await this.executeEntry(signal, config);
            }
        }
        // HOLD signals are ignored
    }

    /**
     * Get open trade by instrument
     */
    getOpenTradeByInstrument(instrument) {
        for (const [id, trade] of this.openTrades) {
            if (trade.instrument === instrument && trade.isOpen) {
                return trade;
            }
        }
        return null;
    }

    // ==================== ENTRY VALIDATION ====================

    /**
     * Validate entry conditions
     */
    validateEntry(signal, config) {
        // 1. Trading must be enabled
        if (!config.enableTrading) {
            return { valid: false, reason: "Trading is disabled" };
        }

        // 2. Check instrument is in active list
        if (!config.assets.includes(signal.symbol)) {
            return {
                valid: false,
                reason: `Instrument ${signal.symbol} not in active list`,
            };
        }

        // 3. Check max open positions
        const openCount = this.openTrades.size;
        if (openCount >= config.maxOpenPositions) {
            return {
                valid: false,
                reason: `Max positions reached (${openCount}/${config.maxOpenPositions})`,
            };
        }

        // 4. Not already in a position for this instrument
        if (this.getOpenTradeByInstrument(signal.symbol)) {
            return {
                valid: false,
                reason: "Already in position for this instrument",
            };
        }

        // 5. Check minimum ADX strength
        if (signal.strength < config.minAdx) {
            return {
                valid: false,
                reason: `ADX too low (${signal.strength?.toFixed(1)} < ${config.minAdx
                    })`,
            };
        }

        // 6. Signal direction check
        if (signal.signal !== "BUY" && signal.signal !== "SELL") {
            return { valid: false, reason: "Invalid signal type" };
        }

        // 7. Shorting enabled check
        if (signal.signal === "SELL" && !config.enableShorting) {
            return { valid: false, reason: "Short selling is disabled" };
        }

        return { valid: true };
    }

    // ==================== POSITION SIZING ====================

    /**
     * Calculate position size based on config
     * Uses marginAvailable (not total balance) to prevent over-leveraging
     */
    async calculatePositionSize(
        instrument,
        stopLossPips,
        currentPrice,
        config
    ) {
        // Get account info from Oanda including available margin
        let accountBalance, marginAvailable;
        try {
            const accountSummary = await oandaClient.getAccountSummary();
            accountBalance = parseFloat(accountSummary.account.balance);
            marginAvailable = parseFloat(accountSummary.account.marginAvailable);
        } catch (error) {
            logger.error("❌ Failed to get account info:", error.message);
            return 0;
        }

        // Determine position sizing method
        if (config.positionSizeMethod === "FIXED") {
            return config.fixedPositionUnits || 1000;
        }

        // CRITICAL: Use marginAvailable (free capital) not total balance
        // This prevents opening positions when capital is already committed
        const maxCapital = config.maxCapitalAtRisk || 500;

        // Apply margin buffer (default 20%) to avoid cutting it too close
        const marginBuffer = config.marginBuffer || 0.20;
        const safeMarginAvailable = marginAvailable * (1 - marginBuffer);

        // effectiveBalance = min(safeMarginAvailable, maxCapitalAtRisk)
        const effectiveBalance = (maxCapital > 0)
            ? Math.min(safeMarginAvailable, maxCapital)
            : safeMarginAvailable;

        // Log margin status for debugging
        const marginUsed = accountBalance - marginAvailable;
        logger.info(`💰 Margin status: Balance=$${accountBalance.toFixed(2)} | Available=$${marginAvailable.toFixed(2)} | Used=$${marginUsed.toFixed(2)} | Effective=$${effectiveBalance.toFixed(2)}`);

        // Check if we have enough margin to trade
        if (effectiveBalance <= 0) {
            logger.warn(`⚠️ Insufficient margin available: $${marginAvailable.toFixed(2)} (after ${marginBuffer * 100}% buffer)`);
            return 0;
        }

        // Calculate risk amount on the effective balance
        const riskPercent = config.riskPerTrade || 0.02;
        const riskAmount = effectiveBalance * riskPercent;

        // Calculate position size
        const pipValue = oandaClient.getPipValue(instrument);
        const stopLossPrice = stopLossPips * pipValue;

        // Position size = Risk Amount / (Stop Loss in Price × Conversion Factor)
        let units = Math.floor(riskAmount / (stopLossPrice * currentPrice));

        // Apply leverage limits based on available margin (not total balance)
        const maxLeverage = config.leverage || 10;
        const maxUnitsFromLeverage = Math.floor(
            (safeMarginAvailable * maxLeverage) / currentPrice
        );
        units = Math.min(units, maxUnitsFromLeverage);

        // Minimum units check
        if (units < 1) {
            logger.warn(
                `⚠️ Calculated position size too small: ${units} units`
            );
            return 0;
        }

        return units;
    }

    /**
     * Calculate stop loss price
     */
    calculateStopLoss(signal, config) {
        const { currentPrice, atrPips } = signal;
        const instrument = signal.symbol;
        const pipValue = oandaClient.getPipValue(instrument);

        let stopLossPips;

        if (config.stopLossType === "ATR" && atrPips) {
            // ATR-based stop loss
            const multiplier = config.stopLossAtrMultiplier || 2.0;
            stopLossPips = atrPips * multiplier;
        } else {
            // Fixed pip stop loss
            stopLossPips = config.stopLossPips || 30;
        }

        // Enforce minimum stop loss distance to prevent tight stops in low volatility
        const minStopPips = config.minStopLossPips || 12;
        if (stopLossPips < minStopPips) {
            logger.info(
                `📏 Stop loss adjusted: ${stopLossPips.toFixed(1)} pips -> ${minStopPips} pips (minimum floor)`
            );
            stopLossPips = minStopPips;
        }

        // Calculate stop loss price based on trade direction
        // BUY: stop loss is BELOW entry
        // SELL: stop loss is ABOVE entry
        let stopLossPrice;
        if (signal.signal === "SELL") {
            stopLossPrice = currentPrice + stopLossPips * pipValue;
        } else {
            stopLossPrice = currentPrice - stopLossPips * pipValue;
        }

        return {
            stopLossPips,
            stopLossPrice: parseFloat(stopLossPrice.toFixed(5)),
        };
    }

    /**
     * Calculate take profit price based on percentage of account balance
     *
     * Target profit = accountBalance × takeProfitPercent (default 6%)
     * TP Price = entryPrice + (targetProfit / units)
     *
     * @param {object} signal - Signal data with currentPrice
     * @param {object} config - Trading config
     * @param {number} units - Position size in units
     * @param {number} units - Position size in units
     * @param {number} accountBalance - Current account balance
     */
    calculateTakeProfit(signal, config, units, accountBalance) {
        if (!config.enableTakeProfit) return null;
        if (!units || units <= 0) return null;
        if (!accountBalance || accountBalance <= 0) return null;

        const price = entryPrice || signal.currentPrice;
        const instrument = signal.symbol;
        const pipValue = oandaClient.getPipValue(instrument);

        // Calculate target profit as percentage of account balance
        const takeProfitPercent = config.takeProfitPercent || 0.06; // Default 6%
        const targetProfitAud = accountBalance * takeProfitPercent;

        // Calculate price movement needed to achieve target profit
        // For Forex: P/L = units × priceChange (simplified for AUD account)
        // priceChange = targetProfit / units
        const priceChange = targetProfitAud / units;

        // For BUY trades, take profit is above entry
        // For BUY trades, take profit is above entry
        let takeProfitPrice = currentPrice + priceChange;

        // For SELL trades, take profit is below entry
        if (signal.signal === "SELL") {
            takeProfitPrice = currentPrice - priceChange;
        }

        const takeProfitPips = priceChange / pipValue;

        logger.info(
            `📊 TP Calculation: balance=$${accountBalance.toFixed(2)} × ${(takeProfitPercent * 100).toFixed(0)}% = $${targetProfitAud.toFixed(2)} target | ${takeProfitPips.toFixed(1)} pips`
        );

        return {
            takeProfitPips,
            takeProfitPrice: parseFloat(takeProfitPrice.toFixed(5)),
            targetProfitAud,
        };
    }

    // ==================== TRADE EXECUTION ====================

    /**
     * Execute a trade entry
     */
    async executeEntry(signal, config) {
        const { symbol, currentPrice, strength, entryType, atr, atrPips } =
            signal;

        logger.info(`🎯 Executing entry for ${symbol} at ${currentPrice}`);

        // Calculate stop loss
        const { stopLossPips, stopLossPrice } = this.calculateStopLoss(
            signal,
            config
        );

        // Get account balance for position sizing and take profit calculation
        let accountBalance;
        try {
            const accountSummary = await oandaClient.getAccountSummary();
            accountBalance = parseFloat(accountSummary.account.balance);
        } catch (error) {
            logger.error("❌ Failed to get account balance:", error.message);
            return;
        }

        // Calculate position size
        const units = await this.calculatePositionSize(
            symbol,
            stopLossPips,
            currentPrice,
            config
        );
        if (units === 0) {
            logger.warn(
                `⚠️ Position size calculation returned 0 units - skipping trade`
            );
            this.emit("entryRejected", {
                signal,
                reason: "Position size too small",
            });
            return;
        }

        // Calculate take profit based on % of account balance
        const takeProfit = this.calculateTakeProfit(
            signal,
            config,
            units,
            accountBalance
        );

        // Calculate trailing stop distance (if enabled)
        let trailingStopDistance = null;
        if (config.enableTrailingStops) {
            const pipValue = oandaClient.getPipValue(symbol);
            trailingStopDistance = (config.trailingStopPips || 25) * pipValue;
        }

        // Get current spread for logging
        const priceData = this.dataService.getCurrentPrice(symbol);
        const spreadPips = priceData?.spread || 0;

        // Check if paper trading mode
        const mode = config.tradingMode || "live";

        if (mode === "paper") {
            // Paper trading - simulate the trade
            return this.executePaperEntry(signal, config, {
                units,
                stopLossPrice,
                stopLossPips,
                spreadPips,
            });
        }

        // Live trading - execute via Oanda (without TP initially)
        try {
            // For SELL signals, negate units to open SHORT position in Oanda
            // Oanda API: positive units = BUY, negative units = SELL
            const orderUnits = signal.signal === "SELL" ? -units : units;

            const orderResult = await oandaClient.placeMarketOrder(
                symbol,
                orderUnits,
                {
                    stopLossPrice,
                    // Note: TP will be set after order fills using actual margin
                }
            );

            // Extract trade details from response
            const fillTransaction = orderResult.orderFillTransaction;
            if (!fillTransaction) {
                logger.error(
                    "❌ Order placed but no fill transaction received"
                );
                this.emit("orderError", {
                    signal,
                    error: "No fill transaction",
                });
                return;
            }

            const oandaTradeId = fillTransaction.tradeOpened?.tradeID;
            const fillPrice = parseFloat(fillTransaction.price);

            // Get actual margin from Oanda response
            const marginUsed = parseFloat(
                fillTransaction.tradeOpened?.initialMarginRequired || 0
            );

            // Calculate take profit based on actual margin used
            let takeProfit = null;
            let takeProfitPrice = null;

            if (marginUsed > 0 && config.enableTakeProfit) {
                takeProfit = this.calculateTakeProfit(
                    signal,
                    config,
                    units,
                    marginUsed,
                    fillPrice
                );
                takeProfitPrice = takeProfit?.takeProfitPrice;

                // Set TP on Oanda via modifyTrade
                if (takeProfitPrice && oandaTradeId) {
                    try {
                        await oandaClient.modifyTrade(oandaTradeId, {
                            takeProfitPrice,
                        });
                        logger.info(
                            `✅ Take profit set: ${takeProfitPrice} ($${takeProfit.targetProfitAud.toFixed(2)} target)`
                        );
                    } catch (tpError) {
                        logger.warn(
                            `⚠️ Failed to set take profit: ${tpError.message}`
                        );
                    }
                }
            }

            // Create trade record
            const trade = {
                id: uuidv4(),
                oandaTradeId,
                instrument: symbol,
                side: signal.signal === "SELL" ? "SELL" : "BUY",
                units,
                entryPrice: fillPrice,
                entryCostAud: units * fillPrice, // Simplified
                signal: signal.signal,
                signalStrength: strength,
                entryType,
                atrPips,
                stopLossPrice,
                takeProfitPrice,
                trailingStopPips: config.trailingStopPips,
                leverageUsed: config.leverage || 10,
                marginUsedAud: marginUsed || (units * fillPrice) / (config.leverage || 10),
                spreadPips,
                entryTime: Date.now(),
                mode: "live",
                isOpen: true,
            };

            // Save to database
            await this.tradeRepository.save(trade);

            // Track in memory
            this.openTrades.set(trade.id, trade);

            // Update stats
            this.stats.tradesExecuted++;
            this.stats.lastTradeTime = Date.now();

            // Broadcast trade event
            this.broadcastTradeOpened(trade);

            // Send Slack notification (async)
            if (this.configService) {
                const config = this.configService.get();
                if (config.enableSlackAlerts !== false) {
                    slackService.sendTradeAlert(trade, "opened").catch(() => { });
                }
            }

            const tpInfo = takeProfit?.takeProfitPrice
                ? ` | TP: ${takeProfit.takeProfitPrice} ($${takeProfit.targetProfitAud.toFixed(2)})`
                : "";
            logger.success(
                `✅ LIVE ${trade.side} executed: ${symbol} @ ${fillPrice} | Units: ${units} | SL: ${stopLossPrice}${tpInfo}`
            );

            return trade;
        } catch (error) {
            logger.error(
                `❌ Order execution failed for ${symbol}:`,
                error.message
            );
            this.stats.errors++;
            this.emit("orderError", { signal, error: error.message });
            throw error;
        }
    }

    /**
     * Execute a paper trade entry (simulation)
     */
    async executePaperEntry(signal, config, params) {
        const { symbol, currentPrice, strength, entryType, atrPips } = signal;
        const {
            units,
            stopLossPrice,
            stopLossPips,
            spreadPips,
        } = params;

        // Simulate fill at current price (could add slippage simulation)
        const fillPrice = currentPrice;

        // Calculate margin (simulated)
        const leverage = config.leverage || 10;
        const marginUsed = (units * fillPrice) / leverage;

        // Calculate take profit based on margin used
        let takeProfitPrice = null;
        if (config.enableTakeProfit && marginUsed > 0) {
            const takeProfit = this.calculateTakeProfit(
                signal,
                config,
                units,
                marginUsed,
                fillPrice
            );
            takeProfitPrice = takeProfit?.takeProfitPrice;
        }

        // Create trade record
        const trade = {
            id: uuidv4(),
            oandaTradeId: `PAPER_${Date.now()}`,
            instrument: symbol,
            side: "BUY",
            units,
            entryPrice: fillPrice,
            entryCostAud: units * fillPrice,
            signal: signal.signal,
            signalStrength: strength,
            entryType,
            atrPips,
            stopLossPrice,
            takeProfitPrice,
            trailingStopPips: config.trailingStopPips,
            leverageUsed: leverage,
            marginUsedAud: marginUsed,
            spreadPips,
            entryTime: Date.now(),
            isOpen: true,
        };

        // Adjust for SELL
        if (signal.signal === "SELL") {
            trade.side = "SELL";
            trade.stopLossPrice = params.stopLossPrice; // Already calculated correctly
            // TP already calculated correctly
        }

        // Save to database
        await this.tradeRepository.save(trade);

        // Track in memory
        this.openTrades.set(trade.id, trade);

        // Update stats
        this.stats.tradesExecuted++;
        this.stats.lastTradeTime = Date.now();

        // Broadcast trade event
        this.broadcastTradeOpened(trade);

        // Send Slack notification
        await slackService.sendTradeAlert(trade, "opened");

        const tpInfo = takeProfitPrice ? ` | TP: ${takeProfitPrice}` : "";
        logger.success(
            `✅ PAPER BUY simulated: ${symbol} @ ${fillPrice} | Units: ${units} | SL: ${stopLossPrice}${tpInfo}`
        );

        return trade;
    }

    // ==================== TRADE EXIT ====================

    /**
     * Execute a trade exit
     */
    async executeExit(trade, exitPrice, reason) {
        const config = this.configService.get();
        const mode = config.tradingMode || "live";

        logger.info(
            `🎯 Executing exit for ${trade.instrument} at ${exitPrice} (${reason})`
        );

        let oandaData = {};

        if (
            mode === "live" &&
            trade.oandaTradeId &&
            !trade.oandaTradeId.startsWith("PAPER_")
        ) {
            // Live trading - close via Oanda
            try {
                const closeResult = await oandaClient.closeTrade(
                    trade.oandaTradeId
                );

                // Extract actual P/L from Oanda's response
                const orderFill = closeResult.orderFillTransaction;
                if (orderFill) {
                    oandaData.oandaRealizedPL = orderFill.pl
                        ? parseFloat(orderFill.pl)
                        : null;
                    oandaData.oandaFinancing = orderFill.financing
                        ? parseFloat(orderFill.financing)
                        : 0;

                    // Use Oanda's actual exit price if available
                    if (orderFill.price) {
                        exitPrice = parseFloat(orderFill.price);
                    }
                }
            } catch (error) {
                // Trade might already be closed
                logger.warn(
                    `⚠️ Error closing trade on Oanda: ${error.message}`
                );
            }
        }

        // Close in our system
        await this.closeTrade(trade.id, exitPrice, reason, oandaData);
    }

    /**
     * Close a trade and update database
     * @param {string} tradeId - Internal trade ID
     * @param {number} exitPrice - Exit price
     * @param {string} exitReason - Reason for exit
     * @param {object} oandaData - Optional Oanda P/L data
     * @param {number} oandaData.oandaRealizedPL - Oanda's realized P/L (source of truth)
     * @param {number} oandaData.oandaFinancing - Overnight financing charges
     */
    async closeTrade(tradeId, exitPrice, exitReason, oandaData = {}) {
        const trade = this.openTrades.get(tradeId);
        if (!trade) {
            logger.warn(`⚠️ Trade ${tradeId} not found in open trades`);
            return;
        }

        // Calculate P/L - use Oanda's realizedPL if available (includes all costs)
        const pipValue = oandaClient.getPipValue(trade.instrument);
        const priceChange = exitPrice - trade.entryPrice;
        const pnlPips = priceChange / pipValue;

        // Use Oanda's realizedPL as source of truth when available
        // This includes spreads, currency conversion, and all fees
        const pnlAud =
            oandaData.oandaRealizedPL !== null &&
                oandaData.oandaRealizedPL !== undefined
                ? oandaData.oandaRealizedPL
                : trade.units * priceChange; // Fallback to simple calc for paper trades

        const pnlPercent = (pnlAud / trade.entryCostAud) * 100;

        // Extract financing (swap) charges
        const swapAud = oandaData.oandaFinancing || 0;

        // Calculate holding period
        const holdingPeriodMs = Date.now() - trade.entryTime;

        // Update trade object
        const closedTrade = {
            ...trade,
            exitPrice,
            exitTime: Date.now(),
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            swapAud,
            holdingPeriodMs,
            isOpen: false,
        };

        // Update database
        await this.tradeRepository.updateTrade(tradeId, {
            exitPrice,
            exitTime: closedTrade.exitTime,
            exitValueAud: trade.units * exitPrice,
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            swapAud,
            holdingPeriodMs,
            isOpen: false,
        });

        // Remove from open trades
        this.openTrades.delete(tradeId);

        // Update stats
        this.stats.tradesClosed++;

        // Broadcast trade closed event
        this.broadcastTradeClosed(closedTrade);

        // Send Slack notification
        await slackService.sendTradeAlert(closedTrade, "closed");

        const profitEmoji = pnlAud >= 0 ? "💰" : "📉";
        const swapNote = swapAud !== 0 ? ` | Swap: ${swapAud.toFixed(2)}` : "";
        logger.info(
            `${profitEmoji} Trade closed: ${trade.instrument
            } | P/L: ${pnlAud.toFixed(2)} AUD (${pnlPips.toFixed(
                1
            )} pips)${swapNote} | Reason: ${exitReason}`
        );

        return closedTrade;
    }

    // ==================== POSITION MONITORING ====================

    /**
     * Start position monitoring loop
     */
    startMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }

        this.monitorInterval = setInterval(() => {
            this.monitorPositions();
        }, this.monitorIntervalMs);

        logger.info(
            `👁️ Position monitoring started (${this.monitorIntervalMs / 1000
            }s interval)`
        );
    }

    /**
     * Monitor open positions for trailing stops and stop loss/take profit
     */
    async monitorPositions() {
        if (this.openTrades.size === 0) return;

        const config = this.configService.get();

        for (const [tradeId, trade] of this.openTrades) {
            try {
                await this.checkPosition(trade, config);
            } catch (error) {
                logger.error(
                    `❌ Error monitoring position ${tradeId}:`,
                    error.message
                );
            }
        }

        // Sync with Oanda periodically
        await this.syncWithOanda();
    }

    /**
     * Check a single position for stop loss, trailing stop updates
     */
    async checkPosition(trade, config) {
        const priceData = this.dataService.getCurrentPrice(trade.instrument);
        if (!priceData) return;

        const currentPrice = priceData.price;
        const pipValue = oandaClient.getPipValue(trade.instrument);

        // Check paper trade stop loss (Oanda handles live trades)
        if (trade.mode === "paper" && trade.stopLossPrice) {
            if (currentPrice <= trade.stopLossPrice) {
                logger.info(
                    `🛑 Paper trade stop loss hit for ${trade.instrument}`
                );
                await this.closeTrade(
                    trade.id,
                    trade.stopLossPrice,
                    "STOP_LOSS"
                );
                return;
            }
        }

        // Check paper trade take profit
        if (trade.mode === "paper" && trade.takeProfitPrice) {
            if (currentPrice >= trade.takeProfitPrice) {
                logger.info(
                    `🎯 Paper trade take profit hit for ${trade.instrument}`
                );
                await this.closeTrade(
                    trade.id,
                    trade.takeProfitPrice,
                    "TAKE_PROFIT"
                );
                return;
            }
        }

        // Update trailing stop if enabled (works for both BUY and SELL)
        if (config.enableTrailingStops) {
            await this.updateTrailingStop(trade, currentPrice, config);
        }
    }

    /**
     * Update trailing stop for a position (works for both BUY and SELL)
     */
    async updateTrailingStop(trade, currentPrice, config) {
        const pipValue = oandaClient.getPipValue(trade.instrument);
        const trailingPips = config.trailingStopPips || 25;
        const activationPips = config.trailingStopActivationPips || 20;
        const isBuy = trade.side === "BUY";

        // Calculate profit in pips (direction-aware)
        const profitPips = isBuy
            ? (currentPrice - trade.entryPrice) / pipValue
            : (trade.entryPrice - currentPrice) / pipValue;

        if (profitPips < activationPips) {
            return; // Not in profit enough to activate trailing
        }

        // Calculate new trailing stop price (direction-aware)
        // BUY: stop is BELOW current price, moves UP
        // SELL: stop is ABOVE current price, moves DOWN
        const newStopLossPrice = isBuy
            ? currentPrice - trailingPips * pipValue
            : currentPrice + trailingPips * pipValue;

        // Check if we should update (stop should only move in favorable direction)
        // BUY: new stop must be HIGHER than current
        // SELL: new stop must be LOWER than current
        const shouldUpdate = isBuy
            ? !trade.trailingStopPrice || newStopLossPrice > trade.trailingStopPrice
            : !trade.trailingStopPrice || newStopLossPrice < trade.trailingStopPrice;

        if (shouldUpdate) {
            const previousStop = trade.trailingStopPrice || trade.stopLossPrice;

            // Update in memory
            trade.trailingStopPrice = newStopLossPrice;

            // Track extreme price (highest for BUY, lowest for SELL)
            if (isBuy) {
                trade.highestPrice = Math.max(
                    trade.highestPrice || trade.entryPrice,
                    currentPrice
                );
            } else {
                trade.lowestPrice = Math.min(
                    trade.lowestPrice || trade.entryPrice,
                    currentPrice
                );
            }

            // Update in database
            await this.tradeRepository.updateTrade(trade.id, {
                trailingStopPrice: newStopLossPrice,
                highestPrice: trade.highestPrice,
                lowestPrice: trade.lowestPrice,
            });

            // Update Oanda stop loss (live trades only)
            if (
                trade.mode === "live" &&
                !trade.oandaTradeId.startsWith("PAPER_")
            ) {
                try {
                    await oandaClient.modifyTrade(trade.oandaTradeId, {
                        stopLossPrice: newStopLossPrice,
                    });
                    logger.info(
                        `📈 Trailing stop updated on Oanda for ${trade.instrument} (${trade.side}): ${previousStop?.toFixed(5)} → ${newStopLossPrice.toFixed(5)}`
                    );
                } catch (error) {
                    logger.error(
                        `❌ Failed to update trailing stop on Oanda:`,
                        error.message
                    );
                }
            }

            logger.debug(
                `📈 Trailing stop updated for ${trade.instrument} (${trade.side}): ${previousStop?.toFixed(5)} → ${newStopLossPrice.toFixed(5)}`
            );
        }
    }

    // ==================== SOCKET BROADCASTING ====================

    /**
     * Broadcast trade opened event
     */
    broadcastTradeOpened(trade) {
        const event = {
            type: "tradeOpened",
            tradeId: trade.id,
            instrument: trade.instrument,
            side: trade.side,
            units: trade.units,
            entryPrice: trade.entryPrice,
            stopLossPrice: trade.stopLossPrice,
            takeProfitPrice: trade.takeProfitPrice,
            mode: trade.mode,
            timestamp: Date.now(),
        };

        if (this.io) {
            this.io.emit("tradeOpened", event);
            this.io.emit("tradeUpdate", trade);
        }

        this.emit("tradeOpened", trade);

        // Send notifications (async, non-blocking)
        const config = this.configService?.get();
        if (config?.enableEmailAlerts) {
            emailService.sendTradeOpenedAlert(trade, config).catch(() => { });
        }
        if (config?.enableSlackAlerts !== false) {
            slackService.sendTradeAlert(trade, "opened").catch(() => { });
        }
    }

    /**
     * Broadcast trade closed event
     */
    broadcastTradeClosed(trade) {
        const event = {
            type: "tradeClosed",
            tradeId: trade.id,
            instrument: trade.instrument,
            exitPrice: trade.exitPrice,
            pnlAud: trade.pnlAud,
            pnlPips: trade.pnlPips,
            exitReason: trade.exitReason,
            mode: trade.mode,
            timestamp: Date.now(),
        };

        if (this.io) {
            this.io.emit("tradeClosed", event);
            this.io.emit("tradeUpdate", trade);
        }

        this.emit("tradeClosed", trade);

        // Send notifications (async, non-blocking)
        const config = this.configService?.get();
        if (config?.enableEmailAlerts) {
            emailService.sendTradeClosedAlert(trade, config).catch(() => { });
        }
        if (config?.enableSlackAlerts !== false) {
            slackService.sendTradeAlert(trade, "closed").catch(() => { });
        }
    }

    // ==================== PUBLIC METHODS ====================

    /**
     * Manually close a trade
     * Accepts either the internal UUID or Oanda trade ID
     */
    async forceCloseTrade(tradeId) {
        // First try lookup by UUID (engine-created trades)
        let trade = this.openTrades.get(tradeId);

        // If not found, try lookup by oandaTradeId (portfolio trades)
        if (!trade) {
            for (const [, t] of this.openTrades) {
                if (t.oandaTradeId === tradeId || t.oandaTradeId === String(tradeId)) {
                    trade = t;
                    break;
                }
            }
        }

        if (!trade) {
            throw new Error(`Trade ${tradeId} not found`);
        }

        const priceData = this.dataService.getCurrentPrice(trade.instrument);
        if (!priceData) {
            throw new Error(`No price data for ${trade.instrument}`);
        }

        await this.executeExit(trade, priceData.price, "MANUAL");
    }

    /**
     * Get engine status
     */
    getStatus() {
        const config = this.configService?.get() || {};

        return {
            isRunning: this.isRunning,
            tradingEnabled: config.enableTrading,
            tradingMode: config.tradingMode || "live",
            openPositions: this.openTrades.size,
            maxPositions: config.maxOpenPositions,
            stats: this.stats,
            openTrades: Array.from(this.openTrades.values()).map((t) => ({
                id: t.id,
                instrument: t.instrument,
                side: t.side,
                units: t.units,
                entryPrice: t.entryPrice,
                stopLossPrice: t.stopLossPrice,
                entryTime: t.entryTime,
                mode: t.mode,
            })),
        };
    }

    /**
     * Get open trades
     */
    getOpenTrades() {
        return Array.from(this.openTrades.values());
    }

    /**
     * Reset engine statistics
     */
    resetStats() {
        this.stats = {
            tradesExecuted: 0,
            tradesClosed: 0,
            signalsReceived: 0,
            signalsRejected: 0,
            errors: 0,
            lastSignalTime: null,
            lastTradeTime: null,
        };
        logger.info("📊 Trading engine stats reset");
    }
}

module.exports = LiveTradingEngine;
