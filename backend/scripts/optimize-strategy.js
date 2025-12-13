// backend/scripts/optimize-strategy.js - COMPARISON EDITION
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
    adxThreshold: 30,
    rsiBuyThreshold: 30,
    rsiSellThreshold: 70,
    stopLossATR: 1.5,
    takeProfitATR: 3.0,
};

// Current Production Settings for Comparison
const CURRENT_PORTFOLIO = {
    BTCUSDT: 0.3,
    ETHUSDT: 0.3,
    BNBUSDT: 0.2,
    DOGEUSDT: 0.2,
};

const TIMEFRAME = "1h";
const INITIAL_CAPITAL_PER_ASSET = 1000;

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

// --- ENGINE ---
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

function simulateTrade(symbol, candles) {
    let usdt = INITIAL_CAPITAL_PER_ASSET;
    let position = null;
    let trades = 0;
    let wins = 0;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const rsiArr = calculateRSI(closes, 14);
    const adxArr = calculateADX(highs, lows, closes, 14);
    const atrArr = calculateATR(highs, lows, closes, 14);

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
        profit: usdt - INITIAL_CAPITAL_PER_ASSET,
        roi: (usdt - INITIAL_CAPITAL_PER_ASSET) / INITIAL_CAPITAL_PER_ASSET, // Decimal ROI (0.10 = 10%)
        trades,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
    };
}

async function run() {
    try {
        console.log("🚀 Interactive Portfolio Builder & Comparison");
        const daysInput = await askQuestion(
            "Enter number of days to backtest (e.g. 180): "
        );
        const days = parseInt(daysInput) || 180;

        console.log(`\n🔄 Starting Optimization for last ${days} days...`);
        console.log("-----------------------------------");

        let results = [];
        let resultMap = {};

        for (const sym of CANDIDATES) {
            try {
                const data = await fetchHistory(sym, days);
                if (data.length < 50) {
                    console.log(`⚠️  Skipping ${sym} (Insufficient data)`);
                    continue;
                }
                const res = simulateTrade(sym, data);
                results.push(res);
                resultMap[sym] = res;
            } catch (e) {
                console.error(`Error processing ${sym}:`, e.message);
            }
        }

        results.sort((a, b) => b.profit - a.profit);

        // --- 1. ASSET RANKING TABLE ---
        console.log(`\n🏆 ASSET PERFORMANCE RANKING (${days} Days)`);
        console.log(
            "-----------------------------------------------------------------"
        );
        console.log(
            "Symbol      | Profit ($) | Return (%) | Win Rate | Trades"
        );
        console.log(
            "-----------------------------------------------------------------"
        );

        results.forEach((r) => {
            const pColor = r.profit > 0 ? "\x1b[32m" : "\x1b[31m";
            const reset = "\x1b[0m";
            console.log(
                `${r.symbol.padEnd(12)}| ${pColor}$${r.profit
                    .toFixed(2)
                    .padEnd(9)}${reset}| ${pColor}${(r.roi * 100).toFixed(
                    1
                )}%${reset}`.padEnd(38) +
                    `| ${r.winRate.toFixed(0)}%      | ${r.trades}`
            );
        });

        // --- 2. CALCULATE OPTIMIZED ALLOCATION ---
        const winners = results.filter((r) => r.profit > 0).slice(0, 5);
        let optimizedAllocation = {};

        if (winners.length > 0) {
            const totalProfit = winners.reduce((sum, r) => sum + r.profit, 0);
            winners.forEach((r) => {
                let share = r.profit / totalProfit; // Decimal
                // Cap between 5% and 35%
                share = Math.max(0.05, Math.min(0.35, share));
                optimizedAllocation[r.symbol] = share;
            });
            // Normalize to 1.0 (100%)
            const currentTotal = Object.values(optimizedAllocation).reduce(
                (a, b) => a + b,
                0
            );
            Object.keys(optimizedAllocation).forEach(
                (k) =>
                    (optimizedAllocation[k] =
                        optimizedAllocation[k] / currentTotal)
            );
        }

        // --- 3. PORTFOLIO COMPARISON (Hypothetical $10,000 Portfolio) ---
        const PORTFOLIO_SIZE = 10000;

        const calcPortfolioPerf = (name, allocation) => {
            let totalProfit = 0;
            let weightedWinRate = 0;
            let covered = 0;

            Object.entries(allocation).forEach(([symbol, weight]) => {
                const res = resultMap[symbol];
                if (res) {
                    // Profit = Allocated Capital * ROI
                    const allocatedCapital = PORTFOLIO_SIZE * weight;
                    const profit = allocatedCapital * res.roi;
                    totalProfit += profit;
                    weightedWinRate += res.winRate * weight;
                    covered += weight;
                }
            });

            // Adjust if portfolio not fully covered (e.g. missing data)
            if (covered > 0) weightedWinRate = weightedWinRate / covered;

            return {
                name,
                totalProfit,
                roi: (totalProfit / PORTFOLIO_SIZE) * 100,
                winRate: weightedWinRate,
            };
        };

        const currentPerf = calcPortfolioPerf(
            "Current (PRD)",
            CURRENT_PORTFOLIO
        );
        const optPerf = calcPortfolioPerf("Optimized", optimizedAllocation);

        console.log(
            `\n⚖️  STRATEGY SHOWDOWN ($${PORTFOLIO_SIZE.toLocaleString()} Portfolio)`
        );
        console.log(
            "-----------------------------------------------------------------"
        );
        console.log(`Strategy       | Net Profit   | Total ROI | Avg Win Rate`);
        console.log(
            "-----------------------------------------------------------------"
        );

        const printPerf = (p) => {
            const color = p.totalProfit > 0 ? "\x1b[32m" : "\x1b[31m";
            const reset = "\x1b[0m";
            console.log(
                `${p.name.padEnd(15)}| ${color}$${p.totalProfit
                    .toFixed(2)
                    .padEnd(11)}${reset}| ${color}${p.roi.toFixed(
                    2
                )}%${reset}    | ${p.winRate.toFixed(1)}%`
            );
        };

        printPerf(currentPerf);
        printPerf(optPerf);

        // --- 4. RECOMMENDATION ---
        if (winners.length === 0) {
            console.log(
                "\n⚠️ No assets were profitable. Recommendation: STAY IN CASH (USDT)."
            );
        } else {
            console.log("\n💡 RECOMMENDED CONFIGURATION (Copy to Config)");
            console.log("---------------------------------------------");
            // Convert back to integer percentages for display
            let displayAlloc = {};
            Object.entries(optimizedAllocation).forEach(
                ([k, v]) => (displayAlloc[k] = Math.round(v * 100))
            );

            // Fix rounding error to ensure 100%
            const sum = Object.values(displayAlloc).reduce((a, b) => a + b, 0);
            if (sum !== 100) {
                const k = Object.keys(displayAlloc)[0];
                displayAlloc[k] += 100 - sum;
            }

            console.log(JSON.stringify(displayAlloc, null, 2));
        }
    } catch (err) {
        console.error("Fatal Error:", err);
    } finally {
        rl.close();
        process.exit(0);
    }
}

run();
