// Architecture spike only: synthetic broker-shaped observations, real v5 orchestration.
const RuntimeCoordinator = require('../../src/runtime/runtimeCoordinator');
const LiveTradingEngine = require('../../src/services/LiveTradingEngine');
const OandaDataService = require('../../src/services/OandaDataService');
const { cloneDefaultConfig } = require('../../src/config/tradingConfig');
const {
    createMockConfigService, createMockTradeRepository, createMockEntryDecisionRepository,
} = require('../../__tests__/helpers/mockServices');
const oanda = require('../../src/services/Oandaclient');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

jest.mock('uuid', () => {
    let sequence = 0;
    return { v4: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
        resetResearchSequence: () => { sequence = 0; } };
});

jest.mock('../../src/services/Oandaclient', () => {
    const client = jest.requireActual('../../src/services/Oandaclient');
    return {
        getPipValue: client.getPipValue.bind(client),
        getExecutableQuote: client.getExecutableQuote.bind(client),
        formatPrice: client.formatPrice.bind(client),
        formatPriceBound: client.formatPriceBound.bind(client),
        buildClientExtensions: client.buildClientExtensions.bind(client),
        initialize: jest.fn(async () => ({})),
        getAccountSummary: jest.fn(), getOpenTrades: jest.fn(), getPricing: jest.fn(), getTrade: jest.fn(), closeTrade: jest.fn(),
        getInstrumentMetadata: jest.fn(), placeMarketOrder: jest.fn(), modifyTrade: jest.fn(),
        findOrderIntent: jest.fn(async () => ({ status: 'AMBIGUOUS' })),
    };
});
jest.mock('../../src/services/emailService', () => ({
    sendTradeOpenedAlert: jest.fn(async () => {}), sendTradeClosedAlert: jest.fn(async () => {}),
}));

const activeIntentStatuses = new Set(['PREPARED', 'SUBMITTING', 'AMBIGUOUS', 'RECOVERY_PENDING', 'FILLED_UNPERSISTED']);
const copy = (value) => JSON.parse(JSON.stringify(value));
const startTime = Date.parse('2026-09-11T13:00:00Z');
const pair = 'GBP_USD';
const liveEngines = [];

const { sellRetestFixture } = require('../../src/strategies/__tests__/fixtures/intradaySellRetestFixture');

async function fixture() {
    let now = startTime;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    require('uuid').resetResearchSequence();
    const history = sellRetestFixture({ nowMs: startTime });
    const originalMid = Number(history.currentPrice.toFixed(5));
    let spread = 0.4;
    let displacementPips = 0;
    const rates = { AUD: 1, GBP: 1.9, USD: 1.5 };
    const homeConversions = Object.entries(rates).map(([currency, rate]) => ({
        currency, positionValue: String(rate), accountGain: String(rate), accountLoss: String(rate),
    }));
    const quote = (instrument = pair) => {
        const mid = instrument === pair ? originalMid + displacementPips * 0.0001 : 1 / rates.USD;
        const width = instrument === pair ? spread : 0.8;
        return { instrument, tradeable: true, time: new Date(now).toISOString(),
            bids: [{ price: (mid - width * 0.00005).toFixed(5), liquidity: 1000000 }],
            asks: [{ price: (mid + width * 0.00005).toFixed(5), liquidity: 1000000 }],
        };
    };
    const brokerTrades = new Map();
    const tradeRepository = createMockTradeRepository();
    const entryDecisionRepository = createMockEntryDecisionRepository();
    entryDecisionRepository.getLatestForSetup = jest.fn(async ({ runId, configHash, setupId }) => {
        const matches = entryDecisionRepository.decisions.filter((row) =>
            row.runId === runId && row.configHash === configHash && row.setupId === setupId);
        return matches.length ? copy(matches.at(-1)) : null;
    });
    const configService = createMockConfigService({ ...cloneDefaultConfig(), assets: [pair], enableTrading: true });
    const runRecords = new Map();
    const strategyRunRepository = {
        list: jest.fn(async ({ statuses }) => [...runRecords.values()].filter((run) => statuses.includes(run.status)).map(copy)),
        create: jest.fn(async (run) => { runRecords.set(run.runId, copy(run)); return copy(run); }),
        update: jest.fn(async (id, updates) => { runRecords.set(id, copy({ ...runRecords.get(id), ...updates })); }),
        getByRunId: jest.fn(async (id) => runRecords.has(id) ? copy(runRecords.get(id)) : null),
        retireNonLiveRuns: jest.fn(async () => 0),
    };
    const intents = new Map();
    const persistedState = new Map();
    const brokerLifecycleRepository = {
        createIntent: jest.fn(async (intent) => { intents.set(intent.intentId, copy(intent)); return copy(intent); }),
        updateIntent: jest.fn(async (id, updates) => {
            const next = { ...intents.get(id), ...updates }; intents.set(id, copy(next)); return copy(next);
        }),
        getRecoverableIntents: jest.fn(async () => [...intents.values()].filter((intent) => activeIntentStatuses.has(intent.status)).map(copy)),
        getIntentByBrokerTradeId: jest.fn(async (id) => [...intents.values()].find((intent) => intent.brokerTradeId === id) || null),
        getIntentByClientTradeId: jest.fn(async () => null),
        resolveMissingQuarantines: jest.fn(), getOpenQuarantines: jest.fn(async () => []),
        getState: jest.fn(async (key) => persistedState.get(key) || null),
        setState: jest.fn(async (key, value) => { persistedState.set(key, value); }),
    };
    oanda.initialize.mockResolvedValue({});
    oanda.getAccountSummary.mockResolvedValue({ account: {
        currency: 'AUD', NAV: '100', balance: '100', marginAvailable: '100', marginUsed: '0',
    } });
    oanda.getOpenTrades.mockImplementation(async () => ({ trades: [...brokerTrades.values()]
        .filter((trade) => trade.state === 'OPEN').map(copy) }));
    oanda.getPricing.mockImplementation(async (instruments) => ({ prices: instruments.map(quote), homeConversions }));
    oanda.getInstrumentMetadata.mockImplementation(async (name) => ({ name, displayPrecision: 5, pipLocation: -4, marginRate: '0.05' }));
    const fill = (instrument, units, options) => {
        const price = units < 0 ? quote(instrument).bids[0].price : quote(instrument).asks[0].price;
        const id = String(brokerTrades.size + 1);
        brokerTrades.set(id, { id, instrument, state: 'OPEN', price, currentUnits: String(units), initialUnits: String(units),
            openTime: new Date(now).toISOString(), stopLossOrder: { state: 'PENDING', price: String(options.stopLossPrice) },
            takeProfitOrder: { state: 'PENDING', price: String(options.takeProfitPrice) } });
        return { orderFillTransaction: { id: `fill-${id}`, instrument, price, units: String(units), time: String(now / 1000),
            tradeOpened: { tradeID: id, price, units: String(units), initialMarginRequired: '1' } } };
    };
    oanda.placeMarketOrder.mockImplementation(async (...args) => fill(...args));
    oanda.modifyTrade.mockImplementation(async (tradeID, options) => {
        const trade = brokerTrades.get(tradeID);
        if (options.stopLossPrice != null) trade.stopLossOrder.price = String(options.stopLossPrice);
        if (options.takeProfitPrice != null) trade.takeProfitOrder.price = String(options.takeProfitPrice);
        return { stopLossOrderTransaction: { tradeID, price: String(options.stopLossPrice) },
            takeProfitOrderTransaction: { tradeID, price: String(options.takeProfitPrice) } };
    });
    oanda.findOrderIntent.mockResolvedValue({ status: 'AMBIGUOUS' });
    oanda.getTrade.mockImplementation(async (id) => ({ trade: copy(brokerTrades.get(id)) }));
    oanda.closeTrade.mockImplementation(async (id) => {
        const trade = brokerTrades.get(id);
        const price = Number(trade.currentUnits) < 0 ? quote(trade.instrument).asks[0].price : quote(trade.instrument).bids[0].price;
        const realizedPL = (Number(price) - Number(trade.price)) * Number(trade.currentUnits) * rates.USD;
        Object.assign(trade, { state: 'CLOSED', closeTime: new Date(now).toISOString(),
            averageClosePrice: price, realizedPL: String(realizedPL), financing: '0',
            currentUnits: '0', closingTransactionIDs: ['fixture-close'] });
        return { orderFillTransaction: { id: 'fixture-close', time: new Date(now).toISOString(),
            instrument: trade.instrument, price, units: String(-Number(trade.initialUnits)), pl: String(realizedPL),
            tradesClosed: [{ tradeID: id, price, units: String(-Number(trade.initialUnits)),
                realizedPL: String(realizedPL), financing: '0' }] } };
    });
    const dataService = new OandaDataService([pair]);
    dataService.candleCache[`${pair}_M15`] = history.m15;
    dataService.candleCache[`${pair}_H1`] = history.h1;
    dataService.oandaRequest = jest.fn(async () => ({ prices: dataService.getPricingInstruments().map(quote), homeConversions }));
    const boot = async () => {
        const coordinator = new RuntimeCoordinator({ configService, dataService, strategyRunRepository,
            tradeRepository, entryDecisionRepository, brokerLifecycleRepository,
            signalRepository: { saveBatch: jest.fn(async () => {}) } });
        await coordinator.ensureLiveSelectionInitialized();
        const engine = new LiveTradingEngine().init(configService, dataService, tradeRepository,
            coordinator, null, entryDecisionRepository, brokerLifecycleRepository);
        // Keep sizing and risk policy real while supplying deterministic FX conversions.
        engine.getConversionRate = jest.fn(async (from, to) => rates[from] / rates[to]);
        const queued = [];
        const processQueue = engine.processQueue.bind(engine);
        jest.spyOn(engine, 'processQueue').mockImplementation(() => {
            const operation = processQueue(); queued.push(operation); return operation;
        });
        await engine.start();
        liveEngines.push(engine);
        const drain = async () => { while (queued.length) await Promise.all(queued.splice(0)); };
        const cycle = async ({ wait = true } = {}) => {
            await dataService.fetchAllPrices();
            const signals = await coordinator.runCycle();
            if (wait) await drain();
            return signals.find((signal) => signal.symbol === pair);
        };
        return { coordinator, engine, cycle, drain };
    };
    return { boot, fill, intents, history, configService, tradeRepository, entryDecisionRepository,
        dataService, brokerTrades, brokerLifecycleRepository, persistedState,
        advance: (ms = 60_000) => { now += ms; },
        observeAt: (timestamp) => {
            now = timestamp;
            dataService.candleCache[`${pair}_M15`] = history.m15.filter((bar) => Date.parse(bar.time) + 900_000 <= now);
            dataService.candleCache[`${pair}_H1`] = history.h1.filter((bar) => Date.parse(bar.time) + 3_600_000 <= now);
        },
        setQuote: (nextSpread, displacement = displacementPips) => { spread = nextSpread; displacementPips = displacement; } };
}

const smokeResults = [];
let networkAttempts;

async function timeline({ restart = false, askMissing = false } = {}) {
    const state = await fixture();
    const retainedAsk = state.history.m15.at(-2).ask;
    if (askMissing) state.history.m15.at(-2).ask = null;
    const events = [];
    state.observeAt(startTime - 1_800_000);
    let runtime = await state.boot();
    for (const timestamp of [startTime - 1_800_000, startTime - 900_000, startTime]) {
        state.observeAt(timestamp);
        if (restart && timestamp === startTime) {
            runtime.engine.stop();
            runtime = await state.boot();
        }
        const signal = await runtime.cycle();
        events.push({ time: timestamp, signal: signal.signal, reasonCode: signal.reasonCode,
            entryType: signal.entryType || null, submittedOrders: oanda.placeMarketOrder.mock.calls.length });
    }
    if (askMissing) {
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.history.m15.at(-2).ask = retainedAsk;
        state.advance();
        const recovered = await runtime.cycle();
        expect(recovered.signal).toBe('SELL');
        events.push({ time: startTime + 60_000, signal: recovered.signal,
            reasonCode: recovered.reasonCode, entryType: recovered.entryType,
            submittedOrders: oanda.placeMarketOrder.mock.calls.length });
    }
    const trades = await state.tradeRepository.getAllTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0].side).toBe('SELL');
    expect(trades[0].entryType).toBe('M15_BREAK_RETEST_REJECTION');
    expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('FILLED');
    expect([...state.intents.values()][0].status).toBe('COMPLETED');
    const order = oanda.placeMarketOrder.mock.calls[0];
    const brokerTrade = [...state.brokerTrades.values()][0];
    const distance = Number(brokerTrade.stopLossOrder.price) - Number(brokerTrade.price);
    expect(Number(brokerTrade.stopLossOrder.price)).toBe(Number(order[2].stopLossPrice));
    expect(Math.abs(order[1]) * distance * 1.5).toBeLessThanOrEqual(0.20);
    // Management receives another actual fixture observation; no interpolated
    // historical prices or instantaneous +1R activation are manufactured.
    state.advance(10_000);
    await state.dataService.fetchAllPrices();
    await runtime.engine.monitorPositions();
    state.observeAt(trades[0].entryTime + 6 * 3_600_000);
    await state.dataService.fetchAllPrices();
    await runtime.engine.monitorPositions();
    const closed = (await state.tradeRepository.getAllTrades())[0];
    expect(closed.isOpen).toBe(false);
    expect(closed.exitReason).toBe('TIME_STOP');
    expect(runtime.engine.openTrades.size).toBe(0);
    expect(oanda.closeTrade).toHaveBeenCalledTimes(1);
    runtime.engine.stop();
    return { scenario: askMissing ? 'missing-ask-recovery' : restart ? 'restart' : 'uninterrupted', events,
        trade: { instrument: closed.instrument, side: closed.side, entryType: closed.entryType,
            units: closed.units, entryTime: closed.entryTime, exitTime: closed.exitTime,
            entryPrice: closed.entryPrice, stopLossPrice: closed.stopLossPrice,
            takeProfitPrice: closed.takeProfitPrice, exitPrice: closed.exitPrice,
            exitReason: closed.exitReason, pnlAud: closed.pnlAud },
        completedIntents: [...state.intents.values()].filter((intent) => intent.status === 'COMPLETED').length,
        repositoryKind: 'IN_MEMORY_TEST_DOUBLES', networkAttempts };
}

describe('offline chronological v5 architecture spike', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        networkAttempts = 0;
        const deny = () => { networkAttempts += 1; throw new Error('Research spike denies outbound network'); };
        jest.spyOn(global, 'fetch').mockImplementation(deny);
        for (const moduleName of ['node:http', 'node:https']) {
            const transport = require(moduleName);
            jest.spyOn(transport, 'request').mockImplementation(deny);
            jest.spyOn(transport, 'get').mockImplementation(deny);
        }
        jest.spyOn(require('node:net'), 'connect').mockImplementation(deny);
        jest.spyOn(require('node:net'), 'createConnection').mockImplementation(deny);
    });
    afterEach(() => {
        liveEngines.splice(0).forEach((engine) => engine.stop());
        jest.restoreAllMocks();
    });

    test('causal break/retest/confirmation, real sizing/protection and timed management are deterministic', async () => {
        const first = await timeline();
        expect(first.events.map((event) => event.submittedOrders)).toEqual([0, 0, 1]);
        expect(networkAttempts).toBe(0);
        jest.clearAllMocks();
        const second = await timeline();
        expect(second).toEqual(first);
        expect(networkAttempts).toBe(0);
        smokeResults.push(first);
    });

    test('restart between completed retest and confirmation preserves eligibility and exact protection', async () => {
        const result = await timeline({ restart: true });
        expect(result.events.map((event) => event.submittedOrders)).toEqual([0, 0, 1]);
        expect(networkAttempts).toBe(0);
        smokeResults.push(result);
    });

    test('unavailable ask evidence cannot enter; a corrected observation can recover', async () => {
        const result = await timeline({ askMissing: true });
        expect(result.events.map((event) => event.submittedOrders)).toEqual([0, 0, 0, 1]);
        expect(networkAttempts).toBe(0);
        smokeResults.push(result);
    });

    afterAll(() => {
        if (!process.env.RESEARCH_REPORT_PATH || smokeResults.length !== 3) return;
        const root = path.resolve(__dirname, '../../..');
        const sourcePaths = [
            'backend/src/runtime/runtimeCoordinator.js', 'backend/src/services/signalGenerator.js',
            'backend/src/services/LiveTradingEngine.js', 'backend/src/strategies/intradayMomentum.js',
            'backend/src/runtime/intradaySellRetestPolicy.js', 'backend/src/runtime/intradaySellRetestEvidence.js',
            'backend/src/runtime/executionPolicy.js', 'backend/src/runtime/exitPolicy.js',
            'backend/research/__tests__/orchestrationSpike.test.js',
        ];
        const report = { schemaVersion: 1, artifactKind: 'OFFLINE_ORCHESTRATION_ARCHITECTURE_SPIKE',
            status: 'PASSED_3_SYNTHETIC_SCENARIOS', strategyVersion: '1.3.0',
            sources: Object.fromEntries(sourcePaths.map((file) => [file,
                crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
            scenarios: smokeResults,
            limits: ['Synthetic fixture observations, not a historical strategy/portfolio return.',
                'Repositories use in-memory test doubles; real SQLite parity and full state replay remain pending.',
                'Single pair SELL path only; BUY, concurrent pairs, dynamic NAV/margin, slippage, BE timing, alternative exits and statistical evaluation remain pending.',
                'This confirms existing Jest seams can control clocks and execute production orchestration without live dependencies; it does not establish exact broker replay or profitability.'] };
        fs.mkdirSync(path.dirname(process.env.RESEARCH_REPORT_PATH), { recursive: true });
        fs.writeFileSync(process.env.RESEARCH_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    });
});
