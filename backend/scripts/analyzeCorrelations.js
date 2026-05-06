#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const {
    buildCorrelationMatrix,
    buildReturnSeriesByInstrument,
    buildRollingCorrelations,
    flattenRollingCorrelations,
    getLatestRollingSnapshot,
} = require("../src/services/correlationAnalysis");

const DEFAULT_INSTRUMENTS = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"];
const DEFAULT_GRANULARITY = "M15";
const DEFAULT_DAYS = 180;
const DEFAULT_ROLLING_DAYS = 30;
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "../data/correlation");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_DAY = 24 * 60 * 60;

function parseArgs(argv = []) {
    const args = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) continue;

        const eqIndex = token.indexOf("=");
        if (eqIndex !== -1) {
            args[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
            continue;
        }

        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith("--")) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }

    return args;
}

function parseList(value, fallback = []) {
    if (!value) return [...fallback];
    return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function parsePositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDateToSeconds(value, fallback = null) {
    if (value === undefined || value === null || value === "") return fallback;

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric > 1e12
            ? Math.floor(numeric / 1000)
            : Math.floor(numeric);
    }

    const normalized = String(value).trim();
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
        ? Date.parse(`${normalized}T00:00:00Z`)
        : Date.parse(normalized);

    return Number.isFinite(timestamp)
        ? Math.floor(timestamp / 1000)
        : fallback;
}

function getGranularityMinutes(granularity) {
    const normalized = String(granularity || "").toUpperCase();
    const match = normalized.match(/^([MHD])(\d+)?$/);
    if (!match) return 15;

    const unit = match[1];
    const count = Number(match[2] || 1);

    if (unit === "M") return count;
    if (unit === "H") return count * 60;
    if (unit === "D") return count * 24 * 60;

    return 15;
}

function formatNumber(value, decimals = 4) {
    return Number.isFinite(value) ? value.toFixed(decimals) : "";
}

function csvEscape(value) {
    const stringValue = value === null || value === undefined ? "" : String(value);
    if (!/[",\n]/.test(stringValue)) return stringValue;
    return `"${stringValue.replace(/"/g, '""')}"`;
}

function matrixToCsv(matrix = {}, instruments = []) {
    const lines = [
        ["instrument", ...instruments].map(csvEscape).join(","),
    ];

    for (const instrument of instruments) {
        const row = [
            instrument,
            ...instruments.map((other) => formatNumber(matrix[instrument]?.[other], 6)),
        ];
        lines.push(row.map(csvEscape).join(","));
    }

    return `${lines.join("\n")}\n`;
}

function rollingToCsv(rows = [], pairKeys = []) {
    const headers = ["time"];
    pairKeys.forEach((pairKey) => {
        headers.push(pairKey);
        headers.push(`${pairKey}_n`);
    });

    const lines = [headers.map(csvEscape).join(",")];
    rows.forEach((row) => {
        const values = [row.time];
        pairKeys.forEach((pairKey) => {
            values.push(formatNumber(row.correlations[pairKey], 6));
            values.push(row.sampleSizes[pairKey] ?? "");
        });
        lines.push(values.map(csvEscape).join(","));
    });

    return `${lines.join("\n")}\n`;
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function downsample(points = [], maxPoints = 1800) {
    if (points.length <= maxPoints) return points;
    const stride = Math.ceil(points.length / maxPoints);
    return points.filter((_point, index) => index % stride === 0);
}

function buildPath(points, xScale, yScale) {
    const commands = [];
    let hasOpenSegment = false;

    for (const point of points) {
        if (!Number.isFinite(point.correlation)) {
            hasOpenSegment = false;
            continue;
        }

        const command = hasOpenSegment ? "L" : "M";
        commands.push(
            `${command}${xScale(point.timeMs).toFixed(2)},${yScale(point.correlation).toFixed(2)}`
        );
        hasOpenSegment = true;
    }

    return commands.join(" ");
}

function makeDateLabel(timestampMs) {
    return new Date(timestampMs).toISOString().slice(0, 10);
}

function buildRollingSvg({
    rollingByPair,
    pairKeys,
    title,
    subtitle,
    width = 1200,
    height = 720,
}) {
    const margin = { top: 72, right: 260, bottom: 72, left: 72 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const colors = [
        "#2563eb",
        "#dc2626",
        "#16a34a",
        "#ca8a04",
        "#7c3aed",
        "#0891b2",
        "#be185d",
        "#475569",
    ];

    const allPoints = pairKeys.flatMap((pairKey) => rollingByPair[pairKey] || []);
    const finitePoints = allPoints.filter((point) =>
        Number.isFinite(point.correlation)
    );

    if (finitePoints.length === 0) {
        return [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
            `<rect width="100%" height="100%" fill="#ffffff"/>`,
            `<text x="40" y="60" font-family="Arial, sans-serif" font-size="24" fill="#111827">${escapeXml(title)}</text>`,
            `<text x="40" y="100" font-family="Arial, sans-serif" font-size="16" fill="#6b7280">No rolling windows had enough observations to chart.</text>`,
            "</svg>",
        ].join("\n");
    }

    const minTime = Math.min(...finitePoints.map((point) => point.timeMs));
    const maxTime = Math.max(...finitePoints.map((point) => point.timeMs));
    const timeSpan = Math.max(1, maxTime - minTime);
    const xScale = (timeMs) =>
        margin.left + ((timeMs - minTime) / timeSpan) * chartWidth;
    const yScale = (value) => margin.top + ((1 - value) / 2) * chartHeight;

    const elements = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<rect width="100%" height="100%" fill="#ffffff"/>`,
        `<text x="${margin.left}" y="34" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#111827">${escapeXml(title)}</text>`,
        `<text x="${margin.left}" y="58" font-family="Arial, sans-serif" font-size="14" fill="#4b5563">${escapeXml(subtitle)}</text>`,
        `<rect x="${margin.left}" y="${margin.top}" width="${chartWidth}" height="${chartHeight}" fill="#f9fafb" stroke="#d1d5db"/>`,
    ];

    [-1, -0.5, 0, 0.5, 1].forEach((tick) => {
        const y = yScale(tick);
        elements.push(
            `<line x1="${margin.left}" x2="${margin.left + chartWidth}" y1="${y}" y2="${y}" stroke="${tick === 0 ? "#9ca3af" : "#e5e7eb"}" stroke-width="${tick === 0 ? 1.5 : 1}"/>`,
            `<text x="${margin.left - 12}" y="${y + 5}" text-anchor="end" font-family="Arial, sans-serif" font-size="12" fill="#4b5563">${tick.toFixed(1)}</text>`
        );
    });

    const xTicks = 6;
    for (let index = 0; index <= xTicks; index += 1) {
        const timeMs = minTime + (timeSpan * index) / xTicks;
        const x = xScale(timeMs);
        elements.push(
            `<line x1="${x}" x2="${x}" y1="${margin.top}" y2="${margin.top + chartHeight}" stroke="#e5e7eb"/>`,
            `<text x="${x}" y="${margin.top + chartHeight + 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#4b5563">${escapeXml(makeDateLabel(timeMs))}</text>`
        );
    }

    pairKeys.forEach((pairKey, index) => {
        const color = colors[index % colors.length];
        const points = downsample(rollingByPair[pairKey] || []);
        const pathData = buildPath(points, xScale, yScale);
        if (!pathData) return;

        elements.push(
            `<path d="${pathData}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
        );
    });

    const legendX = margin.left + chartWidth + 32;
    const legendY = margin.top + 8;
    elements.push(
        `<text x="${legendX}" y="${legendY}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#111827">Pair</text>`
    );

    pairKeys.forEach((pairKey, index) => {
        const y = legendY + 26 + index * 24;
        const color = colors[index % colors.length];
        elements.push(
            `<line x1="${legendX}" x2="${legendX + 28}" y1="${y - 4}" y2="${y - 4}" stroke="${color}" stroke-width="3"/>`,
            `<text x="${legendX + 38}" y="${y}" font-family="Arial, sans-serif" font-size="13" fill="#111827">${escapeXml(pairKey)}</text>`
        );
    });

    elements.push("</svg>");
    return `${elements.join("\n")}\n`;
}

function buildSummary({
    instruments,
    granularity,
    fromTimestamp,
    toTimestamp,
    rollingDays,
    minObservations,
    candlesByInstrument,
    returnSeriesByInstrument,
    matrix,
    sampleSizes,
    rollingByPair,
}) {
    const pairKeys = Object.keys(rollingByPair);

    return {
        generatedAt: new Date().toISOString(),
        range: {
            from: new Date(fromTimestamp * 1000).toISOString(),
            to: new Date(toTimestamp * 1000).toISOString(),
            days: (toTimestamp - fromTimestamp) / SECONDS_PER_DAY,
        },
        granularity,
        instruments,
        rollingWindowDays: rollingDays,
        minRollingObservations: minObservations,
        candles: instruments.reduce((acc, instrument) => {
            acc[instrument] = candlesByInstrument[instrument]?.length || 0;
            return acc;
        }, {}),
        returns: instruments.reduce((acc, instrument) => {
            acc[instrument] =
                returnSeriesByInstrument[instrument]?.length || 0;
            return acc;
        }, {}),
        correlationMatrix: matrix,
        sampleSizes,
        latestRollingCorrelations: getLatestRollingSnapshot(rollingByPair),
        pairKeys,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || args.h) {
        console.log(`
Usage:
  npm run analysis:correlation -- [options]

Options:
  --instruments AUD_USD,EUR_USD,GBP_USD,USD_JPY
  --granularity M15
  --days 180
  --from 2025-11-01
  --to 2026-05-01
  --rolling-days 30
  --min-observations 500
  --output-dir data/correlation
  --force-refresh

Outputs:
  summary JSON, latest matrix CSV, rolling correlation CSV, and SVG chart.
`);
        return;
    }

    const instruments = parseList(args.instruments, DEFAULT_INSTRUMENTS);
    const granularity = String(args.granularity || DEFAULT_GRANULARITY).toUpperCase();
    const days = parsePositiveNumber(args.days, DEFAULT_DAYS);
    const rollingDays = parsePositiveNumber(
        args["rolling-days"],
        DEFAULT_ROLLING_DAYS
    );
    const toTimestamp = parseDateToSeconds(
        args.to,
        Math.floor(Date.now() / 1000)
    );
    const fromTimestamp = parseDateToSeconds(
        args.from,
        toTimestamp - Math.floor(days * SECONDS_PER_DAY)
    );
    const granularityMinutes = getGranularityMinutes(granularity);
    const expectedRollingBars =
        (rollingDays * 24 * 60) / Math.max(1, granularityMinutes);
    const minObservations = Math.floor(
        parsePositiveNumber(args["min-observations"], expectedRollingBars * 0.45)
    );
    const outputDir = path.resolve(
        process.cwd(),
        args["output-dir"] || DEFAULT_OUTPUT_DIR
    );
    const forceRefresh = args["force-refresh"] === true;

    if (fromTimestamp >= toTimestamp) {
        throw new Error("--from must be before --to");
    }

    fs.mkdirSync(outputDir, { recursive: true });

    console.log("Fetching historical candles...");
    console.log(`  Instruments: ${instruments.join(", ")}`);
    console.log(`  Granularity: ${granularity}`);
    console.log(
        `  Range: ${new Date(fromTimestamp * 1000).toISOString()} to ${new Date(toTimestamp * 1000).toISOString()}`
    );

    const HistoricalDataService = require("../src/services/historicalDataService");
    const historicalDataService = new HistoricalDataService();
    const candlesByInstrument = await historicalDataService.getCandlesMultiple(
        instruments,
        granularity,
        fromTimestamp,
        toTimestamp,
        { forceRefresh }
    );

    const returnSeriesByInstrument =
        buildReturnSeriesByInstrument(candlesByInstrument);
    const { matrix, sampleSizes } = buildCorrelationMatrix(
        returnSeriesByInstrument,
        instruments
    );
    const rollingByPair = buildRollingCorrelations(
        returnSeriesByInstrument,
        instruments,
        {
            windowMs: rollingDays * MS_PER_DAY,
            minObservations,
        }
    );
    const rollingRows = flattenRollingCorrelations(rollingByPair);
    const pairKeys = Object.keys(rollingByPair);
    const summary = buildSummary({
        instruments,
        granularity,
        fromTimestamp,
        toTimestamp,
        rollingDays,
        minObservations,
        candlesByInstrument,
        returnSeriesByInstrument,
        matrix,
        sampleSizes,
        rollingByPair,
    });

    const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    const baseName = `fx-correlation-${granularity}-${stamp}`;
    const summaryPath = path.join(outputDir, `${baseName}.summary.json`);
    const matrixPath = path.join(outputDir, `${baseName}.matrix.csv`);
    const rollingPath = path.join(outputDir, `${baseName}.rolling.csv`);
    const chartPath = path.join(outputDir, `${baseName}.rolling.svg`);

    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(matrixPath, matrixToCsv(matrix, instruments));
    fs.writeFileSync(rollingPath, rollingToCsv(rollingRows, pairKeys));
    fs.writeFileSync(
        chartPath,
        buildRollingSvg({
            rollingByPair,
            pairKeys,
            title: "FX Rolling Correlation",
            subtitle: `${rollingDays}-day Pearson correlation on ${granularity} log returns`,
        })
    );

    console.log("\nLatest correlation matrix:");
    console.table(matrix);

    console.log("Report files:");
    console.log(`  Summary: ${summaryPath}`);
    console.log(`  Matrix:  ${matrixPath}`);
    console.log(`  Rolling: ${rollingPath}`);
    console.log(`  Chart:   ${chartPath}`);
}

main().catch((error) => {
    console.error(`Correlation analysis failed: ${error.message}`);
    process.exitCode = 1;
});
