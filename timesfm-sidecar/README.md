# TimesFM Sidecar

FastAPI sidecar for serving Google Research TimesFM 2.5 on Lathe.

## Purpose

- Runs on the Mac host, not the Raspberry Pi
- Loads the `google/timesfm-2.5-200m-pytorch` checkpoint once at startup
- Exposes a small authenticated HTTP API for forecast enrichment
- Fails independently from the Node.js bot
- Supports both optional TimesFM overlay enrichment and the native `timesfm_directional` strategy in the shared runtime

## Layout

- `pyproject.toml`: Python package metadata
- `requirements.lock`: pinned top-level dependency file for `uv`
- `src/timesfm_sidecar/`: application code
- `tests/`: unit and API tests
- `launchd/com.oakroad.timesfm.plist`: launchd template for Lathe

## Install On Lathe

```bash
cd /path/to/forex-trading-bot/timesfm-sidecar
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.lock
uv pip install -e .
```

The `timesfm` dependency is pulled from the official
`google-research/timesfm` repository so the sidecar uses the documented
TimesFM 2.5 torch loader for `google/timesfm-2.5-200m-pytorch`. Hugging Face
also provides a Transformers-format checkpoint, but this sidecar is currently
wired to the upstream PyTorch loader.

Set environment variables before first run:

```bash
export TIMESFM_HOST="192.168.1.50"
export TIMESFM_PORT="5050"
export TIMESFM_API_KEY="replace-me"
export TIMESFM_MODEL_NAME="google/timesfm-2.5-200m-pytorch"
export TIMESFM_TORCH_COMPILE="true"
```

Start manually:

```bash
uvicorn timesfm_sidecar.app:app --host "$TIMESFM_HOST" --port "$TIMESFM_PORT"
```

## API

### `GET /health`

Returns:

```json
{
  "status": "ok",
  "model": "google/timesfm-2.5-200m-pytorch",
  "device": "mps",
  "ready": true,
  "load_ms": 8342
}
```

### `POST /forecast`

Request:

```json
{
  "instrument": "EUR_USD",
  "closes": [1.0812, 1.0813, 1.0814],
  "horizon": 12
}
```

The request must include `X-TimesFM-Key`.

## Notes

- Default preprocessing is raw prices with TimesFM's upstream normalization path
- `log_returns` is supported as an experiment, but is not the production default
- Upstream TimesFM 2.5 returns first-step quantiles as `[mean, q10, q20, ...,
  q90]`; the sidecar keeps that raw array in `quantiles_h1`, but derives
  volatility spread from q10/q90 and uses only the q10-q90 fan for confidence
- The service first tries `torch_compile=true` and falls back to `false` if the
  Mac runtime rejects it
- Upstream XReg covariates and LoRA fine-tuning examples are available, but are
  not wired into the trading bot yet
- Refresh `requirements.lock` with `uv lock` on Lathe if upstream packages move
- If the sidecar is unavailable, normal strategies fail open without the forecast overlay; the native `timesfm_directional` strategy emits HOLD until a forecast is available
