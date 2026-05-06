const correlationDivergenceStrategy = require("../correlationDivergence");

function getAntiUsdSign(instrument) {
    return correlationDivergenceStrategy.getAntiUsdSign(instrument);
}

function buildCandlesFromAntiUsdReturns(
    instrument,
    antiUsdReturns,
    startClose = instrument === "USD_JPY" ? 150 : 1.1
) {
    const sign = getAntiUsdSign(instrument);
    const candles = [];
    let close = startClose;
    const startTime = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

    candles.push({
        time: new Date(startTime).toISOString(),
        open: close,
        high: close * 1.0004,
        low: close * 0.9996,
        close,
        volume: 100,
    });

    antiUsdReturns.forEach((antiUsdReturn, index) => {
        const open = close;
        const rawReturn = antiUsdReturn * sign;
        close = close * Math.exp(rawReturn);
        const high = Math.max(open, close) * 1.0004;
        const low = Math.min(open, close) * 0.9996;

        candles.push({
            time: new Date(startTime + (index + 1) * 15 * 60 * 1000).toISOString(),
            open,
            high,
            low,
            close,
            volume: 100 + index,
        });
    });

    return candles;
}

function buildDivergenceScenario(targetInstrument = "AUD_USD") {
    const instruments = ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"];
    const returnsByInstrument = {};

    instruments.forEach((instrument, instrumentIndex) => {
        const returns = [];

        for (let index = 0; index < 360; index += 1) {
            const factor =
                0.00008 * Math.sin(index / 5) +
                0.00005 * Math.cos(index / 11);
            const peerNoise = instrumentIndex * 0.000002 * Math.sin(index / 7);
            const targetNoise = 0.00001 * Math.sin(index / 3);
            returns.push(
                instrument === targetInstrument
                    ? factor + targetNoise
                    : factor + peerNoise
            );
        }

        for (let index = 0; index < 4; index += 1) {
            returns.push(instrument === targetInstrument ? -0.00005 : 0.00045);
        }

        returnsByInstrument[instrument] = returns;
    });

    const candlesByInstrument = instruments.reduce((acc, instrument) => {
        acc[instrument] = buildCandlesFromAntiUsdReturns(
            instrument,
            returnsByInstrument[instrument]
        );
        return acc;
    }, {});
    const targetCandles = candlesByInstrument[targetInstrument];
    const peers = instruments
        .filter((instrument) => instrument !== targetInstrument)
        .reduce((acc, instrument) => {
            acc[instrument] = {
                instrument,
                timeframes: {
                    "15m": {
                        candles: candlesByInstrument[instrument],
                        indicators: {
                            atr: new Array(candlesByInstrument[instrument].length).fill(
                                instrument === "USD_JPY" ? 0.08 : 0.001
                            ),
                        },
                    },
                },
            };
            return acc;
        }, {});

    return {
        candles: targetCandles,
        currentPrice: targetCandles[targetCandles.length - 1].close,
        marketContext: {
            timeframes: {
                "15m": {
                    candles: targetCandles,
                    indicators: {
                        atr: new Array(targetCandles.length).fill(
                            targetInstrument === "USD_JPY" ? 0.08 : 0.001
                        ),
                    },
                },
            },
            peers,
        },
    };
}

const testConfig = {
    strategy: "correlation_divergence",
    timeframe: "15m",
    correlationDivergenceLookbackBars: 4,
    correlationDivergenceZWindowBars: 80,
    correlationDivergenceMinObservations: 40,
    correlationDivergenceEntryZScore: 1.5,
    correlationDivergenceMinPeerMoveBps: 1,
    correlationDivergenceMinCorrelation: 0.1,
    correlationDivergenceMinPeerInstruments: 2,
    minStopLossPips: 10,
    stopLossPips: 10,
};

describe("correlationDivergenceStrategy", () => {
    test("buys a USD-quoted pair when it lags peer anti-USD strength", async () => {
        const scenario = buildDivergenceScenario("AUD_USD");

        const result = await correlationDivergenceStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: scenario.candles,
            currentPrice: scenario.currentPrice,
            config: testConfig,
            marketContext: scenario.marketContext,
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                reasonCode: "CORRELATION_DIVERGENCE_LAGGARD_LONG_ANTI_USD",
                signalClass: "ACTIONABLE",
                entryType: "CORRELATION_DIVERGENCE_MEAN_REVERSION",
            })
        );
        expect(result.strategyContext).toEqual(
            expect.objectContaining({
                family: "correlation_divergence",
                zScore: expect.any(Number),
                peerCount: 3,
            })
        );
        expect(result.strategyContext.zScore).toBeLessThan(-1.5);
        expect(result.tradePlan.stopLossPrice).toBeLessThan(scenario.currentPrice);
        expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(
            scenario.currentPrice
        );
    });

    test("sells USD_JPY when it lags peer anti-USD strength", async () => {
        const scenario = buildDivergenceScenario("USD_JPY");

        const result = await correlationDivergenceStrategy.evaluateEntry({
            instrument: "USD_JPY",
            candles: scenario.candles,
            currentPrice: scenario.currentPrice,
            config: testConfig,
            marketContext: scenario.marketContext,
        });

        expect(result.signalType).toBe("SELL");
        expect(result.reasonCode).toBe(
            "CORRELATION_DIVERGENCE_LAGGARD_LONG_ANTI_USD"
        );
        expect(result.strategyContext.zScore).toBeLessThan(-1.5);
        expect(result.tradePlan.stopLossPrice).toBeGreaterThan(
            scenario.currentPrice
        );
        expect(result.tradePlan.takeProfitPrice).toBeLessThan(
            scenario.currentPrice
        );
    });

    test("holds when the peer USD-factor move is below the configured floor", async () => {
        const scenario = buildDivergenceScenario("AUD_USD");

        const result = await correlationDivergenceStrategy.evaluateEntry({
            instrument: "AUD_USD",
            candles: scenario.candles,
            currentPrice: scenario.currentPrice,
            config: {
                ...testConfig,
                correlationDivergenceMinPeerMoveBps: 100,
            },
            marketContext: scenario.marketContext,
        });

        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe(
            "CORRELATION_DIVERGENCE_PEER_MOVE_TOO_SMALL"
        );
    });
});
