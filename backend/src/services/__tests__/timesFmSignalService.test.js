const TimesFmSignalService = require("../timesFmSignalService");
const { createMockSignal, createHoldSignal } = require("../../../__tests__/fixtures/mockSignals");

function buildCandles(count = 220) {
    return Array.from({ length: count }, (_, index) => ({
        time: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
        close: 1.08 + index * 0.0001,
    }));
}

describe("TimesFmSignalService", () => {
    let client;
    let service;

    beforeEach(() => {
        client = {
            defaultTimeoutMs: 5000,
            isConfigured: jest.fn(() => true),
            getStatusSnapshot: jest.fn(() => ({
                configured: true,
                authConfigured: true,
                baseUrl: "http://timesfm.test",
                lastHealth: {
                    ok: true,
                    connected: true,
                    status: "ok",
                    ready: true,
                    checkedAt: Date.now(),
                },
                lastFailure: null,
                lastForecastAt: null,
            })),
            checkHealth: jest.fn().mockResolvedValue({
                ok: true,
                connected: true,
                status: "ok",
                ready: true,
            }),
            getForecast: jest.fn().mockResolvedValue({
                instrument: "AUD_USD",
                horizon: 12,
                inputBars: 220,
                preprocessMode: "raw",
                usedLogReturns: false,
                inferenceMs: 95.1,
                direction: "BULLISH",
                confidence: 0.81,
                returnBps: 12.3,
                volatilityRegime: "HIGH",
                quantileSpreadBps: 35.4,
                pointForecast: [1.101],
                quantilesH1: [1.09, 1.11],
            }),
            getLastFailure: jest.fn(() => null),
        };

        service = new TimesFmSignalService({
            client,
            maxContextBars: 500,
            minContextBars: 50,
            cacheTtlMs: 60000,
        });
    });

    test("returns disabled metadata without calling the sidecar", async () => {
        const signal = await service.enrichSignal(createMockSignal(), {
            candles: buildCandles(),
            config: {
                timesFmEnabled: false,
                timesFmMode: "disabled",
            },
        });

        expect(signal.timesFm).toEqual(
            expect.objectContaining({
                available: false,
                reason: "disabled",
            })
        );
        expect(client.getForecast).not.toHaveBeenCalled();
    });

    test("marks non-actionable signals without calling the sidecar", async () => {
        const signal = await service.enrichSignal(createHoldSignal(), {
            candles: buildCandles(),
            config: {
                timesFmEnabled: true,
                timesFmMode: "observe",
                timesFmHorizonBars: 12,
            },
        });

        expect(signal.timesFm.reason).toBe("not_actionable");
        expect(client.getForecast).not.toHaveBeenCalled();
    });

    test("attaches forecast metadata and computes veto candidate", async () => {
        client.getForecast.mockResolvedValueOnce({
            instrument: "AUD_USD",
            horizon: 12,
            inputBars: 220,
            preprocessMode: "raw",
            usedLogReturns: false,
            inferenceMs: 95.1,
            direction: "BEARISH",
            confidence: 0.91,
            returnBps: -18.2,
            volatilityRegime: "EXTREME",
            quantileSpreadBps: 65.1,
            pointForecast: [1.07],
            quantilesH1: [1.065, 1.075],
        });

        const signal = await service.enrichSignal(createMockSignal(), {
            candles: buildCandles(),
            config: {
                timesFmEnabled: true,
                timesFmMode: "veto",
                timesFmHorizonBars: 12,
                timesFmVetoConfidence: 0.75,
            },
        });

        expect(signal.timesFm).toEqual(
            expect.objectContaining({
                available: true,
                direction: "BEARISH",
                disagrees: true,
                vetoCandidate: true,
                positionSizeMultiplier: 0.5,
            })
        );
    });

    test("reuses cache within the ttl for the same candle key", async () => {
        const candles = buildCandles();
        const config = {
            timesFmEnabled: true,
            timesFmMode: "observe",
            timesFmHorizonBars: 12,
        };

        const first = await service.enrichSignal(createMockSignal(), {
            candles,
            config,
        });
        const second = await service.enrichSignal(createMockSignal(), {
            candles,
            config,
        });

        expect(client.getForecast).toHaveBeenCalledTimes(1);
        expect(first.timesFm.cacheHit).toBe(false);
        expect(second.timesFm.cacheHit).toBe(true);
    });

    test("fails open when the sidecar is unavailable", async () => {
        client.getForecast.mockResolvedValueOnce(null);
        client.getLastFailure.mockReturnValueOnce({
            reason: "sidecar_unavailable",
        });

        const signal = await service.enrichSignal(createMockSignal(), {
            candles: buildCandles(),
            config: {
                timesFmEnabled: true,
                timesFmMode: "observe",
            },
        });

        expect(signal.timesFm).toEqual(
            expect.objectContaining({
                available: false,
                reason: "sidecar_unavailable",
                positionSizeMultiplier: 1,
            })
        );
    });
});
