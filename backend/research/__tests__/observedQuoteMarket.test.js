'use strict';

const { ObservedQuoteMarket, normalizeObservationStreams } = require('../observedQuoteMarket.cjs');
const { HistoricalMarket } = require('../historicalMarket.cjs');
const { ReplayClock } = require('../replayClock.cjs');
const { ReplayBroker } = require('../replayBroker.cjs');
const { FineEventSchedule } = require('../fineEventSchedule.cjs');
const { normalizeOandaPrice, evaluatePriceAvailability } = require('../../src/runtime/quoteAvailability');

const START = Date.parse('2026-10-05T22:00:00Z');
const provenance = { kind: 'SYNTHETIC_FIXTURE', source: 'independent-explicit-point-fixture' };
function quote(eventTimeMs, bid = 1.1, ask = 1.1002) {
    return { instrument: 'EUR_USD', time: new Date(eventTimeMs).toISOString(), tradeable: true,
        bids: [{ price: String(bid), liquidity: 10000 }], asks: [{ price: String(ask), liquidity: 10000 }] };
}
function delivery(sourceEventId, deliveryId, eventTimeMs, receivedAtMs, options = {}) {
    return { sourceEventId, deliveryId, eventTimeMs, receivedAtMs, requestStartedAtMs: receivedAtMs - 2,
        quote: quote(eventTimeMs), provenance, ...options };
}
function fixture(quoteObservations = [], conversionObservations = [], options = {}) {
    const clock = new ReplayClock(START);
    const value = { o: 1.1, h: 1.2, l: 1, c: 1.1 };
    const candleMarket = new HistoricalMarket({ clock, candlesByInstrument: { EUR_USD: [
        { time: START / 1000 - 900, mid: value, bid: value, ask: value, complete: true },
        { time: START / 1000, mid: value, bid: value, ask: value, complete: true },
    ] } });
    const market = new ObservedQuoteMarket({ clock, candleMarket, quoteObservations, conversionObservations, ...options });
    return { clock, market, advance: (at) => { clock.set(at); return market.advanceTo(at); } };
}

test('source protection evidence appears before delivery and future events cannot leak through local quotes', () => {
    const observation = delivery('event-1', 'reply-1', START + 5, START + 20);
    const { market, advance } = fixture([observation]);
    expect(market.getQuote('EUR_USD').reason).toBe('NO_DELIVERED_QUOTE_OBSERVATION');
    expect(market.getBrokerQuote('EUR_USD').reason).toBe('NO_SOURCE_QUOTE_EVENT');
    advance(START + 5);
    expect(market.brokerView().getQuote('EUR_USD').bids).toEqual(observation.quote.bids);
    expect(market.getQuote('EUR_USD').bids).toEqual([]);
    expect(() => market.getDeliveriesAt(START + 20)).toThrow('Future deliveries');
    advance(START + 20);
    expect(market.getQuote('EUR_USD').researchObservation).toMatchObject({ channel: 'DELIVERED',
        sourceEventId: 'event-1', deliveryId: 'reply-1', eventTimeMs: START + 5, receivedAtMs: START + 20,
        declaredRequestElapsedMs: 2, requestElapsedBasis: 'DECLARED_ALIGNED_WALL_INPUT_DIFFERENCE' });
    expect(market.getDeliveriesAt(START + 20).quoteDeliveries).toHaveLength(1);
    expect(market.getCandles('EUR_USD')).toHaveLength(1);
    advance(START + 900000);
    expect(market.getCandles('EUR_USD')).toHaveLength(2);
});

test('an unchanged source event can have a healthy new explicit response without a fabricated receipt on cache reads', () => {
    const first = delivery('event-1', 'reply-1', START - 1000, START);
    const second = { ...first, deliveryId: 'reply-2', receivedAtMs: START + 60000, requestStartedAtMs: START + 59998 };
    const { market, advance } = fixture([first, second]);
    advance(START + 40000);
    const cached = market.getQuote('EUR_USD');
    expect(cached.researchObservation.receivedAtMs).toBe(START);
    const stale = normalizeOandaPrice(cached, { instrument: 'EUR_USD', fetchedAt: cached.researchObservation.receivedAtMs });
    expect(evaluatePriceAvailability(stale, { nowMs: START + 40000, maxAgeMs: 20000 }).reason).toBe('STALE_PRICE');
    advance(START + 60000);
    const received = market.getQuote('EUR_USD');
    expect(received.time).toBe(first.quote.time);
    expect(received.researchObservation.receivedAtMs).toBe(START + 60000);
    expect(evaluatePriceAvailability(normalizeOandaPrice(received, { instrument: 'EUR_USD', fetchedAt: START + 60000 }),
        { nowMs: START + 60000, maxAgeMs: 20000 }).available).toBe(true);
    expect(market.summary().coverage).toMatchObject({ sourceEvents: 1, quoteDeliveries: 2 });
});

test('controlled startup seeds only prior explicit broker sources and accepts a healthy current receipt of an old source event', () => {
    const old = delivery('prior-price', 'prior-response', START - 1000, START - 500);
    const current = { ...old, deliveryId: 'current-response', receivedAtMs: START, requestStartedAtMs: START };
    const equalNow = delivery('equal-now-price', 'later-response', START, START + 100,
        { quote: quote(START, 1.2, 1.2002) });
    const conversion = { sourceEventId: 'prior-rates', deliveryId: 'current-rates', eventTimeMs: START - 1000,
        receivedAtMs: START, requestStartedAtMs: START, provenance,
        homeConversions: [{ currency: 'USD', accountGain: '1.4', accountLoss: '1.6', positionValue: '1.5' }] };
    const observations = [old, current, equalNow];
    const { market, advance } = fixture(observations, [conversion], { eventControlled: true });
    expect(market.getBrokerQuote('EUR_USD').researchObservation).toMatchObject({ sourceEventId: 'prior-price',
        eventTimeMs: START - 1000, receivedAtMs: null });
    expect(market.getBrokerQuote('EUR_USD').bids[0].price).toBe('1.1');
    expect(market.getBrokerHomeConversions().find((row) => row.currency === 'USD')).toMatchObject({
        accountLoss: '1.6', sourceEventTimeMs: START - 1000, receivedAtMs: null });
    expect(market.getQuote('EUR_USD').reason).toBe('NO_DELIVERED_QUOTE_OBSERVATION');
    expect(market.getHomeConversions().find((row) => row.currency === 'USD').status).toBe('UNAVAILABLE');
    expect(market.getDeliveriesAt(START - 500).quoteDeliveries).toHaveLength(0);
    expect(market.summary().sourceBootstrap).toEqual({ status: 'EXPLICIT_PRIOR_SOURCE_STATE', boundaryMs: START,
        sourceEvents: 2, quoteEvents: 1, conversionEvents: 1,
        latestQuotes: [{ instrument: 'EUR_USD', sourceEventId: 'prior-price', eventTimeMs: START - 1000 }],
        latestConversions: { sourceEventId: 'prior-rates', eventTimeMs: START - 1000 },
        appDeliveriesApplied: 0, protectionCallbacksApplied: 0 });
    advance(START);
    expect(market.getBrokerQuote('EUR_USD').researchObservation.sourceEventId).toBe('prior-price');
    const events = [...new FineEventSchedule({ fromMs: START, toMsExclusive: START + 1,
        quoteObservations: observations, conversionObservations: [conversion] }).events()];
    market.applyEvent(events.find((event) => event.eventType === 'BROKER_PRICE'));
    expect(market.getBrokerQuote('EUR_USD').bids[0].price).toBe('1.2');
    market.applyEvent(events.find((event) => event.eventType === 'QUOTE_DELIVERY'));
    market.applyEvent(events.find((event) => event.eventType === 'HOME_CONVERSION_DELIVERY'));
    const received = market.getQuote('EUR_USD');
    expect(received.researchObservation).toMatchObject({ sourceEventId: 'prior-price', receivedAtMs: START,
        eventTimeMs: START - 1000, deliveryId: 'current-response' });
    expect(evaluatePriceAvailability(normalizeOandaPrice(received, { instrument: 'EUR_USD', fetchedAt: START }),
        { nowMs: START, maxAgeMs: 20000 }).available).toBe(true);
    expect(market.getHomeConversions().find((row) => row.currency === 'USD')).toMatchObject({ receivedAtMs: START,
        accountLoss: '1.6', sourceEventTimeMs: START - 1000 });
    expect(market.summary().coverage).toMatchObject({ visibleSourceEvents: 3, visibleQuoteDeliveries: 1,
        visibleConversionDeliveries: 1 });
});

test('late older response updates local delivered evidence without rewinding broker source state', () => {
    const old = delivery('old', 'old-late', START + 5, START + 40);
    const next = delivery('new', 'new-first', START + 10, START + 20, { quote: quote(START + 10, 1.2, 1.2002) });
    const { market, advance } = fixture([old, next]);
    advance(START + 40);
    expect(market.getQuote('EUR_USD').researchObservation.sourceEventId).toBe('old');
    expect(market.getBrokerQuote('EUR_USD').researchObservation.sourceEventId).toBe('new');
    expect(market.getBrokerQuote('EUR_USD').bids[0].price).toBe('1.2');
});

test('home conversion evidence has independent source and delivery visibility and no M15/static fallback', () => {
    const points = [delivery('price-1', 'reply-1', START, START)];
    const supplied = { sourceEventId: 'fx-1', deliveryId: 'fx-reply', eventTimeMs: START + 5, receivedAtMs: START + 30,
        requestStartedAtMs: START, provenance, homeConversions: [{ currency: 'USD', accountGain: '1.4', accountLoss: '1.6', positionValue: '1.5' }] };
    const { market, advance } = fixture(points, [supplied]);
    expect(market.getHomeConversions().find((row) => row.currency === 'USD')).toMatchObject({ status: 'UNAVAILABLE', accountGain: null, reason: 'NO_DELIVERED_HOME_CONVERSION_EVIDENCE' });
    advance(START + 5);
    expect(market.brokerView().getHomeConversions().find((row) => row.currency === 'USD')).toMatchObject({ accountGain: '1.4', updatedAt: START + 5, sourceEventTimeMs: START + 5 });
    expect(market.getHomeConversions().find((row) => row.currency === 'USD').status).toBe('UNAVAILABLE');
    advance(START + 30);
    expect(market.getHomeConversions().find((row) => row.currency === 'USD')).toMatchObject({ accountLoss: '1.6', updatedAt: START + 30, sourceEventTimeMs: START + 5, receivedAtMs: START + 30 });
    expect(market.getHomeConversions().find((row) => row.currency === 'EUR').status).toBe('UNAVAILABLE');
    expect(market.getHomeConversions().find((row) => row.currency === 'AUD')).toMatchObject({ accountGain: '1', source: 'SAME_CURRENCY_IDENTITY' });
});

test('missing liquidity and invalid delivered quotes remain explicit supplied evidence without invented replacement', () => {
    const noLiquidity = quote(START); delete noLiquidity.bids[0].liquidity; delete noLiquidity.asks[0].liquidity;
    const { market } = fixture([delivery('point-1', 'reply-1', START, START, { quote: noLiquidity })]);
    expect(market.getQuote('EUR_USD').bids[0]).not.toHaveProperty('liquidity');
    expect(market.getQuote('EUR_USD').researchObservation.liquidityEvidence).toBe('UNOBSERVED_OR_UNUSABLE');
    const bad = quote(START, 1.2, 1.1);
    const invalid = fixture([delivery('point-2', 'reply-2', START, START, { quote: bad })]).market.getQuote('EUR_USD');
    expect(invalid.researchObservation).toMatchObject({ observationStatus: 'UNAVAILABLE', reason: 'INVALID_BID_ASK' });
    expect(invalid.bids[0].price).toBe('1.2');
});

test('input identity, explicit clock alignment and request-duration/provenance contracts are validated', () => {
    const good = delivery('source', 'delivery', START, START + 10);
    expect(() => normalizeObservationStreams({ quoteObservations: [good, good] })).toThrow('Duplicate deliveryId');
    expect(() => normalizeObservationStreams({ quoteObservations: [good, { ...good, deliveryId: 'other', quote: quote(START, 1.2, 1.2002) }] })).toThrow('Conflicting reused sourceEventId');
    expect(() => fixture([{ ...good, receivedAtMs: START - 1 }])).toThrow('cannot follow its delivery');
    expect(() => fixture([{ ...good, requestStartedAtMs: START + 11 }])).toThrow('cannot follow response receipt');
    expect(() => fixture([{ ...good, quote: quote(START + 1) }])).toThrow('retain the declared source event time');
    expect(() => fixture([{ ...good, provenance: {} }])).toThrow('explicit provenance');
    const unknownDuration = fixture([{ ...good, requestStartedAtMs: null }]);
    unknownDuration.advance(START + 10);
    expect(unknownDuration.market.getQuote('EUR_USD').researchObservation.declaredRequestElapsedMs).toBeNull();
    expect(() => unknownDuration.market.advanceTo(START)).toThrow('cannot rewind');
});

test('repeated advancement is deterministic and returned quote mutation does not change evidence', () => {
    const input = [delivery('source', 'delivery', START, START + 10)];
    const first = fixture(input); first.advance(START + 10);
    const second = fixture(input); second.advance(START + 10);
    expect(first.market.summary()).toEqual(second.market.summary());
    const value = first.market.getQuote('EUR_USD'); value.bids[0].price = '9';
    expect(first.market.getQuote('EUR_USD').bids[0].price).toBe('1.1');
    expect(first.advance(START + 10)).toEqual({ sourceEvents: [], quoteDeliveries: [], conversionDeliveries: [] });
});

test('event-controlled source protection uses old conversion at a tied price event until the later conversion event is applied', async () => {
    const later = START + 5000;
    const quotes = [delivery('initial', 'initial-response', START, START),
        delivery('drop', 'drop-response', later, later, { quote: quote(later, 1.08, 1.0802) })];
    const fx = (sourceEventId, at, accountLoss) => ({ sourceEventId, deliveryId: `${sourceEventId}-response`,
        eventTimeMs: at, receivedAtMs: at, requestStartedAtMs: at, provenance,
        homeConversions: [{ currency: 'USD', accountGain: '1.4', accountLoss: String(accountLoss), positionValue: '1.5' },
            { currency: 'EUR', accountGain: '1.65', accountLoss: '1.75', positionValue: '1.7' }] });
    const conversions = [fx('old-rates', START, 1.6), fx('new-rates', later, 3.2)];
    const { market, clock, advance } = fixture(quotes, conversions, { eventControlled: true });
    const schedule = new FineEventSchedule({ fromMs: START, toMsExclusive: later + 1,
        quoteObservations: quotes, conversionObservations: conversions });
    const events = [...schedule.events()];
    const initial = events.filter((event) => event.atMs === START && event.eventType.startsWith('BROKER_'));
    expect(market.getBrokerQuote('EUR_USD').reason).toBe('NO_SOURCE_QUOTE_EVENT');
    initial.forEach((event) => market.applyEvent(event));
    const broker = new ReplayBroker({ clock, market: market.brokerView(),
        metadata: { EUR_USD: { name: 'EUR_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05' } } });
    await broker.placeMarketOrder('EUR_USD', 100, { stopLossPrice: 1.09 });
    advance(later);
    expect(market.getBrokerHomeConversions().find((row) => row.currency === 'USD').accountLoss).toBe('1.6');
    const priceEvent = events.find((event) => event.atMs === later && event.eventType === 'BROKER_PRICE');
    market.applyEvent(priceEvent);
    await broker.observePrice('EUR_USD', market.getBrokerQuote('EUR_USD'));
    expect(Number((await broker.getTrade('1')).trade.realizedPL)).toBeCloseTo((1.08 - 1.1002) * 100 * 1.6, 12);
    market.applyEvent(events.find((event) => event.atMs === later && event.eventType === 'BROKER_HOME_CONVERSIONS'));
    expect(market.getBrokerHomeConversions().find((row) => row.currency === 'USD').accountLoss).toBe('3.2');
    expect(market.getDeliveriesAt(later)).toEqual({ quoteDeliveries: [], conversionDeliveries: [] });
    const reply = events.find((event) => event.atMs === later && event.eventType === 'QUOTE_DELIVERY');
    expect(market.applyEvent(reply).applied).toBe(true);
    expect(market.applyEvent(reply)).toMatchObject({ applied: false, reason: 'ALREADY_APPLIED' });
    expect(market.getDeliveriesAt(later).quoteDeliveries).toHaveLength(1);
    expect(market.getDeliveriesAt(later).conversionDeliveries).toHaveLength(0);
    expect(market.getDeliveryMetadataAt(later)).toHaveLength(2);
    expect(() => market.applyEvent({ ...reply, evidence: { ...reply.evidence, quote: quote(later, 2, 2.1) } })).toThrow('exact validated');
    expect(() => market.applyEvent(events.find((event) => event.atMs === START && event.eventType === 'QUOTE_DELIVERY'))).toThrow('backwards');
});
