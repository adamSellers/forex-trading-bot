// backend/src/workers/backtestWorker.js
const BacktestEngine = require("../services/backtestEngine");
const HistoricalDataService = require("../services/historicalDataService");

const DEFAULT_ASSETS = ["AUD_USD", "EUR_USD"];
const DEFAULT_DAYS = 30;

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

function toLabResult(perAssetResults, config, assets, normalizedWeights, days) {
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
        perAssetResults[asset] = await engine.run(
            asset,
            "M15",
            startTimestamp,
            endTimestamp,
            engineConfig
        );
    }

    if (options.onProgress) {
        options.onProgress({ message: "Finalizing report...", percent: 95 });
    }

    return toLabResult(perAssetResults, config, assets, normalizedWeights, days);
}

module.exports = { runSimulation };
