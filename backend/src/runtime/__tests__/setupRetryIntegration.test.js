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

async function fixture({ direction = 1 } = {}) {
    let now = startTime;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const history = candles();
    if (direction < 0) {
        for (const series of [history.m15, history.h1]) {
            for (const bar of series) {
                const { high, low } = bar;
                Object.assign(bar, { open: 2.6 - bar.open, close: 2.6 - bar.close,
                    high: 2.6 - low, low: 2.6 - high });
            }
        }
        history.reference = history.m15.at(-1).close;
    }
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
        expect((await runtime.cycle()).signal).toBe('COOLDOWN');
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
        state.advance(); state.setQuote(5);
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

    test('a new completed candle establishes its own reference and remains executable', async () => {
        const state = await fixture();
        const runtime = await state.boot();
        const first = await runtime.cycle();
        state.advance(900_000); state.setQuote(1, 5.5);
        const nextHistory = candles(startTime + 900_000);
        state.dataService.candleCache[`${pair}_M15`] = nextHistory.m15;
        state.dataService.candleCache[`${pair}_H1`] = nextHistory.h1;
        const next = await runtime.cycle();
        expect(next.signal).toBe('BUY');
        expect(next.setupId).not.toBe(first.setupId);
        expect(next.entryReferencePrice).toBe(next.currentPrice);
        expect(next.entryReferencePrice).not.toBe(first.entryReferencePrice);
        expect(state.entryDecisionRepository.decisions.at(-1).outcome).toBe('FILLED');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
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
        expect((await runtime.cycle()).signal).toBe('COOLDOWN');
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

    test('execution cannot borrow persisted H1 requalification from after the queued M15 signal', async () => {
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
            rejectionCode: 'INVALID_SIGNAL', rejectionContext: { phase: 'LOSS_RESET_REVALIDATION' },
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
        }, state.configService.get());
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
describe('integrated protected-exit fade lifecycle', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { liveEngines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });

    function addParent(state, { side = 'BUY', exitReason = 'TAKE_PROFIT' } = {}) {
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

    test.each([1, -1])('a post-TP fade survives price rejection and restart with correct executable side/protection (direction=%s)', async (direction) => {
        const state = await fixture({ direction });
        addParent(state, { side: direction > 0 ? 'BUY' : 'SELL' });
        let runtime = await state.boot();
        const first = await runtime.cycle();
        expect(first).toMatchObject({ signal: direction > 0 ? 'SELL' : 'BUY',
            entryType: 'M15_POST_TP_FADE', reasonCode: 'INTRADAY_MOMENTUM_POST_TP_FADE' });
        expect(first.setupId).toContain('normal-parent');
        expect(first.strategyContext.reentry).toMatchObject({ classification: 'POST_TP_FADE', freshTouch: false });
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({ rejectionCode: 'SPREAD_TOO_WIDE', canReconsider: true });
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        runtime.engine.stop();
        state.setQuote(1); state.advance();
        runtime = await state.boot();
        const retry = await runtime.cycle();
        expect(retry.entryReferencePrice).toBe(first.entryReferencePrice);
        expect(retry.setupId).toBe(first.setupId);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const [instrument, units, options] = oanda.placeMarketOrder.mock.calls[0];
        expect(instrument).toBe(pair);
        expect(Math.sign(units)).toBe(-direction);
        const filled = state.tradeRepository.trades.find((trade) => trade.isOpen);
        expect(filled.side).toBe(retry.signal);
        expect(Math.sign(filled.stopLossPrice - filled.entryPrice)).toBe(direction);
        expect(Math.sign(filled.takeProfitPrice - filled.entryPrice)).toBe(-direction);
        expect(options.stopLossPrice).toBeGreaterThan(0);
        const recorded = filled.brokerReconciliationPayload.liveRuntime.entryTelemetry.strategyContext;
        expect(recorded.reentry.anchor.tradeId).toBe('normal-parent');
        expect(recorded.reentry.originalSide).toBe(direction > 0 ? 'BUY' : 'SELL');
        expect(state.entryDecisionRepository.decisions.at(-1).rsi).toBeCloseTo(recorded.m15.rsi);
        expect(filled.brokerReconciliationPayload.liveRuntime.ownerExitPolicy.config).toMatchObject({
            enableBreakeven: true, breakevenTriggerRiskMultiple: 1, timeStopHours: 6,
        });
        state.advance();
        await runtime.cycle();
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test.each(['TAKE_PROFIT', 'STOP_LOSS'])('broker-confirmed fade %s keeps the original consumed episode through restart', async (exitReason) => {
        const state = await fixture();
        addParent(state);
        state.setQuote(1);
        let runtime = await state.boot();
        await runtime.cycle();
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        const filled = state.tradeRepository.trades.find((trade) => trade.isOpen);
        const broker = state.brokerTrades.get(filled.oandaTradeId);
        state.advance();
        state.brokerTrades.delete(filled.oandaTradeId);
        const isTarget = exitReason === 'TAKE_PROFIT';
        oanda.getTrade.mockResolvedValue({ trade: { ...broker, state: 'CLOSED', currentUnits: '0',
            closeTime: new Date(Date.now()).toISOString(),
            averageClosePrice: String(isTarget ? filled.takeProfitPrice : filled.stopLossPrice),
            realizedPL: isTarget ? '0.2' : '-0.15', financing: '0',
            takeProfitOrder: { ...broker.takeProfitOrder, state: isTarget ? 'FILLED' : 'CANCELLED' },
            stopLossOrder: { ...broker.stopLossOrder, state: isTarget ? 'CANCELLED' : 'FILLED' },
        } });
        await runtime.engine.syncWithOanda({ throwOnError: true });
        const closed = state.tradeRepository.trades.find((trade) => trade.id === filled.id);
        expect(closed).toMatchObject({ isOpen: false, exitReason, brokerClosedAt: Date.now() });
        runtime.engine.stop();
        runtime = await state.boot();
        const after = await runtime.cycle();
        expect(after).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_FADE_ALREADY_TAKEN' });
        expect(after.strategyContext.reentry.anchor.tradeId).toBe('normal-parent');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('the next ordinary trend signal does not close a fade through signal reversal', async () => {
        const state = await fixture(); addParent(state); state.setQuote(1);
        const runtime = await state.boot();
        const fade = await runtime.cycle();
        const close = jest.spyOn(runtime.engine, 'executeExit');
        await runtime.engine.processSignal({ ...fade, signal: 'BUY', intent: 'ENTER_LONG',
            entryType: 'M15_RANGE_BREAKOUT', entryAttemptId: 'later-normal' });
        expect(close).not.toHaveBeenCalled();
        expect(runtime.engine.openTrades.size).toBe(1);
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({ rejectionCode: 'ALREADY_IN_POSITION' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('a fade signal cannot close an existing normal position to make room', async () => {
        const state = await fixture(); state.setQuote(1);
        const runtime = await state.boot();
        const normal = await runtime.cycle();
        const close = jest.spyOn(runtime.engine, 'executeExit');
        await runtime.engine.processSignal({ ...normal, signal: 'SELL', intent: 'ENTER_SHORT',
            entryType: 'M15_POST_TP_FADE', entryAttemptId: 'later-fade' });
        expect(close).not.toHaveBeenCalled();
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
        expect(runtime.engine.openTrades.size).toBe(1);
    });

    test('an anchor discovered during final broker reconciliation invalidates the queued fade', async () => {
        const state = await fixture(); const parent = addParent(state); state.setQuote(1);
        const runtime = await state.boot();
        const sync = runtime.engine._syncWithOanda.bind(runtime.engine);
        jest.spyOn(runtime.engine, '_syncWithOanda').mockImplementation(async (options) => {
            await sync(options);
            state.tradeRepository.trades.push({ ...parent, id: 'newly-reconciled-parent',
                oandaTradeId: 'new-broker-id', brokerClosedAt: Date.now() - 1000,
                brokerReconciliationPayload: { close: { trade: { id: 'new-broker-id', state: 'CLOSED',
                    closeTime: new Date(Date.now() - 1000).toISOString() } } } });
        });
        const signal = await runtime.cycle();
        expect(signal.strategyContext.reentry.anchor.tradeId).toBe('normal-parent');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.entryDecisionRepository.decisions.at(-1)).toMatchObject({
            rejectionCode: 'INVALID_SIGNAL', canReconsider: false,
            rejectionReason: 'Protected-exit episode changed; await the next ordinary signal scan',
        });
    });

    test('breakeven without a fresh touch is a persisted HOLD, while ordinary entries remain possible', async () => {
        const state = await fixture(); addParent(state, { exitReason: 'BREAKEVEN_STOP' }); state.setQuote(1);
        const runtime = await state.boot();
        const signal = await runtime.cycle();
        expect(signal).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_WAIT_FOR_FRESH_PULLBACK' });
        expect(runtime.coordinator.signalRepository.saveBatch).toHaveBeenCalledWith([signal]);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.tradeRepository.trades[0].exitReason = 'SESSION_CLOSE';
        state.advance();
        expect((await runtime.cycle()).signal).toBe('BUY');
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('a TP cannot repurpose the already-completed signal candle; a later completion can fade', async () => {
        const state = await fixture(); const parent = addParent(state); state.setQuote(1);
        parent.brokerClosedAt = startTime;
        parent.exitTime = startTime;
        parent.brokerReconciliationPayload.close.trade.closeTime = new Date(startTime).toISOString();
        const runtime = await state.boot();
        expect(await runtime.cycle()).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_WAIT_FOR_POST_EXIT_SIGNAL' });
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        state.advance(900_000);
        const next = candles(startTime + 900_000);
        state.dataService.candleCache[`${pair}_M15`] = next.m15;
        state.dataService.candleCache[`${pair}_H1`] = next.h1;
        // The only post-exit bar is now the signal itself; no prior bar qualifies.
        expect(await runtime.cycle()).toMatchObject({ signal: 'SELL', entryType: 'M15_POST_TP_FADE' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });
});
