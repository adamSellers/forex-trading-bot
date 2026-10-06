'use strict';

// Explicit point/delivery evidence over the causal candle adapter. This module
// neither interpolates a market path nor manufactures successful poll replies.
const { normalizeOandaPrice } = require('../src/runtime/quoteAvailability');

const copy = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
};
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
function timeMs(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(new Date(value).getTime())) {
        throw new TypeError(`${label} must be positive integer UNIX milliseconds`);
    }
    return value;
}
function sourceTime(quote) {
    const numeric = quote?.time == null || quote.time === '' ? NaN : Number(quote.time);
    return Number.isFinite(numeric) ? numeric < 100000000000 ? Math.round(numeric * 1000) : numeric : Date.parse(quote?.time);
}
function provenance(value, label) {
    if (!value || typeof value !== 'object' || !['OBSERVED', 'SYNTHETIC_FIXTURE', 'DECLARED_SCENARIO'].includes(value.kind)
        || typeof value.source !== 'string' || !value.source.trim()) {
        throw new TypeError(`${label} requires explicit provenance.kind and provenance.source`);
    }
    return copy(value);
}

function normalizeObservationStreams({ quoteObservations = [], conversionObservations = [] } = {}) {
    const deliveryIds = new Set();
    function normalize(rows, kind) {
        if (!Array.isArray(rows)) throw new TypeError(`${kind} observations must be an array`);
        return rows.map((input, index) => {
            if (!input || typeof input !== 'object' || typeof input.deliveryId !== 'string' || !input.deliveryId.trim()
                || typeof input.sourceEventId !== 'string' || !input.sourceEventId.trim()) {
                throw new TypeError(`${kind}[${index}] requires sourceEventId and deliveryId`);
            }
            if (deliveryIds.has(input.deliveryId)) throw new Error(`Duplicate deliveryId: ${input.deliveryId}`);
            deliveryIds.add(input.deliveryId);
            const eventTimeMs = timeMs(input.eventTimeMs, 'eventTimeMs');
            const receivedAtMs = timeMs(input.receivedAtMs, 'receivedAtMs');
            const requestStartedAtMs = input.requestStartedAtMs == null ? null : timeMs(input.requestStartedAtMs, 'requestStartedAtMs');
            // This is a declared aligned-clock research input contract. Raw
            // broker/local clock skew is not diagnosed as a production fault.
            if (eventTimeMs > receivedAtMs) throw new RangeError('Explicit aligned source event cannot follow its delivery');
            if (requestStartedAtMs !== null && requestStartedAtMs > receivedAtMs) throw new RangeError('Request start cannot follow response receipt');
            const base = { kind, deliveryId: input.deliveryId, sourceEventId: input.sourceEventId,
                eventTimeMs, receivedAtMs, requestStartedAtMs,
                declaredRequestElapsedMs: requestStartedAtMs === null ? null : receivedAtMs - requestStartedAtMs,
                requestElapsedBasis: 'DECLARED_ALIGNED_WALL_INPUT_DIFFERENCE',
                inputSequence: index, provenance: provenance(input.provenance, `${kind}[${index}]`) };
            if (kind === 'QUOTE') {
                if (!input.quote || !/^[A-Z]{3}_[A-Z]{3}$/.test(input.quote.instrument)) throw new TypeError('Explicit FX quote instrument is required');
                if (sourceTime(input.quote) !== eventTimeMs) throw new RangeError('Quote time must retain the declared source event time');
                return freeze({ ...base, instrument: input.quote.instrument, quote: copy(input.quote) });
            }
            if (!Array.isArray(input.homeConversions)) throw new TypeError('Explicit homeConversions array is required');
            const currencies = new Set();
            for (const row of input.homeConversions) {
                if (!/^[A-Z]{3}$/.test(row?.currency) || currencies.has(row.currency)) throw new TypeError('Unique explicit conversion currency is required');
                currencies.add(row.currency);
            }
            return freeze({ ...base, homeConversions: copy(input.homeConversions) });
        });
    }
    const quotes = normalize(quoteObservations, 'QUOTE');
    const conversions = normalize(conversionObservations, 'HOME_CONVERSIONS');
    const sources = new Map();
    for (const row of [...quotes, ...conversions]) {
        const key = `${row.kind}:${row.sourceEventId}`;
        const source = { kind: row.kind, sourceEventId: row.sourceEventId, eventTimeMs: row.eventTimeMs,
            ...(row.kind === 'QUOTE' ? { instrument: row.instrument, quote: row.quote } : { homeConversions: row.homeConversions }),
            provenance: row.provenance };
        const signature = JSON.stringify(canonical(source));
        if (sources.has(key) && sources.get(key).signature !== signature) throw new Error(`Conflicting reused sourceEventId: ${row.sourceEventId}`);
        if (!sources.has(key)) sources.set(key, { ...source, signature, inputSequence: sources.size });
    }
    const compareSource = (a, b) => a.eventTimeMs - b.eventTimeMs || a.inputSequence - b.inputSequence;
    const compareDelivery = (a, b) => a.receivedAtMs - b.receivedAtMs || a.inputSequence - b.inputSequence;
    return freeze({
        sourceEvents: [...sources.values()].sort(compareSource).map(({ signature, ...source }) => freeze(source)),
        quoteDeliveries: quotes.sort(compareDelivery), conversionDeliveries: conversions.sort(compareDelivery),
    });
}

class ObservedQuoteMarket {
    constructor({ candleMarket, clock, quoteObservations = [], conversionObservations = [], eventControlled = false } = {}) {
        if (!candleMarket || typeof candleMarket.advanceTo !== 'function' || typeof candleMarket.getCandles !== 'function') {
            throw new TypeError('Explicit causal candleMarket is required');
        }
        if (typeof clock?.nowMs !== 'function') throw new TypeError('clock.nowMs() is required');
        if (typeof eventControlled !== 'boolean') throw new TypeError('eventControlled must be explicitly boolean');
        this.candleMarket = candleMarket;
        this.clock = clock;
        this.eventControlled = eventControlled;
        this.streams = normalizeObservationStreams({ quoteObservations, conversionObservations });
        this._nowMs = null;
        this._sourceCursor = 0; this._quoteCursor = 0; this._conversionCursor = 0;
        this._sourceQuotes = new Map(); this._localQuotes = new Map();
        this._sourceConversions = null; this._localConversions = null;
        this._sourceById = new Map(this.streams.sourceEvents.map((row) => [`${row.kind}:${row.sourceEventId}`, row]));
        this._deliveryById = new Map([...this.streams.quoteDeliveries, ...this.streams.conversionDeliveries].map((row) => [row.deliveryId, row]));
        this._appliedSourceIds = new Set(); this._appliedQuoteIds = new Set(); this._appliedConversionIds = new Set();
        this._lastAppliedAtMs = null;
        this._deliveriesByTime = new Map();
        for (const [key, rows] of [['quoteDeliveries', this.streams.quoteDeliveries], ['conversionDeliveries', this.streams.conversionDeliveries]]) {
            for (const row of rows) {
                if (!this._deliveriesByTime.has(row.receivedAtMs)) this._deliveriesByTime.set(row.receivedAtMs, { quoteDeliveries: [], conversionDeliveries: [] });
                this._deliveriesByTime.get(row.receivedAtMs)[key].push(row);
            }
        }
        this._currencies = new Set(['AUD']);
        for (const row of this.streams.quoteDeliveries) row.instrument.split('_').forEach((currency) => this._currencies.add(currency));
        for (const row of this.streams.conversionDeliveries) row.homeConversions.forEach((entry) => this._currencies.add(entry.currency));
        const initialClockMs = clock.nowMs();
        this.advanceTo(initialClockMs);
        this._sourceBootstrap = { status: eventControlled ? 'EXPLICIT_PRIOR_SOURCE_STATE' : 'NOT_APPLICABLE',
            boundaryMs: initialClockMs, sourceEvents: 0, quoteEvents: 0, conversionEvents: 0,
            latestQuotes: [], latestConversions: null,
            appDeliveriesApplied: 0, protectionCallbacksApplied: 0 };
        if (eventControlled) {
            // Prior explicit source points establish the broker's initial state.
            // This does not replay prewindow protections or app responses. Equal
            // clock points remain ordered applyEvent calls, including ties.
            for (const row of this.streams.sourceEvents) {
                if (row.eventTimeMs >= initialClockMs) break;
                if (row.kind === 'QUOTE') {
                    this._sourceQuotes.set(row.instrument, row);
                    this._sourceBootstrap.quoteEvents += 1;
                } else {
                    this._sourceConversions = row;
                    this._sourceBootstrap.conversionEvents += 1;
                }
                this._appliedSourceIds.add(`${row.kind}:${row.sourceEventId}`);
                this._lastAppliedAtMs = row.eventTimeMs;
                this._sourceBootstrap.sourceEvents += 1;
            }
            this._sourceBootstrap.latestQuotes = [...this._sourceQuotes.values()].map((row) => ({
                instrument: row.instrument, sourceEventId: row.sourceEventId, eventTimeMs: row.eventTimeMs,
            })).sort((a, b) => a.instrument.localeCompare(b.instrument));
            const row = this._sourceConversions;
            this._sourceBootstrap.latestConversions = row ? { sourceEventId: row.sourceEventId, eventTimeMs: row.eventTimeMs } : null;
        }
    }

    advanceTo(nowMs) {
        timeMs(nowMs, 'advanceTo');
        if (this._nowMs !== null && nowMs < this._nowMs) throw new RangeError('Observed quote clock cannot rewind');
        this.candleMarket.advanceTo(nowMs);
        this._nowMs = nowMs;
        const newlyVisible = { sourceEvents: [], quoteDeliveries: [], conversionDeliveries: [] };
        if (this.eventControlled) return newlyVisible;
        const { sourceEvents, quoteDeliveries, conversionDeliveries } = this.streams;
        while (this._sourceCursor < sourceEvents.length && sourceEvents[this._sourceCursor].eventTimeMs <= nowMs) {
            const row = sourceEvents[this._sourceCursor++];
            if (row.kind === 'QUOTE') this._sourceQuotes.set(row.instrument, row);
            else this._sourceConversions = row;
            newlyVisible.sourceEvents.push(row);
        }
        while (this._quoteCursor < quoteDeliveries.length && quoteDeliveries[this._quoteCursor].receivedAtMs <= nowMs) {
            const row = quoteDeliveries[this._quoteCursor++]; this._localQuotes.set(row.instrument, row);
            newlyVisible.quoteDeliveries.push(row);
        }
        while (this._conversionCursor < conversionDeliveries.length && conversionDeliveries[this._conversionCursor].receivedAtMs <= nowMs) {
            const row = conversionDeliveries[this._conversionCursor++]; this._localConversions = row;
            newlyVisible.conversionDeliveries.push(row);
        }
        return newlyVisible;
    }

    applyEvent(event) {
        if (!this.eventControlled) throw new Error('applyEvent requires explicit eventControlled mode');
        const kinds = { BROKER_PRICE: 'QUOTE', BROKER_HOME_CONVERSIONS: 'HOME_CONVERSIONS',
            QUOTE_DELIVERY: 'QUOTE', HOME_CONVERSION_DELIVERY: 'HOME_CONVERSIONS' };
        const kind = kinds[event?.eventType];
        if (!kind) throw new TypeError('Only an explicit source or delivery event can commit evidence');
        const isSource = event.eventType.startsWith('BROKER_');
        const row = isSource ? this._sourceById.get(`${kind}:${event.evidence?.sourceEventId}`)
            : this._deliveryById.get(event.evidence?.deliveryId);
        if (!row || row.kind !== kind || !sameEvidence(row, event.evidence)) throw new Error('Scheduled event must match exact validated input evidence');
        const atMs = isSource ? row.eventTimeMs : row.receivedAtMs;
        if (event.atMs !== atMs || atMs > this._nowMs) throw new RangeError('Scheduled evidence time is inconsistent or future');
        const applied = isSource ? this._appliedSourceIds : kind === 'QUOTE' ? this._appliedQuoteIds : this._appliedConversionIds;
        const id = isSource ? `${kind}:${row.sourceEventId}` : row.deliveryId;
        if (applied.has(id)) return { applied: false, reason: 'ALREADY_APPLIED', id };
        if (this._lastAppliedAtMs !== null && atMs < this._lastAppliedAtMs) throw new RangeError('New scheduled evidence cannot be applied backwards');
        this._lastAppliedAtMs = atMs;
        if (isSource) {
            if (kind === 'QUOTE') this._sourceQuotes.set(row.instrument, row);
            else this._sourceConversions = row;
        } else if (kind === 'QUOTE') this._localQuotes.set(row.instrument, row);
        else this._localConversions = row;
        applied.add(id);
        return { applied: true, id, eventType: event.eventType, atMs };
    }

    _quote(instrument, sourceChannel) {
        const row = (sourceChannel ? this._sourceQuotes : this._localQuotes).get(instrument);
        if (!row) return { instrument, time: null, tradeable: false, bids: [], asks: [],
            status: 'UNAVAILABLE', reason: sourceChannel ? 'NO_SOURCE_QUOTE_EVENT' : 'NO_DELIVERED_QUOTE_OBSERVATION',
            researchObservation: { channel: sourceChannel ? 'SOURCE' : 'DELIVERED', eventTimeMs: null, receivedAtMs: null } };
        const normalized = normalizeOandaPrice(row.quote, { instrument, fetchedAt: sourceChannel ? row.eventTimeMs : row.receivedAtMs });
        return { ...copy(row.quote), researchObservation: {
            channel: sourceChannel ? 'SOURCE' : 'DELIVERED', sourceEventId: row.sourceEventId,
            eventTimeMs: row.eventTimeMs, receivedAtMs: row.receivedAtMs ?? null,
            deliveryId: row.deliveryId ?? null, requestStartedAtMs: row.requestStartedAtMs ?? null,
            declaredRequestElapsedMs: row.declaredRequestElapsedMs ?? null,
            requestElapsedBasis: row.requestElapsedBasis ?? null, provenance: copy(row.provenance),
            observationStatus: normalized.invalidReason ? 'UNAVAILABLE' : 'AVAILABLE', reason: normalized.invalidReason,
            liquidityEvidence: ['bids', 'asks'].every((side) => row.quote[side]?.length
                && row.quote[side].every((level) => Number.isFinite(Number(level.liquidity)) && Number(level.liquidity) > 0))
                ? 'EXPLICIT_IN_SUPPLIED_POINT' : 'UNOBSERVED_OR_UNUSABLE',
        } };
    }
    getQuote(instrument) { return this._quote(instrument, false); }
    getBrokerQuote(instrument) { return this._quote(instrument, true); }
    getCandles(instrument, timeframe) { return this.candleMarket.getCandles(instrument, timeframe); }
    getCompletedBar(instrument) { return this.candleMarket.getCompletedBar?.(instrument) ?? null; }

    _conversions(sourceChannel) {
        const row = sourceChannel ? this._sourceConversions : this._localConversions;
        const byCurrency = new Map((row?.homeConversions ?? []).map((entry) => [entry.currency, entry]));
        return [...this._currencies].sort().map((currency) => {
            if (currency === 'AUD') return { currency, accountGain: '1', accountLoss: '1', positionValue: '1',
                status: 'AVAILABLE', reason: null, source: 'SAME_CURRENCY_IDENTITY', updatedAt: null };
            const supplied = byCurrency.get(currency);
            const values = Object.fromEntries(['accountGain', 'accountLoss', 'positionValue'].map((field) => {
                const value = supplied?.[field];
                return [field, value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? String(value) : null];
            }));
            const available = Object.values(values).some((value) => value !== null);
            return { ...copy(supplied ?? {}), currency, ...values, status: available ? 'AVAILABLE' : 'UNAVAILABLE',
                reason: available ? null : supplied ? 'SUPPLIED_HOME_CONVERSION_UNUSABLE' : sourceChannel
                    ? 'NO_SOURCE_HOME_CONVERSION_EVIDENCE' : 'NO_DELIVERED_HOME_CONVERSION_EVIDENCE',
                source: 'EXPLICIT_SUPPLIED_HOME_CONVERSIONS', sourceEventId: row?.sourceEventId ?? null,
                sourceEventTimeMs: row?.eventTimeMs ?? null, receivedAtMs: row?.receivedAtMs ?? null,
                updatedAt: row ? sourceChannel ? row.eventTimeMs : row.receivedAtMs : null,
                provenance: row ? copy(row.provenance) : null };
        });
    }
    getHomeConversions() { return this._conversions(false); }
    getBrokerHomeConversions() { return this._conversions(true); }
    brokerView() { return { getQuote: (instrument) => this.getBrokerQuote(instrument), getHomeConversions: () => this.getBrokerHomeConversions() }; }

    getDeliveriesAt(atMs) {
        timeMs(atMs, 'delivery time');
        if (atMs > this._nowMs) throw new RangeError('Future deliveries are not visible');
        const rows = this._deliveriesByTime.get(atMs) ?? { quoteDeliveries: [], conversionDeliveries: [] };
        return copy(this.eventControlled ? {
            quoteDeliveries: rows.quoteDeliveries.filter((row) => this._appliedQuoteIds.has(row.deliveryId)),
            conversionDeliveries: rows.conversionDeliveries.filter((row) => this._appliedConversionIds.has(row.deliveryId)),
        } : rows);
    }
    getDeliveryMetadataAt(atMs) {
        timeMs(atMs, 'delivery time');
        if (atMs > this._nowMs) throw new RangeError('Future delivery metadata is not visible');
        const rows = this._deliveriesByTime.get(atMs) ?? { quoteDeliveries: [], conversionDeliveries: [] };
        return [...rows.quoteDeliveries, ...rows.conversionDeliveries].map((row) => ({ deliveryId: row.deliveryId,
            kind: row.kind, receivedAtMs: row.receivedAtMs, requestStartedAtMs: row.requestStartedAtMs }));
    }
    summary() {
        return { adapterKind: 'EXPLICIT_SOURCE_AND_DELIVERY_QUOTE_EVIDENCE', clockMs: this._nowMs, eventControlled: this.eventControlled,
            sourceBootstrap: copy(this._sourceBootstrap),
            coverage: { sourceEvents: this.streams.sourceEvents.length, quoteDeliveries: this.streams.quoteDeliveries.length,
                conversionDeliveries: this.streams.conversionDeliveries.length,
                visibleSourceEvents: this.eventControlled ? this._appliedSourceIds.size : this._sourceCursor,
                visibleQuoteDeliveries: this.eventControlled ? this._appliedQuoteIds.size : this._quoteCursor,
                visibleConversionDeliveries: this.eventControlled ? this._appliedConversionIds.size : this._conversionCursor },
            candles: this.candleMarket.summary(), homeConversions: this.getHomeConversions(),
            assumptions: ['Source event and receipt clocks are explicitly declared aligned UNIX milliseconds; raw broker clock skew is not classified as a production fault.',
                'Broker source prices and locally delivered observations are separate causal channels. Repeated deliveries may preserve an old source event.',
                'In eventControlled mode, initialization seeds only explicitly supplied source events strictly before the initial clock, without app receipts or protection callbacks. Prewindow protected-trade outcomes remain unproven.',
                'After initialization in eventControlled mode, clock advancement commits no point or receipt. Equal-initial-clock and later evidence requires exact scheduled applyEvent calls in the declared order, including ties.',
                'Reading a delivered quote does not create a new receipt. Poll completion must consume a declared delivery; scheduled polls do not imply successful responses.',
                'Liquidity, tradeability and home conversion fields are supplied evidence or explicitly labelled fixture/scenario input; none is interpolated or borrowed from M15 midpoint data.',
                'Only explicit supplied quote points can be checked for broker protection. Unobserved intervening market paths remain unresolved.',
                'Summary includes preflight stream coverage; it is not a strategy feature.'],
        };
    }
}

function sameEvidence(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }

module.exports = { ObservedQuoteMarket, normalizeObservationStreams };
