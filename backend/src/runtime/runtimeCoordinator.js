const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const SignalGenerator = require("../services/signalGenerator");
const MarketContextService = require("./marketContextService");
const logger = require("../utils/logger");
const { computeConfigHash } = require("../config/tradingConfig");
const { RUNTIME_MODES, RUN_STATUSES } = require("./runtimeConstants");
const { getStrategyDefinition } = require("../strategies");
const { applyCandidatePreset } = require("./candidatePresets");

function createRunId(mode = RUNTIME_MODES.LIVE) {
    return `${mode}_${uuidv4()}`;
}

function normalizeRunRecord(runRecord = {}) {
    const configSnapshot = {
        ...(runRecord.configSnapshot || runRecord.config || {}),
        strategy:
            runRecord.strategy ||
            runRecord.configSnapshot?.strategy ||
            runRecord.config?.strategy ||
            "supertrend_momentum",
    };

    return {
        runId: runRecord.runId || createRunId(runRecord.mode),
        mode: runRecord.mode || RUNTIME_MODES.LIVE,
        strategy: configSnapshot.strategy,
        status: runRecord.status || RUN_STATUSES.ACTIVE,
        selectionId: runRecord.selectionId || null,
        shadowOfRunId: runRecord.shadowOfRunId || null,
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

class RuntimeCoordinator extends EventEmitter {
    constructor(options = {}) {
        super();
        this.dataService = options.dataService || null;
        this.signalRepository = options.signalRepository || null;
        this.strategyRunRepository = options.strategyRunRepository || null;
        this.tradeRepository = options.tradeRepository || null;
        this.configService = options.configService || null;
        this.timesFmSignalService = options.timesFmSignalService || null;
        this.marketContextService =
            options.marketContextService || new MarketContextService();
        this.pollIntervalMs = options.pollIntervalMs || 60000;

        this.isRunning = false;
        this.runInterval = null;
        this.lastRunTime = null;
        this.isCycleRunning = false;
        this.lastSkippedCycleAt = null;
        this.latestSignals = [];
        this.runSessions = new Map();
        this.liveSelection = null;
    }

    init({
        dataService = null,
        signalRepository = null,
        strategyRunRepository = null,
        tradeRepository = null,
        configService = null,
        timesFmSignalService = null,
    } = {}) {
        this.dataService = dataService || this.dataService;
        this.signalRepository = signalRepository || this.signalRepository;
        this.strategyRunRepository =
            strategyRunRepository || this.strategyRunRepository;
        this.tradeRepository = tradeRepository || this.tradeRepository;
        this.configService = configService || this.configService;
        this.timesFmSignalService =
            timesFmSignalService || this.timesFmSignalService;
        return this;
    }

    _createRunSession(runRecord = {}) {
        const normalizedRun = normalizeRunRecord(runRecord);
        const generator = new SignalGenerator(normalizedRun.configSnapshot, null);

        return {
            run: normalizedRun,
            generator,
            latestSignals: [],
            managedInstruments: new Set(),
        };
    }

    registerRunSession(runRecord = {}) {
        const normalizedRun = normalizeRunRecord(runRecord);
        const existing = this.runSessions.get(normalizedRun.runId);

        if (existing) {
            existing.run = normalizedRun;
            existing.generator.updateConfig(normalizedRun.configSnapshot);
            return existing;
        }

        const session = this._createRunSession(normalizedRun);
        this.runSessions.set(normalizedRun.runId, session);
        this.emit("runtimeRunsChanged", this.listRuns());
        return session;
    }

    getRunSession(runId) {
        return this.runSessions.get(runId) || null;
    }

    getActiveLiveSession() {
        return (
            Array.from(this.runSessions.values()).find(
                (session) =>
                    session.run.mode === RUNTIME_MODES.LIVE &&
                    session.run.status === RUN_STATUSES.ACTIVE
            ) || null
        );
    }

    getShadowSessionForSelection(selectionId) {
        return (
            Array.from(this.runSessions.values()).find(
                (session) =>
                    session.run.mode === RUNTIME_MODES.PAPER_SHADOW &&
                    session.run.selectionId === selectionId &&
                    session.run.status === RUN_STATUSES.ACTIVE
            ) || null
        );
    }

    async loadPersistedRuns(filters = {}) {
        if (!this.strategyRunRepository?.list) {
            return [];
        }

        const runs = await this.strategyRunRepository.list(filters);
        runs.forEach((runRecord) => this.registerRunSession(runRecord));
        return runs;
    }

    async startRun(runRecord = {}) {
        const normalizedRun = normalizeRunRecord(runRecord);

        if (this.strategyRunRepository?.create) {
            await this.strategyRunRepository.create(normalizedRun);
        }

        const session = this.registerRunSession(normalizedRun);
        this.emit("runStarted", this.toPublicRun(session));
        return session.run;
    }

    async stopRun(runId, updates = {}) {
        const session = this.getRunSession(runId);
        if (!session) return null;

        const nextRun = {
            ...session.run,
            status: updates.status || RUN_STATUSES.STOPPED,
            stoppedAt:
                updates.stoppedAt === undefined
                    ? Date.now()
                    : updates.stoppedAt,
            metadata:
                updates.metadata === undefined
                    ? session.run.metadata
                    : updates.metadata,
        };

        if (this.strategyRunRepository?.update) {
            await this.strategyRunRepository.update(runId, {
                status: nextRun.status,
                stoppedAt: nextRun.stoppedAt,
                metadata: nextRun.metadata,
            });
        }

        this.runSessions.delete(runId);
        this.emit(
            "runStopped",
            this.toPublicRun({ run: nextRun, latestSignals: [] })
        );
        this.emit("runtimeRunsChanged", this.listRuns());
        return nextRun;
    }

    async updateRun(runId, updates = {}) {
        const session = this.getRunSession(runId);
        if (!session) return null;

        const nextRun = normalizeRunRecord({
            ...session.run,
            ...updates,
            metadata:
                updates.metadata === undefined
                    ? session.run.metadata
                    : updates.metadata,
            configSnapshot:
                updates.configSnapshot === undefined
                    ? session.run.configSnapshot
                    : updates.configSnapshot,
        });

        session.run = nextRun;
        session.generator.updateConfig(nextRun.configSnapshot);

        if (this.strategyRunRepository?.update) {
            await this.strategyRunRepository.update(runId, {
                status: nextRun.status,
                selectionId: nextRun.selectionId,
                shadowOfRunId: nextRun.shadowOfRunId,
                configHash: nextRun.configHash,
                configSnapshot: nextRun.configSnapshot,
                metadata: nextRun.metadata,
                startedAt: nextRun.startedAt,
                stoppedAt: nextRun.stoppedAt,
            });
        }

        this.emit("runtimeRunsChanged", this.listRuns());
        return nextRun;
    }

    async resetRun(runId, updates = {}) {
        const session = this.getRunSession(runId);
        if (!session) return null;

        session.generator.reset();
        session.latestSignals = [];
        session.managedInstruments.clear();

        const nextRun = await this.updateRun(runId, {
            startedAt:
                updates.startedAt === undefined
                    ? Date.now()
                    : updates.startedAt,
            stoppedAt: null,
            metadata:
                updates.metadata === undefined
                    ? session.run.metadata
                    : updates.metadata,
            status: updates.status || session.run.status,
        });
        return nextRun;
    }

    setManagedInstruments(runId, instruments = []) {
        const session = this.getRunSession(runId);
        if (!session) return;

        session.managedInstruments = new Set(
            Array.isArray(instruments) ? instruments.filter(Boolean) : []
        );
    }

    async ensureSessionForOwnerRun(runId, trade = null) {
        if (!runId || this.getRunSession(runId)) {
            return this.getRunSession(runId);
        }

        if (this.strategyRunRepository?.getByRunId) {
            const persistedRun = await this.strategyRunRepository.getByRunId(runId);
            if (persistedRun) {
                return this.registerRunSession({
                    ...persistedRun,
                    status:
                        persistedRun.status === RUN_STATUSES.STOPPED
                            ? RUN_STATUSES.MANAGING_ONLY
                            : persistedRun.status,
                });
            }
        }

        if (!trade) return null;

        return this.registerRunSession({
            runId,
            mode: RUNTIME_MODES.LIVE,
            strategy: trade.strategy || "supertrend_momentum",
            status: RUN_STATUSES.MANAGING_ONLY,
            selectionId: trade.selectionId || null,
            configSnapshot: {
                ...(this.configService?.get?.() || {}),
                strategy: trade.strategy || "supertrend_momentum",
            },
            configHash:
                trade.configHash ||
                computeConfigHash({
                    ...(this.configService?.get?.() || {}),
                    strategy: trade.strategy || "supertrend_momentum",
                }),
            metadata: {
                entryEnabled: false,
                recoveredFromTrades: true,
            },
        });
    }

    async syncLiveTradeOwnership() {
        if (!this.tradeRepository?.getOpenTrades) {
            return [];
        }

        const activeLiveSession = this.getActiveLiveSession();
        const openLiveTrades = await this.tradeRepository.getOpenTrades({
            mode: RUNTIME_MODES.LIVE,
        });

        for (const trade of openLiveTrades) {
            if (!trade.ownerRunId && activeLiveSession) {
                await this.tradeRepository.updateTrade(trade.id, {
                    runId: trade.runId || activeLiveSession.run.runId,
                    ownerRunId: activeLiveSession.run.runId,
                    selectionId:
                        trade.selectionId || activeLiveSession.run.selectionId,
                    strategy: trade.strategy || activeLiveSession.run.strategy,
                    configHash: trade.configHash || activeLiveSession.run.configHash,
                });

                trade.runId = trade.runId || activeLiveSession.run.runId;
                trade.ownerRunId = activeLiveSession.run.runId;
                trade.selectionId =
                    trade.selectionId || activeLiveSession.run.selectionId;
                trade.strategy = trade.strategy || activeLiveSession.run.strategy;
                trade.configHash = trade.configHash || activeLiveSession.run.configHash;
            }
        }

        const ownerInstrumentMap = new Map();
        for (const trade of openLiveTrades) {
            if (!trade.ownerRunId) continue;
            if (!ownerInstrumentMap.has(trade.ownerRunId)) {
                ownerInstrumentMap.set(trade.ownerRunId, new Set());
            }
            ownerInstrumentMap.get(trade.ownerRunId).add(trade.instrument);
            await this.ensureSessionForOwnerRun(trade.ownerRunId, trade);
        }

        const activeLiveRunId = activeLiveSession?.run.runId || null;
        for (const session of Array.from(this.runSessions.values())) {
            if (session.run.mode !== RUNTIME_MODES.LIVE) {
                continue;
            }

            if (session.run.runId === activeLiveRunId) {
                continue;
            }

            const ownedInstruments = Array.from(
                ownerInstrumentMap.get(session.run.runId) || []
            );

            if (ownedInstruments.length === 0) {
                await this.stopRun(session.run.runId, {
                    metadata: {
                        ...(session.run.metadata || {}),
                        reason: "ownership-cleared",
                    },
                });
                continue;
            }

            this.setManagedInstruments(session.run.runId, ownedInstruments);
            if (session.run.status !== RUN_STATUSES.MANAGING_ONLY) {
                await this.updateRun(session.run.runId, {
                    status: RUN_STATUSES.MANAGING_ONLY,
                    metadata: {
                        ...(session.run.metadata || {}),
                        entryEnabled: false,
                    },
                });
            }
        }

        return openLiveTrades;
    }

    getRunAssets(session) {
        if (!session) return [];

        if (
            session.run.mode === RUNTIME_MODES.LIVE &&
            session.run.status === RUN_STATUSES.MANAGING_ONLY
        ) {
            return Array.from(session.managedInstruments);
        }

        return Array.isArray(session.generator.config.assets)
            ? session.generator.config.assets
            : session.run.configSnapshot.assets || [];
    }

    enrichSignal(session, signal) {
        const entryEnabled =
            session.run.mode === RUNTIME_MODES.LIVE &&
            session.run.status === RUN_STATUSES.ACTIVE;

        return {
            ...signal,
            runId: session.run.runId,
            selectionId: session.run.selectionId || null,
            mode: session.run.mode,
            strategy: session.run.strategy,
            configHash: session.run.configHash,
            runtimeStatus: session.run.status,
            entryEnabled,
        };
    }

    async enrichTimesFm(signal, options = {}) {
        if (!this.timesFmSignalService?.enrichSignal) {
            return signal;
        }

        return this.timesFmSignalService.enrichSignal(signal, options);
    }

    async prepareInstrumentContext(session, instrumentContext, options = {}) {
        const sourceStrategies = Array.isArray(
            session?.run?.configSnapshot?.counterSignalSourceStrategies ||
                session?.generator?.config?.counterSignalSourceStrategies
        )
            ? session.run.configSnapshot?.counterSignalSourceStrategies ||
              session.generator?.config?.counterSignalSourceStrategies
            : [];
        const needsTimesFmForecast =
            session?.run?.strategy === "timesfm_directional" ||
            (session?.run?.strategy === "counter_signal_reversion" &&
                (sourceStrategies.length === 0 ||
                    sourceStrategies.includes("timesfm_directional")));

        if (
            !instrumentContext ||
            !needsTimesFmForecast ||
            !this.timesFmSignalService?.getForecastContext
        ) {
            return instrumentContext;
        }

        try {
            const forecastContext = await this.timesFmSignalService.getForecastContext({
                instrument: options.instrument,
                candles: options.candles,
                timeframe: options.timeframe,
                config: options.config || session.run.configSnapshot || session.generator?.config || {},
            });

            return {
                ...instrumentContext,
                timesFmForecast: forecastContext,
            };
        } catch (error) {
            logger.warn(
                `TimesFM prefetch failed for ${options.instrument || "unknown"}: ${error.message}`
            );
            return instrumentContext;
        }
    }

    async refreshTimesFmHealth(force = false) {
        if (!this.timesFmSignalService?.refreshHealth) {
            return null;
        }

        return this.timesFmSignalService.refreshHealth(force);
    }

    getTimesFmStatus() {
        const activeLiveSession = this.getActiveLiveSession();
        const config =
            activeLiveSession?.run?.configSnapshot || this.configService?.get?.() || {};

        if (!this.timesFmSignalService?.getStatus) {
            return {
                enabled: false,
                mode: "disabled",
                configured: false,
                connected: false,
                available: false,
                status: "disabled",
                ready: false,
            };
        }

        return this.timesFmSignalService.getStatus(config);
    }

    async evaluateRunSession(session, sharedContext) {
        const signals = [];
        const assets = this.getRunAssets(session);

        for (const instrument of assets) {
            const instrumentContext = this.marketContextService.createInstrumentContext(
                sharedContext,
                {
                    ...session.run,
                    config: session.generator.config,
                    assets,
                },
                instrument
            );
            const timeframe = session.generator.config.timeframe || "15m";
            const candles = instrumentContext?.timeframes?.[timeframe]?.candles || [];
            const currentPrice = instrumentContext?.price?.price ?? null;

            if (!Number.isFinite(currentPrice) || candles.length === 0) {
                continue;
            }

            const preparedContext = await this.prepareInstrumentContext(
                session,
                instrumentContext,
                {
                    instrument,
                    candles,
                    timeframe,
                    config: session.run.configSnapshot || session.generator.config,
                }
            );

            let signal = await session.generator.generateSignal(
                instrument,
                candles,
                currentPrice,
                {
                    marketContext: preparedContext,
                }
            );
            if (!signal) {
                continue;
            }

            signal.timeframe = timeframe;
            signal = session.generator.validateSignal(signal);

            if (!signal) {
                continue;
            }

            let enrichedSignal = this.enrichSignal(session, signal);
            if (
                session.run.strategy === "timesfm_directional" &&
                preparedContext?.timesFmForecast
            ) {
                enrichedSignal = {
                    ...enrichedSignal,
                    timesFm: preparedContext.timesFmForecast,
                };
            } else {
                enrichedSignal = await this.enrichTimesFm(enrichedSignal, {
                    candles,
                    timeframe,
                    config: session.run.configSnapshot || session.generator.config,
                });
            }
            signals.push(enrichedSignal);
            this.emit("signalGenerated", enrichedSignal);
        }

        session.latestSignals = signals;
        return signals;
    }

    async runCycle() {
        if (!this.dataService || this.runSessions.size === 0) {
            this.latestSignals = [];
            return [];
        }

        if (this.isCycleRunning) {
            const now = Date.now();
            if (!this.lastSkippedCycleAt || now - this.lastSkippedCycleAt > 60000) {
                logger.warn("Runtime coordinator cycle skipped: previous cycle still running");
                this.lastSkippedCycleAt = now;
            }
            return this.latestSignals;
        }

        this.isCycleRunning = true;

        try {
            await this.syncLiveTradeOwnership();

            const descriptors = Array.from(this.runSessions.values()).map((session) => ({
                ...session.run,
                config: session.generator.config,
                assets: this.getRunAssets(session),
            }));
            const sharedContext = this.marketContextService.buildSharedContext(
                descriptors,
                this.dataService
            );
            const allSignals = [];

            for (const session of this.runSessions.values()) {
                const signals = await this.evaluateRunSession(session, sharedContext);
                allSignals.push(...signals);

                if (signals.length > 0 && this.signalRepository?.saveBatch) {
                    await this.signalRepository.saveBatch(signals);
                }

                this.emit("runSignalsGenerated", {
                    runId: session.run.runId,
                    mode: session.run.mode,
                    strategy: session.run.strategy,
                    signals,
                });
            }

            const activeLiveSession = Array.from(this.runSessions.values()).find(
                (session) =>
                    session.run.mode === RUNTIME_MODES.LIVE &&
                    session.run.status === RUN_STATUSES.ACTIVE
            );

            this.latestSignals = activeLiveSession?.latestSignals || [];
            this.lastRunTime = Date.now();
            this.emit("allSignalsGenerated", this.latestSignals);

            return allSignals;
        } finally {
            this.isCycleRunning = false;
        }
    }

    async start(dataService = this.dataService, intervalMs = this.pollIntervalMs) {
        if (this.isRunning) return;

        this.dataService = dataService || this.dataService;
        this.isRunning = true;
        await this.refreshTimesFmHealth(true);
        await this.ensureLiveSelectionInitialized();
        await this.runCycle();

        this.runInterval = setInterval(() => {
            if (this.isRunning) {
                this.runCycle().catch((error) => {
                    logger.error("Runtime coordinator cycle failed:", error);
                });
            }
        }, intervalMs);
    }

    stop() {
        this.isRunning = false;
        if (this.runInterval) {
            clearInterval(this.runInterval);
            this.runInterval = null;
        }
        this.emit("generatorStopped");
    }

    updateConfig(newConfig = {}) {
        for (const session of this.runSessions.values()) {
            if (
                session.run.mode === RUNTIME_MODES.LIVE &&
                session.run.status === RUN_STATUSES.ACTIVE
            ) {
                session.generator.updateConfig(newConfig);
                session.run.configSnapshot = {
                    ...session.run.configSnapshot,
                    ...newConfig,
                };
                session.run.configHash = computeConfigHash(session.run.configSnapshot);
            }

            if (session.run.mode === RUNTIME_MODES.PAPER_SHADOW) {
                session.generator.updateConfig(newConfig);
                session.run.configSnapshot = {
                    ...session.run.configSnapshot,
                    ...newConfig,
                };
                session.run.configHash = computeConfigHash(session.run.configSnapshot);
            }
        }
    }

    async selectLiveStrategy({
        strategyKey,
        configSnapshot = null,
        selectionId = null,
        initiatedBy = "runtime",
        startShadow = true,
        metadata = {},
    } = {}) {
        const activeLiveSession = this.getActiveLiveSession();
        const nextConfig = {
            ...(configSnapshot || this.configService?.get?.() || {}),
            strategy: strategyKey || activeLiveSession?.run.strategy || "supertrend_momentum",
        };
        const nextSelectionId = selectionId || `selection_${uuidv4()}`;
        const nextConfigHash = computeConfigHash(nextConfig);

        if (activeLiveSession) {
            const activeLiveTrades = this.tradeRepository?.getOpenTrades
                ? await this.tradeRepository.getOpenTrades({
                      mode: RUNTIME_MODES.LIVE,
                      ownerRunId: activeLiveSession.run.runId,
                  })
                : [];

            if (activeLiveTrades.length > 0) {
                await this.updateRun(activeLiveSession.run.runId, {
                    status: RUN_STATUSES.MANAGING_ONLY,
                    metadata: {
                        ...(activeLiveSession.run.metadata || {}),
                        entryEnabled: false,
                    },
                });
            } else {
                await this.stopRun(activeLiveSession.run.runId, {
                    metadata: {
                        ...(activeLiveSession.run.metadata || {}),
                        reason: "live-selection-rotated",
                    },
                });
            }

            const oldShadowSession = this.getShadowSessionForSelection(
                activeLiveSession.run.selectionId
            );
            if (oldShadowSession) {
                await this.stopRun(oldShadowSession.run.runId, {
                    metadata: {
                        ...(oldShadowSession.run.metadata || {}),
                        reason: "shadow-replaced",
                    },
                });
            }
        }

        const liveRun = await this.startRun({
            mode: RUNTIME_MODES.LIVE,
            strategy: nextConfig.strategy,
            status: RUN_STATUSES.ACTIVE,
            selectionId: nextSelectionId,
            configSnapshot: nextConfig,
            configHash: nextConfigHash,
            metadata: {
                entryEnabled: true,
                initiatedBy,
                ...metadata,
            },
        });

        let shadowRun = null;
        if (startShadow) {
            shadowRun = await this.startRun({
                mode: RUNTIME_MODES.PAPER_SHADOW,
                strategy: nextConfig.strategy,
                status: RUN_STATUSES.ACTIVE,
                selectionId: nextSelectionId,
                shadowOfRunId: liveRun.runId,
                configSnapshot: nextConfig,
                configHash: nextConfigHash,
                metadata: {
                    entryEnabled: false,
                    initiatedBy,
                    pairedLiveRunId: liveRun.runId,
                    ...(metadata.phase4ControlledLive
                        ? { phase4ControlledLive: metadata.phase4ControlledLive }
                        : {}),
                },
            });
        }

        this.liveSelection = {
            selectionId: nextSelectionId,
            liveRunId: liveRun.runId,
            shadowRunId: shadowRun?.runId || null,
            strategy: nextConfig.strategy,
            configHash: nextConfigHash,
            updatedAt: Date.now(),
        };

        await this.syncLiveTradeOwnership();

        const selection = this.getLiveSelection();
        this.emit("liveSelectionChanged", selection);
        return selection;
    }

    async ensureLiveSelectionInitialized() {
        if (this.runSessions.size === 0) {
            await this.loadPersistedRuns({
                statuses: [RUN_STATUSES.ACTIVE, RUN_STATUSES.MANAGING_ONLY],
            });
        }

        const activeLiveSession = this.getActiveLiveSession();
        if (activeLiveSession) {
            const shadowSession = this.getShadowSessionForSelection(
                activeLiveSession.run.selectionId
            );

            this.liveSelection = {
                selectionId: activeLiveSession.run.selectionId,
                liveRunId: activeLiveSession.run.runId,
                shadowRunId: shadowSession?.run.runId || null,
                strategy: activeLiveSession.run.strategy,
                configHash: activeLiveSession.run.configHash,
                updatedAt: Date.now(),
            };

            if (!shadowSession) {
                await this.startRun({
                    mode: RUNTIME_MODES.PAPER_SHADOW,
                    strategy: activeLiveSession.run.strategy,
                    status: RUN_STATUSES.ACTIVE,
                    selectionId: activeLiveSession.run.selectionId,
                    shadowOfRunId: activeLiveSession.run.runId,
                    configSnapshot: activeLiveSession.run.configSnapshot,
                    configHash: activeLiveSession.run.configHash,
                    metadata: {
                        entryEnabled: false,
                        initiatedBy: "runtime-bootstrap",
                        pairedLiveRunId: activeLiveSession.run.runId,
                    },
                });
            }

            await this.syncLiveTradeOwnership();
            return this.getLiveSelection();
        }

        return this.selectLiveStrategy({
            strategyKey:
                this.configService?.get?.().strategy || "supertrend_momentum",
            configSnapshot: this.configService?.get?.() || null,
            initiatedBy: "runtime-bootstrap",
        });
    }

    async createCandidateRun({
        strategyKey,
        configSnapshot = null,
        initiatedBy = "ui",
        metadata = {},
        presetKey = null,
    } = {}) {
        if (!strategyKey) {
            throw new Error("strategyKey is required");
        }

        const strategyDefinition = getStrategyDefinition(strategyKey);
        if (strategyDefinition.runtimeStatus === "planned") {
            throw new Error(
                `${strategyDefinition.label} is not available for candidate paper runs yet`
            );
        }

        const liveSelection = await this.ensureLiveSelectionInitialized();
        const activeLiveSession = this.getActiveLiveSession();
        const baseConfig =
            configSnapshot ||
            activeLiveSession?.run.configSnapshot ||
            this.configService?.get?.() ||
            {};
        const baseNextConfig = {
            ...baseConfig,
            ...(strategyKey === "counter_signal_reversion"
                ? strategyDefinition.metadata?.defaultConfig || {}
                : {}),
            strategy: strategyKey,
        };
        const { config: nextConfig, preset } = applyCandidatePreset(
            baseNextConfig,
            presetKey
        );
        if (presetKey && !preset) {
            throw new Error(`Unknown candidate preset: ${presetKey}`);
        }

        return this.startRun({
            mode: RUNTIME_MODES.PAPER_CANDIDATE,
            strategy: strategyKey,
            status: RUN_STATUSES.ACTIVE,
            selectionId:
                activeLiveSession?.run.selectionId || liveSelection?.selectionId || null,
            configSnapshot: nextConfig,
            configHash: computeConfigHash(nextConfig),
            metadata: {
                entryEnabled: false,
                initiatedBy,
                pairedLiveRunId: activeLiveSession?.run.runId || null,
                candidatePreset: preset?.key || null,
                candidatePresetLabel: preset?.label || null,
                ...metadata,
            },
        });
    }

    reset() {
        this.latestSignals = [];
        this.runSessions.forEach((session) => {
            session.latestSignals = [];
            session.generator.reset();
        });
    }

    toPublicRun(session) {
        const run = session.run || session;

        return {
            runId: run.runId,
            mode: run.mode,
            strategy: run.strategy,
            status: run.status,
            selectionId: run.selectionId || null,
            shadowOfRunId: run.shadowOfRunId || null,
            configHash: run.configHash || null,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt ?? null,
            metadata: run.metadata || {},
            latestSignalCount: session.latestSignals?.length || 0,
        };
    }

    listRuns() {
        return Array.from(this.runSessions.values()).map((session) =>
            this.toPublicRun(session)
        );
    }

    getStatus() {
        const activeLiveSession = this.getActiveLiveSession();

        return {
            isActive: this.isRunning,
            config: activeLiveSession?.generator?.config || {},
            activeSignals: this.latestSignals || [],
            pendingEntries:
                activeLiveSession?.generator?.getStatus?.().pendingEntries || [],
            lastRun: this.lastRunTime,
            runs: this.listRuns(),
            liveSelection: this.getLiveSelection(),
            timesFm: this.getTimesFmStatus(),
        };
    }

    getLiveSelection() {
        const activeLiveSession = this.getActiveLiveSession();
        if (!activeLiveSession) {
            return null;
        }

        const shadowSession = this.getShadowSessionForSelection(
            activeLiveSession.run.selectionId
        );

        return {
            selectionId: activeLiveSession.run.selectionId,
            strategy: activeLiveSession.run.strategy,
            configHash: activeLiveSession.run.configHash,
            liveRun: this.toPublicRun(activeLiveSession),
            shadowRun: shadowSession ? this.toPublicRun(shadowSession) : null,
        };
    }
}

module.exports = RuntimeCoordinator;
module.exports.createRunId = createRunId;
module.exports.normalizeRunRecord = normalizeRunRecord;
