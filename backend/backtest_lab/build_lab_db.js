// backend/backtest_lab/build_lab_db.js - V3 (DEBUG MODE)
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "market_data.db");
const RAW_DIR = path.join(__dirname, "data", "raw_signals");

// 1. Setup Database
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS market_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            symbol TEXT,
            price REAL,
            supertrend_direction INTEGER,
            supertrend_value REAL,
            atr REAL,
            rsi REAL,
            adx REAL,
            raw_json TEXT
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_time ON market_state(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_symbol ON market_state(symbol)`);
});

async function ingest() {
    console.log("🏗️  Building Market Database (V3 Debug Mode)...");

    const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith(".json"));
    console.log(`📂 Found ${files.length} files. Processing...`);

    db.run("BEGIN TRANSACTION");
    const stmt = db.prepare(`
        INSERT INTO market_state (timestamp, symbol, price, supertrend_direction, supertrend_value, atr, rsi, adx, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let imported = 0;
    let errors = 0;
    let skipped = 0;

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(RAW_DIR, file));
            const data = JSON.parse(raw);
            const items = Array.isArray(data) ? data : data.signals || [];

            // [FIX] Try/Catch is now INSIDE the loop.
            // If one row fails, we don't lose the whole file.
            for (const item of items) {
                try {
                    const sigObj = item.signal || {};
                    const sigData = sigObj.data || {};

                    // Flexible Mapping
                    const symbol = sigObj.symbol || item.symbol || "UNKNOWN";

                    // Handle various price formats
                    let price =
                        item.price || item.close || sigData.currentPrice || 0;
                    price = parseFloat(price);

                    const direction = parseInt(
                        sigData.stDirection || item.direction || 0
                    );
                    const stValue = parseFloat(item.superTrend || 0);
                    const atr = parseFloat(sigObj.atr || item.atr || 0);
                    const rsi = parseFloat(
                        sigData.rsi || item.rsi || sigObj.rsi || 0
                    );
                    const adx = parseFloat(
                        sigObj.strength || sigData.adx || item.adx || 0
                    );

                    // Skip invalid data but LOG it once to see why
                    if (symbol === "UNKNOWN" || price === 0) {
                        skipped++;
                        if (skipped < 5)
                            console.log(
                                `⚠️ Skipped Invalid Row: ${JSON.stringify(
                                    item
                                ).substring(0, 100)}...`
                            );
                        continue;
                    }

                    stmt.run(
                        new Date(item.timestamp || Date.now()).getTime(),
                        symbol,
                        price,
                        direction,
                        stValue,
                        atr,
                        rsi,
                        adx,
                        JSON.stringify(item)
                    );
                    imported++;
                } catch (rowErr) {
                    errors++;
                    if (errors < 5)
                        console.error(
                            `❌ Row Error in ${file}:`,
                            rowErr.message
                        );
                }
            }
        } catch (fileErr) {
            console.error(`❌ CRITICAL File Error (${file}):`, fileErr.message);
        }

        if (imported % 5000 === 0)
            process.stdout.write(`\r🚀 Rows Imported: ${imported}`);
    }

    stmt.finalize();
    db.run("END TRANSACTION", () => {
        console.log(`\n\n✅ DONE!`);
        console.log(`   - Imported: ${imported}`);
        console.log(`   - Skipped:  ${skipped}`);
        console.log(`   - Errors:   ${errors}`);
        db.close(() => process.exit(0));
    });
}

ingest();
