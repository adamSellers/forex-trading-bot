const DEFAULT_PROMOTION_GATE_OPTIONS = Object.freeze({
    minClosedTrades: 100,
    minSideTrades: 20,
    minElapsedDays: 30,
    minTradingDays: 20,
    minInstruments: 2,
    minSessions: 2,
    minRegimes: 2,
    minProfitFactor: 1.2,
    minExpectancyLowerBoundPips: 0,
    minExpectancyLowerBoundAud: 0,
    maxDrawdownPct: 0.1,
    maxSingleInstrumentShare: 0.6,
    maxSingleSessionShare: 0.6,
    minMatchedShadowTrades: 50,
    minMatchedShadowOverlapDays: 14,
    confidenceZScore: 1.96,
    requireConfigConsistency: true,
    requireMatchedShadow: true,
    requireExecutionParity: true,
});

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizePayloadObject(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    if (typeof value !== "string") return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
        return {};
    }
}

function normalizeNonNegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback) {
    return Math.max(1, Math.floor(normalizeNonNegativeNumber(value, fallback)));
}

function normalizePromotionGateOptions(options = {}) {
    const normalized = {};
    for (const [key, fallback] of Object.entries(DEFAULT_PROMOTION_GATE_OPTIONS)) {
        if (typeof fallback === "boolean") {
            normalized[key] =
                options[key] === undefined ? fallback : options[key] === true;
        } else if (Number.isInteger(fallback) && fallback >= 1) {
            normalized[key] = normalizePositiveInteger(options[key], fallback);
        } else {
            normalized[key] = normalizeNonNegativeNumber(options[key], fallback);
        }
    }
    return normalized;
}

function resolveRequiredSides(configSnapshot = {}) {
    const config = normalizePayloadObject(configSnapshot);
    const requiredSides = [];
    if (config.enableLonging !== false) requiredSides.push("BUY");
    if (config.enableShorting !== false) requiredSides.push("SELL");
    return requiredSides.length > 0 ? requiredSides : ["BUY", "SELL"];
}

function normalizeExpectancySummary(analytics = {}) {
    const cohort = analytics.cohortExpectancy?.summary || {};
    const summary = analytics.summary || {};
    const closedTrades = toFiniteNumber(
        cohort.trades,
        toFiniteNumber(summary.totalTrades, analytics.rawCounts?.closedTrades || 0)
    );
    const totalPnLPips = toFiniteNumber(
        cohort.totalPnLPips,
        summary.totalPnLPips || 0
    );
    return {
        closedTrades,
        wins: toFiniteNumber(cohort.wins, summary.winningTrades || 0),
        losses: toFiniteNumber(cohort.losses, summary.losingTrades || 0),
        totalPnLPips,
        totalPnLAud: toFiniteNumber(cohort.totalPnLAud, summary.totalPnLAud || 0),
        netExpectancyPips: toFiniteNumber(
            cohort.netExpectancyPips,
            closedTrades > 0 ? totalPnLPips / closedTrades : 0
        ),
        netExpectancyAud: toFiniteNumber(
            cohort.netExpectancyAud,
            summary.avgPnLAud || 0
        ),
        profitFactorPips: toFiniteNumber(
            cohort.profitFactorPips,
            summary.profitFactor || 0
        ),
        profitFactorAud: toFiniteNumber(
            cohort.profitFactorAud,
            summary.profitFactor || 0
        ),
    };
}

function normalizeSideRows(analytics = {}, trades = []) {
    const rows = Array.isArray(analytics.cohortExpectancy?.bySide)
        ? analytics.cohortExpectancy.bySide
        : [];
    if (rows.length > 0) {
        return rows.map((row) => ({
            side: normalizeString(row.side).toUpperCase() || "UNKNOWN",
            trades: toFiniteNumber(row.trades, 0),
            netExpectancyPips: toFiniteNumber(row.netExpectancyPips, 0),
            netExpectancyAud: toFiniteNumber(row.netExpectancyAud, 0),
        }));
    }

    const bySide = new Map();
    for (const trade of trades) {
        const side = normalizeString(trade.side).toUpperCase() || "UNKNOWN";
        const row = bySide.get(side) || { side, trades: 0, pips: 0, aud: 0 };
        row.trades += 1;
        row.pips += toFiniteNumber(trade.pnlPips, 0);
        row.aud += toFiniteNumber(trade.pnlAud, 0);
        bySide.set(side, row);
    }
    return Array.from(bySide.values()).map((row) => ({
        side: row.side,
        trades: row.trades,
        netExpectancyPips: row.trades > 0 ? row.pips / row.trades : 0,
        netExpectancyAud: row.trades > 0 ? row.aud / row.trades : 0,
    }));
}

function expectancyConfidence(values = [], zScore = 1.96) {
    const sample = values.map(Number).filter(Number.isFinite);
    if (sample.length < 2) {
        return { count: sample.length, mean: sample[0] || 0, standardError: null, lowerBound: null };
    }
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const variance =
        sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (sample.length - 1);
    const standardError = Math.sqrt(variance) / Math.sqrt(sample.length);
    return {
        count: sample.length,
        mean,
        standardError,
        lowerBound: mean - zScore * standardError,
    };
}

function getSession(timestamp) {
    const hour = new Date(timestamp).getUTCHours();
    if (hour >= 12 && hour < 21) return "newyork";
    if (hour >= 7 && hour < 16) return "london";
    if (hour >= 0 && hour < 9) return "tokyo";
    if (hour >= 21 || hour < 6) return "sydney";
    return "offhours";
}

function extractRegime(trade = {}) {
    const payload = normalizePayloadObject(trade.brokerReconciliationPayload);
    const candidates = [
        trade.marketRegime,
        trade.volatilityRegime,
        payload.marketRegime,
        payload.volatilityRegime,
        payload.paperRuntime?.marketRegime,
        payload.paperRuntime?.volatilityRegime,
        payload.paperRuntime?.timesFm?.volatilityRegime,
        payload.paperRuntime?.signal?.timesFm?.volatilityRegime,
        payload.paperRuntime?.strategyContext?.regime?.name,
        payload.paperRuntime?.strategyContext?.regime?.state,
    ];
    return normalizeString(candidates.find((value) => normalizeString(value)))
        .toLowerCase() || "unknown";
}

function getCostEvidence(trade = {}) {
    const payload = normalizePayloadObject(trade.brokerReconciliationPayload);
    const paper = normalizePayloadObject(payload.paperRuntime);
    const failures = [];
    if (paper.commissionStatus !== "MODELED") failures.push("commission");
    if (paper.spreadStatus !== "MODELED") failures.push("spread");
    if (paper.slippageStatus !== "MODELED") failures.push("slippage");
    if (paper.financingMode === "UNMODELED") failures.push("financing");
    if (!paper.financingMode) failures.push("financing_status_missing");
    if (!Number.isFinite(Number(paper.costModelVersion))) {
        failures.push("cost_model_version");
    }
    return {
        complete: failures.length === 0,
        failures,
        financingMode: paper.financingMode || null,
        financingStatus: paper.financingStatus || null,
        costModelVersion: paper.costModelVersion || null,
    };
}

function calculateProfitFactor(values = []) {
    const grossProfit = values
        .filter((value) => value > 0)
        .reduce((sum, value) => sum + value, 0);
    const grossLoss = Math.abs(
        values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)
    );
    return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
}

function calculateDrawdown(trades = [], startingBalanceAud = 0) {
    const sorted = [...trades].sort(
        (left, right) =>
            toFiniteNumber(left.exitTime || left.entryTime, 0) -
            toFiniteNumber(right.exitTime || right.entryTime, 0)
    );
    let equity = Math.max(0, toFiniteNumber(startingBalanceAud, 0));
    let peak = equity;
    let maxDrawdownAud = 0;
    for (const trade of sorted) {
        equity += toFiniteNumber(trade.pnlAud, 0);
        peak = Math.max(peak, equity);
        maxDrawdownAud = Math.max(maxDrawdownAud, peak - equity);
    }
    return {
        maxDrawdownAud,
        maxDrawdownPct: peak > 0 ? maxDrawdownAud / peak : null,
        endingEquityAud: equity,
        peakEquityAud: peak,
    };
}

function largestBucketShare(trades, keyForTrade) {
    if (trades.length === 0) return { key: null, count: 0, share: 0 };
    const counts = new Map();
    for (const trade of trades) {
        const key = keyForTrade(trade) || "unknown";
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const [key, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { key, count, share: count / trades.length };
}

function buildEvidence({ trades, run, config, options, now }) {
    const closedTrades = (Array.isArray(trades) ? trades : []).filter(
        (trade) =>
            trade?.isOpen !== true &&
            Number.isFinite(Number(trade?.pnlAud)) &&
            Number.isFinite(Number(trade?.pnlPips))
    );
    const pnlAud = closedTrades.map((trade) => Number(trade.pnlAud));
    const pnlPips = closedTrades.map((trade) => Number(trade.pnlPips));
    const timestamps = closedTrades
        .map((trade) => toFiniteNumber(trade.entryTime, NaN))
        .filter(Number.isFinite);
    const instruments = new Set(closedTrades.map((trade) => trade.instrument).filter(Boolean));
    const sessions = new Set(timestamps.map(getSession));
    const regimes = new Set(closedTrades.map(extractRegime).filter((value) => value !== "unknown"));
    const tradingDays = new Set(
        timestamps.map((timestamp) => new Date(timestamp).toISOString().slice(0, 10))
    );
    const expectedConfigHash = normalizeString(run.configHash);
    const matchingConfigTrades = closedTrades.filter(
        (trade) =>
            expectedConfigHash && normalizeString(trade.configHash) === expectedConfigHash
    ).length;
    const configCoverageRatio =
        closedTrades.length > 0 ? matchingConfigTrades / closedTrades.length : 0;
    const elapsedDays = Math.max(
        0,
        (toFiniteNumber(now, Date.now()) - toFiniteNumber(run.startedAt, now)) /
            86400000
    );
    const costRows = closedTrades.map((trade) => ({
        tradeId: trade.id || null,
        ...getCostEvidence(trade),
    }));
    const incompleteCostRows = costRows.filter((row) => !row.complete);

    return {
        closedTrades,
        elapsedDays,
        tradingDays: tradingDays.size,
        instruments: [...instruments],
        sessions: [...sessions],
        regimes: [...regimes],
        configCoverageRatio,
        missingOrMismatchedConfigTrades: closedTrades.length - matchingConfigTrades,
        costCoverageRatio:
            closedTrades.length > 0
                ? (closedTrades.length - incompleteCostRows.length) /
                  closedTrades.length
                : 0,
        incompleteCostRows,
        expectancyPips: expectancyConfidence(pnlPips, options.confidenceZScore),
        expectancyAud: expectancyConfidence(pnlAud, options.confidenceZScore),
        profitFactorPips: calculateProfitFactor(pnlPips),
        profitFactorAud: calculateProfitFactor(pnlAud),
        drawdown: calculateDrawdown(
            closedTrades,
            config.paperStartingBalanceAud || 10000
        ),
        concentration: {
            instrument: largestBucketShare(closedTrades, (trade) => trade.instrument),
            session: largestBucketShare(closedTrades, (trade) => getSession(trade.entryTime)),
        },
    };
}

function evaluatePromotionGate({
    analytics = {},
    run = {},
    configSnapshot = null,
    options = {},
    trades = null,
    matchedShadowEvidence = null,
    executionParity = null,
    now = Date.now(),
} = {}) {
    const gateOptions = normalizePromotionGateOptions(options);
    const config = normalizePayloadObject(
        configSnapshot || run.configSnapshot || run.config || {}
    );
    const rawTrades = trades || analytics.promotionEvidence?.trades || [];
    const evidence = buildEvidence({
        trades: rawTrades,
        run,
        config,
        options: gateOptions,
        now,
    });
    const summary = normalizeExpectancySummary(analytics);
    if (evidence.closedTrades.length > 0) {
        summary.closedTrades = evidence.closedTrades.length;
        summary.netExpectancyPips = evidence.expectancyPips.mean;
        summary.netExpectancyAud = evidence.expectancyAud.mean;
        summary.totalPnLPips = evidence.expectancyPips.mean * evidence.closedTrades.length;
        summary.totalPnLAud = evidence.expectancyAud.mean * evidence.closedTrades.length;
        summary.profitFactorPips = evidence.profitFactorPips;
        summary.profitFactorAud = evidence.profitFactorAud;
    }
    const requiredSides = resolveRequiredSides(config);
    const sideRows = normalizeSideRows(analytics, evidence.closedTrades);
    const sideByName = new Map(sideRows.map((row) => [row.side, row]));
    const sideExpectancy = requiredSides.map((side) => ({
        side,
        ...(sideByName.get(side) || {
            trades: 0,
            netExpectancyPips: 0,
            netExpectancyAud: 0,
        }),
    }));
    const shadow = normalizePayloadObject(
        matchedShadowEvidence || run.metadata?.matchedShadowEvidence
    );
    const parity = normalizePayloadObject(
        executionParity || run.metadata?.executionParity
    );
    const reasons = [];
    const addReason = (condition, reason) => {
        if (condition) reasons.push(reason);
    };

    addReason(summary.closedTrades < gateOptions.minClosedTrades, {
        code: "MIN_CLOSED_TRADES",
        actual: summary.closedTrades,
        required: gateOptions.minClosedTrades,
    });
    addReason(evidence.closedTrades.length !== summary.closedTrades, {
        code: "RAW_TRADE_EVIDENCE_REQUIRED",
        actual: evidence.closedTrades.length,
        expected: summary.closedTrades,
    });
    addReason(evidence.elapsedDays < gateOptions.minElapsedDays, {
        code: "MIN_ELAPSED_DAYS",
        actual: evidence.elapsedDays,
        required: gateOptions.minElapsedDays,
    });
    addReason(evidence.tradingDays < gateOptions.minTradingDays, {
        code: "MIN_TRADING_DAYS",
        actual: evidence.tradingDays,
        required: gateOptions.minTradingDays,
    });
    addReason(evidence.instruments.length < gateOptions.minInstruments, {
        code: "INSTRUMENT_COVERAGE",
        actual: evidence.instruments.length,
        required: gateOptions.minInstruments,
    });
    addReason(evidence.sessions.length < gateOptions.minSessions, {
        code: "SESSION_COVERAGE",
        actual: evidence.sessions.length,
        required: gateOptions.minSessions,
    });
    addReason(evidence.regimes.length < gateOptions.minRegimes, {
        code: "REGIME_COVERAGE",
        actual: evidence.regimes.length,
        required: gateOptions.minRegimes,
    });
    addReason(
        gateOptions.requireConfigConsistency && evidence.configCoverageRatio !== 1,
        {
            code: "CONFIG_COVERAGE",
            actual: evidence.configCoverageRatio,
            required: 1,
        }
    );
    addReason(evidence.costCoverageRatio !== 1, {
        code: "UNMODELED_TRADING_COSTS",
        actualCoverage: evidence.costCoverageRatio,
        incompleteTrades: evidence.incompleteCostRows.slice(0, 20),
        message:
            "Every promotion trade must have modeled spread, slippage, commission, and financing status",
    });
    addReason(
        !Number.isFinite(evidence.expectancyPips.lowerBound) ||
            evidence.expectancyPips.lowerBound <=
                gateOptions.minExpectancyLowerBoundPips,
        {
            code: "EXPECTANCY_LOWER_BOUND_PIPS",
            actual: evidence.expectancyPips.lowerBound,
            requiredGreaterThan: gateOptions.minExpectancyLowerBoundPips,
        }
    );
    addReason(
        !Number.isFinite(evidence.expectancyAud.lowerBound) ||
            evidence.expectancyAud.lowerBound <= gateOptions.minExpectancyLowerBoundAud,
        {
            code: "EXPECTANCY_LOWER_BOUND_AUD",
            actual: evidence.expectancyAud.lowerBound,
            requiredGreaterThan: gateOptions.minExpectancyLowerBoundAud,
        }
    );
    addReason(
        evidence.profitFactorAud < gateOptions.minProfitFactor ||
            evidence.profitFactorPips < gateOptions.minProfitFactor,
        {
            code: "PROFIT_FACTOR",
            actualAud: evidence.profitFactorAud,
            actualPips: evidence.profitFactorPips,
            required: gateOptions.minProfitFactor,
        }
    );
    addReason(
        !Number.isFinite(evidence.drawdown.maxDrawdownPct) ||
            evidence.drawdown.maxDrawdownPct > gateOptions.maxDrawdownPct,
        {
            code: "MAX_DRAWDOWN",
            actual: evidence.drawdown.maxDrawdownPct,
            maximum: gateOptions.maxDrawdownPct,
        }
    );
    addReason(
        evidence.concentration.instrument.share >
            gateOptions.maxSingleInstrumentShare,
        {
            code: "INSTRUMENT_CONCENTRATION",
            ...evidence.concentration.instrument,
            maximum: gateOptions.maxSingleInstrumentShare,
        }
    );
    addReason(
        evidence.concentration.session.share > gateOptions.maxSingleSessionShare,
        {
            code: "SESSION_CONCENTRATION",
            ...evidence.concentration.session,
            maximum: gateOptions.maxSingleSessionShare,
        }
    );

    for (const side of sideExpectancy) {
        addReason(side.trades < gateOptions.minSideTrades, {
            code: "SIDE_MIN_CLOSED_TRADES",
            side: side.side,
            actual: side.trades,
            required: gateOptions.minSideTrades,
        });
        addReason(side.netExpectancyPips <= 0 || side.netExpectancyAud <= 0, {
            code: "SIDE_NET_EXPECTANCY",
            side: side.side,
            actualPips: side.netExpectancyPips,
            actualAud: side.netExpectancyAud,
        });
    }

    if (gateOptions.requireMatchedShadow) {
        addReason(
            shadow.passed !== true ||
                toFiniteNumber(shadow.closedTrades, 0) <
                    gateOptions.minMatchedShadowTrades ||
                toFiniteNumber(shadow.overlapDays, 0) <
                    gateOptions.minMatchedShadowOverlapDays ||
                toFiniteNumber(shadow.candidateNetExpectancyAud, -Infinity) <=
                    toFiniteNumber(shadow.shadowNetExpectancyAud, Infinity),
            {
                code: "MATCHED_SHADOW_EVIDENCE",
                actual: shadow,
                requiredTrades: gateOptions.minMatchedShadowTrades,
                requiredOverlapDays: gateOptions.minMatchedShadowOverlapDays,
            }
        );
    }

    if (gateOptions.requireExecutionParity) {
        addReason(
            parity.passed !== true ||
                normalizeString(parity.configHash) !== normalizeString(run.configHash) ||
                normalizeString(parity.executionPolicyVersion) !==
                    normalizeString(config.executionPolicyVersion),
            {
                code: "EXECUTION_PARITY_EVIDENCE",
                actual: parity,
                requiredConfigHash: run.configHash || null,
                requiredExecutionPolicyVersion:
                    config.executionPolicyVersion || null,
            }
        );
    }

    return {
        gateVersion: 2,
        passed: reasons.length === 0,
        status: reasons.length === 0 ? "PASS" : "FAIL",
        evaluatedAt: toFiniteNumber(now, Date.now()),
        runId: run.runId || null,
        strategy: run.strategy || null,
        configHash: run.configHash || null,
        referenceCurrency: "AUD",
        requirements: { ...gateOptions, requiredSides },
        summary,
        sideExpectancy,
        evidence: {
            elapsedDays: evidence.elapsedDays,
            tradingDays: evidence.tradingDays,
            instruments: evidence.instruments,
            sessions: evidence.sessions,
            regimes: evidence.regimes,
            configCoverageRatio: evidence.configCoverageRatio,
            costCoverageRatio: evidence.costCoverageRatio,
            incompleteCostRows: evidence.incompleteCostRows,
            expectancyPips: evidence.expectancyPips,
            expectancyAud: evidence.expectancyAud,
            profitFactorPips: evidence.profitFactorPips,
            profitFactorAud: evidence.profitFactorAud,
            drawdown: evidence.drawdown,
            concentration: evidence.concentration,
            matchedShadow: shadow,
            executionParity: parity,
        },
        reasons,
    };
}

module.exports = {
    DEFAULT_PROMOTION_GATE_OPTIONS,
    evaluatePromotionGate,
    expectancyConfidence,
    normalizePromotionGateOptions,
    resolveRequiredSides,
};
