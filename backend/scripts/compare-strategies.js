// backend/scripts/compare-strategies.js
const Binance = require("node-binance-api");
const readline = require("readline");

// --- CONFIGURATION ---
const CANDIDATES = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "TRXUSDT",
    "AVAXUSDT",
    "SHIBUSDT",
    "TONUSDT",
    "LINKUSDT",
    "LTCUSDT",
    "NEARUSDT",
    "MATICUSDT",
    "ICPUSDT",
];

const TIMEFRAME = "1h";
const INITIAL_CAPITAL = 1000;

const binance = new Binance().options({ family: 4, log: () => {} });

// --- UTILS ---
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
const askQuestion = (query) =>
    new Promise((resolve) => rl.question(query, resolve));

// --- INDICATOR MATH ---
function calculateSMA(data, period) {
    let sma = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        const sum = data
            .slice(i - period + 1, i + 1)
            .reduce((a, b) => a + b, 0);
        sma[i] = sum / period;
    }
    return sma;
}

function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = new Array(data.length).fill(null);
    if (data.length < period) return ema;
    ema[period - 1] = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema[i] = data[i] * k + ema[i - 1] * (1 - k);
    }
    return ema;
}

function calculateRSI(closes, period = 14) {
    let gains = 0,
        losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const rsiArray = new Array(period).fill(null);
    rsiArray.push(100 - 100 / (1 + avgGain / avgLoss));
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsiArray.push(100 - 100 / (1 + avgGain / avgLoss));
    }
    return rsiArray;
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
    let atr = new Array(period).fill(null);
    atr.push(tr.slice(0, period).reduce((a, b) => a + b, 0) / period);
    for (let i = period + 1; i < tr.length; i++) {
        atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
    }
    return new Array(period - 1).fill(null).concat(atr);
}

function calculateADX(highs, lows, closes, period = 14) {
    // Simplified ADX
    const getTR = (i) =>
        Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
    let tr = [],
        pdm = [],
        mdm = [];
    for (let i = 1; i < highs.length; i++) {
        tr.push(getTR(i));
        const up = highs[i] - highs[i - 1];
        const down = lows[i - 1] - lows[i];
        pdm.push(up > down && up > 0 ? up : 0);
        mdm.push(down > up && down > 0 ? down : 0);
    }
    const smooth = (arr) => {
        let s = [arr.slice(0, period).reduce((a, b) => a + b, 0)];
        for (let i = period; i < arr.length; i++)
            s.push(s[s.length - 1] - s[s.length - 1] / period + arr[i]);
        return s;
    };
    const sTR = smooth(tr);
    const sPDM = smooth(pdm);
    const sMDM = smooth(mdm);
    let adx = [],
        dxList = [];
    for (let i = 0; i < sTR.length; i++) {
        const diPlus = (100 * sPDM[i]) / sTR[i];
        const diMinus = (100 * sMDM[i]) / sTR[i];
        const dx = (100 * Math.abs(diPlus - diMinus)) / (diPlus + diMinus);
        dxList.push(dx);
        if (i >= period - 1) {
            if (adx.length === 0)
                adx.push(
                    dxList
                        .slice(i - period + 1, i + 1)
                        .reduce((a, b) => a + b, 0) / period
                );
            else adx.push((adx[adx.length - 1] * (period - 1) + dx) / period);
        } else adx.push(null);
    }
    return new Array(period * 2).fill(null).concat(adx);
}

// --- CORE SIMULATION ---

function determineRegime(price, ema50, ema200) {
    if (!ema50 || !ema200) return "UNKNOWN";
    if (ema50 > ema200 && price > ema50) return "BULL_STRONG";
    if (ema50 > ema200 && price < ema50) return "BULL_PULLBACK";
    if (ema50 < ema200 && price < ema50) return "BEAR_STRONG";
    return "CHOP";
}

// STRATEGY 1: LEAN (Old)
function runLeanStrategy(candles, indicators) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;

    const { closes, highs, lows, rsiArr, adxArr, atrArr } = indicators;

    for (let i = 200; i < candles.length; i++) {
        const price = closes[i];
        const rsi = rsiArr[i];
        const adx = adxArr[i];
        const atr = atrArr[i];
        if (!rsi || !adx || !atr) continue;

        if (!position) {
            // ENTRY: Fixed ADX 30, RSI 30
            if (adx > 30 && rsi < 30) {
                const stopDist = atr * 1.5;
                const stopPrice = price - stopDist;
                const riskPerShare = price - stopPrice;
                let qty = (usdt * 0.02) / riskPerShare;
                if (qty * price > usdt * 0.95) qty = (usdt * 0.95) / price;

                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty: qty,
                        sl: stopPrice,
                        tp: price + atr * 3.0,
                    };
                    usdt -= qty * price * 1.001;
                }
            }
        } else {
            // EXIT: Fixed TP or SL or RSI > 70
            let exitPrice = null;
            if (lows[i] <= position.sl) exitPrice = position.sl;
            else if (highs[i] >= position.tp) exitPrice = position.tp;
            else if (rsi > 70) exitPrice = price;

            if (exitPrice) {
                usdt += exitPrice * position.qty * 0.999;
                trades++;
                position = null;
            }
        }
    }
    if (position) usdt += position.qty * closes[closes.length - 1] * 0.999;
    return { profit: usdt - INITIAL_CAPITAL, trades };
}

// STRATEGY 2: QUANT (New - With Hybrid Tweak)
function runQuantStrategy(candles, indicators) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;

    const {
        closes,
        highs,
        lows,
        volumes,
        rsiArr,
        adxArr,
        atrArr,
        ema50Arr,
        ema200Arr,
        volSmaArr,
    } = indicators;

    for (let i = 200; i < candles.length; i++) {
        const price = closes[i];
        const rsi = rsiArr[i];
        const adx = adxArr[i];
        const atr = atrArr[i];
        const high = highs[i];
        const low = lows[i];
        if (!rsi || !adx || !atr) continue;

        const regime = determineRegime(price, ema50Arr[i], ema200Arr[i]);
        const volRatio = volumes[i] / (volSmaArr[i] || 1);

        if (position) {
            // UPDATE TRAILING STOP
            if (high > position.highestPrice) position.highestPrice = high;

            let exitPrice = null;
            let currentSL = position.sl;

            // HYBRID TWEAK: Only trail IF we hit TP1. Otherwise use fixed SL.
            // AND: Widen the trail to 5% (0.05) instead of 3% to catch runners like NEAR
            if (position.tp1Hit) {
                const trailSL = position.highestPrice * (1 - 0.05); // 5% Trail
                if (trailSL > currentSL) currentSL = trailSL;
            }

            if (low <= currentSL) {
                // Stop Out (Remainder)
                exitPrice = currentSL;
                usdt += position.qty * exitPrice * 0.999;
                position = null;
                trades++;
            } else if (!position.tp1Hit && high >= position.tp1) {
                // SCALE OUT 50%
                const sellQty = position.qty * 0.5;
                usdt += sellQty * position.tp1 * 0.999;
                position.qty -= sellQty;
                position.tp1Hit = true;
                position.sl = position.entry; // Breakeven
                trades++;
            } else if (rsi > 80 && regime === "BULL_STRONG") {
                // Extreme Overbought Exit
                exitPrice = price;
                usdt += position.qty * exitPrice * 0.999;
                position = null;
                trades++;
            }
        } else {
            // DYNAMIC ENTRY
            let rsiBuy = 30;
            if (regime === "BULL_STRONG" && adx > 25) rsiBuy = 40; // Catch SOL
            if (regime === "BEAR_STRONG") rsiBuy = 20;

            if (rsi < rsiBuy && adx > 25 && volRatio > 0.8) {
                // Lower vol requirement slightly
                const stopDist = atr * 2.0; // Wider stop
                const riskPerShare = price - (price - stopDist);
                let qty = (usdt * 0.02) / riskPerShare;
                if (qty * price > usdt * 0.95) qty = (usdt * 0.95) / price;

                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty: qty,
                        sl: price - stopDist,
                        tp1: price + atr * 3.0, // TP1 at 3R (Match Lean Target)
                        tp1Hit: false,
                        highestPrice: price,
                    };
                    usdt -= qty * price * 1.001;
                }
            }
        }
    }
    if (position) usdt += position.qty * closes[closes.length - 1] * 0.999;
    return { profit: usdt - INITIAL_CAPITAL, trades };
}

// --- RUNNER ---
async function fetchHistory(symbol, days) {
    const limit = 1000;
    let allCandles = [];
    let endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;
    process.stdout.write(`Fetching ${symbol}... `);

    while (true) {
        const candles = await new Promise((resolve) => {
            binance.candlesticks(
                symbol,
                TIMEFRAME,
                (e, t) =>
                    resolve(
                        t
                            ? t.map((c) => ({
                                  open: parseFloat(c[1]),
                                  high: parseFloat(c[2]),
                                  low: parseFloat(c[3]),
                                  close: parseFloat(c[4]),
                                  volume: parseFloat(c[5]),
                                  time: c[0],
                              }))
                            : []
                    ),
                { limit, endTime }
            );
        });
        if (!candles.length) break;
        const valid = candles.filter((c) => c.time >= startTime);
        allCandles = [...valid, ...allCandles];
        if (valid.length < candles.length) break;
        endTime = candles[0].time - 1;
        await new Promise((r) => setTimeout(r, 50));
    }
    console.log(`${allCandles.length} candles`);
    return allCandles
        .sort((a, b) => a.time - b.time)
        .filter((v, i, a) => a.findIndex((t) => t.time === v.time) === i);
}

async function run() {
    console.log("⚔️  STRATEGY SHOWDOWN: LEAN vs QUANT (Hybrid)");
    const days = 180;

    console.log(`\nSymbol      | LEAN Profit | QUANT Profit | Winner`);
    console.log(`-----------------------------------------------------`);

    for (const sym of CANDIDATES) {
        try {
            const candles = await fetchHistory(sym, days);
            if (candles.length < 200) continue;

            // Pre-calculate indicators ONCE
            const closes = candles.map((c) => c.close);
            const highs = candles.map((c) => c.high);
            const lows = candles.map((c) => c.low);
            const volumes = candles.map((c) => c.volume);

            const indicators = {
                closes,
                highs,
                lows,
                volumes,
                rsiArr: calculateRSI(closes),
                adxArr: calculateADX(highs, lows, closes),
                atrArr: calculateATR(highs, lows, closes),
                ema50Arr: calculateEMA(closes, 50),
                ema200Arr: calculateEMA(closes, 200),
                volSmaArr: calculateSMA(volumes, 20),
            };

            const lean = runLeanStrategy(candles, indicators);
            const quant = runQuantStrategy(candles, indicators);

            const leanColor = lean.profit > 0 ? "\x1b[32m" : "\x1b[31m";
            const quantColor = quant.profit > 0 ? "\x1b[32m" : "\x1b[31m";
            const winner = quant.profit > lean.profit ? "QUANT 🤖" : "LEAN ⚡";

            console.log(
                `${sym.padEnd(12)}| ` +
                    `${leanColor}$${lean.profit
                        .toFixed(0)
                        .padEnd(9)}\x1b[0m| ` +
                    `${quantColor}$${quant.profit
                        .toFixed(0)
                        .padEnd(10)}\x1b[0m| ` +
                    `${winner}`
            );
        } catch (e) {
            console.error(e);
        }
    }
    process.exit(0);
}

run();
