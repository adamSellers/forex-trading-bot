from fastapi.testclient import TestClient

from timesfm_sidecar.app import build_app


class FakeService:
    ready = True

    def startup(self):
        return None

    def health(self):
        return {
            "status": "ok",
            "model": "google/timesfm-2.5-200m-pytorch",
            "device": "mps",
            "ready": True,
            "load_ms": 1000,
        }

    def forecast(self, **_kwargs):
        class Result:
            instrument = "EUR_USD"
            horizon = 12
            input_bars = 500
            preprocess_mode = "raw"
            used_log_returns = False
            inference_ms = 123.4
            point_forecast = [1.082, 1.083]
            forecast_direction = "BULLISH"
            forecast_confidence = 0.8
            forecast_return_bps = 12.5
            volatility_regime = "NORMAL"
            quantile_spread_bps = 18.2
            quantiles_h1 = [1.0815, 1.0825]
            model = "google/timesfm-2.5-200m-pytorch"
            device = "mps"

        return Result()


def test_health_endpoint():
    client = TestClient(build_app(FakeService()))
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_forecast_endpoint_requires_payload():
    client = TestClient(build_app(FakeService()))
    response = client.post(
        "/forecast",
        json={
            "instrument": "EUR_USD",
            "closes": [1.08] * 50,
            "horizon": 12,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["forecast_direction"] == "BULLISH"
    assert body["quantile_spread_bps"] == 18.2
