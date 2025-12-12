// backend/scripts/optimize-strategy.js - GOLDEN CONFIG VALIDATOR
// Standalone Backtester - Verifies your specific Live Config

const Binance = require("node-binance-api");

// --- CONFIGURATION ---
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"]; // Top 4 Assets
const TIMEFRAME = "1h";
const DAYS_OF_HISTORY = 90; // 2 Months of recent data

// 🎯 TARGET: Your "Golden Config" (Single Value for Validation)
const PARAM_GRID = {
    adxThreshold: [30], // Live: 30
    rsiBuyThreshold: [30], // Live: 30
    rsiSellThreshold: [70], // Live: 70
    stopLossATR: [1.5], // Live: 1.5
    takeProfitATR: [3.0], // Live: 3.0
};

// Initialize without keys (Public data only)
const binance = new Binance().options({
    family: 4,
    log: () => {}, // Silence default logs
});

// --- INDICATOR MATH ---
function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    let emaArray = [data[0]];
    for (let i = 1; i < data.length; i++) {
        emaArray.push(data[i] * k + emaArray[i - 1] * (1 - k));
    }
    return emaArray;
}

function calculateRSI(closes, period = 14) {
    let gains = 0,
        losses = 0;
    // Initial Average
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    const rsiArray = new Array(period).fill(null);
    rsiArray.push(100 - 100 / (1 + avgGain / avgLoss));

    // Smoothed
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

    let adx = [];
    let dxList = [];

    for (let i = 0; i < sTR.length; i++) {
        const diPlus = (sPDM[i] / sTR[i]) * 100;
        const diMinus = (sMDM[i] / sTR[i]) * 100;
        const dx = (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
        dxList.push(dx);

        if (i >= period - 1) {
            if (adx.length === 0) {
                adx.push(
                    dxList
                        .slice(i - period + 1, i + 1)
                        .reduce((a, b) => a + b, 0) / period
                );
            } else {
                adx.push((adx[adx.length - 1] * (period - 1) + dx) / period);
            }
        } else {
            adx.push(null);
        }
    }
    return new Array(period * 2).fill(null).concat(adx);
}

// --- ENGINE LOGIC ---

async function fetchHistory(symbol) {
    process.stdout.write(`📥 ${symbol}: Fetching history... `);
    const limit = 1000;
    let allCandles = [];
    let endTime = Date.now();

    // Fetch loop
    while (allCandles.length < DAYS_OF_HISTORY * 24) {
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
        allCandles = [...candles, ...allCandles];
        endTime = candles[0].time - 1;
        await new Promise((r) => setTimeout(r, 100));
    }

    allCandles.sort((a, b) => a.time - b.time);
    const unique = allCandles.filter(
        (v, i, a) => a.findIndex((t) => t.time === v.time) === i
    );

    console.log(`✅ Loaded ${unique.length} candles`);
    return unique;
}

function simulateTrade(symbol, candles, params) {
    let usdt = 1000;
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
        const high = highs[i];
        const low = lows[i];
        const date = new Date(candles[i].time).toLocaleString();

        if (!rsi || !adx || !atr) continue;

        if (!position) {
            // BUY SIGNAL: Strict Golden Config
            if (adx > params.adxThreshold && rsi < params.rsiBuyThreshold) {
                const stopPrice = price - atr * params.stopLossATR;
                const riskPerShare = price - stopPrice;
                if (riskPerShare <= 0) continue;

                // Position Sizing: Risk 2% of Account
                let qty = (usdt * 0.02) / riskPerShare;
                const maxQty = (usdt * 0.95) / price;
                qty = Math.min(qty, maxQty);

                if (qty * price < 10) continue;

                const cost = qty * price;
                usdt -= cost;
                usdt -= cost * 0.001;

                position = {
                    entry: price,
                    qty,
                    sl: stopPrice,
                    tp: price + atr * params.takeProfitATR,
                };

                console.log(
                    `  🟢 BUY  ${symbol} @ $${price.toFixed(
                        4
                    )} | Time: ${date} | ADX: ${adx.toFixed(1)}`
                );
            }
        } else {
            // SELL CHECKS
            let exitPrice = null;
            let reason = "";

            if (low <= position.sl) {
                exitPrice = position.sl;
                reason = "STOP_LOSS";
            } else if (high >= position.tp) {
                exitPrice = position.tp;
                reason = "TAKE_PROFIT";
            } else if (rsi > params.rsiSellThreshold) {
                exitPrice = price;
                reason = "RSI_EXIT";
            }

            if (exitPrice) {
                const revenue = exitPrice * position.qty;
                usdt += revenue;
                usdt -= revenue * 0.001;

                const pnl = revenue - position.entry * position.qty;
                const isWin = pnl > 0;

                if (isWin) wins++;
                trades++;

                const icon = isWin ? "💰" : "🔻";
                console.log(
                    `  ${icon} SELL ${symbol} @ $${exitPrice.toFixed(
                        4
                    )} | PnL: $${pnl.toFixed(2)} (${reason})`
                );

                position = null;
            }
        }
    }

    return {
        profit: usdt - 1000,
        trades,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
    };
}

async function run() {
    console.log("🚀 Starting LIVE CONFIG Validation...");
    console.log(
        `⚙️  Params: ADX>${PARAM_GRID.adxThreshold[0]} | TP:${PARAM_GRID.takeProfitATR[0]}xATR | SL:${PARAM_GRID.stopLossATR[0]}xATR`
    );

    // Fetch Data
    const marketData = {};
    for (const sym of SYMBOLS) {
        try {
            marketData[sym] = await fetchHistory(sym);
        } catch (e) {
            console.error(`Failed to load ${sym}`);
        }
    }

    // Run Single Simulation
    const params = {
        adxThreshold: PARAM_GRID.adxThreshold[0],
        rsiBuyThreshold: PARAM_GRID.rsiBuyThreshold[0],
        rsiSellThreshold: PARAM_GRID.rsiSellThreshold[0],
        stopLossATR: PARAM_GRID.stopLossATR[0],
        takeProfitATR: PARAM_GRID.takeProfitATR[0],
    };

    let totalProfit = 0;
    let totalTrades = 0;
    let totalWins = 0;

    for (const sym of SYMBOLS) {
        if (!marketData[sym] || marketData[sym].length === 0) continue;
        console.log(`\n--- Simulating ${sym} ---`);
        const res = simulateTrade(sym, marketData[sym], params);

        console.log(
            `👉 ${sym} Result: $${res.profit.toFixed(2)} | Trades: ${
                res.trades
            }`
        );

        totalProfit += res.profit;
        totalTrades += res.trades;
        if (res.winRate > 0) totalWins += (res.winRate / 100) * res.trades;
    }

    console.log("\n\n🏆 VALIDATION RESULTS 🏆");
    console.log("---------------------------");
    console.log(
        `Total Simulated Profit: $${totalProfit.toFixed(
            2
        )} (on $1000 per asset)`
    );
    console.log(`Total Trades: ${totalTrades}`);
    console.log(
        `Overall Win Rate: ${
            totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0
        }%`
    );

    if (totalProfit > 0) console.log("✅ STRATEGY VALIDATED: PROFITABLE");
    else console.log("⚠️ STRATEGY WARNING: CURRENT SETTINGS SHOW LOSS");
}

run();
