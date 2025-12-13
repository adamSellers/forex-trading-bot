// backend/scripts/compare-strategies.js - FIXED MATH
const Binance = require("node-binance-api");

// --- CONFIGURATION ---
const ASSETS_TO_TEST = [
    "NEARUSDT",
    "LTCUSDT",
    "XRPUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "PEPEUSDT",
    "SOLUSDT",
];
const TIMEFRAME = "1h";
const INITIAL_CAPITAL = 1000;
const DAYS_HISTORY = 180;

const binance = new Binance().options({ family: 4, log: () => {} });

// --- UTILS ---
function calculateSMA(data, period) {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateStandardDeviation(data, period) {
    if (data.length < period) return null;
    const mean = calculateSMA(data, period);
    const squareDiffs = data
        .slice(-period)
        .map((value) => Math.pow(value - mean, 2));
    const avgSquareDiff = calculateSMA(squareDiffs, period);
    return Math.sqrt(avgSquareDiff);
}

function calculateBollingerBands(closes, period = 20, multiplier = 2) {
    const sma = calculateSMA(closes, period);
    if (!sma) return null;
    const stdDev = calculateStandardDeviation(closes, period);
    return {
        middle: sma,
        upper: sma + stdDev * multiplier,
        lower: sma - stdDev * multiplier,
    };
}

function calculateATR(highs, lows, closes, period = 14) {
    let tr = [highs[0] - lows[0]];
    for (let i = 1; i < highs.length; i++) {
        tr.push(
            Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            )
        );
    }
    let atr = [tr.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < tr.length; i++) {
        atr.push((atr[i - period] * (period - 1) + tr[i]) / period);
    }
    return new Array(period - 1).fill(null).concat(atr);
}

// --- STRATEGY A: CLASSIC TREND (EMA + ADX) ---
function runStrategyA(candles) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;
    let wins = 0;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const atrArr = calculateATR(highs, lows, closes, 14);

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const atr = atrArr[i];
        if (!atr) continue;

        const ema20 = calculateEMA(closes.slice(0, i + 1), 20);
        const ema50 = calculateEMA(closes.slice(0, i + 1), 50);
        const prevEma20 = calculateEMA(closes.slice(0, i), 20);
        const prevEma50 = calculateEMA(closes.slice(0, i), 50);

        if (!position) {
            // BUY Logic
            if (prevEma20 <= prevEma50 && ema20 > ema50) {
                const stopLoss = price - atr * 1.5;
                const takeProfit = price + atr * 3.0;

                // Position Sizing (Compounding)
                const cost = usdt * 0.99; // Use 99% of available cash
                const qty = cost / price;

                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty,
                        sl: stopLoss,
                        tp: takeProfit,
                    };

                    // FIXED: Subtract cost AND fee
                    usdt = usdt - cost - cost * 0.001;
                }
            }
        } else {
            // SELL Logic
            let exitPrice = null;
            if (lows[i] <= position.sl) exitPrice = position.sl;
            else if (highs[i] >= position.tp) exitPrice = position.tp;
            else if (ema20 < ema50) exitPrice = price;

            if (exitPrice) {
                const revenue = exitPrice * position.qty;
                // FIXED: Add revenue MINUS fee
                usdt = usdt + revenue - revenue * 0.001;

                if (exitPrice > position.entry) wins++;
                trades++;
                position = null;
            }
        }
    }
    return {
        profit: usdt - INITIAL_CAPITAL,
        trades,
        winRate: trades ? (wins / trades) * 100 : 0,
    };
}

// --- STRATEGY B: HYBRID (BOLLINGER BREAKOUT + EMA) ---
function runStrategyB(candles) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;
    let wins = 0;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const atrArr = calculateATR(highs, lows, closes, 14);

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const atr = atrArr[i];
        if (!atr) continue;

        // Indicators
        const bb = calculateBollingerBands(closes.slice(0, i + 1), 20, 2);
        const avgVol = calculateSMA(volumes.slice(i - 20, i), 20);
        const currentVol = volumes[i];

        const ema20 = calculateEMA(closes.slice(0, i + 1), 20);
        const ema50 = calculateEMA(closes.slice(0, i + 1), 50);

        if (!position) {
            let signal = false;

            // 1. BREAKOUT LOGIC
            if (price > bb.upper && currentVol > avgVol * 1.5) {
                signal = true;
            }

            // 2. TREND LOGIC
            const prevEma20 = calculateEMA(closes.slice(0, i), 20);
            const prevEma50 = calculateEMA(closes.slice(0, i), 50);
            if (prevEma20 <= prevEma50 && ema20 > ema50) {
                signal = true;
            }

            if (signal) {
                const stopLoss = price - atr * 1.5;
                const takeProfit = price + atr * 3.0;

                const cost = usdt * 0.99;
                const qty = cost / price;

                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty,
                        sl: stopLoss,
                        tp: takeProfit,
                    };

                    // FIXED: Subtract cost AND fee
                    usdt = usdt - cost - cost * 0.001;
                }
            }
        } else {
            let exitPrice = null;
            if (lows[i] <= position.sl) exitPrice = position.sl;
            else if (highs[i] >= position.tp) exitPrice = position.tp;
            else if (ema20 < ema50) exitPrice = price;
            else if (price < bb.middle) exitPrice = price;

            if (exitPrice) {
                const revenue = exitPrice * position.qty;
                // FIXED: Add revenue MINUS fee
                usdt = usdt + revenue - revenue * 0.001;

                if (exitPrice > position.entry) wins++;
                trades++;
                position = null;
            }
        }
    }
    return {
        profit: usdt - INITIAL_CAPITAL,
        trades,
        winRate: trades ? (wins / trades) * 100 : 0,
    };
}

// --- ENGINE ---
async function fetchHistory(symbol) {
    process.stdout.write(`📥 ${symbol}: Fetching history... `);
    const limit = 1000;
    let allCandles = [];
    let endTime = Date.now();
    const startTime = endTime - DAYS_HISTORY * 24 * 60 * 60 * 1000;

    while (true) {
        const candles = await new Promise((resolve) => {
            binance.candlesticks(
                symbol,
                TIMEFRAME,
                (error, ticks) => {
                    if (error || !ticks) {
                        resolve([]);
                        return;
                    }
                    resolve(
                        ticks.map((t) => ({
                            time: t[0],
                            open: parseFloat(t[1]),
                            high: parseFloat(t[2]),
                            low: parseFloat(t[3]),
                            close: parseFloat(t[4]),
                            volume: parseFloat(t[5]),
                        }))
                    );
                },
                { limit, endTime }
            );
        });

        if (candles.length === 0) break;
        const validCandles = candles.filter((c) => c.time >= startTime);
        allCandles = [...validCandles, ...allCandles];
        if (
            validCandles.length < candles.length ||
            candles[0].time <= startTime
        )
            break;
        endTime = candles[0].time - 1;
        await new Promise((r) => setTimeout(r, 100));
    }

    // Deduplicate and sort
    const unique = allCandles
        .sort((a, b) => a.time - b.time)
        .filter((v, i, a) => a.findIndex((t) => t.time === v.time) === i);
    console.log(`${unique.length} candles`);
    return unique;
}

async function run() {
    console.log(`⚔️  STRATEGY BATTLE: Trend vs. Hybrid (${DAYS_HISTORY} Days)`);
    console.log(
        "---------------------------------------------------------------"
    );
    console.log("Symbol      | Trend Profit | Hybrid Profit | Winner");
    console.log(
        "---------------------------------------------------------------"
    );

    let trendTotal = 0;
    let hybridTotal = 0;

    for (const sym of ASSETS_TO_TEST) {
        try {
            const data = await fetchHistory(sym);
            if (data.length < 200) continue;

            const resA = runStrategyA(data); // Trend
            const resB = runStrategyB(data); // Hybrid

            trendTotal += resA.profit;
            hybridTotal += resB.profit;

            const winner =
                resB.profit > resA.profit
                    ? "\x1b[32mHYBRID\x1b[0m"
                    : "\x1b[33mTREND\x1b[0m";
            const profitDiff = resB.profit - resA.profit;
            const sign = profitDiff > 0 ? "+" : "";

            console.log(
                `${sym.padEnd(12)}| ` +
                    `$${resA.profit.toFixed(0).padEnd(11)}| ` +
                    `$${resB.profit.toFixed(0).padEnd(12)}| ` +
                    `${winner} (${sign}${profitDiff.toFixed(0)})`
            );
        } catch (e) {
            console.error(e.message);
        }
    }

    console.log(
        "---------------------------------------------------------------"
    );
    console.log(
        `TOTAL       | $${trendTotal.toFixed(
            0
        )}         | $${hybridTotal.toFixed(0)}`
    );
    console.log(
        "---------------------------------------------------------------"
    );
}

run();
