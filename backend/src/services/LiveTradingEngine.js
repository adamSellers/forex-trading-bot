// backend/src/services/LiveTradingEngine.js - Forex Live Trading Engine
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const oandaClient = require("./Oandaclient");
const emailService = require("./emailService");
const {
    computeConfigHash,
    normalizeTradingConfig,
} = require("../config/tradingConfig");
const TradeReconciliationService = require("./tradeReconciliationService");
const {
    ENTRY_REJECTION_CODES,
    ENTRY_DECISION_STAGES,
    ENTRY_DECISION_OUTCOMES,
} = require("../constants/entryDecisionCodes");

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
        this.entryDecisionRepository = null;

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
        this.tradeReconciliation = new TradeReconciliationService();

        logger.info("⚙️ LiveTradingEngine v1.0 initialized");
    }

    /**
     * Initialize with dependencies
     */
    init(
        configService,
        dataService,
        tradeRepository,
        signalGenerator,
        io,
        entryDecisionRepository = null
    ) {
        this.configService = configService;
        this.dataService = dataService;
        this.tradeRepository = tradeRepository;
        this.signalGenerator = signalGenerator;
        this.io = io;
        this.entryDecisionRepository = entryDecisionRepository;

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
            const dbTrades = await this.tradeRepository.getOpenTrades();

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
        const fallback = this.getFallbackCloseResolution(trade);

        try {
            // Get trade details from Oanda to determine exit price and reason
            const tradeDetails = await oandaClient.getTrade(trade.oandaTradeId);
            const closeContext = this.tradeReconciliation.resolveExternalClose({
                localTrade: trade,
                tradeDetails,
                fallbackExitPrice: fallback.exitPrice,
                fallbackPriceSource: fallback.closePriceSource,
            });
            await this.closeTrade(
                trade.id,
                closeContext.exitPrice,
                closeContext.exitReason,
                closeContext
            );
        } catch (error) {
            // Trade might not exist anymore, mark as closed with unknown reason
            logger.warn(
                `⚠️ Could not get details for externally closed trade ${trade.id}`
            );
            const closeContext = this.tradeReconciliation.resolveExternalClose({
                localTrade: trade,
                tradeDetails: null,
                fallbackExitPrice: fallback.exitPrice,
                fallbackPriceSource: fallback.closePriceSource,
                lookupError: error,
            });
            await this.closeTrade(
                trade.id,
                closeContext.exitPrice,
                closeContext.exitReason,
                closeContext
            );
        }
    }

    /**
     * Determine exit reason from Oanda trade details
     * Checks if stop loss, take profit, or trailing stop orders were filled
     */
    determineExitReason(tradeDetails, trade = null) {
        return this.tradeReconciliation.determineExitReason(
            tradeDetails,
            trade,
            "EXTERNAL"
        ).exitReason;
    }

    emitEngineTelemetry(type, payload = {}) {
        const event = {
            type,
            timestamp: Date.now(),
            ...payload,
        };

        if (this.io) {
            this.io.emit("engineTelemetry", event);
        }

        this.emit("engineTelemetry", event);
        return event;
    }

    buildSignalTelemetry(signal, config = null) {
        return {
            symbol: signal?.symbol || null,
            signal: signal?.signal || null,
            runId: signal?.runId || null,
            selectionId: signal?.selectionId || null,
            mode: signal?.mode || "live",
            strategy: signal?.strategy || config?.strategy || null,
            entryType: signal?.entryType || null,
            entryEnabled:
                signal?.entryEnabled === undefined ? null : signal.entryEnabled === true,
            reasonCode: signal?.reasonCode || null,
            signalClass: signal?.signalClass || null,
            intent: signal?.intent || null,
            setupId: signal?.setupId || null,
            configHash:
                signal?.configHash ||
                config?.configHash ||
                computeConfigHash(config || {}),
            currentPrice: signal?.currentPrice ?? null,
            timesFmAvailable: signal?.timesFm?.available === true,
            timesFmDirection: signal?.timesFm?.direction || null,
            timesFmConfidence: signal?.timesFm?.confidence ?? null,
            timesFmVolatilityRegime: signal?.timesFm?.volatilityRegime || null,
        };
    }

    getTimesFmMode(config = {}) {
        const normalized = String(config?.timesFmMode || "disabled")
            .trim()
            .toLowerCase();
        return ["disabled", "observe", "size", "veto"].includes(normalized)
            ? normalized
            : "disabled";
    }

    getTimesFmPositionSizeMultiplier(signal, config = {}) {
        const mode = this.getTimesFmMode(config);
        if (config?.timesFmEnabled !== true) return 1.0;
        if (mode !== "size" && mode !== "veto") return 1.0;

        const multiplier = Number(signal?.timesFm?.positionSizeMultiplier);
        if (!Number.isFinite(multiplier)) return 1.0;
        return Math.min(1.0, Math.max(0, multiplier));
    }

    shouldTimesFmVeto(signal, config = {}) {
        const mode = this.getTimesFmMode(config);
        if (config?.timesFmEnabled !== true || mode !== "veto") return false;
        if (signal?.signal !== "BUY" && signal?.signal !== "SELL") return false;
        return (
            signal?.timesFm?.available === true &&
            signal?.timesFm?.vetoCandidate === true
        );
    }

    getTimesFmVetoReason(signal) {
        const direction = signal?.timesFm?.direction || "UNKNOWN";
        const confidence = Number(signal?.timesFm?.confidence);
        const confidenceText = Number.isFinite(confidence)
            ? confidence.toFixed(2)
            : "0.00";
        return `TimesFM vetoed ${signal?.signal || "entry"}: ${direction} forecast at confidence ${confidenceText}`;
    }

    shouldTrackEntryDecision(signal) {
        if (!signal || !signal.symbol) return false;
        if (signal.signal !== "BUY" && signal.signal !== "SELL") return false;
        if (signal.entryEnabled === false) return false;
        if (signal.signal === "SELL" && signal.entryType === "EXIT_ONLY") {
            return false;
        }
        return true;
    }

    buildEntryDecisionId(signal, decisionTime) {
        if (signal?.setupId && Number.isFinite(decisionTime)) {
            return `${signal.setupId}:${decisionTime}`;
        }

        return uuidv4();
    }

    buildDecisionContext(signal, config, extras = {}) {
        const priceData = extras.priceData || this.dataService?.getCurrentPrice?.(signal.symbol);
        const priceAgeMs = Number.isFinite(priceData?.timestamp)
            ? Math.max(0, Date.now() - priceData.timestamp)
            : null;
        const configSnapshot = normalizeTradingConfig(config || {});
        delete configSnapshot.configHash;
        const decisionTime = extras.decisionTime || Date.now();

        return {
            decisionId:
                extras.decisionId ||
                this.buildEntryDecisionId(signal, decisionTime),
            setupId: signal?.setupId || null,
            signalCandleTime: signal?.signalCandleTime ?? null,
            decisionTime,
            instrument: signal?.symbol,
            side: signal?.signal === "SELL" ? "SELL" : "BUY",
            signal: signal?.signal,
            entryType: signal?.entryType || null,
            configHash:
                signal?.configHash ||
                config?.configHash ||
                computeConfigHash(config || {}),
            configSnapshot,
            outcome: ENTRY_DECISION_OUTCOMES.PENDING,
            stage: ENTRY_DECISION_STAGES.RECEIVED,
            spreadPips:
                extras.spreadPips !== undefined
                    ? extras.spreadPips
                    : Number(priceData?.spread),
            priceAgeMs:
                extras.priceAgeMs !== undefined ? extras.priceAgeMs : priceAgeMs,
            openPositions:
                extras.openPositions !== undefined
                    ? extras.openPositions
                    : this.openTrades.size,
            projectedExposure:
                extras.projectedExposure !== undefined
                    ? extras.projectedExposure
                    : null,
            signalStrength:
                extras.signalStrength !== undefined
                    ? extras.signalStrength
                    : signal?.strength ?? null,
            adx:
                extras.adx !== undefined
                    ? extras.adx
                    : signal?.trend?.adx ?? signal?.strength ?? null,
            rsi:
                extras.rsi !== undefined
                    ? extras.rsi
                    : signal?.trend?.rsi ?? signal?.data?.rsi ?? null,
            atrPips:
                extras.atrPips !== undefined
                    ? extras.atrPips
                    : signal?.atrPips ?? signal?.trend?.atrPips ?? null,
            tradeId: extras.tradeId || null,
            runId: signal?.runId || extras.runId || null,
            selectionId: signal?.selectionId || extras.selectionId || null,
            mode: signal?.mode || extras.mode || "live",
            strategy: signal?.strategy || extras.strategy || config?.strategy || null,
            timesFmContext: extras.timesFmContext || signal?.timesFm || null,
        };
    }

    async createEntryDecision(signal, config, extras = {}) {
        if (!this.entryDecisionRepository || !this.shouldTrackEntryDecision(signal)) {
            return null;
        }

        const decision = this.buildDecisionContext(signal, config, extras);
        await this.entryDecisionRepository.save(decision);
        return decision;
    }

    async updateEntryDecision(decisionId, updates = {}) {
        if (!this.entryDecisionRepository || !decisionId) return;
        await this.entryDecisionRepository.updateDecision(decisionId, updates);
    }

    async rejectEntryDecision(decisionId, updates = {}) {
        if (!decisionId) return;
        await this.updateEntryDecision(decisionId, {
            stage: ENTRY_DECISION_STAGES.REJECTED,
            outcome: ENTRY_DECISION_OUTCOMES.REJECTED,
            ...updates,
        });
    }

    getFallbackCloseResolution(trade) {
        const activeStopPrice =
            trade.trailingStopPrice ||
            trade.stopLossPrice ||
            trade.takeProfitPrice ||
            null;
        if (Number.isFinite(activeStopPrice)) {
            return {
                exitPrice: activeStopPrice,
                closePriceSource: "ACTIVE_STOP_FALLBACK",
            };
        }

        const livePrice =
            this.dataService?.getCurrentPrice?.(trade.instrument)?.price ?? null;
        if (Number.isFinite(livePrice)) {
            return {
                exitPrice: livePrice,
                closePriceSource: "LOCAL_MARKET_FALLBACK",
            };
        }

        return {
            exitPrice: trade.entryPrice,
            closePriceSource: "ENTRY_PRICE_FALLBACK",
        };
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
        this.emitEngineTelemetry(
            "signalReceived",
            this.buildSignalTelemetry(signal)
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
        if (signal?.mode && signal.mode !== "live") {
            return;
        }

        const {
            symbol,
            signal: signalType,
            strength,
            entryType,
            currentPrice,
            atr,
            atrPips,
            runId,
        } = signal;
        const entryEnabled = signal.entryEnabled !== false;

        // Get current config
        const config = this.configService.get();
        const entryDecision = await this.createEntryDecision(signal, config);
        const decisionId = entryDecision?.decisionId || null;

        const ownedTrade = runId
            ? this.getOpenTradeByInstrument(symbol, { ownerRunId: runId })
            : this.getOpenTradeByInstrument(symbol);

        if (signalType === "BUY") {
            // Signal reversal: Close existing SHORT position before opening LONG
            if (ownedTrade && ownedTrade.side === "SELL") {
                logger.info(
                    `[${symbol}] Signal reversal: Closing SHORT position due to BUY signal`
                );
                await this.executeExit(
                    ownedTrade,
                    currentPrice,
                    "SIGNAL_REVERSAL"
                );
            }

            const remainingTrade = this.getOpenTradeByInstrument(symbol);
            if (remainingTrade) {
                // Already in a LONG position, skip
                logger.debug(
                    `⏸️ Skipping BUY for ${symbol} - already in position`
                );
                this.stats.signalsRejected++;
                this.emitEngineTelemetry("validationRejected", {
                    ...this.buildSignalTelemetry(signal, config),
                    reason: "Already in position for this instrument",
                });
                await this.rejectEntryDecision(decisionId, {
                    rejectionCode: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                    rejectionReason: "Already in position for this instrument",
                    openPositions: this.openTrades.size,
                });
                return;
            }

            if (!entryEnabled) {
                return;
            }

            // Validate and execute entry
            const validation = await this.validateEntry(signal, config);
            if (!validation.valid) {
                logger.info(
                    `⏸️ Entry rejected for ${symbol}: ${validation.reason}`
                );
                this.stats.signalsRejected++;
                this.emitEngineTelemetry("validationRejected", {
                    ...this.buildSignalTelemetry(signal, config),
                    reason: validation.reason,
                });
                this.emit("entryRejected", {
                    signal,
                    reason: validation.reason,
                });
                await this.rejectEntryDecision(decisionId, {
                    rejectionCode:
                        validation.code || ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                    rejectionReason: validation.reason,
                    ...validation.context,
                });
                return;
            }

            await this.updateEntryDecision(decisionId, {
                stage: ENTRY_DECISION_STAGES.VALIDATED,
                ...validation.context,
            });
            await this.executeEntry(signal, config, decisionId, validation.context);
        } else if (signalType === "SELL") {
            // Check if we have an open position for this instrument
            if (ownedTrade) {
                // Close existing LONG position if we get a SELL signal
                if (ownedTrade.side === "BUY") {
                    await this.executeExit(
                        ownedTrade,
                        currentPrice,
                        "SIGNAL_REVERSAL"
                    );
                }
            }

            // Execute SHORT entry when the generator marks it as actionable.
            // validateEntry will enforce the live shorting toggle.
            if (signal.entryType !== "EXIT_ONLY" && entryEnabled) {
                const remainingTrade = this.getOpenTradeByInstrument(symbol);
                if (remainingTrade && remainingTrade.side === "SELL") {
                    logger.debug(
                        `⏸️ Skipping SELL for ${symbol} - already in short position`
                    );
                    this.stats.signalsRejected++;
                    this.emitEngineTelemetry("validationRejected", {
                        ...this.buildSignalTelemetry(signal, config),
                        reason: "Already in position for this instrument",
                    });
                    await this.rejectEntryDecision(decisionId, {
                        rejectionCode: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                        rejectionReason: "Already in position for this instrument",
                        openPositions: this.openTrades.size,
                    });
                    return;
                }

                if (remainingTrade) {
                    logger.debug(
                        `⏸️ Skipping SELL for ${symbol} - already in position`
                    );
                    this.stats.signalsRejected++;
                    this.emitEngineTelemetry("validationRejected", {
                        ...this.buildSignalTelemetry(signal, config),
                        reason: "Already in position for this instrument",
                    });
                    await this.rejectEntryDecision(decisionId, {
                        rejectionCode: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                        rejectionReason: "Already in position for this instrument",
                        openPositions: this.openTrades.size,
                    });
                    return;
                }

                // Validate and execute entry
                const validation = await this.validateEntry(signal, config);
                if (!validation.valid) {
                    logger.info(
                        `⏸️ Short Entry rejected for ${symbol}: ${validation.reason}`
                    );
                    this.stats.signalsRejected++;
                    this.emitEngineTelemetry("validationRejected", {
                        ...this.buildSignalTelemetry(signal, config),
                        reason: validation.reason,
                    });
                    this.emit("entryRejected", {
                        signal,
                        reason: validation.reason,
                    });
                    await this.rejectEntryDecision(decisionId, {
                        rejectionCode:
                            validation.code || ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                        rejectionReason: validation.reason,
                        ...validation.context,
                    });
                    return;
                }

                logger.info(
                    `📉 Short Entry approved for ${symbol} | Type: ${signal.entryType || "FRESH_FLIP"}`
                );
                await this.updateEntryDecision(decisionId, {
                    stage: ENTRY_DECISION_STAGES.VALIDATED,
                    ...validation.context,
                });
                await this.executeEntry(signal, config, decisionId, validation.context);
            } else if (config.enableShorting && signal.entryType === "EXIT_ONLY") {
                logger.info(
                    `⏸️ Short Entry skipped for ${symbol} - signal filtered at generator (pending continuation)`
                );
            }
        }
        // HOLD signals are ignored
    }

    /**
     * Get open trade by instrument
     */
    getOpenTradeByInstrument(instrument, filters = {}) {
        const { ownerRunId = null } = filters;

        for (const [id, trade] of this.openTrades) {
            if (
                trade.instrument === instrument &&
                trade.isOpen &&
                (!ownerRunId || trade.ownerRunId === ownerRunId)
            ) {
                return trade;
            }
        }
        return null;
    }

    // ==================== ENTRY VALIDATION ====================

    /**
     * Validate entry conditions
     */
    async validateEntry(signal, config) {
        const priceData = this.dataService?.getCurrentPrice?.(signal.symbol);
        const priceAgeMs = Number.isFinite(priceData?.timestamp)
            ? Date.now() - priceData.timestamp
            : null;
        const spreadPips = Number(priceData?.spread);
        const baseContext = {
            spreadPips: Number.isFinite(spreadPips) ? spreadPips : null,
            priceAgeMs: Number.isFinite(priceAgeMs) ? priceAgeMs : null,
            openPositions: this.openTrades.size,
            projectedExposure: null,
        };

        // 1. Trading must be enabled
        if (!config.enableTrading) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.TRADING_DISABLED,
                reason: "Trading is disabled",
                context: baseContext,
            };
        }

        // 2. Check instrument is in active list
        if (!config.assets.includes(signal.symbol)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.INACTIVE_ASSET,
                reason: `Instrument ${signal.symbol} not in active list`,
                context: baseContext,
            };
        }

        // 3. Live price must be available and fresh
        if (!priceData) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.NO_LIVE_PRICE,
                reason: `No live price data for ${signal.symbol}`,
                context: baseContext,
            };
        }

        if (priceData.tradeable === false) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.NOT_TRADEABLE,
                reason: `${signal.symbol} is not currently tradeable`,
                context: baseContext,
            };
        }

        const maxPriceAgeMs = Number(config.maxPriceAgeMs);
        if (
            Number.isFinite(maxPriceAgeMs) &&
            maxPriceAgeMs > 0 &&
            Number.isFinite(priceAgeMs) &&
            priceAgeMs > maxPriceAgeMs
        ) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.STALE_PRICE,
                reason: `Price data stale (${priceAgeMs}ms > ${maxPriceAgeMs}ms)`,
                context: baseContext,
            };
        }

        const maxSpreadPips = Number(config.maxSpreadPips);
        if (
            Number.isFinite(maxSpreadPips) &&
            maxSpreadPips > 0 &&
            Number.isFinite(spreadPips) &&
            spreadPips > maxSpreadPips
        ) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.SPREAD_TOO_WIDE,
                reason: `Spread too wide (${spreadPips.toFixed(1)} > ${maxSpreadPips.toFixed(1)} pips)`,
                context: baseContext,
            };
        }

        // 4. Check max open positions
        const openCount = this.openTrades.size;
        if (openCount >= config.maxOpenPositions) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.MAX_POSITIONS,
                reason: `Max positions reached (${openCount}/${config.maxOpenPositions})`,
                context: {
                    ...baseContext,
                    openPositions: openCount,
                },
            };
        }

        // 5. Not already in a position for this instrument
        if (this.getOpenTradeByInstrument(signal.symbol)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                reason: "Already in position for this instrument",
                context: baseContext,
            };
        }

        // 6. Check minimum ADX strength
        if (config.enableAdxFilter !== false && signal.strength < config.minAdx) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.ADX_TOO_LOW,
                reason: `ADX too low (${signal.strength?.toFixed(1)} < ${config.minAdx
                    })`,
                context: baseContext,
            };
        }

        // 7. Session filter check (entries only during configured market sessions)
        if (config.enableSessionFilter) {
            const activeSessions = Array.isArray(config.activeSessions)
                ? config.activeSessions
                : [];

            if (activeSessions.length === 0) {
                return {
                    valid: false,
                    code: ENTRY_REJECTION_CODES.OUTSIDE_SESSION,
                    reason: "Session filter enabled but no active sessions configured",
                    context: baseContext,
                };
            }

            const hourUtc = this.getCurrentUtcHour();
            if (!this.isWithinActiveSession(hourUtc, activeSessions)) {
                return {
                    valid: false,
                    code: ENTRY_REJECTION_CODES.OUTSIDE_SESSION,
                    reason: `Outside active sessions (${activeSessions.join(", ")}) at ${hourUtc}:00 UTC`,
                    context: baseContext,
                };
            }
        }

        // 8. Signal direction check
        if (signal.signal !== "BUY" && signal.signal !== "SELL") {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                reason: "Invalid signal type",
                context: baseContext,
            };
        }

        // 9. Shorting enabled check
        if (signal.signal === "SELL" && !config.enableShorting) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.SHORT_DISABLED,
                reason: "Short selling is disabled",
                context: baseContext,
            };
        }

        if (this.shouldTimesFmVeto(signal, config)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.TIMESFM_VETO,
                reason: this.getTimesFmVetoReason(signal),
                context: baseContext,
            };
        }

        // 10. Max portfolio exposure check (margin used / balance), including projected new trade margin
        const maxPortfolioExposure = Number(config.maxPortfolioExposure);
        if (Number.isFinite(maxPortfolioExposure) && maxPortfolioExposure > 0) {
            const projectedMargin = await this.estimateEntryMargin(signal, config);
            if (!Number.isFinite(projectedMargin) || projectedMargin <= 0) {
                return {
                    valid: false,
                    code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                    reason: "Unable to validate projected entry margin",
                    context: baseContext,
                };
            }
            const exposureCheck = await this.checkPortfolioExposure(
                maxPortfolioExposure,
                projectedMargin
            );
            if (!exposureCheck.valid) {
                return {
                    valid: false,
                    code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                    reason: exposureCheck.reason,
                    context: {
                        ...baseContext,
                        projectedExposure: exposureCheck.projectedExposure ?? null,
                    },
                };
            }

            baseContext.projectedExposure =
                exposureCheck.projectedExposure ?? null;
        }

        return { valid: true, context: baseContext };
    }

    /**
     * Estimate margin that would be used by a new entry using current risk settings.
     */
    async estimateEntryMargin(signal, config) {
        const { stopLossPips } = this.calculateStopLoss(signal, config);
        const units = await this.calculatePositionSize(
            signal.symbol,
            stopLossPips,
            signal.currentPrice,
            config,
            signal.entryType,
            signal
        );

        if (!Number.isFinite(units) || units <= 0) return 0;
        const leverage = Number(config.leverage) || 10;
        return (units * signal.currentPrice) / leverage;
    }

    /**
     * Get current UTC hour [0-23]
     */
    getCurrentUtcHour() {
        return new Date().getUTCHours();
    }

    /**
     * Check if a UTC hour falls inside any configured trading session
     */
    isWithinActiveSession(hourUtc, activeSessions) {
        const sessionHours = {
            sydney: { start: 21, end: 6 },
            tokyo: { start: 0, end: 9 },
            london: { start: 7, end: 16 },
            newyork: { start: 12, end: 21 },
        };

        return activeSessions.some((sessionName) => {
            const session = sessionHours[sessionName];
            if (!session) return false;

            if (session.start > session.end) {
                return hourUtc >= session.start || hourUtc < session.end;
            }

            return hourUtc >= session.start && hourUtc < session.end;
        });
    }

    /**
     * Validate current account exposure against configured max exposure
     */
    async checkPortfolioExposure(maxPortfolioExposure, projectedMarginUsed = 0) {
        try {
            const accountSummary = await oandaClient.getAccountSummary();
            const balance = parseFloat(accountSummary?.account?.balance);
            const marginUsedRaw = accountSummary?.account?.marginUsed;
            const marginAvailableRaw = accountSummary?.account?.marginAvailable;

            if (!Number.isFinite(balance) || balance <= 0) {
                return {
                    valid: false,
                    reason: "Unable to validate exposure: invalid account balance",
                };
            }

            let marginUsed = parseFloat(marginUsedRaw);
            if (!Number.isFinite(marginUsed) && Number.isFinite(parseFloat(marginAvailableRaw))) {
                marginUsed = balance - parseFloat(marginAvailableRaw);
            }
            if (!Number.isFinite(marginUsed)) {
                return {
                    valid: false,
                    reason: "Unable to validate exposure: margin data unavailable",
                };
            }

            marginUsed = Math.max(0, marginUsed);
            const currentExposure = marginUsed / balance;
            const projectedExposure =
                (marginUsed + Math.max(0, projectedMarginUsed || 0)) / balance;
            if (projectedExposure >= maxPortfolioExposure) {
                return {
                    valid: false,
                    reason: `Portfolio exposure limit reached (current ${(currentExposure * 100).toFixed(1)}%, projected ${(projectedExposure * 100).toFixed(1)}%, max ${(maxPortfolioExposure * 100).toFixed(1)}%)`,
                    currentExposure,
                    projectedExposure,
                };
            }

            return {
                valid: true,
                currentExposure,
                projectedExposure,
            };
        } catch (error) {
            logger.error(
                `❌ Failed to validate portfolio exposure: ${error.message}`
            );
            return {
                valid: false,
                reason: "Unable to validate portfolio exposure",
                projectedExposure: null,
            };
        }
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
        config,
        entryType = null,
        signal = null
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
        let units;

        if (config.positionSizeMethod === "FIXED") {
            units = config.fixedPositionUnits || 1000;
        } else {
            // CRITICAL: Use marginAvailable (free capital) not total balance
            // This prevents opening positions when capital is already committed
            const maxCapital = config.maxCapitalAtRisk || 500;

            // Apply margin buffer (default 20%) to avoid cutting it too close
            const marginBuffer = config.marginBuffer || 0.20;
            const safeMarginAvailable = marginAvailable * (1 - marginBuffer);

            // effectiveBalance = min(safeMarginAvailable, maxCapitalAtRisk)
            const effectiveBalance = maxCapital > 0
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
            const freshFlipRiskMultiplier = Number.isFinite(
                Number(config.freshFlipRiskMultiplier)
            )
                ? Number(config.freshFlipRiskMultiplier)
                : 1;
            const riskPercent =
                entryType === "FRESH_FLIP"
                    ? (config.riskPerTrade || 0.02) * freshFlipRiskMultiplier
                    : config.riskPerTrade || 0.02;
            const riskAmount = effectiveBalance * riskPercent;

            // Calculate pip value in account currency (AUD)
            // This requires knowing the AUD_USD rate for proper conversion
            const pipValue = oandaClient.getPipValue(instrument);
            let pipValueInAUD;

            try {
                // Get AUD_USD rate for conversion to account currency
                let audUsdRate;
                if (instrument === "AUD_USD") {
                    audUsdRate = currentPrice;
                } else {
                    const pricingData = await oandaClient.getPricing(["AUD_USD"]);
                    audUsdRate = parseFloat(pricingData.prices[0].closeoutAsk);
                }

                // Calculate pip value in AUD based on quote currency
                // For USD-quoted pairs (EUR_USD, AUD_USD): pip P&L is in USD, convert to AUD
                // For JPY-quoted pairs (USD_JPY): pip P&L is in JPY, convert via USD to AUD
                if (instrument.endsWith("_USD")) {
                    // USD is quote currency: 1 pip = 0.0001 USD per unit
                    pipValueInAUD = pipValue / audUsdRate;
                } else if (instrument.endsWith("_JPY")) {
                    // JPY is quote currency: 1 pip = 0.01 JPY per unit
                    // Convert JPY to USD first, then USD to AUD
                    pipValueInAUD = (pipValue / currentPrice) / audUsdRate;
                } else {
                    // Fallback for other quote currencies (GBP, CHF, etc.)
                    // Would need specific conversion rates - use approximation
                    logger.warn(`⚠️ Unsupported quote currency for ${instrument}, using approximation`);
                    pipValueInAUD = pipValue / audUsdRate;
                }

                logger.info(`📊 Position sizing: ${instrument} | pipValue=${pipValue} | audUsdRate=${audUsdRate.toFixed(5)} | pipValueInAUD=${pipValueInAUD.toFixed(8)}`);
            } catch (error) {
                logger.error(`❌ Failed to calculate pip value in AUD: ${error.message}`);
                return 0;
            }

            // Position size = Risk Amount / (Stop Loss Pips × Pip Value in Account Currency)
            units = Math.floor(riskAmount / (stopLossPips * pipValueInAUD));

            // Apply leverage limits based on available margin (not total balance)
            const maxLeverage = config.leverage || 10;
            const maxUnitsFromLeverage = Math.floor(
                (safeMarginAvailable * maxLeverage) / currentPrice
            );
            units = Math.min(units, maxUnitsFromLeverage);
        }

        const timesFmMultiplier = this.getTimesFmPositionSizeMultiplier(
            signal,
            config
        );
        units = Math.floor(units * timesFmMultiplier);

        if (timesFmMultiplier < 1) {
            logger.info(
                `🧠 TimesFM size adjustment: ${instrument} | multiplier=${timesFmMultiplier.toFixed(2)} | adjustedUnits=${units}`
            );
        }

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
    calculateStopLoss(signal, config, entryPrice = null) {
        const { atrPips } = signal;
        const instrument = signal.symbol;
        const currentPrice = Number.isFinite(entryPrice)
            ? entryPrice
            : signal.currentPrice;
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
     * Get mid price from Oanda pricing payload for a single instrument.
     */
    async getMidPrice(instrument) {
        const pricing = await oandaClient.getPricing([instrument]);
        const price = pricing?.prices?.[0];
        if (!price) {
            throw new Error(`No pricing data for ${instrument}`);
        }

        const bid = parseFloat(price.closeoutBid || price.bids?.[0]?.price);
        const ask = parseFloat(price.closeoutAsk || price.asks?.[0]?.price);

        if (Number.isFinite(bid) && Number.isFinite(ask)) {
            return (bid + ask) / 2;
        }
        if (Number.isFinite(ask)) return ask;
        if (Number.isFinite(bid)) return bid;

        throw new Error(`Invalid pricing payload for ${instrument}`);
    }

    /**
     * Convert from one currency to another using direct, inverse, or USD bridge.
     *
     * Returns amount of `toCurrency` per 1 `fromCurrency`.
     */
    async getConversionRate(
        fromCurrency,
        toCurrency,
        { instrument = null, entryPrice = null } = {}
    ) {
        if (!fromCurrency || !toCurrency) {
            throw new Error("Missing currency for conversion");
        }
        if (fromCurrency === toCurrency) return 1;

        const direct = `${fromCurrency}_${toCurrency}`;
        const inverse = `${toCurrency}_${fromCurrency}`;

        if (
            instrument === direct &&
            Number.isFinite(entryPrice) &&
            entryPrice > 0
        ) {
            return entryPrice;
        }
        if (
            instrument === inverse &&
            Number.isFinite(entryPrice) &&
            entryPrice > 0
        ) {
            return 1 / entryPrice;
        }

        try {
            return await this.getMidPrice(direct);
        } catch {
            // Try inverse next
        }

        try {
            const inverseRate = await this.getMidPrice(inverse);
            if (inverseRate > 0) return 1 / inverseRate;
        } catch {
            // Try bridge next
        }

        if (fromCurrency !== "USD" && toCurrency !== "USD") {
            const fromToUsd = await this.getConversionRate(fromCurrency, "USD", {
                instrument,
                entryPrice,
            });
            const usdToTarget = await this.getConversionRate("USD", toCurrency, {
                instrument,
                entryPrice,
            });
            return fromToUsd * usdToTarget;
        }

        throw new Error(
            `Unable to convert ${fromCurrency} to ${toCurrency}: no rate path`
        );
    }

    /**
     * Calculate take profit price based on percentage of margin used
     *
     * Target profit = marginUsed × takeProfitPercent (default 6%)
     *
     * @param {object} signal - Signal data with currentPrice
     * @param {object} config - Trading config
     * @param {number} units - Position size in units
     * @param {number} marginUsed - Margin used for this trade
     * @param {number} entryPrice - Actual entry price (may differ from signal price)
     */
    async calculateTakeProfit(signal, config, units, marginUsed, entryPrice = null) {
        if (!config.enableTakeProfit) return null;
        if (!units || units <= 0) return null;
        if (!marginUsed || marginUsed <= 0) return null;

        const price = entryPrice || signal.currentPrice;
        const instrument = signal.symbol;
        const pipValue = oandaClient.getPipValue(instrument);
        const [, quoteCurrency] = instrument.split("_");

        // Calculate target profit as percentage of margin used (not account balance)
        const takeProfitPercent = config.takeProfitPercent || 0.06; // Default 6%
        const targetProfitAccount = marginUsed * takeProfitPercent;

        let accountCurrency = "AUD";
        let quoteToAccountRate = 1;
        try {
            const accountSummary = await oandaClient.getAccountSummary();
            accountCurrency = accountSummary?.account?.currency || "AUD";
            quoteToAccountRate = await this.getConversionRate(
                quoteCurrency,
                accountCurrency,
                { instrument, entryPrice: price }
            );
        } catch (error) {
            logger.warn(
                `⚠️ TP conversion fallback for ${instrument}: ${error.message}`
            );
            quoteToAccountRate = 1;
        }

        // P/L in account currency = units * priceChange(quote) * quoteToAccountRate
        const denominator = units * quoteToAccountRate;
        if (!Number.isFinite(denominator) || denominator <= 0) return null;
        const priceChange = targetProfitAccount / denominator;

        // For BUY trades, take profit is above entry
        let takeProfitPrice = price + priceChange;

        // For SELL trades, take profit is below entry
        if (signal.signal === "SELL") {
            takeProfitPrice = price - priceChange;
        }

        const takeProfitPips = priceChange / pipValue;

        logger.info(
            `📊 TP Calculation: margin=${marginUsed.toFixed(2)} ${accountCurrency} × ${(takeProfitPercent * 100).toFixed(0)}% = ${targetProfitAccount.toFixed(2)} ${accountCurrency} target | ${takeProfitPips.toFixed(1)} pips`
        );

        return {
            takeProfitPips,
            takeProfitPrice: parseFloat(takeProfitPrice.toFixed(5)),
            targetProfitAud: targetProfitAccount,
            targetProfitAccount,
            accountCurrency,
        };
    }

    // ==================== TRADE EXECUTION ====================

    /**
     * Execute a trade entry
     */
    async executeEntry(
        signal,
        config,
        decisionId = null,
        validationContext = {}
    ) {
        const { symbol, currentPrice, strength, entryType, atr, atrPips } =
            signal;

        logger.info(`🎯 Executing entry for ${symbol} at ${currentPrice}`);

        // Calculate initial stop loss from signal price (will be corrected to fill price after execution)
        const { stopLossPips, stopLossPrice: initialStopLossPrice } = this.calculateStopLoss(
            signal,
            config
        );
        const configHash =
            signal.configHash ||
            config.configHash ||
            computeConfigHash(config);


        // Calculate position size
        const units = await this.calculatePositionSize(
            symbol,
            stopLossPips,
            currentPrice,
            config,
            entryType,
            signal
        );
        if (units === 0) {
            logger.warn(
                `⚠️ Position size calculation returned 0 units - skipping trade`
            );
            this.emitEngineTelemetry("validationRejected", {
                ...this.buildSignalTelemetry(signal, config),
                reason: "Position size too small",
            });
            this.emit("entryRejected", {
                signal,
                reason: "Position size too small",
            });
            await this.rejectEntryDecision(decisionId, {
                rejectionCode: ENTRY_REJECTION_CODES.POSITION_SIZE_TOO_SMALL,
                rejectionReason: "Position size too small",
                ...validationContext,
            });
            return;
        }
        await this.updateEntryDecision(decisionId, {
            stage: ENTRY_DECISION_STAGES.SIZED,
            ...validationContext,
        });
        this.emitEngineTelemetry("sizingComputed", {
            ...this.buildSignalTelemetry(signal, config),
            stopLossPips,
            initialStopLossPrice,
            units,
        });

        // Note: Take profit will be calculated AFTER order fills using actual margin from Oanda

        // Calculate trailing stop distance (if enabled)
        let trailingStopDistance = null;
        if (config.enableTrailingStops) {
            const pipValue = oandaClient.getPipValue(symbol);
            trailingStopDistance = (config.trailingStopPips || 25) * pipValue;
        }

        // Get current spread for logging
        const priceData = this.dataService.getCurrentPrice(symbol);
        const spreadPips = priceData?.spread || 0;

        // Live trading - execute via Oanda (without TP initially)
        try {
            // For SELL signals, negate units to open SHORT position in Oanda
            // Oanda API: positive units = BUY, negative units = SELL
            const orderUnits = signal.signal === "SELL" ? -units : units;
            await this.updateEntryDecision(decisionId, {
                stage: ENTRY_DECISION_STAGES.ORDER_SUBMITTED,
                spreadPips,
                ...validationContext,
            });
            this.emitEngineTelemetry("orderSubmitted", {
                ...this.buildSignalTelemetry(signal, config),
                units,
                orderUnits,
                stopLossPrice: initialStopLossPrice,
            });

            const orderResult = await oandaClient.placeMarketOrder(
                symbol,
                orderUnits,
                {
                    stopLossPrice: initialStopLossPrice,
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
                await this.rejectEntryDecision(decisionId, {
                    rejectionCode: ENTRY_REJECTION_CODES.ORDER_SUBMIT_FAILED,
                    rejectionReason: "No fill transaction",
                    spreadPips,
                    ...validationContext,
                });
                return;
            }

            const oandaTradeId = fillTransaction.tradeOpened?.tradeID;
            const fillPrice = parseFloat(fillTransaction.price);
            let stopLossPrice = initialStopLossPrice;

            // Align SL to actual fill so true stop distance and risk match sizing assumptions.
            const fillBasedStop = this.calculateStopLoss(
                signal,
                config,
                fillPrice
            );
            stopLossPrice = fillBasedStop.stopLossPrice;

            if (oandaTradeId && Number.isFinite(stopLossPrice)) {
                try {
                    await oandaClient.modifyTrade(oandaTradeId, {
                        stopLossPrice,
                    });
                } catch (slError) {
                    logger.warn(
                        `⚠️ Failed to align stop loss to fill price: ${slError.message}`
                    );
                }
            }

            // Get actual margin from Oanda response
            const marginUsed = parseFloat(
                fillTransaction.tradeOpened?.initialMarginRequired || 0
            );

            // Calculate take profit based on actual margin used
            let takeProfit = null;
            let takeProfitPrice = null;

            if (marginUsed > 0 && config.enableTakeProfit) {
                takeProfit = await this.calculateTakeProfit(
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
                highestPrice: signal.signal === "BUY" ? fillPrice : null,
                lowestPrice: signal.signal === "SELL" ? fillPrice : null,
                trailingStopPips: config.trailingStopPips,
                breakevenHit: false,
                activeStopType: "INITIAL_STOP",
                leverageUsed: config.leverage || 10,
                marginUsedAud: marginUsed || (units * fillPrice) / (config.leverage || 10),
                spreadPips,
                entryTime: Date.now(),
                lastBrokerSyncAt: Date.now(),
                reconciliationStatus: "OPEN",
                configHash,
                mode: signal.mode || "live",
                runId: signal.runId || null,
                ownerRunId: signal.runId || null,
                selectionId: signal.selectionId || null,
                strategy: signal.strategy || config.strategy || null,
                isOpen: true,
            };

            // Save to database
            await this.tradeRepository.save(trade);

            await this.updateEntryDecision(decisionId, {
                stage: ENTRY_DECISION_STAGES.FILLED,
                outcome: ENTRY_DECISION_OUTCOMES.FILLED,
                tradeId: trade.id,
                spreadPips,
                ...validationContext,
            });

            // Track in memory
            this.openTrades.set(trade.id, trade);

            // Update stats
            this.stats.tradesExecuted++;
            this.stats.lastTradeTime = Date.now();
            this.emitEngineTelemetry("filled", {
                ...this.buildSignalTelemetry(signal, config),
                tradeId: trade.id,
                oandaTradeId,
                units,
                fillPrice,
                stopLossPrice,
                takeProfitPrice,
                configHash,
            });

            // Broadcast trade event
            this.broadcastTradeOpened(trade);

            const tpInfo = takeProfitPrice
                ? ` | TP: ${takeProfitPrice} ($${takeProfit.targetProfitAud.toFixed(2)})`
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
            await this.rejectEntryDecision(decisionId, {
                rejectionCode: ENTRY_REJECTION_CODES.ORDER_SUBMIT_FAILED,
                rejectionReason: error.message,
                ...validationContext,
            });
            throw error;
        }
    }

    // ==================== TRADE EXIT ====================

    /**
     * Execute a trade exit
     */
    async executeExit(trade, exitPrice, reason) {
        logger.info(
            `🎯 Executing exit for ${trade.instrument} at ${exitPrice} (${reason})`
        );

        let closeContext = {
            exitPrice,
            exitReason: reason,
            closePriceSource: "LOCAL_MARKET_FALLBACK",
            reconciliationStatus: "LOCAL_ONLY",
            brokerExitReason: reason,
            brokerClosedAt: Date.now(),
            lastBrokerSyncAt: Date.now(),
            brokerReconciliationPayload: null,
            activeStopType: trade.activeStopType || null,
        };

        if (trade.oandaTradeId) {
            // Live trading - close via Oanda
            try {
                const closeResult = await oandaClient.closeTrade(
                    trade.oandaTradeId
                );
                closeContext = this.tradeReconciliation.resolveDirectClose({
                    localTrade: trade,
                    closeResult,
                    fallbackExitPrice: exitPrice,
                    fallbackExitReason: reason,
                });
            } catch (error) {
                // Trade might already be closed externally
                logger.warn(
                    `⚠️ Error closing trade on Oanda: ${error.message}`
                );
                closeContext.brokerReconciliationPayload = {
                    error: error.message,
                    type: error.name || "Error",
                };
                closeContext.reconciliationStatus = "UNRESOLVED";
            }
        } else {
            logger.warn(
                `⚠️ Trade ${trade.id} has no Oanda trade ID, using local exit processing`
            );
        }

        // Close in our system
        return await this.closeTrade(
            trade.id,
            closeContext.exitPrice,
            closeContext.exitReason,
            closeContext
        );
    }

    /**
     * Close a trade and update database
     * @param {string} tradeId - Internal trade ID
     * @param {number} exitPrice - Exit price
     * @param {string} exitReason - Reason for exit
     * @param {object} closeContext - Optional broker reconciliation / pricing data
     */
    async closeTrade(tradeId, exitPrice, exitReason, closeContext = {}) {
        const trade = this.openTrades.get(tradeId);
        if (!trade) {
            logger.warn(`⚠️ Trade ${tradeId} not found in open trades`);
            return;
        }

        const closeTimestamp =
            closeContext.brokerClosedAt || Date.now();
        const closePriceSource =
            closeContext.closePriceSource || "LOCAL_MARKET_FALLBACK";
        const reconciliationStatus =
            closeContext.reconciliationStatus || "LOCAL_ONLY";
        const brokerExitReason = closeContext.brokerExitReason || null;
        const lastBrokerSyncAt =
            closeContext.lastBrokerSyncAt || Date.now();
        const brokerReconciliationPayload =
            closeContext.brokerReconciliationPayload || null;

        // Calculate P/L - use Oanda's realizedPL if available (includes all costs)
        const pipValue = oandaClient.getPipValue(trade.instrument);
        // Direction-aware: BUY profits when price rises, SELL profits when price falls
        const priceChange = trade.side === 'BUY'
            ? exitPrice - trade.entryPrice
            : trade.entryPrice - exitPrice;
        const pnlPips = priceChange / pipValue;

        // Use Oanda's realizedPL as source of truth when available
        // This includes spreads, currency conversion, and all fees
        const pnlAud =
            closeContext.oandaRealizedPL !== null &&
                closeContext.oandaRealizedPL !== undefined
                ? closeContext.oandaRealizedPL
                : trade.units * priceChange; // Fallback when Oanda P/L is unavailable

        const pnlPercent = (pnlAud / trade.entryCostAud) * 100;

        // Extract financing (swap) charges
        const swapAud = closeContext.oandaFinancing || 0;

        // Calculate holding period
        const holdingPeriodMs = Math.max(0, closeTimestamp - trade.entryTime);

        // Update trade object
        const closedTrade = {
            ...trade,
            exitPrice,
            exitTime: closeTimestamp,
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            swapAud,
            holdingPeriodMs,
            closePriceSource,
            reconciliationStatus,
            brokerExitReason,
            brokerClosedAt: closeTimestamp,
            lastBrokerSyncAt,
            brokerReconciliationPayload,
            activeStopType: closeContext.activeStopType || trade.activeStopType || null,
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
            closePriceSource,
            reconciliationStatus,
            brokerExitReason,
            brokerClosedAt: closeTimestamp,
            lastBrokerSyncAt,
            brokerReconciliationPayload,
            activeStopType: closeContext.activeStopType || trade.activeStopType || null,
            isOpen: false,
        });

        // Remove from open trades
        this.openTrades.delete(tradeId);

        // Update stats
        this.stats.tradesClosed++;

        // Broadcast trade closed event
        this.broadcastTradeClosed(closedTrade);

        const profitEmoji = pnlAud >= 0 ? "💰" : "📉";
        const swapNote = swapAud !== 0 ? ` | Swap: ${swapAud.toFixed(2)}` : "";
        logger.info(
            `${profitEmoji} Trade closed: ${trade.instrument
            } | P/L: ${pnlAud.toFixed(2)} AUD (${pnlPips.toFixed(
                1
            )} pips)${swapNote} | Reason: ${exitReason}`
        );
        this.emitEngineTelemetry("exitRecorded", {
            tradeId,
            instrument: trade.instrument,
            side: trade.side,
            exitPrice,
            exitReason,
            pnlAud,
            pnlPips,
            closePriceSource,
            reconciliationStatus,
            brokerExitReason,
            activeStopType:
                closeContext.activeStopType || trade.activeStopType || null,
            configHash: trade.configHash || null,
        });

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

        // Breakeven protection: move stop to entry once trade is in sufficient profit
        if (config.enableBreakeven) {
            await this.updateBreakevenStop(trade, currentPrice, config);
        }

        // Update trailing stop if enabled (works for both BUY and SELL)
        if (config.enableTrailingStops) {
            await this.updateTrailingStop(trade, currentPrice, config);
        }
    }

    /**
     * Move stop to breakeven once profit reaches configured trigger
     */
    async updateBreakevenStop(trade, currentPrice, config) {
        if (trade.breakevenHit) return;

        const pipValue = oandaClient.getPipValue(trade.instrument);
        const triggerPips = config.breakevenTriggerPips || 12;
        const isBuy = trade.side === "BUY";

        const profitPips = isBuy
            ? (currentPrice - trade.entryPrice) / pipValue
            : (trade.entryPrice - currentPrice) / pipValue;

        if (profitPips < triggerPips) {
            return;
        }

        const breakevenPrice = trade.entryPrice;
        const trailingStop = trade.trailingStopPrice;
        const shouldRaiseTrailingToBreakeven = isBuy
            ? trailingStop && trailingStop < breakevenPrice
            : trailingStop && trailingStop > breakevenPrice;

        const updatePayload = {
            stopLossPrice: breakevenPrice,
            breakevenHit: true,
            activeStopType: "BREAKEVEN",
            lastBrokerSyncAt: Date.now(),
        };

        trade.stopLossPrice = breakevenPrice;
        if (shouldRaiseTrailingToBreakeven) {
            trade.trailingStopPrice = breakevenPrice;
            updatePayload.trailingStopPrice = breakevenPrice;
        }
        trade.breakevenHit = true;
        trade.activeStopType = "BREAKEVEN";

        await this.tradeRepository.updateTrade(trade.id, updatePayload);

        if (trade.oandaTradeId) {
            try {
                await oandaClient.modifyTrade(trade.oandaTradeId, {
                    stopLossPrice: breakevenPrice,
                });
            } catch (error) {
                logger.error(
                    `❌ Failed to update breakeven stop on Oanda:`,
                    error.message
                );
            }
        }

        logger.info(
            `🛡️ Breakeven activated for ${trade.instrument} (${trade.side}): SL moved to ${breakevenPrice.toFixed(5)}`
        );
        this.emitEngineTelemetry("stopUpdated", {
            tradeId: trade.id,
            instrument: trade.instrument,
            side: trade.side,
            stopType: "BREAKEVEN",
            stopLossPrice: trade.stopLossPrice,
            trailingStopPrice: trade.trailingStopPrice || null,
            configHash: trade.configHash || null,
        });
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
            trade.stopLossPrice = newStopLossPrice;
            trade.activeStopType = "TRAILING";

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
                stopLossPrice: newStopLossPrice,
                trailingStopPrice: newStopLossPrice,
                highestPrice: trade.highestPrice,
                lowestPrice: trade.lowestPrice,
                activeStopType: "TRAILING",
                lastBrokerSyncAt: Date.now(),
            });

            // Update Oanda stop loss
            if (trade.oandaTradeId) {
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
            this.emitEngineTelemetry("stopUpdated", {
                tradeId: trade.id,
                instrument: trade.instrument,
                side: trade.side,
                stopType: "TRAILING",
                previousStop,
                stopLossPrice: trade.stopLossPrice,
                trailingStopPrice: trade.trailingStopPrice,
                configHash: trade.configHash || null,
            });
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
            activeStopType: trade.activeStopType || null,
            configHash: trade.configHash || null,
            mode: trade.mode,
            timestamp: Date.now(),
        };

        if (this.io) {
            this.io.emit("tradeOpened", event);
            this.io.emit("tradeUpdate", trade);
        }

        this.emit("tradeOpened", trade);

        // Send email alert (async, non-blocking)
        const config = this.configService?.get();
        emailService.sendTradeOpenedAlert(trade, config).catch(() => { });
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
            closePriceSource: trade.closePriceSource || null,
            reconciliationStatus: trade.reconciliationStatus || null,
            mode: trade.mode,
            timestamp: Date.now(),
        };

        if (this.io) {
            this.io.emit("tradeClosed", event);
            this.io.emit("tradeUpdate", trade);
        }

        this.emit("tradeClosed", trade);

        // Send email alert (async, non-blocking)
        const config = this.configService?.get();
        emailService.sendTradeClosedAlert(trade, config).catch(() => { });
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

        return await this.executeExit(trade, priceData.price, "MANUAL");
    }

    /**
     * Close every currently open live trade using the latest available market price.
     */
    async liquidateOpenTrades(exitReason = "STRATEGY_PROMOTION") {
        const openTrades = Array.from(this.openTrades.values());
        const closedTrades = [];

        for (const trade of openTrades) {
            const priceData = this.dataService?.getCurrentPrice?.(trade.instrument);
            const currentPrice = Number.isFinite(Number(priceData?.price))
                ? Number(priceData.price)
                : Number(priceData?.mid);

            if (!Number.isFinite(currentPrice)) {
                throw new Error(`No price data for ${trade.instrument}`);
            }

            const closedTrade = await this.executeExit(
                trade,
                currentPrice,
                exitReason
            );

            if (closedTrade) {
                closedTrades.push(closedTrade);
            }
        }

        return closedTrades;
    }

    /**
     * Get engine status
     */
    getStatus() {
        const config = this.configService?.get() || {};

        return {
            isRunning: this.isRunning,
            tradingEnabled: config.enableTrading,
            openPositions: this.openTrades.size,
            maxPositions: config.maxOpenPositions,
            stats: this.stats,
            timesFm: this.signalGenerator?.getTimesFmStatus?.() || null,
            openTrades: Array.from(this.openTrades.values()).map((t) => ({
                id: t.id,
                instrument: t.instrument,
                side: t.side,
                units: t.units,
                entryPrice: t.entryPrice,
                stopLossPrice: t.stopLossPrice,
                trailingStopPrice: t.trailingStopPrice,
                breakevenHit: !!t.breakevenHit,
                activeStopType: t.activeStopType || null,
                takeProfitPrice: t.takeProfitPrice,
                entryTime: t.entryTime,
                mode: t.mode,
                runId: t.runId || null,
                ownerRunId: t.ownerRunId || null,
                selectionId: t.selectionId || null,
                strategy: t.strategy || null,
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
