#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
    MarketReplayEngine,
    WalkForwardValidator,
    appendExperiment,
    createProductionStrategyAdapter,
} = require("../src/replay");

const USAGE = `Usage: npm run replay -- --data candles.json [options]

Required:
  --data FILE                 Candle JSON (grouped by instrument or flat)

Research options:
  --variants FILE             Variant definitions (default: one baseline)
  --config FILE               Baseline production strategy configuration
  --split FILE                Walk-forward split configuration
  --criteria FILE             Eligibility criteria
  --strategyModule FILE       Custom strategy adapter module
  --registry FILE             Append the experiment and lineage to JSONL
  --output FILE               Write the result JSON instead of stdout

Execution options:
  --warmupBars NUMBER          Indicator warm-up bars (default: 250)
  --startingBalanceAud NUMBER  Starting balance in AUD (default: 10000)
  --spreadPips NUMBER          Synthetic spread (default: 1)
  --slippagePips NUMBER        Per-fill adverse slippage (default: 0)
  --help                       Show this help`;

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) continue;
        const [rawKey, inline] = token.slice(2).split("=", 2);
        if (inline !== undefined) args[rawKey] = inline;
        else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
            args[rawKey] = argv[index + 1];
            index += 1;
        } else args[rawKey] = true;
    }
    return args;
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function loadDataset(filePath) {
    const payload = readJson(filePath);
    if (Array.isArray(payload)) {
        const grouped = {};
        for (const candle of payload) {
            if (!candle.instrument) throw new Error("Flat candle data requires instrument");
            (grouped[candle.instrument] ||= []).push(candle);
        }
        return grouped;
    }
    return payload.candlesByInstrument || payload;
}

function codeRevision() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: path.join(__dirname, "../.."),
            encoding: "utf8",
        }).trim();
    } catch {
        return null;
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${USAGE}\n`);
        return;
    }
    if (!args.data) {
        throw new Error(`${USAGE}\n\nMissing required option: --data`);
    }
    const dataset = loadDataset(args.data);
    const variants = args.variants
        ? readJson(args.variants)
        : [{ id: "baseline", config: args.config ? readJson(args.config) : {} }];
    const split = args.split ? readJson(args.split) : {};
    const validator = new WalkForwardValidator({
        criteria: args.criteria ? readJson(args.criteria) : {},
        warmupBars: Number(args.warmupBars) || 250,
        engineFactory: async (variant) => {
            const strategy = args.strategyModule
                ? require(path.resolve(args.strategyModule))(variant)
                : createProductionStrategyAdapter(variant.config || variant, {
                    spreadPips: Number(args.spreadPips) || undefined,
                });
            return new MarketReplayEngine({
                strategy,
                config: {
                    ...(variant.execution || {}),
                    startingBalanceAud: Number(args.startingBalanceAud) || 10000,
                    defaultSpreadPips: Number(args.spreadPips) || 1,
                    slippagePips: Number(args.slippagePips) || 0,
                },
            });
        },
    });
    const result = await validator.run(dataset, variants, split);
    const output = JSON.stringify(result, null, 2);
    if (args.output) fs.writeFileSync(path.resolve(args.output), `${output}\n`);
    else process.stdout.write(`${output}\n`);

    if (args.registry) {
        appendExperiment(path.resolve(args.registry), {
            strategy: args.strategy || variants[0]?.config?.strategy || "unknown",
            hypothesis: args.hypothesis || null,
            datasetHash: result.datasetHash,
            variantSetHash: result.variantSetHash,
            variants,
            result,
            codeRevision: codeRevision(),
        });
    }
    if (!result.eligibleForShadow) process.exitCode = 2;
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
