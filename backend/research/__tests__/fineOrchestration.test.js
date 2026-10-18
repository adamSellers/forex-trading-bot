const { createReplayTestHarness, fixtureArchive, START } = require('../fixtures/legacyReplayHarness.cjs');
const env = createReplayTestHarness();
const { buyEntryFixture } = require('../fixtures/causalFlows.cjs');
const { HistoricalMarket } = require('../historicalMarket.cjs');
const { ObservedQuoteMarket } = require('../observedQuoteMarket.cjs');
const { FineEventSchedule } = require('../fineEventSchedule.cjs');
const { runFineSchedule } = require('../runFineSchedule.cjs');
const { describeM15Uncertainty } = require('../intrabarUncertainty.cjs');

const provenance = { kind: 'SYNTHETIC_FIXTURE', source: 'Explicit entry-derived polling-timing scenario; not historical quotes' };

async function fixtureReference() {
    const input = fixtureArchive([buyEntryFixture({ instrument: 'EUR_USD', nowMs: START })]);
    const h = await env.replay({ input, assets: ['EUR_USD'] });
    await h.scanAt(START);
    const trade = (await h.repositories.trades.getAllTrades())[0];
    const reference = { input, trade, quote: h.market.getQuote('EUR_USD'), bridge: h.market.getQuote('AUD_USD'),
        conversions: h.market.getHomeConversions() };
    await env.release(h);
    return reference;
}

function observationInputs(ref, heldThroughManagement) {
    const risk = ref.trade.entryPrice - ref.trade.stopLossPrice;
    const peak = ref.trade.entryPrice + risk * 1.1;
    const dipped = ref.trade.entryPrice - risk * 0.1;
    const dropAt = heldThroughManagement ? 11000 : 6000;
    function point(eventOffset, bid) {
        return { ...ref.quote, time: new Date(START + eventOffset).toISOString(),
            bids: [{ price: bid.toFixed(5), liquidity: 1_000_000 }],
            asks: [{ price: (bid + 0.00004).toFixed(5), liquidity: 1_000_000 }] };
    }
    const states = {
        initial: { at: START, quote: { ...ref.quote, time: new Date(START).toISOString() } },
        peak: { at: START + 5000, quote: point(5000, peak) },
        dipped: { at: START + dropAt, quote: point(dropAt, dipped) },
    };
    const quoteObservations = [], conversionObservations = [];
    for (const pollOffset of [0, 5000, 10000, 15000, 20000]) {
        const key = pollOffset === 0 ? 'initial' : pollOffset < dropAt ? 'peak' : 'dipped';
        const state = states[key];
        const receivedAtMs = START + pollOffset + (pollOffset === 5000 ? 10 : 0);
        quoteObservations.push({ deliveryId: `eur-${pollOffset}`, sourceEventId: `eur-${key}`,
            eventTimeMs: state.at, requestStartedAtMs: START + pollOffset, receivedAtMs,
            quote: state.quote, provenance });
        quoteObservations.push({ deliveryId: `aud-${pollOffset}`, sourceEventId: 'aud-unchanged',
            eventTimeMs: START, requestStartedAtMs: START + pollOffset, receivedAtMs,
            quote: { ...ref.bridge, time: new Date(START).toISOString() }, provenance });
        conversionObservations.push({ deliveryId: `conversion-${pollOffset}`, sourceEventId: 'conversion-unchanged',
            eventTimeMs: START, requestStartedAtMs: START + pollOffset, receivedAtMs,
            homeConversions: ref.conversions, provenance });
    }
    return { quoteObservations, conversionObservations };
}

async function fineReplay(ref, observations) {
    return env.replay({ input: ref.input, assets: ['EUR_USD'], marketFactory: ({ clock, input, pricingAssumptions }) => {
        const candleMarket = new HistoricalMarket({ ...input, clock, maxBars: 500, pricingAssumptions });
        return new ObservedQuoteMarket({ candleMarket, clock, ...observations, eventControlled: true });
    } });
}

function firstResponse(ref) {
    const all = observationInputs(ref, true);
    return { quoteObservations: all.quoteObservations.filter((row) => row.requestStartedAtMs === START),
        conversionObservations: all.conversionObservations.filter((row) => row.requestStartedAtMs === START) };
}

describe('fine source/delivery schedule through the current persisted runtime', () => {
    test.each([false, true])('breakeven depends on the supplied price at the management poll (held=%s)', async (held) => {
        const ref = await fixtureReference();
        const observations = observationInputs(ref, held);
        const h = await fineReplay(ref, observations);
        const schedule = new FineEventSchedule({ fromMs: START, toMsExclusive: START + 21000, ...observations });
        const execution = await runFineSchedule({ harness: h, schedule });
        const snapshot = await h.snapshot();
        expect(snapshot.tables.trades).toHaveLength(1);
        expect(snapshot.tables.broker_order_intents).toHaveLength(1);
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(execution.pricingRequests.map((row) => row.requestDurationMs)).toEqual([0, 10, 0, 0, 0]);
        expect(execution.pendingPricingRequests).toBe(0);
        expect(execution.unresolvedDeliveries).toHaveLength(0);
        // Both supplied paths fit this same component OHLC. The timing of its
        // peak relative to management differs, so it cannot prove a BE update.
        const risk = ref.trade.entryPrice - ref.trade.stopLossPrice;
        const diagnostic = describeM15Uncertainty({ side: 'BUY', entryPrice: ref.trade.entryPrice,
            stopLossPrice: ref.trade.stopLossPrice, takeProfitPrice: ref.trade.takeProfitPrice,
            breakevenTriggerPrice: ref.trade.entryPrice + risk, activeFromMs: START,
            bar: { time: START / 1000, complete: true, bid: {
                o: Number(ref.quote.bids[0].price), h: ref.trade.entryPrice + risk * 1.1,
                l: ref.trade.entryPrice - risk * 0.1, c: ref.trade.entryPrice - risk * 0.1 } } });
        expect(diagnostic.breakevenActivationUnresolved).toBe(true);
        expect(diagnostic.exhaustiveBound).toMatchObject({ status: 'NOT_ESTABLISHED',
            lowerNetAud: null, upperNetAud: null, lowerNetR: null, upperNetR: null });
        expect(h.dataService.getCurrentPrice('AUD_USD')).toMatchObject({ timestamp: START, fetchedAt: START + 20000 });
        if (held) {
            expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, breakeven_hit: 1,
                active_stop_type: 'BREAKEVEN', exit_reason: 'BREAKEVEN_STOP', broker_closed_at: START + 11000 });
        } else {
            expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 1, breakeven_hit: 0,
                active_stop_type: 'INITIAL_STOP', stop_loss_price: ref.trade.stopLossPrice });
        }
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('fine startup has no local quote receipt until its declared response completes', async () => {
        const ref = await fixtureReference();
        const observations = firstResponse(ref);
        for (const row of [...observations.quoteObservations, ...observations.conversionObservations]) row.receivedAtMs += 20;
        const h = await fineReplay(ref, observations);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toBeNull();
        expect(h.dataService.homeConversionCache.USD).toBeUndefined();
        const execution = await runFineSchedule({ harness: h, schedule: new FineEventSchedule({
            fromMs: START, toMsExclusive: START + 21, ...observations }) });
        // The only scheduled scan was at startup, before the response at +20ms.
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(0);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({ timestamp: START, fetchedAt: START + 20 });
        expect(execution.pricingRequests[0].requestDurationMs).toBe(20);
        await h.scanAt(START + 20);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(env.networkAttempts).toBe(0);
    });

    test('partial poll marks an absent bridge unavailable while separately observed broker pricing supports valid entry', async () => {
        const ref = await fixtureReference();
        const observations = firstResponse(ref);
        // AUD exists at the broker, but is absent from the startup response.
        // The engine's separate preliminary conversion/final-pricing requests
        // use the explicitly supplied source book (zero modeled latency).
        const bridge = observations.quoteObservations.find((row) => row.quote.instrument === 'AUD_USD');
        bridge.requestStartedAtMs = START + 5000;
        bridge.receivedAtMs = START + 5000;
        const h = await fineReplay(ref, observations);
        const execution = await runFineSchedule({ harness: h, schedule: new FineEventSchedule({
            fromMs: START, toMsExclusive: START + 1, ...observations }) });
        expect(execution.deliveredResponseGroups[0].missingRequestedInstruments).toEqual(['AUD_USD']);
        expect(h.dataService.getCurrentPrice('AUD_USD')).toMatchObject({ tradeable: false, invalidReason: 'PRICE_MISSING' });
        expect(h.dataService.homeConversionCache.USD).toMatchObject({ accountGain: expect.any(Number) });
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(env.networkAttempts).toBe(0);
    });

    test('an unchanged pre-start broker event supports a healthy current receipt without a fabricated startup receipt', async () => {
        const ref = await fixtureReference();
        const observations = firstResponse(ref);
        for (const row of [...observations.quoteObservations, ...observations.conversionObservations]) {
            row.eventTimeMs = START - 1000;
            if (row.quote) row.quote.time = new Date(row.eventTimeMs).toISOString();
        }
        const h = await fineReplay(ref, observations);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toBeNull();
        expect(h.dataService.homeConversionCache.USD).toBeUndefined();
        const execution = await runFineSchedule({ harness: h, schedule: new FineEventSchedule({
            fromMs: START, toMsExclusive: START + 1, ...observations }) });
        expect(execution.dispatchLedger.filter((row) => row.eventType === 'BROKER_PRICE')).toHaveLength(0);
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({ timestamp: START - 1000, fetchedAt: START });
        expect(execution.pricingRequests[0].requestDurationMs).toBe(0);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(env.networkAttempts).toBe(0);
    });

    test.each(['unmeasured', 'conversion_only'])('%s delivery cannot invent a pricing response or successful receipt', async (kind) => {
        const ref = await fixtureReference();
        const observations = firstResponse(ref);
        if (kind === 'unmeasured') {
            for (const row of [...observations.quoteObservations, ...observations.conversionObservations]) row.requestStartedAtMs = null;
        } else observations.quoteObservations = [];
        const h = await fineReplay(ref, observations);
        const execution = await runFineSchedule({ harness: h, schedule: new FineEventSchedule({
            fromMs: START, toMsExclusive: START + 1, ...observations }) });
        expect(h.dataService.getCurrentPrice('EUR_USD')).toBeNull();
        expect(execution.deliveredResponseGroups).toHaveLength(0);
        expect(execution.pendingPricingRequests).toBe(1);
        expect(execution.unresolvedDeliveries[0].reason).toBe(kind === 'unmeasured'
            ? 'UNMEASURED_REQUEST_START' : 'NO_QUOTE_ROWS_FOR_PRICING_RESPONSE');
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('a response attributed to a skipped poll remains unresolved while the actual older request can complete', async () => {
        const ref = await fixtureReference();
        const all = observationInputs(ref, true);
        const observations = { quoteObservations: all.quoteObservations.filter((row) => row.requestStartedAtMs <= START + 5000),
            conversionObservations: all.conversionObservations.filter((row) => row.requestStartedAtMs <= START + 5000) };
        for (const row of [...observations.quoteObservations, ...observations.conversionObservations]) {
            row.receivedAtMs = row.requestStartedAtMs === START ? START + 6000 : START + 5100;
        }
        const h = await fineReplay(ref, observations);
        const execution = await runFineSchedule({ harness: h, schedule: new FineEventSchedule({
            fromMs: START, toMsExclusive: START + 6001, ...observations }) });
        expect(execution.pricingRequests).toHaveLength(1);
        expect(execution.pricingRequests[0].requestDurationMs).toBe(6000);
        expect(execution.pendingPricingRequests).toBe(0);
        expect(execution.unresolvedDeliveries[0].reason).toBe('POLL_SKIPPED_WHILE_BUSY');
        expect(h.dataService.getCurrentPrice('EUR_USD')).toMatchObject({ timestamp: START, fetchedAt: START + 6000 });
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(0);
        expect(env.networkAttempts).toBe(0);
    });
});
