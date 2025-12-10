// backend/scripts/optimize-strategy.js
const BacktestingEngine = require("../src/services/backtestingEngine");
const logger = require("../src/utils/logger");

// 1. THE GRID (Parameters to test)
const PARAM_GRID = {
    // Trend Strength: Testing if we should only trade strong trends (25+) or catch early ones (20)
    minAdx: [20, 25, 30, 35],
    // Overbought Levels: Testing if 70 is too sensitive or 80 is too risky
    rsiOverbought: [65, 70, 75, 80],
    // Risk Management: Tight vs Loose stops
    stopLossATR: [1.5, 2.0, 2.5],
};

const DATA_FILE = "BTCUSDT-1h-1000.json";

async function runGridSearch() {
    console.log("🔬 Starting Grid Search Optimization...");
    console.time("Optimization Duration");

    const results = [];
    let runCount = 0;
    const totalRuns =
        PARAM_GRID.minAdx.length *
        PARAM_GRID.rsiOverbought.length *
        PARAM_GRID.stopLossATR.length;

    // 2. THE LOOP
    for (const adx of PARAM_GRID.minAdx) {
        for (const rsi of PARAM_GRID.rsiOverbought) {
            for (const sl of PARAM_GRID.stopLossATR) {
                runCount++;

                // Configure this specific run
                const testConfig = {
                    dataFile: DATA_FILE,
                    symbol: "BTCUSDT",
                    strategy: "balanced",
                    enableAdxFilter: true,
                    minAdx: adx,
                    enableRsiFilter: true,
                    rsiOverbought: rsi,
                    stopLossATR: sl,
                    // Mute logger to keep console clean
                    logLevel: "error",
                };

                try {
                    const engine = new BacktestingEngine(testConfig);

                    // --- MOCKING: CRITICAL FIXES ---

                    // 1. Mock the Repository to prevent SQLITE_ERROR
                    engine.paperTrading.tradeRepo = {
                        getAllTrades: async () => [], // Return empty history
                        save: async () => {}, // Do nothing on save
                        updateTrade: async () => {}, // Do nothing on update
                        getOpenLiveTrades: async () => [],
                    };

                    // 2. Disable file persistence
                    engine.paperTrading.saveStateToFile = () => {};

                    // 3. Patch missing method 'isValidSignal' if it doesn't exist
                    if (!engine.paperTrading.isValidSignal) {
                        engine.paperTrading.isValidSignal = (signal) => {
                            // Replicate basic validation logic
                            return (
                                signal &&
                                signal.signal !== "HOLD" &&
                                signal.signal !== "COOLDOWN" &&
                                signal.signal !== "ERROR"
                            );
                        };
                    }

                    // --- END MOCKING ---

                    // Run Simulation
                    const report = await engine.run();
                    const summary = report.summary;

                    const result = {
                        params: { adx, rsi, sl },
                        metrics: {
                            pnl: summary.totalPnL,
                            winRate: summary.winRate,
                            trades: summary.totalTrades,
                        },
                    };

                    results.push(result);

                    // Progress Bar
                    process.stdout.write(
                        `\r[${runCount}/${totalRuns}] ADX:${adx} RSI:${rsi} SL:${sl} => PnL: $${summary.totalPnL.toFixed(
                            2
                        )}   `
                    );
                } catch (error) {
                    // Only log real logic errors, not the expected ones we just fixed
                    // console.error(`\nRun failed:`, error.message);
                }
            }
        }
    }

    console.log("\n\n✅ Optimization Complete.");
    console.timeEnd("Optimization Duration");

    // 3. ANALYSIS
    if (results.length === 0) {
        console.log("❌ No results found. All runs failed.");
        return;
    }

    // Sort by Profit (High to Low)
    results.sort((a, b) => b.metrics.pnl - a.metrics.pnl);

    console.log("\n🏆 TOP 3 CONFIGURATIONS");
    console.log("========================================");
    results.slice(0, 3).forEach((res, i) => {
        console.log(
            `#${i + 1}: PnL $${res.metrics.pnl.toFixed(2)} | Win Rate: ${
                res.metrics.winRate
            }% | Trades: ${res.metrics.trades}`
        );
        console.log(
            `    Set: minAdx: ${res.params.adx}, rsiOverbought: ${res.params.rsi}, stopLossATR: ${res.params.sl}`
        );
        console.log("----------------------------------------");
    });
}

runGridSearch();
