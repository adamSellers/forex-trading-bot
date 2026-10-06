const { ReplayBroker, ReplayDataError } = require('../replayBroker.cjs');
const TradeReconciliationService = require('../../src/services/tradeReconciliationService');

const START = Date.parse('2026-10-05T22:00:00Z');
const METADATA = {
    AUD_USD: { name: 'AUD_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05' },
    EUR_USD: { name: 'EUR_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05' },
    USD_JPY: { name: 'USD_JPY', displayPrecision: 3, pipLocation: -2, marginRate: '0.05' },
};

// Independent service-shaped observations: each price book, liquidity amount,
// conversion direction and tradeability assumption is explicitly supplied.
function fixture(options = {}) {
    let now = START;
    const clock = { nowMs: () => now, advance: (ms) => { now += ms; } };
    const quotes = new Map();
    let conversions = [
        { currency: 'USD', positionValue: '1.5', accountGain: '1.4', accountLoss: '1.6' },
        { currency: 'EUR', positionValue: '1.7', accountGain: '1.65', accountLoss: '1.75' },
        { currency: 'JPY', positionValue: '0.01', accountGain: '0.009', accountLoss: '0.011' },
    ];
    const setQuote = (instrument, bid, ask, extra = {}) => {
        const quote = { instrument, time: new Date(now).toISOString(), status: 'tradeable', tradeable: true,
            bids: [{ price: String(bid), liquidity: 1000000 }],
            asks: [{ price: String(ask), liquidity: 1000000 }], ...extra };
        quotes.set(instrument, quote);
        return quote;
    };
    setQuote('AUD_USD', 0.7, 0.7002);
    setQuote('EUR_USD', 1.1, 1.1002);
    setQuote('USD_JPY', 150, 150.02);
    const market = { getQuote: (instrument) => quotes.get(instrument), getHomeConversions: () => conversions };
    const broker = new ReplayBroker({ clock, market, metadata: METADATA, ...options });
    return { clock, quotes, market, broker, setQuote, setConversions: (rows) => { conversions = rows; } };
}

async function open(broker, instrument = 'AUD_USD', units = 100, options = {}) {
    const response = await broker.placeMarketOrder(instrument, units, options);
    expect(response.orderFillTransaction).toBeDefined();
    return { response, id: response.orderFillTransaction.tradeOpened.tradeID };
}

describe('ReplayBroker service and accounting contracts', () => {
    test('initializes a flat AUD account without inventing conversion or price observations', async () => {
        const clock = { nowMs: () => START };
        const market = { getQuote: () => null, getHomeConversions: () => null };
        const broker = new ReplayBroker({ clock, market });
        const result = await broker.initialize();
        expect(result.account).toMatchObject({ currency: 'AUD', balance: '100', NAV: '100',
            unrealizedPL: '0', marginUsed: '0', marginAvailable: '100', openTradeCount: 0 });
        expect(await broker.getOpenTrades()).toEqual({ trades: [], lastTransactionID: '0' });
        expect(broker.snapshot().transactions).toEqual([]);
    });

    test.each([100, -100])('bid/ask entry and liquidation for %i units count the spread once', async (units) => {
        const { broker } = fixture();
        const { id, response } = await open(broker, 'AUD_USD', units);
        expect(response.orderFillTransaction.price).toBe(units > 0 ? '0.70020' : '0.70000');
        const account = (await broker.getAccountSummary()).account;
        expect(Number(account.unrealizedPL)).toBeCloseTo(-0.032, 12);
        expect(Number(account.NAV)).toBeCloseTo(99.968, 12);
        expect(Number(account.marginUsed)).toBe(5);
        expect(Number(account.marginAvailable)).toBeCloseTo(94.968, 12);
        const result = await broker.closeTrade(id);
        expect(Number(result.orderFillTransaction.pl)).toBeCloseTo(-0.032, 12);
        const closed = (await broker.getTrade(id)).trade;
        expect(closed).toMatchObject({ state: 'CLOSED', currentUnits: '0', commission: '0', financing: '0' });
        expect(Number(closed.realizedPL)).toBeCloseTo(-0.032, 12);
        expect((await broker.getAccountSummary()).account.balance).toBe(String(100 + Number(closed.realizedPL)));
        expect(Number((await broker.getAccountSummary()).account.marginUsed)).toBe(0);
    });

    test('gain/loss conversion and margin are marked at the current explicit observations', async () => {
        const { broker, setQuote, setConversions, clock } = fixture();
        const { id } = await open(broker, 'EUR_USD', 100);
        expect(Number((await broker.getAccountSummary()).account.marginUsed)).toBe(8.5);
        clock.advance(60000);
        setQuote('EUR_USD', 1.1012, 1.1014);
        setConversions([{ currency: 'USD', positionValue: '1.5', accountGain: '1.3', accountLoss: '1.8' },
            { currency: 'EUR', positionValue: '1.8', accountGain: '1.7', accountLoss: '1.9' }]);
        expect(Number((await broker.getAccountSummary()).account.unrealizedPL)).toBeCloseTo(0.13, 12);
        expect(Number((await broker.getAccountSummary()).account.marginUsed)).toBe(9);
        setQuote('EUR_USD', 1.0992, 1.0994);
        expect(Number((await broker.getAccountSummary()).account.unrealizedPL)).toBeCloseTo(-0.18, 12);
        const result = await broker.closeTrade(id);
        expect(Number(result.orderFillTransaction.pl)).toBeCloseTo(-0.18, 12);
    });

    test('slippage, commission and timestamped financing settle once and reconcile lifetime net costs', async () => {
        const { broker, setQuote, clock } = fixture({ slippagePips: 0.5, commissionAud: 0.01 });
        const { id } = await open(broker, 'AUD_USD', 100, { orderIntentId: 'cost-intent' });
        expect((await broker.getTrade(id)).trade.price).toBe('0.70025');
        expect(broker.balanceAud).toBe(99.99);
        clock.advance(60000);
        expect(broker.applyFinancing({ id: 'finance-1', tradeId: id, amountAud: -0.03 })).toBe(true);
        expect(broker.applyFinancing({ id: 'finance-1', tradeId: id, amountAud: -0.03 })).toBe(false);
        expect(() => broker.applyFinancing({ id: 'finance-1', tradeId: id, amountAud: -0.04 })).toThrow(/different contents/);
        expect(() => broker.applyFinancing({ id: 'finance-2', tradeId: id, amountAud: -0.03, atMs: START })).toThrow(/current replay event time/);
        setQuote('AUD_USD', 0.70125, 0.70145);
        const close = await broker.closeTrade(id);
        expect(Number(close.orderFillTransaction.price)).toBe(0.7012);
        expect(Number(close.orderFillTransaction.commission)).toBe(0.01);
        const details = await broker.getTrade(id);
        expect(Number(details.trade.realizedPL)).toBeCloseTo(0.133, 12);
        expect(details.trade).toMatchObject({ commission: '0.02', financing: '-0.03' });
        const reconciler = new TradeReconciliationService();
        const external = reconciler.resolveExternalClose({ localTrade: { oandaTradeId: id, instrument: 'AUD_USD' }, tradeDetails: details });
        expect(external.brokerAccountingComplete).toBe(true);
        expect(external.oandaGrossRealizedPL).toBeCloseTo(0.133, 12);
        expect(external.oandaRealizedPL).toBeCloseTo(0.083, 12);
        expect(broker.balanceAud - 100).toBeCloseTo(external.oandaRealizedPL, 12);
        expect(broker.getLedger().filter((row) => row.type === 'FINANCING_APPLIED')).toHaveLength(1);
        expect(() => broker.applyFinancing({ id: 'after-close', tradeId: id, amountAud: -0.03 })).toThrow(/not open/);
    });

    test('entry consumes normal liquidity while marking and closing use explicitly supplied closeout prices', async () => {
        const { broker, setQuote } = fixture();
        setQuote('AUD_USD', 0.7, 0.7002, { closeoutBid: '0.6998', closeoutAsk: '0.7004' });
        const { id } = await open(broker);
        expect((await broker.getTrade(id)).trade.price).toBe('0.70020');
        expect(Number((await broker.getAccountSummary()).account.unrealizedPL)).toBeCloseTo(-0.064, 12);
        expect(Number((await broker.closeTrade(id)).orderFillTransaction.price)).toBe(0.6998);
    });
});

describe('ReplayBroker order outcomes and unknown evidence', () => {
    test('normal depth gives VWAP and worst level; FOK bounds reject a violating level even if mean fits', async () => {
        const { broker, setQuote } = fixture();
        const quote = setQuote('AUD_USD', 0.7, 0.7002, {
            bids: [{ price: '0.6998', liquidity: 50 }, { price: '0.7000', liquidity: 50 }],
            asks: [{ price: '0.7005', liquidity: 50 }, { price: '0.7002', liquidity: 50 }],
        });
        const executable = broker.getExecutableQuote(quote, 'BUY', 100);
        expect(executable).toMatchObject({ worstPrice: 0.7005, units: 100 });
        expect(executable.executablePrice).toBeCloseTo(0.70035, 12);
        const rejected = await broker.placeMarketOrder('AUD_USD', 100, { priceBound: 0.7004, orderIntentId: 'bound-buy' });
        expect(rejected.orderRejectTransaction.rejectReason).toBe('PRICE_BOUND_EXCEEDED');
        expect(rejected.orderFillTransaction).toBeUndefined();
        expect((await broker.findOrderIntent('bound-buy')).status).toBe('REJECTED');
        expect((await broker.getOpenTrades()).trades).toEqual([]);
        const sell = await broker.placeMarketOrder('AUD_USD', -100, { priceBound: 0.6999, orderIntentId: 'bound-sell' });
        expect(sell.orderRejectTransaction.rejectReason).toBe('PRICE_BOUND_EXCEEDED');
        expect(broker.balanceAud).toBe(100);
        const accepted = await broker.placeMarketOrder('AUD_USD', 100, { priceBound: 0.7005 });
        expect(accepted.orderFillTransaction.price).toBe('0.70035');
    });

    test('whole units, explicit liquidity and available margin produce terminal no-fill outcomes', async () => {
        const { broker, setQuote } = fixture();
        expect((await broker.placeMarketOrder('AUD_USD', 1.5)).errorCode).toBe('UNITS_INVALID');
        expect((await broker.placeMarketOrder('AUD_USD', 0)).errorCode).toBe('UNITS_INVALID');
        setQuote('AUD_USD', 0.7, 0.7002, { bids: [{ price: '0.7', liquidity: 10 }], asks: [{ price: '0.7002', liquidity: 10 }] });
        expect((await broker.placeMarketOrder('AUD_USD', 11)).errorCode).toBe('INSUFFICIENT_LIQUIDITY');
        setQuote('AUD_USD', 0.7, 0.7002);
        expect((await broker.placeMarketOrder('AUD_USD', 2000, { orderIntentId: 'no-margin' })).errorCode).toBe('INSUFFICIENT_MARGIN');
        expect((await broker.findOrderIntent('no-margin')).status).toBe('REJECTED');
        expect(broker.balanceAud).toBe(100);
        expect((await broker.getOpenTrades()).trades).toHaveLength(0);
        await open(broker, 'AUD_USD', 100);
    });

    test('JPY and non-JPY precision and bounds use explicit broker metadata', async () => {
        const { broker } = fixture();
        expect(broker.formatPrice('AUD_USD', 0.700234)).toBe('0.70023');
        expect(broker.formatPrice('USD_JPY', 150.0234)).toBe('150.023');
        expect(broker.getPipValue('USD_JPY')).toBe(0.01);
        expect(broker.formatPriceBound('AUD_USD', 0.700236, 'BUY')).toBe('0.70023');
        expect(broker.formatPriceBound('AUD_USD', 0.700234, 'SELL')).toBe('0.70024');
        const { id } = await open(broker, 'USD_JPY', 100);
        expect((await broker.getTrade(id)).trade.price).toBe('150.020');
        expect(Number((await broker.getAccountSummary()).account.marginUsed)).toBe(7.5);
        expect(Number((await broker.closeTrade(id)).orderFillTransaction.pl)).toBeCloseTo(-0.022, 12);
        await expect(broker.placeMarketOrder('GBP_USD', 100)).rejects.toMatchObject({ code: 'REPLAY_METADATA_UNAVAILABLE' });
        const unknownPrecision = fixture({ metadata: { AUD_USD: { pipLocation: -4, marginRate: '0.05' } } }).broker;
        await expect(unknownPrecision.placeMarketOrder('AUD_USD', 100)).rejects.toMatchObject({ code: 'REPLAY_METADATA_UNAVAILABLE' });
    });

    test.each([null, undefined, ''])('missing conversion %s remains unknown instead of becoming zero', async (value) => {
        const { broker, setConversions } = fixture();
        setConversions([{ currency: 'USD', positionValue: '1.5', accountGain: '1.4', accountLoss: value }]);
        await expect(broker.placeMarketOrder('AUD_USD', 100)).rejects.toMatchObject({ code: 'REPLAY_CONVERSION_UNAVAILABLE' });
        expect(broker.balanceAud).toBe(100);
        expect(broker.snapshot().trades).toEqual([]);
        expect(broker.snapshot().transactions).toEqual([]);
    });

    test('unavailable quotes, unobserved tradeability and duplicate conversion rows cannot create a fill', async () => {
        const { broker, setQuote, setConversions } = fixture();
        setQuote('AUD_USD', 0.7, 0.7002, { bids: [], asks: [] });
        await expect(broker.placeMarketOrder('AUD_USD', 100)).rejects.toMatchObject({ code: 'REPLAY_QUOTE_UNAVAILABLE' });
        setQuote('AUD_USD', 0.7, 0.7002, { tradeable: undefined, status: undefined });
        await expect(broker.placeMarketOrder('AUD_USD', 100)).rejects.toMatchObject({ code: 'REPLAY_TRADEABILITY_UNAVAILABLE' });
        setQuote('AUD_USD', 0.7, 0.7002);
        const row = { currency: 'USD', positionValue: '1.5', accountGain: '1.4', accountLoss: '1.6' };
        setConversions([row, row]);
        await expect(broker.placeMarketOrder('AUD_USD', 100)).rejects.toMatchObject({ code: 'REPLAY_CONVERSION_UNAVAILABLE' });
        expect(broker.snapshot().transactions).toHaveLength(0);
    });

    test('an explicit non-tradeable observation preserves exposure and a later valid observation permits closing', async () => {
        const { broker, setQuote } = fixture();
        const { id } = await open(broker);
        setQuote('AUD_USD', 0.699, 0.6992, { status: 'non-tradeable', tradeable: false });
        expect(broker.observePrice('AUD_USD')).toEqual([]);
        await expect(broker.closeTrade(id)).rejects.toMatchObject({ code: 'REPLAY_MARKET_NOT_TRADEABLE' });
        expect((await broker.placeMarketOrder('AUD_USD', 100)).errorCode).toBe('INSTRUMENT_NOT_TRADEABLE');
        expect((await broker.getTrade(id)).trade.state).toBe('OPEN');
        setQuote('AUD_USD', 0.699, 0.6992);
        expect((await broker.closeTrade(id)).orderFillTransaction.tradesClosed).toHaveLength(1);
    });

    test('persisted client intent recovery remains FILLED after closure and blocks resubmission', async () => {
        const { broker } = fixture();
        const { id, response } = await open(broker, 'AUD_USD', 100, { orderIntentId: 'recover-1' });
        const found = await broker.findOrderIntent('recover-1');
        expect(found).toMatchObject({ status: 'FILLED', trade: { id, state: 'OPEN' },
            orderFillTransaction: response.orderFillTransaction });
        expect(found.transactions.map((row) => row.type)).toEqual(['MARKET_ORDER', 'ORDER_FILL']);
        await expect(broker.placeMarketOrder('AUD_USD', 100, { orderIntentId: 'recover-1' })).rejects.toMatchObject({ code: 'REPLAY_DUPLICATE_INTENT' });
        await broker.closeTrade(id);
        expect(await broker.findOrderIntent('recover-1')).toMatchObject({ status: 'FILLED', trade: { state: 'CLOSED' },
            orderFillTransaction: response.orderFillTransaction });
        expect(await broker.findOrderIntent('never-submitted')).toMatchObject({ status: 'AMBIGUOUS', transactions: [] });
    });
});

describe('ReplayBroker protection only at supplied quote points', () => {
    test.each([{ units: 100, stop: 0.6992, bid: 0.6990, ask: 0.6992, fill: 0.69895 },
        { units: -100, stop: 0.7010, bid: 0.7009, ask: 0.7011, fill: 0.70115 }])(
    'held stop for $units units triggers on the executable exit side, including supplied gap and slippage', async ({ units, stop, bid, ask, fill }) => {
        const { broker, setQuote, clock } = fixture({ slippagePips: 0.5 });
        const { id } = await open(broker, 'AUD_USD', units, { stopLossPrice: stop });
        expect(broker.observePrice('AUD_USD')).toEqual([]);
        clock.advance(900000);
        setQuote('AUD_USD', bid, ask);
        const closes = broker.observePrice('AUD_USD');
        expect(closes).toHaveLength(1);
        expect(closes[0].orderFillTransaction.reason).toBe('STOP_LOSS_ORDER');
        expect(Number(closes[0].orderFillTransaction.price)).toBe(fill);
        expect((await broker.getTrade(id)).trade.stopLossOrder.state).toBe('FILLED');
        expect(broker.observePrice('AUD_USD')).toEqual([]);
    });

    test.each([{ units: 100, target: 0.7012, bid: 0.7012, ask: 0.7014 },
        { units: -100, target: 0.6990, bid: 0.6988, ask: 0.6990 }])(
    'held target for $units units closes at its threshold or better despite adverse slippage', async ({ units, target, bid, ask }) => {
        const { broker, setQuote } = fixture({ slippagePips: 0.5 });
        const { id } = await open(broker, 'AUD_USD', units, { takeProfitPrice: target });
        setQuote('AUD_USD', bid, ask);
        const close = broker.observePrice('AUD_USD')[0];
        expect(close.orderFillTransaction.reason).toBe('TAKE_PROFIT_ORDER');
        expect(Number(close.orderFillTransaction.price)).toBe(target);
        const reconciled = new TradeReconciliationService().resolveExternalClose({
            localTrade: { oandaTradeId: id, instrument: 'AUD_USD' }, tradeDetails: await broker.getTrade(id) });
        expect(reconciled.exitReason).toBe('TAKE_PROFIT');
    });

    test('normal DEFAULT trigger uses bid rather than a worse closeout mark; a supplied override leaves market intact', async () => {
        const { broker, setQuote, market } = fixture();
        const { id } = await open(broker, 'AUD_USD', 100, { stopLossPrice: 0.6992 });
        const quote = setQuote('AUD_USD', 0.7, 0.7002, { closeoutBid: '0.6990' });
        expect(Number((await broker.getAccountSummary()).account.unrealizedPL)).toBeCloseTo(-0.192, 12);
        expect(broker.observePrice('AUD_USD')).toEqual([]);
        const hypothetical = { ...quote, bids: [{ price: '0.6991', liquidity: 1000000 }], closeoutBid: '0.69905' };
        expect(broker.observePrice('AUD_USD', hypothetical)).toHaveLength(1);
        expect(market.getQuote('AUD_USD')).toBe(quote);
        expect((await broker.getTrade(id)).trade.averageClosePrice).toBe('0.69905');
    });

    test('only supplied points trigger protections; unavailable intrabar highs/lows and elapsed time provide no fill evidence', async () => {
        const { broker, clock, setQuote } = fixture();
        const { id } = await open(broker, 'AUD_USD', 100, { stopLossPrice: 0.6992, takeProfitPrice: 0.7012 });
        clock.advance(900000);
        setQuote('AUD_USD', 0.7003, 0.7005, { hypotheticalCandle: { low: 0.698, high: 0.702 } });
        expect(broker.observePrice('AUD_USD')).toEqual([]);
        expect((await broker.getTrade(id)).trade.state).toBe('OPEN');
        expect(broker.snapshot().assumptions.priceEvidence).toBe('supplied_quote_points_only');
    });

    test('protection modification exposes confirmable broker prices and full close remains possible', async () => {
        const { broker, setQuote } = fixture();
        const { id } = await open(broker, 'AUD_USD', 100, { stopLossPrice: 0.6992, takeProfitPrice: 0.7012 });
        setQuote('AUD_USD', 0.7005, 0.7007);
        const result = await broker.modifyTrade(id, { stopLossPrice: 0.7002, takeProfitPrice: 0.701234 });
        expect(result.stopLossOrderTransaction).toMatchObject({ type: 'STOP_LOSS', tradeID: id, price: '0.70020' });
        expect(result.stopLossOrderCancelTransaction).toMatchObject({ type: 'ORDER_CANCEL', tradeID: id });
        expect(result.takeProfitOrderTransaction.price).toBe('0.70123');
        expect((await broker.getTrade(id)).trade.stopLossOrder).toMatchObject({ state: 'PENDING', price: '0.70020' });
        await expect(broker.modifyTrade(id, { stopLossPrice: -1 })).rejects.toBeInstanceOf(ReplayDataError);
        expect((await broker.getTrade(id)).trade.stopLossOrder.price).toBe('0.70020');
        await expect(broker.modifyTrade(id, { trailingStopDistance: 0.001 })).rejects.toThrow(/unsupported/);
        await expect(broker.closeTrade(id, 50)).rejects.toThrow(/Partial trade closure is unsupported/);
        expect((await broker.closeTrade(id)).orderFillTransaction.tradesClosed).toHaveLength(1);
    });

    test('identical chronological inputs produce identical IDs, transactions and ledger snapshots', async () => {
        const run = async () => {
            const { broker, clock, setQuote } = fixture({ commissionAud: 0.01 });
            const { id } = await open(broker, 'AUD_USD', 100, { orderIntentId: 'deterministic', stopLossPrice: 0.6992 });
            clock.advance(60000);
            broker.applyFinancing({ id: 'carry-1', tradeId: id, amountAud: -0.01 });
            setQuote('AUD_USD', 0.6991, 0.6993);
            broker.observePrice('AUD_USD');
            return broker.snapshot();
        };
        const first = await run();
        expect(await run()).toEqual(first);
        expect(first.transactions.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5']);
    });
});
