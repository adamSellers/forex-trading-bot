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

// Completed BUY bars contain a real break/retest/confirmation; H1 is
// independently synthetic. Larger ranges let 1.3-pip spreads reach the
// separate 1.2-pip execution limit. No indicator or policy guard is mocked.
function candles(closeTime = startTime, direction = 1, legacyBuy = false) {
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
    if (direction > 0 && !legacyBuy) {
        const level = Math.max(...m15.slice(-11, -3).map((bar) => bar.high));
        const ending = [
            { open: level - .001, high: level + .003, low: level - .002, close: level + .002 },
            { open: level + .002, high: level + .003, low: level - .002, close: level + .001 },
            { open: level + .001, high: level + .005, low: level + .0005, close: level + .004 },
        ];
        ending.forEach((prices, i) => Object.assign(m15[m15.length - 3 + i], prices));
    }
    if (direction > 0) m15.forEach((bar) => { bar.bid = Object.fromEntries(['open', 'high', 'low', 'close']
        .map((key) => [key, Number((bar[key] - .00004).toFixed(5))])); });
    if (direction < 0) {
        for (const series of [m15, h1]) {
            for (const bar of series) {
                const { high, low } = bar;
                Object.assign(bar, { open: 2.6 - bar.open, close: 2.6 - bar.close,
                    high: 2.6 - low, low: 2.6 - high });
            }
        }
    }
    return { m15, h1, reference: m15.at(-1).close };
}

async function fixture({ direction = 1, legacyBuy = false } = {}) {
    let now = startTime;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const history = candles(startTime, direction, legacyBuy);
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
        const bid = Number((mid - width * 0.00005).toFixed(5));
        return { instrument, tradeable: true, time: new Date(now).toISOString(),
            bids: [{ price: bid.toFixed(5), liquidity: 1000000 }],
            asks: [{ price: (bid + Math.round(width * 10) * .00001).toFixed(5), liquidity: 1000000 }],
        };
    };
    const brokerTrades = new Map();
    let nextBrokerId = 1;
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
        const id = String(nextBrokerId++);
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
        if (options.takeProfitPrice !== undefined) trade.takeProfitOrder.price = String(options.takeProfitPrice);
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

describe('reconsidering a locally rejected setup through the live orchestration', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { liveEngines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });

    test.each([false, true])('a genuine spread rejection can fill once on the next regular scan (restart=%s)', async (restart) => {
        const state = await fixture();
        let runtime = await state.boot();
        const first = await runtime.cycle();
        expect(first.signal).toBe('BUY');
        expect(state.entryDecisionRepository.decisions[0]).toMatchObject({ rejectionCode: 'SPREAD_TOO_WIDE', canReconsider: true });
        expect(state.entryDecisionRepository.decisions[0].spreadPips).toBeCloseTo(1.3, 8);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.setQuote(1);
        state.advance(59_000);
        if (restart) { runtime.engine.stop(); runtime = await state.boot(); }
        expect((await runtime.cycle()).reasonCode).toBe('COOLDOWN_RATE_LIMIT');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.advance(1_000);
        const retry = await runtime.cycle();
        expect(retry.signal).toBe('BUY');
        expect(retry.setupId).toBe(first.setupId);
        expect(retry.entryAttemptId).not.toBe(first.entryAttemptId);
        expect(retry.entryReferencePrice).toBe(first.entryReferencePrice);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        expect(state.entryDecisionRepository.decisions.at(-1).rejectionReason).toBeUndefined();
        expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('FILLED');
        expect([...state.intents.values()][0].status).toBe('COMPLETED');
        state.advance();
        expect((await runtime.cycle()).strategyContext.buyRetest).toMatchObject({ ready: false, classification: 'EPISODE_ALREADY_TRADED' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('a rejection that cannot be persisted cannot authorize reconsideration', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        const rejected = jest.fn();
        runtime.engine.on('entryRejected', rejected);
        state.entryDecisionRepository.updateDecision.mockRejectedValueOnce(new Error('Simulated durable write failure'));
        await runtime.cycle();
        expect(state.entryDecisionRepository.decisions[0].outcome).toBe('PENDING');
        expect(rejected).not.toHaveBeenCalled();
        state.setQuote(1); state.advance();
        expect((await runtime.cycle()).signal).toBe('COOLDOWN');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test('a strategy HOLD between attempts prevents entry without discarding eligible reconsideration', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        const first = await runtime.cycle();
        state.advance(); state.setQuote(12);
        const held = await runtime.cycle();
        expect(held.signal).toBe('HOLD');
        expect(held.reasonCode).toBe('INTRADAY_MOMENTUM_COST_TOO_HIGH');
        expect(state.entryDecisionRepository.decisions).toHaveLength(1);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.advance(); state.setQuote(1);
        const retry = await runtime.cycle();
        expect(retry.signal).toBe('BUY');
        expect(retry.setupId).toBe(first.setupId);
        expect(retry.entryReferencePrice).toBe(first.entryReferencePrice);
        expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('FILLED');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('a rejected confirmation expires on the next completed candle without reusing the old retest', async () => {
        const state = await fixture(), runtime = await state.boot();
        const first = await runtime.cycle();
        state.advance(900_000); state.setQuote(1);
        const previous = state.history.m15.at(-1);
        const next = { ...previous, time: new Date(startTime).toISOString(),
            open: previous.close - .0008, close: previous.close + .0001, low: previous.close - .0009 };
        next.bid = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, Number((next[key] - .00004).toFixed(5))]));
        state.dataService.candleCache[`${pair}_M15`] = [...state.history.m15, next];
        const held = await runtime.cycle();
        expect(held).toMatchObject({ signal: 'HOLD', strategyContext: { buyRetest: { ready: false,
            episodeId: first.strategyContext.buyRetest.episodeId, classification: 'WAIT_FOR_RETEST', retest: null, confirmation: null } } });
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test.each([false, true])('the original 1.5-pip reference survives reconsideration (restart=%s)', async (restart) => {
        const state = await fixture();
        let runtime = await state.boot();
        const first = await runtime.cycle();
        state.setQuote(1, 5.5);
        state.advance();
        if (restart) { runtime.engine.stop(); runtime = await state.boot(); }
        const retry = await runtime.cycle();
        expect(retry.signal).toBe('BUY');
        expect(retry.entryReferencePrice).toBe(first.entryReferencePrice);
        expect(retry.currentPrice - first.currentPrice).toBeCloseTo(0.00055);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({ rejectionCode: 'ENTRY_PRICE_DEVIATION' });
    });

    test('an outstanding attempt and a late rejection acknowledgement cannot open another attempt', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        let oldRejection;
        runtime.engine.on('entryRejected', (event) => { oldRejection = event; });
        await runtime.cycle();
        expect(oldRejection.canReconsider).toBe(true);
        let resolveFill;
        oanda.placeMarketOrder.mockImplementation((...args) => new Promise((resolve) => {
            resolveFill = () => resolve(state.fill(...args));
        }));
        state.advance(); state.setQuote(1);
        await runtime.cycle({ wait: false });
        for (let turn = 0; !resolveFill && turn < 100; turn += 1) await new Promise(setImmediate);
        expect(resolveFill).toBeDefined();
        await runtime.coordinator.handleEntryRejection(oldRejection);
        state.advance();
        expect((await runtime.cycle({ wait: false })).signal).toBe('COOLDOWN');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        resolveFill(); await runtime.drain();
        state.advance();
        expect((await runtime.cycle()).strategyContext.buyRetest).toMatchObject({ ready: false, classification: 'EPISODE_ALREADY_TRADED' });
    });

    test('an ambiguous broker submission is never reopened as a fresh attempt', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        state.setQuote(1);
        oanda.placeMarketOrder.mockRejectedValue(Object.assign(new Error('Response lost'), { ambiguous: true }));
        await runtime.cycle();
        expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('PENDING');
        expect([...state.intents.values()][0].status).toBe('RECOVERY_PENDING');
        state.advance();
        expect((await runtime.cycle()).signal).toBe('COOLDOWN');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('a nonpricing risk rejection remains consumed on subsequent scans', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        const runId = runtime.coordinator.getActiveLiveSession().run.runId;
        [1, 2, 3].forEach((hours) => state.tradeRepository.trades.push({
            id: `loss-${hours}`, isOpen: false, pnlAud: -0.1, ownerRunId: runId, exitTime: Date.now() - hours * 3_600_000,
        }));
        state.setQuote(1);
        await runtime.cycle();
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({ rejectionCode: 'EXPOSURE_LIMIT', canReconsider: false });
        state.advance();
        expect((await runtime.cycle()).signal).toBe('COOLDOWN');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test.each(['pending', 'missing-reference'])('restart cannot reopen a persisted %s observation', async (kind) => {
        const state = await fixture();
        let runtime = await state.boot();
        await runtime.cycle();
        const row = state.entryDecisionRepository.decisions[0];
        if (kind === 'pending') Object.assign(row, { outcome: 'PENDING', stage: 'RECEIVED', canReconsider: false });
        else delete row.entryReferencePrice;
        runtime.engine.stop();
        state.setQuote(1); state.advance();
        runtime = await state.boot();
        expect((await runtime.cycle()).signal).toBe('COOLDOWN');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });
});

describe('durable same-direction loss reset through live orchestration', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { liveEngines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });

    function addClosed(state, overrides = {}) {
        const trade = {
            id: 'prior-normal-stop', oandaTradeId: 'broker-normal-stop', instrument: pair,
            mode: 'live', side: 'BUY', isOpen: false, exitReason: 'STOP_LOSS', pnlAud: -0.1,
            entryType: 'M15_RANGE_BREAKOUT', activeStopType: 'INITIAL_STOP', breakevenHit: false,
            entryTime: startTime - 4 * 3_600_000, exitTime: startTime - 90 * 60_000,
            brokerClosedAt: startTime - 90 * 60_000,
            ownerRunId: 'older-release', runId: 'older-release', ...overrides,
        };
        trade.brokerReconciliationPayload = { close: { trade: {
            id: trade.oandaTradeId, state: 'CLOSED', closeTime: new Date(trade.brokerClosedAt).toISOString(),
        } } };
        state.tradeRepository.trades.push(trade);
        return trade;
    }

    function makeNeutral(bar) {
        bar.close -= 0.035;
        bar.low = Math.min(bar.low, bar.close - 0.001);
    }

    function addUntimedClosed(state, overrides = {}) {
        const trade = addClosed(state, { reconciliationStatus: 'RECONCILED',
            selectionId: 'original-selection', lastBrokerSyncAt: startTime - 80 * 60_000,
            ...overrides });
        trade.brokerReconciliationPayload = { close: { trade: { id: trade.oandaTradeId,
            state: 'CLOSED', averageClosePrice: '1.30000', realizedPL: '-0.1' } },
            liveRuntime: { entryTelemetry: { original: true } } };
        return trade;
    }

    test.each([false, true])('normal broker sync recovers a historical armed stop and preserves its outcome; valid H1 reset still requires a BUY retest (missing pattern=%s)', async (legacyBuy) => {
        const state = await fixture({ legacyBuy }); state.setQuote(1);
        const historical = addUntimedClosed(state, { oandaTradeId: '2858',
            entryTime: Date.parse('2026-05-28T00:00:00Z'),
            exitTime: Date.parse('2026-05-28T00:55:40Z'), brokerClosedAt: Date.parse('2026-05-28T00:55:40Z') });
        const original = copy(historical);
        // Authentic minimal GET capture; historical accounting and market bars
        // are independent fixtures, not reconstructed broker fills.
        const tradeDetails = { trade: { id: '2858', instrument: 'GBP_USD', state: 'CLOSED',
            closeTime: '2026-05-28T00:55:35.281739993Z' } };
        oanda.getTrade.mockResolvedValue(tradeDetails);
        makeNeutral(state.history.h1.at(-2));
        const runtime = await state.boot();
        const restored = state.tradeRepository.trades.find(trade => trade.id === historical.id);
        expect({ ...restored, brokerReconciliationPayload: original.brokerReconciliationPayload }).toEqual(original);
        expect(restored.brokerReconciliationPayload).toEqual({ ...original.brokerReconciliationPayload,
            closeTimeEvidence: { brokerTradeId: historical.oandaTradeId,
                confirmedBrokerClosedAt: Date.parse(tradeDetails.trade.closeTime), source: 'BROKER_CLOSED_TRADE' },
            historicalCloseTimeRecovery: { recoveredAt: startTime, tradeDetails } });
        const signal = await runtime.cycle();
        if (legacyBuy) {
            expect(signal.signal).toBe('HOLD');
            expect(signal.strategyContext.buyRetest.ready).toBe(false);
            expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        } else {
            expect(signal).toMatchObject({ signal: 'BUY', strategyContext: {
                lossReset: { allowed: true, classification: 'H1_RESET_REARMED' }, buyRetest: { ready: true },
            } });
            expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        }
        await runtime.engine.syncWithOanda({ throwOnError: true });
        expect(oanda.getTrade).toHaveBeenCalledTimes(1);
        expect(oanda.getTrade).toHaveBeenCalledWith(historical.oandaTradeId);
    });

    test.each(['wrong-id', 'wrong-instrument', 'wrong-side', 'open', 'missing-time', 'lookup-failure', 'persist-failure'])('historical close-time recovery remains blocked for %s through coordinator and execution', async (failure) => {
        const state = await fixture(); state.setQuote(1);
        const historical = addUntimedClosed(state);
        const original = copy(historical);
        makeNeutral(state.history.h1.at(-2));
        const details = { trade: { id: historical.oandaTradeId, state: 'CLOSED',
            closeTime: String(historical.brokerClosedAt / 1000) } };
        if (failure === 'wrong-id') details.trade.id = 'another';
        if (failure === 'wrong-instrument') details.trade.instrument = 'AUD_USD';
        if (failure === 'wrong-side') details.trade.initialUnits = '-10';
        if (failure === 'open') details.trade.state = 'OPEN';
        if (failure === 'missing-time') delete details.trade.closeTime;
        oanda.getTrade.mockResolvedValue(details);
        if (failure === 'lookup-failure') oanda.getTrade.mockRejectedValue(new Error('broker lookup unavailable'));
        if (failure === 'persist-failure') state.tradeRepository.updateTrade.mockRejectedValue(new Error('write unavailable'));
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'HOLD', strategyContext: { lossReset: {
            allowed: false, classification: 'LOSS_RESET_EVIDENCE_UNAVAILABLE',
        } } });
        expect(state.tradeRepository.trades.find(trade => trade.id === historical.id)).toEqual(original);
        expect(runtime.engine.brokerStateUncertain).toBe(false);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test('historical hydration targets only the latest armed missing-time anchor per active pair and side', async () => {
        const state = await fixture(); state.setQuote(1);
        const latest = addUntimedClosed(state);
        addUntimedClosed(state, { id: 'older', oandaTradeId: 'older-broker',
            brokerClosedAt: startTime - 5 * 3_600_000, exitTime: startTime - 5 * 3_600_000 });
        addUntimedClosed(state, { id: 'another-pair', oandaTradeId: 'another-pair-broker', instrument: 'AUD_USD' });
        addUntimedClosed(state, { id: 'not-a-stop', oandaTradeId: 'another-side-broker', side: 'SELL', exitReason: 'SESSION_CLOSE' });
        oanda.getTrade.mockResolvedValue({ trade: { id: latest.oandaTradeId, state: 'CLOSED',
            closeTime: String(latest.brokerClosedAt / 1000) } });
        await state.boot();
        expect(oanda.getTrade).toHaveBeenCalledTimes(1);
        expect(oanda.getTrade).toHaveBeenCalledWith(latest.oandaTradeId);
    });

    test('recovering a missing historical close time does not bypass the required H1 reset', async () => {
        const state = await fixture(); state.setQuote(1);
        const historical = addUntimedClosed(state);
        oanda.getTrade.mockResolvedValue({ trade: { id: historical.oandaTradeId, state: 'CLOSED',
            closeTime: String(historical.brokerClosedAt / 1000) } });
        const runtime = await state.boot();
        expect((await runtime.cycle())).toMatchObject({ signal: 'HOLD', strategyContext: { lossReset: {
            allowed: false, classification: 'WAIT_FOR_H1_RESET',
        } } });
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test('a same-side initial stop from an older release blocks a new valid M15 setup', async () => {
        const state = await fixture(); addClosed(state); state.setQuote(1);
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_WAIT_FOR_H1_RESET' });
        expect(signal.strategyContext.lossReset.anchor).toMatchObject({ brokerTradeId: 'broker-normal-stop', side: 'BUY' });
        expect(runtime.coordinator.signalRepository.saveBatch).toHaveBeenCalledWith([signal]);
        expect([...state.persistedState.keys()].some((key) => key.startsWith('intraday-loss-reset:'))).toBe(true);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test.each([{ side: 'SELL' }, { instrument: 'USD_JPY' }])('a stop in another side or pair does not block a healthy normal entry: %j', async (prior) => {
        const state = await fixture(); addClosed(state, prior); state.setQuote(1);
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'BUY', strategyContext: {
            lossReset: { allowed: true, classification: 'NO_LOSS_RESET_REQUIRED' },
        } });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('actual completed neutral and later qualifying H1 bars permit the next valid M15 entry', async () => {
        const state = await fixture(); addClosed(state); state.setQuote(1);
        makeNeutral(state.history.h1.at(-2));
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'BUY', strategyContext: { lossReset: {
            allowed: true, classification: 'H1_RESET_REARMED',
            state: { resetAt: startTime - 3_600_000, rearmedAt: startTime },
        } } });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const trade = state.tradeRepository.trades.find((candidate) => candidate.isOpen);
        expect(trade.brokerReconciliationPayload.liveRuntime.entryTelemetry.strategyContext.lossReset)
            .toMatchObject({ allowed: true, classification: 'H1_RESET_REARMED' });
    });

    test('a HOLD persists neutral proof through restart after that bar leaves the H1 cache', async () => {
        const state = await fixture(); addClosed(state, {
            brokerClosedAt: startTime - 30 * 60_000, exitTime: startTime - 30 * 60_000,
        }); state.setQuote(1);
        makeNeutral(state.history.h1.at(-1));
        let runtime = await state.boot();
        expect((await runtime.cycle()).signal).toBe('HOLD');
        const proof = [...state.persistedState.entries()].find(([key]) => key.startsWith('intraday-loss-reset:'))[1];
        expect(proof).toMatchObject({ resetAt: startTime, rearmedAt: null });
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        runtime.engine.stop();
        const elapsed = 7 * 24 * 3_600_000;
        state.advance(elapsed);
        const next = candles(startTime + elapsed);
        expect(Date.parse(next.h1[0].time)).toBeGreaterThan(startTime);
        state.dataService.candleCache[`${pair}_M15`] = next.m15;
        state.dataService.candleCache[`${pair}_H1`] = next.h1;
        runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'BUY', strategyContext: { lossReset: {
            allowed: true, classification: 'H1_RESET_REARMED', state: { resetAt: startTime },
        } } });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test.each(['getState', 'setState'])('failure to %s required proof cannot authorize an otherwise rearmed entry', async (method) => {
        const state = await fixture(); addClosed(state); state.setQuote(1);
        makeNeutral(state.history.h1.at(-2));
        const original = state.brokerLifecycleRepository[method].getMockImplementation();
        state.brokerLifecycleRepository[method].mockImplementation(async (key, ...args) => {
            if (key.startsWith('intraday-loss-reset:')) throw new Error('state storage unavailable');
            return original(key, ...args);
        });
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'HOLD', strategyContext: { lossReset: {
            allowed: false, classification: 'LOSS_RESET_EVIDENCE_UNAVAILABLE',
        } } });
        expect(runtime.engine.isRunning).toBe(true);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
    });

    test('a same-side stop discovered at execution invalidates a queued signal even when the latest opposite-side close is unchanged', async () => {
        const state = await fixture(); state.setQuote(1);
        addClosed(state, { id: 'latest-opposite-close', oandaTradeId: 'latest-opposite-broker', side: 'SELL',
            exitReason: 'SESSION_CLOSE', brokerClosedAt: startTime - 60_000, exitTime: startTime - 60_000 });
        const runtime = await state.boot();
        const sync = runtime.engine._syncWithOanda.bind(runtime.engine);
        jest.spyOn(runtime.engine, '_syncWithOanda').mockImplementation(async (options) => {
            await sync(options);
            addClosed(state, { brokerClosedAt: startTime - 120_000, exitTime: startTime - 120_000 });
        });
        const signal = await runtime.cycle();
        expect(signal.strategyContext.lossReset).toMatchObject({ allowed: true, anchor: null });
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({
            rejectionCode: 'INVALID_SIGNAL', canReconsider: false,
            rejectionContext: { phase: 'LOSS_RESET_REVALIDATION' },
        });
    });

    test('a queued signal cannot substitute an older candle close for its current BUY confirmation', async () => {
        const state = await fixture(); addClosed(state); state.setQuote(1);
        makeNeutral(state.history.h1.at(-2));
        const runtime = await state.boot();
        const execute = runtime.engine._executeEntry.bind(runtime.engine);
        jest.spyOn(runtime.engine, '_executeEntry').mockImplementation((signal, ...args) => execute({
            ...signal, strategyContext: { ...signal.strategyContext, signalCandleCloseTime: startTime - 3_600_000 },
        }, ...args));
        const signal = await runtime.cycle();
        expect(signal.strategyContext.lossReset.allowed).toBe(true);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({
            rejectionCode: 'INVALID_SIGNAL', rejectionContext: { phase: 'BUY_RETEST_REVALIDATION' },
        });
    });

    test.each([
        { fade: false, unavailable: false },
        { fade: false, unavailable: true },
        { fade: true, unavailable: false },
    ])('loss-reset denial preserves owned normal reversal exits and fade protection: %j', async ({ fade, unavailable }) => {
        const state = await fixture(); state.setQuote(1);
        const runtime = await state.boot();
        await state.dataService.fetchAllPrices();
        const run = runtime.coordinator.getActiveLiveSession().run;
        await runtime.engine.executeEntry({ symbol: pair, signal: 'SELL', signalClass: 'ACTIONABLE',
            intent: 'ENTER_SHORT', currentPrice: state.history.reference, strength: 50,
            atr: 0.0016, atrPips: 16, entryType: fade ? 'M15_POST_TP_FADE' : 'M15_RANGE_BREAKOUT',
            strategy: 'intraday_momentum', mode: 'live', runId: run.runId, selectionId: run.selectionId,
            configHash: run.configHash, tradePlan: { stopPips: 20,
                stopLossPrice: state.history.reference + 0.002,
                takeProfitPrice: state.history.reference - 0.003, targetRiskMultiple: 1.5 },
        }, { ...state.configService.get(), liveReleaseVersion: 'm15-intraday-v4.2',
            executionPolicyVersion: 'intraday-risk-v4.2' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const owned = state.tradeRepository.trades.find((trade) => trade.isOpen);
        const broker = copy(state.brokerTrades.get(owned.oandaTradeId));
        addClosed(state);
        if (unavailable) {
            const getState = state.brokerLifecycleRepository.getState.getMockImplementation();
            state.brokerLifecycleRepository.getState.mockImplementation(async (key) => {
                if (key.startsWith('intraday-loss-reset:')) throw new Error('loss proof read unavailable');
                return getState(key);
            });
        }
        oanda.closeTrade.mockImplementation(async (id) => {
            state.brokerTrades.delete(id);
            return { orderFillTransaction: { id: 'normal-reversal-close', time: String(Date.now() / 1000),
                price: String(state.history.reference), tradesClosed: [{ tradeID: id, realizedPL: '0' }] } };
        });
        oanda.getTrade.mockResolvedValue({ trade: { ...broker, state: 'CLOSED', currentUnits: '0',
            closeTime: new Date(Date.now()).toISOString(), averageClosePrice: String(state.history.reference),
            realizedPL: '0', financing: '0', stopLossOrder: { ...broker.stopLossOrder, state: 'CANCELLED' },
            takeProfitOrder: { ...broker.takeProfitOrder, state: 'CANCELLED' },
        } });
        const signal = await runtime.cycle();
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        if (fade) {
            expect(signal.signal).toBe('HOLD');
            expect(oanda.closeTrade).not.toHaveBeenCalled();
            expect(runtime.engine.openTrades.size).toBe(1);
        } else {
            expect(signal).toMatchObject({ signal: 'BUY', entryType: 'EXIT_ONLY', intent: 'EXIT_SHORT_ONLY' });
            expect(oanda.closeTrade).toHaveBeenCalledWith(owned.oandaTradeId);
            expect(runtime.engine.openTrades.size).toBe(0);
            expect(state.tradeRepository.trades.find((trade) => trade.id === owned.id))
                .toMatchObject({ isOpen: false, exitReason: 'SIGNAL_REVERSAL' });
        }
    });
});

// These cases use real indicators, coordinator, signal generator, execution and
// persistence orchestration. Only the broker transport and durable stores are fixtures.
describe('BUY breakout episodes and disabled protected-exit fades through live orchestration', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { liveEngines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });

    function addParent(state, { side = 'SELL', exitReason = 'TAKE_PROFIT' } = {}) {
        const trade = { id: 'normal-parent', oandaTradeId: 'prior-3381', instrument: pair,
            mode: 'live', side, isOpen: false, exitReason, pnlAud: 0.2,
            entryType: 'M15_RANGE_BREAKOUT', brokerClosedAt: startTime - 180_000,
            exitTime: startTime - 180_000, entryTime: startTime - 3_600_000,
            ownerRunId: 'previous-release', runId: 'previous-release' };
        trade.brokerReconciliationPayload = { close: { trade: {
            id: trade.oandaTradeId, state: 'CLOSED', closeTime: new Date(trade.brokerClosedAt).toISOString(),
        } } };
        state.tradeRepository.trades.push(trade);
        return trade;
    }

    test.each([1, -1])('post-TP fade direction %s is a persisted HOLD before and after restart', async (direction) => {
        const state = await fixture({ direction }); addParent(state, { side: direction > 0 ? 'BUY' : 'SELL' }); state.setQuote(1);
        let runtime = await state.boot();
        for (let attempt = 0; attempt < 2; attempt++) {
            const signal = await runtime.cycle();
            expect(signal).toMatchObject({ signal: 'HOLD', entryType: null,
                reasonCode: direction > 0 ? 'INTRADAY_MOMENTUM_SELL_RETEST_REQUIRED' : 'INTRADAY_MOMENTUM_BUY_RETEST_REQUIRED',
                strategyContext: { reentry: { classification: 'POST_TP_FADE', anchor: { tradeId: 'normal-parent' } } } });
            expect(runtime.coordinator.signalRepository.saveBatch).toHaveBeenCalledWith([signal]);
            expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
            expect(state.intents.size).toBe(0);
            runtime.engine.stop(); state.advance(); runtime = await state.boot();
        }
    });

    test('breakeven without a fresh touch remains a HOLD, while an ordinary eligible BUY can fill', async () => {
        const state = await fixture(); addParent(state, { side: 'BUY', exitReason: 'BREAKEVEN_STOP' }); state.setQuote(1);
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_WAIT_FOR_FRESH_PULLBACK' });
        expect(runtime.coordinator.signalRepository.saveBatch).toHaveBeenCalledWith([signal]);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.tradeRepository.trades[0].exitReason = 'SESSION_CLOSE';
        state.advance(); expect((await runtime.cycle()).signal).toBe('BUY');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test.each([false, true])('v6 preserves the legacy SELL owner exit/management path (owned fade=%s)', async (fade) => {
        const state = await fixture({ legacyBuy: true }); state.setQuote(.4);
        const runtime = await state.boot();
        await state.dataService.fetchAllPrices();
        const run = runtime.coordinator.getActiveLiveSession().run;
        // A real broker fill under the explicit historical entry policy models
        // the position inherited by v6; no synthetic local trade row is added.
        await runtime.engine.executeEntry({ symbol: pair, signal: 'SELL', signalClass: 'ACTIONABLE',
            intent: 'ENTER_SHORT', currentPrice: state.history.reference, strength: 50,
            atr: .0016, atrPips: 16, entryType: fade ? 'M15_POST_TP_FADE' : 'M15_RANGE_BREAKOUT',
            strategy: 'intraday_momentum', mode: 'live', runId: run.runId, selectionId: run.selectionId,
            configHash: run.configHash, tradePlan: { stopPips: 20,
                stopLossPrice: state.history.reference + .002, takeProfitPrice: state.history.reference - .003,
                targetRiskMultiple: 1.5 } }, { ...state.configService.get(), liveReleaseVersion: 'm15-intraday-v4.2',
            executionPolicyVersion: 'intraday-risk-v4.2' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const owned = state.tradeRepository.trades.find(trade => trade.isOpen);
        if (fade) {
            state.advance(); state.setQuote(.4, -25);
            await state.dataService.fetchAllPrices(); await runtime.engine.monitorPositions();
            expect(oanda.modifyTrade).toHaveBeenCalled();
            expect(state.tradeRepository.trades.find(trade => trade.id === owned.id).breakevenHit).toBe(true);
            state.setQuote(.4, 0); state.advance();
        }
        const broker = copy(state.brokerTrades.get(owned.oandaTradeId));
        oanda.closeTrade.mockImplementation(async id => {
            state.brokerTrades.delete(id);
            return { orderFillTransaction: { id: 'legacy-owner-close', time: String(Date.now() / 1000),
                price: String(state.history.reference), tradesClosed: [{ tradeID: id, realizedPL: '0' }] } };
        });
        oanda.getTrade.mockResolvedValue({ trade: { ...broker, state: 'CLOSED', currentUnits: '0',
            closeTime: new Date(Date.now()).toISOString(), averageClosePrice: String(state.history.reference),
            realizedPL: '0', financing: '0', stopLossOrder: { ...broker.stopLossOrder, state: 'CANCELLED' },
            takeProfitOrder: { ...broker.takeProfitOrder, state: 'CANCELLED' } } });
        const signal = await runtime.cycle();
        expect(signal.strategyContext.buyRetest.ready).toBe(false);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        if (fade) {
            expect(signal.signal).toBe('HOLD'); expect(oanda.closeTrade).not.toHaveBeenCalled();
            expect(runtime.engine.openTrades.size).toBe(1);
            // A queued historical fade cannot displace that protected owner.
            await runtime.engine.processSignal({ ...signal, signal: 'BUY', intent: 'ENTER_LONG',
                entryType: 'M15_POST_TP_FADE', entryAttemptId: 'historical-fade-incoming' });
            expect(oanda.closeTrade).not.toHaveBeenCalled(); expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
            expect(runtime.engine.openTrades.size).toBe(1);
        } else {
            expect(signal).toMatchObject({ signal: 'BUY', entryType: 'EXIT_ONLY', intent: 'EXIT_SHORT_ONLY', tradePlan: null });
            expect(oanda.closeTrade).toHaveBeenCalledWith(owned.oandaTradeId);
            expect(runtime.engine.openTrades.size).toBe(0);
            expect(state.tradeRepository.trades.find(trade => trade.id === owned.id)).toMatchObject({ isOpen: false, exitReason: 'SIGNAL_REVERSAL' });
        }
    });

    test.each([false, true])('a generated BUY fill and broker-confirmed BE keep the episode consumed; observed cancellation allows a distinct later fill (missing state=%s)', async (removeState) => {
        const state = await fixture(); state.setQuote(1);
        let runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'BUY', entryType: 'M15_BREAK_RETEST_CONFIRMATION', strategyVersion: '1.4.0' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const filled = state.tradeRepository.trades.find(trade => trade.isOpen);
        const episodeId = signal.strategyContext.buyRetest.episodeId;
        expect(filled.brokerReconciliationPayload.liveRuntime.entryTelemetry.strategyContext.buyRetest.episodeId).toBe(episodeId);
        const initialStop = filled.stopLossPrice;
        const originalMid = state.history.reference;
        state.advance();
        const activation = filled.entryPrice + (filled.entryPrice - initialStop) + .0002;
        state.setQuote(1, (activation - originalMid) / .0001);
        await state.dataService.fetchAllPrices();
        await runtime.engine.monitorPositions();
        expect(oanda.modifyTrade).toHaveBeenCalled();
        const protectedTrade = state.tradeRepository.trades.find(trade => trade.id === filled.id);
        expect(protectedTrade).toMatchObject({ breakevenHit: true, stopLossPrice: filled.entryPrice });
        const broker = copy(state.brokerTrades.get(filled.oandaTradeId));
        state.advance(); state.brokerTrades.delete(filled.oandaTradeId);
        oanda.getTrade.mockResolvedValue({ trade: { ...broker, state: 'CLOSED', currentUnits: '0',
            closeTime: new Date(Date.now()).toISOString(), averageClosePrice: String(filled.entryPrice), realizedPL: '0', financing: '0',
            takeProfitOrder: { ...broker.takeProfitOrder, state: 'CANCELLED' }, stopLossOrder: { ...broker.stopLossOrder, state: 'FILLED' } } });
        await runtime.engine.syncWithOanda({ throwOnError: true });
        expect(state.tradeRepository.trades.find(trade => trade.id === filled.id))
            .toMatchObject({ isOpen: false, exitReason: 'BREAKEVEN_STOP', brokerClosedAt: Date.now(), pnlAud: 0 });
        runtime.engine.stop();
        if (removeState) for (const key of state.persistedState.keys()) if (key.startsWith('intraday-buy-retest:')) state.persistedState.delete(key);
        state.setQuote(1, 0); state.advance(); runtime = await state.boot();
        const after = await runtime.cycle();
        expect(after.signal).toBe('HOLD');
        expect(after.strategyContext.buyRetest).toMatchObject({ ready: false, classification: 'EPISODE_ALREADY_TRADED', episodeId });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);

        const level = signal.strategyContext.buyRetest.breakout.level;
        const append = (prices) => {
            const previous = state.dataService.candleCache[`${pair}_M15`].at(-1);
            const time = Date.parse(previous.time) + 900_000;
            const bar = { ...prices, complete: true, time: new Date(time).toISOString(), bid: Object.fromEntries(['open', 'high', 'low', 'close']
                .map(key => [key, Number((prices[key] - .00004).toFixed(5))])) };
            state.dataService.candleCache[`${pair}_M15`].push(bar);
            state.advance(time + 900_000 - Date.now());
            // Explicit independent H1 observations, with real indicator evaluation.
            state.dataService.candleCache[`${pair}_H1`] = candles(Date.now()).h1;
            state.setQuote(1, (bar.close - originalMid) / .0001);
        };
        append({ open: level + .001, high: level + .002, low: level - .002, close: level });
        expect((await runtime.cycle()).signal).toBe('HOLD');
        expect([...state.persistedState.entries()].find(([key]) => key.startsWith('intraday-buy-retest:'))[1])
            .toMatchObject({ breakout: null, consumed: false });
        for (let index = 0; index < 8; index++) append({ open: level + (index % 2 ? .003 : .0002),
            high: level + .0045, low: level - .002, close: level + (index % 2 ? .0002 : .003) });
        const nextLevel = Math.max(...state.dataService.candleCache[`${pair}_M15`].slice(-8).map(bar => bar.high));
        append({ open: nextLevel - .001, high: nextLevel + .003, low: nextLevel - .002, close: nextLevel + .002 });
        expect((await runtime.cycle()).strategyContext.buyRetest).toMatchObject({ ready: false, classification: 'WAIT_FOR_RETEST', breakout: { level: nextLevel } });
        append({ open: nextLevel + .002, high: nextLevel + .003, low: nextLevel - .002, close: nextLevel + .001 });
        expect((await runtime.cycle()).signal).toBe('HOLD');
        expect([...state.persistedState.entries()].find(([key]) => key.startsWith('intraday-buy-retest:'))[1].retest)
            .toMatchObject({ high: nextLevel + .003 });
        append({ open: nextLevel + .001, high: nextLevel + .005, low: nextLevel + .0005, close: nextLevel + .004 });
        const second = await runtime.cycle();
        expect(second).toMatchObject({ signal: 'BUY', entryType: 'M15_BREAK_RETEST_CONFIRMATION',
            strategyContext: { reentry: { classification: 'FRESH_CONTINUATION' }, buyRetest: { ready: true } } });
        expect(second.strategyContext.buyRetest.episodeId).not.toBe(episodeId);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(2);
        expect(state.tradeRepository.trades.filter(trade => trade.isOpen)).toHaveLength(1);
        expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('FILLED');
    });
});
