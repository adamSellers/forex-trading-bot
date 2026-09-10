const DEFAULT_PORTFOLIO_RISK_LIMITS = Object.freeze({
    maxAggregateStopRiskPctNav: 0.01,
    maxNetCurrencyExposurePctNav: 2,
    maxCorrelatedExposurePctNav: 2,
    maxDailyLossPctNav: 0.02,
    maxDrawdownPctNav: 0.08,
    maxConsecutiveLosses: 3,
    correlationThreshold: 0.7,
    minNavAud: 50,
});

const CONSECUTIVE_LOSS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveLimit(config, key) {
    const fallback = DEFAULT_PORTFOLIO_RISK_LIMITS[key];
    const value = toFiniteNumber(config?.[key], fallback);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeInstrument(instrument) {
    const [base, quote] = String(instrument || "").toUpperCase().split("_");
    return base && quote ? { base, quote } : null;
}

function positionNotionalAud(position = {}) {
    const value = toFiniteNumber(
        position.notionalAud,
        toFiniteNumber(position.exposureAud, null)
    );
    return Number.isFinite(value) ? Math.abs(value) : null;
}

function positionStopRiskAud(position = {}) {
    const explicit = toFiniteNumber(position.stopRiskAud, null);
    if (Number.isFinite(explicit)) return Math.max(0, explicit);

    const units = Math.abs(toFiniteNumber(position.units, NaN));
    const entryPrice = toFiniteNumber(position.entryPrice, NaN);
    const stopPrice = toFiniteNumber(position.stopLossPrice, NaN);
    const quoteToAud = toFiniteNumber(position.quoteToAud, NaN);
    if (
        [units, entryPrice, stopPrice, quoteToAud].every(Number.isFinite)
    ) {
        return Math.abs(entryPrice - stopPrice) * units * quoteToAud;
    }

    return null;
}

function addCurrencyExposure(exposures, position = {}) {
    const pair = normalizeInstrument(position.instrument);
    const notional = positionNotionalAud(position);
    if (!pair || !Number.isFinite(notional)) return false;

    const direction = String(position.side || "BUY").toUpperCase() === "SELL" ? -1 : 1;
    exposures[pair.base] = (exposures[pair.base] || 0) + direction * notional;
    exposures[pair.quote] = (exposures[pair.quote] || 0) - direction * notional;
    return true;
}

function correlationFor(left, right, correlations = {}) {
    if (!left || !right || left === right) return left === right ? 1 : 0;
    const direct = toFiniteNumber(
        correlations[`${left}|${right}`] ?? correlations?.[left]?.[right],
        null
    );
    if (Number.isFinite(direct)) return direct;
    return toFiniteNumber(
        correlations[`${right}|${left}`] ?? correlations?.[right]?.[left],
        0
    );
}

function evaluateConsecutiveLossCooldown({
    closedTrades = [],
    maxConsecutiveLosses = DEFAULT_PORTFOLIO_RISK_LIMITS.maxConsecutiveLosses,
    cooldownMs = CONSECUTIVE_LOSS_COOLDOWN_MS,
    evaluatedAt = Date.now(),
} = {}) {
    const threshold = Math.max(
        1,
        Math.floor(
            toFiniteNumber(
                maxConsecutiveLosses,
                DEFAULT_PORTFOLIO_RISK_LIMITS.maxConsecutiveLosses
            )
        )
    );
    const durationMs = Math.max(
        1,
        Math.floor(toFiniteNumber(cooldownMs, CONSECUTIVE_LOSS_COOLDOWN_MS))
    );
    const now = toFiniteNumber(evaluatedAt, Date.now());
    const orderedTrades = (Array.isArray(closedTrades) ? closedTrades : [])
        .filter(
            (trade) =>
                trade?.exitTime !== null &&
                trade?.exitTime !== undefined &&
                trade?.exitTime !== "" &&
                trade?.pnlAud !== null &&
                trade?.pnlAud !== undefined &&
                trade?.pnlAud !== "" &&
                Number.isFinite(Number(trade.exitTime)) &&
                Number.isFinite(Number(trade.pnlAud))
        )
        .sort(
            (left, right) =>
                toFiniteNumber(left.exitTime, 0) -
                toFiniteNumber(right.exitTime, 0)
        );

    let consecutiveLosses = 0;
    let cooldownStartedAt = null;
    let cooldownUntil = null;
    let lastCooldownUntil = null;
    let lastLossAt = null;
    let streakResetAt = null;

    orderedTrades.forEach((trade) => {
        const exitTime = toFiniteNumber(trade.exitTime, null);
        if (cooldownUntil !== null && exitTime >= cooldownUntil) {
            consecutiveLosses = 0;
            streakResetAt = cooldownUntil;
            lastCooldownUntil = cooldownUntil;
            cooldownStartedAt = null;
            cooldownUntil = null;
        }

        if (toFiniteNumber(trade.pnlAud, 0) >= 0) {
            consecutiveLosses = 0;
            streakResetAt = exitTime;
            cooldownStartedAt = null;
            cooldownUntil = null;
            return;
        }

        consecutiveLosses += 1;
        lastLossAt = exitTime;
        if (consecutiveLosses >= threshold) {
            cooldownStartedAt = exitTime;
            cooldownUntil = exitTime + durationMs;
            lastCooldownUntil = cooldownUntil;
        }
    });

    if (cooldownUntil !== null && now >= cooldownUntil) {
        consecutiveLosses = 0;
        streakResetAt = cooldownUntil;
        lastCooldownUntil = cooldownUntil;
        cooldownStartedAt = null;
        cooldownUntil = null;
    }

    const cooldownActive = cooldownUntil !== null && now < cooldownUntil;
    return {
        status: cooldownActive ? "COOLDOWN" : "READY",
        entryAllowed: !cooldownActive,
        cooldownActive,
        consecutiveLosses,
        maxConsecutiveLosses: threshold,
        cooldownDurationMs: durationMs,
        cooldownStartedAt,
        cooldownUntil,
        remainingMs: cooldownActive ? Math.max(0, cooldownUntil - now) : 0,
        lastLossAt,
        lastCooldownUntil,
        streakResetAt,
        evaluatedAt: now,
    };
}

function evaluateRunLossCooldown({
    trades,
    runId = null,
    config = {},
    carryover = null,
    evaluatedAt = Date.now(),
} = {}) {
    if (!Array.isArray(trades)) {
        throw new Error("Closed trade history is unavailable");
    }
    const closedTrades = trades.filter((trade) =>
        !trade.isOpen && (!runId || (trade.ownerRunId || trade.runId || null) === runId)
    );
    if (closedTrades.some((trade) => [trade.exitTime, trade.pnlAud].some(
        (value) => value === null || value === undefined || value === "" ||
            !Number.isFinite(Number(value))
    ))) {
        throw new Error("Closed trade risk history is incomplete");
    }
    const state = {
        ...evaluateConsecutiveLossCooldown({
            closedTrades,
            maxConsecutiveLosses: config.maxConsecutiveLosses,
            evaluatedAt,
        }),
        runId,
    };
    if (!carryover) return state;
    if (!carryover.sourceRunId || ![
        carryover.cooldownStartedAt,
        carryover.cooldownUntil,
        carryover.consecutiveLosses,
        carryover.maxConsecutiveLosses,
    ].every(Number.isFinite) ||
        carryover.cooldownUntil <= carryover.cooldownStartedAt ||
        carryover.maxConsecutiveLosses < 1 ||
        carryover.consecutiveLosses < carryover.maxConsecutiveLosses
    ) {
        throw new Error("Release cooldown carryover is incomplete");
    }
    if (evaluatedAt >= carryover.cooldownUntil ||
        (state.cooldownActive && state.cooldownUntil >= carryover.cooldownUntil)) {
        return state;
    }
    // A release can inherit an existing stop, never the prior cohort's loss streak.
    // Its original deadline survives restarts and is not extended by deployment.
    return {
        ...state,
        status: "COOLDOWN",
        entryAllowed: false,
        cooldownActive: true,
        consecutiveLosses: carryover.consecutiveLosses,
        maxConsecutiveLosses: carryover.maxConsecutiveLosses,
        cooldownStartedAt: carryover.cooldownStartedAt,
        cooldownUntil: carryover.cooldownUntil,
        cooldownDurationMs: carryover.cooldownUntil - carryover.cooldownStartedAt,
        remainingMs: carryover.cooldownUntil - evaluatedAt,
        lastLossAt: carryover.cooldownStartedAt,
        lastCooldownUntil: carryover.cooldownUntil,
        cooldownSourceRunId: carryover.sourceRunId,
    };
}

function evaluatePortfolioRisk({
    navAud,
    openPositions = [],
    proposedTrade = null,
    dailyRealizedPnlAud = 0,
    highWatermarkNavAud = null,
    consecutiveLosses = 0,
    lossStreakState = null,
    correlations = {},
    config = {},
} = {}) {
    const reasons = [];
    const nav = toFiniteNumber(navAud, null);
    const positions = [
        ...(Array.isArray(openPositions) ? openPositions : []),
        ...(proposedTrade ? [proposedTrade] : []),
    ];
    const limits = Object.keys(DEFAULT_PORTFOLIO_RISK_LIMITS).reduce(
        (acc, key) => ({ ...acc, [key]: positiveLimit(config, key) }),
        {}
    );

    if (!Number.isFinite(nav) || nav <= 0) {
        reasons.push({
            code: "NAV_UNAVAILABLE",
            message: "A positive AUD NAV is required for portfolio risk approval",
        });
    } else if (nav < limits.minNavAud) {
        reasons.push({
            code: "MIN_NAV",
            actualAud: nav,
            minimumAud: limits.minNavAud,
        });
    }

    const stopRisks = positions.map(positionStopRiskAud);
    if (stopRisks.some((value) => !Number.isFinite(value))) {
        reasons.push({
            code: "STOP_RISK_UNAVAILABLE",
            message: "Every open or proposed position needs an AUD stop-risk value",
        });
    }
    const aggregateStopRiskAud = stopRisks
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0);
    const aggregateStopRiskPctNav =
        Number.isFinite(nav) && nav > 0 ? aggregateStopRiskAud / nav : null;
    if (
        Number.isFinite(aggregateStopRiskPctNav) &&
        aggregateStopRiskPctNav > limits.maxAggregateStopRiskPctNav
    ) {
        reasons.push({
            code: "AGGREGATE_STOP_RISK",
            actualPctNav: aggregateStopRiskPctNav,
            maxPctNav: limits.maxAggregateStopRiskPctNav,
        });
    }

    const currencyExposureAud = {};
    const missingNotional = positions.some(
        (position) => !addCurrencyExposure(currencyExposureAud, position)
    );
    if (missingNotional) {
        reasons.push({
            code: "CURRENCY_EXPOSURE_UNAVAILABLE",
            message: "Every position needs an AUD notional for currency exposure checks",
        });
    }
    const largestNetCurrencyExposureAud = Math.max(
        0,
        ...Object.values(currencyExposureAud).map(Math.abs)
    );
    const largestNetCurrencyExposurePctNav =
        Number.isFinite(nav) && nav > 0
            ? largestNetCurrencyExposureAud / nav
            : null;
    if (
        Number.isFinite(largestNetCurrencyExposurePctNav) &&
        largestNetCurrencyExposurePctNav > limits.maxNetCurrencyExposurePctNav
    ) {
        reasons.push({
            code: "NET_CURRENCY_EXPOSURE",
            actualPctNav: largestNetCurrencyExposurePctNav,
            maxPctNav: limits.maxNetCurrencyExposurePctNav,
        });
    }

    let correlatedExposureAud = 0;
    if (proposedTrade) {
        correlatedExposureAud = positionNotionalAud(proposedTrade) || 0;
        for (const position of openPositions) {
            const correlation = Math.abs(
                correlationFor(
                    proposedTrade.instrument,
                    position.instrument,
                    correlations
                )
            );
            if (correlation >= limits.correlationThreshold) {
                correlatedExposureAud += positionNotionalAud(position) || 0;
            }
        }
    }
    const correlatedExposurePctNav =
        Number.isFinite(nav) && nav > 0 ? correlatedExposureAud / nav : null;
    if (
        proposedTrade &&
        Number.isFinite(correlatedExposurePctNav) &&
        correlatedExposurePctNav > limits.maxCorrelatedExposurePctNav
    ) {
        reasons.push({
            code: "CORRELATED_EXPOSURE",
            actualPctNav: correlatedExposurePctNav,
            maxPctNav: limits.maxCorrelatedExposurePctNav,
        });
    }

    const dailyLossPctNav =
        Number.isFinite(nav) && nav > 0
            ? Math.max(0, -toFiniteNumber(dailyRealizedPnlAud, 0)) / nav
            : null;
    if (
        Number.isFinite(dailyLossPctNav) &&
        dailyLossPctNav >= limits.maxDailyLossPctNav
    ) {
        reasons.push({
            code: "DAILY_LOSS_LIMIT",
            actualPctNav: dailyLossPctNav,
            maxPctNav: limits.maxDailyLossPctNav,
        });
    }

    const highWatermark = toFiniteNumber(highWatermarkNavAud, nav);
    const drawdownPctNav =
        Number.isFinite(nav) && nav > 0 && Number.isFinite(highWatermark) && highWatermark > 0
            ? Math.max(0, (highWatermark - nav) / highWatermark)
            : null;
    if (
        Number.isFinite(drawdownPctNav) &&
        drawdownPctNav >= limits.maxDrawdownPctNav
    ) {
        reasons.push({
            code: "DRAWDOWN_LIMIT",
            actualPct: drawdownPctNav,
            maxPct: limits.maxDrawdownPctNav,
        });
    }

    const lossStreak = Math.max(
        0,
        Math.floor(
            toFiniteNumber(
                lossStreakState?.consecutiveLosses,
                consecutiveLosses
            )
        )
    );
    if (lossStreakState?.cooldownActive === true) {
        reasons.push({
            code: "CONSECUTIVE_LOSS_COOLDOWN",
            actual: lossStreak,
            max: limits.maxConsecutiveLosses,
            cooldownStartedAt: lossStreakState.cooldownStartedAt,
            cooldownUntil: lossStreakState.cooldownUntil,
            remainingMs: lossStreakState.remainingMs,
        });
    } else if (!lossStreakState && lossStreak >= limits.maxConsecutiveLosses) {
        reasons.push({
            code: "CONSECUTIVE_LOSS_LIMIT",
            actual: lossStreak,
            max: limits.maxConsecutiveLosses,
        });
    }

    return {
        passed: reasons.length === 0,
        status: reasons.length === 0 ? "PASS" : "FAIL",
        referenceCurrency: "AUD",
        navAud: nav,
        limits,
        metrics: {
            aggregateStopRiskAud,
            aggregateStopRiskPctNav,
            currencyExposureAud,
            largestNetCurrencyExposureAud,
            largestNetCurrencyExposurePctNav,
            correlatedExposureAud,
            correlatedExposurePctNav,
            dailyLossPctNav,
            drawdownPctNav,
            consecutiveLosses: lossStreak,
            consecutiveLossCooldown: lossStreakState,
        },
        reasons,
    };
}

module.exports = {
    CONSECUTIVE_LOSS_COOLDOWN_MS,
    DEFAULT_PORTFOLIO_RISK_LIMITS,
    evaluateConsecutiveLossCooldown,
    evaluateRunLossCooldown,
    evaluatePortfolioRisk,
    normalizeInstrument,
    positionNotionalAud,
    positionStopRiskAud,
};
