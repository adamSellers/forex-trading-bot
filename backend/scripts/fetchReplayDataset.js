#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const oandaClient = require("../src/services/Oandaclient");

const DEFAULT_INSTRUMENTS = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"];
const MAX_CANDLES = 5000;

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

function toUnixSeconds(value, label) {
    if (value === undefined || value === null || value === "") {
        throw new Error(`Missing --${label}`);
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid --${label}: ${value}`);
    return Math.floor(parsed / 1000);
}

function mapPrice(price) {
    if (!price) return null;
    const mapped = {
        o: Number(price.o),
        h: Number(price.h),
        l: Number(price.l),
        c: Number(price.c),
    };
    return Object.values(mapped).every(Number.isFinite) ? mapped : null;
}

function mapCandle(candle) {
    const time = Number(candle.time);
    const mid = mapPrice(candle.mid);
    const bid = mapPrice(candle.bid);
    const ask = mapPrice(candle.ask);
    if (!Number.isFinite(time) || !mid || !bid || !ask || candle.complete !== true) {
        return null;
    }
    return {
        time,
        open: mid.o,
        high: mid.h,
        low: mid.l,
        close: mid.c,
        mid,
        bid,
        ask,
        volume: Number(candle.volume) || 0,
        complete: true,
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInstrument(instrument, granularity, from, to, delayMs) {
    const candlesByTime = new Map();
    let cursor = from;
    let requestCount = 0;

    while (cursor < to) {
        if (requestCount > 0 && delayMs > 0) await delay(delayMs);
        const response = await oandaClient.getCandles(
            instrument,
            granularity,
            MAX_CANDLES,
            { from: String(cursor), price: "MBA" }
        );
        const rawCandles = Array.isArray(response?.candles)
            ? response.candles
            : [];
        requestCount += 1;
        if (!rawCandles.length) break;

        for (const raw of rawCandles) {
            const mapped = mapCandle(raw);
            if (mapped && mapped.time >= from && mapped.time <= to) {
                candlesByTime.set(mapped.time, mapped);
            }
        }

        const lastTime = Number(rawCandles[rawCandles.length - 1]?.time);
        if (!Number.isFinite(lastTime) || lastTime >= to) break;
        const nextCursor = Math.floor(lastTime) + 1;
        if (nextCursor <= cursor) {
            throw new Error(`${instrument} candle pagination did not advance`);
        }
        cursor = nextCursor;
        if (rawCandles.length < MAX_CANDLES) break;
    }

    const candles = Array.from(candlesByTime.values()).sort(
        (left, right) => left.time - right.time
    );
    process.stderr.write(
        `${instrument}: ${candles.length} complete ${granularity} bid/ask candles (${requestCount} requests)\n`
    );
    return candles;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(
            "Usage: node scripts/fetchReplayDataset.js --from DATE --to DATE --output FILE " +
                "[--granularity M15] [--instruments AUD_USD,EUR_USD] [--delayMs 250] [--append]\n"
        );
        return;
    }

    const from = toUnixSeconds(args.from, "from");
    const to = toUnixSeconds(args.to, "to");
    if (from >= to) throw new Error("--from must be before --to");
    if (!args.output) throw new Error("Missing --output");
    const granularity = String(args.granularity || "M15").toUpperCase();
    const instruments = String(args.instruments || DEFAULT_INSTRUMENTS.join(","))
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    const delayMs = Math.max(0, Number(args.delayMs) || 250);
    const outputPath = path.resolve(args.output);
    let candlesByInstrument = {};
    if (args.append && fs.existsSync(outputPath)) {
        const existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
        candlesByInstrument = existing.candlesByInstrument || existing;
    }

    for (const instrument of instruments) {
        candlesByInstrument[instrument] = await fetchInstrument(
            instrument,
            granularity,
            from,
            to,
            delayMs
        );
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
        outputPath,
        JSON.stringify({
            schemaVersion: 1,
            source: "OANDA REST v20",
            pricingComponents: "MBA",
            completeCandlesOnly: true,
            granularity,
            from,
            to,
            downloadedAt: new Date().toISOString(),
            candlesByInstrument,
        })
    );
    process.stderr.write(`Wrote ${outputPath}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    mapCandle,
    mapPrice,
    parseArgs,
    toUnixSeconds,
};
