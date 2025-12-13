// backend/scripts/test-risk-damping.js - FULL 20 ASSETS + PRODUCTION FILTERS
const Binance = require("node-binance-api");

// --- CONFIGURATION ---
const ASSETS_TO_TEST = [
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

const TIMEFRAME = "1h";
const INITIAL_CAPITAL = 1000;
const DAYS_HISTORY = 365;

// Strategy Config
const STRATEGY = {
    adxThreshold: 30, // Must have strong trend
    rsiBuyThreshold: 30, // Must be oversold (pullback)
    stopLossATR: 1.5,
    takeProfitATR: 3.0,
};

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

// --- CORE SIMULATION ENGINE ---
function simulate(symbol, candles, mode) {
    let usdt = INITIAL_CAPITAL;
    let position = null;
    let trades = 0;
    let wins = 0;

    // Risk Damping State
    let currentDayIndex = 0;
    let dailyPnL = 0;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const times = candles.map((c) => c.time);

    // Indicators
    const atrArr = calculateATR(highs, lows, closes, 14);
    const rsiArr = calculateRSI(closes, 14);
    const adxArr = calculateADX(highs, lows, closes, 14);

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const atr = atrArr[i];
        const rsi = rsiArr[i];
        const adx = adxArr[i];
        const time = times[i];

        if (!atr || !rsi || !adx) continue;

        // 1. Manage Daily PnL Reset
        const dayIndex = Math.floor(time / (24 * 60 * 60 * 1000));
        if (dayIndex > currentDayIndex) {
            dailyPnL = 0;
            currentDayIndex = dayIndex;
        }

        // 2. EMA Calc
        const ema20 = calculateEMA(closes.slice(0, i + 1), 20);
        const ema50 = calculateEMA(closes.slice(0, i + 1), 50);
        const prevEma20 = calculateEMA(closes.slice(0, i), 20);
        const prevEma50 = calculateEMA(closes.slice(0, i), 50);

        if (!position) {
            // FIX: Use EMA as a Filter (State), not a Trigger (Event)
            // We want to buy "Dips" (RSI < 30) in "Strong Uptrends" (EMA20 > EMA50 + ADX > 30)

            const isUptrend = ema20 > ema50;
            const isStrongTrend = adx > STRATEGY.adxThreshold;
            const isOversold = rsi < STRATEGY.rsiBuyThreshold;

            if (isUptrend && isStrongTrend && isOversold) {
                const stopDist = atr * STRATEGY.stopLossATR;
                const stopLoss = price - stopDist;
                const takeProfit = price + atr * STRATEGY.takeProfitATR;

                const cost = usdt * 0.99;
                const qty = cost / price;

                if (qty * price > 10) {
                    position = {
                        entry: price,
                        qty,
                        sl: stopLoss,
                        tp: takeProfit,
                        highestPrice: price,
                    };
                    usdt = usdt - cost - cost * 0.001; // Buy Fee
                }
            }
        } else {
            // MANAGE POSITION

            // A. Update Trailing Stop
            if (highs[i] > position.highestPrice) {
                position.highestPrice = highs[i];

                // --- RISK DAMPING LOGIC ---
                let modifier = 1.0;
                if (mode === "dynamic" && dailyPnL < 0) {
                    modifier = 0.66; // Tighten stop by 33% on red days
                }

                const trailDist = atr * STRATEGY.stopLossATR * modifier;
                const newStop = position.highestPrice - trailDist;

                if (newStop > position.sl) {
                    position.sl = newStop;
                }
            }

            // B. Check Exits
            let exitPrice = null;
            if (lows[i] <= position.sl) exitPrice = position.sl;
            else if (highs[i] >= position.tp) exitPrice = position.tp;
            else if (rsi > STRATEGY.rsiSellThreshold) exitPrice = price; // RSI Exit

            if (exitPrice) {
                const revenue = exitPrice * position.qty;
                const profit = revenue - position.entry * position.qty;

                usdt = usdt + revenue - revenue * 0.001;
                dailyPnL += profit;

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
    process.stdout.write(`📥 ${symbol}: Fetching ${DAYS_HISTORY} days... `);
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

async function run() {
    console.log(`🛡️  RISK DAMPING TEST (${DAYS_HISTORY} Days)`);
    console.log(
        `ℹ️  Simulating: EMA Cross + ADX>${STRATEGY.adxThreshold} + RSI<${STRATEGY.rsiBuyThreshold}`
    );
    console.log(
        "----------------------------------------------------------------"
    );
    console.log("Symbol      | Standard PnL | Dynamic PnL  | Result");
    console.log(
        "----------------------------------------------------------------"
    );

    let stdTotal = 0;
    let dynTotal = 0;

    for (const sym of ASSETS_TO_TEST) {
        try {
            const data = await fetchHistory(sym);
            if (data.length < 200) {
                console.log(`⚠️  Skipping ${sym} (Low Data)`);
                continue;
            }

            const resStd = simulate(sym, data, "standard");
            const resDyn = simulate(sym, data, "dynamic");

            stdTotal += resStd.profit;
            dynTotal += resDyn.profit;

            const diff = resDyn.profit - resStd.profit;
            const sign = diff > 0 ? "+" : "";
            const color =
                diff > 0 ? "\x1b[32m" : diff < 0 ? "\x1b[31m" : "\x1b[0m";
            const reset = "\x1b[0m";

            console.log(
                `${sym.padEnd(12)}| ` +
                    `$${resStd.profit.toFixed(0).padEnd(11)}| ` +
                    `$${resDyn.profit.toFixed(0).padEnd(12)}| ` +
                    `${color}${sign}$${diff.toFixed(0)}${reset}`
            );
        } catch (e) {
            console.error(e.message);
        }
    }

    console.log(
        "----------------------------------------------------------------"
    );
    console.log(
        `TOTAL       | $${stdTotal.toFixed(0)}         | $${dynTotal.toFixed(
            0
        )}`
    );
    console.log(
        "----------------------------------------------------------------"
    );
}

run();
