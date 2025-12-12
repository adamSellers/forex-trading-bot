// backend/scripts/optimize-strategy.js
// Standalone Backtester - No API Keys required (Public Data Only)

const Binance = require("node-binance-api");

// --- CONFIGURATION ---
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"];
const TIMEFRAME = "1h";
const DAYS_OF_HISTORY = 120; // Look back 45 days

// GRID SEARCH RANGES (The "What If" Scenarios)
const PARAM_GRID = {
    adxThreshold: [20, 25, 30], // Trend Strength
    rsiBuyThreshold: [30, 35, 40], // Oversold level
    rsiSellThreshold: [70, 75, 80], // Overbought level
    stopLossATR: [1.5, 2.0, 3.0], // Risk tolerance
    takeProfitATR: [2.0, 3.0, 4.0], // Greed level
};

// Initialize without keys (Public data only)
const binance = new Binance().options({
    family: 4,
    log: () => {}, // Silence default logs
});

// --- INDICATOR MATH (Embedded for standalone usage) ---
function calculateSMA(data, period) {
    if (data.length < period) return [];
    return data.map((_, idx, arr) => {
        if (idx < period - 1) return null;
        const slice = arr.slice(idx - period + 1, idx + 1);
        return slice.reduce((a, b) => a + b, 0) / period;
    });
}

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

    const rsiArray = new Array(period).fill(null); // Pad start
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
    // First ATR is SMA of TR
    let atr = [tr.slice(0, period).reduce((a, b) => a + b, 0) / period];
    // Subsequent are smoothed
    for (let i = period; i < tr.length; i++) {
        atr.push((atr[i - period] * (period - 1) + tr[i]) / period);
    }
    // Pad output to match input length roughly (simplified)
    return new Array(period - 1).fill(null).concat(atr);
}

function calculateADX(highs, lows, closes, period = 14) {
    // Standard ADX implementation
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

    // Smooth
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
            // Wait for enough DX
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
    // Pad to match input array length
    return new Array(period * 2).fill(null).concat(adx);
}

// --- ENGINE LOGIC ---

async function fetchHistory(symbol) {
    process.stdout.write(`📥 ${symbol}: Fetching history... `);
    const limit = 1000;
    let allCandles = [];
    let endTime = Date.now();

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
        allCandles = [...candles, ...allCandles]; // Prepend
        endTime = candles[0].time - 1;
        await new Promise((r) => setTimeout(r, 100)); // Be nice to API
    }

    // Sort and Remove duplicates
    allCandles.sort((a, b) => a.time - b.time);
    const unique = allCandles.filter(
        (v, i, a) => a.findIndex((t) => t.time === v.time) === i
    );

    console.log(`✅ Loaded ${unique.length} candles`);
    return unique;
}

function simulateTrade(candles, params) {
    let usdt = 1000; // Starting Cash
    let position = null;
    let trades = 0;
    let wins = 0;

    // 1. Pre-calc indicators for speed
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const rsiArr = calculateRSI(closes, 14);
    const adxArr = calculateADX(highs, lows, closes, 14);
    const atrArr = calculateATR(highs, lows, closes, 14);

    // 2. Walk through history
    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const rsi = rsiArr[i];
        const adx = adxArr[i];
        const atr = atrArr[i];
        const high = highs[i];
        const low = lows[i];

        if (!rsi || !adx || !atr) continue;

        if (!position) {
            // BUY SIGNAL
            if (adx > params.adxThreshold && rsi < params.rsiBuyThreshold) {
                // Risk Calculation: Risk 2% of current account per trade
                const stopPrice = price - atr * params.stopLossATR;
                const riskPerShare = price - stopPrice;

                if (riskPerShare <= 0) continue;

                // Position Size = (Account * Risk%) / (Entry - Stop)
                let qty = (usdt * 0.02) / riskPerShare;

                // Cap max allocation at 95% of current cash
                const maxQty = (usdt * 0.95) / price;
                qty = Math.min(qty, maxQty);

                if (qty * price < 10) continue; // Min order size check

                const cost = qty * price;
                usdt -= cost; // Pay for asset
                usdt -= cost * 0.001; // Pay fee

                position = {
                    entry: price,
                    qty,
                    sl: stopPrice,
                    tp: price + atr * params.takeProfitATR,
                };
            }
        } else {
            // SELL CHECKS
            let exitPrice = null;

            if (low <= position.sl) exitPrice = position.sl; // Stop Loss
            else if (high >= position.tp)
                exitPrice = position.tp; // Take Profit
            else if (rsi > params.rsiSellThreshold) exitPrice = price; // RSI Exit

            if (exitPrice) {
                const revenue = exitPrice * position.qty;
                usdt += revenue; // Get cash back
                usdt -= revenue * 0.001; // Pay fee

                if (exitPrice > position.entry) wins++;
                trades++;
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
    console.log("🚀 Starting Strategy Optimization (Local Mode)");

    // Fetch Data
    const marketData = {};
    for (const sym of SYMBOLS) {
        marketData[sym] = await fetchHistory(sym);
    }

    // Run Grid
    let best = { score: -Infinity, params: null };
    let iterations = 0;

    const totalCombos =
        PARAM_GRID.adxThreshold.length *
        PARAM_GRID.rsiBuyThreshold.length *
        PARAM_GRID.rsiSellThreshold.length *
        PARAM_GRID.stopLossATR.length *
        PARAM_GRID.takeProfitATR.length;

    console.log(`\n🔄 Testing ${totalCombos} strategy combinations...`);

    const start = Date.now();

    for (const adx of PARAM_GRID.adxThreshold) {
        for (const rsiBuy of PARAM_GRID.rsiBuyThreshold) {
            for (const rsiSell of PARAM_GRID.rsiSellThreshold) {
                for (const sl of PARAM_GRID.stopLossATR) {
                    for (const tp of PARAM_GRID.takeProfitATR) {
                        const params = {
                            adxThreshold: adx,
                            rsiBuyThreshold: rsiBuy,
                            rsiSellThreshold: rsiSell,
                            stopLossATR: sl,
                            takeProfitATR: tp,
                        };

                        let totalProfit = 0;
                        let totalTrades = 0;

                        for (const sym of SYMBOLS) {
                            const res = simulateTrade(marketData[sym], params);
                            totalProfit += res.profit;
                            totalTrades += res.trades;
                        }

                        // Scoring Function: Profit is good, but need activity (>10 trades total)
                        let score = totalProfit;
                        if (totalTrades < 10) score = -1000;

                        if (score > best.score) {
                            best = {
                                score,
                                params,
                                profit: totalProfit,
                                trades: totalTrades,
                            };
                            process.stdout.write(
                                `\r🌟 BEST: +$${totalProfit.toFixed(
                                    2
                                )} | ADX>${adx} RSI<${rsiBuy} | Trades: ${totalTrades}      `
                            );
                        }

                        iterations++;
                        if (iterations % 50 === 0) {
                            const pct = Math.round(
                                (iterations / totalCombos) * 100
                            );
                            process.stdout.write(`\r⏳ ${pct}% Done... `);
                        }
                    }
                }
            }
        }
    }

    console.log("\n\n🏆 OPTIMIZATION RESULTS 🏆");
    console.log("---------------------------");
    console.log(
        `Total Simulated Profit: $${best.profit.toFixed(2)} (on $1000 starting)`
    );
    console.log(`Total Trades: ${best.trades}`);
    console.log("Recommended Settings:");
    console.log(JSON.stringify(best.params, null, 2));
    console.log(`Time taken: ${(Date.now() - start) / 1000}s`);
}

run();
