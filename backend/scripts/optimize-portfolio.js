// backend/scripts/optimize-portfolio.js
// 🚀 MOMENTUM PORTFOLIO OPTIMIZER & BACKTESTER
// Logic: Ranks assets by ROI -> Suggests a DIVERSIFIED Weighted Portfolio
// Run: "node scripts/optimize-portfolio.js"

const Binance = require("node-binance-api");
const readline = require("readline");

// --- CONFIGURATION ---
// The Pool of Candidates to Scan
const ASSETS = [
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
    "FETUSDT",
    "WIFUSDT",
];

const STRATEGY = {
    timeframe: "1h",
    atrPeriod: 10,
    factor: 3.0,
    minAdx: 28,
    maxRsi: 75,
    stopLossPct: 0.03, // 3% Fixed Stop
    tradingFee: 0.001, // 0.1% Fee
};

// Initialize Binance (Public endpoints only)
const binance = new Binance().options({ family: 4, log: () => {} });

// --- INDICATORS (Standard Parity) ---

function calculateRSI(closes, period = 14) {
    let rsi = new Array(closes.length).fill(0);
    if (closes.length < period + 1) return rsi;
    let gains = 0,
        losses = 0;
    for (let i = 1; i <= period; i++) {
        let diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgUp = gains / period;
    let avgDown = losses / period;
    rsi[period] = 100 - 100 / (1 + avgUp / avgDown);
    for (let i = period + 1; i < closes.length; i++) {
        let diff = closes[i] - closes[i - 1];
        let up = diff >= 0 ? diff : 0;
        let down = diff < 0 ? -diff : 0;
        avgUp = (avgUp * (period - 1) + up) / period;
        avgDown = (avgDown * (period - 1) + down) / period;
        if (avgDown === 0) rsi[i] = 100;
        else rsi[i] = 100 - 100 / (1 + avgUp / avgDown);
    }
    return rsi;
}

function calculateADX(highs, lows, closes, period = 14) {
    let plusDM = [],
        minusDM = [],
        tr = [];
    for (let i = 1; i < highs.length; i++) {
        let up = highs[i] - highs[i - 1];
        let down = lows[i - 1] - lows[i];
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
        tr.push(
            Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            )
        );
    }
    const smooth = (data) => {
        let smoothed = [data.slice(0, period).reduce((a, b) => a + b, 0)];
        for (let i = period; i < data.length; i++)
            smoothed.push(
                smoothed[smoothed.length - 1] -
                    smoothed[smoothed.length - 1] / period +
                    data[i]
            );
        return smoothed;
    };
    let smoothPlus = smooth(plusDM),
        smoothMinus = smooth(minusDM),
        smoothTR = smooth(tr);
    let adx = [],
        dxList = [];
    for (let i = 0; i < smoothTR.length; i++) {
        let diPlus = (smoothPlus[i] / smoothTR[i]) * 100;
        let diMinus = (smoothMinus[i] / smoothTR[i]) * 100;
        let dx = (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
        dxList.push(isNaN(dx) ? 0 : dx);
    }
    if (dxList.length < period) return new Array(highs.length).fill(0);
    let firstADX = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adx.push(firstADX);
    for (let i = period; i < dxList.length; i++)
        adx.push((adx[adx.length - 1] * (period - 1) + dxList[i]) / period);
    return new Array(highs.length - adx.length).fill(0).concat(adx);
}

function calculateSuperTrend(highs, lows, closes, period = 10, factor = 3) {
    let tr = [highs[0] - lows[0]],
        atr = [tr[0]];
    for (let i = 1; i < closes.length; i++) {
        let hl = highs[i] - lows[i],
            hc = Math.abs(highs[i] - closes[i - 1]),
            lc = Math.abs(lows[i] - closes[i - 1]);
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
        let prevFinalUpper = upperBand[i - 1],
            prevFinalLower = lowerBand[i - 1],
            prevClose = closes[i - 1];

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

        let prevDir = direction[i - 1],
            currentDir = prevDir;
        if (prevDir === 1 && closes[i] < lowerBand[i - 1]) currentDir = -1;
        else if (prevDir === -1 && closes[i] > upperBand[i - 1]) currentDir = 1;

        direction.push(currentDir);
        superTrend.push(currentDir === 1 ? finalLower : finalUpper);
    }
    return { superTrend, direction };
}

// --- DATA ENGINE ---

async function fetchHistory(symbol, days) {
    let candles = [];
    let endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;
    process.stdout.write(`   Scanning ${symbol}... `);

    try {
        while (true) {
            const data = await new Promise((r) =>
                binance.candlesticks(
                    symbol,
                    STRATEGY.timeframe,
                    (e, t) => r(t),
                    { limit: 1000, endTime }
                )
            );
            if (!data || !data.length) break;
            const parsed = data.map((c) => ({
                time: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
            }));
            candles = [...parsed, ...candles];
            if (parsed[0].time < startTime) break;
            endTime = parsed[0].time - 1;
            await new Promise((r) => setTimeout(r, 20)); // Rate limit safety
        }
        const filtered = candles
            .sort((a, b) => a.time - b.time)
            .filter((c) => c.time >= startTime);
        process.stdout.write(`OK (${filtered.length})\n`);
        return filtered;
    } catch (e) {
        console.log(`ERR: ${e.message}`);
        return [];
    }
}

// --- SIMULATION ENGINE ---

function runBacktest(symbol, candles) {
    const startBalance = 1000;
    let usdt = startBalance;
    let position = null;
    let stats = { trades: 0, wins: 0, losses: 0 };

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const st = calculateSuperTrend(
        highs,
        lows,
        closes,
        STRATEGY.atrPeriod,
        STRATEGY.factor
    );
    const rsi = calculateRSI(closes, 14);
    const adx = calculateADX(highs, lows, closes, 14);

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const dir = st.direction[i];
        const prevDir = st.direction[i - 1];

        // Simulating "Standalone" performance to determine rank
        // We assume 100% allocation HERE just to find the ROI of the asset itself
        if (!position) {
            if (
                prevDir === -1 &&
                dir === 1 &&
                adx[i] > STRATEGY.minAdx &&
                rsi[i] < STRATEGY.maxRsi
            ) {
                const qty = (usdt * 0.99) / price;
                position = {
                    entry: price,
                    qty: qty,
                    cost: qty * price,
                    stopLoss: price * (1 - STRATEGY.stopLossPct),
                };
                usdt -= position.cost * (1 + STRATEGY.tradingFee);
            }
        } else {
            let exitPrice = null;
            if (lows[i] <= position.stopLoss) exitPrice = position.stopLoss;
            else if (dir === -1) exitPrice = closes[i];

            if (exitPrice) {
                const revenue = position.qty * exitPrice;
                usdt += revenue * (1 - STRATEGY.tradingFee);
                stats.trades++;
                if (revenue > position.cost) stats.wins++;
                else stats.losses++;
                position = null;
            }
        }
    }

    let finalEquity = usdt;
    if (position) finalEquity += position.qty * closes[closes.length - 1];

    return {
        symbol,
        profit: finalEquity - startBalance,
        roi: ((finalEquity - startBalance) / startBalance) * 100,
        trades: stats.trades,
        winRate: stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0,
    };
}

// --- MAIN INTERFACE ---

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

console.clear();
console.log("\n🧪 PORTFOLIO WEIGHTING OPTIMIZER");
console.log("================================");
console.log("Determine the ideal asset mix based on recent momentum.");

rl.question("1. Lookback Days (e.g., 30): ", (daysIn) => {
    rl.question(
        "2. Target Portfolio Size (e.g. 5 assets): ",
        async (sizeIn) => {
            const days = parseInt(daysIn) || 30;
            const targetSize = parseInt(sizeIn) || 5;

            console.log(
                `\n🚀 Scanning ${ASSETS.length} assets over ${days} days...`
            );
            const results = [];

            for (const asset of ASSETS) {
                const candles = await fetchHistory(asset, days);
                if (candles.length > 50)
                    results.push(runBacktest(asset, candles));
            }

            // Rank by ROI
            results.sort((a, b) => b.roi - a.roi);

            console.log("\n📊 ASSET LEADERBOARD:");
            console.log("Rank | Asset      |   ROI    | Trades | Win Rate");
            console.log("-----|------------|----------|--------|---------");
            results.forEach((r, i) => {
                const color = r.roi > 0 ? "\x1b[32m" : "\x1b[31m";
                const reset = "\x1b[0m";
                console.log(
                    `${(i + 1).toString().padEnd(4)} | ${r.symbol.padEnd(
                        10
                    )} | ${color}${r.roi.toFixed(1)}%${reset}`.padEnd(25) +
                        ` | ${r.trades
                            .toString()
                            .padStart(6)} | ${r.winRate.toFixed(0)}%`
                );
            });

            // GENERATE ALLOCATION PLAN
            const winners = results.filter((r) => r.roi > -5); // Filter out catastrophes
            const topPicks = winners.slice(0, targetSize);

            // Calculate Weights (Equal Weight Strategy for Stability)
            const weightPerAsset = Math.floor(100 / topPicks.length);
            const remainder = 100 - weightPerAsset * topPicks.length;

            console.log(
                `\n\n🎯 OPTIMIZED PORTFOLIO PLAN (Top ${topPicks.length})`
            );
            console.log("==========================================");
            console.log("Use these settings in your Dashboard > Config:\n");

            topPicks.forEach((p, index) => {
                // Give remainder to the #1 rank
                const allocation =
                    index === 0 ? weightPerAsset + remainder : weightPerAsset;
                console.log(`✅ ${p.symbol.padEnd(10)} :  ${allocation}%`);
            });

            console.log("\n(Total Allocation: 100%)");
            console.log(
                "This ensures you trade the movers while maintaining diversity."
            );

            process.exit(0);
        }
    );
});
