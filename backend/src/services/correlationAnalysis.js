function toTimestampMs(value) {
    if (typeof value === "number") {
        return value > 1e12 ? value : value * 1000;
    }

    if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 1e12 ? numeric : numeric * 1000;
        }

        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function toIsoTime(timestampMs) {
    return new Date(timestampMs).toISOString();
}

function normalizeCandles(candles = []) {
    if (!Array.isArray(candles)) return [];

    return candles
        .map((candle) => {
            const timeMs = toTimestampMs(candle?.time);
            const close = Number(candle?.close);

            if (!Number.isFinite(timeMs) || !Number.isFinite(close) || close <= 0) {
                return null;
            }

            return {
                timeMs,
                time: toIsoTime(timeMs),
                close,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.timeMs - b.timeMs);
}

function calculateLogReturns(candles = []) {
    const normalized = normalizeCandles(candles);
    const returns = [];

    for (let index = 1; index < normalized.length; index += 1) {
        const previous = normalized[index - 1];
        const current = normalized[index];
        const value = Math.log(current.close / previous.close);

        if (Number.isFinite(value)) {
            returns.push({
                timeMs: current.timeMs,
                time: current.time,
                value,
                close: current.close,
            });
        }
    }

    return returns;
}

function buildReturnSeriesByInstrument(candlesByInstrument = {}) {
    return Object.entries(candlesByInstrument).reduce((acc, [instrument, candles]) => {
        acc[instrument] = calculateLogReturns(candles);
        return acc;
    }, {});
}

function buildPairKey(left, right) {
    return `${left}/${right}`;
}

function buildPairReturnSeries(leftReturns = [], rightReturns = []) {
    const rightByTime = new Map(
        rightReturns.map((point) => [point.timeMs, point.value])
    );

    return leftReturns
        .map((leftPoint) => {
            const rightValue = rightByTime.get(leftPoint.timeMs);
            if (!Number.isFinite(rightValue)) return null;

            return {
                timeMs: leftPoint.timeMs,
                time: leftPoint.time,
                x: leftPoint.value,
                y: rightValue,
            };
        })
        .filter(Boolean);
}

function pearsonCorrelation(pairs = []) {
    if (!Array.isArray(pairs) || pairs.length < 2) return null;

    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    let count = 0;

    for (const pair of pairs) {
        const x = Number(pair.x);
        const y = Number(pair.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumYY += y * y;
        sumXY += x * y;
        count += 1;
    }

    if (count < 2) return null;

    const numerator = count * sumXY - sumX * sumY;
    const denominatorX = count * sumXX - sumX * sumX;
    const denominatorY = count * sumYY - sumY * sumY;
    const denominator = Math.sqrt(denominatorX * denominatorY);

    if (!Number.isFinite(denominator) || denominator === 0) return null;

    const correlation = numerator / denominator;
    return Math.max(-1, Math.min(1, correlation));
}

function buildCorrelationMatrix(returnSeriesByInstrument = {}, instruments = []) {
    const matrix = {};
    const sampleSizes = {};

    for (const left of instruments) {
        matrix[left] = {};
        sampleSizes[left] = {};

        for (const right of instruments) {
            if (left === right) {
                matrix[left][right] = 1;
                sampleSizes[left][right] =
                    returnSeriesByInstrument[left]?.length || 0;
                continue;
            }

            const pairSeries = buildPairReturnSeries(
                returnSeriesByInstrument[left] || [],
                returnSeriesByInstrument[right] || []
            );

            matrix[left][right] = pearsonCorrelation(pairSeries);
            sampleSizes[left][right] = pairSeries.length;
        }
    }

    return { matrix, sampleSizes };
}

function calculateRollingPairCorrelations(
    pairSeries = [],
    { windowMs, minObservations = 30 } = {}
) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
        throw new Error("windowMs must be a positive number");
    }

    const rolling = [];
    let startIndex = 0;

    for (let endIndex = 0; endIndex < pairSeries.length; endIndex += 1) {
        const endPoint = pairSeries[endIndex];
        const minTime = endPoint.timeMs - windowMs;

        while (
            startIndex < endIndex &&
            pairSeries[startIndex].timeMs < minTime
        ) {
            startIndex += 1;
        }

        const window = pairSeries.slice(startIndex, endIndex + 1);
        const sampleSize = window.length;
        const correlation =
            sampleSize >= minObservations ? pearsonCorrelation(window) : null;

        rolling.push({
            timeMs: endPoint.timeMs,
            time: endPoint.time,
            windowStartTime: toIsoTime(pairSeries[startIndex].timeMs),
            sampleSize,
            correlation,
        });
    }

    return rolling;
}

function buildRollingCorrelations(
    returnSeriesByInstrument = {},
    instruments = [],
    { windowMs, minObservations = 30 } = {}
) {
    const rollingByPair = {};

    for (let leftIndex = 0; leftIndex < instruments.length; leftIndex += 1) {
        for (
            let rightIndex = leftIndex + 1;
            rightIndex < instruments.length;
            rightIndex += 1
        ) {
            const left = instruments[leftIndex];
            const right = instruments[rightIndex];
            const key = buildPairKey(left, right);
            const pairSeries = buildPairReturnSeries(
                returnSeriesByInstrument[left] || [],
                returnSeriesByInstrument[right] || []
            );

            rollingByPair[key] = calculateRollingPairCorrelations(pairSeries, {
                windowMs,
                minObservations,
            });
        }
    }

    return rollingByPair;
}

function flattenRollingCorrelations(rollingByPair = {}) {
    const rowsByTime = new Map();

    Object.entries(rollingByPair).forEach(([pairKey, points]) => {
        points.forEach((point) => {
            if (!rowsByTime.has(point.timeMs)) {
                rowsByTime.set(point.timeMs, {
                    timeMs: point.timeMs,
                    time: point.time,
                    correlations: {},
                    sampleSizes: {},
                });
            }

            const row = rowsByTime.get(point.timeMs);
            row.correlations[pairKey] = point.correlation;
            row.sampleSizes[pairKey] = point.sampleSize;
        });
    });

    return Array.from(rowsByTime.values()).sort((a, b) => a.timeMs - b.timeMs);
}

function getLatestRollingSnapshot(rollingByPair = {}) {
    return Object.entries(rollingByPair).reduce((acc, [pairKey, points]) => {
        const latest = [...points]
            .reverse()
            .find((point) => Number.isFinite(point.correlation));

        acc[pairKey] = latest
            ? {
                  time: latest.time,
                  correlation: latest.correlation,
                  sampleSize: latest.sampleSize,
              }
            : null;
        return acc;
    }, {});
}

module.exports = {
    buildCorrelationMatrix,
    buildPairKey,
    buildPairReturnSeries,
    buildReturnSeriesByInstrument,
    buildRollingCorrelations,
    calculateLogReturns,
    calculateRollingPairCorrelations,
    flattenRollingCorrelations,
    getLatestRollingSnapshot,
    normalizeCandles,
    pearsonCorrelation,
    toTimestampMs,
};
