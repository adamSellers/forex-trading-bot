'use strict';

const { FineEventSchedule, LIVE_CADENCES_MS, EVENT_TYPES } = require('../fineEventSchedule.cjs');
const START = Date.parse('2026-10-05T22:00:00Z');
const observation = { sourceEventId: 'event-1', deliveryId: 'response-1', eventTimeMs: START + 3000,
    receivedAtMs: START + 12000, requestStartedAtMs: START + 5000,
    provenance: { kind: 'SYNTHETIC_FIXTURE', source: 'explicit-delayed-response' },
    quote: { instrument: 'EUR_USD', time: new Date(START + 3000).toISOString(), tradeable: true,
        bids: [{ price: '1.1', liquidity: 1000 }], asks: [{ price: '1.1002', liquidity: 1000 }] } };

test('live cadence defaults produce chronological source/delivery events and independent management/scan/poll requests', () => {
    const schedule = new FineEventSchedule({ fromMs: START, toMsExclusive: START + 61000, quoteObservations: [observation] });
    const events = [...schedule.events()];
    expect(schedule.summary().cadenceMs).toEqual(LIVE_CADENCES_MS);
    expect(events.filter((row) => row.eventType === 'PRICE_POLL').map((row) => row.atMs - START)).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 55000, 60000]);
    expect(events.filter((row) => row.eventType === 'MANAGEMENT').map((row) => row.atMs - START)).toEqual([10000, 20000, 30000, 40000, 50000, 60000]);
    expect(events.filter((row) => row.eventType === 'SCAN').map((row) => row.atMs - START)).toEqual([0, 60000]);
    expect(events.filter((row) => row.eventType === 'CANDLE_REFRESH').map((row) => row.atMs - START)).toEqual([0, 60000]);
    expect(events.find((row) => row.eventType === 'BROKER_PRICE')).toMatchObject({ atMs: START + 3000, receivedAtMs: null });
    expect(events.find((row) => row.eventType === 'QUOTE_DELIVERY')).toMatchObject({ atMs: START + 12000, eventTimeMs: START + 3000, receivedAtMs: START + 12000,
        declaredRequestElapsedMs: 7000, requestElapsedBasis: 'DECLARED_ALIGNED_WALL_INPUT_DIFFERENCE' });
    expect(events.filter((row) => row.eventType === 'QUOTE_DELIVERY')).toHaveLength(1);
    expect(events.every((row, index) => index === 0 || row.atMs >= events[index - 1].atMs)).toBe(true);
    expect(events.map((row) => row.sequence)).toEqual(events.map((_row, i) => i + 1));
});

test('exclusive boundary, repeated-source delivery and configurable timer phases preserve declared chronology', () => {
    const repeated = { ...observation, deliveryId: 'response-2', receivedAtMs: START + 15000, requestStartedAtMs: START + 15000 };
    const schedule = new FineEventSchedule({ fromMs: START + 4000, toMsExclusive: START + 15000,
        quoteObservations: [observation, repeated], firstAtMs: { SCAN: START + 6000, MANAGEMENT: START + 8000 } });
    const events = [...schedule.events()];
    expect(events.some((row) => row.eventType === 'BROKER_PRICE')).toBe(false); // Source existed before this window.
    expect(events.filter((row) => row.eventType === 'QUOTE_DELIVERY')).toHaveLength(1);
    expect(events.find((row) => row.eventType === 'MANAGEMENT').atMs).toBe(START + 8000);
    expect(events.find((row) => row.eventType === 'SCAN').atMs).toBe(START + 6000);
    const full = new FineEventSchedule({ fromMs: START, toMsExclusive: START + 20000, quoteObservations: [observation, repeated] });
    expect([...full.events()].filter((row) => row.eventType === 'BROKER_PRICE')).toHaveLength(1);
    expect([...full.events()].filter((row) => row.eventType === 'QUOTE_DELIVERY')).toHaveLength(2);
});

test('ties are deterministic and five-minute scans are labelled an explicit override, not current live parity', async () => {
    const instant = { ...observation, eventTimeMs: START, receivedAtMs: START, requestStartedAtMs: START,
        quote: { ...observation.quote, time: new Date(START).toISOString() } };
    const conversions = { sourceEventId: 'conversion-1', deliveryId: 'conversion-response', eventTimeMs: START, receivedAtMs: START,
        requestStartedAtMs: START, provenance: instant.provenance,
        homeConversions: [{ currency: 'USD', accountGain: '1.4', accountLoss: '1.6', positionValue: '1.5' }] };
    const schedule = new FineEventSchedule({ fromMs: START, toMsExclusive: START + 1000,
        quoteObservations: [instant], conversionObservations: [conversions], cadenceMs: { SCAN: 300000 } });
    expect([...schedule.events()].map((row) => row.eventType)).toEqual(['BROKER_PRICE', 'BROKER_HOME_CONVERSIONS', 'QUOTE_DELIVERY', 'HOME_CONVERSION_DELIVERY', 'PRICE_POLL', 'CANDLE_REFRESH', 'SCAN']);
    expect(schedule.summary().cadenceOverrides).toEqual({ SCAN: 300000 });
    const dispatched = [];
    expect((await schedule.run(async (event) => { dispatched.push(event); })).dispatchedEvents).toBe(7);
    expect(dispatched).toEqual([...schedule.events()]);
});

test('invalid schedule configuration is rejected without substituting a clock or rate', () => {
    const options = { fromMs: START, toMsExclusive: START + 1000 };
    expect(() => new FineEventSchedule({ ...options, fromMs: START + 1000 })).toThrow('end must follow');
    expect(() => new FineEventSchedule({ ...options, cadenceMs: { PRICE_POLL: 0 } })).toThrow('positive integer');
    expect(() => new FineEventSchedule({ ...options, cadenceMs: { NOPE: 5 } })).toThrow('Unsupported timer');
    expect(() => new FineEventSchedule({ ...options, firstAtMs: { MANAGEMENT: START - 1 } })).toThrow('cannot precede');
    expect(() => new FineEventSchedule({ ...options, tieOrder: [] })).toThrow('every event type');
    expect(() => new FineEventSchedule({ ...options, tieOrder: [...EVENT_TYPES].reverse() })).toThrow('source event must precede');
});
