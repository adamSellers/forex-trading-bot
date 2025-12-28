// backend/backtest_lab/fetch_candles.js
const fs = require("fs");
const path = require("path");
const https = require("https");

// --- CONFIGURATION ---
const SYMBOLS = ["BTCUSDT", "BNBUSDT", "NEARUSDT", "XRPUSDT", "ETHUSDT"];
const INTERVAL = "15m";
const DAYS = 120; // Target: 30 Days of history
const OUTPUT_DIR = path.join(__dirname, "data", "candles");

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Helper: Make a single API call to Binance
 */
function fetchBatch(symbol, startTime) {
    return new Promise((resolve, reject) => {
        // limit=1000 is the Binance max. We ask for data starting at 'startTime'
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${INTERVAL}&limit=1000&startTime=${startTime}`;

        https
            .get(url, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.code && json.msg) {
                            reject(new Error(`Binance API Error: ${json.msg}`));
                            return;
                        }

                        // Map raw array to object
                        const candles = json.map((c) => ({
                            timestamp: c[0],
                            open: parseFloat(c[1]),
                            high: parseFloat(c[2]),
                            low: parseFloat(c[3]),
                            close: parseFloat(c[4]),
                            volume: parseFloat(c[5]),
                            time_readable: new Date(c[0]).toISOString(),
                        }));

                        resolve(candles);
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on("error", reject);
    });
}

/**
 * Main: Loop until we have all 30 days
 */
async function fetchCompleteHistory(symbol) {
    const allCandles = [];
    // Calculate start time: Current Time - 30 Days (in ms)
    let cursorTime = Date.now() - DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    console.log(
        `⬇️  ${symbol}: Starting download (Target: ~${DAYS * 96} candles)...`
    );
    process.stdout.write("   Progress: ");

    while (cursorTime < now) {
        try {
            const batch = await fetchBatch(symbol, cursorTime);

            if (batch.length === 0) break; // No more data available

            allCandles.push(...batch);
            process.stdout.write("█"); // Visual progress bar

            // Move the cursor to the end of this batch + 1ms to get the next candle
            const lastCandle = batch[batch.length - 1];
            cursorTime = lastCandle.timestamp + 1;

            // If we got fewer than 1000, we reached the most recent data
            if (batch.length < 1000) break;

            // Politeness delay
            await new Promise((r) => setTimeout(r, 100));
        } catch (err) {
            console.error(
                `\n❌ Error fetching batch for ${symbol}:`,
                err.message
            );
            break;
        }
    }

    // Save to disk
    const outFile = path.join(OUTPUT_DIR, `${symbol}_${INTERVAL}.json`);
    fs.writeFileSync(outFile, JSON.stringify(allCandles, null, 2));
    console.log(
        `\n✅ Saved ${allCandles.length} candles to ${path.basename(outFile)}\n`
    );
}

async function run() {
    console.log(`🧪 CANDLE LAB: Fetching ${DAYS} days of ${INTERVAL} data\n`);

    for (const symbol of SYMBOLS) {
        await fetchCompleteHistory(symbol);
    }

    console.log("🏁 Mission Complete. Raw candle data secured.");
}

run();
