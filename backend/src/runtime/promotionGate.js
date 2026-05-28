const DEFAULT_PROMOTION_GATE_OPTIONS = Object.freeze({
    minClosedTrades: 50,
    minSideTrades: 10,
    minNetExpectancyPips: 0,
    minSideNetExpectancyPips: 0,
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

function normalizePositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePromotionGateOptions(options = {}) {
    return {
        minClosedTrades: normalizePositiveNumber(
            options.minClosedTrades,
            DEFAULT_PROMOTION_GATE_OPTIONS.minClosedTrades
        ),
        minSideTrades: normalizePositiveNumber(
            options.minSideTrades,
            DEFAULT_PROMOTION_GATE_OPTIONS.minSideTrades
        ),
        minNetExpectancyPips: normalizePositiveNumber(
            options.minNetExpectancyPips,
            DEFAULT_PROMOTION_GATE_OPTIONS.minNetExpectancyPips
        ),
        minSideNetExpectancyPips: normalizePositiveNumber(
            options.minSideNetExpectancyPips,
            DEFAULT_PROMOTION_GATE_OPTIONS.minSideNetExpectancyPips
        ),
    };
}

function resolveRequiredSides(configSnapshot = {}) {
    const config = normalizePayloadObject(configSnapshot);
    const enableLonging = config.enableLonging !== false;
    const enableShorting = config.enableShorting !== false;
    const requiredSides = [];

    if (enableLonging) requiredSides.push("BUY");
    if (enableShorting) requiredSides.push("SELL");

    return requiredSides.length > 0 ? requiredSides : ["BUY", "SELL"];
}

function normalizeExpectancySummary(analytics = {}) {
    const cohortSummary = analytics.cohortExpectancy?.summary || {};
    const analyticsSummary = analytics.summary || {};
    const trades = toFiniteNumber(
        cohortSummary.trades,
        toFiniteNumber(
            analyticsSummary.totalTrades,
            toFiniteNumber(analytics.rawCounts?.closedTrades, 0)
        )
    );
    const totalPnLPips = toFiniteNumber(
        cohortSummary.totalPnLPips,
        toFiniteNumber(analyticsSummary.totalPnLPips, 0)
    );
    const netExpectancyPips = toFiniteNumber(
        cohortSummary.netExpectancyPips,
        trades > 0 ? totalPnLPips / trades : 0
    );

    return {
        closedTrades: trades,
        wins: toFiniteNumber(
            cohortSummary.wins,
            toFiniteNumber(analyticsSummary.winningTrades, 0)
        ),
        losses: toFiniteNumber(
            cohortSummary.losses,
            toFiniteNumber(analyticsSummary.losingTrades, 0)
        ),
        winRatePct: toFiniteNumber(
            cohortSummary.winRatePct,
            toFiniteNumber(analyticsSummary.winRate, 0)
        ),
        totalPnLPips,
        totalPnLAud: toFiniteNumber(
            cohortSummary.totalPnLAud,
            toFiniteNumber(analyticsSummary.totalPnLAud, 0)
        ),
        netExpectancyPips,
        netExpectancyAud: toFiniteNumber(
            cohortSummary.netExpectancyAud,
            toFiniteNumber(analyticsSummary.avgPnLAud, 0)
        ),
        avgR:
            cohortSummary.avgR === null || cohortSummary.avgR === undefined
                ? null
                : toFiniteNumber(cohortSummary.avgR, null),
        profitFactorPips: toFiniteNumber(
            cohortSummary.profitFactorPips,
            toFiniteNumber(analyticsSummary.profitFactor, 0)
        ),
    };
}

function normalizeSideRows(analytics = {}) {
    const rows = Array.isArray(analytics.cohortExpectancy?.bySide)
        ? analytics.cohortExpectancy.bySide
        : [];

    if (rows.length > 0) {
        return rows.map((row) => ({
            side: normalizeString(row.side).toUpperCase() || "UNKNOWN",
            trades: toFiniteNumber(row.trades, 0),
            wins: toFiniteNumber(row.wins, 0),
            losses: toFiniteNumber(row.losses, 0),
            winRatePct: toFiniteNumber(row.winRatePct, 0),
            netExpectancyPips: toFiniteNumber(row.netExpectancyPips, 0),
            totalPnLPips: toFiniteNumber(row.totalPnLPips, 0),
            avgR:
                row.avgR === null || row.avgR === undefined
                    ? null
                    : toFiniteNumber(row.avgR, null),
            profitFactorPips: toFiniteNumber(row.profitFactorPips, 0),
        }));
    }

    const sidePerformance = analytics.sidePerformance || {};
    return ["BUY", "SELL"].map((side) => {
        const key = side.toLowerCase();
        const row = sidePerformance[key] || {};
        const trades = toFiniteNumber(row.totalTrades, 0);
        const totalPnLPips = toFiniteNumber(row.totalPnLPips, 0);

        return {
            side,
            trades,
            wins: toFiniteNumber(row.wins, 0),
            losses: toFiniteNumber(row.losses, 0),
            winRatePct: toFiniteNumber(row.winRate, 0),
            netExpectancyPips: trades > 0 ? totalPnLPips / trades : 0,
            totalPnLPips,
            avgR: null,
            profitFactorPips: 0,
        };
    });
}

function evaluatePromotionGate({
    analytics = {},
    run = {},
    configSnapshot = null,
    options = {},
} = {}) {
    const gateOptions = normalizePromotionGateOptions(options);
    const effectiveConfig =
        configSnapshot || run.configSnapshot || run.config || {};
    const requiredSides = resolveRequiredSides(effectiveConfig);
    const summary = normalizeExpectancySummary(analytics);
    const sideRows = normalizeSideRows(analytics);
    const sideByName = new Map(sideRows.map((row) => [row.side, row]));
    const sideExpectancy = requiredSides.map((side) => ({
        side,
        ...(sideByName.get(side) || {
            trades: 0,
            wins: 0,
            losses: 0,
            winRatePct: 0,
            totalPnLPips: 0,
            netExpectancyPips: 0,
            avgR: null,
            profitFactorPips: 0,
        }),
    }));
    const reasons = [];

    if (summary.closedTrades < gateOptions.minClosedTrades) {
        reasons.push({
            code: "MIN_CLOSED_TRADES",
            message: `Need at least ${gateOptions.minClosedTrades} closed realistic-paper trades before promotion`,
            actual: summary.closedTrades,
            required: gateOptions.minClosedTrades,
        });
    }

    if (summary.netExpectancyPips <= gateOptions.minNetExpectancyPips) {
        reasons.push({
            code: "OVERALL_NET_EXPECTANCY",
            message: "Overall realistic-paper net expectancy must be positive",
            actual: summary.netExpectancyPips,
            requiredGreaterThan: gateOptions.minNetExpectancyPips,
        });
    }

    sideExpectancy.forEach((sideRow) => {
        if (sideRow.trades < gateOptions.minSideTrades) {
            reasons.push({
                code: "SIDE_MIN_CLOSED_TRADES",
                message: `${sideRow.side} needs at least ${gateOptions.minSideTrades} closed realistic-paper trades`,
                side: sideRow.side,
                actual: sideRow.trades,
                required: gateOptions.minSideTrades,
            });
        }

        if (
            sideRow.netExpectancyPips <= gateOptions.minSideNetExpectancyPips
        ) {
            reasons.push({
                code: "SIDE_NET_EXPECTANCY",
                message: `${sideRow.side} realistic-paper net expectancy must be positive`,
                side: sideRow.side,
                actual: sideRow.netExpectancyPips,
                requiredGreaterThan: gateOptions.minSideNetExpectancyPips,
            });
        }
    });

    return {
        passed: reasons.length === 0,
        status: reasons.length === 0 ? "PASS" : "FAIL",
        runId: run.runId || null,
        strategy: run.strategy || null,
        requirements: {
            ...gateOptions,
            requiredSides,
        },
        summary,
        sideExpectancy,
        reasons,
    };
}

module.exports = {
    DEFAULT_PROMOTION_GATE_OPTIONS,
    evaluatePromotionGate,
    normalizePromotionGateOptions,
    resolveRequiredSides,
};
