const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { RUNTIME_MODES, RUN_STATUSES } = require("../runtime/runtimeConstants");
const { getStrategyDefinition } = require("../strategies");
const {
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    resolveBreakevenDistance,
    resolveOwnerRunExitPolicy,
    resolveTimedExitReason,
    resolveTrailingStopDistances,
} = require("../runtime/exitPolicy");
const {
    calculateCanonicalPositionSize,
    calculateProjectedExposure,
    resolveCanonicalTradePlan,
    resolveLeverage,
} = require("../runtime/executionPolicy");
const {
    ACCOUNT_CURRENCY,
    AudCurrencyConverter,
    CurrencyConversionError,
    getInstrumentCurrencies,
} = require("../runtime/currencyConversion");
const { calculatePaperNetPnl } = require("../runtime/tradingCostModel");
const {
    ENTRY_REJECTION_CODES,
    ENTRY_DECISION_STAGES,
    ENTRY_DECISION_OUTCOMES,
} = require("../constants/entryDecisionCodes");
const {
    computeConfigHash,
    normalizeTradingConfig,
} = require("../config/tradingConfig");

const PAPER_MODES = new Set([
    RUNTIME_MODES.PAPER_SHADOW,
    RUNTIME_MODES.PAPER_CANDIDATE,
]);

// Realistic paper execution costs. Paper previously filled at idealized prices
// (zero slippage; stops exactly at the trigger), which made paper P&L diverge in
// sign from live for the same strategy and caused losers to be promoted to live.
// Calibrated against paired paper_shadow-vs-live per-pip data in Phase 1.
// Same-rule pairs already tracked within roughly a pip after bid/ask crossing;
// keep a small non-zero execution haircut without masking exit-rule mismatches.
// Any explicit config value (incl. 0) overrides these defaults.
const DEFAULT_PAPER_ENTRY_SLIPPAGE_PIPS = 0.25;
const DEFAULT_PAPER_EXIT_SLIPPAGE_PIPS = 0.25;
// Stops slip *through* the trigger on adverse moves, filling worse than the stop
// price. Modeled separately from market (entry/exit) slippage.
const DEFAULT_PAPER_STOP_SLIPPAGE_PIPS = 0.5;

function isPaperMode(mode) {
    return PAPER_MODES.has(mode);
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalFiniteNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSessionName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
}

function isWithinActiveSession(hourUtc, activeSessions = []) {
    const sessionHours = {
        sydney: { start: 21, end: 6 },
        tokyo: { start: 0, end: 9 },
        london: { start: 7, end: 16 },
        newyork: { start: 12, end: 21 },
    };

    return activeSessions.map(normalizeSessionName).some((sessionName) => {
        const session = sessionHours[sessionName];
        if (!session) return false;

        if (session.start > session.end) {
            return hourUtc >= session.start || hourUtc < session.end;
        }

        return hourUtc >= session.start && hourUtc < session.end;
    });
}

function isEntrySignal(signal) {
    if (!signal) return false;
    if (signal.signal !== "BUY" && signal.signal !== "SELL") return false;
    if (signal.entryEnabled === false) return false;
    if (signal.entryType === "EXIT_ONLY") return false;
    if (signal.signalClass === "COOLDOWN") return false;
    if (signal.cooldownSuppressed === true) return false;
    if (typeof signal.intent === "string" && signal.intent.startsWith("EXIT_")) {
        return false;
    }
    return true;
}

function shouldCloseTradeForSignal(trade, signal) {
    if (!trade || !signal) return false;
    if (trade.side === "BUY" && signal.signal === "SELL") return true;
    if (trade.side === "SELL" && signal.signal === "BUY") return true;
    return false;
}

class PaperTradingRuntime {
    constructor(options = {}) {
        this.runtimeCoordinator = options.runtimeCoordinator || null;
        this.tradeRepository = options.tradeRepository || null;
        this.signalRepository = options.signalRepository || null;
        this.entryDecisionRepository = options.entryDecisionRepository || null;
        this.portfolioRepository = options.portfolioRepository || null;
        this.dataService = options.dataService || null;
        this.io = options.io || null;
        this.currencyConverter = options.currencyConverter || null;
        this.homeConversionProvider = options.homeConversionProvider || null;
        this.paperStartingBalanceAud =
            options.paperStartingBalanceAud || 10000;

        this._runQueue = new Map();
        this._paperEntryDecisionContexts = new Map();
        this._boundRunSignalsGenerated = null;
        this._boundRunStarted = null;
        this._boundRunStopped = null;
        this.isRunning = false;
    }

    init({
        runtimeCoordinator = null,
        tradeRepository = null,
        signalRepository = null,
        entryDecisionRepository = null,
        portfolioRepository = null,
        dataService = null,
        io = null,
    } = {}) {
        this.runtimeCoordinator = runtimeCoordinator || this.runtimeCoordinator;
        this.tradeRepository = tradeRepository || this.tradeRepository;
        this.signalRepository = signalRepository || this.signalRepository;
        this.entryDecisionRepository =
            entryDecisionRepository || this.entryDecisionRepository;
        this.portfolioRepository =
            portfolioRepository || this.portfolioRepository;
        this.dataService = dataService || this.dataService;
        this.io = io || this.io;
        return this;
    }

    async start() {
        if (this.isRunning) return;
        if (!this.runtimeCoordinator || !this.tradeRepository || !this.portfolioRepository) {
            throw new Error(
                "Paper trading runtime not properly initialized - missing dependencies"
            );
        }

        this._boundRunSignalsGenerated = this.handleRunSignalsGenerated.bind(this);
        this._boundRunStarted = this.handleRunStarted.bind(this);
        this._boundRunStopped = this.handleRunStopped.bind(this);

        this.runtimeCoordinator.on(
            "runSignalsGenerated",
            this._boundRunSignalsGenerated
        );
        this.runtimeCoordinator.on("runStarted", this._boundRunStarted);
        this.runtimeCoordinator.on("runStopped", this._boundRunStopped);
        this.isRunning = true;

        const activePaperRuns = this.runtimeCoordinator
            .listRuns()
            .filter((run) => isPaperMode(run.mode));
        await Promise.all(
            activePaperRuns.map((run) => this.ensureRunSnapshot(run.runId))
        );
    }

    stop() {
        if (!this.isRunning) return;

        if (this.runtimeCoordinator && this._boundRunSignalsGenerated) {
            this.runtimeCoordinator.removeListener(
                "runSignalsGenerated",
                this._boundRunSignalsGenerated
            );
        }
        if (this.runtimeCoordinator && this._boundRunStarted) {
            this.runtimeCoordinator.removeListener(
                "runStarted",
                this._boundRunStarted
            );
        }
        if (this.runtimeCoordinator && this._boundRunStopped) {
            this.runtimeCoordinator.removeListener(
                "runStopped",
                this._boundRunStopped
            );
        }

        this._boundRunSignalsGenerated = null;
        this._boundRunStarted = null;
        this._boundRunStopped = null;
        this.isRunning = false;
    }

    queueRunOperation(runId, operation) {
        const previous = this._runQueue.get(runId) || Promise.resolve();
        const next = previous
            .then(() => operation())
            .catch((error) => {
                logger.error(`Paper runtime operation failed for ${runId}:`, error);
            })
            .finally(() => {
                if (this._runQueue.get(runId) === next) {
                    this._runQueue.delete(runId);
                }
            });

        this._runQueue.set(runId, next);
        return next;
    }

    handleRunStarted(run) {
        if (!isPaperMode(run?.mode)) return;
        return this.queueRunOperation(run.runId, async () => {
            await this.ensureRunSnapshot(run.runId);
        });
    }

    handleRunStopped(run) {
        if (!isPaperMode(run?.mode)) return;
        return this.queueRunOperation(run.runId, async () => {
            await this.closeOpenTradesForRun(
                run.runId,
                run.mode,
                "RUN_STOPPED"
            );
            this.emitPaperRunUpdated(run);
        });
    }

    handleRunSignalsGenerated(event = {}) {
        if (!isPaperMode(event.mode) || !event.runId) {
            return null;
        }

        return this.queueRunOperation(event.runId, async () => {
            const session = this.runtimeCoordinator?.getRunSession?.(event.runId);
            if (!session || session.run.status !== RUN_STATUSES.ACTIVE) {
                return;
            }

            await this.processRunSession(session, event.signals || []);
        });
    }

    async processRunSession(session, signals = []) {
        const run = session.run;
        const config = this.getResolvedRunConfig(
            run,
            session.generator?.config || run.configSnapshot || {}
        );
        const openTrades = await this.tradeRepository.getOpenTrades({
            mode: run.mode,
            runId: run.runId,
        });
        const tradeByInstrument = new Map(
            openTrades.map((trade) => [trade.instrument, trade])
        );

        for (const trade of openTrades) {
            const closed = await this.evaluateOpenTrade(trade, config);
            if (closed) {
                tradeByInstrument.delete(trade.instrument);
            }
        }

        for (const signal of signals) {
            let openTrade = tradeByInstrument.get(signal.symbol) || null;

            if (openTrade && shouldCloseTradeForSignal(openTrade, signal)) {
                const exitPrice = this.getPaperExitPrice(
                    openTrade,
                    config,
                    signal.currentPrice
                );
                const closedTrade = await this.closeTrade(
                    openTrade,
                    exitPrice.price,
                    "SIGNAL_REVERSAL",
                    exitPrice
                );

                if (closedTrade) {
                    tradeByInstrument.delete(signal.symbol);
                    openTrade = null;
                }
            }

            if (!isEntrySignal(signal)) {
                continue;
            }

            const entryDecision = await this.createPaperEntryDecision(
                run,
                signal,
                config,
                { openPositions: tradeByInstrument.size }
            );
            const decisionId = entryDecision?.decisionId || null;

            if (openTrade) {
                await this.rejectPaperEntryDecision(decisionId, {
                    rejectionCode: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                    rejectionReason: "Already in position for this instrument",
                    openPositions: tradeByInstrument.size,
                });
                continue;
            }

            const validation = await this.validateEntrySignal(
                run,
                config,
                signal,
                tradeByInstrument
            );
            if (!validation.valid) {
                logger.info(
                    `[paper:${run.runId}] Entry rejected for ${signal.symbol}: ${validation.reason}`
                );
                await this.rejectPaperEntryDecision(decisionId, {
                    rejectionCode:
                        validation.code || ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                    rejectionReason: validation.reason,
                    openPositions: tradeByInstrument.size,
                    ...(validation.context || {}),
                });
                continue;
            }

            await this.updatePaperEntryDecision(decisionId, {
                stage: ENTRY_DECISION_STAGES.VALIDATED,
                openPositions: tradeByInstrument.size,
                ...(validation.context || {}),
            });

            const trade = await this.openTradeFromSignal(
                run,
                config,
                signal,
                Array.from(tradeByInstrument.values()),
                decisionId
            );
            if (trade) {
                tradeByInstrument.set(trade.instrument, trade);
            }
        }

        await this.saveRunSnapshot(run, config);
    }

    getPipValue(instrument) {
        const pipValue = this.dataService?.getPipValue?.(instrument);
        if (Number.isFinite(Number(pipValue))) {
            return Number(pipValue);
        }

        return instrument?.includes("JPY") ? 0.01 : 0.0001;
    }

    getInstrumentCurrencies(instrument) {
        return getInstrumentCurrencies(instrument);
    }

    getAccountCurrency() {
        return ACCOUNT_CURRENCY;
    }

    getCurrencyConverter() {
        if (!this.currencyConverter) {
            this.currencyConverter = new AudCurrencyConverter({
                priceProvider: (instrument) =>
                    this.getCurrentPriceData(instrument),
                homeConversionProvider: (currency, options) => {
                    if (this.homeConversionProvider) {
                        return this.homeConversionProvider(currency, options);
                    }
                    return (
                        this.dataService?.getHomeConversion?.(currency) ??
                        this.dataService?.getHomeConversionRate?.(
                            currency,
                            options
                        )
                    );
                },
            });
        } else {
            this.currencyConverter.setPriceProvider?.((instrument) =>
                this.getCurrentPriceData(instrument)
            );
        }
        return this.currencyConverter;
    }

    seedHomeConversions(homeConversions, updatedAt = Date.now()) {
        this.getCurrencyConverter().seedHomeConversions(
            homeConversions,
            updatedAt
        );
    }

    getCurrentPriceData(instrument) {
        return this.dataService?.getCurrentPrice?.(instrument) || null;
    }

    getMidPriceFromPriceData(priceData) {
        if (!priceData) return null;
        const directMid = toOptionalFiniteNumber(priceData.price);
        if (Number.isFinite(directMid)) return directMid;

        const mid = toOptionalFiniteNumber(priceData.mid);
        if (Number.isFinite(mid)) return mid;

        const bid = toOptionalFiniteNumber(priceData.bid);
        const ask = toOptionalFiniteNumber(priceData.ask);
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
            return (bid + ask) / 2;
        }

        return Number.isFinite(bid) ? bid : ask;
    }

    getBidAskFromPriceData(instrument, priceData) {
        const pipValue = this.getPipValue(instrument);
        const mid = this.getMidPriceFromPriceData(priceData);
        const spreadPips = toOptionalFiniteNumber(priceData?.spread);
        const halfSpread =
            Number.isFinite(spreadPips) && spreadPips >= 0
                ? (spreadPips * pipValue) / 2
                : 0;

        let bid = toOptionalFiniteNumber(priceData?.bid);
        let ask = toOptionalFiniteNumber(priceData?.ask);

        if (!Number.isFinite(bid) && Number.isFinite(mid)) {
            bid = mid - halfSpread;
        }
        if (!Number.isFinite(ask) && Number.isFinite(mid)) {
            ask = mid + halfSpread;
        }
        if (!Number.isFinite(bid) && Number.isFinite(ask)) {
            bid = ask - halfSpread * 2;
        }
        if (!Number.isFinite(ask) && Number.isFinite(bid)) {
            ask = bid + halfSpread * 2;
        }

        return {
            bid,
            ask,
            mid,
            spreadPips,
        };
    }

    getPaperSlippagePips(config = {}, action = "entry") {
        const actionSpecific =
            action === "exit"
                ? config.paperExitSlippagePips
                : config.paperEntrySlippagePips;
        const actionDefault =
            action === "exit"
                ? DEFAULT_PAPER_EXIT_SLIPPAGE_PIPS
                : DEFAULT_PAPER_ENTRY_SLIPPAGE_PIPS;
        return Math.max(
            0,
            toFiniteNumber(
                actionSpecific,
                toFiniteNumber(
                    config.paperSlippagePips,
                    toFiniteNumber(config.slippagePips, actionDefault)
                )
            )
        );
    }

    getPaperStopSlippagePips(config = {}) {
        return Math.max(
            0,
            toFiniteNumber(
                config.paperStopSlippagePips,
                DEFAULT_PAPER_STOP_SLIPPAGE_PIPS
            )
        );
    }

    resolvePaperExecutionPrice({
        instrument,
        side,
        action,
        config = {},
        fallbackPrice = null,
        applySlippage = true,
    }) {
        const priceData = this.getCurrentPriceData(instrument);
        const { bid, ask, mid, spreadPips } = this.getBidAskFromPriceData(
            instrument,
            priceData
        );
        const isEntry = action === "entry";
        const buysLiquidity =
            (isEntry && side === "BUY") || (!isEntry && side === "SELL");
        const basePrice = buysLiquidity ? ask : bid;
        const fallback =
            fallbackPrice === null || fallbackPrice === undefined
                ? mid
                : fallbackPrice;
        let price = Number.isFinite(basePrice)
            ? basePrice
            : toFiniteNumber(fallback, mid);
        let priceSource = buysLiquidity ? "PAPER_ASK" : "PAPER_BID";

        if (!Number.isFinite(basePrice)) {
            priceSource = "PAPER_FALLBACK";
        }

        const liquidityPrice = price;
        const slippagePips = applySlippage
            ? this.getPaperSlippagePips(config, action)
            : 0;
        const slippageDistance = slippagePips * this.getPipValue(instrument);
        if (Number.isFinite(price) && slippageDistance > 0) {
            price += buysLiquidity ? slippageDistance : -slippageDistance;
            priceSource = `${priceSource}_WITH_SLIPPAGE`;
        }

        return {
            price,
            priceData,
            priceSource,
            spreadPips,
            slippagePips,
            liquidityPrice,
            mid,
            bid,
            ask,
        };
    }

    getPaperEntryPrice(signal, config = {}) {
        return this.resolvePaperExecutionPrice({
            instrument: signal.symbol,
            side: signal.signal === "SELL" ? "SELL" : "BUY",
            action: "entry",
            config,
            fallbackPrice: signal.currentPrice,
        });
    }

    getPaperExitPrice(trade, config = {}, fallbackPrice = null) {
        return this.resolvePaperExecutionPrice({
            instrument: trade.instrument,
            side: trade.side,
            action: "exit",
            config,
            fallbackPrice:
                fallbackPrice === null || fallbackPrice === undefined
                    ? trade.entryPrice
                    : fallbackPrice,
        });
    }

    getPaperLiquidationPrice(trade, fallbackPrice = null) {
        return this.resolvePaperExecutionPrice({
            instrument: trade.instrument,
            side: trade.side,
            action: "exit",
            config: {},
            fallbackPrice:
                fallbackPrice === null || fallbackPrice === undefined
                    ? trade.entryPrice
                    : fallbackPrice,
            applySlippage: false,
        });
    }

    getCurrentPrice(instrument) {
        return this.getMidPriceFromPriceData(this.getCurrentPriceData(instrument));
    }

    getConversionRate(
        fromCurrency,
        toCurrency,
        { instrument = null, price = null, purpose = "neutral", amount = 0 } = {}
    ) {
        return this.getCurrencyConverter().getRate(fromCurrency, toCurrency, {
            instrument,
            price,
            purpose,
            amount,
        });
    }

    getQuoteToAccountRate(
        instrument,
        accountCurrency = ACCOUNT_CURRENCY,
        price = null,
        options = {}
    ) {
        if (String(accountCurrency).toUpperCase() !== ACCOUNT_CURRENCY) {
            throw new CurrencyConversionError(
                `Paper account currency must be ${ACCOUNT_CURRENCY}`,
                { accountCurrency }
            );
        }
        return this.getCurrencyConverter().getQuoteToAccountRate(instrument, {
            ...options,
            price,
        });
    }

    getBaseToAccountRate(
        instrument,
        accountCurrency = ACCOUNT_CURRENCY,
        price = null,
        options = {}
    ) {
        if (String(accountCurrency).toUpperCase() !== ACCOUNT_CURRENCY) {
            throw new CurrencyConversionError(
                `Paper account currency must be ${ACCOUNT_CURRENCY}`,
                { accountCurrency }
            );
        }
        return this.getCurrencyConverter().getBaseToAccountRate(instrument, {
            ...options,
            price,
        });
    }

    getFallbackConversionRate(instrument, accountCurrency, price, type) {
        return type === "base"
            ? this.getBaseToAccountRate(instrument, accountCurrency, price)
            : this.getQuoteToAccountRate(instrument, accountCurrency, price);
    }

    calculatePnlInAccountCurrency(trade, exitPrice, source = {}) {
        const accountCurrency = this.getAccountCurrency({
            accountCurrency:
                source.accountCurrency ||
                trade.accountCurrency ||
                trade.brokerReconciliationPayload?.paperRuntime
                    ?.accountCurrency,
        });
        const { quoteCurrency } = this.getInstrumentCurrencies(trade.instrument);
        const entryPrice = toFiniteNumber(trade.entryPrice, exitPrice);
        const priceChange =
            trade.side === "BUY"
                ? exitPrice - entryPrice
                : entryPrice - exitPrice;
        const pnlQuote = toFiniteNumber(trade.units, 0) * priceChange;
        const quoteToAccountRate = this.getQuoteToAccountRate(
            trade.instrument,
            accountCurrency,
            exitPrice,
            { purpose: "pnl", amount: pnlQuote }
        );

        return {
            accountCurrency,
            quoteCurrency,
            quoteToAccountRate,
            priceChange,
            pnlQuote,
            pnlAud: pnlQuote * quoteToAccountRate,
        };
    }

    calculateNetPaperPnl(
        trade,
        exitPrice,
        closeContext = {},
        exitTime = Date.now()
    ) {
        const pnlContext = this.calculatePnlInAccountCurrency(
            trade,
            exitPrice,
            closeContext
        );
        const paperRuntime =
            trade?.brokerReconciliationPayload?.paperRuntime || {};
        const exitPolicy = resolveOwnerRunExitPolicy(
            trade,
            closeContext.config || {}
        );
        const costConfig = this.getPaperCostConfig(
            trade.instrument,
            exitPolicy.config || {}
        );
        const costs = calculatePaperNetPnl({
            trade,
            config: costConfig,
            fillPnlAud: pnlContext.pnlAud,
            pipValue: this.getPipValue(trade.instrument),
            entryQuoteToAudRate: toFiniteNumber(
                paperRuntime.quoteToAccountRate,
                pnlContext.quoteToAccountRate
            ),
            exitQuoteToAudRate: pnlContext.quoteToAccountRate,
            entrySpreadPips: paperRuntime.entrySpreadPips,
            exitSpreadPips: closeContext.spreadPips,
            entrySlippagePips: paperRuntime.entrySlippagePips,
            exitSlippagePips: closeContext.slippagePips,
            exitTime,
        });

        return { ...pnlContext, ...costs, exitPolicy };
    }

    getTimesFmMode(config = {}) {
        const normalized = String(config?.timesFmMode || "disabled")
            .trim()
            .toLowerCase();
        return ["disabled", "observe", "size", "veto"].includes(normalized)
            ? normalized
            : "disabled";
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

    buildPaperDecisionContext(run, signal, config = {}, extras = {}) {
        const priceData =
            extras.priceData || this.getCurrentPriceData(signal?.symbol);
        const decisionTime = extras.decisionTime || Date.now();
        const configSnapshot = normalizeTradingConfig(config || {});
        delete configSnapshot.configHash;

        return {
            decisionId: extras.decisionId || uuidv4(),
            setupId: signal?.setupId || null,
            signalCandleTime: signal?.signalCandleTime ?? null,
            decisionTime,
            instrument: signal?.symbol,
            side: signal?.signal === "SELL" ? "SELL" : "BUY",
            signal: signal?.signal,
            entryType: signal?.entryType || null,
            configHash:
                signal?.configHash ||
                run?.configHash ||
                computeConfigHash(config || {}),
            configSnapshot,
            outcome: ENTRY_DECISION_OUTCOMES.PENDING,
            stage: ENTRY_DECISION_STAGES.RECEIVED,
            spreadPips: toOptionalFiniteNumber(priceData?.spread),
            priceAgeMs: Number.isFinite(Number(priceData?.timestamp))
                ? Math.max(0, decisionTime - Number(priceData.timestamp))
                : null,
            openPositions: extras.openPositions ?? 0,
            projectedExposure: extras.projectedExposure ?? null,
            signalStrength: signal?.strength ?? null,
            adx: signal?.trend?.adx ?? signal?.strength ?? null,
            rsi: signal?.trend?.rsi ?? signal?.data?.rsi ?? null,
            atrPips: signal?.atrPips ?? signal?.trend?.atrPips ?? null,
            tradeId: extras.tradeId || null,
            runId: run?.runId || null,
            selectionId: run?.selectionId || null,
            mode: run?.mode || RUNTIME_MODES.PAPER_CANDIDATE,
            strategy: run?.strategy || config.strategy || null,
            timesFmContext: signal?.timesFm || null,
        };
    }

    async createPaperEntryDecision(run, signal, config, extras = {}) {
        if (!this.entryDecisionRepository?.save || !isEntrySignal(signal)) {
            return null;
        }
        const decision = this.buildPaperDecisionContext(
            run,
            signal,
            config,
            extras
        );
        await this.entryDecisionRepository.save(decision);
        this._paperEntryDecisionContexts.set(decision.decisionId, decision);
        this.emitPaperEntryDecision(decision);
        return decision;
    }

    async updatePaperEntryDecision(decisionId, updates = {}) {
        if (!decisionId || !this.entryDecisionRepository?.updateDecision) return;
        await this.entryDecisionRepository.updateDecision(decisionId, updates);
        const decision = {
            ...(this._paperEntryDecisionContexts.get(decisionId) || {}),
            decisionId,
            ...updates,
        };
        this._paperEntryDecisionContexts.set(decisionId, decision);
        this.emitPaperEntryDecision(decision);
        if (
            decision.outcome === ENTRY_DECISION_OUTCOMES.REJECTED ||
            decision.outcome === ENTRY_DECISION_OUTCOMES.FILLED
        ) {
            this._paperEntryDecisionContexts.delete(decisionId);
        }
    }

    async rejectPaperEntryDecision(decisionId, updates = {}) {
        await this.updatePaperEntryDecision(decisionId, {
            stage: ENTRY_DECISION_STAGES.REJECTED,
            outcome: ENTRY_DECISION_OUTCOMES.REJECTED,
            ...updates,
        });
    }

    getResolvedRunConfig(run, config = {}) {
        const strategyKey =
            run?.strategy || config?.strategy || "supertrend_momentum";
        const strategyDefaults =
            getStrategyDefinition(strategyKey)?.metadata?.defaultConfig || {};

        return {
            ...strategyDefaults,
            ...(run?.configSnapshot || {}),
            ...(config || {}),
            strategy: strategyKey,
        };
    }

    getPaperCostConfig(instrument, config = {}) {
        const financing = this.dataService?.getInstrumentFinancing?.(instrument);
        if (!financing) return config;

        const existingRates = config.paperFinancingRates || {};
        const existingInstrumentRate = existingRates[instrument] || null;
        const hasExistingRate =
            existingInstrumentRate &&
            (existingInstrumentRate.longRateAnnual !== undefined ||
                existingInstrumentRate.shortRateAnnual !== undefined ||
                existingInstrumentRate.long !== undefined ||
                existingInstrumentRate.short !== undefined);
        if (financing.status !== "MODELED" && hasExistingRate) {
            return config;
        }

        return {
            ...config,
            paperFinancingRates: {
                ...existingRates,
                [instrument]: { ...financing },
            },
        };
    }

    getCurrentUtcHour() {
        return new Date().getUTCHours();
    }

    getPaperMarginUsedFromTrades(trades = [], fallbackPriceByInstrument = {}) {
        return trades.reduce((sum, trade) => {
            const marginUsed = toOptionalFiniteNumber(trade.marginUsedAud);
            if (Number.isFinite(marginUsed) && marginUsed > 0) {
                return sum + marginUsed;
            }

            const entryPrice = toFiniteNumber(
                trade.entryPrice,
                fallbackPriceByInstrument[trade.instrument] || null
            );
            const units = Math.abs(toFiniteNumber(trade.units, 0));
            const leverage = Math.max(1, toFiniteNumber(trade.leverageUsed, 20));

            if (!Number.isFinite(entryPrice) || entryPrice <= 0 || units <= 0) {
                return sum;
            }

            const baseToAudRate = this.getBaseToAccountRate(
                trade.instrument,
                ACCOUNT_CURRENCY,
                entryPrice,
                { purpose: "margin" }
            );
            return sum + (units * baseToAudRate) / leverage;
        }, 0);
    }

    async getPaperAccountState(run, config = {}, openTrades = []) {
        const startingBalanceAud = this.getStartingBalanceAud(run, config);
        const fallbackPrices = Object.fromEntries(
            openTrades.map((trade) => [
                trade.instrument,
                this.getCurrentPrice(trade.instrument),
            ])
        );
        const marginUsedAud = this.getPaperMarginUsedFromTrades(
            openTrades,
            fallbackPrices
        );
        const tradeSummary = await this.getRunTradeSummary(run);
        const balanceAud =
            startingBalanceAud + toFiniteNumber(tradeSummary.realizedPnlAud, 0);
        const unrealizedPnlAud = openTrades.reduce((sum, trade) => {
            const exitExecution = this.getPaperLiquidationPrice(
                trade,
                fallbackPrices[trade.instrument]
            );
            if (!Number.isFinite(exitExecution.price)) return sum;
            return (
                sum +
                this.calculateNetPaperPnl(
                    trade,
                    exitExecution.price,
                    exitExecution,
                    Date.now()
                ).pnlAud
            );
        }, 0);
        const equityAud = Math.max(0, balanceAud + unrealizedPnlAud);
        const marginAvailableAud = Math.max(0, equityAud - marginUsedAud);

        return {
            equityAud,
            balanceAud,
            unrealizedPnlAud,
            marginUsedAud,
            marginAvailableAud,
        };
    }

    async validateEntrySignal(run, config, signal, tradeByInstrument = new Map()) {
        if (!isEntrySignal(signal)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                reason: "Signal is not an actionable entry",
            };
        }

        const priceData = this.dataService?.getCurrentPrice?.(signal.symbol);
        const priceAgeMs = Number.isFinite(priceData?.timestamp)
            ? Date.now() - priceData.timestamp
            : null;
        const spreadPips = Number(priceData?.spread);
        const assets = Array.isArray(config.assets) ? config.assets : [];

        if (!assets.includes(signal.symbol)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.INACTIVE_ASSET,
                reason: `Instrument ${signal.symbol} not in active list`,
            };
        }

        if (!priceData) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.NO_LIVE_PRICE,
                reason: `No live price data for ${signal.symbol}`,
            };
        }

        if (priceData.tradeable === false) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.NOT_TRADEABLE,
                reason: `${signal.symbol} is not currently tradeable`,
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
            };
        }

        const maxOpenPositions = Math.max(
            1,
            toFiniteNumber(config.maxOpenPositions, 2)
        );
        if (tradeByInstrument.size >= maxOpenPositions) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.MAX_POSITIONS,
                reason: `Max positions reached (${tradeByInstrument.size}/${maxOpenPositions})`,
            };
        }

        if (tradeByInstrument.has(signal.symbol)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.ALREADY_IN_POSITION,
                reason: "Already in position for this instrument",
            };
        }

        if (signal.signal !== "BUY" && signal.signal !== "SELL") {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                reason: "Invalid signal type",
            };
        }

        if (signal.signal === "SELL" && !config.enableShorting) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.SHORT_DISABLED,
                reason: "Short selling is disabled",
            };
        }

        if (config.enableSessionFilter) {
            const activeSessions = Array.isArray(config.activeSessions)
                ? config.activeSessions
                : [];

            if (activeSessions.length === 0) {
                return {
                    valid: false,
                    code: ENTRY_REJECTION_CODES.OUTSIDE_SESSION,
                    reason: "Session filter enabled but no active sessions configured",
                };
            }

            const hourUtc = this.getCurrentUtcHour();
            if (!isWithinActiveSession(hourUtc, activeSessions)) {
                return {
                    valid: false,
                    code: ENTRY_REJECTION_CODES.OUTSIDE_SESSION,
                    reason: `Outside active sessions (${activeSessions.join(", ")}) at ${hourUtc}:00 UTC`,
                };
            }
        }

        if (this.shouldTimesFmVeto(signal, config)) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.TIMESFM_VETO,
                reason: this.getTimesFmVetoReason(signal),
            };
        }

        try {
            const entryPrice = this.getPaperEntryPrice(signal, config).price;
            this.getBaseToAccountRate(
                signal.symbol,
                ACCOUNT_CURRENCY,
                entryPrice,
                { purpose: "margin" }
            );
            this.getQuoteToAccountRate(
                signal.symbol,
                ACCOUNT_CURRENCY,
                entryPrice,
                { purpose: "pnl", amount: -1 }
            );
        } catch (error) {
            return {
                valid: false,
                code: "CURRENCY_CONVERSION_UNAVAILABLE",
                reason: `AUD conversion unavailable for ${signal.symbol}: ${error.message}`,
            };
        }

        const exposureCheck = await this.validateProjectedExposure(
            run,
            config,
            signal,
            Array.from(tradeByInstrument.values())
        );
        if (!exposureCheck.valid) {
            return exposureCheck;
        }

        return { valid: true };
    }

    getStartingBalanceAud(run, config = {}) {
        return Math.max(
            0,
            toFiniteNumber(
                run?.configSnapshot?.paperStartingBalanceAud ??
                    config.paperStartingBalanceAud,
                this.paperStartingBalanceAud
            )
        );
    }

    async getRunExposureBase(run, config = {}) {
        const currentPortfolio = await this.portfolioRepository.getCurrent({
            mode: run.mode,
            runId: run.runId,
        });

        const currentEquity = toFiniteNumber(
            currentPortfolio.totalValueAud,
            this.getStartingBalanceAud(run, config)
        );

        return currentEquity > 0
            ? currentEquity
            : this.getStartingBalanceAud(run, config);
    }

    async validateProjectedExposure(run, config, signal, openTrades = []) {
        const maxPortfolioExposure = Number(config.maxPortfolioExposure);
        if (!Number.isFinite(maxPortfolioExposure) || maxPortfolioExposure <= 0) {
            return { valid: true };
        }

        const entryPrice = this.getPaperEntryPrice(signal, config).price;
        const tradePlan = this.resolveTradePlan(
            { ...signal, currentPrice: entryPrice },
            config
        );
        const stopLossPrice = toOptionalFiniteNumber(tradePlan?.stopLossPrice);

        if (
            !Number.isFinite(entryPrice) ||
            !Number.isFinite(stopLossPrice) ||
            stopLossPrice === entryPrice
        ) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                reason: "Unable to validate projected entry margin",
            };
        }

        const units = await this.calculatePositionUnits(
            run,
            config,
            { ...signal, currentPrice: entryPrice },
            stopLossPrice,
            openTrades
        );
        if (!Number.isFinite(units) || units <= 0) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.POSITION_SIZE_TOO_SMALL,
                reason: "Position size too small",
            };
        }

        const accountState = await this.getPaperAccountState(
            run,
            config,
            openTrades
        );
        const leverage = resolveLeverage(config);
        const accountCurrency = this.getAccountCurrency(config);
        const baseToAccountRate = this.getBaseToAccountRate(
            signal.symbol,
            accountCurrency,
            entryPrice,
            { purpose: "margin" }
        );
        const projectedMargin =
            (Math.abs(units) * baseToAccountRate) / leverage;
        const projectedExposure = calculateProjectedExposure({
            marginUsedAud: accountState.marginUsedAud,
            projectedMarginAud: projectedMargin,
            equityAud: accountState.equityAud,
        });

        if (
            !Number.isFinite(projectedExposure) ||
            projectedExposure >= maxPortfolioExposure
        ) {
            return {
                valid: false,
                code: ENTRY_REJECTION_CODES.EXPOSURE_LIMIT,
                reason: `Portfolio exposure limit reached (projected ${(projectedExposure * 100).toFixed(1)}%, max ${(maxPortfolioExposure * 100).toFixed(1)}%)`,
                context: { projectedExposure },
            };
        }

        return { valid: true, context: { projectedExposure } };
    }

    buildFallbackTradePlan(signal, config = {}) {
        return resolveCanonicalTradePlan({
            signal: { ...signal, tradePlan: null },
            config,
            entryPrice: signal.currentPrice,
            pipValue: this.getPipValue(signal.symbol),
        });
    }

    resolveTradePlan(signal, config = {}) {
        return resolveCanonicalTradePlan({
            signal,
            config,
            entryPrice: signal.currentPrice,
            pipValue: this.getPipValue(signal.symbol),
        });
    }

    buildPaperRuntimeMetadata(signal, entryPrice, stopLossPrice) {
        const initialStopDistance = Math.abs(
            toFiniteNumber(entryPrice, 0) - toFiniteNumber(stopLossPrice, 0)
        );
        const atrDistance =
            Math.max(0, toFiniteNumber(signal?.atrPips, 0)) *
            this.getPipValue(signal?.symbol);

        return {
            initialStopLossPrice: stopLossPrice,
            initialStopDistance,
            atrDistance,
        };
    }

    getPaperRuntimeMetadata(trade = {}) {
        const paperRuntime =
            trade?.brokerReconciliationPayload?.paperRuntime || {};
        const entryPrice = toOptionalFiniteNumber(trade.entryPrice);
        const currentStopLossPrice = toOptionalFiniteNumber(trade.stopLossPrice);
        const initialStopLossPrice = toFiniteNumber(
            paperRuntime.initialStopLossPrice,
            currentStopLossPrice
        );
        const initialStopDistance = toFiniteNumber(
            paperRuntime.initialStopDistance,
            Number.isFinite(entryPrice) && Number.isFinite(initialStopLossPrice)
                ? Math.abs(entryPrice - initialStopLossPrice)
                : null
        );
        const atrDistance = toFiniteNumber(
            paperRuntime.atrDistance,
            Math.max(0, toFiniteNumber(trade.atrPips, 0)) *
                this.getPipValue(trade.instrument)
        );

        return {
            initialStopLossPrice,
            initialStopDistance,
            atrDistance,
        };
    }

    async calculatePositionUnits(
        run,
        config,
        signal,
        stopLossPrice,
        openTrades = []
    ) {
        const sizing = await this.calculatePositionSizing(
            run,
            config,
            signal,
            stopLossPrice,
            openTrades
        );
        return sizing.units;
    }

    async calculatePositionSizing(
        run,
        config,
        signal,
        stopLossPrice,
        openTrades = []
    ) {
        const entryPrice = toOptionalFiniteNumber(signal.currentPrice);
        if (!Number.isFinite(entryPrice)) {
            return {
                units: 0,
                valid: false,
                code: "INVALID_SIZING_INPUT",
                reason: "Entry price unavailable",
            };
        }

        try {
            const accountState = await this.getPaperAccountState(
                run,
                config,
                openTrades
            );
            const quoteToAudRate = this.getQuoteToAccountRate(
                signal.symbol,
                ACCOUNT_CURRENCY,
                entryPrice,
                { purpose: "pnl", amount: -1 }
            );
            const baseToAudRate = this.getBaseToAccountRate(
                signal.symbol,
                ACCOUNT_CURRENCY,
                entryPrice,
                { purpose: "margin" }
            );
            return calculateCanonicalPositionSize({
                config,
                signal,
                entryPrice,
                stopLossPrice,
                equityAud: accountState.equityAud,
                marginAvailableAud: accountState.marginAvailableAud,
                baseToAudRate,
                quoteToAudRate,
            });
        } catch (error) {
            if (!(error instanceof CurrencyConversionError)) throw error;
            return {
                units: 0,
                valid: false,
                code: error.code,
                reason: error.message,
            };
        }
    }

    async openTradeFromSignal(
        run,
        config,
        signal,
        openTrades = [],
        decisionId = null
    ) {
        const entryExecution = this.getPaperEntryPrice(signal, config);
        const entryPrice = entryExecution.price;
        if (!Number.isFinite(entryPrice)) {
            await this.rejectPaperEntryDecision(decisionId, {
                rejectionCode: ENTRY_REJECTION_CODES.NO_LIVE_PRICE,
                rejectionReason: "Paper entry price unavailable",
            });
            return null;
        }

        const tradePlan = this.resolveTradePlan(
            { ...signal, currentPrice: entryPrice },
            config
        );
        const stopLossPrice = toOptionalFiniteNumber(tradePlan?.stopLossPrice);
        if (!Number.isFinite(stopLossPrice) || stopLossPrice === entryPrice) {
            await this.rejectPaperEntryDecision(decisionId, {
                rejectionCode: ENTRY_REJECTION_CODES.INVALID_SIGNAL,
                rejectionReason: "Valid stop-loss plan unavailable",
            });
            return null;
        }

        const sizing = await this.calculatePositionSizing(
            run,
            config,
            { ...signal, currentPrice: entryPrice },
            stopLossPrice,
            openTrades
        );
        const units = sizing.units;
        if (!sizing.valid || units < 1) {
            await this.rejectPaperEntryDecision(decisionId, {
                rejectionCode:
                    sizing.code || ENTRY_REJECTION_CODES.POSITION_SIZE_TOO_SMALL,
                rejectionReason: sizing.reason || "Position size too small",
            });
            return null;
        }
        await this.updatePaperEntryDecision(decisionId, {
            stage: ENTRY_DECISION_STAGES.SIZED,
        });
        const takeProfitPrice = toOptionalFiniteNumber(
            tradePlan?.takeProfitPrice
        );
        const accountCurrency = this.getAccountCurrency(config);
        const baseToAccountRate = sizing.baseToAudRate;
        const quoteToAccountRate = sizing.quoteToAudRate;
        const leverage = sizing.leverage;
        const entryNotionalAud = Math.abs(units) * baseToAccountRate;
        const ownerExitPolicy = buildOwnerRunExitPolicy({
            strategy: run.strategy,
            config: this.getPaperCostConfig(signal.symbol, config),
            tradePlan,
            ownerRunId: run.runId,
        });
        const brokerReconciliationPayload = {
            paperRuntime: this.buildPaperRuntimeMetadata(
                signal,
                entryPrice,
                stopLossPrice
            ),
        };
        brokerReconciliationPayload.paperRuntime.entryPriceSource =
            entryExecution.priceSource;
        brokerReconciliationPayload.paperRuntime.entrySlippagePips =
            entryExecution.slippagePips;
        brokerReconciliationPayload.paperRuntime.accountCurrency =
            accountCurrency;
        brokerReconciliationPayload.paperRuntime.baseToAccountRate =
            baseToAccountRate;
        brokerReconciliationPayload.paperRuntime.quoteToAccountRate =
            quoteToAccountRate;
        brokerReconciliationPayload.paperRuntime.entryMidPrice =
            entryExecution.mid;
        brokerReconciliationPayload.paperRuntime.entrySpreadPips =
            entryExecution.spreadPips;
        brokerReconciliationPayload.paperRuntime.sizing = sizing;
        brokerReconciliationPayload.paperRuntime.ownerExitPolicy =
            ownerExitPolicy;
        brokerReconciliationPayload.ownerExitPolicy = ownerExitPolicy;
        const priceData = entryExecution.priceData;

        const trade = {
            id: uuidv4(),
            instrument: signal.symbol,
            side: signal.signal === "SELL" ? "SELL" : "BUY",
            units,
            entryPrice,
            entryCostAud: entryNotionalAud,
            entryNotionalAud,
            signal: signal.signal,
            signalStrength: signal.strength,
            entryType: signal.entryType || null,
            atrPips: signal.atrPips || null,
            stopLossPrice,
            takeProfitPrice,
            highestPrice: signal.signal === "BUY" ? entryPrice : null,
            lowestPrice: signal.signal === "SELL" ? entryPrice : null,
            trailingStopPips:
                tradePlan?.trailingStopPips ||
                config.trailingStopPips ||
                null,
            breakevenHit: false,
            activeStopType: "INITIAL_STOP",
            leverageUsed: leverage,
            marginUsedAud: entryNotionalAud / leverage,
            spreadPips: toOptionalFiniteNumber(priceData?.spread),
            accountCurrency,
            entryTime: Date.now(),
            configHash: signal.configHash || run.configHash || null,
            mode: run.mode,
            runId: run.runId,
            ownerRunId: run.runId,
            selectionId: run.selectionId || null,
            strategy: run.strategy,
            ownerExitPolicy,
            brokerReconciliationPayload,
            isOpen: true,
        };

        await this.tradeRepository.save(trade);
        await this.updatePaperEntryDecision(decisionId, {
            stage: ENTRY_DECISION_STAGES.FILLED,
            outcome: ENTRY_DECISION_OUTCOMES.FILLED,
            tradeId: trade.id,
        });
        this.emitTradeOpened(trade);
        return trade;
    }

    async evaluateOpenTrade(trade, config = {}) {
        const ownerExitPolicy = resolveOwnerRunExitPolicy(trade, config);
        const exitExecution = this.getPaperLiquidationPrice(trade);
        const currentPrice = exitExecution.price;
        if (!Number.isFinite(currentPrice)) {
            return false;
        }

        await this.applyBreakeven(trade, currentPrice, ownerExitPolicy);
        await this.applyTrailingStop(trade, currentPrice, ownerExitPolicy);

        const stopResult = this.getStopResult(
            trade,
            currentPrice,
            ownerExitPolicy.config
        );
        if (stopResult) {
            await this.closeTrade(
                trade,
                stopResult.exitPrice,
                stopResult.exitReason,
                {
                    ...exitExecution,
                    priceSource: "PAPER_STOP_FILL",
                    slippagePips: stopResult.stopSlippagePips,
                }
            );
            return true;
        }

        const takeProfitResult = this.getTakeProfitResult(trade, currentPrice);
        if (takeProfitResult) {
            await this.closeTrade(
                trade,
                takeProfitResult.exitPrice,
                takeProfitResult.exitReason,
                exitExecution
            );
            return true;
        }

        const timedExitReason = this.getTimedExitReason(
            trade,
            ownerExitPolicy
        );
        if (timedExitReason) {
            const timedExitExecution = this.getPaperExitPrice(
                trade,
                ownerExitPolicy.config,
                currentPrice
            );
            await this.closeTrade(
                trade,
                timedExitExecution.price,
                timedExitReason,
                timedExitExecution
            );
            return true;
        }

        return false;
    }

    getStopResult(trade, currentPrice, config = {}) {
        const stopLossPrice = toOptionalFiniteNumber(trade.stopLossPrice);
        if (!Number.isFinite(stopLossPrice)) {
            return null;
        }

        const stopHit =
            trade.side === "BUY"
                ? currentPrice <= stopLossPrice
                : currentPrice >= stopLossPrice;

        if (!stopHit) {
            return null;
        }

        let exitReason = "STOP_LOSS";
        if (trade.activeStopType === "TRAILING") {
            exitReason = "TRAILING_STOP";
        } else if (trade.breakevenHit || trade.activeStopType === "BREAKEVEN") {
            exitReason = "BREAKEVEN";
        }

        // Real stops slip through the trigger and fill worse than the stop price.
        // Without this, paper stop exits were idealized (filled exactly at the
        // stop) — the main reason paper P&L diverged from live for the same signal.
        const stopSlippagePips = this.getPaperStopSlippagePips(config);
        const slippageDistance =
            stopSlippagePips * this.getPipValue(trade.instrument);
        // A stop is a market order after trigger. If the next observable quote
        // gaps through the stop, fill at that worse quote before slippage.
        let exitPrice =
            trade.side === "BUY"
                ? Math.min(stopLossPrice, currentPrice)
                : Math.max(stopLossPrice, currentPrice);
        const gapDistance = Math.abs(exitPrice - stopLossPrice);
        if (slippageDistance > 0) {
            exitPrice += trade.side === "BUY" ? -slippageDistance : slippageDistance;
        }

        return {
            exitPrice,
            exitReason,
            stopSlippagePips,
            gapPips:
                this.getPipValue(trade.instrument) > 0
                    ? gapDistance / this.getPipValue(trade.instrument)
                    : 0,
        };
    }

    getTakeProfitResult(trade, currentPrice) {
        const takeProfitPrice = toOptionalFiniteNumber(trade.takeProfitPrice);
        if (!Number.isFinite(takeProfitPrice)) {
            return null;
        }

        const takeProfitHit =
            trade.side === "BUY"
                ? currentPrice >= takeProfitPrice
                : currentPrice <= takeProfitPrice;

        if (!takeProfitHit) {
            return null;
        }

        return {
            exitPrice: takeProfitPrice,
            exitReason: "TAKE_PROFIT",
        };
    }

    getTimedExitReason(trade, config = {}) {
        const policy = config?.config
            ? config
            : resolveOwnerRunExitPolicy(trade, config);
        return resolveTimedExitReason({ trade, policy, now: Date.now() });
    }

    async applyBreakeven(trade, currentPrice, config = {}) {
        if (trade.breakevenHit) {
            return;
        }

        const policy = config?.config
            ? config
            : resolveOwnerRunExitPolicy(trade, config);
        const runtimeMetadata = this.getPaperRuntimeMetadata(trade);
        const activationDistance = resolveBreakevenDistance({
            trade,
            policy,
            pipValue: this.getPipValue(trade.instrument),
            runtimeMetadata,
        });

        if (!Number.isFinite(activationDistance) || activationDistance <= 0) {
            return;
        }

        const profitDistance =
            trade.side === "BUY"
                ? currentPrice - toFiniteNumber(trade.entryPrice, currentPrice)
                : toFiniteNumber(trade.entryPrice, currentPrice) - currentPrice;

        if (profitDistance < activationDistance) {
            return;
        }

        const entryPrice = toFiniteNumber(trade.entryPrice, currentPrice);
        trade.stopLossPrice = entryPrice;
        trade.breakevenHit = true;
        trade.activeStopType = "BREAKEVEN";

        await this.tradeRepository.updateTrade(trade.id, {
            stopLossPrice: entryPrice,
            breakevenHit: true,
            activeStopType: "BREAKEVEN",
        });
    }

    async applyTrailingStop(trade, currentPrice, config = {}) {
        const policy = config?.config
            ? config
            : resolveOwnerRunExitPolicy(trade, config);
        const runtimeMetadata = this.getPaperRuntimeMetadata(trade);
        const { activationDistance, trailDistance } =
            resolveTrailingStopDistances({
                trade,
                policy,
                pipValue: this.getPipValue(trade.instrument),
                runtimeMetadata,
            });

        if (
            !Number.isFinite(activationDistance) ||
            activationDistance <= 0 ||
            !Number.isFinite(trailDistance) ||
            trailDistance <= 0
        ) {
            return;
        }

        const entryPrice = toFiniteNumber(trade.entryPrice, currentPrice);
        const profitDistance =
            trade.side === "BUY"
                ? currentPrice - entryPrice
                : entryPrice - currentPrice;

        if (profitDistance < activationDistance) {
            return;
        }

        const nextStop = calculateMonotonicStop({
            trade,
            currentPrice,
            trailDistance,
        });

        if (!Number.isFinite(nextStop)) {
            return;
        }

        trade.stopLossPrice = nextStop;
        trade.trailingStopPrice = nextStop;
        trade.activeStopType = "TRAILING";
        trade.highestPrice =
            trade.side === "BUY"
                ? Math.max(toFiniteNumber(trade.highestPrice, entryPrice), currentPrice)
                : trade.highestPrice;
        trade.lowestPrice =
            trade.side === "SELL"
                ? Math.min(toFiniteNumber(trade.lowestPrice, entryPrice), currentPrice)
                : trade.lowestPrice;

        await this.tradeRepository.updateTrade(trade.id, {
            stopLossPrice: nextStop,
            trailingStopPrice: nextStop,
            activeStopType: "TRAILING",
            highestPrice: trade.highestPrice,
            lowestPrice: trade.lowestPrice,
        });
    }

    async closeTrade(trade, exitPrice, exitReason, closeContext = {}) {
        if (!trade || !Number.isFinite(Number(exitPrice))) {
            return null;
        }

        const closeTimestamp = Date.now();
        const closePriceSource = closeContext.priceSource || "PAPER_MARK";
        const pipValue = this.getPipValue(trade.instrument);
        const entryPrice = toFiniteNumber(trade.entryPrice, exitPrice);
        const pnlContext = this.calculateNetPaperPnl(
            trade,
            exitPrice,
            closeContext,
            closeTimestamp
        );
        const priceChange = pnlContext.priceChange;
        const pnlPips = pipValue > 0 ? priceChange / pipValue : 0;
        const pnlAud = pnlContext.pnlAud;
        const baseToAccountRate = this.getBaseToAccountRate(
            trade.instrument,
            pnlContext.accountCurrency,
            exitPrice,
            { purpose: "position" }
        );
        const exitValueAud = Math.abs(toFiniteNumber(trade.units, 0)) *
            baseToAccountRate;
        const pnlPercent =
            entryPrice > 0 && toFiniteNumber(trade.entryCostAud, 0) > 0
                ? (pnlAud / trade.entryCostAud) * 100
                : 0;
        const holdingPeriodMs = Math.max(
            0,
            closeTimestamp - toFiniteNumber(trade.entryTime, closeTimestamp)
        );
        const existingPayload = trade.brokerReconciliationPayload || {};
        const paperRuntime = existingPayload.paperRuntime || {};
        const brokerReconciliationPayload = {
            ...existingPayload,
            paperRuntime: {
                ...paperRuntime,
                closePriceSource,
                exitSlippagePips: closeContext.slippagePips || 0,
                exitSpreadPips: closeContext.spreadPips ?? null,
                accountCurrency: pnlContext.accountCurrency,
                quoteCurrency: pnlContext.quoteCurrency,
                quoteToAccountRate: pnlContext.quoteToAccountRate,
                baseToAccountRateAtExit: baseToAccountRate,
                pnlQuote: pnlContext.pnlQuote,
                grossPnlAud: pnlContext.grossPnlAud,
                spreadCostAud: pnlContext.spreadCostAud,
                slippageCostAud: pnlContext.slippageCostAud,
                commissionAud: pnlContext.commissionAud,
                commissionStatus: pnlContext.commissionStatus,
                financingAud: pnlContext.financingAud,
                financingRateAnnual: pnlContext.financingRateAnnual,
                financingDayWeights: pnlContext.financingDayWeights,
                financingMode: pnlContext.financingMode,
                financingStatus: pnlContext.financingStatus,
                financingSource: pnlContext.financingSource,
                financingRateUpdatedAt:
                    pnlContext.financingRateUpdatedAt,
                spreadStatus: pnlContext.spreadStatus,
                slippageStatus: pnlContext.slippageStatus,
                totalCostAud: pnlContext.totalCostAud,
                costModelVersion: pnlContext.costModelVersion,
            },
        };

        const closedTrade = {
            ...trade,
            exitPrice,
            exitTime: closeTimestamp,
            exitReason,
            pnlAud,
            grossPnlAud: pnlContext.grossPnlAud,
            pnlPips,
            pnlPercent,
            swapAud: pnlContext.financingAud,
            commissionAud: pnlContext.commissionAud,
            holdingPeriodMs,
            closePriceSource,
            reconciliationStatus: "PAPER_SIMULATED",
            brokerExitReason: exitReason,
            brokerClosedAt: closeTimestamp,
            lastBrokerSyncAt: closeTimestamp,
            brokerReconciliationPayload,
            isOpen: false,
        };

        await this.tradeRepository.updateTrade(trade.id, {
            exitPrice,
            exitTime: closeTimestamp,
            exitValueAud,
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            swapAud: pnlContext.financingAud,
            commissionAud: pnlContext.commissionAud,
            holdingPeriodMs,
            closePriceSource,
            reconciliationStatus: "PAPER_SIMULATED",
            brokerExitReason: exitReason,
            brokerClosedAt: closeTimestamp,
            lastBrokerSyncAt: closeTimestamp,
            brokerReconciliationPayload,
            isOpen: false,
        });

        this.emitTradeClosed(closedTrade);
        return closedTrade;
    }

    async closeOpenTradesForRun(runId, mode, exitReason) {
        if (!runId || !isPaperMode(mode)) {
            return [];
        }

        const openTrades = await this.tradeRepository.getOpenTrades({
            mode,
            runId,
        });
        const session = this.runtimeCoordinator?.getRunSession?.(runId);
        const config = this.getResolvedRunConfig(
            session?.run || { mode, runId },
            session?.generator?.config || session?.run?.configSnapshot || {}
        );
        const closedTrades = [];

        for (const trade of openTrades) {
            const exitExecution = this.getPaperExitPrice(
                trade,
                config,
                toOptionalFiniteNumber(trade.entryPrice)
            );
            if (!Number.isFinite(exitExecution.price)) {
                continue;
            }

            const closedTrade = await this.closeTrade(
                trade,
                exitExecution.price,
                exitReason,
                exitExecution
            );
            if (closedTrade) {
                closedTrades.push(closedTrade);
            }
        }

        return closedTrades;
    }

    buildTradeSummaryFromTrades(trades = []) {
        const closedTrades = trades.filter((trade) => !trade.isOpen);
        const winningTrades = closedTrades.filter(
            (trade) => toFiniteNumber(trade.pnlAud, 0) > 0
        );
        const losingTrades = closedTrades.filter(
            (trade) => toFiniteNumber(trade.pnlAud, 0) < 0
        );

        return {
            totalTrades: trades.length,
            openTradeCount: trades.filter((trade) => trade.isOpen).length,
            closedTradeCount: closedTrades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            flatTrades: Math.max(
                0,
                closedTrades.length - winningTrades.length - losingTrades.length
            ),
            realizedPnlAud: closedTrades.reduce(
                (sum, trade) => sum + toFiniteNumber(trade.pnlAud, 0),
                0
            ),
        };
    }

    async getRunTradeSummary(run) {
        const filters = {
            mode: run.mode,
            runId: run.runId,
        };

        if (this.tradeRepository.getTradeSummary) {
            return this.tradeRepository.getTradeSummary(filters);
        }

        const trades = await this.tradeRepository.getAllTrades(filters);
        return this.buildTradeSummaryFromTrades(trades);
    }

    async saveRunSnapshot(run, config = {}) {
        if (!run || !isPaperMode(run.mode)) {
            return null;
        }

        const [openTrades, tradeSummary] = await Promise.all([
            this.tradeRepository.getOpenTrades({
                mode: run.mode,
                runId: run.runId,
            }),
            this.getRunTradeSummary(run),
        ]);
        const realizedPnlAud = toFiniteNumber(tradeSummary.realizedPnlAud, 0);
        const positions = openTrades.map((trade) => {
            const exitExecution = this.getPaperExitPrice(
                trade,
                config,
                toFiniteNumber(trade.entryPrice, 0)
            );
            const currentPrice = Number.isFinite(exitExecution.price)
                ? exitExecution.price
                : toFiniteNumber(trade.entryPrice, 0);
            const unrealizedPnlAud = this.calculateNetPaperPnl(
                trade,
                currentPrice,
                exitExecution,
                Date.now()
            ).pnlAud;

            return {
                id: trade.id,
                instrument: trade.instrument,
                side: trade.side,
                units: trade.units,
                entryPrice: trade.entryPrice,
                currentPrice,
                unrealizedPnlAud,
                stopLossPrice: trade.stopLossPrice,
                takeProfitPrice: trade.takeProfitPrice,
                activeStopType: trade.activeStopType || null,
            };
        });
        const unrealizedPnlAud = positions.reduce(
            (sum, position) => sum + toFiniteNumber(position.unrealizedPnlAud, 0),
            0
        );
        const startingBalanceAud = this.getStartingBalanceAud(run, config);
        const balanceAud = startingBalanceAud + realizedPnlAud;
        const totalValueAud = balanceAud + unrealizedPnlAud;
        const marginUsedAud = openTrades.reduce(
            (sum, trade) => sum + toFiniteNumber(trade.marginUsedAud, 0),
            0
        );
        const snapshot = {
            totalValueAud,
            balanceAud,
            unrealizedPnlAud,
            realizedPnlAud,
            marginUsedAud,
            marginAvailableAud: Math.max(0, totalValueAud - marginUsedAud),
            positions,
            positionCount: positions.length,
            exposurePercent:
                totalValueAud > 0 ? (marginUsedAud / totalValueAud) * 100 : 0,
            snapshotTime: Date.now(),
            runId: run.runId,
            selectionId: run.selectionId || null,
            mode: run.mode,
            strategy: run.strategy,
        };

        await this.portfolioRepository.save(snapshot);
        this.emitPaperRunUpdated(run);
        return snapshot;
    }

    async ensureRunSnapshot(runId) {
        const session = this.runtimeCoordinator?.getRunSession?.(runId);
        if (!session || !isPaperMode(session.run.mode)) {
            return null;
        }

        return this.saveRunSnapshot(
            session.run,
            this.getResolvedRunConfig(
                session.run,
                session.generator?.config || session.run.configSnapshot || {}
            )
        );
    }

    async resetRun(runId) {
        const session = this.runtimeCoordinator?.getRunSession?.(runId);
        if (!session || !isPaperMode(session.run.mode)) {
            return null;
        }

        await this.closeOpenTradesForRun(runId, session.run.mode, "RUN_RESET");
        await this.tradeRepository.deleteByRunId(runId, {
            mode: session.run.mode,
        });
        await this.signalRepository?.deleteByRunId?.(runId, {
            mode: session.run.mode,
        });
        await this.portfolioRepository.deleteByRunId(runId, {
            mode: session.run.mode,
        });

        const resetRun = await this.runtimeCoordinator.resetRun(runId, {
            metadata: {
                ...(session.run.metadata || {}),
                lastResetAt: Date.now(),
            },
        });

        await this.ensureRunSnapshot(runId);
        return resetRun;
    }

    async resetAllPaper() {
        if (!this.runtimeCoordinator || !this.tradeRepository || !this.portfolioRepository) {
            throw new Error(
                "Paper trading runtime not properly initialized - missing dependencies"
            );
        }

        const resetAt = Date.now();
        const counts = {
            tradesDeleted: 0,
            signalsDeleted: 0,
            entryDecisionsDeleted: 0,
            portfolioSnapshotsDeleted: 0,
        };

        for (const mode of PAPER_MODES) {
            counts.tradesDeleted +=
                (await this.tradeRepository.deleteByRuntimeFilters?.({ mode })) || 0;
            counts.signalsDeleted +=
                (await this.signalRepository?.deleteByRuntimeFilters?.({ mode })) ||
                0;
            counts.entryDecisionsDeleted +=
                (await this.entryDecisionRepository?.deleteByRuntimeFilters?.({
                    mode,
                })) || 0;
            counts.portfolioSnapshotsDeleted +=
                (await this.portfolioRepository.deleteByRuntimeFilters?.({
                    mode,
                })) || 0;
        }

        const activePaperRuns = (this.runtimeCoordinator.listRuns?.() || []).filter(
            (run) => isPaperMode(run.mode)
        );
        const resetRuns = [];

        for (const run of activePaperRuns) {
            const session = this.runtimeCoordinator.getRunSession?.(run.runId);
            if (!session || !isPaperMode(session.run.mode)) {
                continue;
            }

            const resetRun = await this.runtimeCoordinator.resetRun(run.runId, {
                startedAt: resetAt,
                metadata: {
                    ...(session.run.metadata || {}),
                    lastResetAt: resetAt,
                    lastGlobalPaperResetAt: resetAt,
                },
                status: session.run.status,
            });
            await this.ensureRunSnapshot(run.runId);
            resetRuns.push(resetRun || session.run);
        }

        if (this.io) {
            this.io.emit("paperRuntimeReset", {
                type: "paperRuntimeReset",
                resetAt,
                counts,
                runs: resetRuns.map((run) => ({
                    runId: run.runId,
                    mode: run.mode,
                    strategy: run.strategy,
                    status: run.status,
                })),
            });
            this.io.emit("runtimeRunsChanged", this.runtimeCoordinator.listRuns?.() || []);
        }

        return {
            resetAt,
            counts,
            runs: resetRuns,
        };
    }

    async stopRun(runId) {
        const session = this.runtimeCoordinator?.getRunSession?.(runId);
        if (!session || !isPaperMode(session.run.mode)) {
            return null;
        }

        await this.closeOpenTradesForRun(runId, session.run.mode, "RUN_STOPPED");
        await this.saveRunSnapshot(
            session.run,
            this.getResolvedRunConfig(
                session.run,
                session.generator?.config || session.run.configSnapshot || {}
            )
        );

        return this.runtimeCoordinator.stopRun(runId, {
            metadata: {
                ...(session.run.metadata || {}),
                reason: "manual-stop",
            },
        });
    }

    async buildRunSummary(run) {
        if (!run || !isPaperMode(run.mode)) {
            return null;
        }

        const [portfolio, tradeSummary, latestSignalBatch] = await Promise.all([
            this.portfolioRepository.getCurrent({
                mode: run.mode,
                runId: run.runId,
            }),
            this.getRunTradeSummary(run),
            this.signalRepository?.getRecent?.(1, {
                mode: run.mode,
                runId: run.runId,
            }) || Promise.resolve([]),
        ]);

        const latestSignal = Array.isArray(latestSignalBatch)
            ? latestSignalBatch[0] || null
            : null;
        const hasSnapshot =
            portfolio?.runId === run.runId && portfolio?.mode === run.mode;
        const startingBalanceAud = this.getStartingBalanceAud(run);
        const balanceAud = hasSnapshot
            ? toFiniteNumber(portfolio.balanceAud, startingBalanceAud)
            : startingBalanceAud;
        const totalValueAud = hasSnapshot
            ? toFiniteNumber(portfolio.totalValueAud, balanceAud)
            : balanceAud;

        return {
            totalTrades: tradeSummary.totalTrades || 0,
            openTradeCount: tradeSummary.openTradeCount || 0,
            closedTradeCount: tradeSummary.closedTradeCount || 0,
            winningTrades: tradeSummary.winningTrades || 0,
            losingTrades: tradeSummary.losingTrades || 0,
            flatTrades: tradeSummary.flatTrades || 0,
            balanceAud,
            totalValueAud,
            realizedPnlAud: hasSnapshot
                ? toFiniteNumber(portfolio.realizedPnlAud, 0)
                : toFiniteNumber(tradeSummary.realizedPnlAud, 0),
            unrealizedPnlAud: hasSnapshot
                ? toFiniteNumber(portfolio.unrealizedPnlAud, 0)
                : 0,
            marginUsedAud: hasSnapshot
                ? toFiniteNumber(portfolio.marginUsedAud, 0)
                : 0,
            lastSignalAt: latestSignal?.timestamp || null,
            lastSignal: latestSignal
                ? {
                      signal: latestSignal.signal,
                      instrument: latestSignal.symbol || latestSignal.instrument,
                      timestamp: latestSignal.timestamp,
                      reasonCode: latestSignal.reasonCode || null,
                  }
                : null,
        };
    }

    async enrichRuns(runs = []) {
        return Promise.all(
            runs.map(async (run) => ({
                ...run,
                summary: await this.buildRunSummary(run),
            }))
        );
    }

    emitPaperEntryDecision(decision) {
        if (!this.io) return;
        this.io.emit("paperEntryDecision", {
            type: "paperEntryDecision",
            ...decision,
            timestamp: Date.now(),
        });
        if (decision.outcome === ENTRY_DECISION_OUTCOMES.REJECTED) {
            this.io.emit("entryRejected", {
                mode: decision.mode,
                runId: decision.runId,
                decisionId: decision.decisionId,
                rejectionCode: decision.rejectionCode,
                reason: decision.rejectionReason,
            });
        }
    }

    emitTradeOpened(trade) {
        if (!this.io) return;

        this.io.emit("tradeOpened", {
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
            runId: trade.runId || null,
            strategy: trade.strategy || null,
            timestamp: Date.now(),
        });
        this.io.emit("tradeUpdate", trade);
    }

    emitTradeClosed(trade) {
        if (!this.io) return;

        this.io.emit("tradeClosed", {
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
            runId: trade.runId || null,
            strategy: trade.strategy || null,
            timestamp: Date.now(),
        });
        this.io.emit("tradeUpdate", trade);
    }

    emitPaperRunUpdated(run) {
        if (!this.io || !run) return;

        this.io.emit("paperRunUpdated", {
            runId: run.runId,
            mode: run.mode,
            strategy: run.strategy,
            selectionId: run.selectionId || null,
            timestamp: Date.now(),
        });
    }
}

module.exports = PaperTradingRuntime;
module.exports.isPaperMode = isPaperMode;
