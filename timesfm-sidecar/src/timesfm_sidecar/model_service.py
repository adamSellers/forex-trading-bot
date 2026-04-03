from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from .settings import Settings

try:
    import timesfm  # type: ignore
except ImportError:  # pragma: no cover - exercised through health state
    timesfm = None

try:
    import torch  # type: ignore
except ImportError:  # pragma: no cover - exercised through health state
    torch = None


def compute_log_returns(closes: list[float]) -> np.ndarray:
    values = np.asarray(closes, dtype=np.float64)
    if values.size < 2:
        return np.asarray([], dtype=np.float64)
    return np.diff(np.log(values))


def invert_log_returns(last_price: float, predicted_returns: np.ndarray) -> np.ndarray:
    cumulative = np.cumsum(np.asarray(predicted_returns, dtype=np.float64))
    return np.asarray(last_price * np.exp(cumulative), dtype=np.float64)


def classify_direction(return_bps: float, dead_zone_bps: float) -> str:
    if return_bps > dead_zone_bps:
        return "BULLISH"
    if return_bps < -dead_zone_bps:
        return "BEARISH"
    return "NEUTRAL"


def classify_volatility_regime(spread_bps: float) -> str:
    if spread_bps < 10:
        return "LOW"
    if spread_bps < 30:
        return "NORMAL"
    if spread_bps < 60:
        return "HIGH"
    return "EXTREME"


def compute_direction_confidence(
    reference_price: float,
    direction: str,
    point_forecast_h1: float,
    quantiles_h1: list[float],
) -> float:
    if direction == "NEUTRAL":
        return 0.0

    direction_is_up = direction == "BULLISH"
    targets = list(quantiles_h1 or []) + [point_forecast_h1]
    if not targets:
        return 0.0

    agreeing = 0
    for value in targets:
        if direction_is_up and value > reference_price:
            agreeing += 1
        if not direction_is_up and value < reference_price:
            agreeing += 1

    return round(agreeing / len(targets), 4)


def compute_spread_bps(reference_price: float, quantiles_h1: list[float]) -> float:
    if len(quantiles_h1) < 2 or reference_price <= 0:
        return 0.0
    lower = min(quantiles_h1)
    upper = max(quantiles_h1)
    return round(((upper - lower) / reference_price) * 10000, 4)


@dataclass(slots=True)
class ForecastResult:
    instrument: str
    horizon: int
    input_bars: int
    preprocess_mode: str
    used_log_returns: bool
    inference_ms: float
    point_forecast: list[float]
    forecast_direction: str
    forecast_confidence: float
    forecast_return_bps: float
    volatility_regime: str
    quantile_spread_bps: float
    quantiles_h1: list[float]
    model: str
    device: str


class TimesFmModelService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model: Any | None = None
        self.ready = False
        self.load_ms: float | None = None
        self.device = "cpu"
        self.error: str | None = None
        self.torch_compile = settings.torch_compile

    def _resolve_device(self) -> str:
        if self.settings.device != "auto":
            return self.settings.device

        if torch is not None:
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
            if torch.cuda.is_available():
                return "cuda"

        return "cpu"

    def _build_forecast_config(self) -> Any:
        if timesfm is None or not hasattr(timesfm, "ForecastConfig"):
            raise RuntimeError("timesfm.ForecastConfig is unavailable")

        return timesfm.ForecastConfig(
            max_context=self.settings.max_context_bars,
            max_horizon=self.settings.max_horizon,
            normalize_inputs=True,
            force_flip_invariance=True,
            infer_is_positive=True,
            use_continuous_quantile_head=True,
            fix_quantile_crossing=True,
        )

    def _load_model(self, *, torch_compile: bool) -> Any:
        model_cls = getattr(timesfm, "TimesFM_2p5_200M_torch", None)
        if model_cls is None:
            raise RuntimeError(
                "Installed timesfm package does not expose TimesFM_2p5_200M_torch"
            )

        model = model_cls.from_pretrained(
            self.settings.model_name,
            torch_compile=torch_compile,
        )
        model.compile(self._build_forecast_config())
        return model

    def _infer_loaded_device(self) -> str:
        model_device = getattr(self.model, "device", None) or getattr(
            self.model, "_device", None
        )
        if model_device is not None:
            return str(model_device)

        return self._resolve_device()

    def startup(self) -> None:
        started_at = time.perf_counter()
        self.device = self._resolve_device()

        if timesfm is None:
            self.error = "timesfm package is not installed"
            self.ready = False
            return

        try:
            self.model = self._load_model(torch_compile=self.settings.torch_compile)
            self.torch_compile = self.settings.torch_compile
            self.ready = True
            self.error = None
            self.device = self._infer_loaded_device()
        except Exception as exc:  # pragma: no cover - depends on target install
            if self.settings.torch_compile:
                try:
                    self.model = self._load_model(torch_compile=False)
                    self.torch_compile = False
                    self.ready = True
                    self.error = None
                    self.device = self._infer_loaded_device()
                except Exception as fallback_exc:
                    self.model = None
                    self.ready = False
                    self.error = (
                        "TimesFM startup failed with torch_compile enabled "
                        f"({exc}) and without it ({fallback_exc})"
                    )
            else:
                self.model = None
                self.ready = False
                self.error = str(exc)
        finally:
            self.load_ms = round((time.perf_counter() - started_at) * 1000, 2)

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok" if self.ready else ("error" if self.error else "loading"),
            "model": self.settings.model_name,
            "device": self.device,
            "ready": self.ready,
            "load_ms": self.load_ms,
            "torch_compile": self.torch_compile,
            "error": self.error,
        }

    def _run_model(
        self, series: np.ndarray, horizon: int
    ) -> tuple[np.ndarray, np.ndarray | None]:
        if not self.ready or self.model is None:
            raise RuntimeError(self.error or "model not ready")

        raw_result = self.model.forecast(inputs=[series], horizon=horizon)

        point_forecast: np.ndarray
        quantiles: np.ndarray | None = None

        if isinstance(raw_result, tuple):
            point_forecast = np.asarray(raw_result[0])[0]
            if len(raw_result) > 1 and raw_result[1] is not None:
                quantiles = np.asarray(raw_result[1])[0]
        elif isinstance(raw_result, dict):
            point_forecast = np.asarray(raw_result.get("mean_forecast"))[0]
            quantile_values = raw_result.get("quantile_forecast")
            if quantile_values is not None:
                quantiles = np.asarray(quantile_values)[0]
        else:
            point_forecast = np.asarray(raw_result)[0]

        return point_forecast[:horizon], quantiles[:horizon] if quantiles is not None else None

    def forecast(
        self,
        instrument: str,
        closes: list[float],
        horizon: int,
        preprocess_mode: str = "raw",
        dead_zone_bps: float | None = None,
    ) -> ForecastResult:
        used_log_returns = preprocess_mode == "log_returns"
        input_series = np.asarray(closes[-self.settings.max_context_bars :], dtype=np.float64)
        last_price = float(input_series[-1])
        if used_log_returns and np.any(input_series <= 0):
            raise ValueError("log_returns preprocessing requires strictly positive prices")
        model_input = (
            compute_log_returns(input_series.tolist()) if used_log_returns else input_series
        )

        if model_input.size < self.settings.min_context_bars:
            raise ValueError("insufficient context")

        started_at = time.perf_counter()
        point_forecast, quantiles = self._run_model(model_input, horizon)
        inference_ms = round((time.perf_counter() - started_at) * 1000, 2)

        if used_log_returns:
            point_prices = invert_log_returns(last_price, point_forecast)
            quantile_prices = (
                np.asarray(
                    [invert_log_returns(last_price, row) for row in quantiles.T]
                ).T
                if quantiles is not None
                else None
            )
        else:
            point_prices = np.asarray(point_forecast, dtype=np.float64)
            quantile_prices = np.asarray(quantiles, dtype=np.float64) if quantiles is not None else None

        terminal_price = float(point_prices[min(len(point_prices) - 1, horizon - 1)])
        return_bps = round(((terminal_price - last_price) / last_price) * 10000, 4)
        direction = classify_direction(
            return_bps,
            dead_zone_bps if dead_zone_bps is not None else self.settings.default_dead_zone_bps,
        )

        quantiles_h1: list[float] = []
        if quantile_prices is not None and quantile_prices.ndim >= 2:
            quantiles_h1 = [
                round(float(value), 6) for value in np.asarray(quantile_prices[0]).tolist()
            ]

        confidence = compute_direction_confidence(
            last_price,
            direction,
            float(point_prices[0]),
            quantiles_h1,
        )
        quantile_spread_bps = compute_spread_bps(last_price, quantiles_h1)
        volatility_regime = classify_volatility_regime(quantile_spread_bps)

        return ForecastResult(
            instrument=instrument,
            horizon=horizon,
            input_bars=int(model_input.size),
            preprocess_mode=preprocess_mode,
            used_log_returns=used_log_returns,
            inference_ms=inference_ms,
            point_forecast=[round(float(value), 6) for value in point_prices.tolist()],
            forecast_direction=direction,
            forecast_confidence=confidence,
            forecast_return_bps=return_bps,
            volatility_regime=volatility_regime,
            quantile_spread_bps=quantile_spread_bps,
            quantiles_h1=quantiles_h1,
            model=self.settings.model_name,
            device=self.device,
        )
