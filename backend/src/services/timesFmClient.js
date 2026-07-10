const logger = require("../utils/logger");

function toFiniteNumber(value, fallback = null) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function trimTrailingSlash(value = "") {
    return String(value || "").replace(/\/+$/, "");
}

class TimesFmClient {
    constructor(options = {}) {
        this.baseUrl = trimTrailingSlash(
            options.baseUrl || process.env.TIMESFM_URL || "http://lathe.oakroad:5050"
        );
        this.apiKey =
            options.apiKey !== undefined
                ? options.apiKey
                : process.env.TIMESFM_KEY || "";
        this.defaultTimeoutMs = Number.isFinite(Number(options.defaultTimeoutMs))
            ? Number(options.defaultTimeoutMs)
            : 5000;
        this.fetchImpl =
            options.fetchImpl ||
            (typeof fetch === "function" ? fetch.bind(globalThis) : null);

        this.lastHealth = null;
        this.lastFailure = null;
        this.lastForecastAt = null;
        this.failureLogTimestamps = new Map();
    }

    isConfigured() {
        return Boolean(this.baseUrl);
    }

    hasAuth() {
        return Boolean(this.apiKey);
    }

    getLastFailure() {
        return this.lastFailure;
    }

    getStatusSnapshot() {
        return {
            baseUrl: this.baseUrl,
            configured: this.isConfigured(),
            authConfigured: this.hasAuth(),
            lastHealth: this.lastHealth,
            lastFailure: this.lastFailure,
            lastForecastAt: this.lastForecastAt,
        };
    }

    _buildHeaders(extra = {}) {
        const headers = {
            "Content-Type": "application/json",
            ...extra,
        };

        if (this.apiKey) {
            headers["X-TimesFM-Key"] = this.apiKey;
        }

        return headers;
    }

    _resolveFailureReason({ error = null, status = null } = {}) {
        if (status === 401 || status === 403) return "unauthorized";
        if (status === 404) return "not_found";
        if (status && status >= 500) return "sidecar_error";

        if (error?.name === "AbortError") {
            return "timeout";
        }

        return "sidecar_unavailable";
    }

    _warnThrottled(key, message, intervalMs = 60000) {
        const now = Date.now();
        const lastLoggedAt = this.failureLogTimestamps.get(key) || 0;
        if (now - lastLoggedAt < intervalMs) {
            return;
        }

        this.failureLogTimestamps.set(key, now);
        logger.warn(message);
    }

    async _request(
        path,
        { method = "GET", body = null, timeoutMs = this.defaultTimeoutMs } = {}
    ) {
        if (!this.fetchImpl) {
            const failure = {
                reason: "fetch_unavailable",
                message: "Global fetch is unavailable in this runtime",
                status: null,
                timestamp: Date.now(),
            };
            this.lastFailure = failure;
            return { ok: false, ...failure };
        }

        const controller = new AbortController();
        const startedAt = Date.now();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method,
                headers: this._buildHeaders(),
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });

            const latencyMs = Date.now() - startedAt;
            const contentType = response.headers.get("content-type") || "";
            const payload = contentType.includes("application/json")
                ? await response.json()
                : await response.text();

            if (!response.ok) {
                const failure = {
                    reason: this._resolveFailureReason({ status: response.status }),
                    message:
                        typeof payload === "string"
                            ? payload
                            : payload?.error || response.statusText,
                    status: response.status,
                    timestamp: Date.now(),
                };
                this.lastFailure = failure;
                this._warnThrottled(
                    `${path}:${failure.reason}:${response.status}`,
                    `TimesFM request failed (${response.status} ${path}): ${failure.message}`
                );
                return { ok: false, latencyMs, ...failure };
            }

            this.lastFailure = null;
            return { ok: true, data: payload, latencyMs };
        } catch (error) {
            const failure = {
                reason: this._resolveFailureReason({ error }),
                message: error?.message || "Request failed",
                status: null,
                timestamp: Date.now(),
            };
            this.lastFailure = failure;
            this._warnThrottled(
                `${path}:${failure.reason}`,
                `TimesFM request failed (${path}): ${failure.message}`
            );
            return { ok: false, ...failure };
        } finally {
            clearTimeout(timeout);
        }
    }

    _normalizeHealth(data = {}, latencyMs = null) {
        const ready =
            data.ready === undefined
                ? String(data.status || "").toLowerCase() === "ok"
                : Boolean(data.ready);

        return {
            ok: ready,
            connected: ready,
            status: data.status || (ready ? "ok" : "loading"),
            ready,
            model: data.model || null,
            device: data.device || null,
            loadMs: toFiniteNumber(data.load_ms ?? data.loadMs, null),
            latencyMs: toFiniteNumber(latencyMs, null),
            checkedAt: Date.now(),
        };
    }

    async checkHealth(options = {}) {
        const result = await this._request("/health", {
            method: "GET",
            timeoutMs:
                toFiniteNumber(options.timeoutMs, null) || this.defaultTimeoutMs,
        });

        if (!result.ok) {
            this.lastHealth = {
                ok: false,
                connected: false,
                status: result.reason || "sidecar_unavailable",
                ready: false,
                model: null,
                device: null,
                loadMs: null,
                latencyMs: toFiniteNumber(result.latencyMs, null),
                checkedAt: Date.now(),
                error: result.message || null,
            };
            return this.lastHealth;
        }

        this.lastHealth = this._normalizeHealth(result.data, result.latencyMs);
        return this.lastHealth;
    }

    _normalizeForecast(data = {}) {
        return {
            instrument: data.instrument || null,
            horizon: toFiniteNumber(data.horizon, null),
            inputBars: toFiniteNumber(data.input_bars ?? data.inputBars, null),
            preprocessMode: data.preprocess_mode || data.preprocessMode || "raw",
            usedLogReturns:
                data.used_log_returns === undefined
                    ? Boolean(data.usedLogReturns)
                    : Boolean(data.used_log_returns),
            inferenceMs: toFiniteNumber(data.inference_ms ?? data.inferenceMs, null),
            pointForecast: Array.isArray(data.point_forecast)
                ? data.point_forecast
                : Array.isArray(data.pointForecast)
                ? data.pointForecast
                : [],
            direction:
                data.forecast_direction || data.direction || "NEUTRAL",
            confidence: toFiniteNumber(
                data.forecast_confidence ?? data.confidence,
                0
            ),
            returnBps: toFiniteNumber(
                data.forecast_return_bps ?? data.returnBps,
                0
            ),
            volatilityRegime:
                data.volatility_regime || data.volatilityRegime || "NORMAL",
            quantileSpreadBps: toFiniteNumber(
                data.quantile_spread_bps ?? data.quantileSpreadBps,
                0
            ),
            quantilesH1: Array.isArray(data.quantiles_h1)
                ? data.quantiles_h1
                : Array.isArray(data.quantilesH1)
                ? data.quantilesH1
                : [],
            quantilesTerminal: Array.isArray(data.quantiles_terminal)
                ? data.quantiles_terminal
                : Array.isArray(data.quantilesTerminal)
                ? data.quantilesTerminal
                : [],
            confidenceHorizon: toFiniteNumber(
                data.confidence_horizon ?? data.confidenceHorizon,
                null
            ),
            terminalPointForecast: toFiniteNumber(
                data.terminal_point_forecast ?? data.terminalPointForecast,
                null
            ),
            model: data.model || null,
            device: data.device || null,
        };
    }

    async getForecast(instrument, closes, options = {}) {
        const result = await this._request("/forecast", {
            method: "POST",
            timeoutMs:
                toFiniteNumber(options.timeoutMs, null) || this.defaultTimeoutMs,
            body: {
                instrument,
                closes,
                horizon: options.horizon,
                preprocess_mode: options.preprocessMode,
                use_log_returns: options.useLogReturns,
                dead_zone_bps: options.deadZoneBps,
            },
        });

        if (!result.ok) {
            return null;
        }

        const forecast = this._normalizeForecast(result.data);
        this.lastForecastAt = Date.now();
        this.lastHealth = {
            ok: true,
            connected: true,
            status: "ok",
            ready: true,
            model: forecast.model,
            device: forecast.device,
            loadMs: this.lastHealth?.loadMs ?? null,
            latencyMs: forecast.inferenceMs ?? result.latencyMs ?? null,
            checkedAt: Date.now(),
        };
        return forecast;
    }
}

module.exports = TimesFmClient;
