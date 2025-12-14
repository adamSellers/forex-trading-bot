// backend/scripts/optimize-strategy.js - FINAL PRODUCTION CANDIDATE
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

// THE "GOLDEN CONFIG" (Proven Winner)
const STRATEGY = {
    // Entry Filters
    minAdx: 30, // Strong Trend Requirement
    rsiOversold: 30, // Deep Dip Requirement
    rsiOverbought: 70, // Momentum Peak Exit

    // Risk Management (Simple & Effective)
    stopLossATR: 1.5, // Tight protection
    takeProfitATR: 3.0, // 2:1 Reward-to-Risk Ratio
    riskPerTrade: 0.02, // 2% Equity Risk
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

// --- INDICATORS ---
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

// --- MARKOV STABILITY (Used for Allocation Weighting Only) ---
class MarkovRegime {
    constructor() {
        this.transitionCounts = {
            0: { 0: 0, 1: 0, 2: 0 },
            1: { 0: 0, 1: 0, 2: 0 },
            2: { 0: 0, 1: 0, 2: 0 },
        };
        this.stateTotals = { 0: 0, 1: 0, 2: 0 };
    }
    determineState(pct) {
        if (pct > 0.005) return 2; // Bull
        if (pct < -0.005) return 0; // Bear
        return 1; // Chop
    }
    train(closes) {
        let prev = null;
        for (let i = 1; i < closes.length; i++) {
            const pct = (closes[i] - closes[i - 1]) / closes[i - 1];
            const curr = this.determineState(pct);
            if (prev !== null) {
                this.transitionCounts[prev][curr]++;
                this.stateTotals[prev]++;
            }
            prev = curr;
        }
    }
    getBullStability() {
        return this.transitionCounts[2][2] / (this.stateTotals[2] || 1) || 0;
    }
}

// --- BACKTEST ENGINE ---
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
                (e, t) =>
                    resolve(
                        t
                            ? t.map((c) => ({
                                  time: c[0],
                                  open: parseFloat(c[1]),
                                  high: parseFloat(c[2]),
                                  low: parseFloat(c[3]),
                                  close: parseFloat(c[4]),
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
    // Dedup
    return allCandles
        .sort((a, b) => a.time - b.time)
        .filter((v, i, a) => a.findIndex((t) => t.time === v.time) === i);
}

function analyzeAsset(symbol, candles) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;
    let wins = 0;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const rsiArr = calculateRSI(closes);
    const adxArr = calculateADX(highs, lows, closes);
    const atrArr = calculateATR(highs, lows, closes);

    // Calc Stability
    const markov = new MarkovRegime();
    markov.train(closes);

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const rsi = rsiArr[i];
        const adx = adxArr[i];
        const atr = atrArr[i];
        if (!rsi || !adx || !atr) continue;

        if (!position) {
            // ENTRY: High ADX + Low RSI
            if (adx > STRATEGY.minAdx && rsi < STRATEGY.rsiOversold) {
                const stopDist = atr * STRATEGY.stopLossATR;
                const stopPrice = price - stopDist;
                const tpPrice = price + atr * STRATEGY.takeProfitATR;

                // RISK SIZING: 2% of Current Equity
                const riskPerShare = price - stopPrice;
                let qty = (usdt * STRATEGY.riskPerTrade) / riskPerShare;

                // Max Allocation Cap (95%)
                if (qty * price > usdt * 0.95) qty = (usdt * 0.95) / price;

                // Min Notional Check ($10)
                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty,
                        sl: stopPrice,
                        tp: tpPrice,
                    };
                    usdt -= qty * price * 1.001; // Fee
                }
            }
        } else {
            // EXIT: Fixed SL or TP or RSI Peak
            let exitPrice = null;
            let reason = null;

            if (lows[i] <= position.sl) {
                exitPrice = position.sl;
                reason = "SL";
            } else if (highs[i] >= position.tp) {
                exitPrice = position.tp;
                reason = "TP";
            } else if (rsi > STRATEGY.rsiOverbought) {
                exitPrice = price;
                reason = "RSI_PEAK";
            }

            if (exitPrice) {
                usdt += exitPrice * position.qty * 0.999; // Fee
                if (exitPrice > position.entry) wins++;
                trades++;
                position = null;
            }
        }
    }

    // Mark open position to market
    let finalEq = usdt;
    if (position) finalEq += position.qty * closes[closes.length - 1] * 0.999;

    return {
        symbol,
        profit: finalEq - INITIAL_CAPITAL,
        roi: ((finalEq - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100,
        trades,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
        stabilityScore: markov.getBullStability(),
    };
}

async function run() {
    console.log("🚀 FINAL STRATEGY OPTIMIZER (Production Config)");
    console.log(
        `ℹ️  Logic: ADX>${STRATEGY.minAdx} + RSI<${STRATEGY.rsiOversold} | Exit: TP 3.0 ATR / SL 1.5 ATR`
    );

    const days =
        parseInt(await askQuestion("Days to backtest (Rec: 180): ")) || 180;
    console.log("-----------------------------------------------------------");

    let results = [];
    for (const sym of CANDIDATES) {
        try {
            const data = await fetchHistory(sym, days);
            if (data.length > 200) results.push(analyzeAsset(sym, data));
            console.log(`✅ ${sym}: ${data.length} candles`);
        } catch (e) {
            console.error(`❌ ${sym}: ${e.message}`);
        }
    }

    results.sort((a, b) => b.profit - a.profit);

    console.log(`\n🏆 FINAL RANKING (${days} Days)`);
    console.log(
        "----------------------------------------------------------------------------------"
    );
    console.log(
        "Symbol      | Profit ($) | ROI (%)  | Win Rate | Stability | Trades"
    );
    console.log(
        "----------------------------------------------------------------------------------"
    );

    results.forEach((r) => {
        const c = r.profit > 0 ? "\x1b[32m" : "\x1b[31m";
        const rst = "\x1b[0m";
        console.log(
            `${r.symbol.padEnd(12)}| ${c}$${r.profit
                .toFixed(2)
                .padEnd(9)}${rst}| ` +
                `${c}${r.roi.toFixed(1)}%${rst}`.padEnd(19) +
                `| ${r.winRate.toFixed(0)}%       | ${(
                    r.stabilityScore * 100
                ).toFixed(1)}%     | ${r.trades}`
        );
    });

    // GENERATE ALLOCATION
    const winners = results.filter((r) => r.profit > 0);
    if (winners.length > 0) {
        let alloc = {};
        let totalW = 0;
        winners.forEach((r) => {
            const w = r.profit * (1 + r.stabilityScore); // Reward profit + stability
            r.weight = w;
            totalW += w;
        });

        winners.forEach((r) => {
            let pct = (r.weight / totalW) * 100;
            if (pct > 35) pct = 35; // Max cap
            if (pct < 5) pct = 5; // Min cap
            alloc[r.symbol] = Math.round(pct);
        });

        // Normalize
        const sum = Object.values(alloc).reduce((a, b) => a + b, 0);
        Object.keys(alloc).forEach(
            (k) => (alloc[k] = Math.round(alloc[k] * (100 / sum)))
        );

        console.log("\n💡 RECOMMENDED PROD ALLOCATION (Copy to Config):");
        console.log(JSON.stringify(alloc, null, 2));
    } else {
        console.log(
            "\n⚠️ MARKET CONDITION: BEARISH. Recommendation: 100% USDT."
        );
    }

    process.exit(0);
}

run();
