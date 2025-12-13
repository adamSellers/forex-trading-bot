// backend/scripts/optimize-strategy.js - MARKOV REGIME EDITION
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
    "DOTUSDT",
    "BCHUSDT",
    "LTCUSDT",
    "UNIUSDT",
    "NEARUSDT",
    "MATICUSDT",
    "ICPUSDT",
    "PEPEUSDT",
];

// Your "Golden Config" parameters
const STRATEGY = {
    adxThreshold: 40,
    rsiBuyThreshold: 30,
    rsiSellThreshold: 70,
    stopLossATR: 1.5,
    takeProfitATR: 3.0,
};

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
    let atr = [tr.slice(0, period).reduce((a, b) => a + b, 0) / period];
    for (let i = period; i < tr.length; i++) {
        atr.push((atr[i - period] * (period - 1) + tr[i]) / period);
    }
    return new Array(period - 1).fill(null).concat(atr);
}

function calculateADX(highs, lows, closes, period = 14) {
    const getTR = (i) =>
        Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
    const getDM = (i) => {
        const up = highs[i] - highs[i - 1];
        const down = lows[i - 1] - lows[i];
        return {
            p: up > down && up > 0 ? up : 0,
            m: down > up && down > 0 ? down : 0,
        };
    };
    let tr = [],
        pdm = [],
        mdm = [];
    for (let i = 1; i < highs.length; i++) {
        tr.push(getTR(i));
        const dm = getDM(i);
        pdm.push(dm.p);
        mdm.push(dm.m);
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
        const diPlus = (sPDM[i] / sTR[i]) * 100;
        const diMinus = (sMDM[i] / sTR[i]) * 100;
        const dx = (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
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

// --- MARKOV REGIME ENGINE ---
class MarkovRegime {
    constructor() {
        // State 0: Bear, State 1: Chop, State 2: Bull
        this.transitionCounts = {
            0: { 0: 0, 1: 0, 2: 0 },
            1: { 0: 0, 1: 0, 2: 0 },
            2: { 0: 0, 1: 0, 2: 0 },
        };
        this.stateTotals = { 0: 0, 1: 0, 2: 0 };
    }

    // Determine state based on Return and Volatility
    determineState(pctChange, volatility) {
        // High volatility threshold (simplified)
        const VOL_THRESHOLD = 0.005; // 0.5% move in 1h

        if (pctChange > VOL_THRESHOLD) return 2; // Strong Bull
        if (pctChange < -VOL_THRESHOLD) return 0; // Strong Bear
        return 1; // Chop/Noise
    }

    train(closes) {
        let prevState = null;

        for (let i = 1; i < closes.length; i++) {
            const pctChange = (closes[i] - closes[i - 1]) / closes[i - 1];
            // Volatility could be ATR, but pctChange magnitude works for rough state
            const currentState = this.determineState(pctChange);

            if (prevState !== null) {
                this.transitionCounts[prevState][currentState]++;
                this.stateTotals[prevState]++;
            }
            prevState = currentState;
        }
    }

    getProbabilities() {
        const probs = {};
        for (let from = 0; from <= 2; from++) {
            probs[from] = {};
            const total = this.stateTotals[from] || 1;
            for (let to = 0; to <= 2; to++) {
                probs[from][to] = this.transitionCounts[from][to] / total;
            }
        }
        return probs;
    }

    // "Stability Score": How likely is a Bull state to stay Bull?
    // High persistence = Good for trend following
    getBullStability() {
        const probs = this.getProbabilities();
        // Return P(Bull->Bull)
        return probs[2][2] || 0;
    }
}

// --- TRADING ENGINE ---
async function fetchHistory(symbol, days) {
    process.stdout.write(`📥 ${symbol}: Fetching ${days} days... `);
    const limit = 1000;
    let allCandles = [];
    let endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;

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

    const unique = allCandles
        .sort((a, b) => a.time - b.time)
        .filter((v, i, a) => a.findIndex((t) => t.time === v.time) === i);
    console.log(`${unique.length} candles`);
    return unique;
}

function analyzeAsset(symbol, candles) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;
    let wins = 0;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const rsiArr = calculateRSI(closes, 14);
    const adxArr = calculateADX(highs, lows, closes, 14);
    const atrArr = calculateATR(highs, lows, closes, 14);

    // --- MARKOV ANALYSIS ---
    const markov = new MarkovRegime();
    markov.train(closes);
    const stabilityScore = markov.getBullStability();

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const rsi = rsiArr[i];
        const adx = adxArr[i];
        const atr = atrArr[i];

        if (!rsi || !adx || !atr) continue;

        if (!position) {
            if (adx > STRATEGY.adxThreshold && rsi < STRATEGY.rsiBuyThreshold) {
                const stopPrice = price - atr * STRATEGY.stopLossATR;
                const riskPerShare = price - stopPrice;
                if (riskPerShare <= 0) continue;

                let qty = (usdt * 0.02) / riskPerShare;
                const maxQty = (usdt * 0.95) / price;
                qty = Math.min(qty, maxQty);

                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty,
                        sl: stopPrice,
                        tp: price + atr * STRATEGY.takeProfitATR,
                    };
                    usdt -= qty * price * 1.001;
                }
            }
        } else {
            let exitPrice = null;
            if (lows[i] <= position.sl) exitPrice = position.sl;
            else if (highs[i] >= position.tp) exitPrice = position.tp;
            else if (rsi > STRATEGY.rsiSellThreshold) exitPrice = price;

            if (exitPrice) {
                usdt += exitPrice * position.qty * 0.999;
                if (exitPrice > position.entry) wins++;
                trades++;
                position = null;
            }
        }
    }

    return {
        symbol,
        profit: usdt - INITIAL_CAPITAL,
        roi: ((usdt - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100,
        trades,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
        stabilityScore, // New Metric
    };
}

async function run() {
    try {
        console.log("🚀 AI Portfolio Builder (Markov Chain Enhanced)");
        const daysInput = await askQuestion(
            "Enter number of days to backtest (Rec: 365 or 730): "
        );
        const days = parseInt(daysInput) || 365;

        console.log(`\n🔄 Analyzing Market Regimes for last ${days} days...`);
        console.log("-----------------------------------");

        let results = [];

        for (const sym of CANDIDATES) {
            try {
                const data = await fetchHistory(sym, days);
                if (data.length < 50) continue;
                const res = analyzeAsset(sym, data);
                results.push(res);
            } catch (e) {
                console.error(`Error processing ${sym}:`, e.message);
            }
        }

        // Rank by a mix of Profit AND Stability
        // We want profitable coins, but we prioritize those that STAY in bull trends
        results.sort((a, b) => b.profit - a.profit);

        console.log(`\n🏆 ASSET PERFORMANCE RANKING (${days} Days)`);
        console.log(
            "----------------------------------------------------------------------------------"
        );
        console.log(
            "Symbol      | Profit ($) | Return (%) | Win Rate | Stability (P) | Trades"
        );
        console.log(
            "----------------------------------------------------------------------------------"
        );

        results.forEach((r) => {
            const pColor = r.profit > 0 ? "\x1b[32m" : "\x1b[31m";
            const sColor = r.stabilityScore > 0.35 ? "\x1b[32m" : "\x1b[33m"; // >35% persistence is good for hourly
            const reset = "\x1b[0m";

            console.log(
                `${r.symbol.padEnd(12)}| ` +
                    `${pColor}$${r.profit.toFixed(2).padEnd(9)}${reset}| ` +
                    `${pColor}${r.roi.toFixed(1)}%${reset}`.padEnd(19) +
                    `| ${r.winRate.toFixed(0)}%       ` +
                    `| ${sColor}${(r.stabilityScore * 100).toFixed(
                        1
                    )}%${reset}`.padEnd(23) +
                    `| ${r.trades}`
            );
        });

        const winners = results.filter((r) => r.profit > 0).slice(0, 5);

        if (winners.length === 0) {
            console.log(
                "\n⚠️ No assets were profitable. Recommendation: STAY IN CASH (USDT)."
            );
        } else {
            // ALLOCATION LOGIC: Weight by Profit * Stability
            // This rewards coins that are not just lucky, but consistent.
            let totalWeight = 0;
            const allocation = {};

            winners.forEach((r) => {
                const weight = r.profit * (1 + r.stabilityScore); // Boost stable coins
                totalWeight += weight;
                r.weight = weight;
            });

            winners.forEach((r) => {
                let share = (r.weight / totalWeight) * 100;
                share = Math.max(5, Math.min(35, share));
                allocation[r.symbol] = Math.round(share);
            });

            // Normalize
            const currentTotal = Object.values(allocation).reduce(
                (a, b) => a + b,
                0
            );
            const factor = 100 / currentTotal;
            Object.keys(allocation).forEach(
                (k) => (allocation[k] = Math.round(allocation[k] * factor))
            );

            console.log(
                "\n💡 MARKOV-ADJUSTED ALLOCATION (Optimized for Regime Stability)"
            );
            console.log(
                "-------------------------------------------------------------"
            );
            console.log(JSON.stringify(allocation, null, 2));
        }
    } catch (err) {
        console.error("Fatal Error:", err);
    } finally {
        rl.close();
        process.exit(0);
    }
}

run();
