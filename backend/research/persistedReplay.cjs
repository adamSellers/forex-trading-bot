// Research harness: production orchestration and repositories, isolated SQLite.
// The launcher/test supplies the broker singleton and database import boundaries.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ConfigService = require('../src/services/configService');
const OandaDataService = require('../src/services/OandaDataService');
const RuntimeCoordinator = require('../src/runtime/runtimeCoordinator');
const LiveTradingEngine = require('../src/services/LiveTradingEngine');
const SignalRepository = require('../src/repositories/signalRepository');
const EntryDecisionRepository = require('../src/repositories/entryDecisionRepository');
const TradeRepository = require('../src/repositories/tradeRepository');
const StrategyRunRepository = require('../src/repositories/strategyRunRepository');
const BrokerLifecycleRepository = require('../src/repositories/brokerLifecycleRepository');
const AnalyticsService = require('../src/services/analyticsService');
const { cloneDefaultConfig } = require('../src/config/tradingConfig');
const { reconcileReplayAccounting } = require('./replayAccounting.cjs');

const TABLES = ['strategy_runs', 'signals', 'entry_decisions', 'trades',
    'broker_order_intents', 'broker_position_quarantines', 'broker_runtime_state'];

// SQLite audit timestamps use SQLite's own calendar. They do not govern trading;
// preserve all explicit event/receipt/decision/intent/lifecycle millisecond fields.
function comparable(value) {
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'created_at' && key !== 'updated_at')
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, comparable(item)]));
    return value;
}

async function createPersistedReplay({ database, clock, market, broker, config = {}, onDatabaseClosed = null,
    configPath: suppliedConfigPath = null, priorEvents = [], pricingRequestTimeoutMs = null, captureEvents = true }) {
    if (process.env.NODE_ENV !== 'test' || process.env.RESEARCH_REPLAY_ISOLATED !== '1') {
        throw new Error('Persisted replay requires the isolated research test process');
    }
    if (!database || !clock || !market || !broker) throw new Error('Replay dependencies must be explicit');
    if (!Array.isArray(priorEvents) || priorEvents.some((event) => !Number.isFinite(event?.time) || event.time > clock.nowMs())) {
        throw new Error('Prior replay events must be explicit observations at or before the restart clock');
    }
    // A supplied config is caller-owned and survives bot-process shutdown. New
    // processes load it rather than rewriting persisted settings on every boot.
    const configDirectory = suppliedConfigPath ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'forex-replay-config-'));
    const configPath = suppliedConfigPath ? path.resolve(suppliedConfigPath) : path.join(configDirectory, 'config.json');
    if (!fs.existsSync(configPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ ...cloneDefaultConfig(), ...config,
            enableTrading: true, enableEmailAlerts: false }));
    }
    const configService = new ConfigService(configPath).init();
    const assets = configService.get().assets;
    const dataService = new OandaDataService(assets, {
        ...(pricingRequestTimeoutMs === null ? {} : { requestTimeoutMs: pricingRequestTimeoutMs }),
        instrumentMetadataProvider: async (instruments) => Promise.all(instruments.map((name) => broker.getInstrumentMetadata(name))),
    });
    dataService.oandaRequest = async (endpoint) => {
        if (!endpoint.includes('/pricing?')) throw new Error(`Undeclared replay request: ${endpoint}`);
        if (typeof market.brokerView === 'function') {
            throw new Error('Fine replay requires an explicitly declared pricing response completion');
        }
        const includeHomeConversions = new URL(endpoint, 'https://research.invalid')
            .searchParams.get('includeHomeConversions') === 'true';
        return broker.getPricing(dataService.getPricingInstruments(), { includeHomeConversions });
    };
    const repositories = {
        signals: new SignalRepository(), decisions: new EntryDecisionRepository(),
        trades: new TradeRepository(), runs: new StrategyRunRepository(),
        lifecycle: new BrokerLifecycleRepository(database),
    };
    const analytics = new AnalyticsService(repositories.trades, repositories.signals, repositories.decisions);
    const pending = new Set();
    const pricingRequests = new Map();
    let nextPricingRequestId = 1;
    const events = JSON.parse(JSON.stringify(priorEvents));
    let coordinator;
    let engine;
    let closed = false;

    function updateHistory() {
        market.advanceTo(clock.nowMs());
        for (const instrument of assets) for (const granularity of ['M15', 'H1']) {
            dataService.candleCache[`${instrument}_${granularity}`] = market.getCandles(instrument, granularity);
            dataService.candleCacheUpdatedAt[`${instrument}_${granularity}`] = clock.nowMs();
        }
    }
    async function drain() {
        while (pending.size) await Promise.all([...pending]);
    }
    function advanceTo(atMs) {
        if (closed) throw new Error('Replay is closed');
        clock.set(atMs);
        market.advanceTo(clock.nowMs());
    }
    async function recordEvent(kind, signals = []) {
        if (!captureEvents) return;
        const { account } = await broker.getAccountSummary();
        const event = { time: clock.nowMs(), monotonicMs: clock.monoMs(),
            signals: signals.map(({ symbol, signal, signalClass, reasonCode, entryType, setupId }) =>
                ({ symbol, signal, signalClass, reasonCode, entryType: entryType || null, setupId })),
            account, openLocalTrades: engine.openTrades.size,
            brokerStateUncertain: engine.brokerStateUncertain };
        if (kind) event.kind = kind;
        events.push(event);
    }
    async function boot() {
        coordinator = new RuntimeCoordinator({ configService, dataService,
            signalRepository: repositories.signals, entryDecisionRepository: repositories.decisions,
            tradeRepository: repositories.trades, strategyRunRepository: repositories.runs,
            brokerLifecycleRepository: repositories.lifecycle });
        await coordinator.ensureLiveSelectionInitialized();
        engine = new LiveTradingEngine().init(configService, dataService, repositories.trades,
            coordinator, null, repositories.decisions, repositories.lifecycle);
        const processQueue = engine.processQueue.bind(engine);
        engine.processQueue = () => {
            const operation = processQueue();
            pending.add(operation);
            operation.then(() => pending.delete(operation), () => pending.delete(operation));
            return operation;
        };
        updateHistory();
        await dataService.refreshInstrumentMetadata();
        if (typeof market.brokerView !== 'function') await dataService.fetchAllPrices();
        await engine.start();
        return engine;
    }
    async function observeAt(atMs, { scan = true, monitor = true } = {}) {
        if (closed) throw new Error('Replay is closed');
        clock.set(atMs);
        updateHistory();
        for (const instrument of assets) await broker.observePrice(instrument);
        await dataService.refreshInstrumentMetadata();
        await dataService.fetchAllPrices();
        if (monitor) await engine.monitorPositions();
        if (monitor) for (const instrument of assets) await broker.observePrice(instrument);
        const signals = scan ? await coordinator.runCycle() : [];
        await drain();
        await recordEvent(null, signals);
        return signals;
    }
    // Fine replay actions are separate observations. A broker-source price does
    // not refresh the app cache, and clock advance does not dispatch a timer.
    async function observeBrokerPrice(atMs, instrument, quote = null) {
        advanceTo(atMs);
        await broker.observePrice(instrument, quote);
        await recordEvent('BROKER_PRICE');
    }
    async function refreshHistoryAt(atMs) {
        advanceTo(atMs);
        updateHistory();
        await recordEvent('CANDLE_REFRESH');
    }
    async function manageAt(atMs) {
        advanceTo(atMs);
        await engine.monitorPositions();
        for (const instrument of assets) await broker.observePrice(instrument);
        await recordEvent('MANAGEMENT');
    }
    async function scanAt(atMs) {
        advanceTo(atMs);
        const signals = await coordinator.runCycle();
        await drain();
        await recordEvent('SCAN', signals);
        return signals;
    }
    function startPricingRequest(atMs) {
        advanceTo(atMs);
        // Preserve the real fetch-in-flight suppression instead of synthesizing
        // a second successful response for a poll the service would skip.
        if (dataService.isFetchingPrices) {
            dataService.fetchAllPrices();
            return null;
        }
        const id = nextPricingRequestId++;
        let resolve, reject;
        const response = new Promise((yes, no) => { resolve = yes; reject = no; });
        const transport = dataService.oandaRequest;
        dataService.oandaRequest = () => response;
        const operation = dataService.fetchAllPrices();
        dataService.oandaRequest = transport;
        pricingRequests.set(id, { id, requestedAtMs: clock.nowMs(), requestedMonotonicMs: clock.monoMs(),
            completedAtMs: null, completedMonotonicMs: null,
            resolve, reject, operation });
        return id;
    }
    async function completePricingRequest(atMs, id, payload, error = null) {
        const request = pricingRequests.get(id);
        if (!request || request.completedAtMs !== null) throw new Error('Pricing completion requires one outstanding request');
        advanceTo(atMs);
        request.completedAtMs = clock.nowMs();
        request.completedMonotonicMs = clock.monoMs();
        if (error) request.reject(error); else request.resolve(payload);
        await request.operation;
        await recordEvent('PRICING_COMPLETION');
    }
    function getPricingRequestLog() {
        return [...pricingRequests.values()].map(({ id, requestedAtMs, requestedMonotonicMs, completedAtMs, completedMonotonicMs }) =>
            ({ id, requestedAtMs, requestedMonotonicMs, completedAtMs, completedMonotonicMs,
                requestDurationMs: completedMonotonicMs === null ? null : completedMonotonicMs - requestedMonotonicMs }));
    }
    async function restart() {
        await drain();
        engine.stop();
        coordinator.removeAllListeners();
        return boot();
    }
    async function snapshot() {
        await drain();
        // Final normal broker reconciliation settles the ledger without forcing
        // open positions closed or allowing another entry beyond the boundary.
        await engine.syncOpenTrades({ throwOnError: true });
        const tables = {};
        for (const table of TABLES) tables[table] = await database(table).select('*').orderBy('rowid');
        const run = coordinator.getLiveSelection().liveRun;
        const context = { mode: run.mode, strategy: run.strategy, runId: run.runId,
            selectionId: run.selectionId, configHash: run.configHash };
        const report = await analytics.getAnalytics('all', { ...context,
            profile: 'full', timeBasis: 'realized', endTime: clock.nowMs() + 1 });
        const brokerSnapshot = broker.snapshot();
        const { account } = await broker.getAccountSummary();
        const accounting = reconcileReplayAccounting({ broker: brokerSnapshot, storedTrades: tables.trades, account });
        return comparable({ events, tables, broker: brokerSnapshot, accounting,
            brokerLedger: broker.getLedger(), config: configService.get(),
            runtime: context, analytics: report });
    }
    async function close() {
        if (closed) return;
        closed = true;
        for (const request of pricingRequests.values()) if (request.completedAtMs === null) {
            request.reject(new Error('Research process closed before the declared pricing response'));
        }
        await Promise.all([...pricingRequests.values()].map((request) => request.operation));
        await drain();
        engine?.stop();
        coordinator?.removeAllListeners();
        dataService.stop();
        await database.destroy();
        onDatabaseClosed?.();
        if (configDirectory) fs.rmSync(configDirectory, { recursive: true, force: true });
    }
    try {
        await boot();
        return { observeAt, restart, snapshot, close, repositories, dataService, advanceTo,
            observeBrokerPrice, refreshHistoryAt, manageAt, scanAt,
            startPricingRequest, completePricingRequest, getPricingRequestLog,
            get engine() { return engine; }, get coordinator() { return coordinator; }, clock, market, broker };
    } catch (error) {
        await close();
        throw error;
    }
}

module.exports = { createPersistedReplay, comparable };
