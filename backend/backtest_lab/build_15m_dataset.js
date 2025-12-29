// backend/backtest_lab/build_15m_dataset.js
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
    // FIXED: Added open, high, low, close, volume columns
    db.run(`
        CREATE TABLE market_state_15m (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            symbol TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
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

    let superTrend = new Array(candles.length).fill(null);
    let directions = new Array(candles.length).fill(null); // 1 = Green, -1 = Red
    let finalUpperBand = new Array(candles.length).fill(0);
    let finalLowerBand = new Array(candles.length).fill(0);

    for (let i = 0; i < candles.length; i++) {
        let atrIndex = i - period;
        if (atrIndex < 0) continue;

        const currentAtr = atr[atrIndex];
        const h = candles[i].high;
        const l = candles[i].low;
        const c = candles[i].close;
        const prevClose = candles[i - 1].close;

        const basicUpper = (h + l) / 2 + multiplier * currentAtr;
        const basicLower = (h + l) / 2 - multiplier * currentAtr;

        if (i === period) {
            finalUpperBand[i] = basicUpper;
            finalLowerBand[i] = basicLower;
            directions[i] = 1;
            superTrend[i] = basicLower;
            continue;
        }

        const prevFinalUpper = finalUpperBand[i - 1];
        const prevFinalLower = finalLowerBand[i - 1];

        if (basicUpper < prevFinalUpper || prevClose > prevFinalUpper) {
            finalUpperBand[i] = basicUpper;
        } else {
            finalUpperBand[i] = prevFinalUpper;
        }

        if (basicLower > prevFinalLower || prevClose < prevFinalLower) {
            finalLowerBand[i] = basicLower;
        } else {
            finalLowerBand[i] = prevFinalLower;
        }

        let prevDir = directions[i - 1];
        let currDir = prevDir;

        if (prevDir === 1 && c < finalLowerBand[i]) {
            currDir = -1;
        } else if (prevDir === -1 && c > finalUpperBand[i]) {
            currDir = 1;
        }

        directions[i] = currDir;
        superTrend[i] = currDir === 1 ? finalLowerBand[i] : finalUpperBand[i];
    }

    const fullAtr = new Array(period).fill(null).concat(atr);
    return { superTrend, directions, atr: fullAtr };
}

async function processFiles() {
    console.log("⚙️  Processing 15m Candle Data (Full OHLC)...");

    if (!fs.existsSync(INPUT_DIR)) {
        console.error(`❌ Error: Candle directory not found: ${INPUT_DIR}`);
        process.exit(1);
    }

    const files = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith(".json"));

    db.run("BEGIN TRANSACTION");
    // FIXED: Query matches new schema
    const stmt = db.prepare(`
        INSERT INTO market_state_15m (timestamp, symbol, open, high, low, close, volume, supertrend_direction, supertrend_value, atr, rsi, adx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalRows = 0;

    for (const file of files) {
        const symbol = file.split("_")[0];
        console.log(`📊 Processing ${symbol}...`);

        const rawData = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, file)));

        // Indicators
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
        const rsiOffset = rawData.length - rsiValues.length;
        const adxOffset = rawData.length - adxValues.length;

        for (let i = 0; i < rawData.length; i++) {
            const rsi = i >= rsiOffset ? rsiValues[i - rsiOffset] : null;
            const adxObj = i >= adxOffset ? adxValues[i - adxOffset] : null;
            const adx = adxObj ? adxObj.adx : null;

            const stDir = stResult.directions[i];
            const stVal = stResult.superTrend[i];
            const atrVal = stResult.atr[i];

            if (rsi != null && adx != null && stDir != null) {
                // FIXED: Insert full OHLC data
                stmt.run(
                    rawData[i].timestamp,
                    symbol,
                    rawData[i].open,
                    rawData[i].high,
                    rawData[i].low,
                    rawData[i].close,
                    rawData[i].volume,
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
