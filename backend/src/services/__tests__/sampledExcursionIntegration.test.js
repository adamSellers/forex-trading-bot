const LiveTradingEngine = require('../LiveTradingEngine');
const OandaDataService = require('../OandaDataService');
const oanda = require('../Oandaclient');
const TradeRepository = require('../../repositories/tradeRepository');
const { createTestDb } = require('../../../__tests__/helpers/testDb');

let mockSqlite = null;
jest.mock('../../../config/database', () => ({
    db: new Proxy(function () {}, {
        apply: (_target, _thisArg, args) => mockSqlite(...args),
        get: (_target, key) => typeof mockSqlite?.[key] === 'function'
            ? mockSqlite[key].bind(mockSqlite) : mockSqlite?.[key],
    }),
}));

jest.mock('../Oandaclient', () => {
    const actual = jest.requireActual('../Oandaclient');
    return {
        getPipValue: actual.getPipValue.bind(actual),
        formatPrice: actual.formatPrice.bind(actual),
        formatPriceBound: actual.formatPriceBound.bind(actual),
        getOpenTrades: jest.fn(), getTrade: jest.fn(),
        closeTrade: jest.fn(), modifyTrade: jest.fn(),
    };
});
jest.mock('../emailService', () => ({
    sendTradeClosedAlert: jest.fn(async () => {}),
}));

const copy = (value) => JSON.parse(JSON.stringify(value));
const entryTime = Date.parse('2026-09-14T09:00:00Z');
const instrument = 'AUD_USD';

// Store JSON, never live engine object references: samples must survive a real
// serialization boundary and a new engine's syncOpenTrades startup path. A
// separate case runs that same orchestration against the actual SQLite repo.
async function fixture({ side = 'BUY', sampledExcursion = null, config = {}, sqlite = false } = {}) {
    let now = entryTime;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const sign = side === 'BUY' ? 1 : -1;
    const trade = {
        id: 'local-trade', oandaTradeId: '489', instrument, side, units: 100,
        entryPrice: 0.7, entryCostAud: 100, entryTime, isOpen: true,
        stopLossPrice: 0.7 - sign * 0.001, takeProfitPrice: 0.7 + sign * 0.0012,
        activeStopType: 'INITIAL', mode: 'live', reconciliationStatus: 'OPEN',
        brokerReconciliationPayload: {
            liveRuntime: { initialStopDistance: 0.001, quoteToAudRate: 1.5, baseToAudRate: 1 },
            ...(sampledExcursion ? { sampledExcursion } : {}),
        },
    };
    const rows = new Map([[trade.id, JSON.stringify(trade)]]);
    let failCloseWrites = 0;
    let read = () => JSON.parse(rows.get(trade.id));
    let repository = {
        getOpenTrades: jest.fn(async () => [...rows.values()].map(JSON.parse).filter((row) => row.isOpen)),
        updateTrade: jest.fn(async (id, changes) => {
            if (changes.isOpen === false && failCloseWrites > 0) {
                failCloseWrites--;
                throw new Error('Simulated close persistence failure');
            }
            const row = { ...JSON.parse(rows.get(id)), ...copy(changes) };
            rows.set(id, JSON.stringify(row));
        }),
    };
    if (sqlite) {
        mockSqlite = await createTestDb();
        repository = new TradeRepository();
        await repository.save(trade);
        read = async () => (await repository.getRecent(1))[0];
    }
    let brokerOpen = true;
    let brokerTrade = {
        id: trade.oandaTradeId, instrument, state: 'OPEN',
        currentUnits: String(sign * trade.units),
        stopLossOrder: { state: 'PENDING', price: String(trade.stopLossPrice) },
        takeProfitOrder: { state: 'PENDING', price: String(trade.takeProfitPrice) },
    };
    oanda.getOpenTrades.mockImplementation(async () => ({ trades: brokerOpen ? [copy(brokerTrade)] : [] }));
    oanda.getTrade.mockImplementation(async () => ({ trade: copy(brokerTrade) }));
    oanda.modifyTrade.mockImplementation(async (id, options) => {
        brokerTrade.stopLossOrder.price = String(options.stopLossPrice);
        return { stopLossOrderTransaction: { tradeID: id, price: String(options.stopLossPrice) } };
    });
    const dataService = new OandaDataService([instrument]);
    const configuration = {
        enableTrading: true, enableBreakeven: false, enableTrailingStops: false, ...config,
    };
    const boot = async () => {
        const engine = new LiveTradingEngine().init({ get: () => configuration }, dataService, repository);
        // FX conversions do not decide excursion observations or close accounting.
        engine.getInstrumentBaseToAccountRate = jest.fn(async () => 1);
        await engine.syncOpenTrades({ throwOnError: true });
        return engine;
    };
    const quote = async (pips, eventAt, receivedAt = eventAt) => {
        now = receivedAt;
        const executable = trade.entryPrice + sign * pips * 0.0001;
        const bid = side === 'BUY' ? executable : executable - 0.0001;
        const ask = side === 'SELL' ? executable : executable + 0.0001;
        dataService.oandaRequest = jest.fn(async () => ({ prices: dataService.getPricingInstruments().map((name) => ({
            instrument: name, time: new Date(eventAt).toISOString(), tradeable: true,
            bids: [{ price: bid.toFixed(5), liquidity: 1000000 }],
            asks: [{ price: ask.toFixed(5), liquidity: 1000000 }],
        })) }));
        await dataService.fetchAllPrices();
    };
    const close = (at = entryTime + 30000, changes = {}) => {
        brokerOpen = false;
        brokerTrade = {
            ...brokerTrade, state: 'CLOSED', currentUnits: '0',
            averageClosePrice: String(trade.takeProfitPrice),
            realizedPL: '0.4', financing: '-0.02', commission: '0.01',
            closeTime: at === null ? undefined : new Date(at).toISOString(),
            takeProfitOrder: { state: 'FILLED', price: String(trade.takeProfitPrice) },
            ...changes,
        };
    };
    return {
        boot, quote, close, read, trade, repository, dataService,
        failNextCloseWrite: () => { failCloseWrites++; },
        fill: (at) => ({ orderFillTransaction: {
            id: 'close-fill', time: String(at / 1000), price: String(trade.takeProfitPrice),
            tradesClosed: [{ tradeID: trade.oandaTradeId, realizedPL: '0.4', price: String(trade.takeProfitPrice) }],
        } }),
    };
}

describe('sampled excursion broker lifetime integration', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(async () => {
        jest.restoreAllMocks();
        if (mockSqlite) await mockSqlite.destroy();
        mockSqlite = null;
    });

    test.each(['BUY', 'SELL'])('trims every post-TP observation after delayed reconciliation and restart (%s)', async (side) => {
        const state = await fixture({ side });
        let engine = await state.boot();
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        await state.quote(-3, entryTime + 20000);
        await engine.monitorPositions();
        state.close();
        oanda.getTrade.mockRejectedValueOnce(new Error('Broker lookup unavailable'))
            .mockRejectedValueOnce(new Error('Broker lookup unavailable'));
        for (const [pips, elapsed] of [[30, 40000], [-40, 50000]]) {
            await state.quote(pips, entryTime + elapsed);
            await engine.monitorPositions();
        }
        const pending = state.read().brokerReconciliationPayload.sampledExcursion;
        expect(pending).toMatchObject({ lifetimeStatus: 'PROVISIONAL', observations: 4 });
        expect(pending.maxFavorablePips).toBeCloseTo(30);
        expect(pending.maxAdversePips).toBeCloseTo(40);

        oanda.getTrade.mockRejectedValueOnce(new Error('Broker lookup unavailable at startup'));
        engine = await state.boot();
        expect(engine.openTrades.get(state.trade.id).brokerReconciliationPayload.sampledExcursion).toEqual(pending);
        await state.quote(50, entryTime + 60000);
        await engine.monitorPositions();

        const saved = state.read();
        const sample = saved.brokerReconciliationPayload.sampledExcursion;
        expect(saved).toMatchObject({ isOpen: false, exitReason: 'TAKE_PROFIT', exitTime: entryTime + 30000 });
        expect(saved.pnlAud).toBeCloseTo(0.37);
        expect(saved.pnlPips).toBeCloseTo(12);
        expect(sample).toMatchObject({ version: 2, lifetimeStatus: 'VERIFIED', observations: 2, excludedAfterClose: 3 });
        expect(sample.maxFavorablePips).toBeCloseTo(4);
        expect(sample.maxAdversePips).toBeCloseTo(3);
        expect(sample.maxFavorableR).toBeCloseTo(0.4);
        expect(sample.maxAdverseR).toBeCloseTo(0.3);
        expect(sample.samples.map(([at]) => at)).toEqual([entryTime + 10000, entryTime + 20000]);
        expect(engine.openTrades.size).toBe(0);
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
    });

    test('freshly received unchanged pre-close events still manage stops and are retained once', async () => {
        const state = await fixture({ config: { enableBreakeven: true, breakevenTriggerPips: 4 } });
        const engine = await state.boot();
        await state.quote(5, entryTime + 10000, entryTime + 70000);
        await engine.monitorPositions();
        await state.quote(5, entryTime + 10000, entryTime + 80000);
        await engine.monitorPositions();
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.modifyTrade).toHaveBeenCalledWith('489', expect.objectContaining({ stopLossPrice: 0.7 }));
        expect(state.read().breakevenHit).toBe(true);
        state.close(entryTime + 75000);
        await state.quote(12, entryTime + 75000, entryTime + 90000);
        await engine.monitorPositions();
        const sample = state.read().brokerReconciliationPayload.sampledExcursion;
        expect(sample).toMatchObject({ lifetimeStatus: 'VERIFIED', observations: 2, excludedAfterClose: 0 });
        expect(sample.samples.map(([at]) => at)).toEqual([entryTime + 10000, entryTime + 75000]);
        expect(sample.maxFavorableR).toBeCloseTo(1.2);
    });

    test('failed close persistence retains reversible observations until a successful retry', async () => {
        const state = await fixture();
        const engine = await state.boot();
        const closedEvents = jest.fn();
        engine.on('tradeClosed', closedEvents);
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        state.close();
        state.failNextCloseWrite();
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        expect(state.read()).toMatchObject({ isOpen: true, reconciliationStatus: 'CLOSE_RETRY_PENDING' });
        expect(state.read().brokerReconciliationPayload.sampledExcursion).toMatchObject({
            lifetimeStatus: 'PROVISIONAL', observations: 2,
        });
        expect(engine.stats.tradesClosed).toBe(0);
        await state.quote(-50, entryTime + 50000);
        await engine.monitorPositions();
        expect(state.read().brokerReconciliationPayload.sampledExcursion).toMatchObject({
            lifetimeStatus: 'VERIFIED', observations: 1, excludedAfterClose: 2,
        });
        expect(state.read().brokerReconciliationPayload.sampledExcursion.maxFavorablePips).toBeCloseTo(4);
        expect(engine.stats.tradesClosed).toBe(1);
        expect(closedEvents).toHaveBeenCalledTimes(1);
        expect(state.read().pnlAud).toBeCloseTo(0.37);
    });

    test('unknown broker close time preserves accounting but cannot verify sampled lifetime', async () => {
        const state = await fixture();
        const engine = await state.boot();
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        state.close(null);
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        expect(state.read()).toMatchObject({ isOpen: false, exitTime: entryTime + 40000 });
        expect(state.read().pnlAud).toBeCloseTo(0.37);
        expect(state.read().brokerReconciliationPayload.sampledExcursion).toMatchObject({
            lifetimeStatus: 'UNVERIFIED_CLOSE_TIME', observations: 2,
        });
    });

    test('direct full-close fill time verifies observations when cumulative details omit closeTime', async () => {
        const state = await fixture();
        const engine = await state.boot();
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        state.close(null);
        oanda.closeTrade.mockResolvedValue(state.fill(entryTime + 30000));
        await engine.executeExit(engine.openTrades.get(state.trade.id), state.trade.takeProfitPrice, 'MANUAL');
        expect(state.read()).toMatchObject({ isOpen: false, exitReason: 'MANUAL' });
        expect(state.read().brokerReconciliationPayload.sampledExcursion).toMatchObject({
            lifetimeStatus: 'VERIFIED', confirmedBrokerClosedAt: entryTime + 30000,
            observations: 1, excludedAfterClose: 1,
        });
    });

    test('proven direct fill time survives failed cumulative lookup and restart before recovery', async () => {
        const state = await fixture();
        let engine = await state.boot();
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        state.close(null);
        oanda.closeTrade.mockResolvedValue(state.fill(entryTime + 30000));
        oanda.getTrade.mockRejectedValueOnce(new Error('Cumulative accounting unavailable'))
            .mockRejectedValueOnce(new Error('Recovery lookup unavailable'));
        await engine.executeExit(engine.openTrades.get(state.trade.id), state.trade.takeProfitPrice, 'MANUAL');
        expect(state.read()).toMatchObject({ isOpen: true, reconciliationStatus: 'CLOSE_RETRY_PENDING' });
        expect(state.read().brokerReconciliationPayload.sampledExcursion.lifetimeStatus).toBe('PROVISIONAL');

        engine = await state.boot();
        expect(engine.openTrades.size).toBe(0);
        expect(state.read().pnlAud).toBeCloseTo(0.37);
        expect(state.read().brokerReconciliationPayload.sampledExcursion).toMatchObject({
            lifetimeStatus: 'VERIFIED', confirmedBrokerClosedAt: entryTime + 30000,
            observations: 1, excludedAfterClose: 1,
        });
        expect(oanda.closeTrade).toHaveBeenCalledTimes(1);
    });

    test('broker close time survives incomplete accounting and restart when later details omit time', async () => {
        const state = await fixture();
        let engine = await state.boot();
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        state.close(entryTime + 30000, { realizedPL: undefined });
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        expect(state.read()).toMatchObject({ isOpen: true, reconciliationStatus: 'CLOSE_RETRY_PENDING' });
        expect(state.read().brokerReconciliationPayload.sampledExcursion.lifetimeStatus).toBe('PROVISIONAL');

        state.close(null);
        engine = await state.boot();
        expect(engine.openTrades.size).toBe(0);
        expect(state.read().pnlAud).toBeCloseTo(0.37);
        expect(state.read().brokerReconciliationPayload.sampledExcursion).toMatchObject({
            lifetimeStatus: 'VERIFIED', confirmedBrokerClosedAt: entryTime + 30000,
            observations: 1, excludedAfterClose: 1,
        });
        expect(oanda.closeTrade).not.toHaveBeenCalled();
    });

    test('upgraded open trades retain legacy evidence without blending it into verified extrema', async () => {
        const legacy = {
            method: 'EXECUTABLE_QUOTE_POLL', observations: 10, maxFavorablePips: 90,
            maxAdversePips: 80, maxFavorableR: 9, maxAdverseR: 8,
            firstObservedAt: entryTime, lastObservedAt: entryTime + 5000,
        };
        const state = await fixture({ sampledExcursion: legacy });
        const engine = await state.boot();
        await state.quote(4, entryTime + 10000);
        await engine.monitorPositions();
        state.close();
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        const sample = state.read().brokerReconciliationPayload.sampledExcursion;
        expect(sample.legacyAggregate).toEqual(legacy);
        expect(sample).toMatchObject({ lifetimeStatus: 'VERIFIED', observations: 1, excludedAfterClose: 1 });
        expect(sample.maxFavorablePips).toBeCloseTo(4);
        expect(sample.maxAdversePips).toBe(0);
    });

    test('actual SQLite repository restores observations and known close time before final accounting', async () => {
        const state = await fixture({ sqlite: true });
        let engine = await state.boot();
        await state.quote(-3, entryTime + 10000);
        await engine.monitorPositions();
        await state.quote(4, entryTime + 20000);
        await engine.monitorPositions();
        state.close(entryTime + 30000, { realizedPL: undefined });
        await state.quote(40, entryTime + 40000);
        await engine.monitorPositions();
        const pending = await state.read();
        expect(pending).toMatchObject({ isOpen: true, reconciliationStatus: 'CLOSE_RETRY_PENDING' });
        expect(pending.brokerReconciliationPayload.sampledExcursion.observations).toBe(3);
        const raw = await mockSqlite('trades').where({ trade_id: state.trade.id }).first();
        expect(typeof raw.broker_reconciliation_payload).toBe('string');

        state.close(null);
        engine = await state.boot();
        const saved = await state.read();
        expect(engine.openTrades.size).toBe(0);
        expect(saved.isOpen).toBe(false);
        expect(saved.pnlAud).toBeCloseTo(0.37);
        expect(saved.brokerReconciliationPayload.sampledExcursion).toMatchObject({
            version: 2, lifetimeStatus: 'VERIFIED', confirmedBrokerClosedAt: entryTime + 30000,
            observations: 2, excludedAfterClose: 1,
        });
        expect(saved.brokerReconciliationPayload.sampledExcursion.maxFavorablePips).toBeCloseTo(4);
        expect(saved.brokerReconciliationPayload.sampledExcursion.maxAdversePips).toBeCloseTo(3);
    });
});
