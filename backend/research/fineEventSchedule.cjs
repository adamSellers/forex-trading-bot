'use strict';

const { normalizeObservationStreams } = require('./observedQuoteMarket.cjs');
const LIVE_CADENCES_MS = Object.freeze({ PRICE_POLL: 5000, CANDLE_REFRESH: 60000, MANAGEMENT: 10000, SCAN: 60000 });
const EVENT_TYPES = Object.freeze(['BROKER_PRICE', 'BROKER_HOME_CONVERSIONS', 'QUOTE_DELIVERY',
    'HOME_CONVERSION_DELIVERY', 'PRICE_POLL', 'CANDLE_REFRESH', 'MANAGEMENT', 'SCAN']);

function integerTime(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) throw new TypeError(`${label} must be positive integer milliseconds`);
    return value;
}

class FineEventSchedule {
    constructor({ fromMs, toMsExclusive, quoteObservations = [], conversionObservations = [],
        cadenceMs = {}, firstAtMs = {}, tieOrder = EVENT_TYPES } = {}) {
        integerTime(fromMs, 'fromMs'); integerTime(toMsExclusive, 'toMsExclusive');
        if (fromMs >= toMsExclusive) throw new RangeError('Schedule end must follow its start');
        for (const value of [cadenceMs, firstAtMs]) {
            if (!value || typeof value !== 'object' || Array.isArray(value)
                || Object.keys(value).some((key) => !Object.hasOwn(LIVE_CADENCES_MS, key))) throw new TypeError('Unsupported timer configuration');
        }
        this.fromMs = fromMs; this.toMsExclusive = toMsExclusive;
        this.cadenceMs = Object.freeze({ ...LIVE_CADENCES_MS, ...cadenceMs });
        for (const [type, interval] of Object.entries(this.cadenceMs)) {
            if (!Number.isSafeInteger(interval) || interval < 1) throw new TypeError(`${type} cadence must be positive integer milliseconds`);
        }
        this.firstAtMs = Object.freeze({ PRICE_POLL: fromMs, CANDLE_REFRESH: fromMs,
            MANAGEMENT: fromMs + this.cadenceMs.MANAGEMENT, SCAN: fromMs, ...firstAtMs });
        for (const [type, first] of Object.entries(this.firstAtMs)) {
            integerTime(first, `${type} firstAtMs`);
            if (first < fromMs) throw new RangeError('Explicit first timer event cannot precede schedule start');
        }
        if (!Array.isArray(tieOrder) || tieOrder.length !== EVENT_TYPES.length || new Set(tieOrder).size !== EVENT_TYPES.length
            || EVENT_TYPES.some((type) => !tieOrder.includes(type))) throw new TypeError('tieOrder must contain every event type exactly once');
        for (const [source, delivery] of [['BROKER_PRICE', 'QUOTE_DELIVERY'], ['BROKER_HOME_CONVERSIONS', 'HOME_CONVERSION_DELIVERY']]) {
            if (tieOrder.indexOf(source) > tieOrder.indexOf(delivery)) throw new RangeError('Tied source event must precede its delivery');
        }
        this.tieOrder = Object.freeze([...tieOrder]);
        const streams = normalizeObservationStreams({ quoteObservations, conversionObservations });
        this._observations = [
            ...streams.sourceEvents.map((row) => ({ eventType: row.kind === 'QUOTE' ? 'BROKER_PRICE' : 'BROKER_HOME_CONVERSIONS',
                atMs: row.eventTimeMs, eventTimeMs: row.eventTimeMs, receivedAtMs: null,
                requestStartedAtMs: null, declaredRequestElapsedMs: null, requestElapsedBasis: null, evidence: row })),
            ...streams.quoteDeliveries.map((row) => ({ eventType: 'QUOTE_DELIVERY', atMs: row.receivedAtMs,
                eventTimeMs: row.eventTimeMs, receivedAtMs: row.receivedAtMs,
                requestStartedAtMs: row.requestStartedAtMs, declaredRequestElapsedMs: row.declaredRequestElapsedMs, requestElapsedBasis: row.requestElapsedBasis, evidence: row })),
            ...streams.conversionDeliveries.map((row) => ({ eventType: 'HOME_CONVERSION_DELIVERY', atMs: row.receivedAtMs,
                eventTimeMs: row.eventTimeMs, receivedAtMs: row.receivedAtMs,
                requestStartedAtMs: row.requestStartedAtMs, declaredRequestElapsedMs: row.declaredRequestElapsedMs, requestElapsedBasis: row.requestElapsedBasis, evidence: row })),
        ].filter((row) => row.atMs >= fromMs && row.atMs < toMsExclusive)
            .sort((a, b) => a.atMs - b.atMs || this.tieOrder.indexOf(a.eventType) - this.tieOrder.indexOf(b.eventType)
                || a.evidence.inputSequence - b.evidence.inputSequence);
        Object.freeze(this._observations);
    }

    *events() {
        const nextTimer = { ...this.firstAtMs };
        let observationCursor = 0; let sequence = 0;
        while (true) {
            const candidates = Object.entries(nextTimer).filter(([, atMs]) => atMs < this.toMsExclusive)
                .map(([eventType, atMs]) => ({ eventType, atMs }));
            if (observationCursor < this._observations.length) candidates.push(this._observations[observationCursor]);
            if (!candidates.length) return;
            candidates.sort((a, b) => a.atMs - b.atMs || this.tieOrder.indexOf(a.eventType) - this.tieOrder.indexOf(b.eventType));
            const event = candidates[0];
            const timer = Object.hasOwn(nextTimer, event.eventType);
            yield Object.freeze({ sequence: ++sequence, ...event,
                ...(timer ? { eventTimeMs: null, receivedAtMs: null, requestStartedAtMs: null, declaredRequestElapsedMs: null, requestElapsedBasis: null,
                    evidence: { kind: 'DECLARED_TIMER_SCHEDULE', cadenceMs: this.cadenceMs[event.eventType],
                        firstAtMs: this.firstAtMs[event.eventType] } } : {}) });
            if (timer) nextTimer[event.eventType] += this.cadenceMs[event.eventType];
            else observationCursor += 1;
        }
    }

    async run(onEvent) {
        if (typeof onEvent !== 'function') throw new TypeError('Explicit event callback is required');
        let count = 0;
        for (const event of this.events()) { await onEvent(event); count += 1; }
        return { dispatchedEvents: count, ...this.summary() };
    }

    summary() {
        return { scheduleKind: 'EXPLICIT_OBSERVATIONS_AND_DECLARED_TIMER_EVENTS', fromMs: this.fromMs,
            toMsExclusive: this.toMsExclusive, cadenceMs: this.cadenceMs, firstAtMs: this.firstAtMs, tieOrder: this.tieOrder,
            suppliedSourceAndDeliveryEventsInWindow: this._observations.length,
            contractEvidence: { pricePoll: 'OandaDataService.start: 5000ms', candleRefresh: 'OandaDataService.start: 60000ms',
                management: 'LiveTradingEngine default monitorIntervalMs: 10000ms; no immediate management call',
                scan: 'server.js pollIntervalMs/onStarted: 60000ms; RuntimeCoordinator.start immediate cycle' },
            cadenceOverrides: Object.fromEntries(Object.entries(this.cadenceMs).filter(([key, value]) => LIVE_CADENCES_MS[key] !== value)),
            assumptions: ['Default timer phases represent a declared startup schedule, not measured production startup completion times.',
                'The five-minute scan in earlier planning was a legacy assumption; the current server explicitly scans every sixty seconds.',
                'A timer event requests work; it does not imply a quote response, receipt, management acknowledgement or order fill.',
                'Broker-held protection observes explicit source price events independently of local delivery and polling.',
                'Ties use the declared order; millisecond timestamp equality does not establish the real broker/event-loop order.',
                'run() dispatches callbacks serially; asynchronous request overlap, skip-while-busy behaviour and latency completion must be represented by the integrating harness.',
                'No ticks or conversion rates are interpolated between observations.'],
        };
    }
}

module.exports = { FineEventSchedule, LIVE_CADENCES_MS, EVENT_TYPES };
