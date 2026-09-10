const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

const SignalGenerator = require("../services/signalGenerator");
const MarketContextService = require("./marketContextService");
const logger = require("../utils/logger");
const {
    computeConfigHash,
    materializeStrategyConfig,
} = require("../config/tradingConfig");
const { RUNTIME_MODES, RUN_STATUSES } = require("./runtimeConstants");
const { isCanonicalStrategyKey } = require("../strategies");
const { evaluateRunLossCooldown } = require("./portfolioRiskPolicy");

function createRunId() {
    return `live_${uuidv4()}`;
}

function normalizeRunRecord(runRecord = {}) {
    if (runRecord.mode && runRecord.mode !== RUNTIME_MODES.LIVE) {
        const error = new Error("Only live strategy runs are supported");
        error.code = "LIVE_ONLY_RUNTIME";
        throw error;
    }

    const rawConfig = {
        ...(runRecord.configSnapshot || runRecord.config || {}),
        strategy:
            runRecord.strategy ||
            runRecord.configSnapshot?.strategy ||
            runRecord.config?.strategy ||
            "intraday_momentum",
    };
    const configSnapshot = materializeStrategyConfig(rawConfig, {
        strategyKey: rawConfig.strategy,
    });

    return {
        runId: runRecord.runId || createRunId(),
        mode: RUNTIME_MODES.LIVE,
        strategy: configSnapshot.strategy,
        status: runRecord.status || RUN_STATUSES.ACTIVE,
        selectionId: runRecord.selectionId || `selection_${uuidv4()}`,
        parentRunId: runRecord.parentRunId || null,
        configHash:
            runRecord.configHash ||
            configSnapshot.configHash ||
            computeConfigHash(configSnapshot),
        configSnapshot,
        metadata: runRecord.metadata || {},
        startedAt: runRecord.startedAt || Date.now(),
        stoppedAt: runRecord.stoppedAt ?? null,
    };
}

function signalPriority(signal = {}) {
    if (
        signal.signalClass === "EXIT_ONLY" ||
        String(signal.intent || "").startsWith("EXIT_")
    ) {
        return 0;
    }
    if (signal.signalClass === "ACTIONABLE") return 1;
    return 2;
}

class RuntimeCoordinator extends EventEmitter {
    constructor(options = {}) {
        super();
        this.dataService = options.dataService || null;
        this.signalRepository = options.signalRepository || null;
        this.strategyRunRepository = options.strategyRunRepository || null;
        this.tradeRepository = options.tradeRepository || null;
        this.configService = options.configService || null;
        this.marketContextService =
            options.marketContextService || new MarketContextService();
        this.pollIntervalMs = options.pollIntervalMs || 60000;

        this.isRunning = false;
        this.isCycleRunning = false;
        this.runInterval = null;
        this.lastRunTime = null;
        this.lastSkippedCycleAt = null;
        this.latestSignals = [];
        this.runSessions = new Map();
    }

    init({
        dataService = null,
        signalRepository = null,
        strategyRunRepository = null,
        tradeRepository = null,
        configService = null,
    } = {}) {
        this.dataService = dataService || this.dataService;
        this.signalRepository = signalRepository || this.signalRepository;
        this.strategyRunRepository =
            strategyRunRepository || this.strategyRunRepository;
        this.tradeRepository = tradeRepository || this.tradeRepository;
        this.configService = configService || this.configService;
        return this;
    }

    createSession(runRecord) {
        const run = normalizeRunRecord(runRecord);
        const generator = new SignalGenerator(run.configSnapshot, null);
        generator.dataService = this.dataService;
        return {
            run,
            generator,
            latestSignals: [],
            managedInstruments: new Set(),
        };
    }

    registerRunSession(runRecord) {
        const normalized = normalizeRunRecord(runRecord);
        const existing = this.runSessions.get(normalized.runId);
        if (existing) {
            existing.run = normalized;
            existing.generator.updateConfig(normalized.configSnapshot);
            this.syncDataServiceTimeframes();
            return existing;
        }

        const session = this.createSession(normalized);
        this.runSessions.set(normalized.runId, session);
        this.syncDataServiceTimeframes();
        this.emit("runtimeRunsChanged", this.listRuns());
        return session;
    }

    getRunSession(runId) {
        return this.runSessions.get(runId) || null;
    }

    getActiveLiveSession() {
        return (
            Array.from(this.runSessions.values()).find(
                (session) => session.run.status === RUN_STATUSES.ACTIVE
            ) || null
        );
    }

    syncDataServiceTimeframes() {
        if (!this.dataService?.updateRuntimeTimeframes) return;
        const timeframes = new Set();
        this.runSessions.forEach((session) => {
            const required =
                this.marketContextService.getRequiredTimeframesForRun({
                    ...session.run,
                    config: session.generator.config,
                }) || [];
            required.forEach((timeframe) => timeframes.add(timeframe));
        });
        this.dataService.updateRuntimeTimeframes(Array.from(timeframes));
    }

    async loadPersistedRuns(filters = {}) {
        if (!this.strategyRunRepository?.list) return [];
        await this.strategyRunRepository?.retireNonLiveRuns?.();
        const runs = await this.strategyRunRepository.list({
            ...filters,
            mode: RUNTIME_MODES.LIVE,
        });
        const supported = [];
        for (const run of runs) {
            if (!isCanonicalStrategyKey(run.strategy)) {
                await this.strategyRunRepository?.update?.(run.runId, {
                    status: RUN_STATUSES.STOPPED,
                    stoppedAt: Date.now(),
                    metadata: {
                        ...(run.metadata || {}),
                        reason: "retired-by-live-only-release",
                    },
                });
                continue;
            }
            this.registerRunSession(run);
            supported.push(run);
        }
        return supported;
    }

    async startRun(runRecord = {}) {
        const run = normalizeRunRecord(runRecord);
        await this.strategyRunRepository?.create?.(run);
        const session = this.registerRunSession(run);
        this.emit("runStarted", this.toPublicRun(session));
        return session.run;
    }

    async stopRun(runId, updates = {}) {
        const session = this.getRunSession(runId);
        if (!session) return null;
        const stopped = {
            ...session.run,
            status: updates.status || RUN_STATUSES.STOPPED,
            stoppedAt: updates.stoppedAt ?? Date.now(),
            metadata: updates.metadata || session.run.metadata,
        };
        await this.strategyRunRepository?.update?.(runId, {
            status: stopped.status,
            stoppedAt: stopped.stoppedAt,
            metadata: stopped.metadata,
        });
        this.runSessions.delete(runId);
        this.syncDataServiceTimeframes();
        this.emit("runStopped", this.toPublicRun(stopped));
        this.emit("runtimeRunsChanged", this.listRuns());
        return stopped;
    }

    async updateRun(runId, updates = {}) {
        const session = this.getRunSession(runId);
        if (!session) return null;
        const run = {
            ...session.run,
            status: updates.status || session.run.status,
            stoppedAt:
                updates.stoppedAt === undefined
                    ? session.run.stoppedAt
                    : updates.stoppedAt,
            metadata:
                updates.metadata === undefined
                    ? session.run.metadata
                    : updates.metadata,
        };
        session.run = run;
        await this.strategyRunRepository?.update?.(runId, {
            status: run.status,
            stoppedAt: run.stoppedAt,
            metadata: run.metadata,
        });
        this.emit("runtimeRunsChanged", this.listRuns());
        return run;
    }

    setManagedInstruments(runId, instruments = []) {
        const session = this.getRunSession(runId);
        if (session) session.managedInstruments = new Set(instruments.filter(Boolean));
    }

    async ensureSessionForOwnerRun(runId, trade = null) {
        if (!runId || this.getRunSession(runId)) return this.getRunSession(runId);
        const persisted =
            await this.strategyRunRepository?.getByRunId?.(runId);
        if (persisted?.mode === RUNTIME_MODES.LIVE) {
            return this.registerRunSession({
                ...persisted,
                status: RUN_STATUSES.MANAGING_ONLY,
            });
        }
        if (!trade) return null;

        const strategy = trade.strategy || this.configService?.get?.().strategy;
        return this.registerRunSession({
            runId,
            strategy,
            status: RUN_STATUSES.MANAGING_ONLY,
            selectionId: trade.selectionId || null,
            configSnapshot: {
                ...(this.configService?.get?.() || {}),
                strategy,
            },
            configHash: trade.configHash || null,
            metadata: { entryEnabled: false, recoveredFromLiveTrade: true },
        });
    }

    async syncLiveTradeOwnership() {
        if (!this.tradeRepository?.getOpenTrades) return [];
        const active = this.getActiveLiveSession();
        const openTrades = await this.tradeRepository.getOpenTrades({
            mode: RUNTIME_MODES.LIVE,
        });

        for (const trade of openTrades) {
            if (!trade.ownerRunId && active) {
                const ownership = {
                    runId: trade.runId || active.run.runId,
                    ownerRunId: active.run.runId,
                    selectionId: trade.selectionId || active.run.selectionId,
                    strategy: trade.strategy || active.run.strategy,
                    configHash: trade.configHash || active.run.configHash,
                };
                await this.tradeRepository.updateTrade(trade.id, ownership);
                Object.assign(trade, ownership);
            }
            if (trade.ownerRunId) {
                await this.ensureSessionForOwnerRun(trade.ownerRunId, trade);
            }
        }

        const instrumentsByOwner = new Map();
        openTrades.forEach((trade) => {
            if (!trade.ownerRunId) return;
            if (!instrumentsByOwner.has(trade.ownerRunId))
                instrumentsByOwner.set(trade.ownerRunId, new Set());
            instrumentsByOwner.get(trade.ownerRunId).add(trade.instrument);
        });

        const activeRunId = this.getActiveLiveSession()?.run.runId || null;
        for (const session of Array.from(this.runSessions.values())) {
            if (session.run.runId === activeRunId) continue;
            const instruments = Array.from(
                instrumentsByOwner.get(session.run.runId) || []
            );
            if (!instruments.length) {
                await this.stopRun(session.run.runId, {
                    metadata: {
                        ...session.run.metadata,
                        reason: "live-trade-ownership-cleared",
                    },
                });
                continue;
            }
            this.setManagedInstruments(session.run.runId, instruments);
            if (session.run.status !== RUN_STATUSES.MANAGING_ONLY) {
                await this.updateRun(session.run.runId, {
                    status: RUN_STATUSES.MANAGING_ONLY,
                    metadata: { ...session.run.metadata, entryEnabled: false },
                });
            }
        }

        return openTrades;
    }

    getRunAssets(session) {
        if (session.run.status === RUN_STATUSES.MANAGING_ONLY)
            return Array.from(session.managedInstruments);
        return Array.isArray(session.generator.config.assets)
            ? session.generator.config.assets
            : [];
    }

    enrichSignal(session, signal) {
        return {
            ...signal,
            runId: session.run.runId,
            selectionId: session.run.selectionId,
            mode: RUNTIME_MODES.LIVE,
            strategy: session.run.strategy,
            configHash: session.run.configHash,
            runtimeStatus: session.run.status,
            entryEnabled: session.run.status === RUN_STATUSES.ACTIVE,
        };
    }

    async evaluateRunSession(session, sharedContext) {
        const signals = [];
        const assets = this.getRunAssets(session);
        for (const instrument of assets) {
            const context = this.marketContextService.createInstrumentContext(
                sharedContext,
                { ...session.run, config: session.generator.config, assets },
                instrument
            );
            const timeframe = session.generator.config.timeframe || "4h";
            const candles = context?.timeframes?.[timeframe]?.candles || [];
            const currentPrice = context?.price?.price;

            let signal = await session.generator.generateSignal(
                instrument,
                candles,
                currentPrice,
                { marketContext: context, nowMs: sharedContext.generatedAt }
            );
            if (!signal) continue;
            signal.timeframe = timeframe;
            signal = session.generator.validateSignal(signal);
            if (signal) signals.push(this.enrichSignal(session, signal));
        }

        signals.sort((left, right) => {
            const priority = signalPriority(left) - signalPriority(right);
            return priority || Number(right.strength || 0) - Number(left.strength || 0);
        });
        session.latestSignals = signals;
        return signals;
    }

    async runCycle() {
        if (!this.dataService || !this.runSessions.size) {
            this.latestSignals = [];
            return [];
        }
        if (this.isCycleRunning) {
            const now = Date.now();
            if (!this.lastSkippedCycleAt || now - this.lastSkippedCycleAt > 60000) {
                logger.warn("Live strategy cycle skipped: prior cycle still running");
                this.lastSkippedCycleAt = now;
            }
            return this.latestSignals;
        }

        this.isCycleRunning = true;
        try {
            await this.syncLiveTradeOwnership();
            const descriptors = Array.from(this.runSessions.values()).map(
                (session) => ({
                    ...session.run,
                    config: session.generator.config,
                    assets: this.getRunAssets(session),
                })
            );
            const sharedContext = this.marketContextService.buildSharedContext(
                descriptors,
                this.dataService
            );
            const allSignals = [];
            for (const session of this.runSessions.values()) {
                const signals = await this.evaluateRunSession(session, sharedContext);
                allSignals.push(...signals);
                if (signals.length) await this.signalRepository?.saveBatch?.(signals);
                this.emit("runSignalsGenerated", {
                    runId: session.run.runId,
                    mode: RUNTIME_MODES.LIVE,
                    strategy: session.run.strategy,
                    signals,
                });
            }

            allSignals.sort((left, right) => {
                const priority = signalPriority(left) - signalPriority(right);
                return priority || Number(right.strength || 0) - Number(left.strength || 0);
            });
            allSignals.forEach((signal) => this.emit("signalGenerated", signal));
            this.latestSignals = this.getActiveLiveSession()?.latestSignals || [];
            this.lastRunTime = Date.now();
            this.emit("allSignalsGenerated", this.latestSignals);
            return allSignals;
        } finally {
            this.isCycleRunning = false;
        }
    }

    async selectLiveStrategy({
        strategyKey,
        configSnapshot = null,
        initiatedBy = "live-release",
        parentLiveRunId = null,
        metadata = {},
    } = {}) {
        const active = this.getActiveLiveSession();
        const requested = {
            ...(configSnapshot || this.configService?.get?.() || {}),
            strategy:
                strategyKey || active?.run.strategy || "intraday_momentum",
        };
        const config = materializeStrategyConfig(requested, {
            strategyKey: requested.strategy,
        });

        let entryCooldownCarryover = null;
        let priorUpdates = null;
        let managedInstruments = [];
        if (active) {
            // Resolve the stop before retiring its owner so missing risk history
            // cannot silently create a release with no cooldown.
            const entryRisk = evaluateRunLossCooldown({
                trades: await this.tradeRepository?.getAllTrades?.(),
                runId: active.run.runId,
                config: active.run.configSnapshot,
                carryover: active.run.metadata?.entryCooldownCarryover,
            });
            if (entryRisk.cooldownActive) {
                entryCooldownCarryover = {
                    sourceRunId: entryRisk.cooldownSourceRunId || active.run.runId,
                    cooldownStartedAt: entryRisk.cooldownStartedAt,
                    cooldownUntil: entryRisk.cooldownUntil,
                    consecutiveLosses: entryRisk.consecutiveLosses,
                    maxConsecutiveLosses: entryRisk.maxConsecutiveLosses,
                };
            }
            const openTrades = this.tradeRepository?.getOpenTrades
                ? await this.tradeRepository.getOpenTrades({
                      mode: RUNTIME_MODES.LIVE,
                      ownerRunId: active.run.runId,
                  })
                : [];
            if (openTrades.length) {
                priorUpdates = {
                    status: RUN_STATUSES.MANAGING_ONLY,
                    metadata: { ...active.run.metadata, entryEnabled: false },
                };
                managedInstruments = openTrades.map((trade) => trade.instrument);
            } else {
                priorUpdates = {
                    status: RUN_STATUSES.STOPPED,
                    stoppedAt: Date.now(),
                    metadata: {
                        ...active.run.metadata,
                        reason: "live-release-replaced",
                    },
                };
            }
        }

        const selectionId = `selection_${uuidv4()}`;
        const run = normalizeRunRecord({
            strategy: config.strategy,
            selectionId,
            parentRunId: parentLiveRunId,
            configSnapshot: config,
            configHash: computeConfigHash(config),
            metadata: {
                entryEnabled: true,
                initiatedBy,
                ...metadata,
                entryCooldownCarryover,
            },
        });
        if (active) {
            await this.strategyRunRepository.replaceActiveRun(active.run.runId, priorUpdates, run);
            // Publish the new session only after both durable records commit.
            active.run = { ...active.run, ...priorUpdates };
            if (priorUpdates.status === RUN_STATUSES.MANAGING_ONLY) {
                this.setManagedInstruments(active.run.runId, managedInstruments);
            } else {
                this.runSessions.delete(active.run.runId);
            }
            const session = this.registerRunSession(run);
            if (priorUpdates.status === RUN_STATUSES.STOPPED) {
                this.emit("runStopped", this.toPublicRun(active.run));
            }
            this.emit("runStarted", this.toPublicRun(session));
        } else {
            await this.startRun(run);
        }
        await this.syncLiveTradeOwnership();
        const selection = this.getLiveSelection();
        this.emit("liveSelectionChanged", selection);
        return selection;
    }

    async ensureLiveSelectionInitialized() {
        if (!this.runSessions.size) {
            await this.loadPersistedRuns({
                statuses: [RUN_STATUSES.ACTIVE, RUN_STATUSES.MANAGING_ONLY],
            });
        }
        const active = this.getActiveLiveSession();
        const deployed = materializeStrategyConfig(
            this.configService?.get?.() || { strategy: "intraday_momentum" },
            {
                strategyKey:
                    this.configService?.get?.().strategy ||
                    "intraday_momentum",
            }
        );
        const deployedHash = computeConfigHash(deployed);
        if (
            active &&
            active.run.strategy === deployed.strategy &&
            active.run.configHash === deployedHash
        ) {
            await this.syncLiveTradeOwnership();
            return this.getLiveSelection();
        }
        return this.selectLiveStrategy({
            strategyKey: deployed.strategy,
            configSnapshot: deployed,
            initiatedBy: active ? "live-release-sync" : "live-bootstrap",
            parentLiveRunId: active?.run.runId || null,
            metadata: { releaseVersion: deployed.liveReleaseVersion || null },
        });
    }

    async start(dataService = this.dataService, intervalMs = this.pollIntervalMs) {
        if (this.isRunning) return;
        this.dataService = dataService || this.dataService;
        this.runSessions.forEach((session) => {
            session.generator.dataService = this.dataService;
        });
        this.syncDataServiceTimeframes();
        this.isRunning = true;
        await this.ensureLiveSelectionInitialized();
        await this.runCycle();
        this.runInterval = setInterval(() => {
            if (this.isRunning) {
                this.runCycle().catch((error) =>
                    logger.error("Live strategy cycle failed:", error)
                );
            }
        }, intervalMs);
    }

    stop() {
        this.isRunning = false;
        if (this.runInterval) clearInterval(this.runInterval);
        this.runInterval = null;
        this.emit("generatorStopped");
    }

    updateConfig(config = {}) {
        this.syncDataServiceTimeframes();
        return config;
    }

    reset() {
        this.latestSignals = [];
        this.runSessions.forEach((session) => {
            session.latestSignals = [];
            session.generator.reset();
        });
    }

    toPublicRun(sessionOrRun) {
        const run = sessionOrRun.run || sessionOrRun;
        return {
            runId: run.runId,
            mode: RUNTIME_MODES.LIVE,
            strategy: run.strategy,
            status: run.status,
            selectionId: run.selectionId,
            parentRunId: run.parentRunId || null,
            configHash: run.configHash,
            configSnapshot: run.configSnapshot,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt ?? null,
            metadata: run.metadata || {},
            latestSignalCount: sessionOrRun.latestSignals?.length || 0,
        };
    }

    listRuns() {
        return Array.from(this.runSessions.values()).map((session) =>
            this.toPublicRun(session)
        );
    }

    getLiveSelection() {
        const active = this.getActiveLiveSession();
        if (!active) return null;
        return {
            selectionId: active.run.selectionId,
            strategy: active.run.strategy,
            configHash: active.run.configHash,
            liveRun: this.toPublicRun(active),
        };
    }

    getStatus() {
        const active = this.getActiveLiveSession();
        return {
            isActive: this.isRunning,
            config: active?.generator.config || {},
            activeSignals: this.latestSignals,
            pendingEntries: active?.generator.getStatus?.().pendingEntries || [],
            lastRun: this.lastRunTime,
            runs: this.listRuns(),
            liveSelection: this.getLiveSelection(),
        };
    }
}

module.exports = RuntimeCoordinator;
module.exports.createRunId = createRunId;
module.exports.normalizeRunRecord = normalizeRunRecord;
