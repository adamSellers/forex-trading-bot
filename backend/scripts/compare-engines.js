// backend/scripts/strategy-sweep.js
// 🕵️ STRATEGY GRID SEARCH (Brute Force Optimizer)
// Run: "node scripts/strategy-sweep.js"

const Binance = require("node-binance-api");

// --- ASSETS TO TEST ---
const ASSETS = ["DOTUSDT", "ETHUSDT", "SHIBUSDT", "BTCUSDT"]; // Mix of Volatility
const DAYS = 180; // Test last 6 months (most relevant regime)

// --- PARAMETERS TO SWEEP ---
const TIMEFRAMES = ["1h", "4h"];
const STOP_LOSSES = [0.03, 0.05, 0.08]; // 3%, 5%, 8% Fixed
const ADX_THRESHOLDS = [20, 25, 30]; // Trend Strength

const binance = new Binance().options({ family: 4, log: () => {} });

// --- INDICATOR FUNCTIONS (Minified) ---
function calculateRSI(closes, p = 14) {
    let r = new Array(closes.length).fill(0);
    if (closes.length < p + 1) return r;
    let g = 0,
        l = 0;
    for (let i = 1; i <= p; i++) {
        let d = closes[i] - closes[i - 1];
        if (d >= 0) g += d;
        else l -= d;
    }
    let au = g / p,
        ad = l / p;
    r[p] = 100 - 100 / (1 + au / ad);
    for (let i = p + 1; i < closes.length; i++) {
        let d = closes[i] - closes[i - 1];
        let u = d >= 0 ? d : 0,
            dn = d < 0 ? -d : 0;
        au = (au * (p - 1) + u) / p;
        ad = (ad * (p - 1) + dn) / p;
        r[i] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);
    }
    return r;
}
function calculateADX(highs, lows, closes, p = 14) {
    let pd = [],
        md = [],
        tr = [];
    for (let i = 1; i < highs.length; i++) {
        let u = highs[i] - highs[i - 1],
            d = lows[i - 1] - lows[i];
        pd.push(u > d && u > 0 ? u : 0);
        md.push(d > u && d > 0 ? d : 0);
        tr.push(
            Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            )
        );
    }
    const s = (d) => {
        let m = [d.slice(0, p).reduce((a, b) => a + b, 0)];
        for (let i = p; i < d.length; i++)
            m.push(m[m.length - 1] - m[m.length - 1] / p + d[i]);
        return m;
    };
    let sp = s(pd),
        sm = s(md),
        st = s(tr),
        ax = [],
        dx = [];
    for (let i = 0; i < st.length; i++) {
        let dp = (sp[i] / st[i]) * 100,
            dm = (sm[i] / st[i]) * 100,
            x = (Math.abs(dp - dm) / (dp + dm)) * 100;
        dx.push(isNaN(x) ? 0 : x);
    }
    if (dx.length < p) return new Array(highs.length).fill(0);
    let f = dx.slice(0, p).reduce((a, b) => a + b, 0) / p;
    ax.push(f);
    for (let i = p; i < dx.length; i++)
        ax.push((ax[ax.length - 1] * (p - 1) + dx[i]) / p);
    return new Array(highs.length - ax.length).fill(0).concat(ax);
}
function calculateSuperTrend(highs, lows, closes, p = 10, f = 3) {
    let tr = [highs[0] - lows[0]],
        atr = [tr[0]];
    for (let i = 1; i < closes.length; i++) {
        let hl = highs[i] - lows[i],
            hc = Math.abs(highs[i] - closes[i - 1]),
            lc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hc, lc));
        atr.push((atr[i - 1] * (p - 1) + tr[i]) / p);
    }
    let ub = [],
        lb = [],
        st = [],
        d = [];
    let bu = (highs[0] + lows[0]) / 2 + f * atr[0],
        bl = (highs[0] + lows[0]) / 2 - f * atr[0];
    ub.push(bu);
    lb.push(bl);
    st.push(bu);
    d.push(1);
    for (let i = 1; i < closes.length; i++) {
        let cbu = (highs[i] + lows[i]) / 2 + f * atr[i],
            cbl = (highs[i] + lows[i]) / 2 - f * atr[i],
            pfu = ub[i - 1],
            pfl = lb[i - 1],
            pc = closes[i - 1];
        let fu = cbu < pfu || pc > pfu ? cbu : pfu,
            fl = cbl > pfl || pc < pfl ? cbl : pfl;
        ub.push(fu);
        lb.push(fl);
        let pd = d[i - 1],
            cd = pd;
        if (pd === 1 && closes[i] < lb[i - 1]) cd = -1;
        else if (pd === -1 && closes[i] > ub[i - 1]) cd = 1;
        d.push(cd);
        st.push(cd === 1 ? fl : fu);
    }
    return { direction: d };
}

// --- CORE SIMULATOR ---
function runSim(candles, config) {
    const { timeframe, stopLoss, minAdx } = config;

    // Recalc indicators if needed (Optimization: Could cache these, but raw speed is fine for this scale)
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    // We use standard SuperTrend(10,3) & RSI(14) for all tests
    const st = calculateSuperTrend(highs, lows, closes, 10, 3);
    const rsi = calculateRSI(closes, 14);
    const adx = calculateADX(highs, lows, closes, 14);

    let balance = 1000;
    let position = null;
    let trades = 0;
    let wins = 0;

    for (let i = 50; i < candles.length; i++) {
        const price = closes[i];
        const prevDir = st.direction[i - 1];
        const dir = st.direction[i];

        // LOGIC: Momentum Engine (98% Size)
        // Buy Trigger
        if (!position) {
            if (prevDir === -1 && dir === 1 && adx[i] > minAdx && rsi[i] < 75) {
                const qty = (balance * 0.98) / price;
                // SLIPPAGE: 0.1% on entry
                const cost = qty * price;
                balance -= cost;

                position = {
                    entry: price,
                    qty,
                    cost,
                    stop: price * (1 - stopLoss),
                };
            }
        }
        // Sell Trigger
        else {
            let exit = null;
            if (lows[i] <= position.stop) exit = position.stop; // Fixed SL
            else if (dir === -1) exit = price; // Trend Flip

            if (exit) {
                // FEE + SLIPPAGE: 0.2% total penalty on exit to be safe
                const rawRevenue = exit * position.qty;
                const netRevenue = rawRevenue * 0.998;
                balance += netRevenue;

                trades++;
                if (netRevenue > position.cost) wins++;
                position = null;
            }
        }
    }

    return {
        profit: balance - 1000,
        trades,
        winRate: trades > 0 ? (wins / trades) * 100 : 0,
    };
}

// --- ORCHESTRATOR ---
async function sweep() {
    console.log(`\n🕵️ STARTING GRID SEARCH (${DAYS} DAYS HISTORY)`);
    console.log(
        `   Combinations: ${ASSETS.length} Assets x ${
            TIMEFRAMES.length
        } TFs x ${STOP_LOSSES.length} SLs x ${ADX_THRESHOLDS.length} ADXs = ${
            ASSETS.length *
            TIMEFRAMES.length *
            STOP_LOSSES.length *
            ADX_THRESHOLDS.length
        } Sims\n`
    );

    const results = [];

    for (const asset of ASSETS) {
        process.stdout.write(`   Scanning ${asset}... `);

        // 1. Fetch 1h Data
        let candles1h = [];
        let endTime = Date.now();
        const startTime = endTime - DAYS * 24 * 60 * 60 * 1000;
        while (true) {
            const d = await new Promise((r) =>
                binance.candlesticks(asset, "1h", (e, t) => r(t), {
                    limit: 1000,
                    endTime,
                })
            );
            if (!d.length) break;
            const p = d.map((c) => ({
                time: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
            }));
            candles1h = [...p, ...candles1h];
            if (p[0].time < startTime) break;
            endTime = p[0].time - 1;
            await new Promise((r) => setTimeout(r, 10));
        }
        candles1h = candles1h
            .sort((a, b) => a.time - b.time)
            .filter((c) => c.time >= startTime);

        // 2. Mock 4h Data (Simple resampling for speed)
        // NOTE: For perfect accuracy fetch 4h from API, but resampling is usually "good enough" for broad sweeps
        // Actually, let's just fetch 4h to be safe.
        let candles4h = [];
        endTime = Date.now();
        while (true) {
            const d = await new Promise((r) =>
                binance.candlesticks(asset, "4h", (e, t) => r(t), {
                    limit: 1000,
                    endTime,
                })
            );
            if (!d.length) break;
            const p = d.map((c) => ({
                time: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
            }));
            candles4h = [...p, ...candles4h];
            if (p[0].time < startTime) break;
            endTime = p[0].time - 1;
            await new Promise((r) => setTimeout(r, 10));
        }
        candles4h = candles4h
            .sort((a, b) => a.time - b.time)
            .filter((c) => c.time >= startTime);

        // 3. RUN PERMUTATIONS
        for (const tf of TIMEFRAMES) {
            const candles = tf === "1h" ? candles1h : candles4h;

            for (const sl of STOP_LOSSES) {
                for (const adx of ADX_THRESHOLDS) {
                    const config = { timeframe: tf, stopLoss: sl, minAdx: adx };
                    const res = runSim(candles, config);

                    results.push({
                        asset,
                        tf,
                        sl: (sl * 100).toFixed(0) + "%",
                        adx,
                        profit: res.profit,
                        trades: res.trades,
                        wr: res.winRate.toFixed(0),
                    });
                }
            }
        }
        process.stdout.write("Done.\n");
    }

    // 4. DISPLAY WINNERS
    results.sort((a, b) => b.profit - a.profit);
    const winners = results.filter((r) => r.profit > 0);

    console.log("\n🏆 TOP 10 CONFIGURATIONS:");
    console.log(
        "-----------------------------------------------------------------------"
    );
    console.log(
        "Rank | Asset    | TF  | SL   | ADX | Net Profit | Trades | Win Rate"
    );
    console.log(
        "-----|----------|-----|------|-----|------------|--------|---------"
    );

    if (winners.length === 0) {
        console.log(
            "❌ NO PROFITABLE SETTINGS FOUND. Strategy is fundamentally broken in this regime."
        );
    } else {
        winners.slice(0, 15).forEach((r, i) => {
            const pnl = `$${r.profit.toFixed(2)}`.padEnd(10);
            console.log(
                `${(i + 1).toString().padEnd(4)} | ${r.asset.padEnd(
                    8
                )} | ${r.tf.padEnd(3)} | ${r.sl.padEnd(4)} | ${r.adx
                    .toString()
                    .padEnd(3)} | \x1b[32m${pnl}\x1b[0m | ${r.trades
                    .toString()
                    .padEnd(6)} | ${r.wr}%`
            );
        });
    }

    console.log("\n💀 WORST PERFORMER:");
    const loser = results[results.length - 1];
    console.log(
        `${loser.asset} ${loser.tf} SL:${loser.sl} ADX:${
            loser.adx
        } -> $${loser.profit.toFixed(2)}`
    );

    process.exit(0);
}

sweep();
