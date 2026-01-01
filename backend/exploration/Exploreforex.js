// exploreForex.js - Test Oanda connection and analyze Forex data
// Run with: node exploreForex.js

const OandaClient = require("./oandaClient");

// ============== CONFIGURATION ==============
// Replace these with your actual credentials
const API_KEY = "YOUR_API_KEY_HERE";
const ACCOUNT_ID = "001-011-20128302-001";
const IS_LIVE = true;

// Instruments to analyze
const INSTRUMENTS = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"];

// ============== TECHNICAL INDICATORS ==============
// (Copied from your existing technicalIndicators.js logic)

function calculateSuperTrend(candles, period = 10, multiplier = 3) {
    if (candles.length < period + 1) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    // Calculate ATR
    let tr = [highs[0] - lows[0]];
    let atr = [tr[0]];

    for (let i = 1; i < closes.length; i++) {
        let hl = highs[i] - lows[i];
        let hc = Math.abs(highs[i] - closes[i - 1]);
        let lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));
        atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
    }

    // Calculate SuperTrend
    let upperBand = [],
        lowerBand = [],
        superTrend = [],
        direction = [];
    let basicUpper = (highs[0] + lows[0]) / 2 + multiplier * atr[0];
    let basicLower = (highs[0] + lows[0]) / 2 - multiplier * atr[0];

    upperBand.push(basicUpper);
    lowerBand.push(basicLower);
    superTrend.push(basicUpper);
    direction.push(1);

    for (let i = 1; i < closes.length; i++) {
        let currBasicUpper = (highs[i] + lows[i]) / 2 + multiplier * atr[i];
        let currBasicLower = (highs[i] + lows[i]) / 2 - multiplier * atr[i];

        let prevFinalUpper = upperBand[i - 1];
        let prevFinalLower = lowerBand[i - 1];
        let prevClose = closes[i - 1];

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

        let prevDir = direction[i - 1];
        let currentDir = prevDir;

        if (prevDir === 1 && closes[i] < lowerBand[i - 1]) currentDir = -1;
        else if (prevDir === -1 && closes[i] > upperBand[i - 1]) currentDir = 1;

        direction.push(currentDir);
        superTrend.push(currentDir === 1 ? finalLower : finalUpper);
    }

    const idx = closes.length - 1;
    return {
        direction: direction[idx], // 1 = bullish (green), -1 = bearish (red)
        prevDirection: direction[idx - 1],
        value: superTrend[idx],
        atr: atr[idx],
        flipped: direction[idx] !== direction[idx - 1],
    };
}

function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;

    let gains = 0,
        losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

function calculateADX(candles, period = 14) {
    if (candles.length < period * 2) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    let trList = [],
        plusDM = [],
        minusDM = [];

    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trList.push(tr);

        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];

        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Smoothed averages
    let smoothTR = trList.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

    let dxList = [];

    for (let i = period; i < trList.length; i++) {
        smoothTR = smoothTR - smoothTR / period + trList[i];
        smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
        smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];

        const plusDI = (smoothPlusDM / smoothTR) * 100;
        const minusDI = (smoothMinusDM / smoothTR) * 100;
        const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

        if (!isNaN(dx)) dxList.push(dx);
    }

    if (dxList.length < period) return null;

    // ADX is smoothed DX
    let adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxList.length; i++) {
        adx = (adx * (period - 1) + dxList[i]) / period;
    }

    return adx;
}

// ============== ANALYSIS FUNCTIONS ==============

function analyzeInstrument(instrument, candles, client) {
    const closes = candles.map((c) => c.close);

    const supertrend = calculateSuperTrend(candles, 10, 3);
    const rsi = calculateRSI(closes, 14);
    const adx = calculateADX(candles, 14);

    const currentPrice = closes[closes.length - 1];
    const atrPips = client.priceToPips(instrument, supertrend?.atr || 0);

    // Determine signal based on your strategy
    let signal = "HOLD";
    let reason = "";

    if (supertrend && rsi && adx) {
        const adxOk = adx >= 25;
        const rsiOk = rsi < 75;
        const isBullish = supertrend.direction === 1;
        const justFlipped = supertrend.flipped;

        if (justFlipped && isBullish && adxOk && rsiOk) {
            signal = "BUY";
            reason = "SuperTrend flipped GREEN";
        } else if (justFlipped && !isBullish) {
            signal = "SELL";
            reason = "SuperTrend flipped RED";
        } else if (!adxOk) {
            reason = `ADX too weak (${adx.toFixed(1)} < 25)`;
        } else if (isBullish) {
            reason = "In uptrend, waiting for entry";
        } else {
            reason = "In downtrend, no position";
        }
    }

    return {
        instrument,
        currentPrice,
        supertrend: supertrend
            ? {
                  direction: supertrend.direction === 1 ? "🟢 BULL" : "🔴 BEAR",
                  flipped: supertrend.flipped,
                  atr: supertrend.atr,
                  atrPips: atrPips.toFixed(1),
              }
            : null,
        rsi: rsi?.toFixed(1),
        adx: adx?.toFixed(1),
        signal,
        reason,
        candleCount: candles.length,
    };
}

// ============== MAIN EXECUTION ==============

async function main() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("   🌍 FOREX EXPLORATION - Oanda API Test");
    console.log(
        "═══════════════════════════════════════════════════════════\n"
    );

    // Validate API key is set
    if (API_KEY === "YOUR_API_KEY_HERE") {
        console.error(
            "❌ Please edit this file and replace YOUR_API_KEY_HERE with your actual API key"
        );
        process.exit(1);
    }

    const client = new OandaClient(API_KEY, ACCOUNT_ID, IS_LIVE);

    try {
        // 1. Test Account Connection
        console.log("📡 Testing API Connection...\n");
        const account = await client.getAccountSummary();

        console.log("✅ ACCOUNT CONNECTED");
        console.log("┌─────────────────────────────────────────┐");
        console.log(`│ Account ID:     ${account.id}`);
        console.log(`│ Currency:       ${account.currency}`);
        console.log(
            `│ Balance:        $${parseFloat(account.balance).toFixed(2)}`
        );
        console.log(`│ NAV:            $${parseFloat(account.NAV).toFixed(2)}`);
        console.log(
            `│ Margin Used:    $${parseFloat(account.marginUsed).toFixed(2)}`
        );
        console.log(
            `│ Margin Avail:   $${parseFloat(account.marginAvailable).toFixed(
                2
            )}`
        );
        console.log(`│ Open Trades:    ${account.openTradeCount}`);
        console.log(
            `│ Unrealized P&L: $${parseFloat(account.unrealizedPL).toFixed(2)}`
        );
        console.log("└─────────────────────────────────────────┘\n");

        // 2. Fetch Current Prices
        console.log("💰 CURRENT PRICES");
        console.log("─────────────────────────────────────────");

        for (const instrument of INSTRUMENTS) {
            try {
                const price = await client.getCurrentPrice(instrument);
                if (price) {
                    const spreadPips = client.priceToPips(
                        instrument,
                        price.spread
                    );
                    console.log(
                        `${instrument}: Bid ${price.bid.toFixed(
                            5
                        )} | Ask ${price.ask.toFixed(
                            5
                        )} | Spread: ${spreadPips.toFixed(1)} pips`
                    );
                }
            } catch (e) {
                console.log(`${instrument}: ❌ ${e.message}`);
            }
        }

        // 3. Fetch and Analyze 15M Candles
        console.log("\n📊 15-MINUTE CANDLE ANALYSIS (SuperTrend + ADX + RSI)");
        console.log(
            "═══════════════════════════════════════════════════════════\n"
        );

        for (const instrument of INSTRUMENTS) {
            try {
                console.log(`\n🔍 ${instrument}`);
                console.log("─────────────────────────────────────────");

                const candles = await client.getCandles(instrument, "M15", 500);
                const analysis = analyzeInstrument(instrument, candles, client);

                console.log(
                    `   Price:      ${analysis.currentPrice.toFixed(5)}`
                );
                console.log(`   Candles:    ${analysis.candleCount} (15m)`);

                if (analysis.supertrend) {
                    console.log(
                        `   SuperTrend: ${analysis.supertrend.direction}${
                            analysis.supertrend.flipped
                                ? " (JUST FLIPPED!)"
                                : ""
                        }`
                    );
                    console.log(
                        `   ATR:        ${analysis.supertrend.atr.toFixed(
                            5
                        )} (${analysis.supertrend.atrPips} pips)`
                    );
                }

                console.log(`   RSI:        ${analysis.rsi}`);
                console.log(`   ADX:        ${analysis.adx}`);
                console.log(
                    `   ➤ Signal:   ${analysis.signal} - ${analysis.reason}`
                );
            } catch (e) {
                console.log(`   ❌ Error: ${e.message}`);
            }
        }

        // 4. Compare ADX Distribution (Forex vs Crypto insight)
        console.log("\n\n📈 ADX DISTRIBUTION ANALYSIS");
        console.log(
            "═══════════════════════════════════════════════════════════"
        );
        console.log("(How often is ADX >= 25 for each instrument?)\n");

        for (const instrument of INSTRUMENTS) {
            try {
                const candles = await client.getCandles(instrument, "M15", 500);

                let adxAbove25 = 0;
                let adxAbove20 = 0;
                let totalSamples = 0;

                // Calculate ADX at multiple points
                for (let i = 100; i < candles.length; i += 10) {
                    const slice = candles.slice(0, i);
                    const adx = calculateADX(slice, 14);
                    if (adx) {
                        totalSamples++;
                        if (adx >= 25) adxAbove25++;
                        if (adx >= 20) adxAbove20++;
                    }
                }

                const pct25 = ((adxAbove25 / totalSamples) * 100).toFixed(1);
                const pct20 = ((adxAbove20 / totalSamples) * 100).toFixed(1);

                console.log(
                    `${instrument}: ADX >= 25: ${pct25}% | ADX >= 20: ${pct20}% of samples`
                );
            } catch (e) {
                console.log(`${instrument}: ❌ ${e.message}`);
            }
        }

        console.log("\n\n✅ Exploration complete!");
        console.log("\n💡 NEXT STEPS:");
        console.log("   1. Deposit funds to your Oanda account");
        console.log(
            "   2. Review ADX distribution - you may want to lower threshold to 20 for Forex"
        );
        console.log(
            "   3. Run historical backtest to compare Forex vs Crypto performance"
        );
    } catch (error) {
        console.error("❌ Error:", error.message);
        if (error.message.includes("Invalid")) {
            console.error(
                "\n💡 Check that your API key and Account ID are correct"
            );
        }
    }
}

main();
