// Shared Jest-only import boundaries for real isolated orchestration suites.
// This module is never imported by the application/server or a live runtime.
const path = require('node:path');
const knex = require('knex');
const { jest: jestApi, beforeEach, afterEach } = require('@jest/globals');
const fixtures = require('./fixtures/archiveFixtures.cjs');

function createReplayTestHarness() {
    let database;
    let broker;
    let finalPricing;
    let uuidSequence = 0;
    let networkAttempts = 0;
    let savedIsolation;
    const resources = [];
    const installedClocks = new Set();

    // Install these before importing production classes. The database import
    // delegates only to the explicitly installed research connection.
    jestApi.doMock('../config/database', () => ({ db: new Proxy(function () {}, {
        apply: (_target, _this, args) => {
            if (!database) throw new Error('Research database is not installed');
            return database(...args);
        },
        get: (_target, key) => typeof database?.[key] === 'function'
            ? database[key].bind(database) : database?.[key],
    }) }));
    jestApi.doMock('uuid', () => ({ v4: () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}` }));
    jestApi.doMock('../src/services/Oandaclient', () => {
        const client = jestApi.requireActual('../src/services/Oandaclient');
        const pure = ['getPipValue', 'getExecutableQuote', 'formatPrice', 'formatPriceBound', 'buildClientExtensions'];
        const transport = ['initialize', 'getAccountSummary', 'getOpenTrades', 'getPricing', 'getTrade',
            'placeMarketOrder', 'modifyTrade', 'closeTrade', 'findOrderIntent', 'getInstrumentMetadata'];
        return { ...Object.fromEntries(pure.map((name) => [name, client[name].bind(client)])),
            ...Object.fromEntries(transport.map((name) => [name, (...args) => {
                if (!broker || typeof broker[name] !== 'function') throw new Error(`Research broker method unavailable: ${name}`);
                if (name === 'getPricing' && finalPricing) return finalPricing(...args);
                return broker[name](...args);
            }])) };
    });
    jestApi.doMock('../src/services/emailService', () => ({
        sendTradeOpenedAlert: jestApi.fn(async () => {}), sendTradeClosedAlert: jestApi.fn(async () => {}),
    }));

    const { ReplayClock } = require('./replayClock.cjs');
    const { HistoricalMarket } = require('./historicalMarket.cjs');
    const { ReplayBroker } = require('./replayBroker.cjs');
    const { createPersistedReplay } = require('./persistedReplay.cjs');
    const { cloneDefaultConfig } = require('../src/config/tradingConfig');

    async function replay({ input, assets, startMs = fixtures.START, initialBalanceAud = 100,
        brokerOptions = {}, modelPricing = fixtures.pricingAssumptions, databasePath = ':memory:',
        configPath, brokerCheckpoint, priorEvents, monotonicMs = 0, uuidStart = 0,
        marketFactory = null, beforeBoot = null, pricingRequestTimeoutMs = null, captureEvents = true }) {
        uuidSequence = uuidStart;
        const clock = new ReplayClock(startMs, { monotonicMs });
        clock.install();
        installedClocks.add(clock);
        const market = marketFactory ? marketFactory({ clock, input, pricingAssumptions: modelPricing })
            : new HistoricalMarket({ ...input, clock, maxBars: 500, pricingAssumptions: modelPricing });
        market.advanceTo(startMs);
        const brokerMarket = typeof market.brokerView === 'function' ? market.brokerView() : market;
        broker = brokerCheckpoint ? ReplayBroker.fromCheckpoint({ checkpoint: brokerCheckpoint, clock, market: brokerMarket })
            : new ReplayBroker({ clock, market: brokerMarket, initialBalanceAud, metadata: fixtures.metadata, ...brokerOptions });
        database = knex({ client: 'better-sqlite3', connection: { filename: databasePath },
            useNullAsDefault: true, pool: { min: 1, max: 1 } });
        await database.migrate.latest({ directory: path.resolve(__dirname, '../migrations') });
        if (beforeBoot) await beforeBoot({ clock, market, broker, database });
        const harness = await createPersistedReplay({ database, clock, market, broker,
            config: { ...cloneDefaultConfig(), assets }, configPath, priorEvents, pricingRequestTimeoutMs,
            captureEvents,
            onDatabaseClosed: () => { database = null; } });
        resources.push(harness);
        return harness;
    }
    async function release(harness) {
        await harness.close();
        harness.clock.restore();
        installedClocks.delete(harness.clock);
        const index = resources.indexOf(harness);
        if (index >= 0) resources.splice(index, 1);
        broker = null;
    }
    beforeEach(() => {
        savedIsolation = process.env.RESEARCH_REPLAY_ISOLATED;
        process.env.RESEARCH_REPLAY_ISOLATED = '1';
        networkAttempts = 0;
        finalPricing = null;
        jestApi.useFakeTimers({ doNotFake: ['Date', 'performance', 'hrtime', 'nextTick',
            'queueMicrotask', 'setImmediate', 'clearImmediate'] });
        const deny = () => { networkAttempts++; throw new Error('Offline replay denies outbound network'); };
        jestApi.spyOn(globalThis, 'fetch').mockImplementation(deny);
        for (const name of ['node:http', 'node:https']) {
            jestApi.spyOn(require(name), 'request').mockImplementation(deny);
            jestApi.spyOn(require(name), 'get').mockImplementation(deny);
        }
        jestApi.spyOn(require('node:net'), 'connect').mockImplementation(deny);
        jestApi.spyOn(require('node:net'), 'createConnection').mockImplementation(deny);
    });
    afterEach(async () => {
        for (const harness of [...resources]) await release(harness);
        if (database) { await database.destroy(); database = null; }
        for (const clock of installedClocks) clock.restore();
        installedClocks.clear();
        jestApi.restoreAllMocks();
        finalPricing = null;
        jestApi.useRealTimers();
        if (savedIsolation === undefined) delete process.env.RESEARCH_REPLAY_ISOLATED;
        else process.env.RESEARCH_REPLAY_ISOLATED = savedIsolation;
    });
    return { replay, release, setFinalPricing: (callback) => { finalPricing = callback; },
        get database() { return database; }, get broker() { return broker; },
        get networkAttempts() { return networkAttempts; }, get uuidSequence() { return uuidSequence; } };
}

module.exports = { createReplayTestHarness, ...fixtures };
