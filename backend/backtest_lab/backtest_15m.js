// backend/backtest_lab/backtest_15m.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// --- STRATEGY CONFIG (15m Intraday) ---
const STRATEGY = {
    min_adx: 25,
    max_rsi: 70,
    stop_loss_pct: 0.02,
    take_profit_pct: 0.06,
    trailing_stop_pct: 0.0,
    initial_balance: 1000,
    trade_size_pct: 0.95,
};

// --- ASSET FILTER ---
const IGNORED_ASSETS = ["BTCUSDT", "ETHUSDT"]; // Add any others here if needed

const DB_PATH = path.join(__dirname, "data", "market_data.db");
const db = new sqlite3.Database(DB_PATH);

async function runBacktest() {
    console.log("🧪 Starting 15m Intraday Simulation...");
    console.log(`🚫 Ignoring: ${IGNORED_ASSETS.join(", ")}`);
    console.log(
        `⚙️  Config: ADX>${STRATEGY.min_adx} | RSI<${STRATEGY.max_rsi} | SL:${
            STRATEGY.stop_loss_pct * 100
        }%`
    );

    // 1. Fetch Data from the NEW 15m TABLE
    const rows = await new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM market_state_15m ORDER BY timestamp ASC",
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });

    // 2. Group by Symbol (With Filtering)
    const marketData = {};
    rows.forEach((row) => {
        // --- FILTER LOGIC ---
        if (IGNORED_ASSETS.includes(row.symbol)) return;

        if (!marketData[row.symbol]) marketData[row.symbol] = [];
        marketData[row.symbol].push(row);
    });

    const symbols = Object.keys(marketData);

    if (symbols.length === 0) {
        console.error(
            "❌ No assets found after filtering! Check your DB data."
        );
        return;
    }

    console.log(
        `📊 Loaded ${rows.length} candles. Testing on ${
            symbols.length
        } assets: ${symbols.join(", ")}`
    );

    // 3. Run Logic
    let balance = STRATEGY.initial_balance;
    let positions = {};
    let tradeHistory = [];
    const previousStates = {};

    for (const candle of rows) {
        const sym = candle.symbol;

        // --- FILTER LOGIC (Double check to skip processing loop) ---
        if (IGNORED_ASSETS.includes(sym)) continue;

        const prevCandle = previousStates[sym];
        previousStates[sym] = candle;
        if (!prevCandle) continue;

        // --- MANAGE POSITION ---
        if (positions[sym]) {
            const pos = positions[sym];

            // Stop Loss
            if (candle.price <= pos.stopLoss) {
                closeTrade(sym, candle, "STOP_LOSS");
                continue;
            }

            // Trend Reversal
            if (candle.supertrend_direction === -1) {
                closeTrade(sym, candle, "TREND_FLIP");
                continue;
            }
        }

        // --- ENTRY ---
        if (!positions[sym]) {
            const trendFlippedGreen =
                prevCandle.supertrend_direction === -1 &&
                candle.supertrend_direction === 1;

            if (trendFlippedGreen) {
                const isAdxStrong = candle.adx >= STRATEGY.min_adx;
                const isRsiSafe = candle.rsi <= STRATEGY.max_rsi;

                if (isAdxStrong && isRsiSafe) {
                    openTrade(sym, candle);
                }
            }
        }
    }

    // Helpers
    function openTrade(symbol, candle) {
        const amount = balance * STRATEGY.trade_size_pct;
        if (amount < 10) return;

        const qty = amount / candle.price;

        positions[symbol] = {
            symbol: symbol,
            entryPrice: candle.price,
            quantity: qty,
            stopLoss: candle.price * (1 - STRATEGY.stop_loss_pct),
        };

        balance -= amount;
        balance -= amount * 0.001; // Fee
    }

    function closeTrade(symbol, candle, reason) {
        const pos = positions[symbol];
        const exitValue = pos.quantity * candle.price;
        const fee = exitValue * 0.001;
        const netReturn = exitValue - fee;
        const pnlPct = (netReturn / (pos.entryPrice * pos.quantity) - 1) * 100;

        balance += netReturn;

        tradeHistory.push({
            symbol: symbol,
            type: "SELL",
            reason: reason,
            entry: pos.entryPrice.toFixed(4),
            exit: candle.price.toFixed(4),
            pnl: pnlPct.toFixed(2) + "%",
            bal: balance.toFixed(2),
            time: new Date(candle.timestamp)
                .toISOString()
                .replace("T", " ")
                .substring(5, 16),
        });

        delete positions[symbol];
    }

    console.log("\n🏁 15m Simulation Complete.");
    console.log("------------------------------------------------");
    console.log(`Initial Balance: $${STRATEGY.initial_balance}`);
    console.log(`Final Balance:   $${balance.toFixed(2)}`);
    console.log(
        `Net Profit:      $${(balance - STRATEGY.initial_balance).toFixed(
            2
        )} (${((balance / STRATEGY.initial_balance - 1) * 100).toFixed(2)}%)`
    );
    console.log(`Total Trades:    ${tradeHistory.length}`);
    console.log("------------------------------------------------");
    if (tradeHistory.length > 0) console.table(tradeHistory);
}

runBacktest();
