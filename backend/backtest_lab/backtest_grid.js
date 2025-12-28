// backend/backtest_lab/backtest_grid.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "market_data.db");
const db = new sqlite3.Database(DB_PATH);

// --- THE GRID: Define the scenarios we want to test ---
const SCENARIOS = [
    {
        name: "Baseline (Swinger)",
        adx: 25,
        rsi: 70,
        sl: 0.02,
        tp: 0.0,
        ts: 0.0,
    }, // The current winner
    { name: "Strict Entry", adx: 30, rsi: 70, sl: 0.02, tp: 0.0, ts: 0.0 }, // Higher quality only?
    { name: "Tight Stop", adx: 25, rsi: 70, sl: 0.015, tp: 0.0, ts: 0.0 }, // Cut losses faster?
    { name: "Loose Trailing", adx: 25, rsi: 70, sl: 0.02, tp: 0.0, ts: 0.03 }, // TS 3% (Very loose)
    { name: "RSI Filter", adx: 25, rsi: 55, sl: 0.02, tp: 0.0, ts: 0.0 }, // Only buy dips (RSI < 55)
];

async function runGrid() {
    console.log("🧪 Starting Strategy Grid Search...");

    // 1. Fetch Data Once (Optimization)
    const rows = await new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM market_state_15m ORDER BY timestamp ASC",
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });

    // Group by Symbol for logic
    const marketData = {};
    rows.forEach((row) => {
        if (!marketData[row.symbol]) marketData[row.symbol] = [];
        marketData[row.symbol].push(row);
    });

    console.log(
        `📊 Loaded ${rows.length} signals. Testing ${SCENARIOS.length} scenarios...\n`
    );

    const results = [];

    // 2. Run Each Scenario
    for (const strategy of SCENARIOS) {
        const stats = simulate(marketData, strategy);
        results.push({
            Name: strategy.name,
            ADX: strategy.adx,
            SL: strategy.sl * 100 + "%",
            Trades: stats.tradeCount,
            WinRate: stats.winRate.toFixed(1) + "%",
            "PnL %": stats.pnlPct.toFixed(2) + "%",
            "Net Profit": "$" + stats.netProfit.toFixed(2),
        });
    }

    // 3. Print Leaderboard
    console.table(
        results.sort(
            (a, b) =>
                parseFloat(b["Net Profit"].replace("$", "")) -
                parseFloat(a["Net Profit"].replace("$", ""))
        )
    );
    process.exit(0);
}

function simulate(marketData, strat) {
    let balance = 1000;
    let initialBalance = 1000;
    let positions = {};
    let wins = 0;
    let losses = 0;

    const symbols = Object.keys(marketData);

    // We iterate time globally to be fair, but for speed we iterate by symbol here
    // (This is valid as long as we assume sufficient capital for all trades)

    for (const sym of symbols) {
        const candles = marketData[sym];
        let pos = null; // Current position for this coin

        for (let i = 1; i < candles.length; i++) {
            const candle = candles[i];
            const prev = candles[i - 1];

            // --- MANAGE POSITION ---
            if (pos) {
                let sold = false;
                let reason = "";
                let exitPrice = candle.price;

                // 1. Stop Loss
                if (candle.price <= pos.stopLoss) {
                    sold = true;
                    reason = "SL";
                    exitPrice = pos.stopLoss; // Slippage approximation
                }
                // 2. Trailing Stop (If enabled)
                else if (strat.ts > 0) {
                    const newStop = candle.price * (1 - strat.ts);
                    if (newStop > pos.trailingStop) pos.trailingStop = newStop;
                    if (candle.price <= pos.trailingStop) {
                        sold = true;
                        reason = "TS";
                        exitPrice = pos.trailingStop;
                    }
                }
                // 3. Take Profit (If enabled)
                else if (strat.tp > 0 && candle.price >= pos.takeProfit) {
                    sold = true;
                    reason = "TP";
                    exitPrice = pos.takeProfit;
                }
                // 4. Trend Flip
                else if (candle.supertrend_direction === -1) {
                    sold = true;
                    reason = "Flip";
                }

                if (sold) {
                    // Calc PnL
                    const value = pos.qty * exitPrice;
                    const fee = value * 0.001;
                    const net = value - fee;
                    const profit = net - pos.entryPrice * pos.qty;

                    balance += profit; // Add raw profit/loss to global balance

                    if (profit > 0) wins++;
                    else losses++;
                    pos = null;
                }
            }

            // --- ENTRY ---
            if (!pos) {
                const flipGreen =
                    prev.supertrend_direction === -1 &&
                    candle.supertrend_direction === 1;
                if (flipGreen) {
                    if (candle.adx > strat.adx && candle.rsi < strat.rsi) {
                        // Buy logic
                        const tradeAmt = balance * 0.2; // Use 20% of CURRENT balance per trade (Dynamic sizing)
                        // Or fixed sizing for cleaner comparison? Let's use Fixed $200 per trade to isolate strategy performance.
                        const fixedAmt = 200;

                        const qty = fixedAmt / candle.price;
                        const fee = fixedAmt * 0.001;

                        pos = {
                            entryPrice: candle.price,
                            qty: qty,
                            stopLoss: candle.price * (1 - strat.sl),
                            takeProfit: candle.price * (1 + strat.tp),
                            trailingStop: candle.price * (1 - strat.ts),
                        };

                        // Pay entry fee immediately from simulated balance tracking
                        balance -= fee;
                    }
                }
            }
        }
    }

    return {
        tradeCount: wins + losses,
        winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
        netProfit: balance - initialBalance,
        pnlPct: ((balance - initialBalance) / initialBalance) * 100,
    };
}

runGrid();
