// scripts/backtestSweep.js - Parameter sweep runner for classic and
// undertrading-recovery walk-forward studies.
//
// Usage: node scripts/backtestSweep.js [options]
//   --mode classic|undertrading   Select sweep mode (default: classic)
//   --walkForward                 Alias for --mode undertrading
//   --save                        Save each run to the database as it completes
//   --includeH1                   Also run H1 granularity (doubles runs)
//   --instruments X,Y             Override instrument list (comma-separated)
//   --from YYYY-MM-DD             Override start date
//   --to YYYY-MM-DD               Override end date
//   --scenario "Name"             Run only one named scenario
//   --maxScenarios N              Cap scenarios after filtering
//   --quiet                       Suppress per-run progress, only show summaries

const path = require("path");

// Resolve backend directory so require() finds backend/node_modules
const backendDir = path.join(__dirname, "../backend");
module.paths.unshift(path.join(backendDir, "node_modules"));

// Load .env from backend directory (required for Oanda API key)
require("dotenv").config({ path: path.join(backendDir, ".env") });

const HistoricalDataService = require(
    path.join(backendDir, "src/services/historicalDataService")
);
const BacktestEngine = require(
    path.join(backendDir, "src/services/backtestEngine")
);

// === SWEEP CONFIGURATION ===

const DAY_SECONDS = 24 * 60 * 60;
const CLASSIC_DEFAULT_DAYS = 210;
const UNDERTRADING_HISTORY_DAYS = 180;
const WALK_FORWARD_TRAIN_DAYS = 90;
const WALK_FORWARD_VALIDATION_DAYS = 30;
const WALK_FORWARD_STEP_DAYS = 30;
const WALK_FORWARD_PRINT_LIMIT = 20;

const INSTRUMENTS = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"];
const GRANULARITIES = ["M15"];

function formatDate(date) {
    return date.toISOString().slice(0, 10);
}

function getDefaultDateRange(daysBack) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - daysBack);
    return {
        from: formatDate(start),
        to: formatDate(end),
    };
}

const CLASSIC_DEFAULT_RANGE = getDefaultDateRange(CLASSIC_DEFAULT_DAYS);
const UNDERTRADING_DEFAULT_RANGE = getDefaultDateRange(
    UNDERTRADING_HISTORY_DAYS
);

const CLASSIC_SCENARIOS = [
    { name: "Baseline", overrides: {} },
    { name: "No shorts", overrides: { enableShorting: false } },
    { name: "ADX 25", overrides: { minAdx: 25 } },
    { name: "ADX 28", overrides: { minAdx: 28 } },
    {
        name: "No continuations",
        overrides: { enableContinuationEntry: false },
    },
    { name: "No ADX slope", overrides: { adxSlopeFilter: false } },
    { name: "TP off", overrides: { enableTakeProfit: false } },
    { name: "SL 1.0x ATR", overrides: { stopLossAtrMultiplier: 1.0 } },
    { name: "SL 1.5x ATR", overrides: { stopLossAtrMultiplier: 1.5 } },
    { name: "SL 2.5x ATR", overrides: { stopLossAtrMultiplier: 2.5 } },
    { name: "SL 3.0x ATR", overrides: { stopLossAtrMultiplier: 3.0 } },
    {
        name: "Trail 15/10",
        overrides: {
            trailingStopPips: 15,
            trailingStopActivationPips: 10,
        },
    },
    {
        name: "Trail 20/15",
        overrides: {
            trailingStopPips: 20,
            trailingStopActivationPips: 15,
        },
    },
    {
        name: "Trail 30/25",
        overrides: {
            trailingStopPips: 30,
            trailingStopActivationPips: 25,
        },
    },
    {
        name: "Trail 35/30",
        overrides: {
            trailingStopPips: 35,
            trailingStopActivationPips: 30,
        },
    },
    {
        name: "NoShort+ADX25",
        overrides: { enableShorting: false, minAdx: 25 },
    },
    {
        name: "NoShort+TightSL",
        overrides: { enableShorting: false, stopLossAtrMultiplier: 1.5 },
    },
    {
        name: "NoShort+WideTrail",
        overrides: {
            enableShorting: false,
            trailingStopPips: 30,
            trailingStopActivationPips: 25,
        },
    },
    {
        name: "TPoff+WideTrail",
        overrides: {
            enableTakeProfit: false,
            trailingStopPips: 30,
            trailingStopActivationPips: 25,
        },
    },
    {
        name: "NoShort+NoCont",
        overrides: {
            enableShorting: false,
            enableContinuationEntry: false,
        },
    },
    {
        name: "ADX25+NoCont",
        overrides: { minAdx: 25, enableContinuationEntry: false },
    },
    {
        name: "KitchenSink",
        overrides: {
            enableShorting: false,
            minAdx: 25,
            enableContinuationEntry: false,
            enableTakeProfit: false,
            trailingStopPips: 30,
            trailingStopActivationPips: 25,
        },
    },
    {
        name: "HTF Filter",
        overrides: { enableHTFFilter: true, htfTimeframe: "H4" },
        needsHTF: true,
    },
    {
        name: "HTF+NoShorts",
        overrides: {
            enableHTFFilter: true,
            htfTimeframe: "H4",
            enableShorting: false,
        },
        needsHTF: true,
    },
    {
        name: "HTF+NoCont",
        overrides: {
            enableHTFFilter: true,
            htfTimeframe: "H4",
            enableContinuationEntry: false,
        },
        needsHTF: true,
    },
    {
        name: "HTF+NoCont+NoShort",
        overrides: {
            enableHTFFilter: true,
            htfTimeframe: "H4",
            enableContinuationEntry: false,
            enableShorting: false,
        },
        needsHTF: true,
    },
    {
        name: "HTF+ADX25",
        overrides: {
            enableHTFFilter: true,
            htfTimeframe: "H4",
            minAdx: 25,
        },
        needsHTF: true,
    },
    { name: "MultiTF", overrides: { enableMultiTimeframe: true } },
    {
        name: "MultiTF+NoCont",
        overrides: {
            enableMultiTimeframe: true,
            enableContinuationEntry: false,
        },
    },
    {
        name: "MultiTF+NoShort",
        overrides: { enableMultiTimeframe: true, enableShorting: false },
    },
    {
        name: "MultiTF+HTF",
        overrides: {
            enableMultiTimeframe: true,
            enableHTFFilter: true,
            htfTimeframe: "H4",
        },
        needsHTF: true,
    },
    {
        name: "MultiTF+HTF+NoCont",
        overrides: {
            enableMultiTimeframe: true,
            enableHTFFilter: true,
            htfTimeframe: "H4",
            enableContinuationEntry: false,
        },
        needsHTF: true,
    },
];

const UNDERTRADING_MATRIX = {
    minAdx: [18, 21, 24],
    adxSlopeFilter: [true, false],
    shortRsiMomentumCeiling: [48, 50, 52],
    freshLongRsiCeiling: [65, 68, 70],
    enableLongContinuationEntry: [true, false],
    enableShortContinuationEntry: [true, false],
    stopLossAtrMultiplier: [1.5, 2.0, 2.5],
    maxSpreadPips: [1.0, 1.2, 1.5],
    freshFlipRiskMultiplier: [0.5, 0.75, 1.0],
};

function cartesianScenarios(matrix) {
    const entries = Object.entries(matrix);
    const scenarios = [];

    const recurse = (index, current) => {
        if (index >= entries.length) {
            const name = [
                `ADX${current.minAdx}`,
                current.adxSlopeFilter ? "SlopeOn" : "SlopeOff",
                `ShortCeil${current.shortRsiMomentumCeiling}`,
                `FreshLong${current.freshLongRsiCeiling}`,
                current.enableLongContinuationEntry
                    ? "LongContOn"
                    : "LongContOff",
                current.enableShortContinuationEntry
                    ? "ShortContOn"
                    : "ShortContOff",
                `SL${current.stopLossAtrMultiplier.toFixed(1)}x`,
                `Spread${current.maxSpreadPips.toFixed(1)}`,
                `FreshRisk${current.freshFlipRiskMultiplier.toFixed(2)}`,
            ].join("|");

            scenarios.push({
                name,
                overrides: {
                    ...current,
                    simulateLiveEntryFilters: true,
                },
            });
            return;
        }

        const [key, values] = entries[index];
        for (const value of values) {
            recurse(index + 1, {
                ...current,
                [key]: value,
            });
        }
    };

    recurse(0, {});
    return scenarios;
}

const UNDERTRADING_SCENARIOS = [
    {
        name: "Baseline",
        overrides: {
            simulateLiveEntryFilters: true,
        },
    },
    ...cartesianScenarios(UNDERTRADING_MATRIX),
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

function resolveMode(args) {
    if (args.walkForward || args.mode === "undertrading") {
        return "undertrading";
    }

    return args.mode === "classic" || !args.mode ? "classic" : args.mode;
}

function getScenarioCatalog(mode) {
    return mode === "undertrading"
        ? UNDERTRADING_SCENARIOS
        : CLASSIC_SCENARIOS;
}

function resolveDateRange(mode, args) {
    const defaults =
        mode === "undertrading"
            ? UNDERTRADING_DEFAULT_RANGE
            : CLASSIC_DEFAULT_RANGE;

    return {
        fromDate: args.from || defaults.from,
        toDate: args.to || defaults.to,
        defaults,
    };
}

function parsePositiveInteger(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : fallback;
}

function printUsage() {
    console.log(`
Usage: node scripts/backtestSweep.js [options]

Options:
  --mode classic|undertrading   Sweep mode (default: classic)
  --walkForward                 Alias for --mode undertrading
  --save                        Save each run to the database while executing
  --includeH1                   Also run H1 granularity (doubles runs)
  --instruments X,Y             Override instrument list (comma-separated)
  --from YYYY-MM-DD             Override start date
  --to YYYY-MM-DD               Override end date
  --scenario "Name"             Run only one named scenario
  --maxScenarios N              Cap scenarios after filtering
  --quiet                       Suppress per-run progress, only show summaries

Classic mode:
  Default range: ${CLASSIC_DEFAULT_RANGE.from} to ${CLASSIC_DEFAULT_RANGE.to}
  Scenarios: ${CLASSIC_SCENARIOS.length}

Undertrading mode:
  Default range: ${UNDERTRADING_DEFAULT_RANGE.from} to ${UNDERTRADING_DEFAULT_RANGE.to}
  Uses latest ${UNDERTRADING_HISTORY_DAYS}d, then rolling ${WALK_FORWARD_TRAIN_DAYS}d train / ${WALK_FORWARD_VALIDATION_DAYS}d validation windows every ${WALK_FORWARD_STEP_DAYS}d.
  Scenarios: ${UNDERTRADING_SCENARIOS.length}

Examples:
  node scripts/backtestSweep.js
  node scripts/backtestSweep.js --mode classic --save
  node scripts/backtestSweep.js --mode classic --scenario "No shorts" --instruments AUD_USD
  node scripts/backtestSweep.js --mode undertrading --scenario Baseline --quiet
  node scripts/backtestSweep.js --walkForward --maxScenarios 25
`);
}

// === FORMATTING HELPERS ===

function formatPnl(value) {
    const numeric = Number(value) || 0;
    const sign = numeric >= 0 ? "+" : "";
    return `${sign}$${numeric.toFixed(2)}`;
}

function formatPercent(value) {
    const numeric = Number(value) || 0;
    const sign = numeric >= 0 ? "+" : "";
    return `${sign}${numeric.toFixed(1)}%`;
}

function formatRatio(value, digits = 2) {
    if (value === Infinity) return "Inf";
    if (value === -Infinity) return "-Inf";
    if (!Number.isFinite(value)) return "n/a";
    return Number(value).toFixed(digits);
}

function formatWindowLabel(window) {
    return `W${window.index} ${formatDate(
        new Date(window.trainStart * 1000)
    )}->${formatDate(new Date(window.trainEnd * 1000))} | ${formatDate(
        new Date(window.validationStart * 1000)
    )}->${formatDate(new Date(window.validationEnd * 1000))}`;
}

function truncateScenario(name, max = 40) {
    if (name.length <= max) return name;
    return `${name.slice(0, max - 1)}…`;
}

// === TABLE RENDERER ===

function printTable(title, headers, rows, alignRight = []) {
    if (rows.length === 0) {
        console.log(`\n${title}\n  (no data)\n`);
        return;
    }

    const widths = headers.map((h, i) => {
        const dataMax = rows.reduce(
            (max, row) => Math.max(max, String(row[i]).length),
            0
        );
        return Math.max(h.length, dataMax);
    });

    const separator =
        "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";

    console.log(`\n${title}`);
    console.log(separator);

    const headerLine = headers
        .map((h, i) => ` ${h.padEnd(widths[i])} `)
        .join("|");
    console.log(`|${headerLine}|`);
    console.log(separator);

    for (const row of rows) {
        const line = row
            .map((cell, i) => {
                const str = String(cell);
                if (alignRight.includes(i)) {
                    return ` ${str.padStart(widths[i])} `;
                }
                return ` ${str.padEnd(widths[i])} `;
            })
            .join("|");
        console.log(`|${line}|`);
    }

    console.log(separator);
}

// === DATA FETCHING ===

async function fetchAllData(
    instruments,
    granularities,
    fromTimestamp,
    toTimestamp,
    needsHTF
) {
    const historicalDataService = new HistoricalDataService();
    const candleData = {};

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
                instrument,
                granularity,
                fromTimestamp,
                toTimestamp
            );
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(
                ` ${candleData[key].length.toLocaleString()} candles (${elapsed}s)`
            );
        }
    }

    return candleData;
}

function sliceCandles(candles, fromTimestamp, toTimestamp) {
    if (!Array.isArray(candles)) {
        return [];
    }

    return candles.filter((candle) => {
        const time = Number(candle.time);
        return time >= fromTimestamp && time < toTimestamp;
    });
}

function buildWalkForwardPlan(
    fromTimestamp,
    toTimestamp,
    {
        historyDays = UNDERTRADING_HISTORY_DAYS,
        trainDays = WALK_FORWARD_TRAIN_DAYS,
        validationDays = WALK_FORWARD_VALIDATION_DAYS,
        stepDays = WALK_FORWARD_STEP_DAYS,
    } = {}
) {
    const effectiveFrom = Math.max(
        fromTimestamp,
        toTimestamp - historyDays * DAY_SECONDS
    );
    const trainSeconds = trainDays * DAY_SECONDS;
    const validationSeconds = validationDays * DAY_SECONDS;
    const stepSeconds = stepDays * DAY_SECONDS;

    const windows = [];
    let validationStart = effectiveFrom + trainSeconds;
    let index = 1;

    while (validationStart + validationSeconds <= toTimestamp) {
        windows.push({
            index,
            trainStart: validationStart - trainSeconds,
            trainEnd: validationStart,
            validationStart,
            validationEnd: validationStart + validationSeconds,
        });
        validationStart += stepSeconds;
        index++;
    }

    return {
        effectiveFrom,
        effectiveTo: toTimestamp,
        historyDays,
        trainDays,
        validationDays,
        stepDays,
        windows,
    };
}

function compactBacktestResult(result) {
    return {
        trades: Array.isArray(result?.trades) ? result.trades : [],
        summary: result?.summary || {},
        config: result?.config || {},
    };
}

async function createSaveRunHandler(enabled) {
    if (!enabled) {
        return {
            saveRun: null,
            getCount: () => 0,
        };
    }

    const BacktestRepository = require(
        path.join(backendDir, "src/repositories/backtestRepository")
    );
    const backtestRepo = new BacktestRepository();
    let saved = 0;

    return {
        saveRun: async ({
            result,
            scenario,
            instrument,
            granularity,
            phase = null,
            windowIndex = null,
            periodFrom,
            periodTo,
        }) => {
            const suffix = phase
                ? ` | ${phase.toUpperCase()}${windowIndex ? ` W${windowIndex}` : ""}`
                : "";
            const label = `Sweep: ${scenario} | ${instrument} ${granularity}${suffix}`;
            await backtestRepo.save(
                result,
                instrument,
                granularity,
                periodFrom,
                periodTo,
                label
            );
            saved++;
        },
        getCount: () => saved,
    };
}

// === SWEEP EXECUTION ===

async function runClassicSweep(
    candleData,
    instruments,
    granularities,
    scenarios,
    quiet,
    saveRun = null
) {
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
                    process.stdout.write(
                        `\r  [${completed}/${totalRuns}] ${scenario.name} | ${instrument} ${granularity}          `
                    );
                }

                const htfCandles = scenario.needsHTF
                    ? candleData[`${instrument}_H4`] || null
                    : null;
                const result = engine.runOnCandles(
                    candles,
                    instrument,
                    scenario.overrides,
                    htfCandles
                );

                if (saveRun) {
                    await saveRun({
                        result,
                        scenario: scenario.name,
                        instrument,
                        granularity,
                        periodFrom: candles[0]?.time || 0,
                        periodTo:
                            candles[candles.length - 1]?.time ||
                            candles[0]?.time ||
                            0,
                    });
                }

                results.push({
                    scenario: scenario.name,
                    instrument,
                    granularity,
                    overrides: scenario.overrides,
                    summary: result.summary,
                    fullResult: compactBacktestResult(result),
                });
            }
        }
    }

    if (!quiet) {
        process.stdout.write(`\r${" ".repeat(90)}\r`);
    }

    return results;
}

async function runWalkForwardSweep(
    candleData,
    instruments,
    granularities,
    scenarios,
    windows,
    quiet,
    saveRun = null
) {
    const engine = new BacktestEngine();
    const results = [];
    const totalRuns =
        instruments.length *
        granularities.length *
        scenarios.length *
        windows.length *
        2;
    let completed = 0;

    for (const granularity of granularities) {
        for (const scenario of scenarios) {
            for (const instrument of instruments) {
                const candles = candleData[`${instrument}_${granularity}`];
                const allHtfCandles = scenario.needsHTF
                    ? candleData[`${instrument}_H4`] || null
                    : null;

                for (const window of windows) {
                    const phases = [
                        {
                            phase: "train",
                            periodFrom: window.trainStart,
                            periodTo: window.trainEnd,
                        },
                        {
                            phase: "validation",
                            periodFrom: window.validationStart,
                            periodTo: window.validationEnd,
                        },
                    ];

                    for (const phaseConfig of phases) {
                        completed++;
                        if (!quiet) {
                            process.stdout.write(
                                `\r  [${completed}/${totalRuns}] ${scenario.name} | ${instrument} ${granularity} | ${phaseConfig.phase} W${window.index}          `
                            );
                        }

                        const phaseCandles = sliceCandles(
                            candles,
                            phaseConfig.periodFrom,
                            phaseConfig.periodTo
                        );
                        const htfCandles = Array.isArray(allHtfCandles)
                            ? sliceCandles(
                                  allHtfCandles,
                                  phaseConfig.periodFrom,
                                  phaseConfig.periodTo
                              )
                            : null;
                        const result = engine.runOnCandles(
                            phaseCandles,
                            instrument,
                            scenario.overrides,
                            htfCandles
                        );

                        if (saveRun) {
                            await saveRun({
                                result,
                                scenario: scenario.name,
                                instrument,
                                granularity,
                                phase: phaseConfig.phase,
                                windowIndex: window.index,
                                periodFrom: phaseConfig.periodFrom,
                                periodTo: phaseConfig.periodTo,
                            });
                        }

                        results.push({
                            scenario: scenario.name,
                            instrument,
                            granularity,
                            overrides: scenario.overrides,
                            windowIndex: window.index,
                            window,
                            phase: phaseConfig.phase,
                            periodFrom: phaseConfig.periodFrom,
                            periodTo: phaseConfig.periodTo,
                            summary: result.summary,
                            fullResult: compactBacktestResult(result),
                        });
                    }
                }
            }
        }
    }

    if (!quiet) {
        process.stdout.write(`\r${" ".repeat(110)}\r`);
    }

    return results;
}

// === CLASSIC AGGREGATION ===

function aggregateByScenario(results) {
    const grouped = {};

    for (const r of results) {
        const key = `${r.scenario}_${r.granularity}`;
        if (!grouped[key]) {
            grouped[key] = {
                scenario: r.scenario,
                granularity: r.granularity,
                runs: [],
            };
        }
        grouped[key].runs.push(r.summary);
    }

    return Object.values(grouped).map((group) => {
        const runs = group.runs;
        const n = runs.length;
        return {
            scenario: group.scenario,
            granularity: group.granularity,
            instrumentCount: n,
            totalTrades: runs.reduce((sum, r) => sum + r.totalTrades, 0),
            avgWinRate: runs.reduce((sum, r) => sum + r.winRate, 0) / n,
            totalPnl: runs.reduce((sum, r) => sum + r.totalPnl, 0),
            avgProfitFactor:
                runs.reduce(
                    (sum, r) =>
                        sum + (r.profitFactor === Infinity ? 10 : r.profitFactor),
                    0
                ) / n,
            avgMaxDrawdown:
                runs.reduce((sum, r) => sum + r.maxDrawdownPercent, 0) / n,
            avgExpectancy: runs.reduce((sum, r) => sum + r.expectancy, 0) / n,
            avgReturnPercent:
                runs.reduce((sum, r) => sum + r.returnPercent, 0) / n,
        };
    });
}

function getBaselineByInstrument(results) {
    return results
        .filter((r) => r.scenario === "Baseline")
        .map((r) => ({
            instrument: r.instrument,
            granularity: r.granularity,
            ...r.summary,
        }));
}

// === WALK-FORWARD AGGREGATION ===

function buildDateKeys(fromTimestamp, toTimestamp) {
    const keys = [];
    let cursor = new Date(fromTimestamp * 1000);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(Math.max(fromTimestamp, toTimestamp - 1) * 1000);
    end.setUTCHours(0, 0, 0, 0);

    while (cursor <= end) {
        keys.push(cursor.toISOString().slice(0, 10));
        cursor = new Date(cursor.getTime() + DAY_SECONDS * 1000);
    }

    return keys;
}

function calculateDailySharpe(runs, initialBalanceTotal) {
    if (!Number.isFinite(initialBalanceTotal) || initialBalanceTotal <= 0) {
        return 0;
    }

    const dailyPnl = new Map();
    const dayKeys = new Set();

    for (const run of runs) {
        for (const key of buildDateKeys(run.periodFrom, run.periodTo)) {
            dayKeys.add(key);
        }

        for (const trade of run.fullResult?.trades || []) {
            const exitTimestamp = Number(trade.exitTime || trade.entryTime);
            if (!Number.isFinite(exitTimestamp)) {
                continue;
            }

            const dayKey = new Date(exitTimestamp * 1000)
                .toISOString()
                .slice(0, 10);
            dailyPnl.set(
                dayKey,
                (dailyPnl.get(dayKey) || 0) + (Number(trade.pnlNet) || 0)
            );
        }
    }

    const returns = Array.from(dayKeys)
        .sort()
        .map((dayKey) => (dailyPnl.get(dayKey) || 0) / initialBalanceTotal);

    if (returns.length === 0) {
        return 0;
    }

    const mean =
        returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance =
        returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) {
        if (mean > 0) return Infinity;
        if (mean < 0) return -Infinity;
        return 0;
    }

    return (mean / stdDev) * Math.sqrt(252);
}

function aggregateWalkForwardRuns(runs) {
    const trades = [];
    const byEntryType = {};
    let initialBalanceTotal = 0;

    for (const run of runs) {
        initialBalanceTotal += Number(run.fullResult?.config?.initialBalance) || 0;
        for (const trade of run.fullResult?.trades || []) {
            const enrichedTrade = {
                ...trade,
                instrument: run.instrument,
                granularity: run.granularity,
                windowIndex: run.windowIndex,
            };
            trades.push(enrichedTrade);

            const entryType = enrichedTrade.entryType || "UNKNOWN";
            if (!byEntryType[entryType]) {
                byEntryType[entryType] = { count: 0, pnl: 0 };
            }
            byEntryType[entryType].count++;
            byEntryType[entryType].pnl += Number(enrichedTrade.pnlNet) || 0;
        }
    }

    const totalPnl = trades.reduce(
        (sum, trade) => sum + (Number(trade.pnlNet) || 0),
        0
    );
    const winners = trades.filter((trade) => (Number(trade.pnlNet) || 0) > 0);
    const losers = trades.filter((trade) => (Number(trade.pnlNet) || 0) <= 0);
    const grossProfit = winners.reduce(
        (sum, trade) => sum + (Number(trade.pnlNet) || 0),
        0
    );
    const grossLoss = Math.abs(
        losers.reduce((sum, trade) => sum + (Number(trade.pnlNet) || 0), 0)
    );
    const profitFactor =
        grossLoss > 0
            ? grossProfit / grossLoss
            : grossProfit > 0
            ? Infinity
            : 0;
    const expectancy = trades.length > 0 ? totalPnl / trades.length : 0;
    const longTrades = trades.filter((trade) => trade.side === "BUY").length;
    const shortTrades = trades.filter((trade) => trade.side === "SELL").length;

    let equity = initialBalanceTotal;
    let peak = initialBalanceTotal;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;

    const equityEvents = [...trades].sort((a, b) => {
        const aTime = Number(a.exitTime || a.entryTime || 0);
        const bTime = Number(b.exitTime || b.entryTime || 0);
        return aTime - bTime;
    });

    for (const trade of equityEvents) {
        equity += Number(trade.pnlNet) || 0;
        if (equity > peak) {
            peak = equity;
        }
        const drawdown = peak - equity;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
            maxDrawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
        }
    }

    return {
        runCount: runs.length,
        totalTrades: trades.length,
        executableEntries: trades.length,
        winners: winners.length,
        losers: losers.length,
        winRate: trades.length > 0 ? winners.length / trades.length : 0,
        totalPnl,
        profitFactor,
        expectancy,
        startBalance: initialBalanceTotal,
        endBalance: initialBalanceTotal + totalPnl,
        returnPercent:
            initialBalanceTotal > 0
                ? (totalPnl / initialBalanceTotal) * 100
                : 0,
        maxDrawdown,
        maxDrawdownPercent,
        longTrades,
        shortTrades,
        sharpe: calculateDailySharpe(runs, initialBalanceTotal),
        byEntryType,
    };
}

function aggregateWalkForwardByScenario(results) {
    const grouped = new Map();

    for (const result of results) {
        const key = `${result.scenario}_${result.granularity}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                scenario: result.scenario,
                granularity: result.granularity,
                overrides: result.overrides,
                trainRuns: [],
                validationRuns: [],
            });
        }

        const group = grouped.get(key);
        if (result.phase === "train") {
            group.trainRuns.push(result);
        } else {
            group.validationRuns.push(result);
        }
    }

    return Array.from(grouped.values()).map((group) => ({
        scenario: group.scenario,
        granularity: group.granularity,
        overrides: group.overrides,
        train: aggregateWalkForwardRuns(group.trainRuns),
        validation: aggregateWalkForwardRuns(group.validationRuns),
    }));
}

function compareRankValue(a, b) {
    const aValue =
        a === Infinity ? Number.MAX_SAFE_INTEGER : a === -Infinity ? -Number.MAX_SAFE_INTEGER : a;
    const bValue =
        b === Infinity ? Number.MAX_SAFE_INTEGER : b === -Infinity ? -Number.MAX_SAFE_INTEGER : b;
    return bValue - aValue;
}

function evaluatePromotionCandidates(aggregated) {
    const baselinesByGranularity = new Map(
        aggregated
            .filter((result) => result.scenario === "Baseline")
            .map((result) => [result.granularity, result])
    );

    const evaluated = aggregated.map((result) => {
        const baseline =
            baselinesByGranularity.get(result.granularity) || null;
        const baselineValidation = baseline?.validation || null;
        const baselineTrades = baselineValidation?.executableEntries || 0;
        const baselineShortTrades = baselineValidation?.shortTrades || 0;
        const baselineDrawdown = baselineValidation?.maxDrawdownPercent || 0;
        const drawdownLimit =
            baselineDrawdown > 0 ? baselineDrawdown * 1.1 : 1.0;

        const gates = {
            positivePnl: result.validation.totalPnl > 0,
            profitFactor: result.validation.profitFactor >= 1.2,
            sharpe: result.validation.sharpe > 0,
            drawdown: result.validation.maxDrawdownPercent <= drawdownLimit,
            executableEntries:
                result.validation.executableEntries >= baselineTrades * 1.5,
            shortTrades:
                result.validation.shortTrades >= baselineShortTrades,
        };

        return {
            ...result,
            baseline,
            qualifies:
                result.scenario !== "Baseline" &&
                Object.values(gates).every(Boolean),
            gates,
            drawdownLimit,
        };
    });

    evaluated.sort((left, right) => {
        if (left.qualifies !== right.qualifies) {
            return Number(right.qualifies) - Number(left.qualifies);
        }
        if (right.validation.totalPnl !== left.validation.totalPnl) {
            return right.validation.totalPnl - left.validation.totalPnl;
        }
        const profitFactorDiff = compareRankValue(
            left.validation.profitFactor,
            right.validation.profitFactor
        );
        if (profitFactorDiff !== 0) {
            return profitFactorDiff;
        }
        const sharpeDiff = compareRankValue(
            left.validation.sharpe,
            right.validation.sharpe
        );
        if (sharpeDiff !== 0) {
            return sharpeDiff;
        }
        if (
            right.validation.executableEntries !==
            left.validation.executableEntries
        ) {
            return (
                right.validation.executableEntries -
                left.validation.executableEntries
            );
        }
        return (
            left.validation.maxDrawdownPercent -
            right.validation.maxDrawdownPercent
        );
    });

    return evaluated;
}

// === OUTPUT ===

function printScenarioSummary(aggregated) {
    const sorted = [...aggregated].sort((a, b) => b.totalPnl - a.totalPnl);

    const headers = [
        "Scenario",
        "Gran",
        "Pairs",
        "Trades",
        "AvgWin%",
        "TotalP&L",
        "AvgPF",
        "AvgDD%",
        "AvgRet%",
    ];
    const rows = sorted.map((result) => [
        result.scenario,
        result.granularity,
        result.instrumentCount,
        result.totalTrades,
        `${(result.avgWinRate * 100).toFixed(1)}%`,
        formatPnl(result.totalPnl),
        result.avgProfitFactor.toFixed(2),
        `${result.avgMaxDrawdown.toFixed(1)}%`,
        formatPercent(result.avgReturnPercent),
    ]);

    printTable(
        "SCENARIO SUMMARY (aggregated across instruments, sorted by Total P&L)",
        headers,
        rows,
        [2, 3, 4, 5, 6, 7, 8]
    );
}

function printInstrumentComparison(instrumentResults) {
    const sorted = [...instrumentResults].sort((a, b) => b.totalPnl - a.totalPnl);

    const headers = [
        "Instrument",
        "Gran",
        "Trades",
        "Win%",
        "P&L",
        "PF",
        "MaxDD%",
        "Expect",
    ];
    const rows = sorted.map((result) => [
        result.instrument,
        result.granularity,
        result.totalTrades,
        `${(result.winRate * 100).toFixed(1)}%`,
        formatPnl(result.totalPnl),
        result.profitFactor === Infinity
            ? "Inf"
            : result.profitFactor.toFixed(2),
        `${result.maxDrawdownPercent.toFixed(1)}%`,
        formatPnl(result.expectancy),
    ]);

    printTable(
        "INSTRUMENT COMPARISON (Baseline scenario)",
        headers,
        rows,
        [2, 3, 4, 5, 6, 7]
    );
}

function printFullResults(results) {
    const sorted = [...results].sort(
        (a, b) => b.summary.totalPnl - a.summary.totalPnl
    );

    const headers = [
        "Scenario",
        "Instrument",
        "Gran",
        "Trades",
        "Win%",
        "P&L",
        "PF",
        "MaxDD%",
        "Expect",
    ];
    const rows = sorted.map((result) => [
        result.scenario.substring(0, 20),
        result.instrument,
        result.granularity,
        result.summary.totalTrades,
        `${(result.summary.winRate * 100).toFixed(1)}%`,
        formatPnl(result.summary.totalPnl),
        result.summary.profitFactor === Infinity
            ? "Inf"
            : result.summary.profitFactor.toFixed(2),
        `${result.summary.maxDrawdownPercent.toFixed(1)}%`,
        formatPnl(result.summary.expectancy),
    ]);

    printTable(
        "FULL RESULTS (all runs sorted by P&L)",
        headers,
        rows,
        [3, 4, 5, 6, 7, 8]
    );
}

function printHighlights(results) {
    const sorted = [...results].sort(
        (a, b) => b.summary.totalPnl - a.summary.totalPnl
    );

    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();

    console.log("\nBEST PERFORMERS:");
    top5.forEach((result, index) => {
        const summary = result.summary;
        console.log(
            `  ${index + 1}. ${result.instrument} | ${result.scenario} | ${result.granularity} -- P&L: ${formatPnl(
                summary.totalPnl
            )}, WR: ${(summary.winRate * 100).toFixed(1)}%, PF: ${
                summary.profitFactor === Infinity
                    ? "Inf"
                    : summary.profitFactor.toFixed(2)
            }, Trades: ${summary.totalTrades}`
        );
    });

    console.log("\nWORST PERFORMERS:");
    bottom5.forEach((result, index) => {
        const summary = result.summary;
        console.log(
            `  ${index + 1}. ${result.instrument} | ${result.scenario} | ${result.granularity} -- P&L: ${formatPnl(
                summary.totalPnl
            )}, WR: ${(summary.winRate * 100).toFixed(1)}%, PF: ${
                summary.profitFactor === Infinity
                    ? "Inf"
                    : summary.profitFactor.toFixed(2)
            }, Trades: ${summary.totalTrades}`
        );
    });

    console.log("");
}

function printWalkForwardPlan(plan) {
    console.log("Walk-forward windows:");
    for (const window of plan.windows) {
        console.log(`  ${formatWindowLabel(window)}`);
    }
    console.log("");
}

function printWalkForwardBaseline(baseline) {
    if (!baseline) {
        return;
    }

    console.log("Baseline validation target:");
    console.log(
        `  ${baseline.granularity} | entries=${baseline.validation.executableEntries} | shorts=${baseline.validation.shortTrades} | P&L=${formatPnl(
            baseline.validation.totalPnl
        )} | PF=${formatRatio(baseline.validation.profitFactor)} | Sharpe=${formatRatio(
            baseline.validation.sharpe
        )} | MaxDD=${baseline.validation.maxDrawdownPercent.toFixed(1)}%`
    );
    console.log("");
}

function printWalkForwardSummary(evaluated) {
    const baseline = evaluated.find((result) => result.scenario === "Baseline");
    const candidates = evaluated.filter((result) => result.scenario !== "Baseline");
    const topCandidates = candidates.slice(0, WALK_FORWARD_PRINT_LIMIT);

    if (candidates.length > WALK_FORWARD_PRINT_LIMIT) {
        console.log(
            `Showing top ${WALK_FORWARD_PRINT_LIMIT} of ${candidates.length} non-baseline scenarios ranked by promotion score.\n`
        );
    }

    printWalkForwardBaseline(baseline);

    const headers = [
        "Scenario",
        "Gran",
        "ValEnt",
        "Shorts",
        "ValP&L",
        "PF",
        "Sharpe",
        "MaxDD%",
        "Ret%",
        "Qualify",
    ];
    const rows = topCandidates.map((result) => [
        truncateScenario(result.scenario),
        result.granularity,
        result.validation.executableEntries,
        result.validation.shortTrades,
        formatPnl(result.validation.totalPnl),
        formatRatio(result.validation.profitFactor),
        formatRatio(result.validation.sharpe),
        result.validation.maxDrawdownPercent.toFixed(1) + "%",
        formatPercent(result.validation.returnPercent),
        result.qualifies ? "YES" : "no",
    ]);

    printTable(
        "UNDERTRADING WALK-FORWARD SUMMARY (validation windows)",
        headers,
        rows,
        [2, 3, 4, 5, 6, 7, 8, 9]
    );
}

function printPromotionOutcome(evaluated) {
    const bestQualified = evaluated.find((result) => result.qualifies) || null;
    const bestOverall = evaluated[0] || null;

    console.log("\nPROMOTION RESULT:");

    if (bestQualified) {
        const baseline = bestQualified.baseline;
        console.log(`  Promote: ${bestQualified.scenario} (${bestQualified.granularity})`);
        console.log(
            `  Validation: entries=${bestQualified.validation.executableEntries}, shorts=${bestQualified.validation.shortTrades}, P&L=${formatPnl(
                bestQualified.validation.totalPnl
            )}, PF=${formatRatio(bestQualified.validation.profitFactor)}, Sharpe=${formatRatio(
                bestQualified.validation.sharpe
            )}, MaxDD=${bestQualified.validation.maxDrawdownPercent.toFixed(
                1
            )}%`
        );
        if (baseline) {
            console.log(
                `  Versus baseline: delta entries=${
                    bestQualified.validation.executableEntries -
                    baseline.validation.executableEntries
                }, delta shorts=${
                    bestQualified.validation.shortTrades -
                    baseline.validation.shortTrades
                }, delta P&L=${formatPnl(
                    bestQualified.validation.totalPnl -
                        baseline.validation.totalPnl
                )}`
            );
        }
        return;
    }

    console.log(
        "  No scenario cleared every promotion gate. The top-ranked fallback is shown below for inspection."
    );
    if (bestOverall) {
        console.log(
            `  Best overall: ${bestOverall.scenario} (${bestOverall.granularity}) | P&L=${formatPnl(
                bestOverall.validation.totalPnl
            )} | PF=${formatRatio(bestOverall.validation.profitFactor)} | Sharpe=${formatRatio(
                bestOverall.validation.sharpe
            )} | Entries=${bestOverall.validation.executableEntries}`
        );
        console.log(
            `  Failed gates: ${Object.entries(bestOverall.gates)
                .filter(([, passed]) => !passed)
                .map(([gate]) => gate)
                .join(", ")}`
        );
    }
}

// === MAIN ===

async function main() {
    const args = parseArgs(process.argv);

    if (args.help) {
        printUsage();
        process.exit(0);
    }

    const mode = resolveMode(args);
    if (!["classic", "undertrading"].includes(mode)) {
        console.error(
            `Error: Unknown mode "${mode}". Use "classic" or "undertrading".`
        );
        process.exit(1);
    }

    const instruments = args.instruments
        ? args.instruments.split(",").map((value) => value.trim()).filter(Boolean)
        : INSTRUMENTS;
    const { fromDate, toDate } = resolveDateRange(mode, args);
    const granularities = args.includeH1 ? ["M15", "H1"] : GRANULARITIES;
    const scenarioFilter = args.scenario || null;
    const maxScenarios = parsePositiveInteger(args.maxScenarios);
    const quiet = !!args.quiet;

    const catalog = getScenarioCatalog(mode);
    let scenarios = scenarioFilter
        ? catalog.filter((scenario) => scenario.name === scenarioFilter)
        : [...catalog];

    if (maxScenarios) {
        scenarios = scenarios.slice(0, maxScenarios);
    }

    if (scenarios.length === 0) {
        console.error(`Error: Unknown scenario "${scenarioFilter}".`);
        console.error(`Available: ${catalog.map((scenario) => scenario.name).join(", ")}`);
        process.exit(1);
    }

    const fromTimestamp = Math.floor(new Date(fromDate).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(toDate).getTime() / 1000);

    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        console.error("Error: Invalid date format. Use YYYY-MM-DD.");
        process.exit(1);
    }

    if (fromTimestamp >= toTimestamp) {
        console.error("Error: --from must be earlier than --to.");
        process.exit(1);
    }

    let walkForwardPlan = null;
    let fetchFromTimestamp = fromTimestamp;
    if (mode === "undertrading") {
        walkForwardPlan = buildWalkForwardPlan(fromTimestamp, toTimestamp);
        if (walkForwardPlan.windows.length === 0) {
            console.error(
                `Error: Not enough history for walk-forward windows. Need at least ${
                    WALK_FORWARD_TRAIN_DAYS + WALK_FORWARD_VALIDATION_DAYS
                } days between --from and --to.`
            );
            process.exit(1);
        }
        fetchFromTimestamp = walkForwardPlan.effectiveFrom;
    }

    const totalRuns =
        mode === "undertrading"
            ? instruments.length *
              granularities.length *
              scenarios.length *
              walkForwardPlan.windows.length *
              2
            : instruments.length * granularities.length * scenarios.length;

    console.log(
        `\nBacktest Sweep (${mode}): ${scenarios.length} scenarios x ${instruments.length} instruments x ${granularities.length} granularities = ${totalRuns} runs`
    );
    console.log(`Requested range: ${fromDate} to ${toDate}`);
    if (mode === "undertrading") {
        console.log(
            `Effective history slice: ${formatDate(
                new Date(fetchFromTimestamp * 1000)
            )} to ${toDate}`
        );
        printWalkForwardPlan(walkForwardPlan);
    } else {
        console.log("");
    }

    const needsHTF = scenarios.some((scenario) => scenario.needsHTF);
    console.log("Phase 1: Fetching historical data...");
    const startFetch = Date.now();
    const candleData = await fetchAllData(
        instruments,
        granularities,
        fetchFromTimestamp,
        toTimestamp,
        needsHTF
    );
    const fetchTime = ((Date.now() - startFetch) / 1000).toFixed(1);
    console.log(`  Data fetch complete in ${fetchTime}s\n`);

    const { saveRun, getCount } = await createSaveRunHandler(!!args.save);
    if (args.save) {
        console.log("Phase 2: Running backtests and saving results...");
    } else {
        console.log("Phase 2: Running backtests...");
    }

    const startSweep = Date.now();
    const results =
        mode === "undertrading"
            ? await runWalkForwardSweep(
                  candleData,
                  instruments,
                  granularities,
                  scenarios,
                  walkForwardPlan.windows,
                  quiet,
                  saveRun
              )
            : await runClassicSweep(
                  candleData,
                  instruments,
                  granularities,
                  scenarios,
                  quiet,
                  saveRun
              );
    const sweepTime = ((Date.now() - startSweep) / 1000).toFixed(1);
    console.log(`  Sweep complete: ${results.length} run records in ${sweepTime}s\n`);

    console.log("Phase 3: Results");
    if (mode === "undertrading") {
        const aggregated = aggregateWalkForwardByScenario(results);
        const evaluated = evaluatePromotionCandidates(aggregated);
        printWalkForwardSummary(evaluated);
        printPromotionOutcome(evaluated);
    } else {
        printScenarioSummary(aggregateByScenario(results));
        printInstrumentComparison(getBaselineByInstrument(results));
        printFullResults(results);
        printHighlights(results);
    }

    if (args.save) {
        console.log(`\nSaved ${getCount()} backtest results to database.`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Sweep failed:", err.message);
        console.error(err.stack);
        process.exit(1);
    });
