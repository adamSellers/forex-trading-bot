const EventEmitter = require("events");

const logger = require("../utils/logger");
const { computeConfigHash } = require("../config/tradingConfig");
const { getStrategyDefinition } = require("../strategies");

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
        const setupId = [
            instrument,
            direction,
            signalCandleTime,
            evaluation.entryType || "SCAN",
        ].join(":");
        const decisionContext = {
            currentDirection: evaluation.currentDir || 0,
            previousDirection: evaluation.prevDir || 0,
            currentPrice,
            adx: evaluation.adxVal || 0,
            atr: evaluation.atrVal || 0,
            atrPips: evaluation.atrPips || 0,
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
                supertrend_direction: evaluation.currentDir || 0,
                atrPips: Number(evaluation.atrPips || 0),
                htfDirection: htf.direction,
                htfTimeframe: htf.timeframe,
            },
            data: {
                currentPrice,
                adx: Number(evaluation.adxVal || 0),
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

    validateSignal(signal) {
        if (!signal) return null;
        if (signal.signal !== "BUY" && signal.signal !== "SELL") return signal;

        const key = `${signal.symbol}:${signal.signal}:${signal.intent || ""}`;
        const prior = this.lastSignals.get(key);
        const duplicateCandle =
            prior?.signalCandleTime === signal.signalCandleTime &&
            prior?.entryType === signal.entryType;
        const rateLimited =
            prior && Date.now() - prior.time < Number(this.config.signalCooldown || 0);
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
        this.lastSignals.set(key, {
            time: Date.now(),
            signalCandleTime: signal.signalCandleTime,
            entryType: signal.entryType,
        });
        return signal;
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
