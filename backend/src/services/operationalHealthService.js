const { getForexMarketState } = require("../runtime/marketDataFreshness");
const { resolveTimedExitReason } = require("../runtime/exitPolicy");
const { SESSION_DEFINITIONS, getActivePairSessions, zonedClock } = require("../strategies/intradayMomentum");
const logger = require("../utils/logger");

const STALE_RUNTIME_MS = 180_000;
const STALE_BROKER_SYNC_MS = 180_000;
const EXIT_GRACE_MS = 120_000;

function finiteTime(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
}

function buildOperationalHealth({
    engineStatus = {}, dataStatus = {}, runtimeStatus = {}, config = {},
    entryRisk = engineStatus.entryRisk || {}, configPersistence = {}, nowMs = Date.now(),
} = {}) {
    const market = getForexMarketState(nowMs);
    const issues = [];
    const trades = Array.isArray(engineStatus.openTrades) ? engineStatus.openTrades : [];
    const openCount = Math.max(Number(engineStatus.openPositions) || 0, trades.length);
    const cooldownActive = entryRisk?.cooldownActive === true;
    const entriesExpected = config.enableTrading === true && market.open && !cooldownActive;
    const add = (code, message, severity = "warning", tradeId = null, instrument = null) => {
        issues.push({ key: tradeId || instrument ? `${code}:${tradeId || instrument}` : code,
            code, message, severity, tradeId, ...(instrument ? { instrument } : {}) });
    };
    if (configPersistence.durable === false) {
        add("CONFIG_PERSISTENCE_FAILED", "The paused configuration could not be saved; the disk configuration may resume entries after a restart", "critical");
    }
    if (engineStatus.isRunning !== true) add("ENGINE_STOPPED", "The trading engine is not running", openCount ? "critical" : "warning");
    if (dataStatus.isRunning !== true) add("DATA_SERVICE_STOPPED", "The market-data service is not running");
    const runtimeRunning = runtimeStatus.isRunning ?? runtimeStatus.isActive;
    if (runtimeRunning !== true) add("STRATEGY_RUNTIME_STOPPED", "The strategy decision loop is not running");

    // During planned closures current tradeable pricing is not expected.
    // The services must still run so reconciliation and reopening can recover.
    if (market.open) {
        if (dataStatus.freshness?.pricesFresh !== true) {
            const unavailable = (dataStatus.freshness?.priceAvailability || []).filter((row) => !row.available);
            for (const row of unavailable) {
                const expiredDelivery = Number.isFinite(row.receiptAgeMs) && Number.isFinite(dataStatus.freshness.maxPriceAgeMs)
                    ? `last validated pricing response ${Math.ceil(row.receiptAgeMs / 1000)} seconds ago (${dataStatus.freshness.maxPriceAgeMs / 1000}-second delivery limit)`
                    : "no validated pricing response within the delivery budget";
                const reason = {
                    STALE_PRICE: expiredDelivery,
                    PRICE_REQUEST_FAILED: "the latest pricing request failed",
                    PRICE_REQUEST_TIMEOUT: "the latest pricing request timed out",
                    PRICE_MISSING: "the requested price was missing from the broker response",
                    DUPLICATE_PRICE: "the broker response contained duplicate prices for the instrument",
                    INVALID_BID_ASK: "the broker response contained invalid bid/ask prices",
                    INVALID_BROKER_TIME: "the broker response contained an invalid price-event time",
                    MISSING_RECEIPT_TIME: "a validated pricing receipt time is unavailable",
                    INVALID_TRADEABILITY: "the broker response did not confirm tradeability",
                    INVALID_PRICING_RESPONSE: "the latest broker response did not contain valid pricing data",
                }[row.reason] || "a current valid pricing response is unavailable";
                add("STALE_PRICE_DATA", `${row.instrument}: ${reason}`, "warning", null, row.instrument);
            }
            if (!unavailable.length) add("STALE_PRICE_DATA", "Current validated broker pricing responses are unavailable");
        }
        if (dataStatus.freshness?.candlesFresh !== true) add("STALE_CANDLE_DATA", "Current completed M15/H1 history is unavailable or stale");
        const lastRun = finiteTime(runtimeStatus.lastRunTime ?? runtimeStatus.lastRun);
        if (!lastRun || nowMs - lastRun > STALE_RUNTIME_MS) add("STRATEGY_CYCLE_STALE", "The strategy loop has not completed a recent decision cycle");
    }
    const lastBrokerSync = finiteTime(engineStatus.lastSuccessfulBrokerSyncAt ?? engineStatus.lastBrokerReconciledAt);
    const brokerSyncAgeMs = lastBrokerSync === null ? null : Math.max(0, nowMs - lastBrokerSync);
    if (engineStatus.brokerStateUncertain === true) add("BROKER_STATE_UNCERTAIN", "Broker reconciliation has not confirmed a safe account state", openCount ? "critical" : "warning");
    if (!lastBrokerSync || brokerSyncAgeMs > STALE_BROKER_SYNC_MS) add("BROKER_SYNC_STALE", "A recent successful broker reconciliation is unavailable", openCount ? "critical" : "warning");
    if (engineStatus.lastBrokerSyncError) add("BROKER_SYNC_FAILED", "The latest broker reconciliation failed", openCount ? "critical" : "warning");
    if (Number(engineStatus.quarantinedBrokerPositions) > 0) add("BROKER_TRADE_QUARANTINED", "Unowned broker positions require reconciliation review", "critical");
    const pendingIntents = Array.isArray(engineStatus.pendingOrderIntents) ? engineStatus.pendingOrderIntents : [];
    if (Number(engineStatus.pendingOrderIntentCount) > 0 || pendingIntents.length) {
        add("ORDER_INTENT_PENDING", "An entry order is awaiting a confirmed broker outcome");
    }
    if (entryRisk?.status === "UNAVAILABLE") add("ENTRY_RISK_UNAVAILABLE", "The live entry risk state could not be verified");
    if (openCount && engineStatus.monitoringActive !== true) add("POSITION_MONITOR_STOPPED", "Open positions have no active management loop", "critical");
    const lastMonitor = finiteTime(engineStatus.lastPositionMonitorAt);
    if (openCount && (!lastMonitor || nowMs - lastMonitor > STALE_RUNTIME_MS)) add("POSITION_MONITOR_STALE", "Open positions have not been managed recently", "critical");

    for (const trade of trades) {
        if (!Number.isFinite(trade.stopLossPrice) || trade.stopLossPrice <= 0) {
            add("PROTECTIVE_STOP_MISSING", `${trade.instrument || "Position"} has no recorded protective stop`, "critical", trade.id);
        }
        if (trade.stopUpdatePending || /STOP_UPDATE|PROTECTION/.test(trade.reconciliationStatus || "")) {
            add("STOP_UPDATE_PENDING", `${trade.instrument || "Position"} has an unconfirmed protective-stop update`, "warning", trade.id);
        }
        if (/CLOSE_RETRY|UNRESOLVED|PARTIAL_CLOSE/.test(trade.reconciliationStatus || "")) {
            add("POSITION_CLOSE_PENDING", `${trade.instrument || "Position"} has an unresolved broker close`, "critical", trade.id);
        }
        const overdueReason = resolveTimedExitReason({
            trade, policy: trade.ownerExitPolicy || { config }, now: nowMs - EXIT_GRACE_MS,
        });
        if (overdueReason) {
            add("POSITION_EXIT_OVERDUE", `${trade.instrument || "Position"} remains open after its ${overdueReason === "TIME_STOP" ? "time stop" : "rollover exit"} deadline${market.open ? "" : "; the market is currently closed"}`, "critical", trade.id);
        }
    }
    const sessions = Object.entries(SESSION_DEFINITIONS).map(([key, session]) => {
        const clock = zonedClock(nowMs, session.timeZone);
        return { key, ...session, localTime: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
            active: market.open && clock.hour >= session.startHour && clock.hour < session.endHour };
    });
    const pairs = (config.assets || []).map((instrument) => ({
        instrument, activeSessions: market.open ? getActivePairSessions(instrument, nowMs) : [],
    }));
    // Operational observations are not themselves execution gates. In
    // particular, one pair's unavailable quote does not block every other pair.
    const entryBlockers = [];
    if (engineStatus.isRunning !== true) entryBlockers.push("ENGINE_STOPPED");
    if (runtimeRunning !== true) entryBlockers.push("STRATEGY_RUNTIME_STOPPED");
    if (engineStatus.brokerStateUncertain === true) entryBlockers.push("BROKER_STATE_UNCERTAIN");
    if (Number(engineStatus.quarantinedBrokerPositions) > 0) entryBlockers.push("BROKER_TRADE_QUARANTINED");
    if (Number(engineStatus.pendingOrderIntentCount) > 0 || pendingIntents.length) entryBlockers.push("ORDER_INTENT_PENDING");
    if (trades.some((trade) => /PENDING|UNRESOLVED/.test(trade.reconciliationStatus || ""))) {
        entryBlockers.push("BROKER_TRADE_RECONCILIATION_PENDING");
    }
    if (entryRisk?.entryAllowed === false && !cooldownActive) entryBlockers.push("ENTRY_RISK_BLOCKED");
    const entryState = config.enableTrading !== true ? "PAUSED" : !market.open ? "MARKET_CLOSED" :
        cooldownActive ? "COOLDOWN" : entryBlockers.length ? "BLOCKED" : "WATCHING";
    return {
        status: issues.length ? "degraded" : "healthy", checkedAt: nowMs,
        market: { ...market, sessions, pairs }, issues, entryState, entriesExpected, entryBlockers,
        priceAvailability: dataStatus.freshness?.priceAvailability || [],
        unavailablePrices: dataStatus.freshness?.unavailablePrices || [],
        cooldownActive, cooldownUntil: entryRisk?.cooldownUntil || null,
        brokerSyncAgeMs, openPositions: openCount,
    };
}

class OperationalHealthService {
    constructor({ getInputs, now = Date.now } = {}) {
        this.getInputs = getInputs;
        this.now = now;
        this.snapshot = null;
        this.timer = null;
        this.inFlight = null;
    }

    getStatus() { return this.snapshot; }

    async check() {
        if (this.inFlight) return this.inFlight;
        this.inFlight = this.runCheck().finally(() => { this.inFlight = null; });
        return this.inFlight;
    }

    async runCheck() {
        try {
            const inputs = await this.getInputs();
            this.snapshot = buildOperationalHealth({ ...inputs, nowMs: this.now() });
        } catch (error) {
            logger.error(`Operational health check failed: ${error.message}`);
            const issue = { key: "HEALTH_CHECK_FAILED", code: "HEALTH_CHECK_FAILED", severity: "warning", tradeId: null,
                message: "Operational health could not be fully verified" };
            this.snapshot = { ...(this.snapshot || {}), status: "degraded", checkedAt: this.now(), entryState: "UNKNOWN",
                issues: [...(this.snapshot?.issues || []).filter((item) => item.key !== issue.key), issue] };
        }
        return this.snapshot;
    }

    start(intervalMs = 60_000) {
        if (this.timer) return;
        void this.check();
        this.timer = setInterval(() => { void this.check(); }, Math.max(10_000, intervalMs));
        this.timer.unref?.();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

module.exports = { OperationalHealthService, buildOperationalHealth };
