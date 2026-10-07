const RuntimeCoordinator = require('../runtimeCoordinator');
const LiveTradingEngine = require('../../services/LiveTradingEngine');
const OandaDataService = require('../../services/OandaDataService');
const { cloneDefaultConfig } = require('../../config/tradingConfig');
const {
    createMockConfigService, createMockTradeRepository, createMockEntryDecisionRepository,
} = require('../../../__tests__/helpers/mockServices');
const oanda = require('../../services/Oandaclient');

jest.mock('../../services/Oandaclient', () => {
    const client = jest.requireActual('../../services/Oandaclient');
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
jest.mock('../../services/emailService', () => ({
    sendTradeOpenedAlert: jest.fn(async () => {}), sendTradeClosedAlert: jest.fn(async () => {}),
}));

const activeIntentStatuses = new Set(['PREPARED', 'SUBMITTING', 'AMBIGUOUS', 'RECOVERY_PENDING', 'FILLED_UNPERSISTED']);
const copy = (value) => JSON.parse(JSON.stringify(value));
const startTime = Date.parse('2026-09-11T13:00:00Z');
const pair = 'GBP_USD';
const liveEngines = [];

const { sellRetestFixture } = require('../../strategies/__tests__/fixtures/intradaySellRetestFixture');

async function fixture() {
    let now = startTime;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
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
    oanda.getOpenTrades.mockImplementation(async () => ({ trades: [...brokerTrades.values()].map(copy) }));
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
        trade.stopLossOrder.price = String(options.stopLossPrice);
        trade.takeProfitOrder.price = String(options.takeProfitPrice);
        return { stopLossOrderTransaction: { tradeID, price: String(options.stopLossPrice) },
            takeProfitOrderTransaction: { tradeID, price: String(options.takeProfitPrice) } };
    });
    oanda.findOrderIntent.mockResolvedValue({ status: 'AMBIGUOUS' });
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
        setQuote: (nextSpread, displacement = displacementPips) => { spread = nextSpread; displacementPips = displacement; } };
}

describe('SELL candidate through the real live orchestration', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { liveEngines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });

    test('default indicators, durable evidence, final validation, sizing and broker protection agree', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal.signal).toBe('SELL');
        expect(signal.strategyVersion).toBe('1.4.0');
        expect(signal.entryType).toBe('M15_BREAK_RETEST_REJECTION');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const [instrument, units, options] = oanda.placeMarketOrder.mock.calls[0];
        expect(instrument).toBe(pair);
        expect(units).toBeLessThan(0);
        expect(Number(options.stopLossPrice)).toBeGreaterThanOrEqual(signal.strategyContext.sellRetest.structuralStopLossPrice);
        const trade = [...state.brokerTrades.values()][0];
        expect(Number(trade.stopLossOrder.price)).toBe(Number(options.stopLossPrice));
        const risk = Number(trade.stopLossOrder.price) - Number(trade.price);
        expect(Number(trade.takeProfitOrder.price)).toBeCloseTo(Number(trade.price) - 1.5 * risk, 4);
        expect(Math.abs(units) * risk * 1.5).toBeLessThanOrEqual(0.20);
        expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('FILLED');
        expect([...state.intents.values()][0].status).toBe('COMPLETED');
        state.advance();
        await runtime.cycle();
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test.each([false, true])('distinct break and retest cannot enter before confirmation (restart=%s)', async (restart) => {
        const state = await fixture();
        const fullHistory = [...state.history.m15];
        state.advance(-1_800_000);
        state.dataService.candleCache[`${pair}_M15`] = fullHistory.slice(0, -2);
        let runtime = await state.boot();
        expect((await runtime.cycle()).signal).not.toBe('SELL');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.advance(900_000);
        state.dataService.candleCache[`${pair}_M15`] = fullHistory.slice(0, -1);
        expect((await runtime.cycle()).signal).not.toBe('SELL');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.advance(900_000);
        // The persisted frozen level and completed retest survive rebuilding
        // the coordinator and engine before the confirmation is processed.
        state.dataService.candleCache[`${pair}_M15`] = fullHistory;
        if (restart) { runtime.engine.stop(); runtime = await state.boot(); }
        const confirmed = await runtime.cycle();
        expect(confirmed.signal).toBe('SELL');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('missing ask evidence prevents entry and corrected broker candles can recover', async () => {
        const state = await fixture();
        const originalAsk = state.history.m15.at(-2).ask;
        state.history.m15.at(-2).ask = null;
        const runtime = await state.boot();
        expect((await runtime.cycle()).signal).not.toBe('SELL');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.history.m15.at(-2).ask = originalAsk;
        state.advance();
        expect((await runtime.cycle()).signal).toBe('SELL');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });
});
