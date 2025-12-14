// backend/src/services/signalGenerator.js
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { RSI, ADX, ATR } = require("technicalindicators");

class SignalGenerator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.isRunning = false;
        this.signalInterval = null;
        this.binanceDataService = null;

        this.config = {
            strategy: "balanced",
            timeframe: "1h",
            signalCooldown: 60000,
            assets: [],
            minAdx: 25,
            rsiOversold: 35,
            rsiOverbought: 70,
            ...config,
        };

        this.lastSignals = new Map();
        logger.info(`🧠 Signal Generator v3.1 (Trend-Safe) Initialized`);
    }

    start(binanceDataService, intervalMs = 60000) {
        if (this.isRunning) return;
        this.binanceDataService = binanceDataService;
        this.isRunning = true;
        this.generateSignalCycle();
        this.signalInterval = setInterval(() => {
            if (this.isRunning) this.generateSignalCycle();
        }, intervalMs);
        logger.info(`🚀 Generator Loop Started (${intervalMs}ms)`);
    }

    stop() {
        this.isRunning = false;
        if (this.signalInterval) clearInterval(this.signalInterval);
        this.emit("generatorStopped");
    }

    async generateSignalCycle() {
        if (!this.binanceDataService) return;
        try {
            const signals = await this.generateAllSignals(
                this.binanceDataService
            );
            if (signals.length > 0) {
                this.emit("allSignalsGenerated", signals);
                signals.forEach((s) => this.emit("signalGenerated", s));
            }
        } catch (error) {
            logger.error("❌ Signal Cycle Error:", error);
        }
    }

    prepareInputData(candles) {
        return {
            high: candles.map((c) => c.high),
            low: candles.map((c) => c.low),
            close: candles.map((c) => c.close),
        };
    }

    async generateSignal(symbol, candles, currentPrice) {
        try {
            if (!candles || candles.length < 200) return null;

            const input = this.prepareInputData(candles);

            // 1. Core Indicators
            const rsi = RSI.calculate({
                values: input.close,
                period: 14,
            }).pop();
            const adx = ADX.calculate({
                high: input.high,
                low: input.low,
                close: input.close,
                period: 14,
            }).pop();
            const atr = ATR.calculate({
                high: input.high,
                low: input.low,
                close: input.close,
                period: 14,
            }).pop();

            // 2. Logic: Trend-Safe Snapback
            let signalType = "HOLD";
            let reason = `Monitoring (ADX:${adx.adx.toFixed(0)} Dirm:${
                adx.pdi > adx.mdi ? "UP" : "DOWN"
            } RSI:${rsi.toFixed(0)})`;

            const isUptrend = adx.pdi > adx.mdi;
            const isStrongTrend = adx.adx > this.config.minAdx;
            const isOversold = rsi < this.config.rsiOversold;
            const isOverbought = rsi > this.config.rsiOverbought;

            // BUY: Strong Uptrend + Price Dip
            if (isStrongTrend && isUptrend && isOversold) {
                signalType = "BUY";
                reason = `🚀 TREND DIP: Uptrend (ADX ${adx.adx.toFixed(
                    0
                )}) + Oversold (RSI ${rsi.toFixed(0)})`;
            }
            // SELL: Overbought (Profit Taking)
            else if (isOverbought) {
                signalType = "SELL";
                reason = `💰 PROFIT: Overbought (RSI ${rsi.toFixed(0)} > 70)`;
            }

            return {
                symbol,
                signal: signalType,
                strength: adx.adx,
                message: reason,
                timestamp: Date.now(),
                data: { currentPrice, rsi, adx: adx.adx, atr },
                atr,
            };
        } catch (error) {
            logger.error(`Calc error ${symbol}:`, error);
            return null;
        }
    }

    validateSignal(signal) {
        if (!signal) return null;
        const key = `${signal.symbol}_${signal.signal}`;
        const lastTime = this.lastSignals.get(key) || 0;

        if (
            (signal.signal === "BUY" || signal.signal === "SELL") &&
            Date.now() - lastTime < this.config.signalCooldown
        ) {
            return {
                ...signal,
                signal: "COOLDOWN",
                message: "Signal Spam Filter",
            };
        }

        if (signal.signal === "BUY" || signal.signal === "SELL") {
            this.lastSignals.set(key, Date.now());
        }
        return signal;
    }

    async generateAllSignals(binanceDataService) {
        const signals = [];
        for (const asset of this.config.assets) {
            try {
                const candles = binanceDataService.getCandles(
                    asset,
                    this.config.timeframe
                );
                const priceData = binanceDataService.getCurrentPrice(asset);
                if (candles.length && priceData) {
                    let signal = await this.generateSignal(
                        asset,
                        candles,
                        priceData.price
                    );
                    signal = this.validateSignal(signal);
                    if (signal) signals.push(signal);
                }
            } catch (err) {}
        }
        return signals;
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }
    getStatus() {
        return { isActive: this.isRunning, config: this.config };
    }
    reset() {
        this.lastSignals.clear();
    }
}

module.exports = SignalGenerator;
