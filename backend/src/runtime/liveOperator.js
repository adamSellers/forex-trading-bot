const { randomUUID } = require("node:crypto");
const { evaluateLiveReadiness } = require("./liveReadiness");
const { createEngineSupervisor } = require("./engineSupervisor");
const { buildOperationalHealth } = require("../services/operationalHealthService");
const logger = require("../utils/logger");

const SOURCE_NAMES = Object.freeze(["systemStatus", "engineStatus", "portfolio", "trades", "signals",
    "prices", "account", "liveSelection", "catalog", "readiness", "operationalHealth"]);

function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

// The operator interface owns intent changes and display observations. Broker
// mutations continue through the engine's existing serialized lifecycle.
class LiveOperator {
    #listeners = new Set();
    #values = {};
    #observations = {};
    #requested = new Map();
    #request = 0;
    #publication = 0;
    #streamId = randomUUID();
    #view = null;
    #fullRead = null;
    #pendingSources = new Set();
    #pendingFull = false;
    #refreshTimer = null;
    #poll = null;
    #unsubscribe = null;
    #cancelReads = new Set();
    #disposed = false;
    #intentGeneration = 0;
    #enabling = null;

    constructor({ configService, coordinator, engine, dataService, sources = () => ({}),
        observeChanges = null, now = Date.now, sourceTimeoutMs = 20000, refreshIntervalMs = 30000,
        onStatusChange = () => {}, ensureEngineStarted = null } = {}) {
        this.configService = configService;
        this.coordinator = coordinator;
        this.engine = engine;
        this.dataService = dataService;
        this.sources = sources;
        this.observeChanges = observeChanges;
        this.now = now;
        this.sourceTimeoutMs = sourceTimeoutMs;
        this.refreshIntervalMs = refreshIntervalMs;
        this.onStatusChange = onStatusChange;
        SOURCE_NAMES.forEach((name) => {
            this.#values[name] = null;
            this.#observations[name] = { status: "unavailable", observedAt: null,
                lastAttemptAt: null, error: "Not yet observed" };
        });
        this.supervisor = ensureEngineStarted ? null : createEngineSupervisor({
            tradingEngine: engine,
            beforeStart: () => coordinator?.ensureLiveSelectionInitialized?.(),
            onStarted: () => coordinator?.start?.(dataService, 60000),
            onStatusChange: () => {
                this.#statusChanged();
                this.invalidate(["engineStatus", "readiness", "operationalHealth"]);
            },
        });
        this.ensureEngineStarted = ensureEngineStarted || this.supervisor.ensureStarted;
    }

    attach(options) {
        if (this.#disposed) return Promise.reject(new Error("Live operator is disposed"));
        return this.ensureEngineStarted(options);
    }

    async readReadiness() {
        if (this.#disposed) throw new Error("Live operator is disposed");
        const config = this.configService?.get?.() || {};
        let entryRisk = null;
        if (this.engine?.getEntryRiskState) {
            try {
                entryRisk = await this.engine.getEntryRiskState({
                    runId: this.coordinator?.getLiveSelection?.()?.liveRun?.runId || null, config,
                });
            } catch (error) {
                entryRisk = { status: "UNAVAILABLE", entryAllowed: false, cooldownActive: false,
                    error: error.message, evaluatedAt: this.now() };
                this.engine.entryRiskState = entryRisk;
            }
        }
        // Disposing an observation cancels its public wait immediately. Do not
        // start another ledger query when an earlier SQLite read later settles.
        if (this.#disposed) throw new Error("Live operator is disposed");
        const readiness = evaluateLiveReadiness({ config, entryRisk,
            liveSelection: this.coordinator?.getLiveSelection?.() || null });
        if (this.configService?.getPersistenceStatus?.()?.durable === false) {
            readiness.passed = false;
            readiness.activationAllowed = false;
            readiness.status = "FAIL";
            readiness.reasons.push({ code: "CONFIG_PERSISTENCE_FAILED", message:
                "Entries are paused in memory; save a paused configuration successfully before activation. Restart may reload the earlier saved state." });
        }
        const engineStatus = this.engine?.getStatus?.();
        if (engineStatus) {
            const reason = this.engine.getBrokerEntryBlockReason
                ? await this.engine.getBrokerEntryBlockReason() : null;
            const pending = (value) => Number(value) > 0 || Array.isArray(value) && value.length > 0;
            if (reason || engineStatus.brokerStateUncertain === true || pending(engineStatus.pendingOrderIntents) ||
                pending(engineStatus.quarantinedBrokerPositions) || pending(engineStatus.protectionPendingTrades)) {
                readiness.passed = false;
                readiness.activationAllowed = false;
                readiness.status = "FAIL";
                readiness.reasons.push({ code: "BROKER_LIFECYCLE_UNRESOLVED",
                    message: "Broker positions, order intents or protective orders require reconciliation" });
            }
        }
        return readiness;
    }

    #bounded(read, name) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.#cancelReads.delete(cancel);
                callback(value);
            };
            const cancel = () => finish(reject, new Error("Live operator is disposed"));
            const timer = setTimeout(() => finish(reject,
                new Error(`${name} observation timed out`)), this.sourceTimeoutMs);
            timer.unref?.();
            this.#cancelReads.add(cancel);
            Promise.resolve().then(() => {
                if (this.#disposed) throw new Error("Live operator is disposed");
                if (typeof read !== "function") throw new Error(`${name} observation is unavailable`);
                return read();
            }).then((value) => finish(resolve, value), (error) => finish(reject, error));
        });
    }

    #snapshot() {
        const config = this.configService?.get?.() || {};
        const engine = this.engine?.getStatus?.() || {};
        const selection = this.coordinator?.getLiveSelection?.() || null;
        const readiness = this.#values.readiness;
        const available = this.#observations.readiness.status === "available";
        const healthAvailable = this.#observations.operationalHealth.status === "available";
        return freeze(structuredClone({ schemaVersion: 1, streamId: this.#streamId,
            publication: ++this.#publication, generatedAt: this.now(),
            intent: { entriesEnabled: config.enableTrading === true,
                durable: this.configService?.getPersistenceStatus?.()?.durable !== false },
            activation: { allowed: available ? readiness?.activationAllowed ?? null : null,
                reasons: available ? readiness?.reasons || [] : [] },
            entries: { state: config.enableTrading !== true ? "PAUSED"
                : healthAvailable ? this.#values.operationalHealth.entryState : "UNKNOWN",
                entryRisk: available ? readiness?.entryRisk ?? null : null },
            protection: { engineAttached: engine.isRunning === true, monitoringActive: engine.monitoringActive === true },
            identity: { liveRunId: selection?.liveRun?.runId || selection?.liveRunId || null,
                strategy: selection?.strategy || config.strategy || null },
            overview: this.#values, observations: this.#observations,
        }));
    }

    async #refresh(names) {
        if (this.#disposed) throw new Error("Live operator is disposed");
        const providers = this.sources();
        const keys = new Set(names);
        if (keys.has("operationalHealth")) keys.add("readiness");
        const request = ++this.#request;
        const attemptedAt = this.now();
        const promises = new Map();
        keys.forEach((name) => this.#requested.set(name, request));
        if (keys.has("readiness")) promises.set("readiness", this.#bounded(() => this.readReadiness(), "readiness"));
        for (const name of keys) {
            if (name === "readiness") continue;
            const read = name === "operationalHealth" ? async () => {
                const readiness = await promises.get("readiness");
                return buildOperationalHealth({ config: this.configService?.get?.() || {},
                    configPersistence: this.configService?.getPersistenceStatus?.() || {},
                    engineStatus: this.engine?.getStatus?.() || {},
                    dataStatus: this.dataService?.getStatus?.() || {},
                    runtimeStatus: this.coordinator?.getStatus?.() || {},
                    entryRisk: readiness.entryRisk || {}, nowMs: this.now() });
            } : providers[name];
            promises.set(name, this.#bounded(read, name));
        }
        const settled = await Promise.all([...promises].map(async ([name, promise]) => {
            try { return [name, { status: "fulfilled", value: structuredClone(await promise), observedAt: this.now() }]; }
            catch (error) { return [name, { status: "rejected", reason: error }]; }
        }));
        if (this.#disposed) throw new Error("Live operator is disposed");
        let changed = false;
        for (const [name, result] of settled) {
            if (this.#requested.get(name) !== request) continue;
            changed = true;
            if (result.status === "fulfilled") {
                this.#values[name] = result.value;
                this.#observations[name] = { status: "available", observedAt: result.observedAt,
                    lastAttemptAt: attemptedAt, error: null };
            } else {
                this.#observations[name] = { ...this.#observations[name], status: "unavailable",
                    lastAttemptAt: attemptedAt, error: result.reason?.message || String(result.reason) };
            }
        }
        if (changed || !this.#view) this.#publish();
        return this.#view;
    }

    #publish() {
        this.#view = this.#snapshot();
        for (const listener of this.#listeners) this.#notify(listener);
        return this.#view;
    }

    #notify(listener) {
        try { listener(this.#view); }
        catch (error) { logger.error("Operator observation listener failed:", error.message); }
    }

    readDashboard() {
        if (this.#disposed) return Promise.reject(new Error("Live operator is disposed"));
        if (!this.#fullRead) {
            clearTimeout(this.#refreshTimer);
            this.#refreshTimer = null;
            this.#pendingFull = false;
            this.#pendingSources.clear();
            this.#fullRead = this.#refresh(SOURCE_NAMES).finally(() => {
                this.#fullRead = null;
                this.#schedule();
            });
        }
        return this.#fullRead;
    }

    invalidate(names = null) {
        if (this.#disposed) return;
        if (names === null) this.#pendingFull = true;
        else for (const name of names) if (SOURCE_NAMES.includes(name)) this.#pendingSources.add(name);
        this.#schedule();
    }

    #schedule() {
        if (this.#disposed || !this.#listeners.size || this.#refreshTimer ||
            !this.#pendingFull && !this.#pendingSources.size || this.#fullRead && this.#pendingFull) return;
        this.#refreshTimer = setTimeout(() => {
            this.#refreshTimer = null;
            const full = this.#pendingFull;
            const names = [...this.#pendingSources];
            this.#pendingFull = false;
            this.#pendingSources.clear();
            (full ? this.readDashboard() : this.#refresh(names)).catch((error) => {
                if (!this.#disposed) logger.error("Operator observation refresh failed:", error.message);
            });
        }, 0);
        this.#refreshTimer.unref?.();
    }

    observeDashboard(listener) {
        if (this.#disposed) throw new Error("Live operator is disposed");
        this.#listeners.add(listener);
        if (this.#listeners.size === 1) {
            this.#unsubscribe = this.observeChanges?.((names) => this.invalidate(names)) || null;
            this.#poll = setInterval(() => this.invalidate(), this.refreshIntervalMs);
            this.#poll.unref?.();
        }
        if (this.#view) this.#notify(listener);
        this.readDashboard().catch((error) => {
            if (!this.#disposed) logger.error("Initial operator observation failed:", error.message);
        });
        return () => {
            this.#listeners.delete(listener);
            if (!this.#listeners.size) this.#stopObserving();
        };
    }

    #stopObserving() {
        clearInterval(this.#poll);
        clearTimeout(this.#refreshTimer);
        this.#poll = null;
        this.#refreshTimer = null;
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#pendingFull = false;
        this.#pendingSources.clear();
    }

    async #finish(result) {
        this.#statusChanged();
        this.invalidate();
        try { return { ...result, view: await this.readDashboard() }; }
        catch (error) { return { ...result, view: null, refreshError: error.message }; }
    }

    #statusChanged() {
        if (this.#disposed) return;
        try { this.onStatusChange(); }
        catch (error) { logger.error("Operator status notification failed:", error.message); }
    }

    enableEntries() {
        if (this.#enabling?.generation === this.#intentGeneration) return this.#enabling.promise;
        const generation = ++this.#intentGeneration;
        const promise = this.#enable(generation).finally(() => {
            if (this.#enabling?.generation === generation) this.#enabling = null;
        });
        this.#enabling = { generation, promise };
        return promise;
    }

    async #enable(generation) {
        const command = "enableEntries";
        try {
            if (this.#disposed) throw new Error("Live operator is disposed");
            await this.coordinator?.ensureLiveSelectionInitialized?.();
            const readiness = await this.readReadiness();
            if (generation !== this.#intentGeneration) return this.#cancelledEnable(readiness);
            if (!readiness.activationAllowed) return this.#finish({ command, outcome: "rejected", statusCode: 409,
                success: false, code: "LIVE_READINESS_FAILED", message: "Live strategy readiness failed",
                error: "Live strategy readiness failed", liveReadiness: readiness });
            if (!this.engine.isRunning) {
                const result = await this.attach({ reason: "live activation" });
                if (generation !== this.#intentGeneration) return this.#cancelledEnable(readiness);
                if (!result?.running && !this.engine.isRunning) return this.#finish({ command, outcome: "failed",
                    statusCode: 503, success: false, code: "ENGINE_START_FAILED", error: "Trading engine is not running",
                    message: "Trading engine is not running", detail: result?.error || "Engine start failed",
                    liveReadiness: readiness });
            }
            if (generation !== this.#intentGeneration) return this.#cancelledEnable(readiness);
            this.configService.update({ enableTrading: true }, { allowLiveActivation: true });
            return this.#finish({ command, outcome: "accepted", statusCode: 200, success: true,
                message: readiness.status === "COOLDOWN"
                    ? "Live trading enabled; new entries remain paused until the loss cooldown ends" : "Live trading enabled",
                engineRunning: this.engine.isRunning, liveReadiness: readiness });
        } catch (error) { return this.#failed(command, error); }
    }

    #cancelledEnable(readiness) {
        return this.#finish({ command: "enableEntries", outcome: "rejected", statusCode: 409, success: false,
            code: "ENTRY_INTENT_CHANGED", message: "Entry intent changed before activation completed",
            error: "Entry intent changed before activation completed", liveReadiness: readiness });
    }

    pauseEntries() {
        ++this.#intentGeneration;
        try {
            if (this.#disposed) throw new Error("Live operator is disposed");
            // Persist the pause synchronously, before any broker/display await.
            this.configService.update({ enableTrading: false });
            return this.#finishLocal({ command: "pauseEntries", outcome: "accepted", statusCode: 200,
                success: true, message: "Live entries disabled" });
        } catch (error) {
            return this.#finishLocal({ command: "pauseEntries", outcome: "failed", statusCode: error.statusCode || 500,
                success: false, code: error.code || "OPERATOR_COMMAND_FAILED", error: error.message, message: error.message });
        }
    }

    #finishLocal(result) {
        this.#statusChanged();
        let view = null;
        let refreshError;
        try { view = this.#publish(); }
        catch (error) { refreshError = error.message; }
        this.invalidate();
        this.readDashboard().catch((error) => {
            if (!this.#disposed) logger.error("Post-pause operator observation failed:", error.message);
        });
        return Promise.resolve({ ...result, view, refreshPending: true,
            ...(refreshError ? { refreshError } : {}) });
    }

    async reconcileBroker() {
        const command = "reconcileBroker";
        try {
            if (this.#disposed) throw new Error("Live operator is disposed");
            await this.engine.syncOpenTrades({ throwOnError: true });
            const reason = await this.engine.getBrokerEntryBlockReason?.();
            const unresolved = Boolean(reason) || this.engine.getStatus?.()?.brokerStateUncertain === true;
            return this.#finish({ command, outcome: unresolved ? "unresolved" : "accepted", statusCode: 200,
                success: !unresolved, code: unresolved ? "BROKER_LIFECYCLE_UNRESOLVED" : undefined,
                openTrades: this.engine.openTrades?.size ?? this.engine.getStatus?.()?.openPositions ?? 0,
                message: unresolved ? "Broker reconciliation still has unresolved exposure or order outcomes"
                    : "Trading engine synced with Oanda" });
        } catch (error) { return this.#failed(command, error); }
    }

    #failed(command, error) {
        return this.#finish({ command, outcome: "failed", statusCode: error.statusCode || 500, success: false,
            code: error.code || "OPERATOR_COMMAND_FAILED", error: error.message, message: error.message });
    }

    dispose() {
        if (this.#disposed) return;
        this.#disposed = true;
        ++this.#intentGeneration;
        this.#stopObserving();
        this.supervisor?.cancelPendingRetry?.();
        for (const cancel of [...this.#cancelReads]) cancel();
        this.#listeners.clear();
    }
}

module.exports = LiveOperator;
