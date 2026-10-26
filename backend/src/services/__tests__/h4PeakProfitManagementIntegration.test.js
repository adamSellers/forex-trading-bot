const LiveTradingEngine = require('../LiveTradingEngine');
const OandaDataService = require('../OandaDataService');
const oanda = require('../Oandaclient');
const { buildOwnerRunExitPolicy } = require('../../runtime/exitPolicy');
const trade3550 = require('./fixtures/h4PeakProfitTrade3550.json');

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
const configV2 = {
    strategy: 'multi_day_trend', strategyVersion: '2.1.0', liveReleaseVersion: 'h4-channel-v2',
    executionPolicyVersion: 'h4-channel-risk-v2', timeframe: '4h', trendExitBars: 10,
    trendBreakoutBars: 20, trendAtrPeriod: 14, trendStopAtr: 2,
    trendMaxCostToStopRatio: 0.15, expectedSlippagePips: 0.2, minStopLossPips: 6,
    enableTrading: false, enableTakeProfit: false, enableBreakeven: false,
    enableTrailingStops: false, enableChannelTrailing: true,
    enablePeakProfitTrail: true, peakProfitTrailActivationRiskMultiple: 1,
    peakProfitTrailRiskMultiple: 0.5, timeStopHours: 0, maxConsecutiveLosses: 3,
    enableEmailAlerts: false,
};
const configV1 = { ...configV2, strategyVersion: '2.0.0', liveReleaseVersion: 'h4-channel-v1',
    executionPolicyVersion: 'h4-channel-risk-v1', enablePeakProfitTrail: false };

// Use the real normalized OANDA cache and the engine's position monitor and
// reconciliation path; broker calls alone are replaced with service-shaped data.
async function fixture({ now = Date.parse('2026-10-14T16:00:00Z'), side = 'BUY',
    instrument = 'EUR_USD', ownerConfig = configV2, trade = {}, runtime = {} } = {}) {
    let clock = now;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const configuration = copy(configV2);
    const entryPrice = side === 'BUY' ? 1.1 : 1.3;
    const row = { id: 'trade-0', oandaTradeId: '490', instrument, side, units: 100,
        entryCostAud: 100, entryPrice, stopLossPrice: side === 'BUY' ? 1.08 : 1.32,
        takeProfitPrice: null, isOpen: true, entryTime: now - 48 * 3_600_000,
        mode: 'live', runId: 'peak-run', ownerRunId: 'peak-run', configHash: 'peak-config',
        strategy: 'multi_day_trend', strategyVersion: ownerConfig.strategyVersion,
        activeStopType: 'INITIAL', reconciliationStatus: 'OPEN', breakevenHit: false, ...trade };
    row.brokerReconciliationPayload = { ...row.brokerReconciliationPayload,
        liveRuntime: { initialStopDistance: Math.abs(row.entryPrice - row.stopLossPrice),
            initialStopLossPrice: row.stopLossPrice, quoteToAudRate: 1.5, baseToAudRate: 1,
            ownerExitPolicy: buildOwnerRunExitPolicy({ config: ownerConfig, ownerRunId: row.ownerRunId }),
            ...runtime } };
    const rows = new Map([[row.id, copy(row)]]);
    const broker = { id: row.oandaTradeId, instrument, state: 'OPEN',
        currentUnits: String(side === 'SELL' ? -row.units : row.units),
        stopLossOrder: { state: 'PENDING', price: String(row.stopLossPrice) } };
    const dataService = new OandaDataService([instrument]);
    const quote = (bid, ask = bid + (instrument.endsWith('_JPY') ? 0.01 : 0.0001),
        { eventAt = clock, fetchedAt = clock, tradeable = true } = {}) => {
        dataService.priceCache[instrument] = { instrument, bid, ask, price: (bid + ask) / 2,
            timestamp: eventAt, fetchedAt, tradeable };
    };
    const channel = (level) => {
        const bidLow = side === 'BUY' ? level : level - 0.0011;
        dataService.candleCache[`${instrument}_H4`] = Array.from({ length: 12 }, (_, index) => ({
            time: new Date(clock - (12 - index) * H4).toISOString(), complete: true,
            open: bidLow + 0.00045, high: bidLow + 0.00105, low: bidLow + 0.00005,
            close: bidLow + 0.00055,
            bid: { open: bidLow + 0.0004, high: bidLow + 0.001, low: bidLow, close: bidLow + 0.0005 },
            ask: { open: bidLow + 0.0005, high: bidLow + 0.0011, low: bidLow + 0.0001, close: bidLow + 0.0006 },
        }));
    };
    channel(side === 'BUY' ? row.stopLossPrice - 0.01 : row.stopLossPrice + 0.01);
    quote(side === 'BUY' ? row.entryPrice + 0.001 : row.entryPrice - 0.0011);
    const repository = {
        getOpenTrades: jest.fn(async () => [...rows.values()].filter((value) => value.isOpen).map(copy)),
        getAllTrades: jest.fn(async () => [...rows.values()].map(copy)),
        updateTrade: jest.fn(async (id, changes) => rows.set(id, { ...rows.get(id), ...copy(changes) })),
    };
    oanda.getOpenTrades.mockImplementation(async () => ({ trades: broker.state === 'OPEN' ? [copy(broker)] : [] }));
    oanda.getTrade.mockImplementation(async () => ({ trade: copy(broker) }));
    oanda.modifyTrade.mockImplementation(async (id, options) => {
        broker.stopLossOrder = { state: 'PENDING', price: String(options.stopLossPrice) };
        return { stopLossOrderTransaction: { type: 'STOP_LOSS_ORDER', tradeID: String(id),
            price: String(options.stopLossPrice) } };
    });
    const brokerClose = (price) => Object.assign(broker, { state: 'CLOSED', currentUnits: '0',
        averageClosePrice: String(price), closeTime: new Date(clock).toISOString(), realizedPL: '0.2' });
    oanda.closeTrade.mockImplementation(async (id) => {
        const current = dataService.getCurrentPrice(instrument);
        const price = side === 'SELL' ? current?.ask : current?.bid;
        brokerClose(price || row.entryPrice);
        return { orderFillTransaction: { time: new Date(clock).toISOString(), price: broker.averageClosePrice,
            tradesClosed: [{ tradeID: String(id), price: broker.averageClosePrice, realizedPL: '0.2' }] } };
    });
    const boot = async () => {
        const engine = new LiveTradingEngine().init({ get: () => configuration }, dataService, repository);
        engine.getInstrumentBaseToAccountRate = jest.fn(async () => 1);
        await engine.syncOpenTrades({ throwOnError: true });
        return engine;
    };
    return { boot, rows, broker, repository, dataService, configuration, quote, channel, brokerClose,
        row: () => rows.get(row.id), now: () => clock, advance: (ms = 1000) => { clock += ms; } };
}

describe('H4 peak profit protection through position monitoring and broker reconciliation', () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => jest.restoreAllMocks());

    test.each(['BUY', 'SELL'])('%s activates at one original R using the executable side, then survives a healthy retracement and resumes', async (side) => {
        const state = await fixture({ side });
        expect(state.row().brokerReconciliationPayload.liveRuntime.ownerExitPolicy).toMatchObject({
            version: 3, kind: 'H4_CHANNEL', config: { liveReleaseVersion: 'h4-channel-v2',
                enablePeakProfitTrail: true, peakProfitTrailActivationRiskMultiple: 1,
                peakProfitTrailRiskMultiple: 0.5 } });
        const engine = await state.boot();
        // A midpoint exceeding one R cannot trigger a BUY whose bid is below it,
        // or a SELL whose ask is above it.
        state.quote(side === 'BUY' ? 1.11999 : 1.27990, side === 'BUY' ? 1.12009 : 1.28001);
        await engine.monitorPositions();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        state.advance();
        state.quote(side === 'BUY' ? 1.12 : 1.2799, side === 'BUY' ? 1.1201 : 1.28);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: true, activeStopType: 'PEAK_PROFIT',
            stopLossPrice: side === 'BUY' ? 1.11 : 1.29, breakevenHit: false });
        state.advance();
        state.quote(side === 'BUY' ? 1.115 : 1.2849, side === 'BUY' ? 1.1151 : 1.285);
        await engine.monitorPositions();
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        state.advance();
        state.quote(side === 'BUY' ? 1.14 : 1.2599, side === 'BUY' ? 1.1401 : 1.26);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: true, stopLossPrice: side === 'BUY' ? 1.13 : 1.27 });
        expect(state.row().brokerReconciliationPayload.liveRuntime.initialStopDistance).toBeCloseTo(0.02);
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toMatchObject({ version: 1,
            peakPrice: side === 'BUY' ? 1.14 : 1.26, observedAt: state.now(), quoteEventAt: state.now() });
    });

    test('the tighter channel wins and a later weaker peak candidate never loosens its stop', async () => {
        const state = await fixture();
        state.quote(1.13);
        state.channel(1.125);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.125, activeStopType: 'CHANNEL' });
        state.advance();
        state.quote(1.131);
        state.channel(1.10);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.125, activeStopType: 'CHANNEL' });
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
    });

    test.each(['BUY', 'SELL'])('%s records an adverse first executable quote as observed and activates only after a later one-R gain', async (side) => {
        const state = await fixture({ side });
        state.quote(side === 'BUY' ? 1.099 : 1.3009, side === 'BUY' ? 1.0991 : 1.301);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toMatchObject({
            version: 1, peakPrice: side === 'BUY' ? 1.099 : 1.301,
            observedAt: state.now(), quoteEventAt: state.now() });
        expect(state.row().stopLossPrice).toBe(side === 'BUY' ? 1.08 : 1.32);
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        state.advance();
        state.quote(side === 'BUY' ? 1.098 : 1.3019, side === 'BUY' ? 1.0981 : 1.302);
        await engine.monitorPositions();
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(side === 'BUY' ? 1.099 : 1.301);
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        state.advance();
        state.quote(side === 'BUY' ? 1.12 : 1.2799, side === 'BUY' ? 1.1201 : 1.28);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: side === 'BUY' ? 1.11 : 1.29,
            activeStopType: 'PEAK_PROFIT', isOpen: true });
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toMatchObject({
            peakPrice: side === 'BUY' ? 1.12 : 1.28, observedAt: state.now(), quoteEventAt: state.now() });
    });

    test('new global rules cannot change a persisted v1 owner into a peak trail', async () => {
        const state = await fixture({ ownerConfig: configV1 });
        state.quote(1.14);
        const originalOwner = copy(state.row().brokerReconciliationPayload.liveRuntime.ownerExitPolicy);
        expect(originalOwner.version).toBe(2);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toBeUndefined();
        expect(state.row().brokerReconciliationPayload.liveRuntime.ownerExitPolicy).toEqual(originalOwner);
    });

    test('missing H4 candles cannot prevent valid quote-based peak protection', async () => {
        const state = await fixture();
        state.dataService.candleCache.EUR_USD_H4 = [];
        state.quote(1.14);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
    });

    test('an unchanged older broker event freshly received remains usable without rewriting event time', async () => {
        const state = await fixture();
        const eventAt = state.now() - 10 * 60_000;
        state.quote(1.14, 1.1401, { eventAt });
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toMatchObject({
            peakPrice: 1.14, observedAt: state.now(), quoteEventAt: eventAt });
        expect(state.dataService.getCurrentPrice('EUR_USD').timestamp).toBe(eventAt);
    });

    test.each(['stale', 'untradeable', 'missing executable side'])('%s quotes cannot create or advance peak protection', async (kind) => {
        const state = await fixture();
        state.quote(1.14, 1.1401, kind === 'stale' ? { fetchedAt: state.now() - 30_001 }
            : kind === 'untradeable' ? { tradeable: false } : {});
        if (kind === 'missing executable side') state.dataService.priceCache.EUR_USD.bid = null;
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toBeUndefined();
    });

    test('peak protection does not depend on excursion telemetry succeeding', async () => {
        const state = await fixture();
        state.quote(1.14);
        const engine = await state.boot();
        jest.spyOn(engine, 'recordSampledExcursion').mockRejectedValue(new Error('Telemetry unavailable'));
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(1.14);
    });

    test('failed peak persistence prevents a broker write until durable state can be saved', async () => {
        const state = await fixture();
        state.quote(1.14);
        const engine = await state.boot();
        const update = state.repository.updateTrade.getMockImplementation();
        state.repository.updateTrade.mockImplementation(async (id, changes) => {
            if (changes.brokerReconciliationPayload?.peakProfitTrail) throw new Error('Durable state unavailable');
            return update(id, changes);
        });
        await engine.monitorPositions();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(state.row().brokerReconciliationPayload.peakProfitTrail).toBeUndefined();
        state.repository.updateTrade.mockImplementation(update);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
    });

    test('a quote that crosses protection while the new peak is being persisted closes without an invalid stop write', async () => {
        const state = await fixture();
        const engine = await state.boot();
        oanda.getTrade.mockImplementationOnce(async () => {
            state.quote(1.14);
            return { trade: copy(state.broker) };
        });
        const update = state.repository.updateTrade.getMockImplementation();
        let crossed = false;
        state.repository.updateTrade.mockImplementation(async (id, changes) => {
            await update(id, changes);
            if (!crossed && changes.brokerReconciliationPayload?.peakProfitTrail?.peakPrice === 1.14) {
                crossed = true;
                state.advance();
                state.quote(1.129);
            }
        });
        await engine.monitorPositions();
        expect(crossed).toBe(true);
        expect(state.row()).toMatchObject({ isOpen: false, exitReason: 'PEAK_PROFIT_EXIT' });
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(1.14);
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(oanda.closeTrade).toHaveBeenCalledTimes(1);
    });

    test('a quote that ages during peak persistence cannot drive protection until a fresh receipt arrives', async () => {
        const state = await fixture();
        const engine = await state.boot();
        oanda.getTrade.mockImplementationOnce(async () => {
            state.quote(1.14);
            return { trade: copy(state.broker) };
        });
        const update = state.repository.updateTrade.getMockImplementation();
        let delayed = false;
        state.repository.updateTrade.mockImplementation(async (id, changes) => {
            await update(id, changes);
            if (!delayed && changes.brokerReconciliationPayload?.peakProfitTrail?.peakPrice === 1.14) {
                delayed = true;
                state.advance(31_000);
            }
        });
        await engine.monitorPositions();
        expect(delayed).toBe(true);
        expect(state.row()).toMatchObject({ isOpen: true, stopLossPrice: 1.08 });
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(1.14);
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        state.quote(1.131);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: true, stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.closeTrade).not.toHaveBeenCalled();
    });

    test('a lost successful write acknowledgment is confirmed from the actual broker stop', async () => {
        const state = await fixture();
        state.quote(1.14);
        const engine = await state.boot();
        oanda.modifyTrade.mockImplementationOnce(async (id, options) => {
            state.broker.stopLossOrder.price = String(options.stopLossPrice);
            return { lastTransactionID: '900' };
        });
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT', reconciliationStatus: 'OPEN' });
        expect(state.row().brokerReconciliationPayload.stopUpdate).toBeNull();
    });

    test.each(['rejected', 'unconfirmed'])('persists the peak before a broker %s write, then retries the same protection after restart', async (failure) => {
        const state = await fixture();
        state.quote(1.14);
        let engine = await state.boot();
        oanda.modifyTrade.mockImplementationOnce(async () => {
            expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(1.14);
            return failure === 'rejected'
                ? { stopLossOrderRejectTransaction: { type: 'STOP_LOSS_ORDER_REJECT', rejectReason: 'INTERNAL_SERVER_ERROR', tradeID: '490' } }
                : { lastTransactionID: '900' };
        });
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.08,
            reconciliationStatus: 'STOP_UPDATE_RETRY_PENDING' });
        expect(state.row().brokerReconciliationPayload.stopUpdate).toMatchObject({
            status: 'RETRY_PENDING', desiredPrice: 1.13, stopType: 'PEAK_PROFIT' });
        state.advance(6000);
        state.quote(1.131);
        // Reselection must also leave the owner and durable peak authoritative.
        Object.assign(state.configuration, { strategy: 'intraday_momentum', enablePeakProfitTrail: false });
        engine = await state.boot();
        await engine.monitorPositions();
        expect(oanda.modifyTrade.mock.calls.map(([, options]) => options.stopLossPrice)).toEqual([1.13, 1.13]);
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT', reconciliationStatus: 'OPEN' });
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(1.14);
        expect(state.row().brokerReconciliationPayload.stopUpdate).toBeNull();
    });

    test.each(['BUY', 'SELL'])('a crossed pending %s peak stop closes promptly rather than retrying an invalid order', async (side) => {
        const state = await fixture({ side });
        state.quote(side === 'BUY' ? 1.14 : 1.2599, side === 'BUY' ? 1.1401 : 1.26);
        const engine = await state.boot();
        oanda.modifyTrade.mockRejectedValueOnce(new Error('Broker unavailable'));
        await engine.monitorPositions();
        state.advance();
        state.quote(side === 'BUY' ? 1.129 : 1.2709, side === 'BUY' ? 1.1291 : 1.271);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: false, exitReason: 'PEAK_PROFIT_EXIT' });
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.closeTrade).toHaveBeenCalledTimes(1);
    });

    test('a persisted peak whose protection was not installed exits on restoration after a crossing', async () => {
        const now = Date.parse('2026-10-14T16:00:00Z');
        const state = await fixture({ now, trade: { brokerReconciliationPayload: { peakProfitTrail: {
            version: 1, peakPrice: 1.14, observedAt: now - 1000, quoteEventAt: now - 1000,
        } } } });
        state.quote(1.129);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: false, exitReason: 'PEAK_PROFIT_EXIT' });
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(oanda.closeTrade).toHaveBeenCalledTimes(1);
    });

    test('an overdue peak retry waits for a usable quote before validating and sending its stop', async () => {
        const state = await fixture();
        state.quote(1.14);
        const engine = await state.boot();
        oanda.modifyTrade.mockRejectedValueOnce(new Error('Broker unavailable'));
        await engine.monitorPositions();
        state.advance(31_000);
        await engine.monitorPositions();
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.closeTrade).not.toHaveBeenCalled();
        expect(state.row().brokerReconciliationPayload.stopUpdate).toMatchObject({
            status: 'RETRY_PENDING', desiredPrice: 1.13 });
        state.quote(1.131);
        await engine.monitorPositions();
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(2);
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
    });

    test('a stronger peak reached during retry backoff remains protected when the reversal has not crossed the older retry', async () => {
        const state = await fixture();
        state.quote(1.12);
        const engine = await state.boot();
        oanda.modifyTrade.mockRejectedValueOnce(new Error('Broker unavailable'));
        await engine.monitorPositions();
        expect(state.row().brokerReconciliationPayload.stopUpdate.desiredPrice).toBe(1.11);
        state.advance();
        state.quote(1.14);
        await engine.monitorPositions();
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(1.14);
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        state.advance();
        state.quote(1.129);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: false, exitReason: 'PEAK_PROFIT_EXIT' });
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
        expect(oanda.closeTrade).toHaveBeenCalledTimes(1);
    });

    test('a stronger broker-confirmed stop clears an older peak retry without loosening it', async () => {
        const state = await fixture();
        state.quote(1.14);
        let engine = await state.boot();
        oanda.modifyTrade.mockRejectedValueOnce(new Error('Lost response'));
        await engine.monitorPositions();
        state.broker.stopLossOrder.price = '1.135';
        state.advance(6000);
        state.quote(1.14);
        engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.135, trailingStopPrice: 1.135, reconciliationStatus: 'OPEN' });
        expect(state.row().brokerReconciliationPayload.stopUpdate).toBeNull();
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
    });

    test('a missing immutable initial risk never substitutes the current moving stop distance', async () => {
        const state = await fixture({ trade: { activeStopType: 'CHANNEL', stopLossPrice: 1.11 },
            runtime: { initialStopDistance: null, initialStopLossPrice: null } });
        state.quote(1.14);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(oanda.modifyTrade).not.toHaveBeenCalled();
        expect(state.row().stopLossPrice).toBe(1.11);
    });

    test('the explicit original stop can provide immutable risk when the stored distance is absent', async () => {
        const state = await fixture({ trade: { activeStopType: 'CHANNEL', stopLossPrice: 1.11 },
            runtime: { initialStopDistance: null, initialStopLossPrice: 1.08 } });
        state.quote(1.14);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
    });

    test('Friday flatten still takes priority without pricing, while paused entries retain weekday protection', async () => {
        const state = await fixture({ now: Date.parse('2026-10-23T20:44:00Z') });
        state.quote(1.14);
        const engine = await state.boot();
        engine.isRunning = false;
        state.configuration.enableTrading = false;
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: true, stopLossPrice: 1.13, activeStopType: 'PEAK_PROFIT' });
        state.advance(60_000);
        state.dataService.priceCache.EUR_USD = null;
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: false, exitReason: 'WEEKEND_CLOSE' });
        expect(oanda.modifyTrade).toHaveBeenCalledTimes(1);
    });

    test('trade 3550 retained executable quotes produce the rounded protection using original 72.1-pip risk', async () => {
        // Compact real quote path, from docs/reviews/evidence/2026-10-26/
        // latest-trade-profit-comparison.json and illustrative-exit-mechanics.json.
        // It demonstrates mechanics; the broker fill below is simulated and is
        // not a historical fill or a claim about hypothetical net performance.
        const [activation, peak, crossing] = trade3550.quotes;
        const state = await fixture({ now: Date.parse(activation.eventAt),
            instrument: trade3550.trade.instrument, side: trade3550.trade.side,
            trade: { oandaTradeId: trade3550.trade.oandaTradeId, units: trade3550.trade.units,
                entryPrice: trade3550.trade.entryPrice, stopLossPrice: trade3550.trade.initialStopLossPrice,
                entryTime: Date.parse(trade3550.trade.entryAt) } });
        state.quote(activation.ask - 0.01, activation.ask);
        const engine = await state.boot();
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: activation.expectedStop, activeStopType: 'PEAK_PROFIT' });
        state.advance(Date.parse(peak.eventAt) - state.now());
        state.quote(peak.ask - 0.01, peak.ask);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ stopLossPrice: peak.expectedStop, activeStopType: 'PEAK_PROFIT' });
        expect(state.row().brokerReconciliationPayload.liveRuntime).toMatchObject({
            initialStopLossPrice: 157.762 });
        expect(state.row().brokerReconciliationPayload.liveRuntime.initialStopDistance).toBeCloseTo(0.721);
        expect(state.row().brokerReconciliationPayload.peakProfitTrail.peakPrice).toBe(156.085);
        state.advance(Date.parse(crossing.eventAt) - state.now());
        state.quote(crossing.ask - 0.01, crossing.ask);
        state.brokerClose(crossing.ask);
        await engine.monitorPositions();
        expect(state.row()).toMatchObject({ isOpen: false, exitPrice: 156.449, activeStopType: 'PEAK_PROFIT' });
        expect(oanda.closeTrade).not.toHaveBeenCalled();
    });
});
