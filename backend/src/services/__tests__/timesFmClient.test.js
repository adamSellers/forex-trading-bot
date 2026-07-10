const TimesFmClient = require("../timesFmClient");

describe("TimesFmClient", () => {
    test("checkHealth parses sidecar health responses", async () => {
        const client = new TimesFmClient({
            baseUrl: "http://timesfm.test",
            fetchImpl: jest.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => "application/json" },
                json: async () => ({
                    status: "ok",
                    model: "google/timesfm-2.5-200m-pytorch",
                    device: "mps",
                    ready: true,
                    load_ms: 1234,
                }),
            }),
        });
        const health = await client.checkHealth();

        expect(health).toEqual(
            expect.objectContaining({
                ok: true,
                connected: true,
                status: "ok",
                model: "google/timesfm-2.5-200m-pytorch",
                device: "mps",
                ready: true,
                loadMs: 1234,
            })
        );
    });

    test("getForecast normalizes forecast payloads", async () => {
        const client = new TimesFmClient({
            baseUrl: "http://timesfm.test",
            fetchImpl: jest.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => "application/json" },
                json: async () => ({
                    instrument: "EUR_USD",
                    horizon: 12,
                    input_bars: 500,
                    preprocess_mode: "raw",
                    used_log_returns: false,
                    inference_ms: 91.2,
                    point_forecast: [1.0812, 1.0816],
                    forecast_direction: "BULLISH",
                    forecast_confidence: 0.82,
                    forecast_return_bps: 13.4,
                    volatility_regime: "HIGH",
                    quantile_spread_bps: 41.5,
                    quantiles_h1: [1.0809, 1.0818],
                    quantiles_terminal: [1.079, 1.084],
                    confidence_horizon: 12,
                    terminal_point_forecast: 1.083,
                }),
            }),
        });
        const forecast = await client.getForecast("EUR_USD", new Array(500).fill(1.08), {
            horizon: 12,
        });

        expect(forecast).toEqual(
            expect.objectContaining({
                instrument: "EUR_USD",
                horizon: 12,
                inputBars: 500,
                preprocessMode: "raw",
                usedLogReturns: false,
                direction: "BULLISH",
                confidence: 0.82,
                returnBps: 13.4,
                volatilityRegime: "HIGH",
                quantileSpreadBps: 41.5,
                quantilesH1: [1.0809, 1.0818],
                quantilesTerminal: [1.079, 1.084],
                confidenceHorizon: 12,
                terminalPointForecast: 1.083,
            })
        );
    });

    test("getForecast returns null and records failures", async () => {
        const client = new TimesFmClient({
            baseUrl: "http://timesfm.test",
            fetchImpl: jest.fn().mockResolvedValue({
                ok: false,
                status: 503,
                statusText: "Service Unavailable",
                headers: { get: () => "application/json" },
                json: async () => ({ error: "loading" }),
            }),
        });
        const forecast = await client.getForecast("EUR_USD", new Array(500).fill(1.08), {
            horizon: 12,
        });

        expect(forecast).toBeNull();
        expect(client.getLastFailure()).toEqual(
            expect.objectContaining({
                reason: "sidecar_error",
            })
        );
    });
});
