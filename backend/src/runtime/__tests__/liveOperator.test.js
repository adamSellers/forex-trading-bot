const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const knex = require("knex");
const ConfigService = require("../../services/configService");
const OandaDataService = require("../../services/OandaDataService");
const LiveTradingEngine = require("../../services/LiveTradingEngine");
const RuntimeCoordinator = require("../runtimeCoordinator");
const TradeRepository = require("../../repositories/tradeRepository");
const StrategyRunRepository = require("../../repositories/strategyRunRepository");
const BrokerLifecycleRepository = require("../../repositories/brokerLifecycleRepository");
const LiveOperator = require("../liveOperator");

const resources = [];
const clone = (value) => structuredClone(value);
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

async function fixture(overrides = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forex-operator-"));
    const configPath = path.join(directory, "config.json");
    const config = new ConfigService(configPath).init();
    config.update({ enableTrading: false });
    const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" },
        useNullAsDefault: true, pool: { min: 1, max: 1 } });
    await db.migrate.latest({ directory: path.resolve(__dirname, "../../../migrations") });
    const trades = new TradeRepository(db);
    const runs = new StrategyRunRepository(db);
    const lifecycle = new BrokerLifecycleRepository(db);
    const data = new OandaDataService(config.get().assets);
    const coordinator = new RuntimeCoordinator({ configService: config, dataService: data,
        tradeRepository: trades, strategyRunRepository: runs, brokerLifecycleRepository: lifecycle });
    await coordinator.ensureLiveSelectionInitialized();
    const broker = { initialize: async () => ({}), getOpenTrades: async () => ({ trades: [] }) };
    const engine = new LiveTradingEngine({ brokerClient: broker, brokerLifecycleRepository: lifecycle })
        .init(config, data, trades, coordinator, null, null, lifecycle);
    await engine.start();
    engine.startMonitoring();
    const sourceValues = { systemStatus: { status: "ok", config: config.get() },
        portfolio: { balance: 100 }, trades: [], signals: [], prices: [], account: { balance: 100 }, catalog: [] };
    const sources = () => ({ ...Object.fromEntries(Object.entries(sourceValues).map(([name, value]) =>
        [name, () => clone(value)])), engineStatus: () => engine.getStatus(),
        liveSelection: () => coordinator.getLiveSelection() });
    const operator = new LiveOperator({ configService: config, coordinator, engine, dataService: data,
        sources, ...overrides });
    const state = { directory, configPath, config, db, trades, runs, lifecycle, data, coordinator,
        engine, broker, operator, sourceValues };
    resources.push(state);
    return state;
}

beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-14T13:02:00Z"));
    jest.spyOn(global, "fetch").mockImplementation(() => {
        throw new Error("Operator tests forbid real network requests");
    });
});
afterEach(async () => {
    for (const state of resources.splice(0)) {
        state.operator.dispose();
        state.engine.stop();
        state.coordinator.stop();
        await state.db.destroy();
        fs.rmSync(state.directory, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
});

test("an operator may enable saved intent during a real loss cooldown while entries remain unavailable", async () => {
    const state = await fixture();
    const now = Date.now();
    const runId = state.coordinator.getLiveSelection().liveRun.runId;
    for (let index = 0; index < 3; index++) await state.trades.save({ id: `loss-${index}`,
        instrument: "EUR_USD", side: "BUY", units: 10, entryPrice: 1.1, entryCostAud: 11,
        isOpen: false, pnlAud: -0.02, entryTime: now - 10000 + index * 1000,
        exitTime: now - 5000 + index * 1000, runId, ownerRunId: runId, mode: "live" });

    const result = await state.operator.enableEntries();

    expect(result).toMatchObject({ outcome: "accepted", success: true,
        liveReadiness: { activationAllowed: true, passed: false, status: "COOLDOWN" },
        view: { intent: { entriesEnabled: true, durable: true }, activation: { allowed: true },
            entries: { state: "COOLDOWN", entryRisk: { entryAllowed: false } },
            protection: { engineAttached: true, monitoringActive: true } } });
    expect(JSON.parse(fs.readFileSync(state.configPath)).enableTrading).toBe(true);
});

test("a slow unavailable source cannot make an earlier successful observation look newly received", async () => {
    let now = 1000;
    const portfolioRead = deferred();
    const state = await fixture({ now: () => now, sourceTimeoutMs: 25,
        sources: () => ({ portfolio: () => { portfolioRead.resolve(); return { balance: 100 }; },
            account: () => new Promise(() => {}) }) });
    const pending = state.operator.readDashboard();
    await portfolioRead.promise;
    await new Promise(setImmediate);
    now = 2000;

    const view = await pending;

    expect(view.overview.portfolio).toEqual({ balance: 100 });
    expect(view.observations.portfolio).toMatchObject({ status: "available", observedAt: 1000 });
    expect(view.observations.account).toMatchObject({ status: "unavailable", observedAt: null,
        lastAttemptAt: 1000, error: "account observation timed out" });
});

test("a failed refresh retains the last good source with its original observation time and explicit unavailability", async () => {
    let now = 1000;
    let unavailable = false;
    const state = await fixture({ now: () => now, sources: () => ({
        account: () => {
            if (unavailable) throw new Error("Broker account unavailable");
            return { balance: 100 };
        },
    }) });
    const first = await state.operator.readDashboard();
    unavailable = true;
    now = 2000;
    const second = await state.operator.readDashboard();

    expect(second.overview.account).toEqual({ balance: 100 });
    expect(second.observations.account).toEqual({ status: "unavailable", observedAt: 1000,
        lastAttemptAt: 2000, error: "Broker account unavailable" });
    expect(first.observations.account).toMatchObject({ status: "available", observedAt: 1000 });
    expect(Object.isFrozen(second.overview.account)).toBe(true);
});

test("a newer scoped observation survives an older full read that completes afterward", async () => {
    const older = deferred();
    const accountStarted = deferred();
    let reads = 0;
    const state = await fixture({ sources: () => ({ account: () => {
        reads++;
        if (reads === 1) { accountStarted.resolve(); return older.promise; }
        return { balance: 200 };
    } }) });
    const full = state.operator.readDashboard();
    await accountStarted.promise;
    const newer = deferred();
    const unsubscribe = state.operator.observeDashboard((view) => {
        if (view.overview.account?.balance === 200) newer.resolve(view);
    });
    state.operator.invalidate(["account"]);
    const newerView = await newer.promise;
    older.resolve({ balance: 100 });
    const final = await full;

    expect(final.overview.account).toEqual({ balance: 200 });
    expect(final.observations.account).toEqual(newerView.observations.account);
    expect(final.publication).toBeGreaterThan(newerView.publication);
    unsubscribe();
});

test("price-only observation refreshes preserve broker timestamps without requesting account data", async () => {
    let accountReads = 0;
    let invalidate;
    const receivedAt = Date.now();
    const price = { instrument: "EUR_USD", timestamp: receivedAt - 3_600_000, fetchedAt: receivedAt,
        bid: 1.1, ask: 1.1001, price: 1.10005 };
    const state = await fixture({ sources: () => ({
        account: () => { accountReads++; return { balance: 100 }; }, prices: () => [price],
    }), observeChanges: (callback) => { invalidate = callback; return () => {}; } });
    await state.operator.readDashboard();
    const initialReads = accountReads;
    const updated = deferred();
    const unsubscribe = state.operator.observeDashboard((view) => {
        if (view.overview.prices?.[0]?.fetchedAt === receivedAt + 1000) updated.resolve(view);
    });
    // The subscription's initial full refresh completes before the scoped
    // update; the latter must not initiate another account observation.
    await state.operator.readDashboard();
    const readsBeforePrice = accountReads;
    price.fetchedAt += 1000;
    invalidate(["prices", "operationalHealth"]);
    const view = await updated.promise;

    expect(view.overview.prices[0]).toMatchObject({ timestamp: receivedAt - 3_600_000,
        fetchedAt: receivedAt + 1000 });
    expect(accountReads).toBe(readsBeforePrice);
    expect(accountReads).toBeGreaterThanOrEqual(initialReads);
    unsubscribe();
});

test("pausing persists immediately while a dashboard observation is still awaiting the broker", async () => {
    const account = deferred();
    const started = deferred();
    const state = await fixture({ sources: () => ({ account: () => { started.resolve(); return account.promise; } }) });
    state.config.update({ enableTrading: true }, { allowLiveActivation: true });
    const reading = state.operator.readDashboard();
    await started.promise;

    const pausing = state.operator.pauseEntries();

    expect(state.config.get().enableTrading).toBe(false);
    expect(JSON.parse(fs.readFileSync(state.configPath)).enableTrading).toBe(false);
    expect(state.engine.getStatus()).toMatchObject({ isRunning: true, monitoringActive: true });
    const paused = await Promise.race([pausing, new Promise((resolve) => setTimeout(() => resolve("still waiting"), 25))]);
    expect(paused).toMatchObject({ outcome: "accepted", refreshPending: true,
        view: { intent: { entriesEnabled: false }, entries: { state: "PAUSED" } } });
    account.resolve({ balance: 100 });
    await reading;
    expect(await pausing).toMatchObject({ outcome: "accepted", view: { intent: { entriesEnabled: false } } });
});

test("a later broker display failure remains an observation failure after the pause was accepted", async () => {
    const account = deferred();
    const started = deferred();
    let waiting = false;
    const state = await fixture({ sources: () => ({ account: () => {
        if (!waiting) return { balance: 100 };
        started.resolve();
        return account.promise;
    } }) });
    const first = await state.operator.readDashboard();
    state.config.update({ enableTrading: true }, { allowLiveActivation: true });
    waiting = true;
    const reading = state.operator.readDashboard();
    await started.promise;

    const accepted = await state.operator.pauseEntries();
    expect(accepted).toMatchObject({ outcome: "accepted", success: true, refreshPending: true });
    account.reject(new Error("Account display read failed"));
    const later = await reading;

    expect(later.overview.account).toEqual({ balance: 100 });
    expect(later.observations.account).toMatchObject({ status: "unavailable",
        observedAt: first.observations.account.observedAt, error: "Account display read failed" });
    expect(later.intent.entriesEnabled).toBe(false);
    expect(accepted.outcome).toBe("accepted");
});

test("a pause wins over an enable that is waiting for real broker initialization", async () => {
    const state = await fixture();
    const initialization = deferred();
    const started = deferred();
    state.engine.stop();
    state.broker.initialize = () => { started.resolve(); return initialization.promise; };
    const enabling = state.operator.enableEntries();
    await started.promise;

    const pausing = state.operator.pauseEntries();
    expect(state.config.get().enableTrading).toBe(false);
    initialization.resolve({});

    expect(await enabling).toMatchObject({ outcome: "rejected", code: "ENTRY_INTENT_CHANGED",
        view: { intent: { entriesEnabled: false } } });
    expect(await pausing).toMatchObject({ outcome: "accepted", view: { intent: { entriesEnabled: false } } });
    expect(JSON.parse(fs.readFileSync(state.configPath)).enableTrading).toBe(false);
});

test("existing unresolved broker state rejects activation without changing saved entry intent", async () => {
    const state = await fixture();
    await state.lifecycle.createIntent({ intentId: "unknown-entry", clientOrderId: "oi-unknown", clientTradeId: "ti-unknown",
        instrument: "EUR_USD", side: "BUY", units: 10, status: "AMBIGUOUS", submittedAt: Date.now() });

    const result = await state.operator.enableEntries();

    expect(result).toMatchObject({ outcome: "rejected", statusCode: 409, success: false,
        liveReadiness: { activationAllowed: false,
            reasons: expect.arrayContaining([expect.objectContaining({ code: "BROKER_LIFECYCLE_UNRESOLVED" })]) } });
    expect(state.config.get().enableTrading).toBe(false);
    expect(state.engine.getStatus()).toMatchObject({ isRunning: true, monitoringActive: true });
});

test("failed durable configuration writes retain their existing forced pause and report failure", async () => {
    const state = await fixture();
    jest.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("Injected config persistence failure"); });

    const result = await state.operator.enableEntries();

    expect(result).toMatchObject({ outcome: "failed", success: false,
        view: { intent: { entriesEnabled: false, durable: false }, activation: { allowed: false } } });
    expect(result.error).toMatch(/Injected config persistence failure/);
    expect(state.engine.getStatus()).toMatchObject({ isRunning: true, monitoringActive: true });
});

test("an accepted command remains accepted if its later dashboard refresh cannot be constructed", async () => {
    const state = await fixture({ sources: () => { throw new Error("Injected display failure"); } });

    const result = await state.operator.enableEntries();

    expect(result).toMatchObject({ outcome: "accepted", success: true, view: null,
        refreshError: "Injected display failure" });
    expect(state.config.get().enableTrading).toBe(true);
    expect(JSON.parse(fs.readFileSync(state.configPath)).enableTrading).toBe(true);
});

test("an accepted command remains accepted if a legacy status notification throws", async () => {
    const state = await fixture({ onStatusChange: () => { throw new Error("Legacy socket publication failed"); } });

    const result = await state.operator.enableEntries();

    expect(result).toMatchObject({ outcome: "accepted", success: true,
        view: { intent: { entriesEnabled: true, durable: true } } });
    expect(JSON.parse(fs.readFileSync(state.configPath)).enableTrading).toBe(true);
});

test("a broker read failure is not reported as successful reconciliation", async () => {
    const state = await fixture();
    state.broker.getOpenTrades = async () => { throw new Error("Broker temporarily disconnected"); };

    const result = await state.operator.reconcileBroker();

    expect(result).toMatchObject({ outcome: "failed", success: false,
        error: "Broker temporarily disconnected", view: { activation: { allowed: false } } });
    expect(state.config.get().enableTrading).toBe(false);
});

test("a completed broker snapshot retains an explicitly unresolved intent outcome", async () => {
    const state = await fixture();
    await state.lifecycle.createIntent({ intentId: "unknown-entry", clientOrderId: "oi-unknown", clientTradeId: "ti-unknown",
        instrument: "EUR_USD", side: "BUY", units: 10, status: "AMBIGUOUS", submittedAt: Date.now() });

    const result = await state.operator.reconcileBroker();

    expect(result).toMatchObject({ outcome: "unresolved", success: false, statusCode: 200,
        code: "BROKER_LIFECYCLE_UNRESOLVED", openTrades: 0 });
    expect(state.config.get().enableTrading).toBe(false);
    expect(await state.lifecycle.getRecoverableIntents()).toHaveLength(1);
});

test("unavailable current readiness never reuses a cached activation permission as current", async () => {
    const state = await fixture();
    state.config.update({ enableTrading: true }, { allowLiveActivation: true });
    const first = await state.operator.readDashboard();
    expect(first.activation.allowed).toBe(true);
    // Simulate an unavailable lifecycle ledger while preserving the actual
    // config, engine and last-good display observation.
    await state.db.schema.renameTable("broker_order_intents", "unavailable_broker_intents");
    const unavailable = await state.operator.readDashboard();
    await state.db.schema.renameTable("unavailable_broker_intents", "broker_order_intents");

    expect(unavailable.activation.allowed).toBeNull();
    expect(unavailable.entries.state).toBe("UNKNOWN");
    expect(unavailable.overview.readiness.activationAllowed).toBe(true);
    expect(unavailable.observations.readiness).toMatchObject({ status: "unavailable",
        observedAt: first.observations.readiness.observedAt });
    expect((await state.operator.readDashboard()).activation.allowed).toBe(true);
});

test("disposing observations settles pending reads and retains the independently managed engine", async () => {
    const waiting = deferred();
    const started = deferred();
    const state = await fixture({ sources: () => ({ account: () => { started.resolve(); return waiting.promise; } }) });
    const reading = state.operator.readDashboard();
    await started.promise;

    state.operator.dispose();

    await expect(reading).rejects.toThrow("Live operator is disposed");
    expect(state.engine.getStatus()).toMatchObject({ isRunning: true, monitoringActive: true });
    await expect(state.operator.readDashboard()).rejects.toThrow("Live operator is disposed");
    waiting.resolve({ balance: 100 });
});

test("unsubscribing the final observer releases listeners and polling without stopping protection", async () => {
    let subscriptions = 0;
    let cleanups = 0;
    let accountReads = 0;
    const state = await fixture({ refreshIntervalMs: 15,
        sources: () => ({ account: () => { accountReads++; return { balance: 100 }; } }),
        observeChanges: () => { subscriptions++; return () => { cleanups++; }; } });
    const firstView = deferred();
    const unsubscribe = state.operator.observeDashboard((view) => firstView.resolve(view));
    await firstView.promise;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(accountReads).toBeGreaterThan(1);
    unsubscribe();
    const stoppedAt = accountReads;
    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(accountReads).toBe(stoppedAt);
    expect(subscriptions).toBe(1);
    expect(cleanups).toBe(1);
    expect(state.engine.getStatus()).toMatchObject({ isRunning: true, monitoringActive: true });
});

test("a failing cached-view listener does not prevent another observer from reading the operator state", async () => {
    const state = await fixture();
    await state.operator.readDashboard();
    let unsubscribeFailed;

    expect(() => {
        unsubscribeFailed = state.operator.observeDashboard(() => { throw new Error("Disconnected view consumer"); });
    }).not.toThrow();
    const delivered = [];
    const unsubscribeHealthy = state.operator.observeDashboard((view) => delivered.push(view));

    expect(delivered[0]).toMatchObject({ intent: { entriesEnabled: false, durable: true } });
    unsubscribeFailed();
    unsubscribeHealthy();
});
