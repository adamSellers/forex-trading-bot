const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { RUNTIME_MODES, RUN_STATUSES } = require("../runtime/runtimeConstants");
const { getStrategyDefinition } = require("../strategies");

const PAPER_MODES = new Set([
    RUNTIME_MODES.PAPER_SHADOW,
    RUNTIME_MODES.PAPER_CANDIDATE,
]);

function isPaperMode(mode) {
    return PAPER_MODES.has(mode);
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isEntrySignal(signal) {
    if (!signal) return false;
    if (signal.signal !== "BUY" && signal.signal !== "SELL") return false;
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

function calculateUnrealizedPnlAud(trade, currentPrice) {
    const entryPrice = toFiniteNumber(trade.entryPrice, null);
    if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice)) {
        return 0;
    }

    const priceChange =
        trade.side === "BUY"
            ? currentPrice - entryPrice
            : entryPrice - currentPrice;

    return toFiniteNumber(trade.units, 0) * priceChange;
}

class PaperTradingRuntime {
    constructor(options = {}) {
        this.runtimeCoordinator = options.runtimeCoordinator || null;
        this.tradeRepository = options.tradeRepository || null;
        this.signalRepository = options.signalRepository || null;
        this.portfolioRepository = options.portfolioRepository || null;
        this.dataService = options.dataService || null;
        this.io = options.io || null;
        this.paperStartingBalanceAud =
            options.paperStartingBalanceAud || 10000;

        this._runQueue = new Map();
        this._boundRunSignalsGenerated = null;
        this._boundRunStarted = null;
        this._boundRunStopped = null;
        this.isRunning = false;
    }

    init({
        runtimeCoordinator = null,
        tradeRepository = null,
        signalRepository = null,
        portfolioRepository = null,
        dataService = null,
        io = null,
    } = {}) {
        this.runtimeCoordinator = runtimeCoordinator || this.runtimeCoordinator;
        this.tradeRepository = tradeRepository || this.tradeRepository;
        this.signalRepository = signalRepository || this.signalRepository;
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
                const currentPrice =
                    this.getCurrentPrice(signal.symbol) || signal.currentPrice;
                const closedTrade = await this.closeTrade(
                    openTrade,
                    currentPrice,
                    "SIGNAL_REVERSAL"
                );

                if (closedTrade) {
                    tradeByInstrument.delete(signal.symbol);
                    openTrade = null;
                }
            }

            if (openTrade || !isEntrySignal(signal)) {
                continue;
            }

            const maxOpenPositions = Math.max(
                1,
                toFiniteNumber(config.maxOpenPositions, 2)
            );
            if (tradeByInstrument.size >= maxOpenPositions) {
                continue;
            }

            const trade = await this.openTradeFromSignal(run, config, signal);
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

    getCurrentPrice(instrument) {
        const priceData = this.dataService?.getCurrentPrice?.(instrument);
        if (!priceData) return null;
        return Number.isFinite(Number(priceData.price))
            ? Number(priceData.price)
            : Number(priceData.mid);
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

    buildFallbackTradePlan(signal, config = {}) {
        const entryPrice = toFiniteNumber(signal.currentPrice, null);
        const pipValue = this.getPipValue(signal.symbol);
        const atrDistance =
            toFiniteNumber(signal.atrPips, 0) *
            Math.max(1, toFiniteNumber(config.stopLossAtrMultiplier, 2)) *
            pipValue;
        const minDistance =
            Math.max(
                toFiniteNumber(config.minStopLossPips, 0),
                toFiniteNumber(config.stopLossPips, 15)
            ) * pipValue;
        const stopDistance = Math.max(atrDistance, minDistance);

        if (!Number.isFinite(entryPrice) || stopDistance <= 0) {
            return null;
        }

        return {
            stopLossPrice:
                signal.signal === "BUY"
                    ? entryPrice - stopDistance
                    : entryPrice + stopDistance,
            takeProfitPrice: null,
        };
    }

    resolveTradePlan(signal, config = {}) {
        if (
            signal?.tradePlan &&
            Number.isFinite(Number(signal.tradePlan.stopLossPrice))
        ) {
            return signal.tradePlan;
        }

        return this.buildFallbackTradePlan(signal, config);
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
        const entryPrice = toFiniteNumber(trade.entryPrice, null);
        const currentStopLossPrice = toFiniteNumber(trade.stopLossPrice, null);
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

    async calculatePositionUnits(run, config, signal, stopLossPrice) {
        if (config.positionSizeMethod === "FIXED") {
            return Math.max(1, Math.floor(toFiniteNumber(config.fixedPositionUnits, 1000)));
        }

        const entryPrice = toFiniteNumber(signal.currentPrice, null);
        const stopDistance = Math.abs(entryPrice - toFiniteNumber(stopLossPrice, entryPrice));
        if (!Number.isFinite(entryPrice) || stopDistance <= 0) {
            return Math.max(1, Math.floor(toFiniteNumber(config.fixedPositionUnits, 1000)));
        }

        const riskFraction = toFiniteNumber(config.riskPerTrade, 0.01);
        const equityAud = await this.getRunExposureBase(run, config);
        const riskAud = Math.max(1, equityAud * Math.max(0.001, riskFraction));
        const uncappedUnits = Math.floor(riskAud / stopDistance);
        const leverageCap = Math.floor(
            (equityAud * Math.max(1, toFiniteNumber(config.maxLeverage, config.leverage || 20))) /
                Math.max(entryPrice, 0.00001)
        );

        return Math.max(
            1,
            Math.min(
                uncappedUnits,
                leverageCap > 0 ? leverageCap : uncappedUnits
            )
        );
    }

    async openTradeFromSignal(run, config, signal) {
        const currentPrice =
            this.getCurrentPrice(signal.symbol) || toFiniteNumber(signal.currentPrice, null);
        if (!Number.isFinite(currentPrice)) {
            return null;
        }

        const tradePlan = this.resolveTradePlan(
            { ...signal, currentPrice },
            config
        );
        const stopLossPrice = toFiniteNumber(tradePlan?.stopLossPrice, null);
        if (!Number.isFinite(stopLossPrice) || stopLossPrice === currentPrice) {
            return null;
        }

        const units = await this.calculatePositionUnits(
            run,
            config,
            { ...signal, currentPrice },
            stopLossPrice
        );
        const takeProfitPrice = Number.isFinite(
            Number(tradePlan?.takeProfitPrice)
        )
            ? Number(tradePlan.takeProfitPrice)
            : null;
        const brokerReconciliationPayload = {
            paperRuntime: this.buildPaperRuntimeMetadata(
                signal,
                currentPrice,
                stopLossPrice
            ),
        };
        const priceData = this.dataService?.getCurrentPrice?.(signal.symbol) || null;

        const trade = {
            id: uuidv4(),
            instrument: signal.symbol,
            side: signal.signal === "SELL" ? "SELL" : "BUY",
            units,
            entryPrice: currentPrice,
            entryCostAud: units * currentPrice,
            signal: signal.signal,
            signalStrength: signal.strength,
            entryType: signal.entryType || null,
            atrPips: signal.atrPips || null,
            stopLossPrice,
            takeProfitPrice,
            highestPrice: signal.signal === "BUY" ? currentPrice : null,
            lowestPrice: signal.signal === "SELL" ? currentPrice : null,
            trailingStopPips:
                tradePlan?.trailingStopPips ||
                config.trailingStopPips ||
                null,
            breakevenHit: false,
            activeStopType: "INITIAL_STOP",
            leverageUsed: toFiniteNumber(config.leverage, 20),
            marginUsedAud:
                (units * currentPrice) / Math.max(1, toFiniteNumber(config.leverage, 20)),
            spreadPips: toFiniteNumber(priceData?.spread, null),
            entryTime: Date.now(),
            configHash: signal.configHash || run.configHash || null,
            mode: run.mode,
            runId: run.runId,
            ownerRunId: run.runId,
            selectionId: run.selectionId || null,
            strategy: run.strategy,
            brokerReconciliationPayload,
            isOpen: true,
        };

        await this.tradeRepository.save(trade);
        this.emitTradeOpened(trade);
        return trade;
    }

    async evaluateOpenTrade(trade, config = {}) {
        const currentPrice = this.getCurrentPrice(trade.instrument);
        if (!Number.isFinite(currentPrice)) {
            return false;
        }

        await this.applyBreakeven(trade, currentPrice, config);
        await this.applyTrailingStop(trade, currentPrice, config);

        const stopResult = this.getStopResult(trade, currentPrice);
        if (stopResult) {
            await this.closeTrade(trade, stopResult.exitPrice, stopResult.exitReason);
            return true;
        }

        const takeProfitResult = this.getTakeProfitResult(trade, currentPrice);
        if (takeProfitResult) {
            await this.closeTrade(
                trade,
                takeProfitResult.exitPrice,
                takeProfitResult.exitReason
            );
            return true;
        }

        const timedExitReason = this.getTimedExitReason(trade, config);
        if (timedExitReason) {
            await this.closeTrade(trade, currentPrice, timedExitReason);
            return true;
        }

        return false;
    }

    getStopResult(trade, currentPrice) {
        const stopLossPrice = toFiniteNumber(trade.stopLossPrice, null);
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

        return {
            exitPrice: stopLossPrice,
            exitReason,
        };
    }

    getTakeProfitResult(trade, currentPrice) {
        const takeProfitPrice = toFiniteNumber(trade.takeProfitPrice, null);
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
        const now = Date.now();
        const timeStopHours = toFiniteNumber(config.timeStopHours, null);

        if (
            Number.isFinite(timeStopHours) &&
            timeStopHours > 0 &&
            now - toFiniteNumber(trade.entryTime, now) >=
                timeStopHours * 60 * 60 * 1000
        ) {
            return "TIME_STOP";
        }

        if (trade.strategy !== "range_breakout") {
            return null;
        }

        const sessionCloseHourUTC = toFiniteNumber(config.sessionCloseHourUTC, null);
        if (!Number.isFinite(sessionCloseHourUTC)) {
            return null;
        }

        const closeTime = new Date(now);
        closeTime.setUTCHours(sessionCloseHourUTC, 0, 0, 0);

        return now >= closeTime.getTime() ? "SESSION_CLOSE" : null;
    }

    async applyBreakeven(trade, currentPrice, config = {}) {
        if (trade.breakevenHit) {
            return;
        }

        let activationDistance = null;
        const { initialStopDistance } = this.getPaperRuntimeMetadata(trade);

        if (
            trade.strategy === "mean_reversion" &&
            Number.isFinite(toFiniteNumber(trade.takeProfitPrice, null))
        ) {
            const tpDistance = Math.abs(
                toFiniteNumber(trade.takeProfitPrice, trade.entryPrice) -
                    toFiniteNumber(trade.entryPrice, 0)
            );
            activationDistance =
                tpDistance * Math.max(0, toFiniteNumber(config.breakevenAtTpPercent, 0.5));
        } else if (
            trade.strategy === "stochastic_divergence" &&
            Number.isFinite(initialStopDistance)
        ) {
            activationDistance =
                initialStopDistance *
                Math.max(0, toFiniteNumber(config.breakevenSlMultiplier, 1.0));
        } else if (config.enableBreakeven !== false) {
            activationDistance =
                toFiniteNumber(config.breakevenTriggerPips, 5) *
                this.getPipValue(trade.instrument);
        }

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
        let activationDistance = null;
        let trailDistance = null;
        const { initialStopDistance, atrDistance } =
            this.getPaperRuntimeMetadata(trade);

        if (
            trade.strategy === "range_breakout" &&
            Number.isFinite(toFiniteNumber(trade.takeProfitPrice, null))
        ) {
            const tpMultiplier = Math.max(
                0.1,
                toFiniteNumber(config.tpRangeMultiplier, 1.5)
            );
            const rangeHeight =
                Math.abs(
                    toFiniteNumber(trade.takeProfitPrice, trade.entryPrice) -
                        toFiniteNumber(trade.entryPrice, 0)
                ) / tpMultiplier;

            activationDistance =
                rangeHeight *
                Math.max(0, toFiniteNumber(config.trailActivationMultiplier, 1.0));
            trailDistance =
                rangeHeight *
                Math.max(0, toFiniteNumber(config.trailDistanceMultiplier, 0.5));
        } else if (
            trade.strategy === "stochastic_divergence" &&
            Number.isFinite(initialStopDistance) &&
            Number.isFinite(atrDistance)
        ) {
            activationDistance =
                initialStopDistance *
                Math.max(
                    0,
                    toFiniteNumber(config.trailActivationSlMultiplier, 1.5)
                );
            trailDistance =
                atrDistance *
                Math.max(0, toFiniteNumber(config.trailDistanceAtr, 1.0));
        } else if (
            trade.strategy === "squeeze_play" &&
            Number.isFinite(atrDistance)
        ) {
            activationDistance =
                atrDistance *
                Math.max(0, toFiniteNumber(config.trailActivationAtr, 2.0));
            trailDistance =
                atrDistance *
                Math.max(0, toFiniteNumber(config.trailDistanceAtr, 1.0));
        } else if (config.enableTrailingStops !== false) {
            activationDistance =
                toFiniteNumber(config.trailingStopActivationPips, 20) *
                this.getPipValue(trade.instrument);
            trailDistance =
                toFiniteNumber(config.trailingStopPips, 25) *
                this.getPipValue(trade.instrument);
        }

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

        const nextStop =
            trade.side === "BUY"
                ? currentPrice - trailDistance
                : currentPrice + trailDistance;
        const existingStop = toFiniteNumber(trade.stopLossPrice, nextStop);
        const shouldUpdate =
            trade.side === "BUY"
                ? nextStop > existingStop
                : nextStop < existingStop;

        if (!shouldUpdate) {
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

    async closeTrade(trade, exitPrice, exitReason) {
        if (!trade || !Number.isFinite(Number(exitPrice))) {
            return null;
        }

        const closeTimestamp = Date.now();
        const pipValue = this.getPipValue(trade.instrument);
        const entryPrice = toFiniteNumber(trade.entryPrice, exitPrice);
        const priceChange =
            trade.side === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice;
        const pnlPips = pipValue > 0 ? priceChange / pipValue : 0;
        const pnlAud = toFiniteNumber(trade.units, 0) * priceChange;
        const pnlPercent =
            entryPrice > 0 && toFiniteNumber(trade.entryCostAud, 0) > 0
                ? (pnlAud / trade.entryCostAud) * 100
                : 0;
        const holdingPeriodMs = Math.max(
            0,
            closeTimestamp - toFiniteNumber(trade.entryTime, closeTimestamp)
        );

        const closedTrade = {
            ...trade,
            exitPrice,
            exitTime: closeTimestamp,
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            holdingPeriodMs,
            closePriceSource: "PAPER_MARK",
            reconciliationStatus: "PAPER_SIMULATED",
            brokerExitReason: exitReason,
            brokerClosedAt: closeTimestamp,
            lastBrokerSyncAt: closeTimestamp,
            isOpen: false,
        };

        await this.tradeRepository.updateTrade(trade.id, {
            exitPrice,
            exitTime: closeTimestamp,
            exitValueAud: toFiniteNumber(trade.units, 0) * exitPrice,
            exitReason,
            pnlAud,
            pnlPips,
            pnlPercent,
            holdingPeriodMs,
            closePriceSource: "PAPER_MARK",
            reconciliationStatus: "PAPER_SIMULATED",
            brokerExitReason: exitReason,
            brokerClosedAt: closeTimestamp,
            lastBrokerSyncAt: closeTimestamp,
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
        const closedTrades = [];

        for (const trade of openTrades) {
            const currentPrice =
                this.getCurrentPrice(trade.instrument) ||
                toFiniteNumber(trade.entryPrice, null);
            if (!Number.isFinite(currentPrice)) {
                continue;
            }

            const closedTrade = await this.closeTrade(
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
            const currentPrice =
                this.getCurrentPrice(trade.instrument) ||
                toFiniteNumber(trade.entryPrice, 0);
            const unrealizedPnlAud = calculateUnrealizedPnlAud(
                trade,
                currentPrice
            );

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
