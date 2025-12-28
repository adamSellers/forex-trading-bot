// backend/backtest_lab/build_15m_dataset.js - PATCHED SUPER TREND
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");
const TI = require("technicalindicators");

// --- CONFIGURATION ---
const INPUT_DIR = path.join(__dirname, "data", "candles");
const DB_PATH = path.join(__dirname, "data", "market_data.db");

const RSI_PERIOD = 14;
const ADX_PERIOD = 14;
const ATR_PERIOD = 10;
const ST_MULTIPLIER = 3;

// 1. Initialize Database
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`DROP TABLE IF EXISTS market_state_15m`);
    db.run(`
        CREATE TABLE market_state_15m (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            symbol TEXT,
            price REAL,
            supertrend_direction INTEGER,
            supertrend_value REAL,
            atr REAL,
            rsi REAL,
            adx REAL
        )
    `);
    db.run(
        `CREATE INDEX IF NOT EXISTS idx_time_15m ON market_state_15m(timestamp)`
    );
    db.run(
        `CREATE INDEX IF NOT EXISTS idx_symbol_15m ON market_state_15m(symbol)`
    );
});

// --- HELPER: Corrected SuperTrend Logic ---
function calculateSuperTrend(candles, period, multiplier) {
    const input = {
        high: candles.map((c) => c.high),
        low: candles.map((c) => c.low),
        close: candles.map((c) => c.close),
        period: period,
    };
    const atr = TI.ATR.calculate(input);

    // Arrays to hold calculated values
    // Align ATR: TI.ATR returns array shorter by (period).
    // We offset indices by 'period' to match candles.

    let superTrend = new Array(candles.length).fill(null);
    let directions = new Array(candles.length).fill(null); // 1 = Green, -1 = Red

    let finalUpperBand = new Array(candles.length).fill(0);
    let finalLowerBand = new Array(candles.length).fill(0);

    for (let i = 0; i < candles.length; i++) {
        // Skip until we have a valid ATR value
        // atr[0] corresponds to candle[period]
        let atrIndex = i - period;
        if (atrIndex < 0) continue;

        const currentAtr = atr[atrIndex];
        const h = candles[i].high;
        const l = candles[i].low;
        const c = candles[i].close;
        const prevClose = candles[i - 1].close;

        // 1. Basic Bands
        const basicUpper = (h + l) / 2 + multiplier * currentAtr;
        const basicLower = (h + l) / 2 - multiplier * currentAtr;

        // 2. Recursive Final Bands (The Logic Fix)
        // If it's the very first calculated bar, initialize strictly
        if (i === period) {
            finalUpperBand[i] = basicUpper;
            finalLowerBand[i] = basicLower;
            directions[i] = 1; // Default start
            superTrend[i] = basicLower;
            continue;
        }

        const prevFinalUpper = finalUpperBand[i - 1];
        const prevFinalLower = finalLowerBand[i - 1];

        // Final Upper: Keep previous if price didn't break it
        if (basicUpper < prevFinalUpper || prevClose > prevFinalUpper) {
            finalUpperBand[i] = basicUpper;
        } else {
            finalUpperBand[i] = prevFinalUpper;
        }

        // Final Lower: Keep previous if price didn't break it
        if (basicLower > prevFinalLower || prevClose < prevFinalLower) {
            finalLowerBand[i] = basicLower;
        } else {
            finalLowerBand[i] = prevFinalLower;
        }

        // 3. Direction Flip
        let prevDir = directions[i - 1];
        let currDir = prevDir;

        // If currently Green (1), and price closes below Lower Band -> Flip Red (-1)
        if (prevDir === 1 && c < finalLowerBand[i]) {
            currDir = -1;
        }
        // If currently Red (-1), and price closes above Upper Band -> Flip Green (1)
        else if (prevDir === -1 && c > finalUpperBand[i]) {
            currDir = 1;
        }

        directions[i] = currDir;
        superTrend[i] = currDir === 1 ? finalLowerBand[i] : finalUpperBand[i];
    }

    // Align ATR for return
    // We map the ATR array back to full length with nulls at start
    const fullAtr = new Array(period).fill(null).concat(atr);

    return { superTrend, directions, atr: fullAtr };
}

async function processFiles() {
    console.log("⚙️  Processing 15m Candle Data (Patched SuperTrend)...");

    if (!fs.existsSync(INPUT_DIR)) {
        console.error(`❌ Error: Candle directory not found: ${INPUT_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith(".json"));

    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare(`
        INSERT INTO market_state_15m (timestamp, symbol, price, supertrend_direction, supertrend_value, atr, rsi, adx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalRows = 0;

    for (const file of files) {
        const symbol = file.split("_")[0];
        console.log(`📊 Processing ${symbol}...`);

        const rawData = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, file)));

        // Calculate Indicators
        const rsiInput = {
            values: rawData.map((c) => c.close),
            period: RSI_PERIOD,
        };
        const rsiValues = TI.RSI.calculate(rsiInput);

        const adxInput = {
            high: rawData.map((c) => c.high),
            low: rawData.map((c) => c.low),
            close: rawData.map((c) => c.close),
            period: ADX_PERIOD,
        };
        const adxValues = TI.ADX.calculate(adxInput);

        const stResult = calculateSuperTrend(
            rawData,
            ATR_PERIOD,
            ST_MULTIPLIER
        );

        let fileRows = 0;

        // Alignment Logic
        const rsiOffset = rawData.length - rsiValues.length;
        const adxOffset = rawData.length - adxValues.length;

        for (let i = 0; i < rawData.length; i++) {
            const rsi = i >= rsiOffset ? rsiValues[i - rsiOffset] : null;
            const adxObj = i >= adxOffset ? adxValues[i - adxOffset] : null;
            const adx = adxObj ? adxObj.adx : null;

            const stDir = stResult.directions[i];
            const stVal = stResult.superTrend[i];
            const atrVal = stResult.atr[i];

            // Strict Filter
            if (rsi != null && adx != null && stDir != null) {
                stmt.run(
                    rawData[i].timestamp,
                    symbol,
                    rawData[i].close,
                    stDir,
                    stVal,
                    atrVal || 0,
                    rsi,
                    adx
                );
                fileRows++;
                totalRows++;
            }
        }
        console.log(`   -> Added ${fileRows} valid signals.`);
    }

    stmt.finalize();
    db.run("END TRANSACTION", () => {
        console.log(
            `\n✅ Database Rebuilt! Total Valid 15m Signals: ${totalRows}`
        );
        db.close();
    });
}

processFiles();
