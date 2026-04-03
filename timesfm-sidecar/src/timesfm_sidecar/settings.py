from dataclasses import dataclass
import os


def _as_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _as_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(slots=True)
class Settings:
    host: str = os.getenv("TIMESFM_HOST", "127.0.0.1")
    port: int = _as_int("TIMESFM_PORT", 5050)
    api_key: str = os.getenv("TIMESFM_API_KEY", "")
    model_name: str = os.getenv(
        "TIMESFM_MODEL_NAME", "google/timesfm-2.5-200m-pytorch"
    )
    max_context_bars: int = _as_int("TIMESFM_MAX_CONTEXT_BARS", 512)
    min_context_bars: int = _as_int("TIMESFM_MIN_CONTEXT_BARS", 50)
    max_horizon: int = _as_int("TIMESFM_MAX_HORIZON", 256)
    default_dead_zone_bps: float = _as_float("TIMESFM_DEAD_ZONE_BPS", 3.0)
    device: str = os.getenv("TIMESFM_DEVICE", "auto")
    torch_compile: bool = _as_bool("TIMESFM_TORCH_COMPILE", True)


settings = Settings()
