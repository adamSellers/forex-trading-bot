// scripts/backtest.js - CLI tool for running backtests on historical data
// Usage: node scripts/backtest.js --instrument AUD_USD --from 2025-10-01 --to 2026-02-01
// Options:
//   --instrument  Required. e.g. AUD_USD, EUR_USD
//   --from        Required. Start date YYYY-MM-DD
//   --to          Required. End date YYYY-MM-DD
//   --granularity  Optional. Default M15. e.g. M15, H1, H4
//   --save        Optional flag. Save results to database
//   --label       Optional. Label for saved result
//   --minAdx      Optional. Override minimum ADX threshold
//   --spreadPips  Optional. Override spread cost in pips
//   --initialBalance  Optional. Override starting balance
//   --enableShorting  Optional. true/false
//   --maxOpenPositions Optional. Override concurrent open positions
//   --leverage        Optional. Override leverage
//   --stopLossType    Optional. ATR or FIXED
//   --stopLossPips    Optional. Fixed stop distance in pips
//   --stopLossAtrMultiplier Optional. ATR stop multiplier
//   --minStopLossPips Optional. Minimum stop floor in pips
//   --enableTrailingStops Optional. true/false
//   --trailingStopPips Optional. Trailing distance in pips
//   --trailingStopActivationPips Optional. Profit threshold before trailing activates
//   --enableTakeProfit Optional. true/false
//   --takeProfitPercent Optional. Take-profit target as decimal fraction
//   --enableBreakeven Optional. true/false
//   --breakevenTriggerPips Optional. Profit threshold before SL moves to breakeven
//   --enableHTFFilter Optional. true/false
//   --htfFilter       Optional flag. Enable H4 SuperTrend higher-timeframe filter
//   --multiTF         Optional flag. M15 candles aggregated to H1 for signals, M15 for fill resolution

const path = require("path");

// Resolve backend directory so require() finds backend/node_modules
const backendDir = path.join(__dirname, "../backend");
module.paths.unshift(path.join(backendDir, "node_modules"));

// Load .env from backend directory
require("dotenv").config({ path: path.join(backendDir, ".env") });

const HistoricalDataService = require(path.join(backendDir, "src/services/historicalDataService"));
const BacktestEngine = require(path.join(backendDir, "src/services/backtestEngine"));

// Parse command-line arguments
function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            // Check if next arg is a value or another flag
            if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
                args[key] = argv[i + 1];
                i++;
            } else {
                args[key] = true; // Flag without value (e.g. --save)
            }
        }
    }
    return args;
}

function printUsage() {
    console.log(`
Usage: node scripts/backtest.js --instrument <PAIR> --from <DATE> --to <DATE> [options]

Required:
  --instrument    Currency pair (e.g. AUD_USD, EUR_USD, GBP_USD)
  --from          Start date (YYYY-MM-DD)
  --to            End date (YYYY-MM-DD)

Optional:
  --granularity   Candle timeframe (default: M15). Options: M15, H1, H4
  --save          Save results to database
  --label         Label for saved result (requires --save)
  --minAdx        Override ADX threshold (default: 22)
  --spreadPips    Override spread cost in pips (default: 1.5)
  --initialBalance Override starting balance (default: 500)
  --enableShorting Enable/disable shorts (default: true)
  --maxOpenPositions Override open-position cap
  --leverage      Override leverage
  --stopLossType  ATR or FIXED
  --stopLossPips  Fixed stop distance in pips
  --stopLossAtrMultiplier ATR stop multiplier
  --minStopLossPips Minimum stop floor in pips
  --enableTrailingStops Enable/disable trailing stop logic
  --trailingStopPips Trailing distance in pips
  --trailingStopActivationPips Profit threshold before trailing starts
  --enableTakeProfit Enable/disable take profit
  --takeProfitPercent Take-profit target as decimal fraction
  --enableBreakeven Enable/disable breakeven protection
  --breakevenTriggerPips Breakeven trigger in pips
  --enableHTFFilter Enable/disable H4 SuperTrend confirmation
  --htfFilter     Enable H4 SuperTrend higher-timeframe trend filter
  --multiTF       Multi-timeframe: M15 fills + H1 signals (aggregates M15→H1)

Examples:
  node scripts/backtest.js --instrument AUD_USD --from 2025-10-01 --to 2026-02-01
  node scripts/backtest.js --instrument EUR_USD --from 2025-06-01 --to 2026-01-01 --granularity H1 --save
  node scripts/backtest.js --instrument GBP_USD --from 2025-10-01 --to 2026-02-01 --minAdx 25 --save --label "Higher ADX test"
`);
}

function formatPnl(value) {
    const sign = value >= 0 ? "+" : "";
    return `${sign}$${value.toFixed(2)}`;
}

function formatPercent(value) {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
}

function padRight(str, len) {
    return str.padEnd(len);
}

function printResults(result, instrument, granularity, fromDate, toDate) {
    const { summary } = result;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Backtest: ${instrument} ${granularity} | ${fromDate} to ${toDate}`);
    console.log(`${"=".repeat(60)}`);

    console.log(`\n  Total Trades:    ${summary.totalTrades}`);
    console.log(`  Win Rate:        ${(summary.winRate * 100).toFixed(1)}% (${summary.winners}W / ${summary.losers}L)`);
    console.log(`  Total P&L:       ${formatPnl(summary.totalPnl)}`);
    console.log(`  Profit Factor:   ${summary.profitFactor === Infinity ? "Inf" : summary.profitFactor.toFixed(2)}`);
    console.log(`  Max Drawdown:    -${summary.maxDrawdownPercent.toFixed(1)}%`);
    console.log(`  Avg R:R:         ${summary.avgRR.toFixed(1)}:1`);
    console.log(`  Expectancy:      ${formatPnl(summary.expectancy)}/trade`);
    console.log(`  Return:          ${formatPercent(summary.returnPercent)}`);
    console.log(`  Balance:         $${summary.startBalance.toFixed(2)} -> $${summary.endBalance.toFixed(2)}`);

    // By entry type
    const entryTypes = Object.entries(summary.byEntryType);
    if (entryTypes.length > 0) {
        console.log(`\n  By Entry Type:`);
        for (const [type, data] of entryTypes) {
            const winRate = (data.winRate * 100).toFixed(0);
            console.log(`    ${padRight(type, 28)} ${String(data.count).padStart(3)} trades  ${winRate.padStart(3)}% win  ${formatPnl(data.pnl).padStart(10)}`);
        }
    }

    // By exit reason
    const exitReasons = Object.entries(summary.byExitReason);
    if (exitReasons.length > 0) {
        console.log(`\n  By Exit Reason:`);
        for (const [reason, data] of exitReasons) {
            console.log(`    ${padRight(reason, 28)} ${String(data.count).padStart(3)}  ${formatPnl(data.pnl).padStart(10)}`);
        }
    }

    console.log(`\n${"=".repeat(60)}\n`);
}

async function main() {
    const args = parseArgs(process.argv);

    // Validate required args
    if (!args.instrument || !args.from || !args.to) {
        console.error("Error: Missing required arguments.");
        printUsage();
        process.exit(1);
    }

    const instrument = args.instrument;
    const fromDate = args.from;
    const toDate = args.to;
    const granularity = args.granularity || "M15";

    // Convert dates to UNIX timestamps (seconds)
    const fromTimestamp = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(toDate).getTime() / 1000);

    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        console.error("Error: Invalid date format. Use YYYY-MM-DD.");
        process.exit(1);
    }

    if (fromTimestamp >= toTimestamp) {
        console.error("Error: 'from' date must be before 'to' date.");
        process.exit(1);
    }

    // Build config overrides from CLI args
    const configOverrides = {};
    if (args.minAdx) configOverrides.minAdx = parseFloat(args.minAdx);
    if (args.spreadPips) configOverrides.spreadPips = parseFloat(args.spreadPips);
    if (args.initialBalance) configOverrides.initialBalance = parseFloat(args.initialBalance);
    if (args.enableShorting !== undefined) configOverrides.enableShorting = args.enableShorting === "true";
    if (args.maxOpenPositions) configOverrides.maxOpenPositions = parseInt(args.maxOpenPositions, 10);
    if (args.leverage) configOverrides.leverage = parseFloat(args.leverage);
    if (args.stopLossType) configOverrides.stopLossType = args.stopLossType.toUpperCase();
    if (args.stopLossPips) configOverrides.stopLossPips = parseFloat(args.stopLossPips);
    if (args.stopLossAtrMultiplier) configOverrides.stopLossAtrMultiplier = parseFloat(args.stopLossAtrMultiplier);
    if (args.minStopLossPips) configOverrides.minStopLossPips = parseFloat(args.minStopLossPips);
    if (args.enableTrailingStops !== undefined) configOverrides.enableTrailingStops = args.enableTrailingStops === "true";
    if (args.enableTakeProfit !== undefined) configOverrides.enableTakeProfit = args.enableTakeProfit === "true";
    if (args.takeProfitPercent) configOverrides.takeProfitPercent = parseFloat(args.takeProfitPercent);
    if (args.trailingStopPips) configOverrides.trailingStopPips = parseFloat(args.trailingStopPips);
    if (args.trailingStopActivationPips) configOverrides.trailingStopActivationPips = parseFloat(args.trailingStopActivationPips);
    if (args.enableBreakeven !== undefined) configOverrides.enableBreakeven = args.enableBreakeven === "true";
    if (args.breakevenTriggerPips) configOverrides.breakevenTriggerPips = parseFloat(args.breakevenTriggerPips);
    if (args.enableHTFFilter !== undefined) configOverrides.enableHTFFilter = args.enableHTFFilter === "true";
    if (args.htfFilter) configOverrides.enableHTFFilter = true;
    if (args.multiTF) configOverrides.enableMultiTimeframe = true;

    const modeLabel = configOverrides.enableMultiTimeframe ? `Multi-TF(M15→H1)` : granularity;
    console.log(`\nBacktest: ${instrument} ${modeLabel} | ${fromDate} to ${toDate}`);
    console.log("Fetching historical data...");

    // Create services and run backtest
    const historicalDataService = new HistoricalDataService();
    const engine = new BacktestEngine(historicalDataService);

    const result = await engine.run(instrument, granularity, fromTimestamp, toTimestamp, configOverrides);

    console.log(`Running backtest on ${result.equityCurve.length.toLocaleString()} candles...`);

    // Print results
    printResults(result, instrument, modeLabel, fromDate, toDate);

    // Save to database if requested
    if (args.save) {
        const BacktestRepository = require(path.join(backendDir, "src/repositories/backtestRepository"));
        const backtestRepo = new BacktestRepository();

        const backtestId = await backtestRepo.save(
            result, instrument, granularity, fromTimestamp, toTimestamp, args.label || null
        );
        console.log(`Result saved to database. ID: ${backtestId}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Backtest failed:", err.message);
        process.exit(1);
    });
