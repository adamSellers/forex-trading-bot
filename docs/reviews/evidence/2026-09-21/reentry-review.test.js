const RuntimeCoordinator = require('../../../../backend/src/runtime/runtimeCoordinator');
const LiveTradingEngine = require('../../../../backend/src/services/LiveTradingEngine');
const OandaDataService = require('../../../../backend/src/services/OandaDataService');
const { cloneDefaultConfig } = require('../../../../backend/src/config/tradingConfig');
const {
    createMockConfigService, createMockTradeRepository, createMockEntryDecisionRepository,
} = require('../../../../backend/__tests__/helpers/mockServices');
const oanda = require('../../../../backend/src/services/Oandaclient');

jest.mock('../../../../backend/src/services/Oandaclient', () => {
    const client = jest.requireActual('../../../../backend/src/services/Oandaclient');
    return {
        getPipValue: client.getPipValue.bind(client),
        getExecutableQuote: client.getExecutableQuote.bind(client),
        formatPrice: client.formatPrice.bind(client),
        buildClientExtensions: client.buildClientExtensions.bind(client),
        initialize: jest.fn(async () => ({})),
        getAccountSummary: jest.fn(), getOpenTrades: jest.fn(), getPricing: jest.fn(),
        getInstrumentMetadata: jest.fn(), placeMarketOrder: jest.fn(), modifyTrade: jest.fn(),
        findOrderIntent: jest.fn(async () => ({ status: 'AMBIGUOUS' })),
    };
});
jest.mock('../../../../backend/src/services/emailService', () => ({
    sendTradeOpenedAlert: jest.fn(async () => {}), sendTradeClosedAlert: jest.fn(async () => {}),
}));

const activeIntentStatuses = new Set(['PREPARED', 'SUBMITTING', 'AMBIGUOUS', 'RECOVERY_PENDING', 'FILLED_UNPERSISTED']);
const copy = (value) => JSON.parse(JSON.stringify(value));
const startTime = Date.parse('2026-09-11T13:00:00Z');
const pair = 'GBP_USD';
const liveEngines = [];

// Deterministic completed candles use the existing default breakout fixture,
// with larger ranges so a 1.3-pip spread passes strategy cost checks before
// reaching the separate 1.2-pip execution limit. No indicator is mocked.
function candles(closeTime = startTime) {
    const scale = 10;
    const price = (value) => 1.3 + (value - 1.1) * scale;
    let previousClose = 1.1;
    const m15 = Array.from({ length: 160 }, (_, index) => {
        const close = 1.1 + index * 0.00001 + Math.sin(index / 2 + 2.8) * 0.0003;
        const open = index ? previousClose : close;
        previousClose = close;
        return {
            time: new Date(closeTime - (160 - index) * 900_000).toISOString(), complete: true,
            open: price(open), close: price(close),
            high: price(Math.max(open, close) + 0.00003), low: price(Math.min(open, close) - 0.00003),
        };
    });
    const h1 = Array.from({ length: 160 }, (_, index) => {
        const close = 1.1 + index * 0.0003 + Math.sin(index / 3) * 0.0003 * 0.8;
        return {
            time: new Date(Math.floor(closeTime / 3_600_000) * 3_600_000 - (160 - index) * 3_600_000).toISOString(),
            complete: true, open: price(close - 0.00012), close: price(close),
            high: price(close + 0.00054), low: price(close - 0.00054),
        };
    });
    return { m15, h1, reference: m15.at(-1).close };
}

async function fixture() {
    let now = startTime;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const history = candles();
    const originalMid = Number(history.reference.toFixed(5));
    let spread = 1.3;
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
    const brokerTrades = new Map(); let mockBrokerId = 0;
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
        const id = String(++mockBrokerId);
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
            tradeRepository, entryDecisionRepository, signalRepository: { saveBatch: jest.fn(async () => {}) } });
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
        dataService, brokerTrades, advance: (ms = 60_000) => { now += ms; },
        setQuote: (nextSpread, displacement = displacementPips) => { spread = nextSpread; displacementPips = displacement; } };
}


describe('September21 isolated TP re-entry review', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { liveEngines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });
    test.each([false, true])('TP keeps same-candle filled setup suppressed but next valid candle can enter (restart=%s)', async (restart) => {
        const state = await fixture();
        state.setQuote(1);
        let runtime = await state.boot();
        const first = await runtime.cycle();
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const trade = [...runtime.engine.openTrades.values()][0];
        state.advance(120000);
        state.brokerTrades.delete(trade.oandaTradeId);
        oanda.getTrade = jest.fn(async () => ({trade: {
            id: trade.oandaTradeId, instrument: pair, state:'CLOSED',
            averageClosePrice: String(trade.takeProfitPrice), realizedPL:'0.3', financing:'0', commission:'0',
            closeTime: new Date(Date.now()).toISOString(),
            takeProfitOrder:{state:'FILLED', price:String(trade.takeProfitPrice)}
        }}));
        await runtime.engine.syncWithOanda();
        expect(runtime.engine.openTrades.size).toBe(0);
        expect(state.tradeRepository.trades[0].exitReason).toBe('TAKE_PROFIT');
        if (restart) { runtime.engine.stop(); runtime = await state.boot(); }
        const same = await runtime.cycle();
        expect(same.reasonCode).toBe('COOLDOWN_DUPLICATE_CANDLE');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        state.advance(13 * 60000);
        const newHistory = candles(Date.now());
        state.dataService.candleCache[`${pair}_M15`] = newHistory.m15;
        state.dataService.candleCache[`${pair}_H1`] = newHistory.h1;
        const next = await runtime.cycle();
        expect(next.signal).toBe('BUY');
        expect(next.setupId).not.toBe(first.setupId);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(2);
        expect(runtime.engine.openTrades.size).toBe(1);
    });

    test('monitor samples a post-close executable quote before reconciling broker TP', async () => {
        const state = await fixture(); state.setQuote(1);
        const runtime = await state.boot(); await runtime.cycle();
        const trade = [...runtime.engine.openTrades.values()][0];
        const stopDistance = trade.brokerReconciliationPayload.liveRuntime.initialStopDistance;
        trade.breakevenHit = true;
        state.advance(120000);
        const closeTime = Date.now();
        state.brokerTrades.delete(trade.oandaTradeId);
        oanda.getTrade = jest.fn(async () => ({trade: {
            id: trade.oandaTradeId, instrument: pair, state:'CLOSED',
            averageClosePrice: String(trade.takeProfitPrice), realizedPL:'0.3', financing:'0', commission:'0',
            closeTime: new Date(closeTime).toISOString(),
            takeProfitOrder:{state:'FILLED', price:String(trade.takeProfitPrice)}
        }}));
        state.advance(10000);
        state.setQuote(1, (trade.entryPrice + stopDistance * 2 - state.history.reference) / 0.0001);
        await state.dataService.fetchAllPrices();
        await runtime.engine.monitorPositions();
        expect(runtime.engine.openTrades.size).toBe(0);
        const saved = state.tradeRepository.trades[0];
        expect(saved.exitReason).toBe('TAKE_PROFIT');
        expect(saved.exitTime).toBe(closeTime);
        expect(saved.brokerReconciliationPayload.sampledExcursion.lastObservedAt).toBeGreaterThan(saved.exitTime);
        expect(saved.brokerReconciliationPayload.sampledExcursion.maxFavorableR).toBeGreaterThan(1.9);
    });
});
