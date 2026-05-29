const logger = require("../utils/logger");

const DEFAULT_VOLATILITY_MULTIPLIERS = {
    LOW: 1.0,
    NORMAL: 1.0,
    HIGH: 0.7,
    EXTREME: 0.5,
};

function toFiniteNumber(value, fallback = null) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeMode(mode) {
    const normalized = String(mode || "disabled").trim().toLowerCase();
    return ["disabled", "observe", "size", "veto"].includes(normalized)
        ? normalized
        : "disabled";
}

class TimesFmSignalService {
    constructor(options = {}) {
        this.client = options.client || null;
        this.dataService = options.dataService || null;
        this.maxContextBars = Number.isFinite(Number(options.maxContextBars))
            ? Number(options.maxContextBars)
            : 500;
        this.minContextBars = Number.isFinite(Number(options.minContextBars))
            ? Number(options.minContextBars)
            : 50;
        this.cacheTtlMs = Number.isFinite(Number(options.cacheTtlMs))
            ? Number(options.cacheTtlMs)
            : 60000;
        this.healthStaleMs = Number.isFinite(Number(options.healthStaleMs))
            ? Number(options.healthStaleMs)
            : 30000;
        this.failureBackoffMs = Number.isFinite(Number(options.failureBackoffMs))
            ? Number(options.failureBackoffMs)
            : 30000;
        this.preprocessMode =
            options.preprocessMode || process.env.TIMESFM_PREPROCESS_MODE || "raw";
        this.volatilityMultipliers = {
            ...DEFAULT_VOLATILITY_MULTIPLIERS,
            ...(options.volatilityMultipliers || {}),
        };

        this.cache = new Map();
        this.inFlightForecasts = new Map();
        this.failureBackoff = new Map();
        this.healthPromise = null;
    }

    _isEnabled(config = {}) {
        return config.timesFmEnabled === true && normalizeMode(config.timesFmMode) !== "disabled";
    }

    _isActionable(signal = {}) {
        return (
            (signal.signal === "BUY" || signal.signal === "SELL") &&
            signal.entryType !== "EXIT_ONLY"
        );
    }

    _getSignalDirection(signal = {}) {
        return signal.signal === "BUY"
            ? "BULLISH"
            : signal.signal === "SELL"
            ? "BEARISH"
            : "NEUTRAL";
    }

    _getPositionSizeMultiplier(volatilityRegime) {
        return (
            this.volatilityMultipliers[String(volatilityRegime || "NORMAL").toUpperCase()] ||
            1.0
        );
    }

    _extractCloses(candles = []) {
        return candles
            .map((candle) =>
                toFiniteNumber(
                    typeof candle === "number" ? candle : candle?.close,
                    NaN
                )
            )
            .filter((value) => Number.isFinite(value));
    }

    _getLastCandleTime(candles = []) {
        const last = candles[candles.length - 1];
        if (!last) return null;
        return last.time || last.timestamp || null;
    }

    _buildCacheKey({
        instrument,
        timeframe,
        horizon,
        lastCandleTime,
        preprocessMode,
        deadZoneBps,
    }) {
        return [
            instrument || "UNKNOWN",
            timeframe || "15m",
            horizon || 12,
            lastCandleTime || "no-candle-time",
            preprocessMode || "raw",
            deadZoneBps || 3,
        ].join("|");
    }

    _buildUnavailableContext(reason, extras = {}) {
        return {
            available: false,
            connected: false,
            enabled: extras.enabled === true,
            mode: extras.mode || "disabled",
            configured: extras.configured === true,
            preprocessMode: extras.preprocessMode || this.preprocessMode,
            reason,
            horizon: extras.horizon || null,
            inputBars: extras.inputBars ?? null,
            usedLogReturns: false,
            direction: null,
            confidence: 0,
            returnBps: 0,
            volatilityRegime: null,
            quantileSpreadBps: null,
            inferenceMs: null,
            agrees: false,
            disagrees: false,
            neutral: false,
            vetoCandidate: false,
            positionSizeMultiplier: 1.0,
            cacheHit: false,
            fetchedAt: Date.now(),
            lastCandleTime: extras.lastCandleTime || null,
            forecast: {
                pointForecast: [],
                quantilesH1: [],
            },
        };
    }

    _buildAvailableContext(signal, forecast, extras = {}) {
        const signalDirection = this._getSignalDirection(signal);
        const direction = forecast.direction || "NEUTRAL";
        const confidence = Math.max(
            0,
            Math.min(1, toFiniteNumber(forecast.confidence, 0))
        );
        const neutral = direction === "NEUTRAL";
        const agrees = direction === signalDirection;
        const disagrees =
            !neutral && signalDirection !== "NEUTRAL" && direction !== signalDirection;
        const vetoConfidence = toFiniteNumber(extras.vetoConfidence, 0.75) || 0.75;

        return {
            available: true,
            connected: true,
            enabled: extras.enabled === true,
            mode: extras.mode || "observe",
            configured: extras.configured === true,
            preprocessMode: forecast.preprocessMode || extras.preprocessMode,
            reason: null,
            horizon: forecast.horizon || extras.horizon || null,
            inputBars: forecast.inputBars ?? extras.inputBars ?? null,
            usedLogReturns: forecast.usedLogReturns === true,
            direction,
            confidence,
            returnBps: toFiniteNumber(forecast.returnBps, 0) || 0,
            volatilityRegime: forecast.volatilityRegime || "NORMAL",
            quantileSpreadBps: toFiniteNumber(forecast.quantileSpreadBps, 0) || 0,
            inferenceMs: toFiniteNumber(forecast.inferenceMs, null),
            agrees,
            disagrees,
            neutral,
            vetoCandidate: disagrees && confidence >= vetoConfidence,
            positionSizeMultiplier: this._getPositionSizeMultiplier(
                forecast.volatilityRegime
            ),
            cacheHit: extras.cacheHit === true,
            fetchedAt: Date.now(),
            lastCandleTime: extras.lastCandleTime || null,
            model: forecast.model || null,
            device: forecast.device || null,
            forecast: {
                pointForecast: Array.isArray(forecast.pointForecast)
                    ? forecast.pointForecast
                    : [],
                quantilesH1: Array.isArray(forecast.quantilesH1)
                    ? forecast.quantilesH1
                    : [],
            },
        };
    }

    _resolveRequestOptions(config = {}) {
        const mode = normalizeMode(config.timesFmMode);
        const enabled = config.timesFmEnabled === true;
        const configured = this.client?.isConfigured?.() === true;
        const horizon =
            toFiniteNumber(config.timesFmHorizonBars, null) || 12;
        const timeoutMs =
            toFiniteNumber(config.timesFmTimeoutMs, null) ||
            this.client?.defaultTimeoutMs ||
            5000;
        const deadZoneBps =
            toFiniteNumber(config.timesFmDeadZoneBps, null) || 3;

        return {
            mode,
            enabled,
            configured,
            horizon,
            timeoutMs,
            deadZoneBps,
            baseMeta: {
                enabled,
                mode,
                configured,
                horizon,
                preprocessMode: this.preprocessMode,
            },
        };
    }

    async _resolveForecastRequest({
        instrument,
        candles = [],
        timeframe = "15m",
        config = {},
    } = {}) {
        const request = this._resolveRequestOptions(config);

        if (!request.enabled || request.mode === "disabled") {
            return {
                ...request,
                unavailableReason: "disabled",
            };
        }

        if (!request.configured) {
            return {
                ...request,
                unavailableReason: "not_configured",
            };
        }

        this.refreshHealthIfStale();

        const closes = this._extractCloses(candles).slice(-this.maxContextBars);
        const lastCandleTime = this._getLastCandleTime(candles) || null;

        if (closes.length < this.minContextBars) {
            return {
                ...request,
                inputBars: closes.length,
                lastCandleTime,
                unavailableReason: "insufficient_context",
            };
        }

        const cacheKey = this._buildCacheKey({
            instrument,
            timeframe,
            horizon: request.horizon,
            lastCandleTime,
            preprocessMode: this.preprocessMode,
            deadZoneBps: request.deadZoneBps,
        });
        const cached = this.cache.get(cacheKey);
        const isCacheValid =
            cached &&
            Date.now() - cached.cachedAt < this.cacheTtlMs &&
            cached.forecast;

        let forecast = isCacheValid ? cached.forecast : null;
        let cacheHit = Boolean(isCacheValid);

        if (!forecast) {
            const recentFailure = this.failureBackoff.get(cacheKey);
            if (
                recentFailure &&
                Date.now() - recentFailure.failedAt < this.failureBackoffMs
            ) {
                return {
                    ...request,
                    inputBars: closes.length,
                    lastCandleTime,
                    unavailableReason:
                        recentFailure.reason || "sidecar_unavailable",
                };
            }

            const existingRequest = this.inFlightForecasts.get(cacheKey);
            if (existingRequest) {
                forecast = await existingRequest;
            } else {
                const forecastRequest = this.client
                    .getForecast(instrument, closes, {
                        horizon: request.horizon,
                        timeoutMs: request.timeoutMs,
                        preprocessMode: this.preprocessMode,
                        useLogReturns: false,
                        deadZoneBps: request.deadZoneBps,
                    })
                    .then((result) => {
                        if (result) {
                            this.failureBackoff.delete(cacheKey);
                            this.cache.set(cacheKey, {
                                forecast: result,
                                cachedAt: Date.now(),
                            });
                            return result;
                        }

                        const failure = this.client.getLastFailure?.();
                        this.failureBackoff.set(cacheKey, {
                            failedAt: Date.now(),
                            reason: failure?.reason || "sidecar_unavailable",
                        });
                        return null;
                    })
                    .finally(() => {
                        this.inFlightForecasts.delete(cacheKey);
                    });

                this.inFlightForecasts.set(cacheKey, forecastRequest);
                forecast = await forecastRequest;
            }

            if (!forecast) {
                const recentFailureAfterRequest = this.failureBackoff.get(cacheKey);
                return {
                    ...request,
                    inputBars: closes.length,
                    lastCandleTime,
                    unavailableReason:
                        recentFailureAfterRequest?.reason ||
                        this.client.getLastFailure?.()?.reason ||
                        "sidecar_unavailable",
                };
            }
        }

        return {
            ...request,
            forecast,
            cacheHit,
            inputBars: closes.length,
            lastCandleTime,
        };
    }

    async refreshHealth(force = false) {
        if (!this.client?.checkHealth) {
            return null;
        }

        const snapshot = this.client.getStatusSnapshot();
        const lastCheckedAt = snapshot?.lastHealth?.checkedAt || 0;
        const isFresh =
            !force &&
            lastCheckedAt > 0 &&
            Date.now() - lastCheckedAt < this.healthStaleMs;

        if (isFresh) {
            return snapshot.lastHealth;
        }

        if (!force && this.healthPromise) {
            return this.healthPromise;
        }

        this.healthPromise = this.client
            .checkHealth({ timeoutMs: 2000 })
            .catch((error) => {
                logger.warn(`TimesFM health check failed: ${error.message}`);
                return null;
            })
            .finally(() => {
                this.healthPromise = null;
            });

        return this.healthPromise;
    }

    refreshHealthIfStale() {
        this.refreshHealth(false).catch((error) => {
            logger.warn(`TimesFM health refresh failed: ${error.message}`);
        });
    }

    getStatus(config = {}) {
        const mode = normalizeMode(config.timesFmMode);
        const enabled = config.timesFmEnabled === true;
        const snapshot = this.client?.getStatusSnapshot?.() || {};
        const health = snapshot.lastHealth || null;
        const failure = snapshot.lastFailure || null;
        const available = health?.ok === true;

        return {
            enabled,
            mode,
            configured: snapshot.configured === true,
            authConfigured: snapshot.authConfigured === true,
            url: snapshot.baseUrl || null,
            connected: available,
            available,
            status:
                mode === "disabled" || !enabled
                    ? "disabled"
                    : health?.status || "unknown",
            ready: health?.ready === true,
            model: health?.model || null,
            device: health?.device || null,
            loadMs: toFiniteNumber(health?.loadMs, null),
            latencyMs: toFiniteNumber(health?.latencyMs, null),
            lastCheckedAt: health?.checkedAt || null,
            lastForecastAt: snapshot.lastForecastAt || null,
            lastFailureReason: failure?.reason || null,
            lastErrorAt: failure?.timestamp || null,
            lastErrorMessage: failure?.message || null,
            preprocessMode: this.preprocessMode,
        };
    }

    async getForecastContext(options = {}) {
        const result = await this._resolveForecastRequest(options);

        if (!result.forecast) {
            return this._buildUnavailableContext(result.unavailableReason, {
                ...result.baseMeta,
                inputBars: result.inputBars ?? null,
                lastCandleTime: result.lastCandleTime || null,
            });
        }

        return this._buildAvailableContext(
            {
                signal: "HOLD",
                entryType: null,
            },
            result.forecast,
            {
                ...result.baseMeta,
                inputBars: result.inputBars ?? null,
                lastCandleTime: result.lastCandleTime || null,
                cacheHit: result.cacheHit === true,
            }
        );
    }

    async enrichSignal(signal, options = {}) {
        const config = options.config || {};
        const request = this._resolveRequestOptions(config);
        const { mode, enabled, configured, baseMeta } = request;

        if (!enabled || mode === "disabled") {
            return {
                ...signal,
                timesFm: this._buildUnavailableContext("disabled", baseMeta),
            };
        }

        if (!this._isActionable(signal)) {
            return {
                ...signal,
                timesFm: this._buildUnavailableContext("not_actionable", baseMeta),
            };
        }

        if (!configured) {
            return {
                ...signal,
                timesFm: this._buildUnavailableContext("not_configured", baseMeta),
            };
        }

        const timeframe = options.timeframe || signal.timeframe || "15m";
        const candles = Array.isArray(options.candles)
            ? options.candles
            : this.dataService?.getCandles?.(signal.symbol, timeframe) || [];
        const result = await this._resolveForecastRequest({
            instrument: signal.symbol,
            candles,
            timeframe,
            config,
        });

        if (!result.forecast) {
            return {
                ...signal,
                timesFm: this._buildUnavailableContext(result.unavailableReason, {
                    ...baseMeta,
                    inputBars: result.inputBars ?? null,
                    lastCandleTime:
                        result.lastCandleTime || signal.signalCandleTime || null,
                }),
            };
        }

        return {
            ...signal,
            timesFm: this._buildAvailableContext(signal, result.forecast, {
                ...baseMeta,
                inputBars: result.inputBars ?? null,
                lastCandleTime:
                    result.lastCandleTime || signal.signalCandleTime || null,
                cacheHit: result.cacheHit === true,
                vetoConfidence:
                    toFiniteNumber(config.timesFmVetoConfidence, null) || 0.75,
            }),
        };
    }
}

module.exports = TimesFmSignalService;
