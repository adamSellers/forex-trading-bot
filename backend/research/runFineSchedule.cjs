'use strict';

// Drive explicit observations through focused production-path replay actions.
// A cached/source quote is never used to synthesize a successful poll response.
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

async function runFineSchedule({ harness, schedule, market = harness?.market } = {}) {
    const methods = ['advanceTo', 'observeBrokerPrice', 'refreshHistoryAt', 'manageAt', 'scanAt',
        'startPricingRequest', 'completePricingRequest', 'getPricingRequestLog'];
    if (!harness || methods.some((name) => typeof harness[name] !== 'function')) throw new TypeError('Focused replay harness is required');
    if (typeof schedule?.events !== 'function' || typeof schedule?.summary !== 'function') throw new TypeError('Explicit FineEventSchedule is required');
    if (typeof market?.getDeliveriesAt !== 'function' || typeof market?.getDeliveryMetadataAt !== 'function'
        || typeof market?.applyEvent !== 'function' || market.eventControlled !== true) {
        throw new TypeError('Explicit eventControlled delivered-observation market is required');
    }
    if (typeof harness.dataService?.getPricingInstruments !== 'function') throw new TypeError('Actual requested pricing instruments are required');

    const dispatchLedger = [];
    const groups = new Map();
    const groupsByReceipt = new Map();
    const skippedPolls = new Set();

    function collectAt(atMs) {
        const visible = market.getDeliveriesAt(atMs);
        const metadata = market.getDeliveryMetadataAt(atMs);
        for (const row of [...visible.quoteDeliveries, ...visible.conversionDeliveries]) {
            const key = `${row.receivedAtMs}:${row.requestStartedAtMs ?? 'UNMEASURED'}`;
            if (!groups.has(key)) groups.set(key, { key, receivedAtMs: row.receivedAtMs,
                requestStartedAtMs: row.requestStartedAtMs, quoteRows: [], conversionRows: [], deliveryIds: new Set(),
                expectedDeliveryIds: new Set(metadata.filter((item) => item.requestStartedAtMs === row.requestStartedAtMs).map((item) => item.deliveryId)),
                consumed: false, requestId: null, lastReason: null, requestedInstruments: null, missingRequestedInstruments: null });
            const group = groups.get(key);
            if (!groupsByReceipt.has(atMs)) groupsByReceipt.set(atMs, new Set());
            groupsByReceipt.get(atMs).add(key);
            if (group.deliveryIds.has(row.deliveryId)) continue;
            group.deliveryIds.add(row.deliveryId);
            (row.kind === 'QUOTE' ? group.quoteRows : group.conversionRows).push(row);
        }
    }

    function payloadFor(group) {
        const quotes = new Map();
        for (const row of group.quoteRows) {
            const previous = quotes.get(row.instrument);
            if (previous && !same(previous, row.quote)) return { reason: 'AMBIGUOUS_QUOTES_FOR_ONE_RESPONSE_INSTRUMENT' };
            quotes.set(row.instrument, row.quote);
        }
        if (!quotes.size) return { reason: 'NO_QUOTE_ROWS_FOR_PRICING_RESPONSE' };
        const conversions = new Map();
        for (const row of group.conversionRows) for (const entry of row.homeConversions) {
            const previous = conversions.get(entry.currency);
            if (previous && !same(previous, entry)) return { reason: 'AMBIGUOUS_HOME_CONVERSIONS_FOR_ONE_RESPONSE' };
            conversions.set(entry.currency, entry);
        }
        return { payload: { prices: [...quotes.values()],
            ...(group.conversionRows.length ? { homeConversions: [...conversions.values()] } : {}) } };
    }

    async function completeVisibleAt(atMs) {
        for (const key of groupsByReceipt.get(atMs) ?? []) {
            const group = groups.get(key);
            if (group.consumed) continue;
            if ([...group.expectedDeliveryIds].some((id) => !group.deliveryIds.has(id))) {
                group.lastReason = 'DECLARED_PACKET_ROWS_NOT_ALL_DELIVERED_YET'; continue;
            }
            if (group.requestStartedAtMs === null) { group.lastReason = 'UNMEASURED_REQUEST_START'; continue; }
            const rows = harness.getPricingRequestLog().filter((request) => request.requestedAtMs === group.requestStartedAtMs);
            const pending = rows.filter((request) => request.completedAtMs === null);
            if (pending.length !== 1) {
                group.lastReason = pending.length > 1 ? 'AMBIGUOUS_OUTSTANDING_REQUEST_MATCH'
                    : rows.length ? 'MATCHED_REQUEST_ALREADY_COMPLETED'
                        : skippedPolls.has(group.requestStartedAtMs) ? 'POLL_SKIPPED_WHILE_BUSY' : 'NO_MATCHING_ACTUAL_PENDING_POLL';
                continue;
            }
            const candidate = payloadFor(group);
            if (candidate.reason) { group.lastReason = candidate.reason; continue; }
            group.requestedInstruments = [...harness.dataService.getPricingInstruments()];
            const supplied = new Set(candidate.payload.prices.map((quote) => quote.instrument));
            group.missingRequestedInstruments = group.requestedInstruments.filter((instrument) => !supplied.has(instrument));
            group.requestId = pending[0].id;
            // Partial responses exercise the real DataService missing-row path.
            // Neither missing quotes nor conversions are filled from caches.
            await harness.completePricingRequest(atMs, group.requestId, candidate.payload);
            group.consumed = true; group.lastReason = null;
            dispatchLedger.push({ eventType: 'EXPLICIT_PRICING_RESPONSE_COMPLETED', atMs, requestId: group.requestId,
                requestedAtMs: group.requestStartedAtMs, deliveryIds: [...group.deliveryIds],
                suppliedInstruments: [...supplied], missingRequestedInstruments: group.missingRequestedInstruments,
                conversionCurrenciesSupplied: candidate.payload.homeConversions?.map((row) => row.currency) ?? [],
                status: 'DELIVERED_TO_ACTUAL_DATASERVICE; VALIDATION_AND_DEADLINE_OUTCOME_BELONG_TO_SERVICE' });
        }
    }

    for (const event of schedule.events()) {
        harness.advanceTo(event.atMs);
        const record = { sequence: event.sequence, eventType: event.eventType, atMs: event.atMs,
            eventTimeMs: event.eventTimeMs, receivedAtMs: event.receivedAtMs,
            requestStartedAtMs: event.requestStartedAtMs, declaredRequestElapsedMs: event.declaredRequestElapsedMs,
            requestElapsedBasis: event.requestElapsedBasis, sourceEventId: event.evidence?.sourceEventId ?? null,
            deliveryId: event.evidence?.deliveryId ?? null, status: 'DISPATCHED' };
        if (['BROKER_PRICE', 'BROKER_HOME_CONVERSIONS', 'QUOTE_DELIVERY', 'HOME_CONVERSION_DELIVERY'].includes(event.eventType)) {
            record.evidenceCommit = market.applyEvent(event);
        }
        if (event.eventType === 'BROKER_PRICE') await harness.observeBrokerPrice(event.atMs, event.evidence.instrument, event.evidence.quote);
        else if (event.eventType === 'BROKER_HOME_CONVERSIONS') record.status = 'SOURCE_CONVERSIONS_VISIBLE; NO_LOCAL_RECEIPT_CREATED';
        else if (event.eventType === 'QUOTE_DELIVERY' || event.eventType === 'HOME_CONVERSION_DELIVERY') collectAt(event.atMs);
        else if (event.eventType === 'PRICE_POLL') {
            record.requestId = harness.startPricingRequest(event.atMs);
            if (record.requestId === null) { skippedPolls.add(event.atMs); record.status = 'ACTUAL_DATASERVICE_POLL_SKIPPED_WHILE_BUSY'; }
        } else if (event.eventType === 'CANDLE_REFRESH') await harness.refreshHistoryAt(event.atMs);
        else if (event.eventType === 'MANAGEMENT') await harness.manageAt(event.atMs);
        else if (event.eventType === 'SCAN') await harness.scanAt(event.atMs);
        else throw new Error(`Unsupported fine event: ${event.eventType}`);
        dispatchLedger.push(record);
        // If a zero-latency response ties before its poll callback, collection
        // happens first and completion becomes possible when the real poll starts.
        if (['QUOTE_DELIVERY', 'HOME_CONVERSION_DELIVERY', 'PRICE_POLL'].includes(event.eventType)) await completeVisibleAt(event.atMs);
    }

    const pricingRequests = harness.getPricingRequestLog();
    const compactGroup = (group) => ({ receivedAtMs: group.receivedAtMs, requestStartedAtMs: group.requestStartedAtMs,
        deliveryIds: [...group.deliveryIds], sourceEventIds: [...new Set([...group.quoteRows, ...group.conversionRows].map((row) => row.sourceEventId))],
        expectedDeliveryIds: [...group.expectedDeliveryIds],
        requestId: group.requestId, consumed: group.consumed, reason: group.lastReason,
        quotedInstruments: group.quoteRows.map((row) => row.instrument), requestedInstruments: group.requestedInstruments,
        missingRequestedInstruments: group.missingRequestedInstruments });
    return { executionKind: 'FOCUSED_EXPLICIT_FINE_OBSERVATION_DISPATCH', dispatchLedger,
        pricingRequests, pendingPricingRequests: pricingRequests.filter((row) => row.completedAtMs === null).length,
        deliveredResponseGroups: [...groups.values()].filter((group) => group.consumed).map(compactGroup),
        unresolvedDeliveries: [...groups.values()].filter((group) => !group.consumed).map(compactGroup),
        schedule: schedule.summary(), limits: [
            'Same receipt/start observation groups are explicitly declared to form one pricing response; this grouping is not inferred from broker history.',
            'A response completes only after every supplied row in its declared packet has been applied. Preflight IDs/counts are scheduling metadata; later quote/conversion fields are not borrowed across tied events.',
            'Only actual pending polls with matching explicit request starts are completed. Missing rows are passed as missing; caches and source channels never supply replacement rows.',
            'Source price events can trigger broker-held protection before local quote delivery, independently of app management or scans.',
            'Default timer phases and tied-event order are declared modeling assumptions; production asynchronous overlap and start timing are not established by this serial dispatcher.',
            'Focused response completion exercises the actual DataService post-response deadline using the simulated monotonic clock. It does not claim to simulate HTTP AbortController cancellation or all transport races.',
            'Separate engine conversion and final-entry broker pricing calls use the explicit source book with zero modeled response latency. This is not measured historical execution or final-response timing.',
            'No interpolated tick path, unprovided liquidity/conversion, intrabar profitability bound or live strategy promotion is established.',
        ] };
}

module.exports = { runFineSchedule };
