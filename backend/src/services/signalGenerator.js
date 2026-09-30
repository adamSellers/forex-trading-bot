const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

const logger = require("../utils/logger");
const { computeConfigHash } = require("../config/tradingConfig");
const { getStrategyDefinition } = require("../strategies");
const { ENTRY_REJECTION_CODES } = require("../constants/entryDecisionCodes");

const RECONSIDERABLE_CODES = new Set([
    ENTRY_REJECTION_CODES.SPREAD_TOO_WIDE,
    ENTRY_REJECTION_CODES.COST_TO_STOP_TOO_HIGH,
    ENTRY_REJECTION_CODES.ENTRY_PRICE_DEVIATION,
]);

function candleTimeMs(value) {
    if (typeof value === "number") return value > 1e12 ? value : value * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

class SignalGenerator extends EventEmitter {
    constructor(config = {}, signalRepository = null) {
        super();
        this.isRunning = false;
        this.signalInterval = null;
        this.dataService = null;
        this.signalRepo = signalRepository;
        this.latestSignals = [];
        this.config = {
            strategy: "intraday_momentum",
            timeframe: "15m",
            signalCooldown: 60000,
            assets: [],
            ...config,
        };
        this.lastSignals = new Map();
        logger.info(
            `Live signal generator initialized: ${this.config.strategy} ${this.config.timeframe}`
        );
    }

    buildSignal(instrument, evaluation, strategyDefinition, currentPrice) {
        const htf = evaluation.htfContext || {
            enabled: false,
            timeframe: null,
            direction: 0,
            longAllowed: true,
            shortAllowed: true,
            reason: null,
        };
        const signalCandleTime = candleTimeMs(evaluation.signalCandleTime);
        const direction =
            evaluation.signalType === "BUY"
                ? "LONG"
                : evaluation.signalType === "SELL"
                  ? "SHORT"
                  : "WAIT";
        const setupParts = [
            instrument,
            direction,
            signalCandleTime,
            evaluation.entryType || "SCAN",
        ];
        if (evaluation.entryType === "M15_POST_TP_FADE") {
            setupParts.push(evaluation.strategyContext?.reentry?.anchor?.tradeId);
        }
        const setupId = setupParts.join(":");
        const rsi = Number.isFinite(evaluation.rsiVal) ? evaluation.rsiVal : null;
        const decisionContext = {
            currentDirection: evaluation.currentDir || 0,
            previousDirection: evaluation.prevDir || 0,
            currentPrice,
            adx: evaluation.adxVal || 0,
            atr: evaluation.atrVal || 0,
            atrPips: evaluation.atrPips || 0,
            rsi,
            htf,
            strategyContext: evaluation.strategyContext || null,
        };

        return {
            symbol: instrument,
            signal: evaluation.signalType || "HOLD",
            strength: Number(evaluation.adxVal || 0),
            message: evaluation.reason || "No live action",
            reasonCode: evaluation.reasonCode || "NO_ACTION",
            signalClass: evaluation.signalClass || "FILTERED",
            intent: evaluation.intent || "WAIT",
            entryType: evaluation.entryType || null,
            setupId,
            uniqueEvent: true,
            cooldownSuppressed: false,
            timestamp: Date.now(),
            signalCandleTime,
            atr: Number(evaluation.atrVal || 0),
            atrPips: Number(evaluation.atrPips || 0),
            currentPrice,
            strategy: this.config.strategy,
            strategyVersion: strategyDefinition.version,
            timeframe: this.config.timeframe,
            configHash: computeConfigHash(this.config),
            decisionContext,
            trend: {
                currentPrice,
                adx: Number(evaluation.adxVal || 0),
                rsi,
                supertrend_direction: evaluation.currentDir || 0,
                atrPips: Number(evaluation.atrPips || 0),
                htfDirection: htf.direction,
                htfTimeframe: htf.timeframe,
            },
            data: {
                currentPrice,
                adx: Number(evaluation.adxVal || 0),
                rsi,
                stDirection: evaluation.currentDir || 0,
                atrPips: Number(evaluation.atrPips || 0),
                htfDirection: htf.direction,
                htfTimeframe: htf.timeframe,
            },
            tradePlan: evaluation.tradePlan || null,
            strategyContext: evaluation.strategyContext || null,
        };
    }

    async generateSignal(instrument, candles, currentPrice, options = {}) {
        try {
            const strategy = getStrategyDefinition(this.config.strategy);
            if (!Array.isArray(candles) || candles.length < 2) {
                return this.buildSignal(
                    instrument,
                    {
                        signalType: "HOLD",
                        reason: "Waiting for complete market history",
                        reasonCode: "INSUFFICIENT_DATA",
                        signalClass: "FILTERED",
                        intent: "WAIT",
                        signalCandleTime: candles?.slice(-1)[0]?.time,
                    },
                    strategy,
                    currentPrice
                );
            }

            const evaluation = await strategy.evaluateEntry({
                instrument,
                candles,
                currentPrice,
                config: this.config,
                dataService: this.dataService,
                marketContext: options.marketContext || null,
                latestClosedTrade: options.latestClosedTrade,
                reentryHistoryAvailable: options.reentryHistoryAvailable,
                lossResetDecisions: options.lossResetDecisions,
                lossResetTrades: options.lossResetTrades,
                ownedOpenTrade: options.ownedOpenTrade,
                nowMs:
                    options.nowMs ??
                    candleTimeMs(candles[candles.length - 1]?.time),
            });
            return this.buildSignal(
                instrument,
                evaluation,
                strategy,
                currentPrice
            );
        } catch (error) {
            logger.error(
                `Live signal calculation failed for ${instrument}: ${error.message}`
            );
            return null;
        }
    }

    actionKey(signal) {
        return JSON.stringify([
            signal.runId || null, signal.configHash || null,
            signal.symbol, signal.signal, signal.intent || "",
        ]);
    }

    setupKey(signal) {
        return `${this.actionKey(signal)}:${signal.entryType || ""}`;
    }

    hasCandleState(signal) {
        const prior = this.lastSignals.get(this.setupKey(signal));
        return prior?.signalCandleTime === signal.signalCandleTime &&
            prior?.setupId === signal.setupId;
    }

    restoreEntryDecision(signal, decision) {
        if (!decision || decision.runId !== signal.runId ||
            decision.configHash !== signal.configHash || decision.setupId !== signal.setupId ||
            decision.signalCandleTime !== signal.signalCandleTime || decision.side !== signal.signal) {
            return;
        }
        const reference = Number(decision.entryReferencePrice);
        this.lastSignals.set(this.setupKey(signal), {
            actionKey: this.actionKey(signal),
            setupId: signal.setupId,
            signalCandleTime: signal.signalCandleTime,
            time: Number(decision.decisionTime),
            entryAttemptId: decision.decisionId,
            entryReferencePrice: Number.isFinite(reference) && reference > 0 ? reference : null,
            canReconsider: decision.outcome === "REJECTED" && decision.canReconsider === true &&
                RECONSIDERABLE_CODES.has(decision.rejectionCode) && Number.isFinite(reference) && reference > 0,
        });
    }

    acknowledgeEntryRejection({ signal, decisionId, rejectionCode, canReconsider } = {}) {
        if (!signal || canReconsider !== true || !RECONSIDERABLE_CODES.has(rejectionCode)) return false;
        const prior = this.lastSignals.get(this.setupKey(signal));
        if (!prior || prior.setupId !== signal.setupId ||
            prior.signalCandleTime !== signal.signalCandleTime ||
            prior.entryAttemptId !== signal.entryAttemptId || decisionId !== prior.entryAttemptId ||
            !Number.isFinite(prior.entryReferencePrice) || prior.entryReferencePrice <= 0) return false;
        prior.canReconsider = true;
        return true;
    }

    validateSignal(signal) {
        if (!signal) return null;
        if (signal.signal !== "BUY" && signal.signal !== "SELL") return signal;

        const key = this.setupKey(signal);
        const prior = this.lastSignals.get(key);
        const sameCandle = this.hasCandleState(signal);
        const duplicateCandle = sameCandle && !prior.canReconsider;
        const actionKey = this.actionKey(signal);
        const rateLimited = Array.from(this.lastSignals.values()).some((state) =>
            state.actionKey === actionKey &&
            Date.now() - state.time < Number(this.config.signalCooldown || 0)
        );
        if (duplicateCandle || rateLimited) {
            return {
                ...signal,
                signal: "COOLDOWN",
                signalClass: "COOLDOWN",
                reasonCode: duplicateCandle
                    ? "COOLDOWN_DUPLICATE_CANDLE"
                    : "COOLDOWN_RATE_LIMIT",
                message: duplicateCandle
                    ? "Live action already emitted for this candle"
                    : "Live action rate limited",
                uniqueEvent: false,
                cooldownSuppressed: true,
            };
        }
        // A new observation may improve costs; it must not move the first
        // attempt's execution bound. Reserve this attempt before emitting it.
        const entryReferencePrice = sameCandle ? prior.entryReferencePrice : signal.currentPrice;
        const entryAttemptId = uuidv4();
        this.lastSignals.set(key, {
            actionKey,
            setupId: signal.setupId,
            time: Date.now(),
            signalCandleTime: signal.signalCandleTime,
            entryAttemptId,
            entryReferencePrice,
            canReconsider: false,
        });
        return {
            ...signal,
            entryAttemptId,
            entryReferencePrice,
            decisionContext: {
                ...signal.decisionContext,
                entryAttemptId,
                entryReferencePrice,
            },
        };
    }

    async generateAllSignals(dataService) {
        this.dataService = dataService;
        const signals = [];
        for (const instrument of this.config.assets || []) {
            const candles =
                dataService.getCandles(instrument, this.config.timeframe) || [];
            const currentPrice = dataService.getCurrentPrice(instrument)?.price;
            if (!Number.isFinite(Number(currentPrice))) continue;
            let signal = await this.generateSignal(
                instrument,
                candles,
                Number(currentPrice)
            );
            signal = this.validateSignal(signal);
            if (signal) signals.push(signal);
        }
        return signals;
    }

    async generateSignalCycle() {
        if (!this.dataService) return [];
        const signals = await this.generateAllSignals(this.dataService);
        this.latestSignals = signals;
        if (signals.length) await this.signalRepo?.saveBatch?.(signals);
        signals.forEach((signal) => this.emit("signalGenerated", signal));
        this.emit("allSignalsGenerated", signals);
        return signals;
    }

    start(dataService, intervalMs = 60000) {
        if (this.isRunning) return;
        this.dataService = dataService;
        this.isRunning = true;
        this.generateSignalCycle().catch((error) =>
            logger.error("Live signal cycle failed:", error)
        );
        this.signalInterval = setInterval(() => {
            if (this.isRunning) {
                this.generateSignalCycle().catch((error) =>
                    logger.error("Live signal cycle failed:", error)
                );
            }
        }, intervalMs);
    }

    stop() {
        this.isRunning = false;
        if (this.signalInterval) clearInterval(this.signalInterval);
        this.signalInterval = null;
        this.emit("generatorStopped");
    }

    updateConfig(config = {}) {
        this.config = { ...this.config, ...config };
        return this.config;
    }

    getStatus() {
        return {
            isActive: this.isRunning,
            config: this.config,
            activeSignals: this.latestSignals,
            pendingEntries: [],
        };
    }

    reset() {
        this.lastSignals.clear();
        this.latestSignals = [];
    }

    clearPendingEntries() {
        const count = this.pendingEntries.size;
        this.pendingEntries.clear();
        return count;
    }
}

module.exports = SignalGenerator;
