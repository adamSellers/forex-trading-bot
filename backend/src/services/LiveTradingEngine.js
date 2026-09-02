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
const { getStrategyDefinition } = require("../strategies");
const {
    ENTRY_REJECTION_CODES,
    ENTRY_DECISION_STAGES,
    ENTRY_DECISION_OUTCOMES,
} = require("../constants/entryDecisionCodes");
const {
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    getTradeExitMetadata,
    resolveBreakevenDistance,
    resolveOwnerRunExitPolicy,
    resolveTrailingStopDistances,
} = require("../runtime/exitPolicy");
const {
    ACCOUNT_CURRENCY,
    AudCurrencyConverter,
    getInstrumentCurrencies,
} = require("../runtime/currencyConversion");
const {
    calculateCanonicalPositionSize,
    resolveCanonicalTradePlan,
} = require("../runtime/executionPolicy");
const {
    CONSECUTIVE_LOSS_COOLDOWN_MS,
    evaluateConsecutiveLossCooldown,
    evaluatePortfolioRisk,
} = require("../runtime/portfolioRiskPolicy");

function toFiniteNumber(value, fallback = null) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

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
        this.brokerLifecycleRepository =
            options.brokerLifecycleRepository || null;
        this.brokerLifecycleRepositoryFactory =
            options.brokerLifecycleRepositoryFactory || null;

        // Engine state
        this.isRunning = false;
        this.openTrades = new Map(); // tradeId -> trade object
        this.quarantinedBrokerTrades = new Map(); // Oanda trade ID -> quarantine record
        this.instrumentMetadata = new Map();
        this.tradeQueue = []; // Queue for sequential processing
        this.isProcessingQueue = false;

        // Position monitoring
        this.monitorInterval = null;
        this.monitorIntervalMs = options.monitorIntervalMs || 10000; // 10s default
        this.isMonitoringPositions = false;
        this.highWatermarkNavAud = null;
        this.entryRiskState = null;

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
        entryDecisionRepository = null,
        brokerLifecycleRepository = null
    ) {
        this.configService = configService;
        this.dataService = dataService;
        this.tradeRepository = tradeRepository;
        this.signalGenerator = signalGenerator;
        this.io = io;
        this.entryDecisionRepository = entryDecisionRepository;
        if (brokerLifecycleRepository) {
            this.brokerLifecycleRepository = brokerLifecycleRepository;
        }

        // Keep unit tests isolated from the developer database. Production and
        // normal development runtimes always receive the durable SQLite-backed
        // outbox even though runtimeCoordinator does not need a new dependency.
        if (!this.brokerLifecycleRepository && process.env.NODE_ENV !== "test") {
            this.ensureBrokerLifecycleRepository();
        }

        logger.info("⚙️ LiveTradingEngine dependencies injected");
        return this;
    }

    ensureBrokerLifecycleRepository() {
        if (this.brokerLifecycleRepository) {
            return this.brokerLifecycleRepository;
        }
        if (this.brokerLifecycleRepositoryFactory) {
            this.brokerLifecycleRepository =
                this.brokerLifecycleRepositoryFactory();
            return this.brokerLifecycleRepository;
        }

        // Lazy loading avoids opening SQLite merely by importing the engine.
        const BrokerLifecycleRepository = require("../repositories/brokerLifecycleRepository");
        this.brokerLifecycleRepository = new BrokerLifecycleRepository();
        return this.brokerLifecycleRepository;
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

        if (process.env.NODE_ENV !== "test" || this.brokerLifecycleRepository) {
            this.ensureBrokerLifecycleRepository();
        }

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
    async syncOpenTrades({ throwOnError = false } = {}) {
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
            await this.syncWithOanda({ throwOnError });
        } catch (error) {
            logger.error("❌ Failed to sync open trades:", error.message);
            if (throwOnError) throw error;
        }
    }

    /**
     * Sync local state with actual Oanda positions
     */
    async syncWithOanda({ throwOnError = false } = {}) {
        try {
            const oandaResponse = await oandaClient.getOpenTrades();
            const brokerTrades = oandaResponse?.trades || [];

            await this.recoverPendingOrderIntents(brokerTrades);

            const oandaTradeIds = new Set(brokerTrades.map((t) => String(t.id)));

            // Check for trades that closed externally (stop loss hit, etc.)
            for (const [tradeId, trade] of this.openTrades) {
                if (
                    trade.oandaTradeId &&
                    !oandaTradeIds.has(String(trade.oandaTradeId))
                ) {
                    logger.warn(
                        `⚠️ Trade ${tradeId} closed externally on Oanda`
                    );
                    await this.handleExternalClose(trade);
                }
            }

            const locallyManagedIds = new Set(
                [...this.openTrades.values()]
                    .map((trade) => trade.oandaTradeId)
                    .filter(Boolean)
                    .map(String)
            );
            for (const brokerTrade of brokerTrades) {
                if (!locallyManagedIds.has(String(brokerTrade.id))) {
                    await this.reconcileOrQuarantineBrokerTrade(brokerTrade);
                }
            }

            if (this.brokerLifecycleRepository) {
                await this.brokerLifecycleRepository.resolveMissingQuarantines(
                    oandaTradeIds
                );
                const openQuarantines =
                    await this.brokerLifecycleRepository.getOpenQuarantines();
                this.quarantinedBrokerTrades = new Map(
                    openQuarantines.map((record) => [
                        String(record.brokerTradeId),
                        record,
                    ])
                );
            }
        } catch (error) {
            logger.error("❌ Failed to sync with Oanda:", error.message);
            if (throwOnError) throw error;
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
            if (closeContext.brokerConfirmedClosed) {
                await this.closeTrade(
                    trade.id,
                    closeContext.exitPrice,
                    closeContext.exitReason,
                    closeContext
                );
            } else {
                await this.markTradeReconciliationPending(
                    trade,
                    "CLOSE_RETRY_PENDING",
                    closeContext.brokerReconciliationPayload
                );
            }
        } catch (error) {
            logger.warn(
                `⚠️ Could not get details for externally closed trade ${trade.id}`
            );
            await this.markTradeReconciliationPending(
                trade,
                "CLOSE_RETRY_PENDING",
                {
                    externalCloseLookup: {
                        error: error.message,
                        type: error.name || "Error",
                        attemptedAt: Date.now(),
                    },
                }
            );
        }
    }

    mergeBrokerPayload(trade, updates = {}) {
        return {
            ...(trade?.brokerReconciliationPayload || {}),
            ...updates,
        };
    }

    async markTradeReconciliationPending(trade, status, payload = null) {
        const brokerReconciliationPayload = this.mergeBrokerPayload(
            trade,
            payload || {}
        );
        const lastBrokerSyncAt = Date.now();
        trade.reconciliationStatus = status;
        trade.lastBrokerSyncAt = lastBrokerSyncAt;
        trade.brokerReconciliationPayload = brokerReconciliationPayload;
        await this.tradeRepository.updateTrade(trade.id, {
            reconciliationStatus: status,
            lastBrokerSyncAt,
            brokerReconciliationPayload,
            isOpen: true,
        });
        this.emitEngineTelemetry("brokerReconciliationPending", {
            tradeId: trade.id,
            oandaTradeId: trade.oandaTradeId || null,
            instrument: trade.instrument,
            status,
        });
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
        };
    }

    shouldTrackEntryDecision(signal) {
        if (!signal || !signal.symbol) return false;
        if (signal.signal !== "BUY" && signal.signal !== "SELL") return false;
        if (signal.entryEnabled === false) return false;
        if (signal.entryType === "EXIT_ONLY") {
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

            // Strategies can invalidate an existing short before a fresh long
            // entry exists. Treat that signal symmetrically with SELL
            // EXIT_ONLY: close the short, but never open a new long.
            if (
                entryType === "EXIT_ONLY" ||
                signal.intent === "EXIT_SHORT_ONLY"
            ) {
                return;
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

    shouldEnforceAdxThreshold(signal, config = {}) {
        const strategyKey = signal?.strategy || config?.strategy;
        if (!strategyKey) return true;

        try {
            const strategyDefinition = getStrategyDefinition(strategyKey);
            const entryValidation = strategyDefinition?.metadata?.entryValidation || {};
            if (entryValidation.enforceGlobalMinAdx === false) {
                return false;
            }

            const indicators = Array.isArray(strategyDefinition?.requiredData?.indicators)
                ? strategyDefinition.requiredData.indicators
                : [];
            return indicators.includes("adx");
        } catch (error) {
            return true;
        }
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

        const quarantinedPosition = [...this.quarantinedBrokerTrades.values()].find(
            (record) =>
                record.status === "OPEN" && record.instrument === signal.symbol
        );
        if (quarantinedPosition) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                reason: `Broker-only ${signal.symbol} trade ${quarantinedPosition.brokerTradeId} is quarantined`,
                context: baseContext,
            };
        }

        // 6. Check minimum ADX strength
        if (
            config.enableAdxFilter !== false &&
            this.shouldEnforceAdxThreshold(signal, config) &&
            signal.strength < config.minAdx
        ) {
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

        const portfolioRisk = await this.evaluateEntryPortfolioRisk(
            signal,
            config
        );
        if (!portfolioRisk.passed) {
            const primaryReason = portfolioRisk.reasons[0] || {
                code: "PORTFOLIO_RISK",
            };
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                reason: `Portfolio risk rejected entry: ${primaryReason.code}`,
                context: {
                    ...baseContext,
                    portfolioRisk,
                },
            };
        }

        return { valid: true, context: baseContext };
    }

    /**
     * Estimate margin that would be used by a new entry using current risk settings.
     */
    async estimateEntryMargin(signal, config) {
        const { stopLossPips } = this.resolveStopLoss(signal, config);
        const units = await this.calculatePositionSize(
            signal.symbol,
            stopLossPips,
            signal.currentPrice,
            config,
            signal.entryType,
            signal
        );

        if (!Number.isFinite(units) || units <= 0) return 0;
        return this.calculateMarginRequiredInAccountCurrency(
            signal.symbol,
            units,
            signal.currentPrice,
            config
        );
    }

    async buildPortfolioRiskPosition(trade, config = {}) {
        const instrument = trade.instrument || trade.symbol;
        const units = Math.abs(Number(trade.units));
        const entryPrice = Number(trade.entryPrice ?? trade.currentPrice);
        const stopLossPrice = Number(trade.stopLossPrice);
        let baseToAudRate = toFiniteNumber(
            trade?.brokerReconciliationPayload?.liveRuntime?.baseToAudRate,
            null
        );
        let quoteToAudRate = toFiniteNumber(
            trade?.brokerReconciliationPayload?.liveRuntime?.quoteToAudRate,
            null
        );
        const { baseCurrency, quoteCurrency } =
            getInstrumentCurrencies(instrument);
        if (!Number.isFinite(baseToAudRate)) {
            baseToAudRate = await this.getConversionRate(
                baseCurrency,
                ACCOUNT_CURRENCY,
                { instrument, entryPrice }
            );
        }
        if (!Number.isFinite(quoteToAudRate)) {
            quoteToAudRate = await this.getConversionRate(
                quoteCurrency,
                ACCOUNT_CURRENCY,
                { instrument, entryPrice }
            );
        }
        return {
            instrument,
            side: trade.side || trade.signal,
            units,
            entryPrice,
            stopLossPrice,
            quoteToAud: quoteToAudRate,
            stopRiskAud:
                Math.abs(entryPrice - stopLossPrice) *
                units *
                quoteToAudRate,
            notionalAud: units * baseToAudRate,
        };
    }

    async getEntryRiskState({
        runId = null,
        config = this.configService?.get?.() || {},
        evaluatedAt = Date.now(),
        trades = null,
    } = {}) {
        const riskHistory = Array.isArray(trades)
            ? trades
            : this.tradeRepository?.getAllTrades
              ? await this.tradeRepository.getAllTrades()
              : null;
        if (!Array.isArray(riskHistory)) {
            throw new Error("Closed trade history is unavailable");
        }

        const closedTrades = riskHistory.filter((trade) => {
            if (trade.isOpen) return false;
            if (!runId) return true;
            return (trade.ownerRunId || trade.runId || null) === runId;
        });
        const incompleteTrade = closedTrades.find(
            (trade) =>
                !Number.isFinite(toFiniteNumber(trade.exitTime, null)) ||
                !Number.isFinite(toFiniteNumber(trade.pnlAud, null))
        );
        if (incompleteTrade) {
            throw new Error("Closed trade risk history is incomplete");
        }
        const state = {
            ...evaluateConsecutiveLossCooldown({
                closedTrades,
                maxConsecutiveLosses: config.maxConsecutiveLosses,
                cooldownMs: CONSECUTIVE_LOSS_COOLDOWN_MS,
                evaluatedAt,
            }),
            runId,
        };
        this.entryRiskState = state;
        return state;
    }

    async evaluateEntryPortfolioRisk(signal, config = {}) {
        try {
            const account = await oandaClient.getAccountSummary();
            const currency = String(
                account?.account?.currency || ACCOUNT_CURRENCY
            ).toUpperCase();
            if (currency !== ACCOUNT_CURRENCY) {
                throw new Error(`Expected AUD account, received ${currency}`);
            }
            const navAud = toFiniteNumber(
                account?.account?.NAV,
                toFiniteNumber(account?.account?.balance, null)
            );
            const persistedHighWatermark = this.brokerLifecycleRepository?.getState
                ? await this.brokerLifecycleRepository.getState(
                      "aud_nav_high_watermark"
                  )
                : null;
            this.highWatermarkNavAud = Math.max(
                toFiniteNumber(config.highWatermarkNavAud, navAud),
                toFiniteNumber(persistedHighWatermark?.navAud, navAud),
                toFiniteNumber(this.highWatermarkNavAud, navAud),
                navAud
            );
            if (
                this.brokerLifecycleRepository?.setState &&
                this.highWatermarkNavAud >
                    toFiniteNumber(persistedHighWatermark?.navAud, 0)
            ) {
                await this.brokerLifecycleRepository.setState(
                    "aud_nav_high_watermark",
                    {
                        navAud: this.highWatermarkNavAud,
                        observedAt: Date.now(),
                    }
                );
            }

            const stop = this.resolveStopLoss(signal, config);
            const units = await this.calculatePositionSize(
                signal.symbol,
                stop.stopLossPips,
                signal.currentPrice,
                config,
                signal.entryType,
                signal
            );
            const proposedTrade = await this.buildPortfolioRiskPosition(
                {
                    instrument: signal.symbol,
                    side: signal.signal,
                    units,
                    entryPrice: signal.currentPrice,
                    stopLossPrice: stop.stopLossPrice,
                },
                config
            );
            const openPositions = await Promise.all(
                [...this.openTrades.values()].map((trade) =>
                    this.buildPortfolioRiskPosition(trade, config)
                )
            );

            const dayStart = new Date();
            dayStart.setUTCHours(0, 0, 0, 0);
            const riskHistory = this.tradeRepository.getAllTrades
                ? await this.tradeRepository.getAllTrades()
                : this.tradeRepository.getTradesSince
                ? await this.tradeRepository.getTradesSince(dayStart.getTime())
                : [];
            const allClosedTrades = riskHistory
                .filter((trade) => !trade.isOpen)
                .sort(
                    (left, right) =>
                        Number(left.exitTime || 0) - Number(right.exitTime || 0)
                );
            const dailyRealizedPnlAud = allClosedTrades
                .filter(
                    (trade) =>
                        toFiniteNumber(trade.exitTime, 0) >= dayStart.getTime()
                )
                .reduce(
                (sum, trade) => sum + toFiniteNumber(trade.pnlAud, 0),
                0
            );
            const lossStreakState = await this.getEntryRiskState({
                runId: signal.runId || null,
                config,
                evaluatedAt: Date.now(),
                trades: riskHistory,
            });

            return evaluatePortfolioRisk({
                navAud,
                openPositions,
                proposedTrade,
                dailyRealizedPnlAud,
                highWatermarkNavAud: this.highWatermarkNavAud,
                lossStreakState,
                correlations: config.instrumentCorrelations || {},
                config,
            });
        } catch (error) {
            return {
                passed: false,
                status: "FAIL",
                referenceCurrency: ACCOUNT_CURRENCY,
                reasons: [
                    {
                        code: "PORTFOLIO_RISK_UNAVAILABLE",
                        message: error.message,
                    },
                ],
            };
        }
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
        let accountBalance, marginAvailable, accountCurrency;
        try {
            const accountSummary = await oandaClient.getAccountSummary();
            accountBalance = parseFloat(accountSummary.account.balance);
            marginAvailable = parseFloat(accountSummary.account.marginAvailable);
            accountCurrency = accountSummary.account.currency || "AUD";
            if (String(accountCurrency).toUpperCase() !== "AUD") {
                throw new Error(
                    `Live account currency must be AUD; received ${accountCurrency}`
                );
            }
        } catch (error) {
            logger.error("❌ Failed to get account info:", error.message);
            return 0;
        }

        let baseToAudRate, quoteToAudRate, instrumentMetadata;
        try {
            const { baseCurrency, quoteCurrency } =
                getInstrumentCurrencies(instrument);
            [baseToAudRate, quoteToAudRate, instrumentMetadata] =
                await Promise.all([
                    this.getConversionRate(baseCurrency, ACCOUNT_CURRENCY, {
                        instrument,
                        entryPrice: currentPrice,
                    }),
                    this.getConversionRate(quoteCurrency, ACCOUNT_CURRENCY, {
                        instrument,
                        entryPrice: currentPrice,
                    }),
                    this.getInstrumentMetadataForTrading(instrument, config),
                ]);
        } catch (error) {
            logger.error(
                `❌ Failed to resolve AUD sizing inputs for ${instrument}: ${error.message}`
            );
            return 0;
        }

        const pipValue = oandaClient.getPipValue(instrument);
        const side = signal?.signal === "SELL" ? "SELL" : "BUY";
        const stopDistance = stopLossPips * pipValue;
        const stopLossPrice =
            side === "SELL"
                ? currentPrice + stopDistance
                : currentPrice - stopDistance;
        const sizing = calculateCanonicalPositionSize({
            config,
            signal: { ...(signal || {}), entryType },
            entryPrice: currentPrice,
            stopLossPrice,
            equityAud: accountBalance,
            marginAvailableAud: marginAvailable,
            baseToAudRate,
            quoteToAudRate,
        });
        let units = sizing.units;

        const brokerMarginRate = toFiniteNumber(
            instrumentMetadata?.marginRate,
            null
        );
        if (
            Number.isFinite(brokerMarginRate) &&
            brokerMarginRate > 0 &&
            Number.isFinite(sizing.safeMarginAvailableAud)
        ) {
            const brokerMarginCapUnits = Math.floor(
                sizing.safeMarginAvailableAud /
                    (baseToAudRate * brokerMarginRate)
            );
            units = Math.min(units, brokerMarginCapUnits);
        }

        logger.info(
            `💰 AUD sizing: ${instrument} | balance=A$${accountBalance.toFixed(2)} | available=A$${marginAvailable.toFixed(2)} | risk=A$${toFiniteNumber(sizing.riskBudgetAud, 0).toFixed(2)} | units=${units}`
        );

        // Minimum units check
        if (!Number.isFinite(units) || units < 1) {
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

    resolveStopLoss(signal, config, entryPrice = null) {
        const referencePrice = Number.isFinite(entryPrice)
            ? entryPrice
            : toFiniteNumber(signal?.currentPrice, null);
        const pipValue = oandaClient.getPipValue(signal.symbol);
        const canonicalPlan = resolveCanonicalTradePlan({
            signal,
            config,
            entryPrice: referencePrice,
            pipValue,
        });
        if (!canonicalPlan) {
            return {
                ...this.calculateStopLoss(signal, config, entryPrice),
                source: "GLOBAL_CONFIG",
            };
        }
        if (canonicalPlan.floored) {
            logger.info(
                `📏 Trade plan stop adjusted to ${canonicalPlan.stopLossPips.toFixed(1)} pips (minimum floor)`
            );
        }
        return {
            stopLossPips: canonicalPlan.stopLossPips,
            stopLossPrice: Number(
                oandaClient.formatPrice
                    ? oandaClient.formatPrice(
                          signal.symbol,
                          canonicalPlan.stopLossPrice
                      )
                    : canonicalPlan.stopLossPrice.toFixed(5)
            ),
            source: canonicalPlan.source,
            floored: canonicalPlan.floored,
        };
    }

    getPlannedTakeProfitPrice(signal, entryPrice = null) {
        const plannedTakeProfitPrice = toFiniteNumber(
            signal?.tradePlan?.takeProfitPrice,
            null
        );
        if (!Number.isFinite(plannedTakeProfitPrice)) {
            return null;
        }

        const referencePrice = Number.isFinite(entryPrice)
            ? entryPrice
            : toFiniteNumber(signal?.currentPrice, null);
        if (!Number.isFinite(referencePrice)) {
            return plannedTakeProfitPrice;
        }

        const signalSide = String(signal?.signal || "").toUpperCase();
        if (signalSide === "BUY" && plannedTakeProfitPrice <= referencePrice) {
            return null;
        }
        if (signalSide === "SELL" && plannedTakeProfitPrice >= referencePrice) {
            return null;
        }

        return plannedTakeProfitPrice;
    }

    buildLiveRuntimeMetadata(signal, entryPrice, stopLossPrice, config = {}) {
        const initialStopDistance = Math.abs(
            toFiniteNumber(entryPrice, 0) - toFiniteNumber(stopLossPrice, 0)
        );
        const atrDistance =
            Math.max(0, toFiniteNumber(signal?.atrPips, 0)) *
            oandaClient.getPipValue(signal?.symbol || "");

        return {
            initialStopLossPrice: stopLossPrice,
            initialStopDistance,
            atrDistance,
            // Position management must remain owned by the run that opened the
            // trade. A later strategy/config selection cannot rewrite its exit
            // contract.
            exitConfig: JSON.parse(JSON.stringify(config || {})),
            ownerExitPolicy: buildOwnerRunExitPolicy({
                strategy: signal?.strategy || config?.strategy || null,
                config,
                tradePlan: signal?.tradePlan || {},
                ownerRunId: signal?.runId || null,
            }),
        };
    }

    getOwnerExitConfig(trade = {}, fallbackConfig = {}) {
        return this.getOwnerExitPolicy(trade, fallbackConfig).config;
    }

    getOwnerExitPolicy(trade = {}, fallbackConfig = {}) {
        const liveRuntime = trade?.brokerReconciliationPayload?.liveRuntime;
        if (liveRuntime?.ownerExitPolicy) {
            return resolveOwnerRunExitPolicy(trade, fallbackConfig);
        }
        if (liveRuntime?.exitConfig) {
            return buildOwnerRunExitPolicy({
                strategy: trade.strategy || liveRuntime.exitConfig.strategy,
                config: liveRuntime.exitConfig,
                tradePlan: { trailingStopPips: trade.trailingStopPips },
                ownerRunId: trade.ownerRunId || trade.runId || null,
                createdAt: trade.entryTime,
            });
        }
        return resolveOwnerRunExitPolicy(trade, fallbackConfig);
    }

    getLiveRuntimeMetadata(trade = {}) {
        const liveRuntime =
            trade?.brokerReconciliationPayload?.liveRuntime || {};
        return getTradeExitMetadata({
            trade,
            runtimeMetadata: liveRuntime,
            pipValue: oandaClient.getPipValue(trade.instrument || ""),
        });
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

    getInstrumentBaseCurrency(instrument) {
        const [baseCurrency] = String(instrument || "").split("_");
        if (!baseCurrency) {
            throw new Error(`Invalid instrument: ${instrument}`);
        }
        return baseCurrency;
    }

    async getInstrumentMetadataForTrading(instrument, config = {}) {
        if (this.instrumentMetadata.has(instrument)) {
            return this.instrumentMetadata.get(instrument);
        }

        if (typeof oandaClient.getInstrumentMetadata !== "function") {
            const leverage = Number(config.leverage) || 10;
            const fallback = {
                name: instrument,
                displayPrecision: instrument.endsWith("_JPY") ? 3 : 5,
                pipLocation: instrument.endsWith("_JPY") ? -2 : -4,
                marginRate: 1 / leverage,
                metadataSource: "TEST_OR_LEGACY_FALLBACK",
            };
            this.instrumentMetadata.set(instrument, fallback);
            return fallback;
        }

        const metadata = await oandaClient.getInstrumentMetadata(instrument);
        this.instrumentMetadata.set(instrument, metadata);
        return metadata;
    }

    async getFinalEntryQuote(signal, config = {}, instrumentMetadata = null) {
        const pricing = await oandaClient.getPricing([signal.symbol], {
            includeHomeConversions: true,
        });
        const price = pricing?.prices?.[0];
        if (!price || price.tradeable === false) {
            throw new Error(`No tradeable final quote for ${signal.symbol}`);
        }

        const isSell = signal.signal === "SELL";
        const finalQuote = parseFloat(
            isSell
                ? price.closeoutBid || price.bids?.[0]?.price
                : price.closeoutAsk || price.asks?.[0]?.price
        );
        if (!Number.isFinite(finalQuote)) {
            throw new Error(`Invalid final quote for ${signal.symbol}`);
        }

        const pipValue =
            Number.isInteger(Number(instrumentMetadata?.pipLocation))
                ? 10 ** Number(instrumentMetadata.pipLocation)
                : oandaClient.getPipValue(signal.symbol);
        const referencePrice = toFiniteNumber(signal.currentPrice, finalQuote);
        const deviationPips = Math.abs(finalQuote - referencePrice) / pipValue;
        const configuredDeviation = Number(config.maxEntryDeviationPips);
        const maxDeviationPips =
            Number.isFinite(configuredDeviation) && configuredDeviation > 0
                ? configuredDeviation
                : 2;

        if (deviationPips > maxDeviationPips) {
            const error = new Error(
                `Final quote moved ${deviationPips.toFixed(1)} pips (limit ${maxDeviationPips.toFixed(1)})`
            );
            error.code = "ENTRY_PRICE_DEVIATION";
            throw error;
        }

        const priceBound = isSell
            ? finalQuote - maxDeviationPips * pipValue
            : finalQuote + maxDeviationPips * pipValue;
        return {
            finalQuote,
            priceBound,
            deviationPips,
            maxDeviationPips,
            pricing,
        };
    }

    resolveAudConversionSnapshot(instrument, price, pricingPayload = null) {
        const converter = new AudCurrencyConverter({
            homeConversions: pricingPayload?.homeConversions || [],
            priceProvider: (requestedInstrument) => {
                if (requestedInstrument === instrument) {
                    return { price, timestamp: Date.now() };
                }
                return this.dataService?.getCurrentPrice?.(requestedInstrument);
            },
        });
        const { baseCurrency, quoteCurrency } =
            getInstrumentCurrencies(instrument);
        return {
            baseToAudRate: converter.getRate(baseCurrency, ACCOUNT_CURRENCY, {
                instrument,
                price,
                purpose: "position",
            }),
            quoteToAudRate: converter.getRate(quoteCurrency, ACCOUNT_CURRENCY, {
                instrument,
                price,
                purpose: "pnl",
                amount: -1,
            }),
        };
    }

    async getInstrumentBaseToAccountRate(
        instrument,
        accountCurrency = "AUD",
        entryPrice = null
    ) {
        const baseCurrency = this.getInstrumentBaseCurrency(instrument);
        return this.getConversionRate(baseCurrency, accountCurrency, {
            instrument,
            entryPrice,
        });
    }

    async calculateMarginRequiredInAccountCurrency(
        instrument,
        units,
        entryPrice,
        config,
        accountCurrency = "AUD"
    ) {
        const absoluteUnits = Math.abs(Number(units));
        if (!Number.isFinite(absoluteUnits) || absoluteUnits <= 0) return 0;

        const leverage = Number(config.leverage) || 10;
        const metadata = await this.getInstrumentMetadataForTrading(
            instrument,
            config
        );
        const brokerMarginRate = toFiniteNumber(metadata?.marginRate, null);
        // Respect both the broker requirement and our stricter configured
        // leverage cap. A 20x local cap means at least 5% margin even if Oanda
        // permits more leverage.
        const effectiveMarginRate = Math.max(
            1 / leverage,
            Number.isFinite(brokerMarginRate) && brokerMarginRate > 0
                ? brokerMarginRate
                : 0
        );
        const baseToAccountRate =
            await this.getInstrumentBaseToAccountRate(
                instrument,
                accountCurrency,
                entryPrice
            );

        if (
            !Number.isFinite(baseToAccountRate) ||
            baseToAccountRate <= 0
        ) {
            throw new Error(
                `Invalid base-to-${accountCurrency} conversion rate for ${instrument}: ${baseToAccountRate}`
            );
        }

        return absoluteUnits * baseToAccountRate * effectiveMarginRate;
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
            logger.error(
                `❌ TP conversion unavailable for ${instrument}: ${error.message}`
            );
            return null;
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

    async updateOrderIntent(intentId, updates = {}) {
        if (!this.brokerLifecycleRepository || !intentId) return null;
        return this.brokerLifecycleRepository.updateIntent(intentId, updates);
    }

    async recoverOrderIntentOutcome(intent) {
        if (!intent || typeof oandaClient.findOrderIntent !== "function") {
            return { status: "AMBIGUOUS" };
        }
        try {
            const recovery = await oandaClient.findOrderIntent(
                intent.intentId,
                intent.lastTransactionId
            );
            await this.updateOrderIntent(intent.intentId, {
                status:
                    recovery.status === "FILLED" ||
                    recovery.status === "OPEN_TRADE_FOUND"
                        ? "FILLED_UNPERSISTED"
                        : recovery.status === "REJECTED"
                        ? "REJECTED"
                        : "RECOVERY_PENDING",
                brokerTradeId:
                    recovery.orderFillTransaction?.tradeOpened?.tradeID ||
                    recovery.trade?.id ||
                    null,
                brokerOrderId: recovery.orderTransaction?.id || null,
                lastTransactionId:
                    recovery.lastTransactionId || intent.lastTransactionId,
                responsePayload: recovery,
                resolvedAt:
                    recovery.status === "REJECTED" ? Date.now() : null,
            });
            return recovery;
        } catch (error) {
            await this.updateOrderIntent(intent.intentId, {
                status: "RECOVERY_PENDING",
                lastError: error.message,
                nextRetryAt: Date.now() + 5000,
            });
            return { status: "AMBIGUOUS", error };
        }
    }

    async buildEntryTradeFromFill(intent, fillTransaction, options = {}) {
        const context = intent?.contextPayload || {};
        const signal = context.signal || {};
        const config = context.config || {};
        const effects = this.tradeReconciliation.getFillEffects(fillTransaction);

        // An OPEN_ONLY entry should only ever open a trade. If Oanda reports a
        // reduction or closure, broker state differs from our pre-submit view;
        // never guess which local position now owns that exposure.
        if (effects.tradeReduced || effects.tradesClosed.length > 0) {
            const error = new Error(
                "Entry fill unexpectedly reduced or closed an existing broker trade"
            );
            error.code = "UNEXPECTED_ENTRY_NETTING";
            error.fillEffects = effects;
            await this.updateOrderIntent(intent.intentId, {
                status: "QUARANTINED",
                responsePayload: { fillTransaction, fillEffects: effects },
                lastError: error.message,
                resolvedAt: Date.now(),
            });
            throw error;
        }

        const opened = effects.tradeOpened;
        const oandaTradeId = opened?.tradeID;
        const fillPrice = toFiniteNumber(
            opened?.price ?? fillTransaction?.price,
            null
        );
        if (!oandaTradeId || !Number.isFinite(fillPrice)) {
            const error = new Error(
                "Broker fill did not identify a newly opened trade"
            );
            error.code = "UNRESOLVED_ENTRY_FILL";
            throw error;
        }

        const existing = [...this.openTrades.values()].find(
            (trade) => String(trade.oandaTradeId) === String(oandaTradeId)
        );
        if (existing) return existing;

        let stopLossPrice = toFiniteNumber(context.initialStopLossPrice, null);
        let pendingStopUpdate = null;
        const fillAlignedPlan = resolveCanonicalTradePlan({
            signal,
            config,
            entryPrice: fillPrice,
            pipValue: oandaClient.getPipValue(signal.symbol),
        });
        const desiredStop = toFiniteNumber(
            fillAlignedPlan?.stopLossPrice,
            stopLossPrice
        );
        const desiredTakeProfit = toFiniteNumber(
            fillAlignedPlan?.takeProfitPrice,
            toFiniteNumber(context.plannedTakeProfitPrice, null)
        );
        let fillAlignmentConfirmed = false;
        if (Number.isFinite(desiredStop)) {
            try {
                // Confirm protection through a broker response even when the
                // same stop was requested as stopLossOnFill.
                await oandaClient.modifyTrade(oandaTradeId, {
                    stopLossPrice: desiredStop,
                    ...(Number.isFinite(desiredTakeProfit)
                        ? { takeProfitPrice: desiredTakeProfit }
                        : {}),
                    instrument: signal.symbol,
                    instrumentMetadata: context.instrumentMetadata,
                });
                stopLossPrice = desiredStop;
                fillAlignmentConfirmed = true;
            } catch (error) {
                pendingStopUpdate = {
                    status: "RETRY_PENDING",
                    desiredPrice: desiredStop,
                    desiredTakeProfitPrice: desiredTakeProfit,
                    stopType: "INITIAL_STOP_ALIGNMENT",
                    attempts: 1,
                    lastError: error.message,
                    nextRetryAt: Date.now() + 5000,
                };
                logger.warn(
                    `⚠️ Initial stop confirmation pending retry: ${error.message}`
                );

                if (options.orderResult?.stopLossOrderRejectTransaction) {
                    let emergencyClose = null;
                    try {
                        emergencyClose = await oandaClient.closeTrade(oandaTradeId);
                    } catch (closeError) {
                        emergencyClose = {
                            error: closeError.message,
                            ambiguous: closeError.ambiguous === true,
                        };
                    }
                    await this.updateOrderIntent(intent.intentId, {
                        status: "QUARANTINED",
                        brokerTradeId: String(oandaTradeId),
                        lastError:
                            "Initial protective stop rejected and could not be confirmed",
                        responsePayload: {
                            entry: options.orderResult,
                            emergencyClose,
                        },
                        resolvedAt: Date.now(),
                    });
                    const protectionError = new Error(
                        "Initial protective stop was rejected by Oanda"
                    );
                    protectionError.code = "INITIAL_STOP_REJECTED";
                    throw protectionError;
                }
            }
        }

        const units = Math.abs(
            toFiniteNumber(opened?.units ?? fillTransaction?.units, intent.units)
        );
        const marginUsed = toFiniteNumber(opened?.initialMarginRequired, 0);
        let takeProfit = null;
        let takeProfitPrice = fillAlignmentConfirmed
            ? desiredTakeProfit
            : toFiniteNumber(context.plannedTakeProfitPrice, null);
        if (
            !Number.isFinite(takeProfitPrice) &&
            marginUsed > 0 &&
            config.enableTakeProfit
        ) {
            takeProfit = await this.calculateTakeProfit(
                signal,
                config,
                units,
                marginUsed,
                fillPrice
            );
            takeProfitPrice = takeProfit?.takeProfitPrice || null;
            if (takeProfitPrice) {
                try {
                    await oandaClient.modifyTrade(oandaTradeId, {
                        takeProfitPrice,
                        instrument: signal.symbol,
                        instrumentMetadata: context.instrumentMetadata,
                    });
                } catch (error) {
                    logger.warn(`⚠️ Failed to set take profit: ${error.message}`);
                    takeProfitPrice = null;
                }
            }
        }

        const entryTime =
            this.tradeReconciliation.parseBrokerTimestamp(
                fillTransaction?.time,
                Date.now()
            );
        const baseToAudRate = toFiniteNumber(context.baseToAudRate, null);
        const quoteToAudRate = toFiniteNumber(context.quoteToAudRate, null);
        if (!Number.isFinite(baseToAudRate) || !Number.isFinite(quoteToAudRate)) {
            throw new Error(
                `Missing AUD conversion snapshot for recovered ${signal.symbol} fill`
            );
        }

        const liveRuntime = {
            ...this.buildLiveRuntimeMetadata(
                signal,
                fillPrice,
                stopLossPrice,
                config
            ),
            baseToAudRate,
            quoteToAudRate,
            instrumentMetadata: context.instrumentMetadata,
            orderIntentId: intent.intentId,
        };
        const brokerReconciliationPayload = {
            liveRuntime,
            orderIntent: {
                intentId: intent.intentId,
                clientOrderId: intent.clientOrderId,
                clientTradeId: intent.clientTradeId,
            },
            entryFill: fillTransaction,
            ...(pendingStopUpdate ? { stopUpdate: pendingStopUpdate } : {}),
        };
        const trade = {
            id: intent.tradeId || context.tradeId || uuidv4(),
            oandaTradeId: String(oandaTradeId),
            instrument: signal.symbol || intent.instrument,
            side: intent.side,
            units,
            entryPrice: fillPrice,
            entryCostAud: units * baseToAudRate,
            signal: signal.signal || intent.side,
            signalStrength: signal.strength,
            entryType: signal.entryType,
            atrPips: signal.atrPips,
            stopLossPrice,
            takeProfitPrice,
            highestPrice: intent.side === "BUY" ? fillPrice : null,
            lowestPrice: intent.side === "SELL" ? fillPrice : null,
            trailingStopPips: config.trailingStopPips,
            breakevenHit: false,
            activeStopType: "INITIAL_STOP",
            leverageUsed: config.leverage || 10,
            marginUsedAud:
                marginUsed ||
                (await this.calculateMarginRequiredInAccountCurrency(
                    signal.symbol,
                    units,
                    fillPrice,
                    config,
                    "AUD"
                )),
            spreadPips: context.spreadPips || 0,
            entryTime,
            lastBrokerSyncAt: Date.now(),
            reconciliationStatus: pendingStopUpdate
                ? "STOP_UPDATE_RETRY_PENDING"
                : options.recovered
                ? "RECOVERED_OPEN"
                : "OPEN",
            configHash: context.configHash,
            mode: signal.mode || "live",
            runId: signal.runId || null,
            ownerRunId: signal.runId || null,
            selectionId: signal.selectionId || null,
            strategy: signal.strategy || config.strategy || null,
            brokerReconciliationPayload,
            isOpen: true,
        };

        await this.updateOrderIntent(intent.intentId, {
            status: "FILLED_UNPERSISTED",
            brokerTradeId: String(oandaTradeId),
            responsePayload: { orderFillTransaction: fillTransaction },
        });
        await this.tradeRepository.save(trade);
        this.openTrades.set(trade.id, trade);
        await this.updateOrderIntent(intent.intentId, {
            status: "COMPLETED",
            tradeId: trade.id,
            brokerTradeId: String(oandaTradeId),
            resolvedAt: Date.now(),
            lastError: null,
            nextRetryAt: null,
        });

        if (takeProfit?.targetProfitAud) {
            logger.info(
                `✅ Take profit set: ${takeProfitPrice} (A$${takeProfit.targetProfitAud.toFixed(2)} target)`
            );
        }
        return trade;
    }

    async recoverPendingOrderIntents(openBrokerTrades = []) {
        if (!this.brokerLifecycleRepository) return;
        const intents =
            await this.brokerLifecycleRepository.getRecoverableIntents();
        for (const intent of intents) {
            if (intent.status === "PREPARED" && !intent.submittedAt) {
                // PREPARED is committed before SUBMITTING. Since the latter is
                // also committed before the HTTP call, a still-PREPARED record
                // is known never to have reached Oanda.
                await this.updateOrderIntent(intent.intentId, {
                    status: "ABANDONED",
                    lastError: "Process stopped before broker submission",
                    resolvedAt: Date.now(),
                });
                continue;
            }
            if (intent.tradeId && this.openTrades.has(intent.tradeId)) {
                await this.updateOrderIntent(intent.intentId, {
                    status: "COMPLETED",
                    resolvedAt: Date.now(),
                });
                continue;
            }

            const brokerTrade = openBrokerTrades.find(
                (trade) =>
                    String(trade.id) === String(intent.brokerTradeId || "") ||
                    trade?.clientExtensions?.id === intent.clientTradeId
            );
            let recovery = null;
            if (brokerTrade) {
                recovery = {
                    status: "OPEN_TRADE_FOUND",
                    orderFillTransaction: {
                        time: brokerTrade.openTime,
                        instrument: brokerTrade.instrument,
                        units: brokerTrade.initialUnits || brokerTrade.currentUnits,
                        price: brokerTrade.price,
                        tradeOpened: {
                            tradeID: brokerTrade.id,
                            units:
                                brokerTrade.initialUnits || brokerTrade.currentUnits,
                            price: brokerTrade.price,
                            initialMarginRequired:
                                brokerTrade.initialMarginRequired,
                        },
                    },
                };
            } else {
                recovery = await this.recoverOrderIntentOutcome(intent);
            }

            if (
                recovery.status === "FILLED" ||
                recovery.status === "OPEN_TRADE_FOUND"
            ) {
                try {
                    const trade = await this.buildEntryTradeFromFill(
                        intent,
                        recovery.orderFillTransaction,
                        { recovered: true }
                    );
                    this.emitEngineTelemetry("ambiguousOrderRecovered", {
                        intentId: intent.intentId,
                        tradeId: trade.id,
                        oandaTradeId: trade.oandaTradeId,
                    });
                } catch (error) {
                    await this.updateOrderIntent(intent.intentId, {
                        status: "RECOVERY_PENDING",
                        lastError: error.message,
                        nextRetryAt: Date.now() + 10000,
                    });
                }
            }
        }
    }

    async reconcileOrQuarantineBrokerTrade(brokerTrade) {
        let intent = null;
        if (this.brokerLifecycleRepository) {
            intent = await this.brokerLifecycleRepository.getIntentByBrokerTradeId(
                brokerTrade.id
            );
            if (!intent && brokerTrade?.clientExtensions?.id) {
                intent =
                    await this.brokerLifecycleRepository.getIntentByClientTradeId(
                        brokerTrade.clientExtensions.id
                    );
            }
        }

        if (intent?.contextPayload) {
            try {
                await this.buildEntryTradeFromFill(
                    intent,
                    {
                        time: brokerTrade.openTime,
                        instrument: brokerTrade.instrument,
                        units:
                            brokerTrade.initialUnits || brokerTrade.currentUnits,
                        price: brokerTrade.price,
                        tradeOpened: {
                            tradeID: brokerTrade.id,
                            units:
                                brokerTrade.initialUnits || brokerTrade.currentUnits,
                            price: brokerTrade.price,
                            initialMarginRequired:
                                brokerTrade.initialMarginRequired,
                        },
                    },
                    { recovered: true }
                );
                return;
            } catch (error) {
                logger.error(
                    `❌ Failed to import broker trade ${brokerTrade.id}: ${error.message}`
                );
            }
        }

        const units = toFiniteNumber(
            brokerTrade.currentUnits ?? brokerTrade.initialUnits,
            0
        );
        const quarantine = {
            brokerTradeId: String(brokerTrade.id),
            intentId: intent?.intentId || null,
            instrument: brokerTrade.instrument,
            side: units < 0 ? "SELL" : "BUY",
            units: Math.abs(units),
            status: "OPEN",
            reason: intent
                ? "KNOWN_INTENT_IMPORT_FAILED"
                : "UNMANAGED_BROKER_TRADE",
            brokerPayload: brokerTrade,
            lastSeenAt: Date.now(),
        };
        if (this.brokerLifecycleRepository) {
            await this.brokerLifecycleRepository.quarantineBrokerTrade(quarantine);
        }
        this.quarantinedBrokerTrades.set(String(brokerTrade.id), quarantine);
        this.emitEngineTelemetry("brokerTradeQuarantined", quarantine);
        logger.error(
            `🚨 Broker-only trade quarantined: ${brokerTrade.id} ${brokerTrade.instrument}`
        );
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

        const initialPlan = this.resolveStopLoss(signal, config);
        const {
            stopLossPips,
            stopLossPrice: initialStopLossPrice,
            source: stopLossSource,
        } = initialPlan;
        let plannedStopLossPrice = initialStopLossPrice;
        let plannedTakeProfitPrice = this.getPlannedTakeProfitPrice(signal);
        const configHash =
            signal.configHash ||
            config.configHash ||
            computeConfigHash(config);
        let intent = null;
        try {
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
                    "⚠️ Position size calculation returned 0 units - skipping trade"
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

            const instrumentMetadata =
                await this.getInstrumentMetadataForTrading(symbol, config);
            const finalQuote = await this.getFinalEntryQuote(
                signal,
                config,
                instrumentMetadata
            );
            const executablePlan = resolveCanonicalTradePlan({
                signal,
                config,
                entryPrice: finalQuote.finalQuote,
                pipValue: oandaClient.getPipValue(symbol),
            });
            if (executablePlan) {
                plannedStopLossPrice = Number(
                    oandaClient.formatPrice
                        ? oandaClient.formatPrice(
                              symbol,
                              executablePlan.stopLossPrice,
                              instrumentMetadata
                          )
                        : executablePlan.stopLossPrice.toFixed(5)
                );
                plannedTakeProfitPrice = Number.isFinite(
                    executablePlan.takeProfitPrice
                )
                    ? Number(
                          oandaClient.formatPrice
                              ? oandaClient.formatPrice(
                                    symbol,
                                    executablePlan.takeProfitPrice,
                                    instrumentMetadata
                                )
                              : executablePlan.takeProfitPrice.toFixed(5)
                      )
                    : null;
            }
            const { baseToAudRate, quoteToAudRate } =
                this.resolveAudConversionSnapshot(
                    symbol,
                    finalQuote.finalQuote,
                    finalQuote.pricing
                );
            if (
                !Number.isFinite(baseToAudRate) ||
                !Number.isFinite(quoteToAudRate)
            ) {
                throw new Error(`Unable to snapshot AUD conversion for ${symbol}`);
            }

            const accountSnapshot = await oandaClient.getAccountSummary();
            const accountCurrency = String(
                accountSnapshot?.account?.currency || "AUD"
            ).toUpperCase();
            if (accountCurrency !== "AUD") {
                throw new Error(
                    `Live account currency must be AUD; received ${accountCurrency}`
                );
            }

            const priceData = this.dataService.getCurrentPrice(symbol);
            const spreadPips = priceData?.spread || 0;
            const orderUnits = signal.signal === "SELL" ? -units : units;
            const intentId = uuidv4();
            const localTradeId = uuidv4();
            const extensions =
                typeof oandaClient.buildClientExtensions === "function"
                    ? oandaClient.buildClientExtensions(intentId)
                    : {
                          order: { id: `oi-${intentId}` },
                          trade: { id: `ti-${intentId}` },
                      };
            intent = {
                intentId,
                clientOrderId: extensions.order.id,
                clientTradeId: extensions.trade.id,
                decisionId,
                tradeId: localTradeId,
                lastTransactionId:
                    accountSnapshot?.lastTransactionID ||
                    accountSnapshot?.account?.lastTransactionID ||
                    null,
                status: "PREPARED",
                instrument: symbol,
                side: signal.signal === "SELL" ? "SELL" : "BUY",
                units,
                referencePrice: currentPrice,
                finalQuote: finalQuote.finalQuote,
                priceBound: finalQuote.priceBound,
                attemptCount: 0,
                requestPayload: {
                    instrument: symbol,
                    units: orderUnits,
                    stopLossPrice: plannedStopLossPrice,
                    takeProfitPrice: plannedTakeProfitPrice,
                    priceBound: finalQuote.priceBound,
                    positionFill: "OPEN_ONLY",
                },
                contextPayload: {
                    tradeId: localTradeId,
                    signal: JSON.parse(JSON.stringify(signal)),
                    config: JSON.parse(JSON.stringify(config)),
                    configHash,
                    stopLossPips,
                    initialStopLossPrice: plannedStopLossPrice,
                    stopLossSource,
                    plannedTakeProfitPrice,
                    spreadPips,
                    baseToAudRate,
                    quoteToAudRate,
                    instrumentMetadata,
                    finalQuote,
                },
                createdAt: Date.now(),
            };

            // The durable write is deliberately before ORDER_SUBMITTED and the
            // HTTP call. If this write fails, no broker mutation is attempted.
            if (this.brokerLifecycleRepository) {
                intent =
                    await this.brokerLifecycleRepository.createIntent(intent);
            }
            await this.updateEntryDecision(decisionId, {
                stage: ENTRY_DECISION_STAGES.ORDER_SUBMITTED,
                spreadPips,
                ...validationContext,
            });
            this.emitEngineTelemetry("orderSubmitted", {
                ...this.buildSignalTelemetry(signal, config),
                units,
                orderUnits,
                intentId,
                finalQuote: finalQuote.finalQuote,
                priceBound: finalQuote.priceBound,
                stopLossPrice: plannedStopLossPrice,
                takeProfitPrice: plannedTakeProfitPrice,
            });

            await this.updateOrderIntent(intentId, {
                status: "SUBMITTING",
                attemptCount: 1,
                submittedAt: Date.now(),
            });

            let orderResult;
            try {
                orderResult = await oandaClient.placeMarketOrder(
                    symbol,
                    orderUnits,
                    {
                        stopLossPrice: plannedStopLossPrice,
                        takeProfitPrice: plannedTakeProfitPrice,
                        priceBound: finalQuote.priceBound,
                        orderIntentId: intentId,
                        positionFill: "OPEN_ONLY",
                        instrumentMetadata,
                    }
                );
            } catch (submitError) {
                if (!submitError.ambiguous) {
                    await this.updateOrderIntent(intentId, {
                        status: "REJECTED",
                        lastError: submitError.message,
                        resolvedAt: Date.now(),
                    });
                    throw submitError;
                }

                await this.updateOrderIntent(intentId, {
                    status: "AMBIGUOUS",
                    lastError: submitError.message,
                    nextRetryAt: Date.now() + 5000,
                });
                const recovery = await this.recoverOrderIntentOutcome(intent);
                if (
                    recovery.status === "FILLED" ||
                    recovery.status === "OPEN_TRADE_FOUND"
                ) {
                    orderResult = {
                        orderFillTransaction: recovery.orderFillTransaction,
                        recovered: true,
                    };
                } else {
                    submitError.ambiguous = true;
                    throw submitError;
                }
            }

            let fillTransaction = orderResult?.orderFillTransaction;
            if (!fillTransaction) {
                await this.updateOrderIntent(intentId, {
                    status: "AMBIGUOUS",
                    responsePayload: orderResult || null,
                    lastError: "No fill transaction in broker response",
                    nextRetryAt: Date.now() + 5000,
                });
                const recovery = await this.recoverOrderIntentOutcome(intent);
                fillTransaction = recovery.orderFillTransaction;
                if (!fillTransaction) {
                    const error = new Error(
                        "Order outcome is ambiguous; reconciliation pending"
                    );
                    error.ambiguous = true;
                    throw error;
                }
            }
            await this.updateOrderIntent(intentId, {
                brokerOrderId:
                    orderResult?.orderCreateTransaction?.id ||
                    fillTransaction?.orderID ||
                    null,
                brokerTradeId: fillTransaction?.tradeOpened?.tradeID || null,
                responsePayload: orderResult,
                lastTransactionId:
                    orderResult?.lastTransactionID || intent.lastTransactionId,
            });
            const trade = await this.buildEntryTradeFromFill(
                intent,
                fillTransaction,
                {
                    recovered: orderResult?.recovered === true,
                    orderResult,
                }
            );

            await this.updateEntryDecision(decisionId, {
                stage: ENTRY_DECISION_STAGES.FILLED,
                outcome: ENTRY_DECISION_OUTCOMES.FILLED,
                tradeId: trade.id,
                spreadPips,
                ...validationContext,
            });

            // Update stats
            this.stats.tradesExecuted++;
            this.stats.lastTradeTime = Date.now();
            this.emitEngineTelemetry("filled", {
                ...this.buildSignalTelemetry(signal, config),
                tradeId: trade.id,
                oandaTradeId: trade.oandaTradeId,
                units,
                fillPrice: trade.entryPrice,
                stopLossPrice: trade.stopLossPrice,
                takeProfitPrice: trade.takeProfitPrice,
                configHash,
                intentId,
            });

            // Broadcast trade event
            this.broadcastTradeOpened(trade);

            const tpInfo = trade.takeProfitPrice
                ? ` | TP: ${trade.takeProfitPrice}`
                : "";
            logger.success(
                `✅ LIVE ${trade.side} executed: ${symbol} @ ${trade.entryPrice} | Units: ${units} | SL: ${trade.stopLossPrice}${tpInfo}`
            );

            return trade;
        } catch (error) {
            logger.error(
                `❌ Order execution failed for ${symbol}:`,
                error.message
            );
            this.stats.errors++;
            this.emit("orderError", { signal, error: error.message });
            if (!error.ambiguous) {
                await this.rejectEntryDecision(decisionId, {
                    rejectionCode: ENTRY_REJECTION_CODES.ORDER_SUBMIT_FAILED,
                    rejectionReason: error.message,
                    ...validationContext,
                });
            } else {
                await this.updateEntryDecision(decisionId, {
                    stage: ENTRY_DECISION_STAGES.ORDER_SUBMITTED,
                    outcome: ENTRY_DECISION_OUTCOMES.PENDING,
                    rejectionReason: error.message,
                    ...validationContext,
                });
            }
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

        if (!trade.oandaTradeId) {
            await this.markTradeReconciliationPending(
                trade,
                "CLOSE_RETRY_PENDING",
                {
                    closeAttempt: {
                        reason,
                        error: "Trade has no Oanda trade ID",
                        attemptedAt: Date.now(),
                    },
                }
            );
            return null;
        }

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
            logger.warn(`⚠️ Error closing trade on Oanda: ${error.message}`);
            closeContext.reconciliationStatus = "UNRESOLVED";
            closeContext.brokerConfirmedClosed = false;
            closeContext.brokerReconciliationPayload = {
                closeAttempt: {
                    error: error.message,
                    type: error.name || "Error",
                    ambiguous: error.ambiguous === true,
                    attemptedAt: Date.now(),
                },
            };
        }

        if (!closeContext.brokerConfirmedClosed) {
            // A lost close response may still have filled. Query the trade before
            // deciding whether to retry; never mark it closed on a local quote.
            try {
                const tradeDetails = await oandaClient.getTrade(
                    trade.oandaTradeId
                );
                const recovered = this.tradeReconciliation.resolveExternalClose({
                    localTrade: trade,
                    tradeDetails,
                    fallbackExitPrice: exitPrice,
                    fallbackPriceSource: "LOCAL_MARKET_FALLBACK",
                    fallbackExitReason: reason,
                });
                if (recovered.brokerConfirmedClosed) {
                    closeContext = recovered;
                }
            } catch (lookupError) {
                closeContext.brokerReconciliationPayload = {
                    ...(closeContext.brokerReconciliationPayload || {}),
                    closeLookup: {
                        error: lookupError.message,
                        type: lookupError.name || "Error",
                        attemptedAt: Date.now(),
                    },
                };
            }
        }

        if (!closeContext.brokerConfirmedClosed) {
            const previousRetry =
                trade?.brokerReconciliationPayload?.closeRetry || {};
            const attempts = (Number(previousRetry.attempts) || 0) + 1;
            closeContext.brokerReconciliationPayload = {
                ...(closeContext.brokerReconciliationPayload || {}),
                closeRetry: {
                    reason,
                    fallbackExitPrice: exitPrice,
                    attempts,
                    nextRetryAt:
                        Date.now() +
                        Math.min(60000, 5000 * 2 ** (attempts - 1)),
                },
            };
            await this.markTradeReconciliationPending(
                trade,
                "CLOSE_RETRY_PENDING",
                closeContext.brokerReconciliationPayload
            );
            return null;
        }

        return this.closeTrade(
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

        if (
            closeContext.brokerConfirmedClosed === false ||
            ["UNRESOLVED", "PARTIAL_CLOSE", "CLOSE_RETRY_PENDING"].includes(
                closeContext.reconciliationStatus
            )
        ) {
            await this.markTradeReconciliationPending(
                trade,
                "CLOSE_RETRY_PENDING",
                closeContext.brokerReconciliationPayload
            );
            return null;
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
        const brokerReconciliationPayload = this.mergeBrokerPayload(trade, {
            close: closeContext.brokerReconciliationPayload || null,
            closeCosts: {
                grossRealizedPL: closeContext.oandaGrossRealizedPL ?? null,
                financing: closeContext.oandaFinancing ?? 0,
                commission: closeContext.oandaCommission ?? 0,
                guaranteedExecutionFee:
                    closeContext.oandaGuaranteedExecutionFee ?? 0,
                dividendAdjustment: closeContext.oandaDividendAdjustment ?? 0,
            },
        });

        // Calculate P/L - use Oanda's realizedPL if available (includes all costs)
        const pipValue = oandaClient.getPipValue(trade.instrument);
        // Direction-aware: BUY profits when price rises, SELL profits when price falls
        const priceChange = trade.side === 'BUY'
            ? exitPrice - trade.entryPrice
            : trade.entryPrice - exitPrice;
        const pnlPips = priceChange / pipValue;

        // Use Oanda's realizedPL as source of truth when available
        // This includes spreads, currency conversion, and all fees
        let fallbackQuoteToAudRate = toFiniteNumber(
            trade?.brokerReconciliationPayload?.liveRuntime?.quoteToAudRate,
            null
        );
        if (!Number.isFinite(fallbackQuoteToAudRate)) {
            const [, quoteCurrency] = trade.instrument.split("_");
            fallbackQuoteToAudRate = await this.getConversionRate(
                quoteCurrency,
                "AUD",
                { instrument: trade.instrument, entryPrice: exitPrice }
            );
        }
        const explicitBrokerAdjustments =
            toFiniteNumber(closeContext.oandaFinancing, 0) +
            toFiniteNumber(closeContext.oandaCommission, 0) +
            toFiniteNumber(closeContext.oandaGuaranteedExecutionFee, 0) +
            toFiniteNumber(closeContext.oandaDividendAdjustment, 0);
        const pnlAud =
            closeContext.oandaRealizedPL !== null &&
                closeContext.oandaRealizedPL !== undefined
                ? closeContext.oandaRealizedPL
                : trade.units * priceChange * fallbackQuoteToAudRate +
                  explicitBrokerAdjustments;

        const pnlPercent = (pnlAud / trade.entryCostAud) * 100;

        // Extract financing (swap) charges
        const swapAud = closeContext.oandaFinancing || 0;
        const commissionAud = closeContext.oandaCommission || 0;

        let exitBaseToAudRate = toFiniteNumber(
            trade?.brokerReconciliationPayload?.liveRuntime?.baseToAudRate,
            null
        );
        try {
            exitBaseToAudRate = await this.getInstrumentBaseToAccountRate(
                trade.instrument,
                "AUD",
                exitPrice
            );
        } catch (error) {
            if (!Number.isFinite(exitBaseToAudRate)) throw error;
        }
        const exitValueAud = trade.units * exitBaseToAudRate;

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
            commissionAud,
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
            exitValueAud,
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            swapAud,
            commissionAud,
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
        if (this.isMonitoringPositions) {
            return;
        }

        this.isMonitoringPositions = true;

        try {
            const config = this.configService.get();

            for (const [tradeId, trade] of this.openTrades) {
                try {
                    await this.checkPosition(
                        trade,
                        this.getOwnerExitConfig(trade, config)
                    );
                } catch (error) {
                    logger.error(
                        `❌ Error monitoring position ${tradeId}:`,
                        error.message
                    );
                }
            }

            // Sync with Oanda periodically
            await this.syncWithOanda();
        } finally {
            this.isMonitoringPositions = false;
        }
    }

    /**
     * Check a single position for stop loss, trailing stop updates
     */
    async checkPosition(trade, config) {
        config = this.getOwnerExitConfig(trade, config);
        const priceData = this.dataService.getCurrentPrice(trade.instrument);
        if (!priceData) return;

        const currentPrice = priceData.price;

        if (trade.reconciliationStatus === "CLOSE_RETRY_PENDING") {
            await this.retryPendingClose(trade, currentPrice);
            if (!this.openTrades.has(trade.id)) return;
        }

        await this.retryPendingStopUpdate(trade);

        // Breakeven protection: move stop to entry once trade is in sufficient profit
        if (config.enableBreakeven) {
            await this.updateBreakevenStop(trade, currentPrice, config);
        }

        // Update trailing stop if enabled (works for both BUY and SELL)
        if (config.enableTrailingStops) {
            await this.updateTrailingStop(trade, currentPrice, config);
        }
    }

    isMonotonicStopImprovement(trade, candidatePrice) {
        const activeStop = toFiniteNumber(trade.stopLossPrice, null);
        if (!Number.isFinite(activeStop)) return true;
        return trade.side === "BUY"
            ? candidatePrice > activeStop
            : candidatePrice < activeStop;
    }

    async applyBrokerStopUpdate(
        trade,
        desiredPrice,
        stopType,
        localUpdates = {},
        retryState = null
    ) {
        if (!Number.isFinite(desiredPrice)) return false;
        if (!this.isMonotonicStopImprovement(trade, desiredPrice)) {
            return false;
        }

        const attempts = (retryState?.attempts || 0) + 1;
        try {
            if (!trade.oandaTradeId) {
                throw new Error("Trade has no Oanda trade ID");
            }
            const metadata = await this.getInstrumentMetadataForTrading(
                trade.instrument,
                this.getOwnerExitConfig(trade, {})
            );
            await oandaClient.modifyTrade(trade.oandaTradeId, {
                stopLossPrice: desiredPrice,
                instrument: trade.instrument,
                instrumentMetadata: metadata,
            });

            const brokerReconciliationPayload = this.mergeBrokerPayload(trade, {
                stopUpdate: null,
            });
            const updates = {
                ...localUpdates,
                stopLossPrice: desiredPrice,
                activeStopType: stopType,
                lastBrokerSyncAt: Date.now(),
                reconciliationStatus: "OPEN",
                brokerReconciliationPayload,
            };
            Object.assign(trade, updates);
            await this.tradeRepository.updateTrade(trade.id, updates);
            this.emitEngineTelemetry("stopUpdated", {
                tradeId: trade.id,
                instrument: trade.instrument,
                side: trade.side,
                stopType,
                stopLossPrice: desiredPrice,
                trailingStopPrice: updates.trailingStopPrice ?? null,
                configHash: trade.configHash || null,
            });
            return true;
        } catch (error) {
            const delayMs = Math.min(60000, 5000 * 2 ** (attempts - 1));
            const stopUpdate = {
                status: "RETRY_PENDING",
                desiredPrice,
                stopType,
                localUpdates,
                attempts,
                lastError: error.message,
                attemptedAt: Date.now(),
                nextRetryAt: Date.now() + delayMs,
            };
            const brokerReconciliationPayload = this.mergeBrokerPayload(trade, {
                stopUpdate,
            });
            trade.reconciliationStatus = "STOP_UPDATE_RETRY_PENDING";
            trade.brokerReconciliationPayload = brokerReconciliationPayload;
            await this.tradeRepository.updateTrade(trade.id, {
                reconciliationStatus: "STOP_UPDATE_RETRY_PENDING",
                lastBrokerSyncAt: Date.now(),
                brokerReconciliationPayload,
            });
            logger.error(
                `❌ Broker stop update pending retry for ${trade.instrument}: ${error.message}`
            );
            return false;
        }
    }

    async retryPendingStopUpdate(trade) {
        const pending = trade?.brokerReconciliationPayload?.stopUpdate;
        if (pending?.status !== "RETRY_PENDING") return false;
        if (
            Number.isFinite(Number(pending.nextRetryAt)) &&
            Number(pending.nextRetryAt) > Date.now()
        ) {
            return false;
        }
        return this.applyBrokerStopUpdate(
            trade,
            Number(pending.desiredPrice),
            pending.stopType || "BROKER_STOP_RETRY",
            pending.localUpdates || {},
            pending
        );
    }

    async retryPendingClose(trade, currentPrice) {
        const pending = trade?.brokerReconciliationPayload?.closeRetry;
        if (!pending || !trade.oandaTradeId) return false;
        if (
            Number.isFinite(Number(pending.nextRetryAt)) &&
            Number(pending.nextRetryAt) > Date.now()
        ) {
            return false;
        }

        try {
            const tradeDetails = await oandaClient.getTrade(trade.oandaTradeId);
            const resolved = this.tradeReconciliation.resolveExternalClose({
                localTrade: trade,
                tradeDetails,
                fallbackExitPrice: currentPrice,
                fallbackPriceSource: "LOCAL_MARKET_FALLBACK",
                fallbackExitReason: pending.reason || "EXTERNAL",
            });
            if (resolved.brokerConfirmedClosed) {
                await this.closeTrade(
                    trade.id,
                    resolved.exitPrice,
                    resolved.exitReason,
                    resolved
                );
                return true;
            }

            return Boolean(
                await this.executeExit(
                    trade,
                    currentPrice,
                    pending.reason || "RETRY_CLOSE"
                )
            );
        } catch (error) {
            const attempts = (Number(pending.attempts) || 0) + 1;
            const brokerReconciliationPayload = this.mergeBrokerPayload(trade, {
                closeRetry: {
                    ...pending,
                    attempts,
                    lastError: error.message,
                    nextRetryAt:
                        Date.now() +
                        Math.min(60000, 5000 * 2 ** (attempts - 1)),
                },
            });
            trade.brokerReconciliationPayload = brokerReconciliationPayload;
            await this.tradeRepository.updateTrade(trade.id, {
                reconciliationStatus: "CLOSE_RETRY_PENDING",
                lastBrokerSyncAt: Date.now(),
                brokerReconciliationPayload,
                isOpen: true,
            });
            return false;
        }
    }

    /**
     * Move stop to breakeven once profit reaches configured trigger
     */
    async updateBreakevenStop(trade, currentPrice, config) {
        if (trade.breakevenHit) return;

        const pipValue = oandaClient.getPipValue(trade.instrument);
        const liveRuntime = this.getLiveRuntimeMetadata(trade);
        const activationDistance = resolveBreakevenDistance({
            trade,
            policy: this.getOwnerExitPolicy(trade, config),
            pipValue,
            runtimeMetadata: liveRuntime,
        });
        if (!Number.isFinite(activationDistance) || activationDistance <= 0) {
            return;
        }

        const isBuy = trade.side === "BUY";

        const profitDistance = isBuy
            ? currentPrice - trade.entryPrice
            : trade.entryPrice - currentPrice;

        if (profitDistance < activationDistance) {
            return;
        }

        const breakevenPrice = trade.entryPrice;
        if (!this.isMonotonicStopImprovement(trade, breakevenPrice)) {
            return;
        }
        const trailingStop = trade.trailingStopPrice;
        const shouldRaiseTrailingToBreakeven = isBuy
            ? trailingStop && trailingStop < breakevenPrice
            : trailingStop && trailingStop > breakevenPrice;

        const updatePayload = {
            breakevenHit: true,
        };

        if (shouldRaiseTrailingToBreakeven) {
            updatePayload.trailingStopPrice = breakevenPrice;
        }

        const updated = await this.applyBrokerStopUpdate(
            trade,
            breakevenPrice,
            "BREAKEVEN",
            updatePayload
        );
        if (!updated) return;

        logger.info(
            `🛡️ Breakeven activated for ${trade.instrument} (${trade.side}): SL moved to ${breakevenPrice.toFixed(5)}`
        );
    }

    /**
     * Update trailing stop for a position (works for both BUY and SELL)
     */
    async updateTrailingStop(trade, currentPrice, config) {
        const pipValue = oandaClient.getPipValue(trade.instrument);
        const liveRuntime = this.getLiveRuntimeMetadata(trade);
        const { activationDistance, trailDistance: trailingDistance } =
            resolveTrailingStopDistances({
            trade,
            policy: this.getOwnerExitPolicy(trade, config),
            pipValue,
            runtimeMetadata: liveRuntime,
            });
        if (
            !Number.isFinite(activationDistance) ||
            activationDistance <= 0 ||
            !Number.isFinite(trailingDistance) ||
            trailingDistance <= 0
        ) {
            return;
        }

        const isBuy = trade.side === "BUY";

        const profitDistance = isBuy
            ? currentPrice - trade.entryPrice
            : trade.entryPrice - currentPrice;

        if (profitDistance < activationDistance) {
            return; // Not in profit enough to activate trailing
        }

        // Calculate new trailing stop price (direction-aware)
        // BUY: stop is BELOW current price, moves UP
        // SELL: stop is ABOVE current price, moves DOWN
        const newStopLossPrice = calculateMonotonicStop({
            trade,
            currentPrice,
            trailDistance: trailingDistance,
        });
        if (!Number.isFinite(newStopLossPrice)) return;

        // Check if we should update (stop should only move in favorable direction)
        // BUY: new stop must be HIGHER than current
        // SELL: new stop must be LOWER than current
        const shouldUpdate = this.isMonotonicStopImprovement(
            trade,
            newStopLossPrice
        );

        if (shouldUpdate) {
            const previousStop = trade.stopLossPrice;

            // Track extreme price (highest for BUY, lowest for SELL)
            let highestPrice = trade.highestPrice;
            let lowestPrice = trade.lowestPrice;
            if (isBuy) {
                highestPrice = Math.max(
                    trade.highestPrice || trade.entryPrice,
                    currentPrice
                );
            } else {
                lowestPrice = Math.min(
                    trade.lowestPrice || trade.entryPrice,
                    currentPrice
                );
            }

            const updated = await this.applyBrokerStopUpdate(
                trade,
                newStopLossPrice,
                "TRAILING",
                {
                trailingStopPrice: newStopLossPrice,
                    highestPrice,
                    lowestPrice,
                }
            );
            if (!updated) return;

            logger.info(
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
    async liquidateOpenTrades(exitReason = "LIVE_OPERATOR_EXIT") {
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
            quarantinedBrokerPositions: this.quarantinedBrokerTrades.size,
            maxPositions: config.maxOpenPositions,
            entryRisk: this.entryRiskState,
            stats: this.stats,
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
            brokerQuarantines: Array.from(
                this.quarantinedBrokerTrades.values()
            ),
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
