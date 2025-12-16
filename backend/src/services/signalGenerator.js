// backend/src/services/signalGenerator.js - SUPERTREND MOMENTUM EDITION
const EventEmitter = require("events");
const logger = require("../utils/logger");
const { RSI, ADX, ATR } = require("technicalindicators");

class SignalGenerator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.isRunning = false;
        this.signalInterval = null;
        this.binanceDataService = null;

        // FIXED: Initialize storage for the dashboard "Candidate Signals" tile
        this.latestSignals = [];

        this.config = {
            strategy: "supertrend_momentum",
            timeframe: "1h",
            signalCooldown: 60000,
            assets: [],
            minAdx: 28,
            rsiOverbought: 75,
            atrPeriod: 10,
            factor: 3,
            ...config,
        };

        this.lastSignals = new Map();
        logger.info(
            `🧠 Signal Generator v4.0 (SuperTrend Momentum) Initialized`
        );
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

            // FIXED: Store signals so the System Health dashboard can see them
            this.latestSignals = signals;

            if (signals.length > 0) {
                this.emit("allSignalsGenerated", signals);
                signals.forEach((s) => this.emit("signalGenerated", s));
            }
        } catch (error) {
            logger.error("❌ Signal Cycle Error:", error);
        }
    }

    // --- PORTED MATH: EXACT REPLICA OF OPTIMIZE-STRATEGY.JS ---
    calculateSuperTrend(highs, lows, closes, period = 10, factor = 3) {
        let tr = [highs[0] - lows[0]];
        let atr = [tr[0]];
        for (let i = 1; i < closes.length; i++) {
            let hl = highs[i] - lows[i];
            let hc = Math.abs(highs[i] - closes[i - 1]);
            let lc = Math.abs(lows[i] - closes[i - 1]);
            tr.push(Math.max(hl, hc, lc));
            atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
        }

        let upperBand = [],
            lowerBand = [],
            superTrend = [],
            direction = [];
        let basicUpper = (highs[0] + lows[0]) / 2 + factor * atr[0];
        let basicLower = (highs[0] + lows[0]) / 2 - factor * atr[0];

        upperBand.push(basicUpper);
        lowerBand.push(basicLower);
        superTrend.push(basicUpper);
        direction.push(1);

        for (let i = 1; i < closes.length; i++) {
            let currBasicUpper = (highs[i] + lows[i]) / 2 + factor * atr[i];
            let currBasicLower = (highs[i] + lows[i]) / 2 - factor * atr[i];

            let prevFinalUpper = upperBand[i - 1];
            let prevFinalLower = lowerBand[i - 1];
            let prevClose = closes[i - 1];

            let finalUpper =
                currBasicUpper < prevFinalUpper || prevClose > prevFinalUpper
                    ? currBasicUpper
                    : prevFinalUpper;
            let finalLower =
                currBasicLower > prevFinalLower || prevClose < prevFinalLower
                    ? currBasicLower
                    : prevFinalLower;

            upperBand.push(finalUpper);
            lowerBand.push(finalLower);

            let prevDir = direction[i - 1];
            let currentDir = prevDir;

            if (prevDir === 1 && closes[i] < lowerBand[i - 1]) currentDir = -1;
            else if (prevDir === -1 && closes[i] > upperBand[i - 1])
                currentDir = 1;

            direction.push(currentDir);
            superTrend.push(currentDir === 1 ? finalLower : finalUpper);
        }

        return { superTrend, direction };
    }

    async generateSignal(symbol, candles, currentPrice) {
        try {
            if (!candles || candles.length < 200) return null;

            const highs = candles.map((c) => c.high);
            const lows = candles.map((c) => c.low);
            const closes = candles.map((c) => c.close);

            // 1. Calculate Indicators
            const stData = this.calculateSuperTrend(
                highs,
                lows,
                closes,
                this.config.atrPeriod || 10,
                this.config.factor || 3
            );

            // Use completed candle for signal stability
            const idx = closes.length - 1;
            const currentDir = stData.direction[idx];
            const prevDir = stData.direction[idx - 1];

            const rsiVal = RSI.calculate({ values: closes, period: 14 }).pop();
            const adxVal = ADX.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14,
            }).pop();
            const atrVal = ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14,
            }).pop();

            // 2. Logic: Trend Flip
            let signalType = "HOLD";
            let reason = `ST:${
                currentDir === 1 ? "GREEN" : "RED"
            } ADX:${adxVal.adx.toFixed(1)} RSI:${rsiVal.toFixed(1)}`;

            // BUY: Green Flip + Strict Filters
            if (prevDir === -1 && currentDir === 1) {
                const adxOk = adxVal.adx > (this.config.minAdx || 28);
                const rsiOk = rsiVal < (this.config.rsiOverbought || 75);

                if (adxOk && rsiOk) {
                    signalType = "BUY";
                    reason = `🚀 BUY: ST Flip | ADX ${adxVal.adx.toFixed(
                        1
                    )} > 28 | RSI ${rsiVal.toFixed(1)} < 75`;
                } else {
                    reason = `⚠️ FILTERED: ST Flip but ADX/RSI weak`;
                }
            }
            // SELL: Red Flip
            else if (prevDir === 1 && currentDir === -1) {
                signalType = "SELL";
                reason = `📉 SELL: ST Flip to Red`;
            }

            return {
                symbol,
                signal: signalType,
                strength: adxVal.adx,
                message: reason,
                timestamp: Date.now(),
                data: {
                    currentPrice,
                    rsi: rsiVal,
                    adx: adxVal.adx,
                    stDirection: currentDir,
                },
                atr: atrVal,
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
        return {
            isActive: this.isRunning,
            config: this.config,
            // FIXED: Expose the latest signals for the dashboard
            activeSignals: this.latestSignals || [],
        };
    }

    reset() {
        this.lastSignals.clear();
        this.latestSignals = [];
    }
}

module.exports = SignalGenerator;
