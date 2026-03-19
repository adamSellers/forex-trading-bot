// backend/src/services/analyticsService.js - Forex Analytics Service
const logger = require("../utils/logger");

const ACTIONABLE_SIGNAL_CLASSES = new Set(["ACTIONABLE", "EXIT_ONLY"]);
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

function isActionableSignal(signal) {
    const signalClass = normalizeUpper(signal?.signalClass);
    const intent = normalizeUpper(signal?.intent);
    const signalType = normalizeUpper(signal?.signal);

    if (isCooldownDuplicate(signal)) {
        return false;
    }

    if (ACTIONABLE_SIGNAL_CLASSES.has(signalClass)) {
        return true;
    }

    if (intent.startsWith("ENTER_") || intent.startsWith("EXIT_")) {
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

function isUniqueActionableSignal(signal, seenActionableKeys) {
    if (!isActionableSignal(signal)) {
        return false;
    }

    if (!hasStructuredSignalTelemetry(signal)) {
        return true;
    }

    if (signal?.uniqueEvent !== null && signal?.uniqueEvent !== undefined) {
        return Boolean(signal.uniqueEvent);
    }

    if (
        signal?.cooldownSuppressed !== null &&
        signal?.cooldownSuppressed !== undefined
    ) {
        return !Boolean(signal.cooldownSuppressed);
    }

    const dedupeKey = getSignalEventKey(signal);
    if (seenActionableKeys.has(dedupeKey)) {
        return false;
    }

    seenActionableKeys.add(dedupeKey);
    return true;
}

function createSignalCohort(signal) {
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
        configHash,
        instrument,
        side,
        cohortType,
        cohort: `${instrument}|${side}|${cohortType}`,
    };
}

function createTradeCohort(trade) {
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
        configHash,
        instrument,
        side,
        cohortType,
        cohort: `${instrument}|${side}|${cohortType}`,
    };
}

/**
 * Calculate comprehensive analytics from trades and signals
 */
class AnalyticsService {
    constructor(tradeRepository, signalRepository) {
        this.tradeRepo = tradeRepository;
        this.signalRepo = signalRepository;
    }

    /**
     * Get full analytics report for a period
     * @param {string} period - '24h', '7d', '30d', '90d', 'all'
     */
    async getAnalytics(period = "30d") {
        try {
            const periodMs = parsePeriod(period);
            const cutoffTime = Date.now() - periodMs;

            // Fetch raw data
            const [trades, signals] = await Promise.all([
                this.tradeRepo.getTradesSince(cutoffTime),
                this.signalRepo.getSignalsSince(new Date(cutoffTime)),
            ]);

            // Filter to closed trades only for performance metrics
            const closedTrades = trades.filter(
                (t) => !t.isOpen && t.pnlAud !== null && t.pnlAud !== undefined
            );

            const signalEventSummary = this.extractSignalEventSummary(signals);

            // Calculate all metrics
            const summary = this.calculateSummary(closedTrades);
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
            const expectationVsActual = this.calculateExpectationVsActual(
                signalEventSummary.uniqueActionableSignals,
                closedTrades
            );

            return {
                period,
                mode: "live",
                generatedAt: new Date().toISOString(),
                summary,
                pairPerformance,
                sessionPerformance,
                signalAnalysis,
                exitAnalysis,
                equityData,
                adxAnalysis,
                sidePerformance,
                expectationVsActual,
                rawCounts: {
                    totalTrades: trades.length,
                    closedTrades: closedTrades.length,
                    openTrades: trades.filter((t) => t.isOpen).length,
                    totalSignals: signals.length,
                    uniqueActionableSignals:
                        signalEventSummary.uniqueActionableSignals.length,
                    cooldownDuplicateSignals:
                        signalEventSummary.cooldownDuplicates.length,
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
    calculateSummary(trades) {
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
        const sharpeRatio = this.calculateSharpeRatio(trades);

        // Average holding time
        const tradesWithHoldingTime = trades.filter((t) => t.holdingPeriodMs);
        const avgHoldingTimeMs =
            tradesWithHoldingTime.length > 0
                ? tradesWithHoldingTime.reduce(
                      (sum, t) => sum + t.holdingPeriodMs,
                      0
                  ) / tradesWithHoldingTime.length
                : 0;

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
        };
    }

    /**
     * Calculate Sharpe Ratio (annualized)
     */
    calculateSharpeRatio(trades) {
        if (trades.length < 2) return 0;

        // Group trades by day
        const dailyReturns = {};
        trades.forEach((t) => {
            const day = new Date(t.exitTime || t.entryTime)
                .toISOString()
                .split("T")[0];
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
        const uniqueActionableSignals = [];
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
        };

        let actionableTotal = 0;

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

            const actionable = isActionableSignal(signal);
            const cooldownDuplicate = isCooldownDuplicate(signal);

            if (actionable) {
                actionableTotal++;
            }

            if (actionable && isUniqueActionableSignal(signal, seenActionableKeys)) {
                uniqueActionableSignals.push(signal);
                return;
            }

            if (cooldownDuplicate || actionable) {
                cooldownDuplicates.push(signal);
            }
        });

        return {
            actionableTotal,
            uniqueActionableSignals,
            cooldownDuplicates,
            telemetryCoverage,
        };
    }

    /**
     * Analyze signal quality and filtering
     */
    calculateSignalAnalysis(signals, eventSummary = null) {
        const summary = eventSummary || this.extractSignalEventSummary(signals);
        const stats = {
            total: signals.length,
            triggered: summary.uniqueActionableSignals.length,
            actionableTotal: summary.actionableTotal,
            actionableUnique: summary.uniqueActionableSignals.length,
            triggeredIncludingDuplicates: summary.actionableTotal,
            cooldownDuplicates: summary.cooldownDuplicates.length,
            exitOnlyUnique: 0,
            filteredChoppy: 0,
            filteredAdxSlope: 0,
            filteredOverbought: 0,
            filteredOversold: 0,
            pending: 0,
            hold: 0,
            byType: {},
            byPair: {},
            bySignalClass: {},
            byIntent: {},
            byReasonCode: {},
            avgStrength: 0,
            telemetryCoverage: summary.telemetryCoverage,
        };

        let totalStrength = 0;
        const uniqueActionableSet = new Set(summary.uniqueActionableSignals);

        signals.forEach((signal) => {
            const type = signal.signal || "UNKNOWN";
            const signalClass = normalizeUpper(signal.signalClass) || "UNCLASSIFIED";
            const intent = normalizeUpper(signal.intent) || "UNSPECIFIED";
            const reasonCode = normalizeUpper(signal.reasonCode) || "UNKNOWN";
            const message = (signal.message || "").toLowerCase();
            const uniqueActionable = uniqueActionableSet.has(signal);
            const actionable = isActionableSignal(signal);
            const cooldownDuplicate = isCooldownDuplicate(signal);

            if (uniqueActionable) {
                const exitOnly =
                    signalClass === "EXIT_ONLY" || intent.startsWith("EXIT_");
                if (exitOnly) {
                    stats.exitOnlyUnique++;
                }
            } else if (
                cooldownDuplicate ||
                (actionable && signal.uniqueEvent === false)
            ) {
                // Accounted for separately; don't blend suppressed duplicates into hold/filter buckets.
            } else if (signalClass === "PENDING" || intent === "WAIT") {
                stats.pending++;
                stats.hold++;
            } else if (
                message.includes("falling adx") ||
                message.includes("adx_slope") ||
                reasonCode.includes("ADX_SLOPE")
            ) {
                stats.filteredAdxSlope++;
            } else if (
                message.includes("choppy") ||
                message.includes("adx") ||
                message.includes("weak") ||
                reasonCode.includes("BLOCKED_ADX")
            ) {
                stats.filteredChoppy++;
            } else if (
                message.includes("overbought") ||
                reasonCode.includes("OVERBOUGHT")
            ) {
                stats.filteredOverbought++;
            } else if (message.includes("oversold")) {
                stats.filteredOversold++;
            } else if (message.includes("momentum") && deriveSignalSide(signal) !== "SELL") {
                stats.filteredOverbought++;
            } else if (message.includes("momentum") && deriveSignalSide(signal) === "SELL") {
                stats.filteredOversold++;
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
            signals.length > 0 ? totalStrength / signals.length : 0;

        // Convert to pie chart format
        stats.filterBreakdown = [
            { label: "Triggered", value: stats.triggered, color: "success" },
            {
                label: "Cooldown Duplicates",
                value: stats.cooldownDuplicates,
                color: "secondary",
            },
            {
                label: "Filtered (Choppy)",
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
            { label: "Hold/Wait", value: stats.hold, color: "default" },
        ].filter((d) => d.value > 0);

        return stats;
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

    calculateExpectationVsActual(uniqueActionableSignals, trades) {
        const expectedByConfigAndCohort = new Map();
        const actualByConfigAndCohort = new Map();
        const expectedByCohort = new Map();
        const actualByCohort = new Map();

        uniqueActionableSignals.forEach((signal) => {
            const cohort = createSignalCohort(signal);
            const configKey = `${cohort.configHash}|${cohort.cohort}`;
            const cohortKey = cohort.cohort;

            if (!expectedByConfigAndCohort.has(configKey)) {
                expectedByConfigAndCohort.set(configKey, {
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
            const configKey = `${cohort.configHash}|${cohort.cohort}`;
            const cohortKey = cohort.cohort;

            if (!actualByConfigAndCohort.has(configKey)) {
                actualByConfigAndCohort.set(configKey, {
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
