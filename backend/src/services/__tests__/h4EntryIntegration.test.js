const RuntimeCoordinator = require('../../runtime/runtimeCoordinator');
const LiveTradingEngine = require('../LiveTradingEngine');
const OandaDataService = require('../OandaDataService');
const { cloneDefaultConfig } = require('../../config/tradingConfig');
const { buildOwnerRunExitPolicy } = require('../../runtime/exitPolicy');
const { evaluateMultiDayTrendEntry, evaluateChannelTrail } = require('../../strategies/multiDayTrend');
const { createMockConfigService, createMockTradeRepository, createMockEntryDecisionRepository } =
    require('../../../__tests__/helpers/mockServices');
const oanda = require('../Oandaclient');

jest.mock('../Oandaclient', () => {
    const actual = jest.requireActual('../Oandaclient');
    return {
        getPipValue: actual.getPipValue.bind(actual),
        getExecutableQuote: actual.getExecutableQuote.bind(actual),
        formatPrice: actual.formatPrice.bind(actual), formatPriceBound: actual.formatPriceBound.bind(actual),
        buildClientExtensions: actual.buildClientExtensions.bind(actual),
        initialize: jest.fn(async () => ({})), getAccountSummary: jest.fn(), getOpenTrades: jest.fn(),
        getPricing: jest.fn(), getTrade: jest.fn(), getInstrumentMetadata: jest.fn(),
        placeMarketOrder: jest.fn(), modifyTrade: jest.fn(), closeTrade: jest.fn(),
        findOrderIntent: jest.fn(async () => ({ status: 'AMBIGUOUS' })),
    };
});
jest.mock('../emailService', () => ({
    sendTradeOpenedAlert: jest.fn(async () => {}), sendTradeClosedAlert: jest.fn(async () => {}),
}));

const copy = (value) => JSON.parse(JSON.stringify(value));
const H4 = 4 * 3_600_000;
const startsAt = Date.parse('2026-10-14T13:02:00Z');
const engines = [];
const activeStatuses = new Set(['PREPARED', 'SUBMITTING', 'AMBIGUOUS', 'RECOVERY_PENDING', 'FILLED_UNPERSISTED']);

function completedBreakout(closeAt, side) {
    return Array.from({ length: 60 }, (_, index) => {
        const prices = index === 59 ? { open: 1.1003, high: 1.1027, low: 1.1002, close: 1.1025 }
            : { open: 1.1, high: 1.1005, low: 1.0995, close: 1.1 };
        if (side === 'SELL') Object.assign(prices, { open: 2.2 - prices.open, high: 2.2 - prices.low,
            low: 2.2 - prices.high, close: 2.2 - prices.close });
        return { time: new Date(closeAt - (60 - index) * H4).toISOString(), complete: true, ...prices,
            bid: Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, value - 0.00005])),
            ask: Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, value + 0.00005])) };
    });
}

async function fixture({ pairs = [{ instrument: 'EUR_USD', side: 'BUY' }] } = {}) {
    let now = startsAt;
    let spread = 1;
    let finalSpread = null;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const configService = createMockConfigService({ ...cloneDefaultConfig(), strategy: 'multi_day_trend',
        liveReleaseVersion: 'h4-channel-v2', executionPolicyVersion: 'h4-channel-risk-v2', timeframe: '4h',
        assets: pairs.map((pair) => pair.instrument), enableTrading: true, riskPerTrade: 0.0025,
        maxCapitalAtRisk: 100, maxSpreadPips: 1.2, expectedSlippagePips: 0.2, maxEntryDeviationPips: 1.5,
        trendBreakoutBars: 20, trendExitBars: 10, trendAtrPeriod: 14, trendStopAtr: 2,
        trendMaxCostToStopRatio: 0.15, enableTakeProfit: false, enableBreakeven: false,
        enableTrailingStops: false, timeStopHours: 0 });
    const data = new OandaDataService(configService.get().assets);
    const rates = { AUD: 1, EUR: 1.65, GBP: 1.9, USD: 1.5, JPY: 0.01 };
    const homeConversions = Object.entries(rates).map(([currency, rate]) => ({ currency,
        positionValue: String(rate), accountGain: String(rate), accountLoss: String(rate) }));
    for (const pair of pairs) data.candleCache[`${pair.instrument}_H4`] = completedBreakout(startsAt - 120_000, pair.side);
    const quote = (instrument, width = spread) => {
        const midpoint = data.candleCache[`${instrument}_H4`]?.at(-1)?.close || 1 / rates.USD;
        const bid = Number((midpoint - width * 0.00005).toFixed(5));
        return { instrument, tradeable: true, time: new Date(now).toISOString(),
            bids: [{ price: bid.toFixed(5), liquidity: 1_000_000 }],
            asks: [{ price: (bid + width * 0.0001).toFixed(5), liquidity: 1_000_000 }] };
    };
    data.oandaRequest = jest.fn(async () => ({ prices: data.getPricingInstruments().map((name) => quote(name)), homeConversions }));
    const tradeRepository = createMockTradeRepository();
    const decisions = createMockEntryDecisionRepository();
    decisions.getLatestForSetup = jest.fn(async () => null);
    const runs = new Map();
    const strategyRunRepository = {
        list: jest.fn(async ({ statuses }) => [...runs.values()].filter((run) => statuses.includes(run.status)).map(copy)),
        create: jest.fn(async (run) => { runs.set(run.runId, copy(run)); return copy(run); }),
        update: jest.fn(async (id, changes) => runs.set(id, { ...runs.get(id), ...copy(changes) })),
        getByRunId: jest.fn(async (id) => copy(runs.get(id) || null)),
        retireNonLiveRuns: jest.fn(async () => 0),
    };
    const intents = new Map();
    const state = new Map();
    const brokerLifecycleRepository = {
        createIntent: jest.fn(async (intent) => { intents.set(intent.intentId, copy(intent)); return copy(intent); }),
        updateIntent: jest.fn(async (id, changes) => { const value = { ...intents.get(id), ...copy(changes) };
            intents.set(id, value); return copy(value); }),
        getRecoverableIntents: jest.fn(async () => [...intents.values()].filter((intent) => activeStatuses.has(intent.status)).map(copy)),
        getIntentByBrokerTradeId: jest.fn(async (id) => [...intents.values()].find((intent) => String(intent.brokerTradeId) === String(id)) || null),
        getIntentByClientTradeId: jest.fn(async () => null),
        getOpenQuarantines: jest.fn(async () => []), resolveMissingQuarantines: jest.fn(async () => {}),
        getState: jest.fn(async (key) => copy(state.get(key) ?? null)),
        setState: jest.fn(async (key, value) => state.set(key, copy(value))),
    };
    const brokerTrades = new Map();
    const requests = [];
    let nextId = 100;
    oanda.getAccountSummary.mockImplementation(async () => ({ account: { currency: 'AUD', NAV: '100',
        balance: '100', marginAvailable: '100', marginUsed: String(brokerTrades.size) } }));
    oanda.getOpenTrades.mockImplementation(async () => ({ trades: [...brokerTrades.values()].map(copy) }));
    oanda.getTrade.mockImplementation(async (id) => ({ trade: copy(brokerTrades.get(String(id))) }));
    oanda.getInstrumentMetadata.mockImplementation(async (name) => ({ name, displayPrecision: 5, pipLocation: -4, marginRate: '0.05' }));
    oanda.getPricing.mockImplementation(async (instruments) => ({ prices: instruments.map((name) => quote(name, finalSpread ?? spread)), homeConversions }));
    const client = jest.requireActual('../Oandaclient');
    jest.spyOn(client, '_request').mockImplementation(async (method, endpoint, body) => {
        requests.push(copy({ method, endpoint, body }));
        if (method === 'POST' && endpoint.endsWith('/orders')) {
            const order = body.order;
            const price = Number(order.units) < 0 ? quote(order.instrument, finalSpread ?? spread).bids[0].price
                : quote(order.instrument, finalSpread ?? spread).asks[0].price;
            const id = String(nextId++);
            brokerTrades.set(id, { id, instrument: order.instrument, state: 'OPEN', price,
                openTime: new Date(now).toISOString(), currentUnits: order.units, initialUnits: order.units,
                stopLossOrder: { state: 'PENDING', price: order.stopLossOnFill.price },
                ...(order.takeProfitOnFill ? { takeProfitOrder: { state: 'PENDING', price: order.takeProfitOnFill.price } } : {}) });
            return { orderFillTransaction: { id: `fill-${id}`, instrument: order.instrument, units: order.units,
                price, time: String(now / 1000), tradeOpened: { tradeID: id, units: order.units, price, initialMarginRequired: '1' } } };
        }
        if (method === 'PUT' && endpoint.endsWith('/orders')) {
            const id = endpoint.match(/\/trades\/([^/]+)\/orders$/)[1];
            const trade = brokerTrades.get(id);
            if (body.stopLoss) trade.stopLossOrder = { state: 'PENDING', price: body.stopLoss.price };
            if (body.takeProfit) trade.takeProfitOrder = { state: 'PENDING', price: body.takeProfit.price };
            return { ...(body.stopLoss ? { stopLossOrderTransaction: { tradeID: id, price: body.stopLoss.price } } : {}),
                ...(body.takeProfit ? { takeProfitOrderTransaction: { tradeID: id, price: body.takeProfit.price } } : {}) };
        }
        throw new Error(`Unexpected isolated request: ${method} ${endpoint}`);
    });
    oanda.placeMarketOrder.mockImplementation((...args) => client.placeMarketOrder(...args));
    oanda.modifyTrade.mockImplementation((...args) => client.modifyTrade(...args));
    const coordinator = new RuntimeCoordinator({ configService, dataService: data, strategyRunRepository,
        tradeRepository, entryDecisionRepository: decisions, brokerLifecycleRepository,
        signalRepository: { saveBatch: jest.fn(async () => {}) } });
    await coordinator.ensureLiveSelectionInitialized();
    const engine = new LiveTradingEngine().init(configService, data, tradeRepository, coordinator, null, decisions, brokerLifecycleRepository);
    engine.getConversionRate = jest.fn(async (from, to) => rates[from] / rates[to]);
    const work = [];
    const process = engine.processQueue.bind(engine);
    jest.spyOn(engine, 'processQueue').mockImplementation(() => { const pending = process(); work.push(pending); return pending; });
    await engine.start();
    engines.push(engine);
    const drain = async () => { while (work.length) await Promise.all(work.splice(0)); };
    const scan = async ({ queued = false } = {}) => {
        await data.fetchAllPrices();
        if (queued) engine.isProcessingQueue = true;
        const signals = await coordinator.runCycle();
        if (!queued) await drain();
        return signals;
    };
    const release = async () => { engine.isProcessingQueue = false; await engine.processQueue(); await drain(); };
    return { engine, coordinator, data, configService, tradeRepository, decisions, brokerTrades,
        requests, intents, scan, drain, release, quote,
        setSpread: (value) => { spread = value; }, setFinalSpread: (value) => { finalSpread = value; },
        setNow: (value) => { now = value; } };
}

describe('H4 live entry through coordinator, current-candle validation, sizing and serialized broker orders', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => { engines.splice(0).forEach((engine) => engine.stop()); jest.restoreAllMocks(); });

    test.each(['BUY', 'SELL'])('a valid %s uses a protected 2 ATR entry with no target or breakeven', async (side) => {
        const state = await fixture({ pairs: [{ instrument: 'EUR_USD', side }] });
        const [signal] = await state.scan();
        expect(signal).toMatchObject({ signal: side, strategy: 'multi_day_trend', strategyVersion: '2.1.0',
            timeframe: '4h', entryType: 'ROLLING_CHANNEL_BREAKOUT' });
        const orders = state.requests.filter((request) => request.method === 'POST');
        expect(orders).toHaveLength(1);
        expect(orders[0].body.order).toMatchObject({ type: 'MARKET', positionFill: 'OPEN_ONLY', stopLossOnFill: { timeInForce: 'GTC' } });
        expect(orders[0].body.order.takeProfitOnFill).toBeUndefined();
        const trade = state.tradeRepository.trades[0];
        expect(trade).toMatchObject({ strategy: 'multi_day_trend', takeProfitPrice: null, breakevenHit: false,
            brokerReconciliationPayload: { liveRuntime: { entryTelemetry: { strategyContext: { version: '2.1.0' } },
                ownerExitPolicy: { kind: 'H4_CHANNEL', config: {
                enableBreakeven: false, enableTakeProfit: false, timeStopHours: 0, trendExitBars: 10 } } } } });
        expect(Math.abs(trade.entryPrice - trade.stopLossPrice)).toBeCloseTo(signal.tradePlan.stopPips * 0.0001, 4);
        expect(state.decisions.decisions.at(-1).outcome).toBe('FILLED');
        expect([...state.intents.values()][0].status).toBe('COMPLETED');
    });

    test('different pairs can fill concurrently while a same-pair repeat cannot displace the first position', async () => {
        const state = await fixture({ pairs: [{ instrument: 'EUR_USD', side: 'BUY' }, { instrument: 'GBP_USD', side: 'SELL' }] });
        const signals = await state.scan();
        expect(state.tradeRepository.trades).toHaveLength(2);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(2);
        await state.engine.processSignal({ ...signals[0], entryAttemptId: 'same-pair-repeat' });
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(2);
        expect(state.decisions.decisions.at(-1)).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'ALREADY_IN_POSITION' });
        expect(oanda.closeTrade).not.toHaveBeenCalled();
    });

    test('a stale queued candle cannot submit after a later completed H4 bar arrives', async () => {
        const state = await fixture();
        const [signal] = await state.scan({ queued: true });
        const candles = state.data.getCandles('EUR_USD', '4h');
        candles.push({ ...copy(candles.at(-1)), time: new Date(startsAt - 120_000).toISOString() });
        state.setNow(startsAt + H4);
        await state.data.fetchAllPrices();
        await state.release();
        expect(signal.signal).toBe('BUY');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.decisions.decisions.at(-1)).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'INVALID_SIGNAL' });
    });

    test('a final spread decline preserves the setup reference and may retry only through an ordinary scan', async () => {
        const state = await fixture();
        state.setFinalSpread(1.3);
        const [first] = await state.scan();
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.decisions.decisions.at(-1)).toMatchObject({ rejectionCode: 'SPREAD_TOO_WIDE', canReconsider: true });
        state.setFinalSpread(1);
        state.setNow(startsAt + 60_000);
        const [retry] = await state.scan();
        expect(retry.entryReferencePrice).toBe(first.entryReferencePrice);
        expect(retry.setupId).toBe(first.setupId);
        expect(oanda.placeMarketOrder).toHaveBeenCalledTimes(1);
    });

    test('final cost-to-stop rejection remains distinct from the absolute spread cap', async () => {
        const state = await fixture();
        for (const candle of state.data.getCandles('EUR_USD', '4h')) {
            for (const prices of [candle, candle.bid, candle.ask]) {
                for (const key of ['open', 'high', 'low', 'close']) prices[key] = 1.1 + (prices[key] - 1.1) / 10;
            }
        }
        state.setSpread(0.5);
        state.setFinalSpread(0.8);
        const [signal] = await state.scan();
        expect(signal.signal).toBe('BUY');
        expect(signal.tradePlan.stopPips).toBe(6);
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.decisions.decisions.at(-1)).toMatchObject({ rejectionCode: 'COST_TO_STOP_TOO_HIGH', canReconsider: true });
    });

    test('a quote request that crosses the Friday cutoff cannot submit an entry', async () => {
        const state = await fixture();
        state.setNow(Date.parse('2026-08-14T20:44:59Z'));
        state.data.candleCache.EUR_USD_H4 = completedBreakout(Date.parse('2026-08-14T17:00:00Z'), 'BUY');
        const pricing = oanda.getPricing.getMockImplementation();
        oanda.getPricing.mockImplementationOnce(async (...args) => {
            state.setNow(Date.parse('2026-08-14T20:45:00Z'));
            return pricing(...args);
        });
        const [signal] = await state.scan();
        expect(signal.signal).toBe('BUY');
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.decisions.decisions.at(-1)).toMatchObject({ outcome: 'REJECTED', rejectionCode: 'OUTSIDE_SESSION' });
    });

    test('pausing while the final H4 quote is awaited cancels entry without changing the paused intent', async () => {
        const state = await fixture();
        const pricing = oanda.getPricing.getMockImplementation();
        oanda.getPricing.mockImplementationOnce(async (...args) => {
            state.configService.config.enableTrading = false;
            state.configService.emit('configChanged', { enableTrading: false });
            return pricing(...args);
        });
        await state.scan();
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.configService.get().enableTrading).toBe(false);
        expect([...state.intents.values()].some((intent) => activeStatuses.has(intent.status))).toBe(false);
    });

    test('a queued H4 signal cannot reverse a legacy owner, including while entries are paused', async () => {
        const state = await fixture();
        const [signal] = await state.scan({ queued: true });
        const oldConfig = require('../../strategies/intradayMomentum').DEFAULT_INTRADAY_MOMENTUM_CONFIG;
        const legacy = { id: 'legacy', oandaTradeId: '7', instrument: 'EUR_USD', side: 'SELL', units: 10,
            strategy: 'intraday_momentum', strategyVersion: '1.4.0', isOpen: true, mode: 'live',
            ownerRunId: signal.runId, runId: signal.runId, entryTime: startsAt - 3_600_000, entryPrice: 1.1,
            stopLossPrice: 1.12, takeProfitPrice: 1.07, reconciliationStatus: 'OPEN',
            brokerReconciliationPayload: { liveRuntime: { ownerExitPolicy: buildOwnerRunExitPolicy({
                strategy: 'intraday_momentum', config: oldConfig, ownerRunId: signal.runId }) } } };
        state.tradeRepository.trades.push(legacy);
        state.brokerTrades.set('7', { id: '7', instrument: 'EUR_USD', state: 'OPEN', currentUnits: '-10',
            stopLossOrder: { state: 'PENDING', price: '1.12' }, takeProfitOrder: { state: 'PENDING', price: '1.07' } });
        await state.engine.syncOpenTrades({ throwOnError: true });
        state.configService.config.enableTrading = false;
        await state.release();
        state.configService.config.enableTrading = true;
        await state.engine.processSignal({ ...signal, entryAttemptId: 'legacy-owner-repeat' });
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        expect(oanda.placeMarketOrder).not.toHaveBeenCalled();
        expect(state.tradeRepository.trades[0]).toMatchObject({ isOpen: true, takeProfitPrice: 1.07,
            brokerReconciliationPayload: { liveRuntime: { ownerExitPolicy: { version: 1 } } } });
    });
});

describe('retained authentic broker H4 candle contract', () => {
    const observation = require('../../../../docs/reviews/evidence/2026-10-18/h4-broker-candles.json');
    afterEach(() => jest.restoreAllMocks());

    test.each(observation.rows)('$instrument preserves broker timestamps and executable sides through fetch, entry and channel evaluation', async (row) => {
        // The observation ends at Friday's close. Use its actual preceding
        // completed bar during open Friday hours and retain the next raw row as
        // a forming tail; no observed OHLC value or timestamp is fabricated.
        const response = copy(row);
        response.candles.at(-1).complete = false;
        const lastCompleted = response.candles.at(-2);
        const now = Date.parse(lastCompleted.time) + H4 + 120_000;
        jest.spyOn(Date, 'now').mockReturnValue(now);
        const data = new OandaDataService([row.instrument]);
        data.oandaRequest = jest.fn(async () => response);
        const bars = await data.fetchCandles(row.instrument, 'H4', row.candles.length);
        expect(data.oandaRequest).toHaveBeenCalledWith(expect.stringContaining(
            'granularity=H4&count=30&price=MBA&dailyAlignment=17&alignmentTimezone=America%2FNew_York'));
        expect(bars).toHaveLength(29);
        expect(bars.at(-1).time).toBe(lastCompleted.time);
        expect(bars.at(-1).bid.low).toBe(Number(lastCompleted.bid.l));
        expect(bars.at(-1).ask.high).toBe(Number(lastCompleted.ask.h));
        const entry = evaluateMultiDayTrendEntry({ instrument: row.instrument, candles: bars,
            currentPrice: bars.at(-1).close, nowMs: now, config: { ...cloneDefaultConfig(), strategy: 'multi_day_trend' },
            marketContext: { session: { tradeable: true, spreadPips: 0.8 } } });
        expect(entry.signalCandleTime).toBe(lastCompleted.time);
        expect(entry.strategyContext.dataFreshness.fresh).toBe(true);
        expect(entry.strategyContext.signalCandleCloseTime).toBe(Date.parse(lastCompleted.time) + H4);
        for (const side of ['BUY', 'SELL']) {
            const trail = evaluateChannelTrail({ instrument: row.instrument, side, candles: bars, nowMs: now });
            expect(trail).toMatchObject({ ready: true, signalCandleTime: lastCompleted.time, channelPeriod: 10 });
            expect(trail.stopLossPrice).toBe(side === 'BUY'
                ? Math.min(...bars.slice(-10).map((bar) => bar.bid.low))
                : Math.max(...bars.slice(-10).map((bar) => bar.ask.high)));
        }
    });
});
