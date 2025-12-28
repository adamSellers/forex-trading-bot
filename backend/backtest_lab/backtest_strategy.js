// backend/backtest_lab/backtest_strategy.js - FIXED: Group by Symbol
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const STRATEGY = {
    min_adx: 30, // Testing your "Loss" settings
    max_rsi: 65,
    stop_loss_pct: 0.02,
    take_profit_pct: 0.06,
    trailing_stop_pct: 0.03,
    initial_balance: 1000,
    trade_size_pct: 0.95,
};

const DB_PATH = path.join(__dirname, "data", "market_data.db");
const db = new sqlite3.Database(DB_PATH);

async function runBacktest() {
    console.log("🧪 Starting Simulation (Grouped by Symbol)...");
    console.log(
        `⚙️  Config: ADX>${STRATEGY.min_adx} | RSI<${STRATEGY.max_rsi} | SL:${
            STRATEGY.stop_loss_pct * 100
        }%`
    );

    // 1. Fetch All Data
    const rows = await new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM market_state ORDER BY timestamp ASC",
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });

    // 2. Group Data by Symbol (CRITICAL FIX)
    const marketData = {};
    rows.forEach((row) => {
        if (!marketData[row.symbol]) marketData[row.symbol] = [];
        marketData[row.symbol].push(row);
    });

    const symbols = Object.keys(marketData);
    console.log(
        `📊 Loaded ${rows.length} snapshots across ${symbols.length} assets.`
    );

    // 3. Simulation State
    let balance = STRATEGY.initial_balance;
    let positions = {}; // map: symbol -> position object
    let tradeHistory = [];

    // We simulate time passing globally to manage shared balance
    // But for simplicity in this V1, let's just iterate each symbol's timeline
    // Note: This assumes infinite capital for simultaneous trades,
    // but we check 'balance' to constrain it.

    // BETTER APPROACH: Re-sort everything by time, but keep "Previous State" in a map
    const previousStates = {};

    for (const candle of rows) {
        const sym = candle.symbol;
        const prevCandle = previousStates[sym]; // Get valid previous candle for THIS symbol

        // Update State & Continue
        previousStates[sym] = candle;
        if (!prevCandle) continue; // Need at least 2 candles to detect a flip

        // --- MANAGE EXISTING POSITION ---
        if (positions[sym]) {
            const pos = positions[sym];

            // 1. Stop Loss
            if (candle.price <= pos.stopLoss) {
                closeTrade(sym, candle, "STOP_LOSS");
                continue;
            }

            // 2. Trailing Stop
            if (STRATEGY.trailing_stop_pct > 0) {
                const newStop = candle.price * (1 - STRATEGY.trailing_stop_pct);
                if (newStop > pos.trailingStop) {
                    pos.trailingStop = newStop;
                }
                if (candle.price <= pos.trailingStop) {
                    closeTrade(sym, candle, "TRAILING_STOP");
                    continue;
                }
            }

            // 3. Trend Reversal (SuperTrend Flip RED)
            if (candle.supertrend_direction === -1) {
                closeTrade(sym, candle, "TREND_FLIP");
                continue;
            }
        }

        // --- CHECK ENTRY SIGNAL ---
        if (!positions[sym]) {
            // Trend Flip: Green (-1 -> 1)
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
        // Simple sizing: Use 95% of current balance (Compounding)
        // If we already have other positions, this simulation might get aggressive,
        // so let's stick to "1 active trade at a time" logic for balance safety
        // OR just divide balance by active coins.
        // For accurate replication: Let's assume we use whatever balance is available.

        const amount = balance * STRATEGY.trade_size_pct;
        if (amount < 10) return; // Too poor to trade

        const qty = amount / candle.price;

        positions[symbol] = {
            symbol: symbol,
            entryPrice: candle.price,
            quantity: qty,
            stopLoss: candle.price * (1 - STRATEGY.stop_loss_pct),
            trailingStop: candle.price * (1 - STRATEGY.trailing_stop_pct),
            startTime: candle.timestamp,
        };

        // Deduct balance immediately
        balance -= amount;
        // Fee deduction (0.1%)
        balance -= amount * 0.001;
    }

    function closeTrade(symbol, candle, reason) {
        const pos = positions[symbol];
        const exitValue = pos.quantity * candle.price;
        const fee = exitValue * 0.001;
        const netReturn = exitValue - fee;

        const pnl = netReturn - pos.entryPrice * pos.quantity;
        const pnlPct = (netReturn / (pos.entryPrice * pos.quantity) - 1) * 100;

        balance += netReturn;

        tradeHistory.push({
            symbol: symbol,
            type: "SELL",
            reason: reason,
            entry: pos.entryPrice.toFixed(4),
            exit: candle.price.toFixed(4),
            pnl_pct: pnlPct.toFixed(2) + "%",
            balance: balance.toFixed(2),
            time: new Date(candle.timestamp).toISOString(),
        });

        delete positions[symbol];
    }

    console.log("\n🏁 Simulation Complete.");
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
