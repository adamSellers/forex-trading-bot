'use strict';

// Post-outcome diagnostic only. OHLC can locate threshold contacts but cannot
// identify protection ordering, ten-second management or realized P/L.
const KEYS = ['open', 'high', 'low', 'close'];
const SHORT_KEYS = ['o', 'h', 'l', 'c'];
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function describeM15Uncertainty({ bar, side, entryPrice, stopLossPrice = null, takeProfitPrice = null,
    breakevenTriggerPrice = null, activeFromMs = null, breakevenActiveAtMs = null } = {}) {
    if (!['BUY', 'SELL'].includes(side)) throw new TypeError('Explicit BUY or SELL side is required');
    if (!positive(entryPrice)) throw new TypeError('Positive finite entryPrice is required');
    for (const [name, value] of Object.entries({ stopLossPrice, takeProfitPrice, breakevenTriggerPrice })) {
        if (value !== null && !positive(value)) throw new TypeError(`${name} must be positive finite or explicitly null`);
    }
    if (!bar || typeof bar !== 'object') throw new TypeError('Explicit M15 bar is required');
    const start = Number.isSafeInteger(bar.sourceIntervalStartSeconds) ? bar.sourceIntervalStartSeconds * 1000
        : typeof bar.time === 'number' ? bar.time * 1000 : Date.parse(bar.time);
    if (!Number.isSafeInteger(start) || start <= 0 || start % 900000) throw new TypeError('M15 interval start must be explicit and grid aligned');
    const end = start + 900000;
    if (bar.sourceIntervalEndMs !== undefined && bar.sourceIntervalEndMs !== end) throw new TypeError('Supplied interval is not M15');
    for (const value of [activeFromMs, breakevenActiveAtMs]) {
        if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError('Activation times must be positive integer milliseconds or null');
    }
    const component = side === 'BUY' ? 'bid' : 'ask';
    const value = bar[component];
    let ohlc = null;
    if (value) {
        const keys = KEYS.some((key) => Object.hasOwn(value, key)) ? KEYS : SHORT_KEYS;
        const prices = keys.map((key) => value[key]);
        const [open, high, low, close] = prices;
        if (!prices.every(positive) || low > high || open < low || open > high || close < low || close > high) {
            throw new TypeError('Supplied bid/ask component OHLC is invalid');
        }
        ohlc = Object.fromEntries(KEYS.map((key, i) => [key, prices[i]]));
    }
    const activeWholeInterval = activeFromMs === null ? null : activeFromMs <= start;
    const activeSomeInterval = activeFromMs === null ? null : activeFromMs < end;
    const stopContact = ohlc && stopLossPrice !== null ? side === 'BUY' ? ohlc.low <= stopLossPrice : ohlc.high >= stopLossPrice : null;
    const targetContact = ohlc && takeProfitPrice !== null ? side === 'BUY' ? ohlc.high >= takeProfitPrice : ohlc.low <= takeProfitPrice : null;
    const activationContact = ohlc && breakevenTriggerPrice !== null ? side === 'BUY' ? ohlc.high >= breakevenTriggerPrice : ohlc.low <= breakevenTriggerPrice : null;
    const beContact = ohlc ? side === 'BUY' ? ohlc.low <= entryPrice : ohlc.high >= entryPrice : null;
    const candidates = [];
    if (stopContact && activeSomeInterval !== false) candidates.push({ outcome: 'INITIAL_OR_ACTIVE_STOP',
        condition: 'Component stop contact occurs while the supplied stop is active and before any earlier closing event; executable price and fill remain unknown.' });
    if (targetContact && activeSomeInterval !== false) candidates.push({ outcome: 'TARGET',
        condition: 'Component target contact occurs while the supplied target is active and before any earlier closing event; executable price and fill remain unknown.' });
    if (beContact && ((activationContact && activeSomeInterval !== false) || (breakevenActiveAtMs !== null && breakevenActiveAtMs < end))) {
        candidates.push({ outcome: 'BREAKEVEN_STOP', condition: 'An eligible delivered management quote and broker acknowledgement activate the entry-price stop before the adverse component contact; ordering and costs remain unknown.' });
    }
    return {
        diagnosticKind: 'M15_NONEXHAUSTIVE_INTRABAR_UNCERTAINTY', use: 'OUTCOME_DIAGNOSTIC_ONLY_NOT_ENTRY_FEATURE',
        status: !ohlc ? 'COMPONENT_EVIDENCE_UNAVAILABLE' : bar.complete !== true ? 'COMPLETION_UNVERIFIED' : 'INTRABAR_ORDER_AND_EXECUTION_UNRESOLVED',
        side, component, intervalStartMs: start, intervalEndMs: end, complete: bar.complete === true,
        completionEvidence: bar.completionEvidence ?? (bar.complete === true ? 'EXPLICIT_PER_BAR' : 'UNVERIFIED'),
        protectionTiming: { activeFromMs, activeWholeInterval, activeSomeInterval, breakevenActiveAtMs,
            intrabarActivationMakesRangeTimingUnresolved: activeSomeInterval === true && !activeWholeInterval },
        componentRangeContacts: { stop: stopContact, target: targetContact,
            breakevenActivationLevel: activationContact, entryPriceAfterPossibleBreakeven: beContact },
        initialStopVsTargetOrderUnresolved: stopContact === true && targetContact === true && activeSomeInterval !== false,
        breakevenActivationUnresolved: activationContact === true && breakevenActiveAtMs === null,
        conditionalOutcomeCandidates: candidates,
        survival: { status: 'UNRESOLVED', reason: 'Component contacts do not establish actual account protection execution, delivery, polling or timed/manual exits.' },
        exhaustiveBound: { status: 'NOT_ESTABLISHED', lowerNetAud: null, upperNetAud: null, lowerNetR: null, upperNetR: null,
            reason: 'No exhaustive event paths, execution/conversion costs or competing portfolio-state bounds are supplied; no profitability score or numeric return interval is inferred.' },
        limits: ['BUY uses retained bid-component evidence and SELL retained ask-component evidence; missing components never fall back to midpoint or invented spread.',
            'Component threshold contacts are not observed account order fills. OHLC does not order the high and low, establish synchronous quotes or retain executable liquidity.',
            'A breakeven trigger-level contact does not establish a qualifying management poll, timely delivery, protection request or broker acknowledgement.',
            'If entry/protection activation is inside the bar, range contacts may have preceded it. Unknown activation time remains unknown.',
            'Candidates are conditional witnesses, not an exhaustive list or probabilities. Open survival and alternative actual fills remain unresolved.'],
    };
}

module.exports = { describeM15Uncertainty };
