// backend/backtest_lab/fetch_candles.js
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs"); // <--- Required

// --- CONFIGURATION ---
const DAYS_TO_FETCH = 120;
const TIMEFRAME = "15m";

// Define the Data Directory and DB Path explicitly
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "market_data.db");
const BATCH_DELAY_MS = 300;

// --- 0. ENSURE DIRECTORY EXISTS (The Fix) ---
if (!fs.existsSync(DATA_DIR)) {
    console.log(`📁 Creating missing data directory: ${DATA_DIR}`);
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PAIRS = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "AVAXUSDT",
    "DOGEUSDT",
    "DOTUSDT",
    "LINKUSDT",
    "MATICUSDT",
    "NEARUSDT",
    "LTCUSDT",
    "SHIBUSDT",
    "UNIUSDT",
];

const db = new sqlite3.Database(DB_PATH);

// --- 1. SETUP DB ---
db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");

    db.run(`
        CREATE TABLE IF NOT EXISTS raw_candles (
            symbol TEXT,
            timestamp INTEGER,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
            PRIMARY KEY (symbol, timestamp)
        )
    `);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(symbol, startTime, endTime) {
    try {
        const url = `https://api.binance.com/api/v3/klines`;
        const res = await axios.get(url, {
            params: {
                symbol,
                interval: TIMEFRAME,
                startTime,
                endTime,
                limit: 1000,
            },
            timeout: 10000,
        });
        return res.data;
    } catch (err) {
        if (err.response && err.response.status === 429) {
            console.warn(`⚠️ Rate limit hit. Sleeping 1 minute...`);
            await sleep(60000);
        } else {
            console.error(`❌ Error fetching ${symbol}: ${err.message}`);
        }
        return [];
    }
}

async function syncPair(symbol) {
    const endNow = Date.now();
    const startTarget = endNow - DAYS_TO_FETCH * 24 * 60 * 60 * 1000;
    let currentStartTime = startTarget;
    let totalImported = 0;

    console.log(`📥 [${symbol}] Downloading history...`);

    while (currentStartTime < endNow) {
        let candles = await fetchBatch(symbol, currentStartTime, endNow);

        if (!candles || candles.length === 0) break;

        // Transaction for speed + safety
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                const stmt = db.prepare(
                    `INSERT OR REPLACE INTO raw_candles VALUES (?, ?, ?, ?, ?, ?, ?)`
                );

                for (const c of candles) {
                    stmt.run(
                        symbol,
                        c[0],
                        parseFloat(c[1]),
                        parseFloat(c[2]),
                        parseFloat(c[3]),
                        parseFloat(c[4]),
                        parseFloat(c[5])
                    );
                }

                stmt.finalize();
                db.run("COMMIT", (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        totalImported += candles.length;
        const lastCandleTime = candles[candles.length - 1][0];
        currentStartTime = lastCandleTime + 1;

        candles = null;

        await sleep(BATCH_DELAY_MS);

        if (lastCandleTime >= endNow - 60000) break;
    }
    console.log(`✅ [${symbol}] Done. (${totalImported} candles)`);
}

(async () => {
    console.log(`🚀 STARTING DOWNLOAD (${DAYS_TO_FETCH} Days)`);
    for (const pair of PAIRS) {
        await syncPair(pair);
        global.gc && global.gc();
    }
    console.log("🏁 DOWNLOAD COMPLETE");
    db.close();
})();
