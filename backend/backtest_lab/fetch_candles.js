// backend/backtest_lab/fetch_candles.js
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

// --- CONFIGURATION ---
const DAYS_TO_FETCH = 120; // <--- UPDATED to 120 Days
const TIMEFRAME = "15m";
const DB_PATH = path.join(__dirname, "data/market_data.db");

// The "Universe" of assets to fetch
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

// --- SETUP DATABASE ---
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    // Create Raw Candles Table
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

// --- FETCH LOGIC ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(symbol, startTime, endTime) {
    try {
        const url = `https://api.binance.com/api/v3/klines`;
        const params = {
            symbol: symbol,
            interval: TIMEFRAME,
            startTime: startTime,
            endTime: endTime,
            limit: 1000, // Binance Max
        };
        const res = await axios.get(url, { params });
        return res.data;
    } catch (err) {
        console.error(`Error fetching ${symbol}: ${err.message}`);
        return [];
    }
}

async function syncPair(symbol) {
    const endNow = Date.now();
    const startTarget = endNow - DAYS_TO_FETCH * 24 * 60 * 60 * 1000;
    let currentStartTime = startTarget;

    console.log(`📥 [${symbol}] Fetching last ${DAYS_TO_FETCH} days...`);

    let totalImported = 0;

    // Pagination Loop (Binance limits to 1000 candles per call)
    while (currentStartTime < endNow) {
        const candles = await fetchBatch(symbol, currentStartTime, endNow);

        if (!candles || candles.length === 0) break;

        const stmt = db.prepare(
            `INSERT OR REPLACE INTO raw_candles VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        candles.forEach((c) => {
            stmt.run(
                symbol,
                c[0], // Open Time
                parseFloat(c[1]), // Open
                parseFloat(c[2]), // High
                parseFloat(c[3]), // Low
                parseFloat(c[4]), // Close
                parseFloat(c[5]) // Volume
            );
        });
        stmt.finalize();

        totalImported += candles.length;

        // Move time forward based on the last candle received
        const lastCandleTime = candles[candles.length - 1][0];
        currentStartTime = lastCandleTime + 1; // +1ms to avoid duplicate

        await sleep(100); // Rate limit protection

        // Break if we caught up to "now"
        if (lastCandleTime >= endNow - 60000) break;
    }

    console.log(`✅ [${symbol}] Saved ${totalImported} candles.`);
}

// --- MAIN EXECUTION ---
(async () => {
    console.log(`🚀 STARTING DOWNLOAD: ${DAYS_TO_FETCH} Days History`);

    for (const pair of PAIRS) {
        await syncPair(pair);
    }

    console.log("🏁 DOWNLOAD COMPLETE");
    db.close();
})();
