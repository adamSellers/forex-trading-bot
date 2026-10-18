const { createReplayTestHarness, fixtureArchive, START } = require('../fixtures/legacyReplayHarness.cjs');
const env = createReplayTestHarness();
const { buyEntryFixture } = require('../fixtures/causalFlows.cjs');

async function buyReplay(options = {}) {
    return env.replay({ input: fixtureArchive([buyEntryFixture({ instrument: 'EUR_USD', nowMs: START })]),
        assets: ['EUR_USD'], ...options });
}

describe('separate observed replay actions through production orchestration', () => {
    test('pending price polls, exact request budget, stale-response failure and valid old-event recovery retain receipt meaning', async () => {
        const h = await buyReplay({ pricingRequestTimeoutMs: 25 });
        const payload = await h.broker.getPricing(h.dataService.getPricingInstruments(), { includeHomeConversions: true });
        const initial = h.dataService.getCurrentPrice('EUR_USD');
        const first = h.startPricingRequest(START + 5000);
        expect(h.startPricingRequest(START + 5005)).toBeNull();
        expect(h.dataService.getCurrentPrice('EUR_USD').fetchedAt).toBe(initial.fetchedAt);
        await h.completePricingRequest(START + 5025, first, payload);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({ timestamp: initial.timestamp,
            fetchedAt: START + 5025, invalidReason: null, tradeable: true });

        const late = h.startPricingRequest(START + 5100);
        await h.completePricingRequest(START + 5126, late, payload);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({
            timestamp: initial.timestamp, fetchedAt: START + 5025, invalidReason: 'PRICE_REQUEST_TIMEOUT', tradeable: false });
        await h.scanAt(START + 5126);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(0);

        const recovered = h.startPricingRequest(START + 5200);
        await h.completePricingRequest(START + 5220, recovered, payload);
        await h.scanAt(START + 5220);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({
            timestamp: initial.timestamp, fetchedAt: START + 5220, invalidReason: null });
        expect(h.getPricingRequestLog().map((row) => row.requestDurationMs)).toEqual([25, 26, 20]);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('broker-held stop acts on a supplied source point before the app receives or manages it', async () => {
        const h = await buyReplay();
        await h.scanAt(START);
        const trade = (await h.repositories.trades.getAllTrades())[0];
        const cached = h.dataService.getCurrentPrice('EUR_USD');
        const quote = h.market.getQuote('EUR_USD');
        const bid = trade.stopLossPrice - 0.0001;
        const brokerPoint = { ...quote, time: new Date(START + 5000).toISOString(),
            researchObservation: 'EXPLICIT_SYNTHETIC_SOURCE_POINT',
            bids: [{ price: bid.toFixed(5), liquidity: 1_000_000 }],
            asks: [{ price: (bid + 0.00004).toFixed(5), liquidity: 1_000_000 }] };
        await h.observeBrokerPrice(START + 5000, 'EUR_USD', brokerPoint);
        expect((await h.broker.getTrade(trade.oandaTradeId)).trade.state).toBe('CLOSED');
        expect(h.engine.openTrades.size).toBe(1);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toEqual(cached);
        await h.manageAt(START + 10000);
        const snapshot = await h.snapshot();
        expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, exit_reason: 'STOP_LOSS',
            broker_closed_at: START + 5000 });
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(h.engine.openTrades.size).toBe(0);
        expect(snapshot.events.map((event) => event.kind)).toEqual(['SCAN', 'BROKER_PRICE', 'MANAGEMENT']);
        expect(env.networkAttempts).toBe(0);
    });

    test('a request without a declared completion remains pending and cannot refresh receipt', async () => {
        const h = await buyReplay();
        const before = h.dataService.getCurrentPrice('EUR_USD');
        const id = h.startPricingRequest(START + 5000);
        h.advanceTo(START + 5010);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toEqual(before);
        expect(h.getPricingRequestLog()).toEqual([{ id, requestedAtMs: START + 5000, requestedMonotonicMs: 5000,
            completedAtMs: null, completedMonotonicMs: null, requestDurationMs: null }]);
        await h.completePricingRequest(START + 5020, id, null, new Error('Declared response failure'));
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({
            fetchedAt: before.fetchedAt, timestamp: before.timestamp, invalidReason: 'PRICE_REQUEST_FAILED' });
        await expect(h.completePricingRequest(START + 5021, id, {})).rejects.toThrow('outstanding request');
    });
});
