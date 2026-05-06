const {
    buildCorrelationMatrix,
    buildPairReturnSeries,
    buildReturnSeriesByInstrument,
    buildRollingCorrelations,
    calculateLogReturns,
    flattenRollingCorrelations,
    pearsonCorrelation,
} = require("../correlationAnalysis");

function buildCandlesFromCloses(closes, startTime = 1700000000) {
    return closes.map((close, index) => ({
        time: startTime + index * 900,
        open: close,
        high: close,
        low: close,
        close,
        volume: 100,
    }));
}

function buildCandlesFromLogReturns(logReturns, startClose = 100, startTime = 1700000000) {
    const closes = [startClose];

    for (const logReturn of logReturns) {
        closes.push(closes[closes.length - 1] * Math.exp(logReturn));
    }

    return buildCandlesFromCloses(closes, startTime);
}

describe("correlationAnalysis", () => {
    test("calculateLogReturns uses close-to-close log returns", () => {
        const candles = buildCandlesFromCloses([100, 105, 110.25]);

        const returns = calculateLogReturns(candles);

        expect(returns).toHaveLength(2);
        expect(returns[0].value).toBeCloseTo(Math.log(105 / 100), 12);
        expect(returns[1].value).toBeCloseTo(Math.log(110.25 / 105), 12);
    });

    test("pearsonCorrelation detects positive and inverse relationships", () => {
        expect(
            pearsonCorrelation([
                { x: 1, y: 2 },
                { x: 2, y: 4 },
                { x: 3, y: 6 },
            ])
        ).toBeCloseTo(1, 12);

        expect(
            pearsonCorrelation([
                { x: 1, y: -2 },
                { x: 2, y: -4 },
                { x: 3, y: -6 },
            ])
        ).toBeCloseTo(-1, 12);
    });

    test("buildCorrelationMatrix aligns returns by timestamp", () => {
        const candlesByInstrument = {
            AUD_USD: buildCandlesFromLogReturns([0.01, 0.02, 0.015]),
            EUR_USD: buildCandlesFromLogReturns([0.02, 0.04, 0.03], 200),
            USD_JPY: buildCandlesFromLogReturns([-0.01, -0.02, -0.015]),
        };
        const returnsByInstrument =
            buildReturnSeriesByInstrument(candlesByInstrument);

        const { matrix, sampleSizes } = buildCorrelationMatrix(
            returnsByInstrument,
            ["AUD_USD", "EUR_USD", "USD_JPY"]
        );

        expect(sampleSizes.AUD_USD.EUR_USD).toBe(3);
        expect(matrix.AUD_USD.EUR_USD).toBeGreaterThan(0.99);
        expect(matrix.AUD_USD.USD_JPY).toBeLessThan(-0.99);
        expect(matrix.USD_JPY.USD_JPY).toBe(1);
    });

    test("buildPairReturnSeries keeps only shared timestamps", () => {
        const left = [
            { timeMs: 1000, time: "1970-01-01T00:00:01.000Z", value: 1 },
            { timeMs: 2000, time: "1970-01-01T00:00:02.000Z", value: 2 },
        ];
        const right = [
            { timeMs: 2000, time: "1970-01-01T00:00:02.000Z", value: 20 },
            { timeMs: 3000, time: "1970-01-01T00:00:03.000Z", value: 30 },
        ];

        expect(buildPairReturnSeries(left, right)).toEqual([
            {
                timeMs: 2000,
                time: "1970-01-01T00:00:02.000Z",
                x: 2,
                y: 20,
            },
        ]);
    });

    test("buildRollingCorrelations produces time-windowed pair snapshots", () => {
        const start = 1700000000;
        const candlesByInstrument = {
            AUD_USD: buildCandlesFromLogReturns(
                [0.01, 0.02, 0.015, 0.025],
                100,
                start
            ),
            USD_JPY: buildCandlesFromLogReturns(
                [-0.01, -0.02, -0.015, -0.025],
                100,
                start
            ),
        };
        const returnsByInstrument =
            buildReturnSeriesByInstrument(candlesByInstrument);

        const rollingByPair = buildRollingCorrelations(
            returnsByInstrument,
            ["AUD_USD", "USD_JPY"],
            {
                windowMs: 60 * 60 * 1000,
                minObservations: 3,
            }
        );
        const rows = flattenRollingCorrelations(rollingByPair);

        expect(Object.keys(rollingByPair)).toEqual(["AUD_USD/USD_JPY"]);
        expect(rows).toHaveLength(4);
        expect(rows[0].correlations["AUD_USD/USD_JPY"]).toBeNull();
        expect(rows[2].correlations["AUD_USD/USD_JPY"]).toBeLessThan(-0.99);
    });
});
