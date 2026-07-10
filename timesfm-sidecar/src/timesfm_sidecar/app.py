from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .model_service import TimesFmModelService
from .settings import settings


class ForecastRequest(BaseModel):
    instrument: str = Field(min_length=3)
    closes: list[float] = Field(min_length=50, max_length=16384)
    horizon: int = Field(default=12, ge=1, le=256)
    preprocess_mode: Literal["raw", "log_returns"] = "raw"
    use_log_returns: bool = False
    dead_zone_bps: float | None = Field(default=None, ge=0)

    @field_validator("closes")
    @classmethod
    def validate_closes(cls, value: list[float]) -> list[float]:
        if not all(isinstance(item, (int, float)) for item in value):
            raise ValueError("closes must be numeric")
        return [float(item) for item in value]

    def resolved_preprocess_mode(self) -> str:
        return "log_returns" if self.use_log_returns else self.preprocess_mode


def build_app(service: TimesFmModelService | None = None) -> FastAPI:
    model_service = service or TimesFmModelService(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        model_service.startup()
        yield

    app = FastAPI(
        title="TimesFM Sidecar",
        version="0.1.0",
        lifespan=lifespan,
    )

    def require_api_key(x_timesfm_key: str | None = Header(default=None)) -> None:
        if settings.api_key and x_timesfm_key != settings.api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid TimesFM API key",
            )

    @app.get("/health")
    def health() -> dict:
        return model_service.health()

    @app.post("/forecast", dependencies=[Depends(require_api_key)])
    def forecast(request: ForecastRequest) -> dict:
        if not model_service.ready:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="model is still loading",
            )

        try:
            result = model_service.forecast(
                instrument=request.instrument,
                closes=request.closes,
                horizon=request.horizon,
                preprocess_mode=request.resolved_preprocess_mode(),
                dead_zone_bps=request.dead_zone_bps,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(exc),
            ) from exc

        return {
            "instrument": result.instrument,
            "horizon": result.horizon,
            "input_bars": result.input_bars,
            "preprocess_mode": result.preprocess_mode,
            "used_log_returns": result.used_log_returns,
            "inference_ms": result.inference_ms,
            "point_forecast": result.point_forecast,
            "forecast_direction": result.forecast_direction,
            "forecast_confidence": result.forecast_confidence,
            "forecast_return_bps": result.forecast_return_bps,
            "volatility_regime": result.volatility_regime,
            "quantile_spread_bps": result.quantile_spread_bps,
            "quantiles_h1": result.quantiles_h1,
            "quantiles_terminal": result.quantiles_terminal,
            "confidence_horizon": result.confidence_horizon,
            "terminal_point_forecast": result.terminal_point_forecast,
            "model": result.model,
            "device": result.device,
        }

    return app


app = build_app()
