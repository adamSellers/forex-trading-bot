// backend/src/workers/backtestWorker.js
const BacktestEngine = require("../services/backtestEngine");
const HistoricalDataService = require("../services/historicalDataService");

const DEFAULT_ASSETS = ["AUD_USD", "EUR_USD"];
const DEFAULT_DAYS = 30;
const M15_SECONDS = 15 * 60;

process.on("message", async (msg) => {
    if (msg.command === "start" || msg.command === "run_simulation") {
        try {
            const result = await runSimulation(msg.config || {}, {
                onProgress: (progress) => {
                    if (process.send) {
                        process.send({ type: "progress", ...progress });
                    }
                },
            });

            if (process.send) {
                process.send({ type: "simulation_complete", data: result });
            }
            process.exit(0);
        } catch (error) {
            if (process.send) {
                process.send({ type: "error", error: error.message });
            }
            process.exit(1);
        }
    }
});

function sanitizeAssets(assets) {
    if (!Array.isArray(assets)) {
        return DEFAULT_ASSETS;
    }

    const cleaned = assets
        .map((a) => (typeof a === "string" ? a.trim().toUpperCase() : ""))
        .filter(Boolean);

    return cleaned.length > 0 ? cleaned : DEFAULT_ASSETS;
}

function normalizeWeights(assets, rawWeights) {
    const input = rawWeights && typeof rawWeights === "object" ? rawWeights : {};
    const weights = {};
    let sum = 0;

    for (const asset of assets) {
        const value = Number(input[asset]);
        const normalized = Number.isFinite(value) && value > 0 ? value : 0;
        weights[asset] = normalized;
        sum += normalized;
    }

    if (sum <= 0) {
        const equal = 100 / assets.length;
        for (const asset of assets) {
            weights[asset] = equal;
        }
        return weights;
    }

    for (const asset of assets) {
        weights[asset] = (weights[asset] / sum) * 100;
    }

    return weights;
}

function mapToEngineConfig(config, initialBalance) {
    const minAdx = Number(config.minAdx);
    const rsiOverbought = Number(config.rsiOverbought ?? config.maxRsi);
    const rsiOversold = Number(config.rsiOversold);
    const riskPerTrade = Number(config.riskPerTrade);
    const stopLossATR = Number(config.stopLossATR);
    const spreadPips = Number(config.spreadPips);
    const continuationWindowMs = Number(config.continuationWindowMs);
    const continuationRsiThreshold = Number(config.continuationRsiThreshold);
    const continuationMaxPriceDeviation = Number(
        config.continuationMaxPriceDeviation
    );

    return {
        minAdx: Number.isFinite(minAdx) ? minAdx : 22,
        rsiOverbought: Number.isFinite(rsiOverbought) ? rsiOverbought : 75,
        rsiOversold: Number.isFinite(rsiOversold) ? rsiOversold : 30,

        initialBalance,
        riskPerTrade: Number.isFinite(riskPerTrade) ? riskPerTrade : 0.02,

        stopLossType:
            typeof config.stopLossType === "string"
                ? config.stopLossType.toUpperCase()
                : "ATR",
        stopLossAtrMultiplier: Number.isFinite(stopLossATR) ? stopLossATR : 2.0,

        enableTrailingStops: config.enableTrailingStops !== false,

        enableContinuationEntry: config.enableContinuationEntry !== false,
        continuationWindowSeconds: Number.isFinite(continuationWindowMs)
            ? Math.max(1, Math.floor(continuationWindowMs / 1000))
            : 4 * 60 * 60,
        continuationRsiThreshold: Number.isFinite(continuationRsiThreshold)
            ? continuationRsiThreshold
            : 70,
        continuationMaxPriceDeviation: Number.isFinite(
            continuationMaxPriceDeviation
        )
            ? continuationMaxPriceDeviation
            : 0.005,

        spreadPips: Number.isFinite(spreadPips) ? spreadPips : 1.5,
    };
}

function toLabResult(
    perAssetResults,
    config,
    assets,
    normalizedWeights,
    days,
    modeInfo = { dataMode: "live", fallbackAssets: [] }
) {
    const initialBalance = Number(config.balance) > 0 ? Number(config.balance) : 1000;
    const trades = [];
    const assetStats = [];
    let totalTrades = 0;
    let totalWins = 0;
    let totalNetProfit = 0;
    let totalCosts = 0;
    let continuationTrades = 0;
    let freshFlipTrades = 0;

    const curves = [];

    for (const asset of assets) {
        const assetResult = perAssetResults[asset];
        if (!assetResult) {
            continue;
        }

        const summary = assetResult.summary || {};
        const assetTrades = Array.isArray(assetResult.trades) ? assetResult.trades : [];
        const winners = Number(summary.winners) || 0;
        const pnl = Number(summary.totalPnl) || 0;

        totalTrades += Number(summary.totalTrades) || 0;
        totalWins += winners;
        totalNetProfit += pnl;

        let assetContinuationTrades = 0;

        for (const trade of assetTrades) {
            const spreadCost = Number(trade.spreadCost) || 0;
            const entryType = trade.entryType || "UNKNOWN";

            totalCosts += spreadCost;

            if (entryType.startsWith("CONTINUATION")) {
                continuationTrades += 1;
                assetContinuationTrades += 1;
            }
            if (entryType === "FRESH_FLIP") {
                freshFlipTrades += 1;
            }

            trades.push({
                ...trade,
                symbol: asset,
            });
        }

        assetStats.push({
            symbol: asset,
            trades: Number(summary.totalTrades) || 0,
            wins: winners,
            pnl,
            continuationTrades: assetContinuationTrades,
        });

        curves.push({
            asset,
            initial: initialBalance * (normalizedWeights[asset] / 100),
            points: Array.isArray(assetResult.equityCurve)
                ? assetResult.equityCurve
                : [],
        });
    }

    assetStats.sort((a, b) => b.pnl - a.pnl);
    trades.sort((a, b) => (b.exitTime || 0) - (a.exitTime || 0));

    const equityCurve = mergeEquityCurves(curves);
    const finalBalance = initialBalance + totalNetProfit;
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    return {
        stats: {
            initialBalance,
            finalBalance,
            netProfit: totalNetProfit,
            totalTrades,
            winRate,
            totalCosts,
            continuationTrades,
            freshFlipTrades,
            avgCostPerTrade: totalTrades > 0 ? totalCosts / totalTrades : 0,
            assetStats,
        },
        trades: trades.slice(0, 500),
        equityCurve,
        configUsed: {
            spreadPips:
                Number.isFinite(Number(config.spreadPips))
                    ? Number(config.spreadPips)
                    : 1.5,
            commissionPerSide:
                Number.isFinite(Number(config.commissionPerSide))
                    ? Number(config.commissionPerSide)
                    : 0,
            slippageEnabled: config.enableSlippage !== false,
            slippagePct:
                Number.isFinite(Number(config.slippagePct))
                    ? Number(config.slippagePct)
                    : 0.0005,
            continuationEnabled: config.enableContinuationEntry !== false,
            maxExposure:
                Number.isFinite(Number(config.maxPortfolioExposure))
                    ? Number(config.maxPortfolioExposure)
                    : 0.5,
            stopLossType:
                typeof config.stopLossType === "string"
                    ? config.stopLossType
                    : "ATR",
            rsiOverbought:
                Number.isFinite(Number(config.rsiOverbought))
                    ? Number(config.rsiOverbought)
                    : 75,
            assets,
            weights: normalizedWeights,
            days,
            dataMode: modeInfo.dataMode,
            fallbackAssets: modeInfo.fallbackAssets,
        },
    };
}

function mergeEquityCurves(curves) {
    if (!curves.length) {
        return [];
    }

    const timeline = new Set();
    for (const curve of curves) {
        for (const point of curve.points) {
            if (Number.isFinite(point.time)) {
                timeline.add(point.time);
            }
        }
    }

    const sortedTimes = Array.from(timeline).sort((a, b) => a - b);
    if (sortedTimes.length === 0) {
        return [];
    }

    const pointers = curves.map(() => 0);
    const lastValues = curves.map((curve) => curve.initial);

    const merged = [];
    for (const time of sortedTimes) {
        let total = 0;

        for (let i = 0; i < curves.length; i++) {
            const points = curves[i].points;
            while (pointers[i] < points.length && points[pointers[i]].time <= time) {
                lastValues[i] = Number(points[pointers[i]].equity) || lastValues[i];
                pointers[i] += 1;
            }
            total += lastValues[i];
        }

        merged.push({ time, value: total });
    }

    return merged;
}

async function runSimulation(config = {}, options = {}) {
    const assets = sanitizeAssets(config.assets);
    const normalizedWeights = normalizeWeights(assets, config.weights);
    const daysRaw = Number(config.days);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.floor(daysRaw) : DEFAULT_DAYS;

    const endTimestamp = Math.floor(Date.now() / 1000);
    const startTimestamp = endTimestamp - days * 24 * 60 * 60;

    const historicalDataService =
        options.historicalDataService || new HistoricalDataService();
    const engine = options.engine || new BacktestEngine(historicalDataService);

    const perAssetResults = {};
    const fallbackAssets = [];
    const warnings = [];
    let dataMode = "live";

    if (options.onProgress) {
        options.onProgress({
            message: `Initializing ${assets.length} asset simulation...`,
            percent: 5,
        });
    }

    for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const weight = normalizedWeights[asset] / 100;
        const initialBalance =
            (Number(config.balance) > 0 ? Number(config.balance) : 1000) * weight;

        if (options.onProgress) {
            const percent = 10 + Math.round((i / assets.length) * 75);
            options.onProgress({
                message: `Running ${asset} (${i + 1}/${assets.length})...`,
                percent,
            });
        }

        const engineConfig = mapToEngineConfig(config, initialBalance);
        try {
            perAssetResults[asset] = await engine.run(
                asset,
                "M15",
                startTimestamp,
                endTimestamp,
                engineConfig
            );
        } catch (error) {
            if (!shouldUseSyntheticFallback(error)) {
                throw error;
            }

            dataMode = "mixed";
            fallbackAssets.push(asset);
            warnings.push(`${asset}: ${error.message}`);

            if (options.onProgress) {
                options.onProgress({
                    message: `Using offline demo candles for ${asset}...`,
                    percent: Math.min(90, 15 + Math.round((i / assets.length) * 75)),
                });
            }

            const syntheticCandles = buildSyntheticCandles(
                asset,
                startTimestamp,
                endTimestamp
            );
            perAssetResults[asset] = engine.runOnCandles(
                syntheticCandles,
                asset,
                engineConfig
            );
        }
    }

    if (options.onProgress) {
        options.onProgress({ message: "Finalizing report...", percent: 95 });
    }

    if (fallbackAssets.length === assets.length) {
        dataMode = "demo";
    }

    const result = toLabResult(
        perAssetResults,
        config,
        assets,
        normalizedWeights,
        days,
        {
            dataMode,
            fallbackAssets,
        }
    );

    if (warnings.length > 0) {
        result.warnings = warnings;
    }

    return result;
}

module.exports = { runSimulation };

function shouldUseSyntheticFallback(error) {
    if (!error || !error.message) return false;
    const message = String(error.message).toLowerCase();
    return (
        message.includes("oanda request failed") ||
        message.includes("api key not configured") ||
        message.includes("fetch failed") ||
        message.includes("enotfound") ||
        message.includes("econnrefused") ||
        message.includes("etimedout")
    );
}

function getBasePrice(instrument) {
    if (instrument.includes("JPY")) return 150;
    if (instrument === "EUR_USD") return 1.08;
    if (instrument === "GBP_USD") return 1.27;
    if (instrument === "AUD_USD") return 0.66;
    if (instrument === "NZD_USD") return 0.61;
    if (instrument === "USD_CAD") return 1.35;
    if (instrument === "USD_CHF") return 0.89;
    return 1.0;
}

function hashSeed(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
}

function createPrng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function buildSyntheticCandles(instrument, fromTimestamp, toTimestamp) {
    const start = Math.floor(fromTimestamp / M15_SECONDS) * M15_SECONDS;
    const end = Math.floor(toTimestamp / M15_SECONDS) * M15_SECONDS;
    const candleCount = Math.max(240, Math.floor((end - start) / M15_SECONDS));

    const seed = hashSeed(`${instrument}:${fromTimestamp}:${toTimestamp}`);
    const rand = createPrng(seed);

    let price = getBasePrice(instrument);
    const pip = instrument.includes("JPY") ? 0.01 : 0.0001;
    const baseTrendBias = (rand() - 0.5) * pip * 2.5;
    const regimeSpan = 96; // ~1 trading day of M15 candles
    const candles = [];

    for (let i = 0; i < candleCount; i++) {
        const t = start + i * M15_SECONDS;
        const seasonal = Math.sin(i / 34) * pip * 6;
        const regimePhase = Math.floor(i / regimeSpan) % 4;
        const regimeSign = regimePhase < 2 ? 1 : -1;
        const regimeTrend = regimeSign * pip * (2.2 + rand() * 1.8);
        const drift =
            baseTrendBias + regimeTrend + (rand() - 0.5) * pip * 5 + seasonal * 0.35;
        const open = price;
        const close = Math.max(pip, open + drift);

        const wickUp = rand() * pip * 8;
        const wickDown = rand() * pip * 8;
        const high = Math.max(open, close) + wickUp;
        const low = Math.max(pip / 2, Math.min(open, close) - wickDown);

        candles.push({
            time: t,
            open: Number(open.toFixed(instrument.includes("JPY") ? 3 : 5)),
            high: Number(high.toFixed(instrument.includes("JPY") ? 3 : 5)),
            low: Number(low.toFixed(instrument.includes("JPY") ? 3 : 5)),
            close: Number(close.toFixed(instrument.includes("JPY") ? 3 : 5)),
            volume: 100 + Math.floor(rand() * 900),
        });

        price = close;
    }

    return candles;
}
