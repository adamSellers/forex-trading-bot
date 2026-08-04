// backend/src/services/analyticsService.js - Forex Analytics Service
const logger = require("../utils/logger");
const { calculateExpectedEdge } = require("../strategies/expectedEdge");
const {
    bootstrapMeanInterval,
    wilsonInterval,
} = require("./analyticsStatistics");

const COOLDOWN_SIGNAL_CLASSES = new Set(["COOLDOWN", "SUPPRESSED"]);

/**
 * Trading session definitions (UTC times)
 * Sessions overlap, so we categorize by PRIMARY session at entry time
 */
const TRADING_SESSIONS = {
    SYDNEY: { start: 21, end: 6, name: "Sydney", pairs: ["AUD_USD"] },
    TOKYO: { start: 0, end: 9, name: "Tokyo", pairs: ["USD_JPY"] },
    LONDON: {
        start: 7,
        end: 16,
        name: "London",
        pairs: ["EUR_USD", "GBP_USD"],
    },
    NEW_YORK: {
        start: 12,
        end: 21,
        name: "New York",
        pairs: ["AUD_USD", "EUR_USD", "GBP_USD", "USD_JPY"],
    },
};

/**
 * Determine which trading session a timestamp falls into
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Session name
 */
function getSessionForTimestamp(timestamp) {
    const date = new Date(timestamp);
    const hour = date.getUTCHours();

    // Check sessions in order of priority (overlaps favor higher-volume session)
    if (hour >= 12 && hour < 21) return "New York";
    if (hour >= 7 && hour < 16) return "London";
    if (hour >= 0 && hour < 9) return "Tokyo";
    if (hour >= 21 || hour < 6) return "Sydney";

    return "Off-Hours";
}

/**
 * Parse period string to milliseconds
 */
function parsePeriod(period) {
    const periods = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
        "90d": 90 * 24 * 60 * 60 * 1000,
        all: 365 * 24 * 60 * 60 * 1000, // 1 year max
    };
    return periods[period] || periods["30d"];
}

function normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeUpper(value) {
    return normalizeString(value).toUpperCase();
}

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundTo(value, decimals = 2) {
    return Number.parseFloat(toFiniteNumber(value).toFixed(decimals));
}

function calculateMaxDrawdownAud(trades = []) {
    const ordered = [...trades].sort(
        (left, right) =>
            toFiniteNumber(left.exitTime || left.entryTime) -
            toFiniteNumber(right.exitTime || right.entryTime)
    );
    let cumulative = 0;
    let peak = 0;
    let maximum = 0;
    for (const trade of ordered) {
        cumulative += toFiniteNumber(trade.pnlAud);
        peak = Math.max(peak, cumulative);
        maximum = Math.max(maximum, peak - cumulative);
    }
    return maximum;
}

function calculateLongestLosingStreak(trades = []) {
    const ordered = [...trades].sort(
        (left, right) =>
            toFiniteNumber(left.exitTime || left.entryTime) -
            toFiniteNumber(right.exitTime || right.entryTime)
    );
    let current = 0;
    let longest = 0;
    for (const trade of ordered) {
        current = toFiniteNumber(trade.pnlAud) < 0 ? current + 1 : 0;
        longest = Math.max(longest, current);
    }
    return longest;
}

function calculatePnlConcentration(trades = []) {
    const byInstrument = new Map();
    for (const trade of trades) {
        const instrument = normalizeString(trade.instrument) || "UNKNOWN";
        byInstrument.set(
            instrument,
            (byInstrument.get(instrument) || 0) + Math.abs(toFiniteNumber(trade.pnlAud))
        );
    }
    const total = Array.from(byInstrument.values()).reduce(
        (sum, value) => sum + value,
        0
    );
    if (!total) return { topInstrument: null, topSharePct: 0, herfindahl: 0 };
    const shares = Array.from(byInstrument.entries())
        .map(([instrument, value]) => ({ instrument, share: value / total }))
        .sort((left, right) => right.share - left.share);
    return {
        topInstrument: shares[0].instrument,
        topSharePct: roundTo(shares[0].share * 100, 1),
        herfindahl: roundTo(
            shares.reduce((sum, row) => sum + row.share ** 2, 0),
            4
        ),
    };
}

function pearsonCorrelation(left = [], right = []) {
    if (left.length !== right.length || left.length < 3) return null;
    const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
    const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
    let covariance = 0;
    let leftVariance = 0;
    let rightVariance = 0;
    for (let index = 0; index < left.length; index += 1) {
        const leftDelta = left[index] - leftMean;
        const rightDelta = right[index] - rightMean;
        covariance += leftDelta * rightDelta;
        leftVariance += leftDelta ** 2;
        rightVariance += rightDelta ** 2;
    }
    const denominator = Math.sqrt(leftVariance * rightVariance);
    return denominator > 0 ? covariance / denominator : null;
}

function getPipValue(instrument) {
    return normalizeString(instrument).includes("JPY") ? 0.01 : 0.0001;
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

function hasStructuredSignalTelemetry(signal) {
    return Boolean(
        normalizeString(signal?.signalClass) ||
            normalizeString(signal?.reasonCode) ||
            normalizeString(signal?.intent) ||
            normalizeString(signal?.setupId) ||
            normalizeString(signal?.configHash) ||
            (signal?.signalCandleTime !== null &&
                signal?.signalCandleTime !== undefined) ||
            (signal?.uniqueEvent !== null && signal?.uniqueEvent !== undefined) ||
            (signal?.cooldownSuppressed !== null &&
                signal?.cooldownSuppressed !== undefined)
    );
}

function deriveSignalSide(signal) {
    const intent = normalizeUpper(signal?.intent);
    if (intent.startsWith("ENTER_LONG")) return "BUY";
    if (intent.startsWith("ENTER_SHORT")) return "SELL";
    if (intent.startsWith("EXIT_LONG")) return "SELL";
    if (intent.startsWith("EXIT_SHORT")) return "BUY";

    const signalType = normalizeUpper(signal?.signal);
    if (signalType === "BUY" || signalType === "SELL") {
        return signalType;
    }

    return "UNKNOWN";
}

function isCooldownDuplicate(signal) {
    const signalClass = normalizeUpper(signal?.signalClass);
    const signalType = normalizeUpper(signal?.signal);
    const reasonCode = normalizeUpper(signal?.reasonCode);

    return (
        signal?.cooldownSuppressed === true ||
        COOLDOWN_SIGNAL_CLASSES.has(signalClass) ||
        signalType === "COOLDOWN" ||
        reasonCode.startsWith("COOLDOWN_")
    );
}

function isExitOnlySignal(signal) {
    const signalClass = normalizeUpper(signal?.signalClass);
    const intent = normalizeUpper(signal?.intent);
    const entryType = normalizeUpper(signal?.entryType);

    return (
        signalClass === "EXIT_ONLY" ||
        intent.startsWith("EXIT_") ||
        entryType === "EXIT_ONLY"
    );
}

function isActionableSignal(signal) {
    const signalClass = normalizeUpper(signal?.signalClass);
    const intent = normalizeUpper(signal?.intent);
    const signalType = normalizeUpper(signal?.signal);

    if (isCooldownDuplicate(signal) || isExitOnlySignal(signal)) {
        return false;
    }

    if (signalClass === "ACTIONABLE") {
        return true;
    }

    if (intent.startsWith("ENTER_")) {
        return true;
    }

    return signalType === "BUY" || signalType === "SELL";
}

function getSignalEventKey(signal) {
    const symbol =
        normalizeString(signal?.symbol) ||
        normalizeString(signal?.instrument) ||
        "UNKNOWN";
    const side = deriveSignalSide(signal);
    const cohortType =
        normalizeString(signal?.entryType) ||
        normalizeString(signal?.intent) ||
        normalizeString(signal?.signalClass) ||
        normalizeString(signal?.signal) ||
        "UNKNOWN";
    const setupId = normalizeString(signal?.setupId);

    if (setupId) {
        return `${symbol}|${side}|${setupId}`;
    }

    const signalCandleTime = toFiniteNumber(signal?.signalCandleTime, NaN);
    if (Number.isFinite(signalCandleTime) && signalCandleTime > 0) {
        return `${symbol}|${side}|${cohortType}|${signalCandleTime}`;
    }

    const timestampBucket = Math.floor(toFiniteNumber(signal?.timestamp, 0) / 60000);
    return `${symbol}|${side}|${cohortType}|${timestampBucket}`;
}

function isUniqueSignalEvent(signal, seenSignalKeys) {
    if (!hasStructuredSignalTelemetry(signal)) {
        return true;
    }

    if (signal?.uniqueEvent === false) {
        return false;
    }

    if (
        signal?.cooldownSuppressed !== null &&
        signal?.cooldownSuppressed !== undefined
    ) {
        if (signal.cooldownSuppressed === true) return false;
    }

    const dedupeKey = getSignalEventKey(signal);
    if (seenSignalKeys.has(dedupeKey)) {
        return false;
    }

    seenSignalKeys.add(dedupeKey);
    return true;
}

function dedupeStrategyDecisions(signals = []) {
    const seen = new Set();
    const decisions = [];

    signals.forEach((signal, index) => {
        const instrument =
            normalizeString(signal?.symbol) ||
            normalizeString(signal?.instrument) ||
            "UNKNOWN";
        const signalCandleTime = toFiniteNumber(signal?.signalCandleTime, NaN);
        const reasonCode = normalizeUpper(signal?.reasonCode) || "UNKNOWN";
        const signalClass = normalizeUpper(signal?.signalClass) || "UNCLASSIFIED";
        const intent = normalizeUpper(signal?.intent) || "UNSPECIFIED";
        const identity = [
            normalizeString(signal?.mode) || "live",
            normalizeString(signal?.strategy) || "unknown",
            normalizeString(signal?.runId) ||
                normalizeString(signal?.run_id) ||
                "unassigned",
            instrument,
        ];
        let key;

        if (Number.isFinite(signalCandleTime) && signalCandleTime > 0) {
            key = [...identity, signalCandleTime, reasonCode, signalClass, intent].join(
                "|"
            );
        } else if (normalizeString(signal?.setupId)) {
            key = [
                ...identity,
                normalizeString(signal.setupId),
                reasonCode,
                signalClass,
                intent,
            ].join("|");
        } else {
            // Legacy rows do not carry enough identity to deduplicate safely.
            key = `legacy|${normalizeString(signal?.id) || index}|${toFiniteNumber(
                signal?.timestamp,
                index
            )}`;
        }

        if (!seen.has(key)) {
            seen.add(key);
            decisions.push(signal);
        }
    });

    return decisions;
}

function createSignalCohort(signal) {
    const mode = normalizeString(signal?.mode) || "live";
    const strategy = normalizeString(signal?.strategy) || "unknown";
    const runId =
        normalizeString(signal?.runId) ||
        normalizeString(signal?.run_id) ||
        "unassigned";
    const selectionId =
        normalizeString(signal?.selectionId) ||
        normalizeString(signal?.selection_id) ||
        "unassigned";
    const instrument =
        normalizeString(signal?.symbol) ||
        normalizeString(signal?.instrument) ||
        "UNKNOWN";
    const side = deriveSignalSide(signal);
    const cohortType =
        normalizeString(signal?.entryType) ||
        normalizeString(signal?.intent) ||
        normalizeString(signal?.signalClass) ||
        normalizeString(signal?.signal) ||
        "UNKNOWN";
    const configHash = normalizeString(signal?.configHash) || "unknown";

    return {
        mode,
        strategy,
        runId,
        selectionId,
        identityKey: `${mode}|${strategy}|${runId}|${selectionId}`,
        configHash,
        instrument,
        side,
        cohortType,
        cohort: `${instrument}|${side}|${cohortType}`,
    };
}

function createTradeCohort(trade) {
    const mode = normalizeString(trade?.mode) || "live";
    const strategy = normalizeString(trade?.strategy) || "unknown";
    const runId =
        normalizeString(trade?.ownerRunId) ||
        normalizeString(trade?.owner_run_id) ||
        normalizeString(trade?.runId) ||
        normalizeString(trade?.run_id) ||
        "unassigned";
    const selectionId =
        normalizeString(trade?.selectionId) ||
        normalizeString(trade?.selection_id) ||
        "unassigned";
    const instrument = normalizeString(trade?.instrument) || "UNKNOWN";
    const side = normalizeUpper(trade?.side) || "UNKNOWN";
    const cohortType =
        normalizeString(trade?.entryType) ||
        normalizeString(trade?.signal) ||
        "UNKNOWN";
    const configHash =
        normalizeString(trade?.configHash) ||
        normalizeString(trade?.strategyConfigHash) ||
        normalizeString(trade?.config_hash) ||
        "unknown";

    return {
        mode,
        strategy,
        runId,
        selectionId,
        identityKey: `${mode}|${strategy}|${runId}|${selectionId}`,
        configHash,
        instrument,
        side,
        cohortType,
        cohort: `${instrument}|${side}|${cohortType}`,
    };
}

function createEntryDecisionCohort(decision) {
    const mode = normalizeString(decision?.mode) || "live";
    const strategy = normalizeString(decision?.strategy) || "unknown";
    const runId =
        normalizeString(decision?.runId) ||
        normalizeString(decision?.run_id) ||
        "unassigned";
    const selectionId =
        normalizeString(decision?.selectionId) ||
        normalizeString(decision?.selection_id) ||
        "unassigned";
    const instrument = normalizeString(decision?.instrument) || "UNKNOWN";
    const side = normalizeUpper(decision?.side) || "UNKNOWN";
    const cohortType =
        normalizeString(decision?.entryType) ||
        normalizeString(decision?.signal) ||
        "UNKNOWN";
    const configHash = normalizeString(decision?.configHash) || "unknown";

    return {
        mode,
        strategy,
        runId,
        selectionId,
        identityKey: `${mode}|${strategy}|${runId}|${selectionId}`,
        configHash,
        instrument,
        side,
        cohortType,
        cohort: `${instrument}|${side}|${cohortType}`,
    };
}

function normalizeRuntimeFilters(runtimeFilters = {}) {
    const baseFilters =
        typeof runtimeFilters === "string"
            ? { mode: runtimeFilters }
            : { ...(runtimeFilters || {}) };
    const normalized = { mode: "live" };
    const strategy = normalizeString(baseFilters.strategy);
    const runId = normalizeString(baseFilters.runId);
    const selectionId = normalizeString(baseFilters.selectionId);

    if (strategy) {
        normalized.strategy = strategy;
    }
    if (runId) {
        normalized.runId = runId;
    }
    if (selectionId) {
        normalized.selectionId = selectionId;
    }

    return normalized;
}

/**
 * Calculate comprehensive analytics from trades and signals
 */
class AnalyticsService {
    constructor(tradeRepository, signalRepository, entryDecisionRepository = null) {
        this.tradeRepo = tradeRepository;
        this.signalRepo = signalRepository;
        this.entryDecisionRepo = entryDecisionRepository;
    }

    /**
     * Get full analytics report for a period
     * @param {string} period - '24h', '7d', '30d', '90d', 'all'
     */
    async getAnalytics(period = "30d", runtimeFilters = {}) {
        try {
            const now = Date.now();
            const periodMs = parsePeriod(period);
            const cutoffTime = now - periodMs;
            const filters = normalizeRuntimeFilters(runtimeFilters);
            const profile =
                normalizeString(runtimeFilters?.profile || runtimeFilters?.view) ===
                "dashboard"
                    ? "dashboard"
                    : "full";
            const tradeFilters = { ...filters };
            if (tradeFilters.runId) {
                tradeFilters.ownerRunId = tradeFilters.runId;
                delete tradeFilters.runId;
            }

            // Fetch raw data
            const signalQuery =
                profile === "dashboard" && this.signalRepo.getSignalsSinceCompact
                    ? this.signalRepo.getSignalsSinceCompact(cutoffTime, filters)
                    : this.signalRepo.getSignalsSince(new Date(cutoffTime), filters);
            const [trades, signals, entryDecisions] = await Promise.all([
                this.tradeRepo.getTradesSince(cutoffTime, tradeFilters),
                signalQuery,
                profile === "full" && this.entryDecisionRepo
                    ? this.entryDecisionRepo.getDecisionsSince(cutoffTime, filters)
                    : Promise.resolve([]),
            ]);

            // Filter to closed trades only for performance metrics
            const closedTrades = trades.filter(
                (t) => !t.isOpen && t.pnlAud !== null && t.pnlAud !== undefined
            );

            const signalEventSummary = this.extractSignalEventSummary(signals);

            // Calculate all metrics
            const summary = this.calculateSummary(closedTrades, {
                startTime: cutoffTime,
                endTime: now,
            });
            const pairPerformance = this.calculatePairPerformance(closedTrades);
            const sessionPerformance =
                this.calculateSessionPerformance(closedTrades);
            const signalAnalysis = this.calculateSignalAnalysis(
                signals,
                signalEventSummary
            );
            const exitAnalysis = this.calculateExitAnalysis(closedTrades);
            const equityData = this.calculateEquityData(closedTrades);
            const adxAnalysis = this.calculateAdxAnalysis(closedTrades);
            const sidePerformance = this.calculateSidePerformance(closedTrades);
            const deepAnalytics =
                profile === "full"
                    ? {
                          cohortExpectancy:
                              this.calculateCohortExpectancy(closedTrades),
                          expectationVsActual: this.calculateExpectationVsActual(
                              signalEventSummary.uniqueActionableSignals,
                              closedTrades
                          ),
                          entryFunnel: this.calculateEntryFunnel(
                              signalEventSummary.uniqueActionableSignals,
                              entryDecisions,
                              closedTrades,
                              signalAnalysis
                          ),
                          strategyFunnel: signalAnalysis.decisionFunnel,
                          rejectionBreakdown:
                              this.calculateRejectionBreakdown(entryDecisions),
                          executionGapByCohort:
                              this.calculateExecutionGapByCohort(
                                  signalEventSummary.uniqueActionableSignals,
                                  entryDecisions,
                                  closedTrades
                              ),
                      }
                    : {};

            return {
                period,
                profile,
                mode: "live",
                filters: {
                    mode: "live",
                    strategy: filters.strategy || null,
                    runId: filters.runId || null,
                    selectionId: filters.selectionId || null,
                },
                generatedAt: new Date(now).toISOString(),
                summary,
                pairPerformance,
                sessionPerformance,
                signalAnalysis,
                exitAnalysis,
                equityData,
                adxAnalysis,
                sidePerformance,
                ...deepAnalytics,
                rawCounts: {
                    totalTrades: trades.length,
                    closedTrades: closedTrades.length,
                    openTrades: trades.filter((t) => t.isOpen).length,
                    totalSignals: signals.length,
                    uniqueActionableSignals:
                        signalEventSummary.uniqueActionableSignals.length,
                    uniqueExitOnlySignals:
                        signalEventSummary.uniqueExitOnlySignals.length,
                    exitOnlySignals: signalEventSummary.exitOnlyTotal,
                    cooldownDuplicateSignals:
                        signalEventSummary.cooldownDuplicates.length,
                    entryDecisions: entryDecisions.length,
                },
            };
        } catch (error) {
            logger.error("Analytics calculation error:", error);
            throw error;
        }
    }

    /**
     * Calculate summary statistics
     */
    calculateSummary(trades, options = {}) {
        if (!trades.length) {
            return {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnLAud: 0,
                totalPnLPips: 0,
                avgPnLAud: 0,
                avgPnLPips: 0,
                avgWinAud: 0,
                avgLossAud: 0,
                avgWinPips: 0,
                avgLossPips: 0,
                profitFactor: 0,
                largestWinAud: 0,
                largestLossAud: 0,
                avgHoldingTimeMs: 0,
                sharpeRatio: 0,
                winRate95: { lower: 0, upper: 100 },
                expectancy95Aud: { lower: 0, upper: 0, samples: 0 },
                maxDrawdownAud: 0,
                longestLosingStreak: 0,
                statisticalSampleAdequate: false,
                referenceCurrency: "AUD",
                costs: {
                    financingAud: 0,
                    commissionAud: 0,
                    grossBeforeExplicitCostsAud: 0,
                },
                concentration: {
                    topInstrument: null,
                    topSharePct: 0,
                    herfindahl: 0,
                },
            };
        }

        const winners = trades.filter((t) => t.pnlAud > 0);
        const losers = trades.filter((t) => t.pnlAud < 0);

        const totalPnLAud = trades.reduce((sum, t) => sum + (t.pnlAud || 0), 0);
        const totalPnLPips = trades.reduce(
            (sum, t) => sum + (t.pnlPips || 0),
            0
        );

        const grossWin = winners.reduce((sum, t) => sum + t.pnlAud, 0);
        const grossLoss = Math.abs(
            losers.reduce((sum, t) => sum + t.pnlAud, 0)
        );

        const avgWinAud = winners.length > 0 ? grossWin / winners.length : 0;
        const avgLossAud = losers.length > 0 ? grossLoss / losers.length : 0;

        const avgWinPips =
            winners.length > 0
                ? winners.reduce((sum, t) => sum + (t.pnlPips || 0), 0) /
                  winners.length
                : 0;
        const avgLossPips =
            losers.length > 0
                ? Math.abs(
                      losers.reduce((sum, t) => sum + (t.pnlPips || 0), 0) /
                          losers.length
                  )
                : 0;

        // Calculate Sharpe Ratio (simplified - using daily returns)
        const sharpeRatio = this.calculateSharpeRatio(trades, options);

        // Average holding time
        const tradesWithHoldingTime = trades.filter((t) => t.holdingPeriodMs);
        const avgHoldingTimeMs =
            tradesWithHoldingTime.length > 0
                ? tradesWithHoldingTime.reduce(
                      (sum, t) => sum + t.holdingPeriodMs,
                      0
                  ) / tradesWithHoldingTime.length
                : 0;
        const winRateInterval = wilsonInterval(winners.length, trades.length);
        const expectancyInterval = bootstrapMeanInterval(
            trades.map((trade) => toFiniteNumber(trade.pnlAud)),
            { samples: 500, seed: 0x41d5 }
        );
        const financingAud = trades.reduce(
            (sum, trade) => sum + toFiniteNumber(trade.swapAud),
            0
        );
        const commissionAud = trades.reduce(
            (sum, trade) => sum + toFiniteNumber(trade.commissionAud),
            0
        );

        return {
            totalTrades: trades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate:
                trades.length > 0 ? (winners.length / trades.length) * 100 : 0,
            totalPnLAud: parseFloat(totalPnLAud.toFixed(2)),
            totalPnLPips: parseFloat(totalPnLPips.toFixed(1)),
            avgPnLAud: parseFloat((totalPnLAud / trades.length).toFixed(2)),
            avgPnLPips: parseFloat((totalPnLPips / trades.length).toFixed(1)),
            avgWinAud: parseFloat(avgWinAud.toFixed(2)),
            avgLossAud: parseFloat(avgLossAud.toFixed(2)),
            avgWinPips: parseFloat(avgWinPips.toFixed(1)),
            avgLossPips: parseFloat(avgLossPips.toFixed(1)),
            profitFactor:
                grossLoss > 0
                    ? parseFloat((grossWin / grossLoss).toFixed(2))
                    : grossWin > 0
                    ? 999
                    : 0,
            largestWinAud: parseFloat(
                Math.max(...trades.map((t) => t.pnlAud || 0), 0).toFixed(2)
            ),
            largestLossAud: parseFloat(
                Math.min(...trades.map((t) => t.pnlAud || 0), 0).toFixed(2)
            ),
            avgHoldingTimeMs: Math.round(avgHoldingTimeMs),
            sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
            winRate95: {
                lower: roundTo(winRateInterval.lower * 100, 1),
                upper: roundTo(winRateInterval.upper * 100, 1),
            },
            expectancy95Aud: {
                lower: roundTo(expectancyInterval.lower, 4),
                upper: roundTo(expectancyInterval.upper, 4),
                samples: expectancyInterval.samples,
            },
            maxDrawdownAud: roundTo(calculateMaxDrawdownAud(trades), 2),
            longestLosingStreak: calculateLongestLosingStreak(trades),
            statisticalSampleAdequate: trades.length >= 100,
            referenceCurrency: "AUD",
            costs: {
                financingAud: roundTo(financingAud, 4),
                commissionAud: roundTo(commissionAud, 4),
                grossBeforeExplicitCostsAud: roundTo(
                    totalPnLAud - financingAud - commissionAud,
                    4
                ),
            },
            concentration: calculatePnlConcentration(trades),
        };
    }

    /**
     * Calculate Sharpe Ratio (annualized)
     */
    calculateSharpeRatio(trades, options = {}) {
        if (trades.length < 2) return 0;

        const tradeTimestamps = trades
            .map((trade) => toFiniteNumber(trade.exitTime || trade.entryTime, NaN))
            .filter((timestamp) => Number.isFinite(timestamp));
        if (tradeTimestamps.length < 2) return 0;

        let rangeStart = Number.isFinite(options.startTime)
            ? options.startTime
            : Math.min(...tradeTimestamps);
        let rangeEnd = Number.isFinite(options.endTime)
            ? options.endTime
            : Math.max(...tradeTimestamps);

        if (rangeEnd < rangeStart) {
            [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
        }

        const getUtcDayStart = (timestamp) => {
            const date = new Date(timestamp);
            return Date.UTC(
                date.getUTCFullYear(),
                date.getUTCMonth(),
                date.getUTCDate()
            );
        };
        const getUtcDayKey = (timestamp) =>
            new Date(timestamp).toISOString().split("T")[0];

        const dailyReturns = {};
        const firstDay = getUtcDayStart(rangeStart);
        const lastDay = getUtcDayStart(rangeEnd);

        for (
            let dayCursor = firstDay;
            dayCursor <= lastDay;
            dayCursor += 24 * 60 * 60 * 1000
        ) {
            dailyReturns[getUtcDayKey(dayCursor)] = 0;
        }

        trades.forEach((t) => {
            const timestamp = toFiniteNumber(t.exitTime || t.entryTime, NaN);
            if (!Number.isFinite(timestamp)) return;
            const day = getUtcDayKey(timestamp);
            dailyReturns[day] = (dailyReturns[day] || 0) + (t.pnlAud || 0);
        });

        const returns = Object.values(dailyReturns);
        if (returns.length < 2) return 0;

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance =
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            returns.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return avgReturn > 0 ? 999 : 0;

        // Annualize (assuming ~252 trading days)
        return (avgReturn / stdDev) * Math.sqrt(252);
    }

    /**
     * Calculate performance by currency pair
     */
    calculatePairPerformance(trades) {
        const pairStats = {};

        trades.forEach((trade) => {
            const pair = trade.instrument;
            if (!pairStats[pair]) {
                pairStats[pair] = {
                    instrument: pair,
                    totalTrades: 0,
                    wins: 0,
                    losses: 0,
                    totalPnLAud: 0,
                    totalPnLPips: 0,
                    bestTradeAud: -Infinity,
                    worstTradeAud: Infinity,
                    avgSignalStrength: 0,
                    strengthSum: 0,
                };
            }

            const stats = pairStats[pair];
            stats.totalTrades++;
            stats.totalPnLAud += trade.pnlAud || 0;
            stats.totalPnLPips += trade.pnlPips || 0;

            if (trade.pnlAud > 0) stats.wins++;
            else if (trade.pnlAud < 0) stats.losses++;

            stats.bestTradeAud = Math.max(
                stats.bestTradeAud,
                trade.pnlAud || 0
            );
            stats.worstTradeAud = Math.min(
                stats.worstTradeAud,
                trade.pnlAud || 0
            );

            if (trade.signalStrength) {
                stats.strengthSum += trade.signalStrength;
            }
        });

        // Calculate derived metrics
        return Object.values(pairStats).map((stats) => ({
            ...stats,
            winRate:
                stats.totalTrades > 0
                    ? (stats.wins / stats.totalTrades) * 100
                    : 0,
            avgSignalStrength:
                stats.totalTrades > 0
                    ? stats.strengthSum / stats.totalTrades
                    : 0,
            totalPnLAud: parseFloat(stats.totalPnLAud.toFixed(2)),
            totalPnLPips: parseFloat(stats.totalPnLPips.toFixed(1)),
            bestTradeAud:
                stats.bestTradeAud === -Infinity
                    ? 0
                    : parseFloat(stats.bestTradeAud.toFixed(2)),
            worstTradeAud:
                stats.worstTradeAud === Infinity
                    ? 0
                    : parseFloat(stats.worstTradeAud.toFixed(2)),
        }));
    }

    /**
     * Calculate performance by trading session
     */
    calculateSessionPerformance(trades) {
        const sessionStats = {
            Sydney: {
                session: "Sydney",
                trades: 0,
                wins: 0,
                pnlAud: 0,
                pnlPips: 0,
            },
            Tokyo: {
                session: "Tokyo",
                trades: 0,
                wins: 0,
                pnlAud: 0,
                pnlPips: 0,
            },
            London: {
                session: "London",
                trades: 0,
                wins: 0,
                pnlAud: 0,
                pnlPips: 0,
            },
            "New York": {
                session: "New York",
                trades: 0,
                wins: 0,
                pnlAud: 0,
                pnlPips: 0,
            },
            "Off-Hours": {
                session: "Off-Hours",
                trades: 0,
                wins: 0,
                pnlAud: 0,
                pnlPips: 0,
            },
        };

        trades.forEach((trade) => {
            const session = getSessionForTimestamp(trade.entryTime);
            const stats = sessionStats[session];

            stats.trades++;
            stats.pnlAud += trade.pnlAud || 0;
            stats.pnlPips += trade.pnlPips || 0;
            if (trade.pnlAud > 0) stats.wins++;
        });

        return Object.values(sessionStats)
            .filter((s) => s.trades > 0)
            .map((s) => ({
                ...s,
                winRate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
                pnlAud: parseFloat(s.pnlAud.toFixed(2)),
                pnlPips: parseFloat(s.pnlPips.toFixed(1)),
            }));
    }

    extractSignalEventSummary(signals) {
        const seenActionableKeys = new Set();
        const seenExitOnlyKeys = new Set();
        const uniqueActionableSignals = [];
        const uniqueExitOnlySignals = [];
        const cooldownDuplicates = [];
        const telemetryCoverage = {
            signalClass: 0,
            reasonCode: 0,
            intent: 0,
            setupId: 0,
            signalCandleTime: 0,
            uniqueEvent: 0,
            cooldownSuppressed: 0,
            configHash: 0,
            mode: 0,
            strategy: 0,
            runId: 0,
            selectionId: 0,
        };

        let actionableTotal = 0;
        let exitOnlyTotal = 0;

        signals.forEach((signal) => {
            if (normalizeString(signal?.signalClass)) telemetryCoverage.signalClass++;
            if (normalizeString(signal?.reasonCode)) telemetryCoverage.reasonCode++;
            if (normalizeString(signal?.intent)) telemetryCoverage.intent++;
            if (normalizeString(signal?.setupId)) telemetryCoverage.setupId++;
            if (
                signal?.signalCandleTime !== null &&
                signal?.signalCandleTime !== undefined
            ) {
                telemetryCoverage.signalCandleTime++;
            }
            if (signal?.uniqueEvent !== null && signal?.uniqueEvent !== undefined) {
                telemetryCoverage.uniqueEvent++;
            }
            if (
                signal?.cooldownSuppressed !== null &&
                signal?.cooldownSuppressed !== undefined
            ) {
                telemetryCoverage.cooldownSuppressed++;
            }
            if (normalizeString(signal?.configHash)) telemetryCoverage.configHash++;
            if (normalizeString(signal?.mode)) telemetryCoverage.mode++;
            if (normalizeString(signal?.strategy)) telemetryCoverage.strategy++;
            if (normalizeString(signal?.runId) || normalizeString(signal?.run_id)) {
                telemetryCoverage.runId++;
            }
            if (
                normalizeString(signal?.selectionId) ||
                normalizeString(signal?.selection_id)
            ) {
                telemetryCoverage.selectionId++;
            }

            const actionable = isActionableSignal(signal);
            const cooldownDuplicate = isCooldownDuplicate(signal);
            const exitOnly = isExitOnlySignal(signal) && !cooldownDuplicate;

            if (actionable) {
                actionableTotal++;
            }
            if (exitOnly) {
                exitOnlyTotal++;
            }

            if (actionable && isUniqueSignalEvent(signal, seenActionableKeys)) {
                uniqueActionableSignals.push(signal);
                return;
            }

            if (exitOnly && isUniqueSignalEvent(signal, seenExitOnlyKeys)) {
                uniqueExitOnlySignals.push(signal);
                return;
            }

            if (cooldownDuplicate || actionable || exitOnly) {
                cooldownDuplicates.push(signal);
            }
        });

        return {
            actionableTotal,
            exitOnlyTotal,
            uniqueActionableSignals,
            uniqueExitOnlySignals,
            cooldownDuplicates,
            telemetryCoverage,
        };
    }

    /**
     * Analyze signal quality and filtering
     */
    calculateSignalAnalysis(signals, eventSummary = null) {
        const summary = eventSummary || this.extractSignalEventSummary(signals);
        const decisions = dedupeStrategyDecisions(signals);
        const stats = {
            total: signals.length,
            rawTotal: signals.length,
            decisionTotal: decisions.length,
            triggered: summary.uniqueActionableSignals.length,
            actionableTotal: summary.actionableTotal,
            actionableUnique: summary.uniqueActionableSignals.length,
            triggeredIncludingDuplicates: summary.actionableTotal,
            cooldownDuplicates: summary.cooldownDuplicates.length,
            exitOnlyTotal: summary.exitOnlyTotal,
            exitOnlyUnique: summary.uniqueExitOnlySignals.length,
            filteredChoppy: 0,
            filteredAdxSlope: 0,
            filteredOverbought: 0,
            filteredOversold: 0,
            filtered: 0,
            marketState: 0,
            setupForming: 0,
            pending: 0,
            hold: 0,
            byType: {},
            byPair: {},
            bySignalClass: {},
            byIntent: {},
            byReasonCode: {},
            rawByReasonCode: {},
            avgStrength: 0,
            telemetryCoverage: summary.telemetryCoverage,
        };

        let totalStrength = 0;

        signals.forEach((signal) => {
            const reasonCode = normalizeUpper(signal.reasonCode) || "UNKNOWN";
            stats.rawByReasonCode[reasonCode] =
                (stats.rawByReasonCode[reasonCode] || 0) + 1;
        });

        decisions.forEach((signal) => {
            const type = signal.signal || "UNKNOWN";
            const signalClass = normalizeUpper(signal.signalClass) || "UNCLASSIFIED";
            const intent = normalizeUpper(signal.intent) || "UNSPECIFIED";
            const reasonCode = normalizeUpper(signal.reasonCode) || "UNKNOWN";
            const message = (signal.message || "").toLowerCase();
            const actionable = isActionableSignal(signal);
            const cooldownDuplicate = isCooldownDuplicate(signal);
            const exitOnly = isExitOnlySignal(signal) && !cooldownDuplicate;

            if (actionable || exitOnly || cooldownDuplicate) {
                // Counted separately in top-level buckets.
            } else if (signalClass === "PENDING") {
                stats.setupForming++;
                stats.pending++;
                stats.hold++;
            } else if (
                signalClass === "INFO" ||
                reasonCode === "BASE_TREND_STATE" ||
                reasonCode.endsWith("_MARKET_STATE")
            ) {
                stats.marketState++;
                stats.hold++;
            } else if (
                message.includes("falling adx") ||
                message.includes("adx_slope") ||
                reasonCode.includes("ADX_SLOPE")
            ) {
                stats.filtered++;
                stats.filteredAdxSlope++;
            } else if (
                message.includes("choppy") ||
                message.includes("weak") ||
                reasonCode.includes("BLOCKED_ADX") ||
                reasonCode.includes("ADX_TOO_LOW")
            ) {
                stats.filtered++;
                stats.filteredChoppy++;
            } else if (
                message.includes("overbought") ||
                reasonCode.includes("OVERBOUGHT")
            ) {
                stats.filtered++;
                stats.filteredOverbought++;
            } else if (message.includes("oversold")) {
                stats.filtered++;
                stats.filteredOversold++;
            } else if (message.includes("momentum") && deriveSignalSide(signal) !== "SELL") {
                stats.filtered++;
                stats.filteredOverbought++;
            } else if (message.includes("momentum") && deriveSignalSide(signal) === "SELL") {
                stats.filtered++;
                stats.filteredOversold++;
            } else if (signalClass === "FILTERED") {
                stats.filtered++;
            } else {
                stats.hold++;
            }

            // Count by type
            stats.byType[type] = (stats.byType[type] || 0) + 1;
            stats.bySignalClass[signalClass] =
                (stats.bySignalClass[signalClass] || 0) + 1;
            stats.byIntent[intent] = (stats.byIntent[intent] || 0) + 1;
            stats.byReasonCode[reasonCode] =
                (stats.byReasonCode[reasonCode] || 0) + 1;

            // Count by pair
            const pairKey = signal.symbol || signal.instrument || "UNKNOWN";
            stats.byPair[pairKey] = (stats.byPair[pairKey] || 0) + 1;

            // Sum strength
            totalStrength += signal.strength || 0;
        });

        stats.avgStrength =
            decisions.length > 0 ? totalStrength / decisions.length : 0;

        // Convert to pie chart format
        stats.filterBreakdown = [
            { label: "Triggered", value: stats.triggered, color: "success" },
            { label: "Exit Only", value: stats.exitOnlyUnique, color: "info" },
            {
                label: "Cooldown Duplicates",
                value: stats.cooldownDuplicates,
                color: "secondary",
            },
            {
                label: "Filtered (Trend/ADX)",
                value: stats.filteredChoppy,
                color: "warning",
            },
            {
                label: "Filtered (ADX Falling)",
                value: stats.filteredAdxSlope,
                color: "error",
            },
            {
                label: "Filtered (Overbought)",
                value: stats.filteredOverbought,
                color: "info",
            },
            {
                label: "Filtered (Oversold)",
                value: stats.filteredOversold,
                color: "info",
            },
            { label: "Setup Forming", value: stats.setupForming, color: "warning" },
            { label: "Market State", value: stats.marketState, color: "default" },
            {
                label: "Other Filtered",
                value: Math.max(
                    0,
                    stats.filtered -
                        stats.filteredChoppy -
                        stats.filteredAdxSlope -
                        stats.filteredOverbought -
                        stats.filteredOversold
                ),
                color: "default",
            },
            {
                label: "Other Hold/Wait",
                value: Math.max(0, stats.hold - stats.setupForming - stats.marketState),
                color: "default",
            },
        ].filter((d) => d.value > 0);

        stats.decisionFunnel = {
            summary: {
                rawObservations: stats.rawTotal,
                uniqueStrategyDecisions: stats.decisionTotal,
                marketState: stats.marketState,
                setupForming: stats.setupForming,
                filtered: stats.filtered,
                actionable: stats.actionableUnique,
                exitOnly: stats.exitOnlyUnique,
                cooldownDuplicates: stats.cooldownDuplicates,
            },
            reasons: Object.entries(stats.byReasonCode)
                .map(([reasonCode, count]) => ({ reasonCode, count }))
                .sort((left, right) => right.count - left.count),
        };

        return stats;
    }

    calculateEntryFunnel(
        uniqueActionableSignals,
        entryDecisions,
        closedTrades,
        signalAnalysis = null
    ) {
        const decisions = Array.isArray(entryDecisions) ? entryDecisions : [];
        const validated = decisions.filter((decision) =>
            ["VALIDATED", "SIZED", "ORDER_SUBMITTED", "FILLED"].includes(
                normalizeUpper(decision.stage)
            )
        ).length;
        const sized = decisions.filter((decision) =>
            ["SIZED", "ORDER_SUBMITTED", "FILLED"].includes(
                normalizeUpper(decision.stage)
            )
        ).length;
        const submitted = decisions.filter((decision) =>
            ["ORDER_SUBMITTED", "FILLED"].includes(
                normalizeUpper(decision.stage)
            )
        ).length;
        const filled = decisions.filter(
            (decision) =>
                normalizeUpper(decision.outcome) === "FILLED" ||
                normalizeUpper(decision.stage) === "FILLED" ||
                normalizeString(decision.tradeId)
        ).length;
        const rejected = decisions.filter(
            (decision) => normalizeUpper(decision.outcome) === "REJECTED"
        ).length;
        const generated = uniqueActionableSignals.length;
        const tracked = decisions.length;

        const toRate = (value, total) =>
            total > 0 ? roundTo((value / total) * 100, 1) : 0;

        return {
            summary: {
                rawStrategyObservations: signalAnalysis?.rawTotal ?? generated,
                uniqueStrategyDecisions:
                    signalAnalysis?.decisionTotal ?? generated,
                setupCandidates: signalAnalysis?.setupForming ?? 0,
                strategyFiltered: signalAnalysis?.filtered ?? 0,
                generatedSignals: generated,
                trackedDecisions: tracked,
                telemetryCoveragePct: toRate(tracked, generated),
                validatedEntries: validated,
                sizedEntries: sized,
                submittedOrders: submitted,
                filledTrades: filled,
                rejectedEntries: rejected,
                closedTrades: closedTrades.length,
            },
            rates: {
                validationRatePct: toRate(validated, tracked || generated),
                fillRatePct: toRate(filled, tracked || generated),
                closeRatePct: toRate(closedTrades.length, filled),
                rejectionRatePct: toRate(rejected, tracked || generated),
            },
        };
    }

    calculateRejectionBreakdown(entryDecisions) {
        const rejected = (entryDecisions || []).filter(
            (decision) => normalizeUpper(decision.outcome) === "REJECTED"
        );
        const buckets = new Map();

        rejected.forEach((decision) => {
            const code = normalizeUpper(decision.rejectionCode) || "UNKNOWN";
            if (!buckets.has(code)) {
                buckets.set(code, {
                    rejectionCode: code,
                    count: 0,
                    instruments: new Set(),
                    totalSpreadPips: 0,
                    spreadCount: 0,
                    totalPriceAgeMs: 0,
                    priceAgeCount: 0,
                    avgProjectedExposure: 0,
                    projectedExposureTotal: 0,
                    projectedExposureCount: 0,
                });
            }

            const bucket = buckets.get(code);
            bucket.count++;
            bucket.instruments.add(normalizeString(decision.instrument) || "UNKNOWN");

            if (Number.isFinite(Number(decision.spreadPips))) {
                bucket.totalSpreadPips += Number(decision.spreadPips);
                bucket.spreadCount++;
            }
            if (Number.isFinite(Number(decision.priceAgeMs))) {
                bucket.totalPriceAgeMs += Number(decision.priceAgeMs);
                bucket.priceAgeCount++;
            }
            if (Number.isFinite(Number(decision.projectedExposure))) {
                bucket.projectedExposureTotal += Number(decision.projectedExposure);
                bucket.projectedExposureCount++;
            }
        });

        const breakdown = Array.from(buckets.values())
            .map((bucket) => ({
                rejectionCode: bucket.rejectionCode,
                count: bucket.count,
                instruments: Array.from(bucket.instruments).sort(),
                avgSpreadPips:
                    bucket.spreadCount > 0
                        ? roundTo(bucket.totalSpreadPips / bucket.spreadCount, 2)
                        : 0,
                avgPriceAgeMs:
                    bucket.priceAgeCount > 0
                        ? roundTo(
                              bucket.totalPriceAgeMs / bucket.priceAgeCount,
                              0
                          )
                        : 0,
                avgProjectedExposure:
                    bucket.projectedExposureCount > 0
                        ? roundTo(
                              bucket.projectedExposureTotal /
                                  bucket.projectedExposureCount,
                              4
                          )
                        : 0,
            }))
            .sort((a, b) => b.count - a.count);

        return {
            totalRejected: rejected.length,
            breakdown,
        };
    }

    calculateExecutionGapByCohort(
        uniqueActionableSignals,
        entryDecisions,
        closedTrades
    ) {
        const expectedByCohort = new Map();
        const decisionsByCohort = new Map();
        const closedByCohort = new Map();

        uniqueActionableSignals.forEach((signal) => {
            const cohort = createSignalCohort(signal);
            const key = `${cohort.identityKey}|${cohort.configHash}|${cohort.cohort}`;
            if (!expectedByCohort.has(key)) {
                expectedByCohort.set(key, {
                    mode: cohort.mode,
                    strategy: cohort.strategy,
                    runId: cohort.runId,
                    selectionId: cohort.selectionId,
                    configHash: cohort.configHash,
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    expectedSignals: 0,
                    signalStrengthSum: 0,
                });
            }

            const bucket = expectedByCohort.get(key);
            bucket.expectedSignals++;
            bucket.signalStrengthSum += toFiniteNumber(signal.strength);
        });

        (entryDecisions || []).forEach((decision) => {
            const cohort = createEntryDecisionCohort(decision);
            const key = `${cohort.identityKey}|${cohort.configHash}|${cohort.cohort}`;
            if (!decisionsByCohort.has(key)) {
                decisionsByCohort.set(key, {
                    mode: cohort.mode,
                    strategy: cohort.strategy,
                    runId: cohort.runId,
                    selectionId: cohort.selectionId,
                    configHash: cohort.configHash,
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    trackedDecisions: 0,
                    validatedEntries: 0,
                    submittedOrders: 0,
                    filledTrades: 0,
                    rejectedEntries: 0,
                });
            }

            const bucket = decisionsByCohort.get(key);
            bucket.trackedDecisions++;

            const stage = normalizeUpper(decision.stage);
            const outcome = normalizeUpper(decision.outcome);
            if (["VALIDATED", "SIZED", "ORDER_SUBMITTED", "FILLED"].includes(stage)) {
                bucket.validatedEntries++;
            }
            if (["ORDER_SUBMITTED", "FILLED"].includes(stage)) {
                bucket.submittedOrders++;
            }
            if (outcome === "FILLED" || stage === "FILLED" || normalizeString(decision.tradeId)) {
                bucket.filledTrades++;
            }
            if (outcome === "REJECTED") {
                bucket.rejectedEntries++;
            }
        });

        closedTrades.forEach((trade) => {
            const cohort = createTradeCohort(trade);
            const key = `${cohort.identityKey}|${cohort.configHash}|${cohort.cohort}`;
            if (!closedByCohort.has(key)) {
                closedByCohort.set(key, {
                    mode: cohort.mode,
                    strategy: cohort.strategy,
                    runId: cohort.runId,
                    selectionId: cohort.selectionId,
                    configHash: cohort.configHash,
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    closedTrades: 0,
                    totalPnLAud: 0,
                    totalPnLPips: 0,
                });
            }

            const bucket = closedByCohort.get(key);
            bucket.closedTrades++;
            bucket.totalPnLAud += toFiniteNumber(trade.pnlAud);
            bucket.totalPnLPips += toFiniteNumber(trade.pnlPips);
        });

        const keys = Array.from(
            new Set([
                ...expectedByCohort.keys(),
                ...decisionsByCohort.keys(),
                ...closedByCohort.keys(),
            ])
        );

        const byCohort = keys
            .map((key) => {
                const expected = expectedByCohort.get(key) || {};
                const decision = decisionsByCohort.get(key) || {};
                const closed = closedByCohort.get(key) || {};
                const expectedSignals = expected.expectedSignals || 0;

                return {
                    mode: expected.mode || decision.mode || closed.mode || "live",
                    strategy:
                        expected.strategy || decision.strategy || closed.strategy || "unknown",
                    runId:
                        expected.runId || decision.runId || closed.runId || "unassigned",
                    selectionId:
                        expected.selectionId ||
                        decision.selectionId ||
                        closed.selectionId ||
                        "unassigned",
                    configHash:
                        expected.configHash ||
                        decision.configHash ||
                        closed.configHash ||
                        "unknown",
                    cohort:
                        expected.cohort ||
                        decision.cohort ||
                        closed.cohort ||
                        "UNKNOWN",
                    instrument:
                        expected.instrument ||
                        decision.instrument ||
                        closed.instrument ||
                        "UNKNOWN",
                    side: expected.side || decision.side || closed.side || "UNKNOWN",
                    cohortType:
                        expected.cohortType ||
                        decision.cohortType ||
                        closed.cohortType ||
                        "UNKNOWN",
                    expectedSignals,
                    trackedDecisions: decision.trackedDecisions || 0,
                    validatedEntries: decision.validatedEntries || 0,
                    submittedOrders: decision.submittedOrders || 0,
                    filledTrades: decision.filledTrades || 0,
                    rejectedEntries: decision.rejectedEntries || 0,
                    closedTrades: closed.closedTrades || 0,
                    executionRatePct:
                        expectedSignals > 0
                            ? roundTo(
                                  ((decision.filledTrades || 0) / expectedSignals) *
                                      100,
                                  1
                              )
                            : 0,
                    rejectionRatePct:
                        expectedSignals > 0
                            ? roundTo(
                                  ((decision.rejectedEntries || 0) /
                                      expectedSignals) *
                                      100,
                                  1
                              )
                            : 0,
                    totalPnLAud: roundTo(closed.totalPnLAud || 0, 2),
                    totalPnLPips: roundTo(closed.totalPnLPips || 0, 1),
                    avgSignalStrength:
                        expectedSignals > 0
                            ? roundTo(
                                  expected.signalStrengthSum / expectedSignals,
                                  2
                              )
                            : 0,
                };
            })
            .sort((a, b) => b.expectedSignals - a.expectedSignals);

        return {
            summary: {
                cohorts: byCohort.length,
                actionableSignals: uniqueActionableSignals.length,
                trackedDecisions: (entryDecisions || []).length,
            },
            byCohort,
        };
    }

    /**
     * Analyze exit reasons
     */
    calculateExitAnalysis(trades) {
        const exitCounts = {};

        trades.forEach((trade) => {
            const reason = trade.exitReason || "Unknown";
            exitCounts[reason] = (exitCounts[reason] || 0) + 1;
        });

        // Convert to array format with title case formatting
        const breakdown = Object.entries(exitCounts)
            .map(([reason, count]) => ({
                reason: this.formatExitReason(reason),
                count,
                percentage:
                    trades.length > 0 ? (count / trades.length) * 100 : 0,
            }))
            .sort((a, b) => b.count - a.count);

        return {
            total: trades.length,
            breakdown,
        };
    }

    /**
     * Format exit reason to title case for display
     * STOP_LOSS -> Stop Loss, TAKE_PROFIT -> Take Profit, etc.
     */
    formatExitReason(reason) {
        if (!reason) return "Unknown";
        return reason
            .toLowerCase()
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    /**
     * Calculate equity curve data for charts
     */
    calculateEquityData(trades) {
        // Sort by exit time
        const sortedTrades = [...trades]
            .filter((t) => t.exitTime)
            .sort(
                (a, b) =>
                    (a.exitTime || a.entryTime) - (b.exitTime || b.entryTime)
            );

        // Cumulative equity curve
        let runningPnL = 0;
        const equityCurve = sortedTrades.map((trade) => {
            runningPnL += trade.pnlAud || 0;
            return {
                timestamp: trade.exitTime || trade.entryTime,
                date: new Date(trade.exitTime || trade.entryTime).toISOString(),
                pnlAud: parseFloat(runningPnL.toFixed(2)),
                tradeId: trade.id,
            };
        });

        // Daily P/L aggregation
        const dailyMap = {};
        sortedTrades.forEach((trade) => {
            const day = new Date(trade.exitTime || trade.entryTime)
                .toISOString()
                .split("T")[0];
            if (!dailyMap[day]) {
                dailyMap[day] = { date: day, pnlAud: 0, pnlPips: 0, trades: 0 };
            }
            dailyMap[day].pnlAud += trade.pnlAud || 0;
            dailyMap[day].pnlPips += trade.pnlPips || 0;
            dailyMap[day].trades++;
        });

        const dailyPnL = Object.values(dailyMap)
            .map((d) => ({
                ...d,
                pnlAud: parseFloat(d.pnlAud.toFixed(2)),
                pnlPips: parseFloat(d.pnlPips.toFixed(1)),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return {
            equityCurve,
            dailyPnL,
        };
    }

    /**
     * Analyze ADX (trend strength) correlation with trade outcomes
     */
    calculateAdxAnalysis(trades) {
        const tradesWithAdx = trades.filter((t) => t.signalStrength > 0);

        if (tradesWithAdx.length === 0) {
            return {
                avgAdxWinners: 0,
                avgAdxLosers: 0,
                correlation: "insufficient_data",
                recommendation: "Need more trades with ADX data",
            };
        }

        const winners = tradesWithAdx.filter((t) => t.pnlAud > 0);
        const losers = tradesWithAdx.filter((t) => t.pnlAud < 0);

        const avgAdxWinners =
            winners.length > 0
                ? winners.reduce((sum, t) => sum + t.signalStrength, 0) /
                  winners.length
                : 0;

        const avgAdxLosers =
            losers.length > 0
                ? losers.reduce((sum, t) => sum + t.signalStrength, 0) /
                  losers.length
                : 0;

        // Determine correlation
        let correlation = "neutral";
        let recommendation = "ADX filter appears effective";

        if (avgAdxWinners > avgAdxLosers + 3) {
            correlation = "positive";
            recommendation =
                "Winners have stronger trends - ADX filter is working well";
        } else if (avgAdxLosers > avgAdxWinners + 3) {
            correlation = "inverted";
            recommendation =
                "Consider raising ADX threshold - losers show stronger ADX";
        }

        return {
            avgAdxWinners: parseFloat(avgAdxWinners.toFixed(1)),
            avgAdxLosers: parseFloat(avgAdxLosers.toFixed(1)),
            sampleSize: tradesWithAdx.length,
            correlation,
            recommendation,
        };
    }

    /**
     * Analyze performance split by side (BUY vs SELL) and entry type
     */
    calculateSidePerformance(trades) {
        const sideStats = {
            BUY: {
                side: "BUY",
                totalTrades: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnLAud: 0,
                totalPnLPips: 0,
                avgPnLAud: 0,
            },
            SELL: {
                side: "SELL",
                totalTrades: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnLAud: 0,
                totalPnLPips: 0,
                avgPnLAud: 0,
            },
        };

        const entryTypeStats = {};

        trades.forEach((trade) => {
            const side = trade.side === "SELL" ? "SELL" : "BUY";
            const stats = sideStats[side];
            const pnlAud = trade.pnlAud || 0;
            const pnlPips = trade.pnlPips || 0;
            const entryType = trade.entryType || "UNKNOWN";

            stats.totalTrades++;
            stats.totalPnLAud += pnlAud;
            stats.totalPnLPips += pnlPips;
            if (pnlAud > 0) stats.wins++;
            if (pnlAud < 0) stats.losses++;

            if (!entryTypeStats[entryType]) {
                entryTypeStats[entryType] = {
                    entryType,
                    buyTrades: 0,
                    buyWinRate: 0,
                    buyPnLAud: 0,
                    sellTrades: 0,
                    sellWinRate: 0,
                    sellPnLAud: 0,
                };
            }

            const entryStats = entryTypeStats[entryType];
            if (side === "BUY") {
                entryStats.buyTrades++;
                entryStats.buyPnLAud += pnlAud;
                if (pnlAud > 0) {
                    entryStats.buyWins = (entryStats.buyWins || 0) + 1;
                }
            } else {
                entryStats.sellTrades++;
                entryStats.sellPnLAud += pnlAud;
                if (pnlAud > 0) {
                    entryStats.sellWins = (entryStats.sellWins || 0) + 1;
                }
            }
        });

        const buy = sideStats.BUY;
        const sell = sideStats.SELL;

        [buy, sell].forEach((stats) => {
            stats.winRate =
                stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0;
            stats.avgPnLAud =
                stats.totalTrades > 0 ? stats.totalPnLAud / stats.totalTrades : 0;
            stats.totalPnLAud = parseFloat(stats.totalPnLAud.toFixed(2));
            stats.totalPnLPips = parseFloat(stats.totalPnLPips.toFixed(1));
            stats.avgPnLAud = parseFloat(stats.avgPnLAud.toFixed(2));
            stats.winRate = parseFloat(stats.winRate.toFixed(1));
        });

        const byEntryType = Object.values(entryTypeStats)
            .map((entry) => {
                const buyWins = entry.buyWins || 0;
                const sellWins = entry.sellWins || 0;
                const buyWinRate =
                    entry.buyTrades > 0 ? (buyWins / entry.buyTrades) * 100 : 0;
                const sellWinRate =
                    entry.sellTrades > 0 ? (sellWins / entry.sellTrades) * 100 : 0;

                return {
                    entryType: entry.entryType,
                    buyTrades: entry.buyTrades,
                    buyWinRate: parseFloat(buyWinRate.toFixed(1)),
                    buyPnLAud: parseFloat(entry.buyPnLAud.toFixed(2)),
                    sellTrades: entry.sellTrades,
                    sellWinRate: parseFloat(sellWinRate.toFixed(1)),
                    sellPnLAud: parseFloat(entry.sellPnLAud.toFixed(2)),
                    totalTrades: entry.buyTrades + entry.sellTrades,
                };
            })
            .sort((a, b) => b.totalTrades - a.totalTrades);

        const totalTrades = trades.length;
        const sellSharePercent =
            totalTrades > 0 ? (sell.totalTrades / totalTrades) * 100 : 0;

        return {
            buy,
            sell,
            totalTrades,
            sellSharePercent: parseFloat(sellSharePercent.toFixed(1)),
            byEntryType,
        };
    }

    getInitialRiskPips(trade = {}) {
        const pipValue = getPipValue(trade.instrument);
        const payload = normalizePayloadObject(trade.brokerReconciliationPayload);
        const runtimeMetadata = payload.liveRuntime || payload.runtime || {};
        const initialStopDistance = toFiniteNumber(
            runtimeMetadata.initialStopDistance,
            NaN
        );

        if (Number.isFinite(initialStopDistance) && initialStopDistance > 0) {
            return initialStopDistance / pipValue;
        }

        const entryPrice = toFiniteNumber(trade.entryPrice, NaN);
        const stopLossPrice = toFiniteNumber(trade.stopLossPrice, NaN);
        if (
            Number.isFinite(entryPrice) &&
            Number.isFinite(stopLossPrice) &&
            entryPrice !== stopLossPrice
        ) {
            return Math.abs(entryPrice - stopLossPrice) / pipValue;
        }

        return null;
    }

    calculateCohortExpectancy(trades = []) {
        const createBucket = (fields = {}) => ({
            ...fields,
            trades: 0,
            wins: 0,
            losses: 0,
            flat: 0,
            totalPnLAud: 0,
            totalPnLPips: 0,
            grossWinPips: 0,
            grossLossPips: 0,
            grossWinAud: 0,
            grossLossAud: 0,
            riskMultipleSum: 0,
            riskMultipleCount: 0,
            winRiskMultipleSum: 0,
            winRiskMultipleCount: 0,
            lossRiskMultipleSum: 0,
            lossRiskMultipleCount: 0,
        });

        const addTrade = (bucket, trade) => {
            const pnlAud = toFiniteNumber(trade.pnlAud);
            const pnlPips = toFiniteNumber(trade.pnlPips);
            const initialRiskPips = this.getInitialRiskPips(trade);

            bucket.trades++;
            bucket.totalPnLAud += pnlAud;
            bucket.totalPnLPips += pnlPips;

            if (pnlPips > 0) {
                bucket.wins++;
                bucket.grossWinPips += pnlPips;
                bucket.grossWinAud += Math.max(0, pnlAud);
            } else if (pnlPips < 0) {
                bucket.losses++;
                bucket.grossLossPips += Math.abs(pnlPips);
                bucket.grossLossAud += Math.abs(Math.min(0, pnlAud));
            } else {
                bucket.flat++;
            }

            if (Number.isFinite(initialRiskPips) && initialRiskPips > 0) {
                const riskMultiple = pnlPips / initialRiskPips;
                bucket.riskMultipleSum += riskMultiple;
                bucket.riskMultipleCount++;
                if (riskMultiple > 0) {
                    bucket.winRiskMultipleSum += riskMultiple;
                    bucket.winRiskMultipleCount++;
                } else if (riskMultiple < 0) {
                    bucket.lossRiskMultipleSum += Math.abs(riskMultiple);
                    bucket.lossRiskMultipleCount++;
                }
            }
        };

        const finalizeBucket = (bucket) => {
            const tradesCount = bucket.trades;
            const avgWinPips =
                bucket.wins > 0 ? bucket.grossWinPips / bucket.wins : 0;
            const avgLossPips =
                bucket.losses > 0 ? bucket.grossLossPips / bucket.losses : 0;
            const winRate = tradesCount > 0 ? bucket.wins / tradesCount : 0;
            const expectedEdge =
                tradesCount > 0
                    ? calculateExpectedEdge({
                          targetPips: avgWinPips,
                          stopPips: avgLossPips,
                          winProbability: winRate,
                          spreadPips: 0,
                          slippagePips: 0,
                      })
                    : null;

            return {
                ...bucket,
                winRatePct:
                    tradesCount > 0
                        ? roundTo((bucket.wins / tradesCount) * 100, 1)
                        : 0,
                totalPnLAud: roundTo(bucket.totalPnLAud, 2),
                totalPnLPips: roundTo(bucket.totalPnLPips, 1),
                netExpectancyAud:
                    tradesCount > 0
                        ? roundTo(bucket.totalPnLAud / tradesCount, 2)
                        : 0,
                netExpectancyPips:
                    tradesCount > 0
                        ? roundTo(bucket.totalPnLPips / tradesCount, 2)
                        : 0,
                avgWinPips: roundTo(avgWinPips, 2),
                avgLossPips: roundTo(avgLossPips, 2),
                avgR:
                    bucket.riskMultipleCount > 0
                        ? roundTo(
                              bucket.riskMultipleSum /
                                  bucket.riskMultipleCount,
                              3
                          )
                        : null,
                avgWinR:
                    bucket.winRiskMultipleCount > 0
                        ? roundTo(
                              bucket.winRiskMultipleSum /
                                  bucket.winRiskMultipleCount,
                              3
                          )
                        : null,
                avgLossR:
                    bucket.lossRiskMultipleCount > 0
                        ? roundTo(
                              bucket.lossRiskMultipleSum /
                                  bucket.lossRiskMultipleCount,
                              3
                          )
                        : null,
                profitFactorPips:
                    bucket.grossLossPips > 0
                        ? roundTo(bucket.grossWinPips / bucket.grossLossPips, 2)
                        : bucket.grossWinPips > 0
                        ? 999
                        : 0,
                profitFactorAud:
                    bucket.grossLossAud > 0
                        ? roundTo(bucket.grossWinAud / bucket.grossLossAud, 2)
                        : bucket.grossWinAud > 0
                        ? 999
                        : 0,
                expectedEdge,
            };
        };

        const getBucket = (map, key, fields) => {
            if (!map.has(key)) {
                map.set(key, createBucket(fields));
            }
            return map.get(key);
        };

        const summary = createBucket({ cohort: "ALL" });
        const bySide = new Map();
        const byInstrument = new Map();
        const bySession = new Map();
        const byEntryType = new Map();
        const byCohort = new Map();

        trades.forEach((trade) => {
            const cohort = createTradeCohort(trade);
            const side = cohort.side || "UNKNOWN";
            const instrument = cohort.instrument || "UNKNOWN";
            const session = getSessionForTimestamp(trade.entryTime);
            const entryType = cohort.cohortType || "UNKNOWN";
            const combinedKey = `${side}|${session}|${entryType}|${instrument}`;

            addTrade(summary, trade);
            addTrade(getBucket(bySide, side, { side }), trade);
            addTrade(getBucket(byInstrument, instrument, { instrument }), trade);
            addTrade(getBucket(bySession, session, { session }), trade);
            addTrade(getBucket(byEntryType, entryType, { entryType }), trade);
            addTrade(
                getBucket(byCohort, combinedKey, {
                    cohort: combinedKey,
                    side,
                    session,
                    entryType,
                    instrument,
                }),
                trade
            );
        });

        const finalizeCollection = (map) =>
            Array.from(map.values())
                .map(finalizeBucket)
                .sort(
                    (left, right) =>
                        right.trades - left.trades ||
                        right.netExpectancyPips - left.netExpectancyPips
                );

        return {
            summary: finalizeBucket(summary),
            bySide: finalizeCollection(bySide),
            byInstrument: finalizeCollection(byInstrument),
            bySession: finalizeCollection(bySession),
            byEntryType: finalizeCollection(byEntryType),
            byCohort: finalizeCollection(byCohort),
        };
    }

    calculateExpectationVsActual(uniqueActionableSignals, trades) {
        const expectedByConfigAndCohort = new Map();
        const actualByConfigAndCohort = new Map();
        const expectedByCohort = new Map();
        const actualByCohort = new Map();

        uniqueActionableSignals.forEach((signal) => {
            const cohort = createSignalCohort(signal);
            const configKey = `${cohort.identityKey}|${cohort.configHash}|${cohort.cohort}`;
            const cohortKey = cohort.cohort;

            if (!expectedByConfigAndCohort.has(configKey)) {
                expectedByConfigAndCohort.set(configKey, {
                    mode: cohort.mode,
                    strategy: cohort.strategy,
                    runId: cohort.runId,
                    selectionId: cohort.selectionId,
                    configHash: cohort.configHash,
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    expectedSignals: 0,
                    avgSignalStrength: 0,
                    signalStrengthSum: 0,
                });
            }

            if (!expectedByCohort.has(cohortKey)) {
                expectedByCohort.set(cohortKey, {
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    expectedSignals: 0,
                    avgSignalStrength: 0,
                    signalStrengthSum: 0,
                });
            }

            const configBucket = expectedByConfigAndCohort.get(configKey);
            configBucket.expectedSignals++;
            configBucket.signalStrengthSum += toFiniteNumber(signal.strength);

            const cohortBucket = expectedByCohort.get(cohortKey);
            cohortBucket.expectedSignals++;
            cohortBucket.signalStrengthSum += toFiniteNumber(signal.strength);
        });

        trades.forEach((trade) => {
            const cohort = createTradeCohort(trade);
            const configKey = `${cohort.identityKey}|${cohort.configHash}|${cohort.cohort}`;
            const cohortKey = cohort.cohort;

            if (!actualByConfigAndCohort.has(configKey)) {
                actualByConfigAndCohort.set(configKey, {
                    mode: cohort.mode,
                    strategy: cohort.strategy,
                    runId: cohort.runId,
                    selectionId: cohort.selectionId,
                    configHash: cohort.configHash,
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    actualTrades: 0,
                    wins: 0,
                    totalPnLAud: 0,
                    totalPnLPips: 0,
                });
            }

            if (!actualByCohort.has(cohortKey)) {
                actualByCohort.set(cohortKey, {
                    cohort: cohort.cohort,
                    instrument: cohort.instrument,
                    side: cohort.side,
                    cohortType: cohort.cohortType,
                    actualTrades: 0,
                    wins: 0,
                    totalPnLAud: 0,
                    totalPnLPips: 0,
                });
            }

            const configBucket = actualByConfigAndCohort.get(configKey);
            configBucket.actualTrades++;
            configBucket.totalPnLAud += toFiniteNumber(trade.pnlAud);
            configBucket.totalPnLPips += toFiniteNumber(trade.pnlPips);
            if (toFiniteNumber(trade.pnlAud) > 0) {
                configBucket.wins++;
            }

            const cohortBucket = actualByCohort.get(cohortKey);
            cohortBucket.actualTrades++;
            cohortBucket.totalPnLAud += toFiniteNumber(trade.pnlAud);
            cohortBucket.totalPnLPips += toFiniteNumber(trade.pnlPips);
            if (toFiniteNumber(trade.pnlAud) > 0) {
                cohortBucket.wins++;
            }
        });

        const byConfigAndCohort = Array.from(
            new Set([
                ...expectedByConfigAndCohort.keys(),
                ...actualByConfigAndCohort.keys(),
            ])
        )
            .map((key) => {
                const expected = expectedByConfigAndCohort.get(key) || {};
                const actual = actualByConfigAndCohort.get(key) || {};
                const actualTrades = actual.actualTrades || 0;
                return {
                    mode: expected.mode || actual.mode || "live",
                    strategy: expected.strategy || actual.strategy || "unknown",
                    runId: expected.runId || actual.runId || "unassigned",
                    selectionId:
                        expected.selectionId || actual.selectionId || "unassigned",
                    configHash: expected.configHash || actual.configHash || "unknown",
                    cohort: expected.cohort || actual.cohort || "UNKNOWN",
                    instrument: expected.instrument || actual.instrument || "UNKNOWN",
                    side: expected.side || actual.side || "UNKNOWN",
                    cohortType: expected.cohortType || actual.cohortType || "UNKNOWN",
                    expectedSignals: expected.expectedSignals || 0,
                    actualTrades,
                    executionRatePct:
                        (expected.expectedSignals || 0) > 0
                            ? roundTo(
                                  (actualTrades / expected.expectedSignals) * 100,
                                  1
                              )
                            : 0,
                    actualWinRatePct:
                        actualTrades > 0
                            ? roundTo((actual.wins / actualTrades) * 100, 1)
                            : 0,
                    actualPnLAud: roundTo(actual.totalPnLAud || 0, 2),
                    actualPnLPips: roundTo(actual.totalPnLPips || 0, 1),
                    avgSignalStrength:
                        (expected.expectedSignals || 0) > 0
                            ? roundTo(
                                  expected.signalStrengthSum /
                                      expected.expectedSignals,
                                  2
                              )
                            : 0,
                };
            })
            .sort((a, b) => b.expectedSignals - a.expectedSignals);

        const byCohort = Array.from(
            new Set([...expectedByCohort.keys(), ...actualByCohort.keys()])
        )
            .map((key) => {
                const expected = expectedByCohort.get(key) || {};
                const actual = actualByCohort.get(key) || {};
                const actualTrades = actual.actualTrades || 0;
                return {
                    cohort: expected.cohort || actual.cohort || "UNKNOWN",
                    instrument: expected.instrument || actual.instrument || "UNKNOWN",
                    side: expected.side || actual.side || "UNKNOWN",
                    cohortType: expected.cohortType || actual.cohortType || "UNKNOWN",
                    expectedSignals: expected.expectedSignals || 0,
                    actualTrades,
                    executionRatePct:
                        (expected.expectedSignals || 0) > 0
                            ? roundTo(
                                  (actualTrades / expected.expectedSignals) * 100,
                                  1
                              )
                            : 0,
                    actualWinRatePct:
                        actualTrades > 0
                            ? roundTo((actual.wins / actualTrades) * 100, 1)
                            : 0,
                    actualPnLAud: roundTo(actual.totalPnLAud || 0, 2),
                    actualPnLPips: roundTo(actual.totalPnLPips || 0, 1),
                    avgSignalStrength:
                        (expected.expectedSignals || 0) > 0
                            ? roundTo(
                                  expected.signalStrengthSum /
                                      expected.expectedSignals,
                                  2
                              )
                            : 0,
                };
            })
            .sort((a, b) => b.expectedSignals - a.expectedSignals);

        return {
            summary: {
                totalUniqueActionableSignals: uniqueActionableSignals.length,
                totalClosedTrades: trades.length,
                configScopedCohorts: byConfigAndCohort.length,
                cohortScopedCohorts: byCohort.length,
            },
            byConfigAndCohort,
            byCohort,
        };
    }
}

module.exports = AnalyticsService;
