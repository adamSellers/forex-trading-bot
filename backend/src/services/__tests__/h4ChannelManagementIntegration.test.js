const LiveTradingEngine = require('../LiveTradingEngine');
const OandaDataService = require('../OandaDataService');
const oanda = require('../Oandaclient');
const { buildOwnerRunExitPolicy } = require('../../runtime/exitPolicy');
const { evaluateRunLossCooldown } = require('../../runtime/portfolioRiskPolicy');

jest.mock('../Oandaclient', () => {
    const actual = jest.requireActual('../Oandaclient');
    return {
        getPipValue: actual.getPipValue.bind(actual),
        formatPrice: actual.formatPrice.bind(actual),
        formatPriceBound: actual.formatPriceBound.bind(actual),
        getInstrumentMetadata: jest.fn(async (instrument) => ({ name: instrument,
            displayPrecision: instrument.endsWith('_JPY') ? 3 : 5,
            pipLocation: instrument.endsWith('_JPY') ? -2 : -4, marginRate: '0.05' })),
        getOpenTrades: jest.fn(), getTrade: jest.fn(), closeTrade: jest.fn(), modifyTrade: jest.fn(),
    };
});
jest.mock('../emailService', () => ({ sendTradeClosedAlert: jest.fn(async () => {}) }));

const copy = (value) => JSON.parse(JSON.stringify(value));
const H4 = 4 * 3_600_000;
const channelConfig = {
    strategy: 'multi_day_trend', liveReleaseVersion: 'h4-channel-v1',
    executionPolicyVersion: 'h4-channel-risk-v1', timeframe: '4h',
    trendExitBars: 10, trendBreakoutBars: 20, trendAtrPeriod: 14, trendStopAtr: 2,
    trendMaxCostToStopRatio: 0.15, expectedSlippagePips: 0.2, minStopLossPips: 6,
    enableTrading: false, enableTakeProfit: false, enableBreakeven: false,
    enableTrailingStops: false, enableChannelTrailing: true, timeStopHours: 0,
    maxConsecutiveLosses: 3, enableEmailAlerts: false,
};
const legacyConfig = { strategy: 'intraday_momentum', liveReleaseVersion: 'm15-intraday-v6',
    executionPolicyVersion: 'intraday-risk-v6', enableTakeProfit: true, enableBreakeven: true,
    breakevenTriggerRiskMultiple: 1, enableTrailingStops: false, timeStopHours: 6,
    sessionCloseTimeZone: 'America/New_York', sessionCloseLocalHour: 16,
    sessionCloseLocalMinute: 45, sessionCloseWindowMinutes: 30 };

function h4Candles(now, level, side = 'BUY') {
    return Array.from({ length: 12 }, (_, index) => {
        const boundary = index < 2 ? (side === 'BUY' ? level - 0.05 : level + 0.05) : level;
        const bidLow = side === 'BUY' ? boundary : boundary - 0.0011;
        const bidHigh = bidLow + 0.001;
        return { time: new Date(now - (12 - index) * H4).toISOString(), complete: true,
            open: bidLow + 0.00045, high: bidHigh + 0.00005, low: bidLow + 0.00005, close: bidLow + 0.00055,
            bid: { open: bidLow + 0.0004, high: bidHigh, low: bidLow, close: bidLow + 0.0005 },
            ask: { open: bidLow + 0.0005, high: bidHigh + 0.0001, low: bidLow + 0.0001, close: bidLow + 0.0006 } };
    });
}

async function fixture({ now = Date.parse('2026-10-14T16:00:00Z'), positions = [{}] } = {}) {
    let clock = now;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const configuration = copy(channelConfig);
    const rows = new Map();
    const broker = new Map();
    const dataService = new OandaDataService(positions.map((p) => p.instrument || 'EUR_USD'));
    const quote = (instrument, bid, ask = bid + 0.0001) => {
        dataService.priceCache[instrument] = { instrument, price: (bid + ask) / 2, bid, ask,
            tradeable: true, timestamp: clock, fetchedAt: clock };
    };
    for (const [index, position] of positions.entries()) {
        const side = position.side || 'BUY';
        const config = position.legacy ? legacyConfig : channelConfig;
        const trade = {
            id: `trade-${index}`, oandaTradeId: String(490 + index), instrument: 'EUR_USD', side,
            units: 100, entryCostAud: 100, entryPrice: side === 'BUY' ? 1.1 : 1.3,
            stopLossPrice: side === 'BUY' ? 1.08 : 1.32,
            takeProfitPrice: null, isOpen: true, entryTime: now - 48 * 3_600_000,
            mode: 'live', runId: 'channel-run', ownerRunId: 'channel-run',
            configHash: 'channel-config', strategy: config.strategy,
            strategyVersion: position.legacy ? '1.4.0' : '2.0.0',
            activeStopType: 'INITIAL', reconciliationStatus: 'OPEN', breakevenHit: false,
            ...position,
        };
        delete trade.legacy;
        trade.brokerReconciliationPayload = { ...trade.brokerReconciliationPayload,
            liveRuntime: { initialStopDistance: 0.02, initialStopLossPrice: trade.stopLossPrice,
                quoteToAudRate: 1.5, baseToAudRate: 1,
                ownerExitPolicy: buildOwnerRunExitPolicy({ config, ownerRunId: trade.ownerRunId }) } };
        rows.set(trade.id, copy(trade));
        broker.set(trade.oandaTradeId, { id: trade.oandaTradeId, instrument: trade.instrument, state: 'OPEN',
            currentUnits: String(side === 'SELL' ? -trade.units : trade.units),
            stopLossOrder: { state: 'PENDING', price: String(trade.stopLossPrice) },
            ...(trade.takeProfitPrice === null ? {} : { takeProfitOrder: { state: 'PENDING', price: String(trade.takeProfitPrice) } }) });
        quote(trade.instrument, side === 'BUY' ? 1.13 : 1.2799, side === 'BUY' ? 1.1301 : 1.28);
        dataService.candleCache[`${trade.instrument}_H4`] = h4Candles(clock, side === 'BUY' ? 1.111119 : 1.288881, side);
    }
    const repository = {
        getOpenTrades: jest.fn(async () => [...rows.values()].filter((row) => row.isOpen).map(copy)),
        getAllTrades: jest.fn(async () => [...rows.values()].map(copy)),
        updateTrade: jest.fn(async (id, changes) => rows.set(id, { ...rows.get(id), ...copy(changes) })),
    };
    oanda.getOpenTrades.mockImplementation(async () => ({ trades: [...broker.values()].filter((t) => t.state === 'OPEN').map(copy) }));
    oanda.getTrade.mockImplementation(async (id) => ({ trade: copy(broker.get(String(id))) }));
    oanda.modifyTrade.mockImplementation(async (id, options) => {
        const trade = broker.get(String(id));
        trade.stopLossOrder = { state: 'PENDING', price: String(options.stopLossPrice) };
        return { stopLossOrderTransaction: { tradeID: String(id), price: String(options.stopLossPrice) } };
    });
    oanda.closeTrade.mockImplementation(async (id) => {
        const trade = broker.get(String(id));
        const price = dataService.getCurrentPrice(trade.instrument)?.price || 1.1;
        Object.assign(trade, { state: 'CLOSED', currentUnits: '0', averageClosePrice: String(price),
            closeTime: new Date(clock).toISOString(), realizedPL: '0.2' });
        return { orderFillTransaction: { time: new Date(clock).toISOString(), price: String(price),
            tradesClosed: [{ tradeID: String(id), price: String(price), realizedPL: '0.2' }] } };
    });
    const boot = async () => {
        const engine = new LiveTradingEngine().init({ get: () => configuration }, dataService, repository);
        engine.getInstrumentBaseToAccountRate = jest.fn(async () => 1);
        await engine.syncOpenTrades({ throwOnError: true });
        return engine;
    };
    return { boot, rows, broker, repository, dataService, configuration, quote,
        setNow: (value) => { clock = value; }, now: () => clock };
}

describe('H4 channel exits through position monitoring and broker reconciliation', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    test.each(['BUY', 'SELL'])('ratchets the %s executable-side channel with outward precision, excluding the forming tail', async (side) => {
        const state = await fixture({ positions: [{ side }] });
        const candles = state.dataService.getCandles('EUR_USD', '4h');
        candles.push({ ...copy(candles.at(-1)), time: new Date(state.now()).toISOString(), complete: false,
            bid: { low: 0.5 }, ask: { high: 2 } });
        const engine = await state.boot();
        await engine.monitorPositions();
        const expected = side === 'BUY' ? 1.11111 : 1.28889;
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.modifyTrade).toHaveBeenCalledWith('490', expect.objectContaining({ stopLossPrice: expected }));
        expect(state.rows.get('trade-0')).toMatchObject({ stopLossPrice: expected, trailingStopPrice: expected,
            activeStopType: 'CHANNEL', breakevenHit: false, takeProfitPrice: null, isOpen: true });
        expect(oanda.closeTrade).not.toHaveBeenCalled();
    });

    test('old intraday and new multi-day owners coexist during the daily close', async () => {
        const now = Date.parse('2026-10-14T20:45:00Z');
        const state = await fixture({ now, positions: [
            { legacy: true, instrument: 'AUD_USD', entryTime: now - 3_600_000, takeProfitPrice: 1.15 },
            { instrument: 'EUR_USD' },
        ] });
        const oldPolicy = copy(state.rows.get('trade-0').brokerReconciliationPayload.liveRuntime.ownerExitPolicy);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0')).toMatchObject({ isOpen: false, exitReason: 'SESSION_CLOSE', takeProfitPrice: 1.15 });
        expect(state.rows.get('trade-0').brokerReconciliationPayload.liveRuntime.ownerExitPolicy).toEqual(oldPolicy);
        expect(state.rows.get('trade-1')).toMatchObject({ isOpen: true, activeStopType: 'CHANNEL', takeProfitPrice: null });
    });

    test('the real monitor preserves legacy one-R breakeven beside a channel owner', async () => {
        const now = Date.parse('2026-10-14T16:00:00Z');
        const state = await fixture({ now, positions: [
            { legacy: true, instrument: 'AUD_USD', entryTime: now - 3_600_000, takeProfitPrice: 1.15 },
            { instrument: 'EUR_USD' },
        ] });
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0')).toMatchObject({ isOpen: true, breakevenHit: true,
            stopLossPrice: 1.1, takeProfitPrice: 1.15, activeStopType: 'BREAKEVEN' });
        expect(state.rows.get('trade-1')).toMatchObject({ isOpen: true, breakevenHit: false,
            takeProfitPrice: null, activeStopType: 'CHANNEL' });
    });

    test.each(['BUY', 'SELL'])('JPY %s channel stops round outward at the broker price tick', async (side) => {
        const state = await fixture({ positions: [{ instrument: 'USD_JPY', side, entryPrice: 158,
            stopLossPrice: side === 'BUY' ? 157 : 159 }] });
        state.quote('USD_JPY', side === 'BUY' ? 159 : 156.99, side === 'BUY' ? 159.01 : 157);
        state.dataService.candleCache.USD_JPY_H4 = h4Candles(state.now(), side === 'BUY' ? 158.12345 : 157.98765, side);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0').stopLossPrice).toBe(side === 'BUY' ? 158.123 : 157.988);
    });

    test('a confirmed tighter broker stop wins over a looser range channel and survives restart/global reselection', async () => {
        const state = await fixture();
        state.broker.get('490').stopLossOrder.price = '1.12';
        let engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0').stopLossPrice).toBe(1.12);
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        Object.assign(state.configuration, legacyConfig);
        state.setNow(state.now() + 8 * 3_600_000);
        state.quote('EUR_USD', 1.13);
        engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0')).toMatchObject({ isOpen: true, stopLossPrice: 1.12, breakevenHit: false });
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
    });

    test('a missing bid side cannot synthesize a channel stop from midpoint or the current spread', async () => {
        const state = await fixture();
        delete state.dataService.getCandles('EUR_USD', '4h').at(-1).bid;
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0').stopLossPrice).toBe(1.08);
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
    });

    test('an unavailable protective update retains its durable retry and cannot be replaced by a newer channel', async () => {
        const state = await fixture();
        const engine = await state.boot();
        oanda.modifyTrade.mockRejectedValueOnce(new Error('Broker temporarily unavailable'));
        await engine.monitorPositions();
        expect(state.rows.get('trade-0').brokerReconciliationPayload.stopUpdate).toMatchObject({
            status: 'RETRY_PENDING', desiredPrice: 1.11111, stopType: 'CHANNEL' });
        state.dataService.candleCache.EUR_USD_H4 = h4Candles(state.now(), 1.115);
        await engine.monitorPositions();
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        state.setNow(state.now() + 6_000);
        state.quote('EUR_USD', 1.13);
        await engine.monitorPositions();
        expect(state.rows.get('trade-0')).toMatchObject({ stopLossPrice: 1.115, reconciliationStatus: 'OPEN' });
        expect(state.rows.get('trade-0').brokerReconciliationPayload.stopUpdate).toBeNull();
        expect(oanda.modifyTrade.mock.calls.map(([, options]) => options.stopLossPrice)).toEqual([1.11111, 1.11111, 1.115]);
    });

    test('a stronger broker-confirmed stop supersedes an older pending retry without loosening it', async () => {
        const state = await fixture();
        const row = state.rows.get('trade-0');
        row.brokerReconciliationPayload.stopUpdate = { status: 'RETRY_PENDING', desiredPrice: 1.11111,
            stopType: 'CHANNEL', nextRetryAt: 0, localUpdates: { trailingStopPrice: 1.11111 } };
        row.reconciliationStatus = 'STOP_UPDATE_RETRY_PENDING';
        state.broker.get('490').stopLossOrder.price = '1.12';
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0')).toMatchObject({ stopLossPrice: 1.12, trailingStopPrice: 1.12, reconciliationStatus: 'OPEN' });
        expect(state.rows.get('trade-0').brokerReconciliationPayload.stopUpdate).toBeNull();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
    });

    test('overlapping channel work waits for the broker lifecycle and advances stops in order', async () => {
        const state = await fixture();
        const engine = await state.boot();
        const apply = oanda.modifyTrade.getMockImplementation();
        let release;
        let started;
        const entered = new Promise((resolve) => { started = resolve; });
        const held = new Promise((resolve) => { release = resolve; });
        oanda.modifyTrade.mockImplementationOnce(async (...args) => { started(); await held; return apply(...args); });
        const monitoring = engine.monitorPositions();
        await entered;
        state.dataService.candleCache.EUR_USD_H4 = h4Candles(state.now(), 1.115);
        const queued = engine.updateH4ChannelStop(engine.openTrades.get('trade-0'), channelConfig);
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        release();
        await Promise.all([monitoring, queued]);
        expect(oanda.modifyTrade.mock.calls.map(([, options]) => options.stopLossPrice)).toEqual([1.11111, 1.115]);
        expect(state.rows.get('trade-0').stopLossPrice).toBe(1.115);
    });

    test.each(['2026-08-14T20:45:00Z', '2026-01-09T21:45:00Z'])(
        'Friday flatten closes through the real broker path even without pricing at %s', async (time) => {
            const state = await fixture({ now: Date.parse(time) });
            state.dataService.priceCache.EUR_USD = null;
            const engine = await state.boot();
            await engine.monitorPositions();
            expect(state.rows.get('trade-0')).toMatchObject({ isOpen: false, exitReason: 'WEEKEND_CLOSE' });
            expect(oanda.modifyTrade).not.toHaveBeenCalled();
        });

    test('a newly tighter channel already crossed by the quote exits without sending an invalid stop', async () => {
        const state = await fixture();
        state.quote('EUR_USD', 1.10);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.rows.get('trade-0')).toMatchObject({ isOpen: false, exitReason: 'CHANNEL_EXIT' });
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
    });

    test('realized channel exits remain in the unchanged three-loss cooldown accounting', async () => {
        const state = await fixture();
        state.quote('EUR_USD', 1.10);
        for (const index of [1, 2]) state.rows.set(`prior-${index}`, {
            id: `prior-${index}`, ownerRunId: 'channel-run', mode: 'live', isOpen: false,
            exitTime: state.now() - index * 3_600_000, pnlAud: -0.1,
        });
        const close = oanda.closeTrade.getMockImplementation();
        oanda.closeTrade.mockImplementation(async (...args) => {
            const fill = await close(...args);
            fill.orderFillTransaction.tradesClosed[0].realizedPL = '-0.1';
            state.broker.get(String(args[0])).realizedPL = '-0.1';
            return fill;
        });
        const engine = await state.boot();
        await engine.monitorPositions();
        const risk = evaluateRunLossCooldown({ trades: [...state.rows.values()], runId: 'channel-run',
            config: channelConfig, evaluatedAt: state.now() });
        expect(risk).toMatchObject({ cooldownActive: true, consecutiveLosses: 3, maxConsecutiveLosses: 3 });
        expect(risk.cooldownUntil - state.now()).toBe(24 * 3_600_000);
    });
});
