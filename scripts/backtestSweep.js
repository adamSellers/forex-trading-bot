// scripts/backtestSweep.js - Batch parameter sweep across instruments and scenarios
// Runs BacktestEngine across all instrument/scenario combinations and outputs comparison tables
//
// Usage: node scripts/backtestSweep.js [options]
//   --save              Save all results to database
//   --includeH1         Also run H1 granularity (doubles runs)
//   --instruments X,Y   Override instrument list (comma-separated)
//   --from YYYY-MM-DD   Override start date (default: 2025-10-01)
//   --to YYYY-MM-DD     Override end date (default: 2026-02-01)
//   --scenario "Name"   Run only one named scenario
//   --quiet             Suppress per-run progress, only show final tables

const path = require("path");

// Resolve backend directory so require() finds backend/node_modules
const backendDir = path.join(__dirname, "../backend");
module.paths.unshift(path.join(backendDir, "node_modules"));

// Load .env from backend directory (required for Oanda API key)
require("dotenv").config({ path: path.join(backendDir, ".env") });

const HistoricalDataService = require(path.join(backendDir, "src/services/historicalDataService"));
const BacktestEngine = require(path.join(backendDir, "src/services/backtestEngine"));

// === SWEEP CONFIGURATION ===

const INSTRUMENTS = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY", "NZD_USD", "USD_CAD"];

const DATE_RANGE = {
    from: "2025-10-01",
    to: "2026-02-01",
};

const GRANULARITIES = ["M15"];

// Individual parameter tests
const SCENARIOS = [
    // Control
    { name: "Baseline", overrides: {} },

    // Shorts on vs off
    { name: "No shorts", overrides: { enableShorting: false } },

    // ADX threshold sweep
    { name: "ADX 25", overrides: { minAdx: 25 } },
    { name: "ADX 28", overrides: { minAdx: 28 } },

    // Entry type filtering
    { name: "No continuations", overrides: { enableContinuationEntry: false } },
    { name: "No ADX slope", overrides: { adxSlopeFilter: false } },

    // Take profit
    { name: "TP off", overrides: { enableTakeProfit: false } },

    // Stop loss ATR multiplier sweep
    { name: "SL 1.0x ATR", overrides: { stopLossAtrMultiplier: 1.0 } },
    { name: "SL 1.5x ATR", overrides: { stopLossAtrMultiplier: 1.5 } },
    { name: "SL 2.5x ATR", overrides: { stopLossAtrMultiplier: 2.5 } },
    { name: "SL 3.0x ATR", overrides: { stopLossAtrMultiplier: 3.0 } },

    // Trailing stop sweep (pips / activation pips)
    { name: "Trail 15/10", overrides: { trailingStopPips: 15, trailingStopActivationPips: 10 } },
    { name: "Trail 20/15", overrides: { trailingStopPips: 20, trailingStopActivationPips: 15 } },
    { name: "Trail 30/25", overrides: { trailingStopPips: 30, trailingStopActivationPips: 25 } },
    { name: "Trail 35/30", overrides: { trailingStopPips: 35, trailingStopActivationPips: 30 } },

    // Combination scenarios
    { name: "NoShort+ADX25", overrides: { enableShorting: false, minAdx: 25 } },
    { name: "NoShort+TightSL", overrides: { enableShorting: false, stopLossAtrMultiplier: 1.5 } },
    { name: "NoShort+WideTrail", overrides: { enableShorting: false, trailingStopPips: 30, trailingStopActivationPips: 25 } },
    { name: "TPoff+WideTrail", overrides: { enableTakeProfit: false, trailingStopPips: 30, trailingStopActivationPips: 25 } },
    { name: "NoShort+NoCont", overrides: { enableShorting: false, enableContinuationEntry: false } },
    { name: "ADX25+NoCont", overrides: { minAdx: 25, enableContinuationEntry: false } },
    { name: "KitchenSink", overrides: { enableShorting: false, minAdx: 25, enableContinuationEntry: false, enableTakeProfit: false, trailingStopPips: 30, trailingStopActivationPips: 25 } },

    // Higher-timeframe (H4 SuperTrend) filter scenarios
    { name: "HTF Filter", overrides: { enableHTFFilter: true }, needsHTF: true },
    { name: "HTF+NoShorts", overrides: { enableHTFFilter: true, enableShorting: false }, needsHTF: true },
    { name: "HTF+NoCont", overrides: { enableHTFFilter: true, enableContinuationEntry: false }, needsHTF: true },
    { name: "HTF+NoCont+NoShort", overrides: { enableHTFFilter: true, enableContinuationEntry: false, enableShorting: false }, needsHTF: true },
    { name: "HTF+ADX25", overrides: { enableHTFFilter: true, minAdx: 25 }, needsHTF: true },

    // Multi-timeframe simulation: M15 fill resolution + H1 signal quality
    { name: "MultiTF", overrides: { enableMultiTimeframe: true } },
    { name: "MultiTF+NoCont", overrides: { enableMultiTimeframe: true, enableContinuationEntry: false } },
    { name: "MultiTF+NoShort", overrides: { enableMultiTimeframe: true, enableShorting: false } },
    { name: "MultiTF+HTF", overrides: { enableMultiTimeframe: true, enableHTFFilter: true }, needsHTF: true },
    { name: "MultiTF+HTF+NoCont", overrides: { enableMultiTimeframe: true, enableHTFFilter: true, enableContinuationEntry: false }, needsHTF: true },
];

// === CLI ARG PARSING ===

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
                args[key] = argv[i + 1];
                i++;
            } else {
                args[key] = true;
            }
        }
    }
    return args;
}

function printUsage() {
    console.log(`
Usage: node scripts/backtestSweep.js [options]

Options:
  --save              Save all results to database
  --includeH1         Also run H1 granularity (doubles runs)
  --instruments X,Y   Override instrument list (comma-separated)
  --from YYYY-MM-DD   Override start date (default: ${DATE_RANGE.from})
  --to YYYY-MM-DD     Override end date (default: ${DATE_RANGE.to})
  --scenario "Name"   Run only one named scenario
  --quiet             Suppress per-run progress, only show final tables

Available scenarios:
  ${SCENARIOS.map(s => s.name).join(", ")}

Examples:
  node scripts/backtestSweep.js
  node scripts/backtestSweep.js --save
  node scripts/backtestSweep.js --scenario "No shorts" --instruments AUD_USD
  node scripts/backtestSweep.js --includeH1 --from 2025-06-01 --to 2026-02-01
`);
}

// === FORMATTING HELPERS ===

function formatPnl(value) {
    const sign = value >= 0 ? "+" : "";
    return `${sign}$${value.toFixed(2)}`;
}

function formatPercent(value) {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
}

// === TABLE RENDERER ===

function printTable(title, headers, rows, alignRight = []) {
    if (rows.length === 0) {
        console.log(`\n${title}\n  (no data)\n`);
        return;
    }

    // Calculate column widths
    const widths = headers.map((h, i) => {
        const dataMax = rows.reduce((max, row) => Math.max(max, String(row[i]).length), 0);
        return Math.max(h.length, dataMax);
    });

    const separator = "+" + widths.map(w => "-".repeat(w + 2)).join("+") + "+";

    console.log(`\n${title}`);
    console.log(separator);

    // Header
    const headerLine = headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join("|");
    console.log(`|${headerLine}|`);
    console.log(separator);

    // Data rows
    for (const row of rows) {
        const line = row.map((cell, i) => {
            const str = String(cell);
            if (alignRight.includes(i)) {
                return ` ${str.padStart(widths[i])} `;
            }
            return ` ${str.padEnd(widths[i])} `;
        }).join("|");
        console.log(`|${line}|`);
    }

    console.log(separator);
}

// === DATA FETCHING ===

async function fetchAllData(instruments, granularities, fromTimestamp, toTimestamp, needsHTF) {
    const historicalDataService = new HistoricalDataService();
    const candleData = {};

    // Always fetch H4 if any scenario needs HTF filter
    const allGranularities = [...granularities];
    if (needsHTF && !allGranularities.includes("H4")) {
        allGranularities.push("H4");
    }

    const totalFetches = instruments.length * allGranularities.length;
    let completed = 0;

    for (const granularity of allGranularities) {
        for (const instrument of instruments) {
            const key = `${instrument}_${granularity}`;
            completed++;
            process.stdout.write(`  [${completed}/${totalFetches}] Fetching ${key}...`);

            const start = Date.now();
            candleData[key] = await historicalDataService.getCandles(
                instrument, granularity, fromTimestamp, toTimestamp
            );
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(` ${candleData[key].length.toLocaleString()} candles (${elapsed}s)`);
        }
    }

    return candleData;
}

// === SWEEP EXECUTION ===

function runSweep(candleData, instruments, granularities, scenarios, quiet) {
    const engine = new BacktestEngine();
    const results = [];

    const totalRuns = instruments.length * granularities.length * scenarios.length;
    let completed = 0;

    for (const granularity of granularities) {
        for (const scenario of scenarios) {
            for (const instrument of instruments) {
                const key = `${instrument}_${granularity}`;
                const candles = candleData[key];

                completed++;
                if (!quiet) {
                    process.stdout.write(`\r  [${completed}/${totalRuns}] ${scenario.name} | ${instrument} ${granularity}          `);
                }

                // Pass H4 candles for HTF filter scenarios
                const htfCandles = scenario.needsHTF ? candleData[`${instrument}_H4`] || null : null;
                const result = engine.runOnCandles(candles, instrument, scenario.overrides, htfCandles);

                results.push({
                    scenario: scenario.name,
                    instrument,
                    granularity,
                    overrides: scenario.overrides,
                    summary: result.summary,
                    fullResult: result,
                });
            }
        }
    }

    if (!quiet) {
        process.stdout.write("\r" + " ".repeat(80) + "\r");
    }

    return results;
}

// === AGGREGATION ===

function aggregateByScenario(results) {
    const grouped = {};

    for (const r of results) {
        const key = `${r.scenario}_${r.granularity}`;
        if (!grouped[key]) {
            grouped[key] = { scenario: r.scenario, granularity: r.granularity, runs: [] };
        }
        grouped[key].runs.push(r.summary);
    }

    return Object.values(grouped).map(group => {
        const runs = group.runs;
        const n = runs.length;
        return {
            scenario: group.scenario,
            granularity: group.granularity,
            instrumentCount: n,
            totalTrades: runs.reduce((s, r) => s + r.totalTrades, 0),
            avgWinRate: runs.reduce((s, r) => s + r.winRate, 0) / n,
            totalPnl: runs.reduce((s, r) => s + r.totalPnl, 0),
            avgProfitFactor: runs.reduce((s, r) => s + (r.profitFactor === Infinity ? 10 : r.profitFactor), 0) / n,
            avgMaxDrawdown: runs.reduce((s, r) => s + r.maxDrawdownPercent, 0) / n,
            avgExpectancy: runs.reduce((s, r) => s + r.expectancy, 0) / n,
            avgReturnPercent: runs.reduce((s, r) => s + r.returnPercent, 0) / n,
        };
    });
}

function getBaselineByInstrument(results) {
    return results
        .filter(r => r.scenario === "Baseline")
        .map(r => ({
            instrument: r.instrument,
            granularity: r.granularity,
            ...r.summary,
        }));
}

// === OUTPUT ===

function printScenarioSummary(aggregated) {
    const sorted = [...aggregated].sort((a, b) => b.totalPnl - a.totalPnl);

    const headers = ["Scenario", "Gran", "Pairs", "Trades", "AvgWin%", "TotalP&L", "AvgPF", "AvgDD%", "AvgRet%"];
    const rows = sorted.map(r => [
        r.scenario,
        r.granularity,
        r.instrumentCount,
        r.totalTrades,
        (r.avgWinRate * 100).toFixed(1) + "%",
        formatPnl(r.totalPnl),
        r.avgProfitFactor.toFixed(2),
        r.avgMaxDrawdown.toFixed(1) + "%",
        formatPercent(r.avgReturnPercent),
    ]);

    printTable("SCENARIO SUMMARY (aggregated across instruments, sorted by Total P&L)", headers, rows, [2, 3, 4, 5, 6, 7, 8]);
}

function printInstrumentComparison(instrumentResults) {
    const sorted = [...instrumentResults].sort((a, b) => b.totalPnl - a.totalPnl);

    const headers = ["Instrument", "Gran", "Trades", "Win%", "P&L", "PF", "MaxDD%", "Expect"];
    const rows = sorted.map(r => [
        r.instrument,
        r.granularity,
        r.totalTrades,
        (r.winRate * 100).toFixed(1) + "%",
        formatPnl(r.totalPnl),
        r.profitFactor === Infinity ? "Inf" : r.profitFactor.toFixed(2),
        r.maxDrawdownPercent.toFixed(1) + "%",
        formatPnl(r.expectancy),
    ]);

    printTable("INSTRUMENT COMPARISON (Baseline scenario)", headers, rows, [2, 3, 4, 5, 6, 7]);
}

function printFullResults(results) {
    const sorted = [...results].sort((a, b) => b.summary.totalPnl - a.summary.totalPnl);

    const headers = ["Scenario", "Instrument", "Gran", "Trades", "Win%", "P&L", "PF", "MaxDD%", "Expect"];
    const rows = sorted.map(r => [
        r.scenario.substring(0, 20),
        r.instrument,
        r.granularity,
        r.summary.totalTrades,
        (r.summary.winRate * 100).toFixed(1) + "%",
        formatPnl(r.summary.totalPnl),
        r.summary.profitFactor === Infinity ? "Inf" : r.summary.profitFactor.toFixed(2),
        r.summary.maxDrawdownPercent.toFixed(1) + "%",
        formatPnl(r.summary.expectancy),
    ]);

    printTable("FULL RESULTS (all runs sorted by P&L)", headers, rows, [3, 4, 5, 6, 7, 8]);
}

function printHighlights(results) {
    const sorted = [...results].sort((a, b) => b.summary.totalPnl - a.summary.totalPnl);

    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();

    console.log("\nBEST PERFORMERS:");
    top5.forEach((r, i) => {
        const s = r.summary;
        console.log(`  ${i + 1}. ${r.instrument} | ${r.scenario} | ${r.granularity} -- P&L: ${formatPnl(s.totalPnl)}, WR: ${(s.winRate * 100).toFixed(1)}%, PF: ${s.profitFactor === Infinity ? "Inf" : s.profitFactor.toFixed(2)}, Trades: ${s.totalTrades}`);
    });

    console.log("\nWORST PERFORMERS:");
    bottom5.forEach((r, i) => {
        const s = r.summary;
        console.log(`  ${i + 1}. ${r.instrument} | ${r.scenario} | ${r.granularity} -- P&L: ${formatPnl(s.totalPnl)}, WR: ${(s.winRate * 100).toFixed(1)}%, PF: ${s.profitFactor === Infinity ? "Inf" : s.profitFactor.toFixed(2)}, Trades: ${s.totalTrades}`);
    });

    console.log("");
}

// === DATABASE SAVE ===

async function saveResults(results, fromTimestamp, toTimestamp) {
    const BacktestRepository = require(path.join(backendDir, "src/repositories/backtestRepository"));
    const backtestRepo = new BacktestRepository();

    let saved = 0;
    for (const r of results) {
        const label = `Sweep: ${r.scenario} | ${r.instrument} ${r.granularity}`;
        await backtestRepo.save(
            r.fullResult,
            r.instrument,
            r.granularity,
            fromTimestamp,
            toTimestamp,
            label
        );
        saved++;
    }

    console.log(`Saved ${saved} backtest results to database.`);
}

// === MAIN ===

async function main() {
    const args = parseArgs(process.argv);

    if (args.help) {
        printUsage();
        process.exit(0);
    }

    // Resolve configuration from CLI args
    const instruments = args.instruments ? args.instruments.split(",") : INSTRUMENTS;
    const fromDate = args.from || DATE_RANGE.from;
    const toDate = args.to || DATE_RANGE.to;
    const granularities = args.includeH1 ? ["M15", "H1"] : GRANULARITIES;
    const scenarioFilter = args.scenario || null;
    const quiet = !!args.quiet;

    const scenarios = scenarioFilter
        ? SCENARIOS.filter(s => s.name === scenarioFilter)
        : SCENARIOS;

    if (scenarios.length === 0) {
        console.error(`Error: Unknown scenario "${scenarioFilter}".`);
        console.error(`Available: ${SCENARIOS.map(s => s.name).join(", ")}`);
        process.exit(1);
    }

    const fromTimestamp = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(toDate).getTime() / 1000);

    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        console.error("Error: Invalid date format. Use YYYY-MM-DD.");
        process.exit(1);
    }

    const totalRuns = instruments.length * granularities.length * scenarios.length;
    console.log(`\nBacktest Sweep: ${scenarios.length} scenarios x ${instruments.length} instruments x ${granularities.length} granularities = ${totalRuns} runs`);
    console.log(`Date range: ${fromDate} to ${toDate}\n`);

    // Phase 1: Fetch data
    const needsHTF = scenarios.some(s => s.needsHTF);
    console.log("Phase 1: Fetching historical data...");
    const startFetch = Date.now();
    const candleData = await fetchAllData(instruments, granularities, fromTimestamp, toTimestamp, needsHTF);
    const fetchTime = ((Date.now() - startFetch) / 1000).toFixed(1);
    console.log(`  Data fetch complete in ${fetchTime}s\n`);

    // Phase 2: Run sweep
    console.log("Phase 2: Running backtests...");
    const startSweep = Date.now();
    const results = runSweep(candleData, instruments, granularities, scenarios, quiet);
    const sweepTime = ((Date.now() - startSweep) / 1000).toFixed(1);
    console.log(`  Sweep complete: ${results.length} runs in ${sweepTime}s\n`);

    // Phase 3: Output results
    console.log("Phase 3: Results");
    printScenarioSummary(aggregateByScenario(results));
    printInstrumentComparison(getBaselineByInstrument(results));
    printFullResults(results);
    printHighlights(results);

    // Phase 4: Save (optional)
    if (args.save) {
        console.log("Phase 4: Saving to database...");
        await saveResults(results, fromTimestamp, toTimestamp);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Sweep failed:", err.message);
        console.error(err.stack);
        process.exit(1);
    });
