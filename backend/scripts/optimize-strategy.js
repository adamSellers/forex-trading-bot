// backend/scripts/test-portfolio-final.js
// 🎯 STRATEGY: MOMENTUM 6 PORTFOLIO (Strict Parity Version)
// Logic: Exact clone of Backtest 4.4 (ADX>28, RSI<75, SL 3%)
// Assets: ETH, NEAR, FET, WIF, SHIB, PEPE

const Binance = require("node-binance-api");
const fs = require("fs");

// --- CONFIGURATION ---
const PORTFOLIO = [
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

// Testing 3m, 6m, 1y (Focus on recent history where these memes actually existed)
const TIMEFRAMES_DAYS = [90, 180, 365];
const STARTING_CAPITAL = 1000;

// ⚡ EXACT WINNING SETTINGS (From Backtest 4.4)
const STRATEGY = {
    timeframe: "1h",
    atrPeriod: 10,
    factor: 3.0,
    minAdx: 28, // 🏆 Restored to 28
    maxRsi: 75, // 🛡️ Restored RSI Filter
    stopLossPct: 0.02222, // 3% Hard Stop
};

const binance = new Binance().options({ family: 4, log: () => {} });
const GLOBAL_LOG = {}; // For JSON output

// --- INDICATORS ---
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
        let basicUpper = (highs[i] + lows[i]) / 2 + factor * atr[i];
        let basicLower = (highs[i] + lows[i]) / 2 - factor * atr[i];
        let prevFinalUpper = upperBand[i - 1];
        let finalUpper =
            basicUpper < prevFinalUpper || closes[i - 1] > prevFinalUpper
                ? basicUpper
                : prevFinalUpper;
        upperBand.push(finalUpper);
        let prevFinalLower = lowerBand[i - 1];
        let finalLower =
            basicLower > prevFinalLower || closes[i - 1] < prevFinalLower
                ? basicLower
                : prevFinalLower;
        lowerBand.push(finalLower);
        let prevDir = direction[i - 1];
        let currentDir = prevDir;
        if (prevDir === 1 && closes[i] < lowerBand[i - 1]) currentDir = -1;
        else if (prevDir === -1 && closes[i] > upperBand[i - 1]) currentDir = 1;
        direction.push(currentDir);
        superTrend.push(currentDir === 1 ? finalLower : finalUpper);
    }
    return { superTrend, direction };
}

// --- ENGINE ---
async function fetchHistory(symbol, days) {
    let candles = [];
    let endTime = Date.now();
    const startTime = endTime - days * 86400 * 1000;
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
            if (!data.length) break;
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
            await new Promise((r) => setTimeout(r, 20));
        }
        return candles
            .sort((a, b) => a.time - b.time)
            .filter((c) => c.time >= startTime);
    } catch (e) {
        return [];
    }
}

function runBacktest(symbol, candles, startBalance) {
    let usdt = startBalance;
    let position = null;
    let trades = 0;
    let wins = 0;

    // Init Logging
    if (!GLOBAL_LOG[symbol]) GLOBAL_LOG[symbol] = [];

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const stData = calculateSuperTrend(
        highs,
        lows,
        closes,
        STRATEGY.atrPeriod,
        STRATEGY.factor
    );
    const adxData = calculateADX(highs, lows, closes);
    const rsiData = calculateRSI(closes);
    const directions = stData.direction;

    for (let i = 20; i < candles.length; i++) {
        if (usdt <= 0) break;
        const price = closes[i];
        const dir = directions[i];
        const prevDir = directions[i - 1];
        const adx = adxData[i];
        const rsi = rsiData[i];

        if (!position) {
            // THE WINNING LOGIC:
            if (
                prevDir === -1 &&
                dir === 1 &&
                adx > STRATEGY.minAdx &&
                rsi < STRATEGY.maxRsi
            ) {
                const qty = (usdt * 0.99) / price;
                const cost = qty * price;
                if (cost > 5) {
                    position = {
                        entry: price,
                        qty,
                        cost: cost,
                        stopLoss: price * (1 - STRATEGY.stopLossPct),
                        entryTime: candles[i].time,
                    };
                    usdt -= cost * 1.001;
                }
            }
        } else {
            let exitPrice = null;
            let reason = "";

            if (lows[i] <= position.stopLoss) {
                exitPrice = position.stopLoss;
                reason = "SL";
            } else if (dir === -1) {
                exitPrice = closes[i];
                reason = "FLIP";
            }

            if (exitPrice) {
                const revenue = exitPrice * position.qty;
                usdt += revenue * 0.999;
                const pnl = revenue - position.cost;
                trades++;
                if (pnl > 0) wins++;

                GLOBAL_LOG[symbol].push({
                    type: "LONG",
                    entryTime: new Date(position.entryTime).toISOString(),
                    exitTime: new Date(candles[i].time).toISOString(),
                    profit: pnl,
                    reason: reason,
                });

                position = null;
            }
        }
    }

    // Close at end for calculation
    if (position) {
        const lastPrice = closes[closes.length - 1];
        usdt += lastPrice * position.qty * 0.999;
    }
    return { symbol, profit: usdt - startBalance, trades, finalBalance: usdt };
}

async function run() {
    console.log(`\n🚀 PORTFOLIO STRESS TEST: MOMENTUM 6 (FIXED)`);
    console.log(
        `   Config: ADX > ${STRATEGY.minAdx} | RSI < ${STRATEGY.maxRsi} | SL 3%`
    );
    console.log(`   Assets: ${PORTFOLIO.join(", ")}`);

    const allocation = STARTING_CAPITAL / PORTFOLIO.length; // Equal Weight

    console.log(
        `\nTimeframe |  Net Profit  |   ROI    | Trades | Best Asset | Worst Asset`
    );
    console.log(
        `----------|--------------|----------|--------|------------|------------`
    );

    for (const days of TIMEFRAMES_DAYS) {
        process.stdout.write(`Testing ${days} days... `);
        let totalProfit = 0;
        let totalTrades = 0;
        let portfolioBalance = 0;
        let assetResults = [];

        // Clear log for this run
        for (const sym of PORTFOLIO) GLOBAL_LOG[sym] = [];

        for (const sym of PORTFOLIO) {
            const candles = await fetchHistory(sym, days);
            if (candles.length > 50) {
                const res = runBacktest(sym, candles, allocation);
                totalProfit += res.profit;
                totalTrades += res.trades;
                portfolioBalance += res.finalBalance;
                assetResults.push(res);
            } else {
                portfolioBalance += allocation; // Cash
            }
        }

        assetResults.sort((a, b) => b.profit - a.profit);
        const best = assetResults[0];
        const worst = assetResults[assetResults.length - 1];
        const roi =
            ((portfolioBalance - STARTING_CAPITAL) / STARTING_CAPITAL) * 100;

        process.stdout.clearLine();
        process.stdout.cursorTo(0);

        const color = totalProfit > 0 ? "\x1b[32m" : "\x1b[31m";
        const reset = "\x1b[0m";

        console.log(
            `${days.toString().padEnd(3)} Days  | ${color}$${totalProfit
                .toFixed(2)
                .padEnd(11)}${reset}| ${color}${roi
                .toFixed(2)
                .padStart(6)}%${reset} | ${totalTrades
                .toString()
                .padEnd(6)} | ${best.symbol} | ${worst.symbol}`
        );
    }

    fs.writeFileSync(
        `backtest_portfolio_log_${STRATEGY.minAdx}ADX_${STRATEGY.maxRsi}RSI.json`,
        JSON.stringify(GLOBAL_LOG, null, 2)
    );
    console.log(`\n📝 LOGS SAVED: backtest_portfolio_log.json`);
    process.exit(0);
}

run();
