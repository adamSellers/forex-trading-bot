const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const knex = require('knex');
let mockDatabase;
let mockBroker;
let mockFinalPricing;
let mockUuidSequence = 0;

jest.mock('../../config/database', () => ({ db: new Proxy(function () {}, {
    apply: (_target, _this, args) => {
        if (!mockDatabase) throw new Error('Research database is not installed');
        return mockDatabase(...args);
    },
    get: (_target, key) => typeof mockDatabase?.[key] === 'function'
        ? mockDatabase[key].bind(mockDatabase) : mockDatabase?.[key],
}) }));
jest.mock('uuid', () => ({ v4: () => `00000000-0000-4000-8000-${String(++mockUuidSequence).padStart(12, '0')}` }));
jest.mock('../../src/services/Oandaclient', () => {
    const client = jest.requireActual('../../src/services/Oandaclient');
    const pureMethods = ['getPipValue', 'getExecutableQuote', 'formatPrice', 'formatPriceBound', 'buildClientExtensions'];
    const methods = ['initialize', 'getAccountSummary', 'getOpenTrades', 'getPricing', 'getTrade',
        'placeMarketOrder', 'modifyTrade', 'closeTrade', 'findOrderIntent', 'getInstrumentMetadata'];
    return { ...Object.fromEntries(pureMethods.map((name) => [name, client[name].bind(client)])),
        ...Object.fromEntries(methods.map((name) => [name, (...args) => {
        if (!mockBroker || typeof mockBroker[name] !== 'function') throw new Error(`Research broker method unavailable: ${name}`);
        if (name === 'getPricing' && mockFinalPricing) return mockFinalPricing(...args);
        return mockBroker[name](...args);
    }])) };
});
jest.mock('../../src/services/emailService', () => ({
    sendTradeOpenedAlert: jest.fn(async () => {}), sendTradeClosedAlert: jest.fn(async () => {}),
}));

const { ReplayClock } = require('../replayClock.cjs');
const { HistoricalMarket } = require('../historicalMarket.cjs');
const { ReplayBroker } = require('../replayBroker.cjs');
const { createPersistedReplay } = require('../persistedReplay.cjs');
const { verifyReplaySources } = require('../replayManifest.cjs');
const { sellRetestFixture } = require('../../src/strategies/__tests__/fixtures/intradaySellRetestFixture');
const { buyEntryFixture } = require('../fixtures/causalFlows.cjs');
const { cloneDefaultConfig } = require('../../src/config/tradingConfig');
const { getStrategyDefinition } = require('../../src/strategies');

const START = Date.parse('2026-09-11T13:00:00Z');
const M15 = 900_000;
const metadata = {
    AUD_USD: { name: 'AUD_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05', tradeUnitsPrecision: 0 },
    EUR_USD: { name: 'EUR_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05', tradeUnitsPrecision: 0 },
    GBP_USD: { name: 'GBP_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05', tradeUnitsPrecision: 0 },
    USD_JPY: { name: 'USD_JPY', displayPrecision: 3, pipLocation: -2, marginRate: '0.05', tradeUnitsPrecision: 0 },
};
const pricingAssumptions = { tradeable: true, liquidityUnits: 1_000_000 };

function rawBar(bar) {
    const mid = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => ['ohlc'[i], bar[key]]));
    const ask = Object.fromEntries(['open', 'high', 'low', 'close'].map((key, i) => ['ohlc'[i], bar.ask?.[key] ?? bar[key] + 0.00002]));
    const bid = Object.fromEntries(Object.entries(mid).map(([key, value]) => [key, value - (ask[key] - value)]));
    return { time: Date.parse(bar.time) / 1000, mid, ask, bid, complete: true, volume: bar.volume || 100 };
}
function fixtureArchive(flows, { futureIntervals = 24 } = {}) {
    const candlesByInstrument = {};
    const h1ByInstrument = {};
    for (const flow of flows) {
        const bars = flow.m15.map(rawBar);
        const final = bars.at(-1);
        for (let index = 1; index <= futureIntervals; index++) {
            bars.push({ ...final, time: final.time + index * 900,
                mid: Object.fromEntries('ohlc'.split('').map((key) => [key, final.mid.c])),
                bid: Object.fromEntries('ohlc'.split('').map((key) => [key, final.bid.c])),
                ask: Object.fromEntries('ohlc'.split('').map((key) => [key, final.ask.c])) });
        }
        candlesByInstrument[flow.instrument] = bars;
        // SELL fixture explicitly supplies independent H1 software evidence;
        // coherent BUY fixtures use the adapter's actual M15 aggregation.
        if (flow.independentH1) h1ByInstrument[flow.instrument] = flow.h1.map(rawBar);
    }
    const longest = Object.values(candlesByInstrument).sort((a, b) => b.length - a.length)[0];
    if (!candlesByInstrument.AUD_USD) candlesByInstrument.AUD_USD = longest.map((bar) => ({
        time: bar.time, complete: true, volume: 100,
        mid: { o: 0.66667, h: 0.6667, l: 0.66664, c: 0.66667 },
        bid: { o: 0.66665, h: 0.66668, l: 0.66662, c: 0.66665 },
        ask: { o: 0.66669, h: 0.66672, l: 0.66666, c: 0.66669 },
    }));
    return { candlesByInstrument, h1ByInstrument };
}

const resources = [];
const installedClocks = new Set();
let networkAttempts = 0;
let savedIsolation;
async function replay({ input, assets, startMs = START, initialBalanceAud = 100, brokerOptions = {}, modelPricing = pricingAssumptions }) {
    mockUuidSequence = 0;
    const clock = new ReplayClock(startMs);
    clock.install();
    installedClocks.add(clock);
    const market = new HistoricalMarket({ ...input, clock, maxBars: 500, pricingAssumptions: modelPricing });
    market.advanceTo(startMs);
    mockBroker = new ReplayBroker({ clock, market, initialBalanceAud, metadata, ...brokerOptions });
    mockDatabase = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' },
        useNullAsDefault: true, pool: { min: 1, max: 1 } });
    await mockDatabase.migrate.latest({ directory: path.resolve(__dirname, '../../migrations') });
    const harness = await createPersistedReplay({ database: mockDatabase, clock, market,
        broker: mockBroker, config: { ...cloneDefaultConfig(), assets },
        onDatabaseClosed: () => { mockDatabase = null; } });
    resources.push(harness);
    return harness;
}
async function release(harness) {
    await harness.close();
    harness.clock.restore();
    installedClocks.delete(harness.clock);
    resources.splice(resources.indexOf(harness), 1);
    mockBroker = null;
}

describe('persisted chronological production-path replay', () => {
    beforeEach(() => {
        savedIsolation = process.env.RESEARCH_REPLAY_ISOLATED;
        process.env.RESEARCH_REPLAY_ISOLATED = '1';
        networkAttempts = 0;
        mockFinalPricing = null;
        jest.useFakeTimers({ doNotFake: ['Date', 'performance', 'hrtime', 'nextTick',
            'queueMicrotask', 'setImmediate', 'clearImmediate'] });
        const deny = () => { networkAttempts++; throw new Error('Offline replay denies outbound network'); };
        jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
        for (const name of ['node:http', 'node:https']) {
            jest.spyOn(require(name), 'request').mockImplementation(deny);
            jest.spyOn(require(name), 'get').mockImplementation(deny);
        }
        jest.spyOn(require('node:net'), 'connect').mockImplementation(deny);
        jest.spyOn(require('node:net'), 'createConnection').mockImplementation(deny);
    });
    afterEach(async () => {
        for (const harness of [...resources]) await release(harness);
        if (mockDatabase) { await mockDatabase.destroy(); mockDatabase = null; }
        for (const clock of installedClocks) clock.restore();
        installedClocks.clear();
        jest.restoreAllMocks();
        mockFinalPricing = null;
        jest.useRealTimers();
        if (savedIsolation === undefined) delete process.env.RESEARCH_REPLAY_ISOLATED;
        else process.env.RESEARCH_REPLAY_ISOLATED = savedIsolation;
    });

    test('SELL structural evidence, actual SQLite intent/trade and timed closure reproduce across restart', async () => {
        async function run(restart) {
            const flow = { ...sellRetestFixture({ nowMs: START }), instrument: 'GBP_USD', independentH1: true };
            const h = await replay({ input: fixtureArchive([flow]), assets: ['GBP_USD'], startMs: START - 2 * M15 });
            await h.observeAt(START - 2 * M15);
            await h.observeAt(START - M15);
            if (restart) await h.restart();
            await h.observeAt(START);
            const open = await h.repositories.trades.getAllTrades();
            expect(open).toHaveLength(1);
            expect(open[0]).toMatchObject({ side: 'SELL', entryType: 'M15_BREAK_RETEST_REJECTION', isOpen: true });
            const stop = open[0].stopLossPrice;
            await h.observeAt(START + 6 * 3_600_000, { scan: false });
            const snapshot = await h.snapshot();
            expect(snapshot.tables.trades).toHaveLength(1);
            expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, exit_reason: 'TIME_STOP', stop_loss_price: stop });
            expect(snapshot.tables.entry_decisions.at(-1).outcome).toBe('FILLED');
            expect(snapshot.tables.broker_order_intents.at(-1).status).toBe('COMPLETED');
            expect(snapshot.analytics.summary.totalTrades).toBe(1);
            expect(snapshot.accounting.status).toBe('RECONCILED');
            expect(h.engine.stats.errors).toBe(0);
            expect(networkAttempts).toBe(0);
            await release(h);
            return snapshot;
        }
        const first = await run(false);
        expect(await run(false)).toEqual(first);
        expect(await run(true)).toEqual(first);
    });

    test.each(['EUR_USD', 'USD_JPY'])('healthy %s BUY executes through causal M15/H1 and real conversion/sizing', async (instrument) => {
        const flow = buyEntryFixture({ instrument, nowMs: START });
        const h = await replay({ input: fixtureArchive([flow]), assets: [instrument] });
        expect(h.dataService.homeConversionCache.USD).toMatchObject({
            accountGain: expect.any(Number), accountLoss: expect.any(Number),
        });
        await h.observeAt(START);
        const trades = await h.repositories.trades.getAllTrades();
        expect(trades).toHaveLength(1);
        expect(trades[0]).toMatchObject({ side: 'BUY', isOpen: true });
        expect(Number.isInteger(trades[0].units)).toBe(true);
        expect(trades[0].stopLossPrice).toBeLessThan(trades[0].entryPrice);
        expect(trades[0].takeProfitPrice).toBeGreaterThan(trades[0].entryPrice);
        expect(h.engine.stats.errors).toBe(0);
        expect(networkAttempts).toBe(0);
    });

    test('competing eligible pairs evolve account exposure and survive ownership restart without another fill', async () => {
        const flows = ['EUR_USD', 'USD_JPY'].map((instrument) => buyEntryFixture({ instrument, nowMs: START }));
        // Larger synthetic NAV demonstrates admission while retaining the A$100
        // sizing cap and all production risk/margin limits, without funding live.
        const h = await replay({ input: fixtureArchive(flows), assets: flows.map((flow) => flow.instrument), initialBalanceAud: 1000 });
        await h.observeAt(START);
        const first = await h.repositories.trades.getAllTrades();
        expect(first).toHaveLength(2);
        expect((await h.broker.getAccountSummary()).account.marginUsed).not.toBe('0');
        await h.restart();
        await h.observeAt(START + 60_000);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(2);
        expect(h.engine.openTrades.size).toBe(2);
        expect(h.engine.brokerStateUncertain).toBe(false);
        expect(h.engine.stats.errors).toBe(0);
    });

    test('existing account constraints may reject another pair without becoming a count cap', async () => {
        const flows = ['EUR_USD', 'USD_JPY'].map((instrument) => buyEntryFixture({ instrument, nowMs: START }));
        const h = await replay({ input: fixtureArchive(flows), assets: flows.map((flow) => flow.instrument) });
        await h.observeAt(START);
        const decisions = await mockDatabase('entry_decisions').select('instrument', 'outcome', 'rejection_code');
        expect(decisions.filter((row) => row.outcome === 'FILLED')).toHaveLength(1);
        expect(decisions.filter((row) => row.outcome === 'REJECTED')).toHaveLength(1);
        expect(decisions.find((row) => row.outcome === 'REJECTED').rejection_code).not.toBe('MAX_POSITIONS');
        expect(h.engine.stats.errors).toBe(0);
    });

    test('local final-price decline can reconsider a healthy repeated event using its original anchor', async () => {
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const h = await replay({ input: fixtureArchive([flow]), assets: ['EUR_USD'] });
        const pricing = h.broker.getPricing.bind(h.broker);
        let wide = true;
        // Change only the singleton transport used for final execution pricing;
        // normal DataService delivery still includes healthy conversion evidence.
        mockFinalPricing = async (instruments, options) => {
            const payload = await pricing(instruments, options);
            if (wide && options?.includeHomeConversions) payload.prices = payload.prices.map((quote) => quote.instrument !== 'EUR_USD' ? quote : {
                ...quote, asks: quote.asks.map((level) => ({ ...level, price: String(Number(level.price) + 0.002) })),
            });
            return payload;
        };
        await h.observeAt(START);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(0);
        const rejected = await mockDatabase('entry_decisions').first();
        expect(rejected.rejection_code).toBe('SPREAD_TOO_WIDE');
        wide = false;
        await h.observeAt(START + 60_000);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        const decisions = await mockDatabase('entry_decisions').orderBy('id');
        expect(decisions.at(-1).outcome).toBe('FILLED');
        expect(decisions.at(-1).entry_reference_price).toBe(rejected.entry_reference_price);
        expect(decisions.at(-1).setup_id).toBe(rejected.setup_id);
        expect(Number(rejected.entry_reference_price)).toBeGreaterThan(0);
        expect(h.engine.stats.errors).toBe(0);
    });

    test('broker-confirmed breakeven, gap stop and explicit lifetime costs reconcile after restart', async () => {
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const h = await replay({ input: fixtureArchive([flow]), assets: ['EUR_USD'],
            brokerOptions: { commissionAud: 0.01 } });
        await h.observeAt(START);
        const trade = (await h.repositories.trades.getAllTrades())[0];
        const risk = trade.entryPrice - trade.stopLossPrice;
        const originalQuote = h.market.getQuote.bind(h.market);
        let bid = trade.entryPrice + 1.1 * risk;
        h.market.getQuote = (instrument) => {
            const quote = originalQuote(instrument);
            return instrument !== 'EUR_USD' ? quote : { ...quote,
                time: new Date(h.clock.nowMs()).toISOString(), researchObservation: 'SYNTHETIC_POINT',
                bids: [{ price: bid.toFixed(5), liquidity: 1_000_000 }],
                asks: [{ price: (bid + 0.00004).toFixed(5), liquidity: 1_000_000 }] };
        };
        await h.observeAt(START + 10_000, { scan: false });
        const protectedTrade = (await h.repositories.trades.getAllTrades())[0];
        expect(protectedTrade).toMatchObject({ breakevenHit: true, activeStopType: 'BREAKEVEN', stopLossPrice: trade.entryPrice });
        h.broker.applyFinancing({ id: 'declared-carry', tradeId: trade.oandaTradeId, amountAud: -0.02, atMs: h.clock.nowMs() });
        await h.restart();
        bid = trade.entryPrice - 0.0001;
        await h.observeAt(START + 20_000, { scan: false });
        const snapshot = await h.snapshot();
        expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, active_stop_type: 'BREAKEVEN' });
        expect(snapshot.accounting).toMatchObject({ status: 'RECONCILED', commissionAud: 0.02, financingAud: -0.02 });
        expect(snapshot.accounting.tradeChecks[0].recordedNetAud).toBeLessThan(0);
        expect(h.engine.stats.errors).toBe(0);
    });

    test('a filled order with a lost response resolves from its durable intent without another order', async () => {
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const h = await replay({ input: fixtureArchive([flow]), assets: ['EUR_USD'] });
        const submit = h.broker.placeMarketOrder.bind(h.broker);
        let submissions = 0;
        h.broker.placeMarketOrder = async (...args) => {
            submissions++;
            await submit(...args);
            const error = new Error('Declared lost response after broker fill');
            error.code = 'ETIMEDOUT';
            throw error;
        };
        await h.observeAt(START);
        await h.restart();
        await h.observeAt(START + 60_000);
        const snapshot = await h.snapshot();
        expect(submissions).toBe(1);
        expect(snapshot.tables.trades).toHaveLength(1);
        expect(snapshot.tables.broker_order_intents).toHaveLength(1);
        expect(snapshot.tables.broker_order_intents[0].status).toBe('COMPLETED');
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(h.engine.brokerStateUncertain).toBe(false);
    });

    const manifestPath = process.env.RESEARCH_REPLAY_MANIFEST;
    if (manifestPath) test('runs the explicitly pinned historical coarse-close manifest', async () => {
        const spec = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (spec.schemaVersion !== 1 || spec.evidenceLevel !== 'M15_COMPLETED_CLOSE_SCREENING') throw new Error('Unknown replay manifest/evidence contract');
        if (spec.pricingAssumptions?.tradeable !== true || !(spec.pricingAssumptions.liquidityUnits > 0)) throw new Error('Declare modeled tradeability and liquidity');
        if (spec.nodeVersion !== process.versions.node) throw new Error('Use the manifest-pinned Node version');
        verifyReplaySources(path.resolve(__dirname, '../../..'), spec.sourceHashes);
        const config = cloneDefaultConfig();
        const actualIdentity = { strategy: config.strategy,
            strategyVersion: getStrategyDefinition(config.strategy).version,
            releaseVersion: config.liveReleaseVersion, executionPolicyVersion: config.executionPolicyVersion,
            pricingModelVersion: config.pricingModelVersion };
        expect(spec.baselineIdentity).toEqual(actualIdentity);
        const archivePath = path.resolve(path.dirname(manifestPath), spec.archive.path);
        const bytes = fs.readFileSync(archivePath);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== spec.archive.sha256) throw new Error('Historical archive hash differs from manifest');
        const archive = JSON.parse(bytes);
        if (archive.granularity !== 'M15' || archive.completeCandlesOnly !== true) throw new Error('Explicit completed-only M15 provenance required');
        const startMs = Date.parse(spec.fromUtc), endMs = Date.parse(spec.toUtcExclusive);
        if (!(startMs < endMs) || !spec.assets?.length || !Number.isFinite(spec.warmupDays)) throw new Error('Explicit interval/assets/warmup required');
        const input = { candlesByInstrument: {}, completedOnlyDeclared: true };
        for (const instrument of [...new Set([...spec.assets, 'AUD_USD'])]) {
            if (!archive.candlesByInstrument[instrument]) throw new Error(`Missing archive instrument ${instrument}`);
            input.candlesByInstrument[instrument] = archive.candlesByInstrument[instrument].filter((bar) =>
                bar.time * 1000 >= startMs - spec.warmupDays * 86_400_000 && bar.time * 1000 < endMs);
        }
        const h = await replay({ input, assets: spec.assets, startMs, initialBalanceAud: spec.initialBalanceAud,
            brokerOptions: { metadata: spec.metadata, slippagePips: spec.slippagePips, commissionAud: spec.commissionAud },
            modelPricing: spec.pricingAssumptions });
        for (let at = startMs; at < endMs; at += M15) await h.observeAt(at);
        const snapshot = await h.snapshot();
        expect(snapshot.runtime.strategy).toBe(actualIdentity.strategy);
        expect(snapshot.config.liveReleaseVersion).toBe(actualIdentity.releaseVersion);
        expect(snapshot.config.executionPolicyVersion).toBe(actualIdentity.executionPolicyVersion);
        expect(snapshot.config.pricingModelVersion).toBe(actualIdentity.pricingModelVersion);
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(networkAttempts).toBe(0);
        if (h.engine.stats.errors) throw new Error(`Unexpected engine errors: ${h.engine.stats.errors}`);
        const output = { schemaVersion: 1, artifactKind: 'PERSISTED_CAUSAL_COARSE_REPLAY',
            manifestSha256: crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex'),
            manifest: spec, runtimeEnvironment: { nodeVersion: process.versions.node,
                platform: process.platform, architecture: process.arch, icuVersion: process.versions.icu,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                dependencies: Object.fromEntries(['jest', 'knex', 'better-sqlite3'].map((name) =>
                    [name, require(`${name}/package.json`).version])) },
            market: h.market.summary(), networkAttempts,
            snapshot, limits: ['M15 component closes are modeled price observations, not synchronous executable account quotes.',
                'Broker-held stops/targets here observe supplied closes only; unobserved intrabar crossings, management opportunities and financing remain unresolved.',
                'This checks orchestration/account state and cannot establish profitable strategy expectancy or an exact broker replay.'] };
        fs.writeFileSync(process.env.RESEARCH_REPLAY_OUTPUT, JSON.stringify(output, null, 2) + '\n');
    }, 300_000);
});
