#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const { MarketReplayEngine } = require("../src/replay/marketReplayEngine");
const { calculateReplayStatistics } = require("../src/replay/replayStatistics");
const createResearchStrategy = require("../src/replay/strategyFamilyResearch");

const DEFAULT_PERIODS = [
    { id: "development", from: "2020-01-01T00:00:00Z", to: "2024-12-31T23:59:59Z" },
    { id: "validation", from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z" },
    { id: "recent_holdout", from: "2026-01-01T00:00:00Z", to: "2026-08-03T00:00:00Z" },
];

const DEFAULT_VARIANTS = [
    {
        id: "session_expansion_v1",
        family: "session_expansion",
        config: {
            rangeStartHour: 0,
            rangeEndHour: 6,
            entryStartHour: 7,
            entryEndHour: 10,
            minimumRangeAtr: 0.75,
            maximumRangeAtr: 3,
            breakoutBufferAtr: 0.1,
            stopAtr: 1.5,
            stopRangeFraction: 0.5,
            minimumStopPips: 8,
            riskReward: 1.75,
            maxHoldingBars: 32,
        },
    },
    {
        id: "medium_term_trend_v1",
        family: "medium_term_trend",
        config: {
            fastBars: 192,
            slowBars: 768,
            breakoutBars: 384,
            stopAtr: 3,
            riskReward: 2.5,
            maxHoldingBars: 1920,
        },
    },
    {
        id: "pullback_continuation_v1",
        family: "pullback_continuation",
        config: {
            fastBars: 48,
            slowBars: 192,
            triggerBars: 20,
            stopAtr: 2,
            riskReward: 2,
            maxHoldingBars: 96,
        },
    },
    {
        id: "mean_reversion_v1",
        family: "mean_reversion",
        config: {
            lookbackBars: 96,
            entryZ: 2.25,
            maxTrendStd: 0.35,
            stopAtr: 1.5,
            minimumRiskReward: 1.2,
            maximumRiskReward: 2.5,
            maxHoldingBars: 32,
        },
    },
    {
        id: "cross_sectional_momentum_v1",
        family: "cross_sectional_momentum",
        config: {
            lookbackBars: 480,
            rebalanceHour: 0,
            minimumDispersionBps: 15,
            stopAtr: 3,
            riskReward: 2.5,
            maxHoldingBars: 480,
        },
    },
];

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) continue;
        const key = token.slice(2);
        const value = argv[index + 1];
        if (value && !value.startsWith("--")) {
            args[key] = value;
            index += 1;
        } else {
            args[key] = true;
        }
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function timestamp(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid period timestamp: ${value}`);
    return parsed;
}

function candleTimeMs(candle) {
    const value = Number(candle.time);
    return value > 1e12 ? value : value * 1000;
}

function sliceWithWarmup(candlesByInstrument, period, warmupBars) {
    const from = timestamp(period.from);
    const to = timestamp(period.to);
    const sliced = {};
    for (const [instrument, candles] of Object.entries(candlesByInstrument)) {
        const firstIndex = candles.findIndex((candle) => candleTimeMs(candle) >= from);
        const start = firstIndex < 0 ? candles.length : Math.max(0, firstIndex - warmupBars);
        sliced[instrument] = candles
            .slice(start)
            .filter((candle) => candleTimeMs(candle) <= to);
    }
    return { candlesByInstrument: sliced, from, to };
}

function summarizeFunnel(rows, limit = 20) {
    const totals = rows
        .filter((row) => !row.warmup)
        .reduce((totals, row) => {
            const key = row.reasonCode || row.signal || "UNKNOWN";
            totals.set(key, (totals.get(key) || 0) + row.count);
            return totals;
        }, new Map());
    return Array.from(totals.entries())
        .map(([reasonCode, count]) => ({ reasonCode, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, limit);
}

function assumptions(args, stress = false, variant = {}) {
    return {
        startingBalanceAud: Number(args.startingBalanceAud) || 10000,
        riskPerTrade: Number(args.riskPerTrade) || 0.005,
        maxCapitalAtRisk: Number(args.maxCapitalAtRisk) || 10000,
        maxOpenPositions: Number(args.maxOpenPositions) || 1,
        maxPortfolioExposure: Number(args.maxPortfolioExposure) || 0.2,
        leverage: 20,
        maxLeverage: 20,
        marginRate: 0.05,
        minStopLossPips: 5,
        slippagePips: stress ? 0.5 : 0.1,
        commissionAudPerMillion: stress ? 10 : 0,
        conservativeIntrabarOrdering: true,
        closeAtEnd: true,
        ...(variant.execution || {}),
    };
}

async function evaluateVariantPeriod(variant, period, dataset, args, stress) {
    const sliced = sliceWithWarmup(dataset, period, Number(args.warmupBars) || 2000);
    const engine = new MarketReplayEngine({
        strategy: createResearchStrategy(variant),
        config: assumptions(args, stress, variant),
    });
    const result = await engine.run(sliced.candlesByInstrument, {
        tradeFrom: sliced.from,
        tradeTo: sliced.to,
        captureDecisions: false,
    });
    const statistics = calculateReplayStatistics(result, {
        trialCount: Number(args.trialCount) || DEFAULT_VARIANTS.length,
        bootstrap: { samples: Number(args.bootstrapSamples) || 2000 },
    });
    return {
        period: period.id,
        from: period.from,
        to: period.to,
        stress,
        statistics,
        assumptions: result.assumptions,
        funnel: summarizeFunnel(result.decisionFunnel),
        tradesByInstrument: Object.entries(
            result.trades.reduce((totals, trade) => {
                const row = (totals[trade.instrument] ||= {
                    trades: 0,
                    netPnlAud: 0,
                    wins: 0,
                });
                row.trades += 1;
                row.netPnlAud += trade.netPnlAud;
                if (trade.netPnlAud > 0) row.wins += 1;
                return totals;
            }, {})
        ).map(([instrument, values]) => ({ instrument, ...values })),
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.data) throw new Error("Missing --data");
    const payload = readJson(args.data);
    const dataset = payload.candlesByInstrument || payload;
    const variants = args.variants ? readJson(args.variants) : DEFAULT_VARIANTS;
    const periods = args.periods ? readJson(args.periods) : DEFAULT_PERIODS;
    const stressModes = args.stress === "both" ? [false, true] : [args.stress === true || args.stress === "true"];
    const results = [];

    for (const variant of variants) {
        for (const period of periods) {
            for (const stress of stressModes) {
                process.stderr.write(`${variant.id} ${period.id}${stress ? " stress" : ""}\n`);
                results.push({
                    variant,
                    ...(await evaluateVariantPeriod(variant, period, dataset, args, stress)),
                });
            }
        }
    }

    const output = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        source: {
            data: path.resolve(args.data),
            pricingComponents: payload.pricingComponents || "unknown",
            granularity: payload.granularity || "unknown",
            completeCandlesOnly: payload.completeCandlesOnly === true,
        },
        variants,
        periods,
        results,
    };
    const serialized = JSON.stringify(output, null, 2);
    if (args.output) {
        const outputPath = path.resolve(args.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${serialized}\n`);
        process.stderr.write(`Wrote ${outputPath}\n`);
    } else {
        process.stdout.write(`${serialized}\n`);
    }
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
