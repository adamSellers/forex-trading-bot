const { getForexMarketState } = require("../runtime/marketDataFreshness");
const { resolveTimedExitReason } = require("../runtime/exitPolicy");
const { SESSION_DEFINITIONS, getActivePairSessions, zonedClock } = require("../strategies/intradayMomentum");
const logger = require("../utils/logger");

const HEALTH_STATE_KEY = "operational-health-alerts-v1";
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
    const add = (code, message, severity = "warning", tradeId = null) => {
        issues.push({ key: tradeId ? `${code}:${tradeId}` : code, code, message, severity, tradeId });
    };
    if (configPersistence.durable === false) {
        add("CONFIG_PERSISTENCE_FAILED", "The paused configuration could not be saved; the disk configuration may resume entries after a restart", "critical");
    }
    if (engineStatus.isRunning !== true) add("ENGINE_STOPPED", "The trading engine is not running", openCount ? "critical" : "warning");
    if (dataStatus.isRunning !== true) add("DATA_SERVICE_STOPPED", "The market-data service is not running");
    const runtimeRunning = runtimeStatus.isRunning ?? runtimeStatus.isActive;
    if (runtimeRunning !== true) add("STRATEGY_RUNTIME_STOPPED", "The strategy decision loop is not running");

    // During planned closures broker prices are expected to stop changing.
    // The services must still run so reconciliation and reopening can recover.
    if (market.open) {
        if (dataStatus.freshness?.pricesFresh !== true) add("STALE_PRICE_DATA", "Current broker price events are unavailable or stale");
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
    const entryState = issues.length ? "BLOCKED" : !market.open ? "MARKET_CLOSED" :
        cooldownActive ? "COOLDOWN" : config.enableTrading !== true ? "PAUSED" : "WATCHING";
    return {
        status: issues.length ? "degraded" : "healthy", checkedAt: nowMs,
        market: { ...market, sessions, pairs }, issues, entryState, entriesExpected,
        cooldownActive, cooldownUntil: entryRisk?.cooldownUntil || null,
        brokerSyncAgeMs, openPositions: openCount,
    };
}

class OperationalHealthService {
    constructor({ getInputs, emailService, stateStore = null, alertDelayMs = 60_000, now = Date.now } = {}) {
        this.getInputs = getInputs;
        this.emailService = emailService;
        this.stateStore = stateStore;
        this.alertDelayMs = alertDelayMs;
        this.now = now;
        this.snapshot = null;
        this.announced = {};
        this.firstSeen = {};
        this.loadedState = false;
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
        let config = {};
        try {
            const inputs = await this.getInputs();
            config = inputs.config || {};
            this.snapshot = buildOperationalHealth({ ...inputs, nowMs: this.now() });
            this.snapshot.alerting = { enabled: Boolean(this.emailService?.isEnabled?.(config)) };
            if (!this.loadedState) {
                const state = await this.stateStore?.getState?.(HEALTH_STATE_KEY);
                this.announced = state?.announced || {};
                this.loadedState = true;
            }
            const current = Object.fromEntries(this.snapshot.issues.map((issue) => [issue.key, issue]));
            this.firstSeen = Object.fromEntries(Object.keys(current).map((key) => [key, this.firstSeen[key] ?? this.snapshot.checkedAt]));
            const newIssues = this.snapshot.issues.filter((issue) => !this.announced[issue.key] &&
                (issue.severity === "critical" || this.snapshot.checkedAt - this.firstSeen[issue.key] >= this.alertDelayMs));
            const suppressedDuringClosure = new Set(["STALE_PRICE_DATA", "STALE_CANDLE_DATA", "STRATEGY_CYCLE_STALE"]);
            const recoveredIssues = Object.values(this.announced).filter((issue) => !current[issue.key] &&
                (this.snapshot.market.open || !suppressedDuringClosure.has(issue.code)));
            if ((newIssues.length || recoveredIssues.length) && this.emailService?.isEnabled?.(config)) {
                const sent = await this.emailService.sendOperationalHealthAlert({ snapshot: this.snapshot, newIssues, recoveredIssues }, config);
                if (sent === true) {
                    newIssues.forEach((issue) => { this.announced[issue.key] = issue; });
                    recoveredIssues.forEach((issue) => { delete this.announced[issue.key]; });
                    await this.stateStore?.setState?.(HEALTH_STATE_KEY, { announced: this.announced }, this.snapshot.checkedAt);
                }
            }
        } catch (error) {
            logger.error(`Operational health check failed: ${error.message}`);
            const issue = { key: "HEALTH_CHECK_FAILED", code: "HEALTH_CHECK_FAILED", severity: "warning", tradeId: null,
                message: "Operational health could not be fully verified" };
            this.snapshot = { ...(this.snapshot || {}), status: "degraded", checkedAt: this.now(), entryState: "BLOCKED",
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
