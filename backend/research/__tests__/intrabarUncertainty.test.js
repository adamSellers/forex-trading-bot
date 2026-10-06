'use strict';

const { describeM15Uncertainty } = require('../intrabarUncertainty.cjs');
const START = Date.parse('2026-10-05T22:00:00Z');
const input = { side: 'BUY', entryPrice: 1.1, stopLossPrice: 1.09, takeProfitPrice: 1.115, breakevenTriggerPrice: 1.11,
    activeFromMs: START - 1000, bar: { time: START / 1000, complete: true,
        bid: { o: 1.1, h: 1.12, l: 1.08, c: 1.1 }, ask: { o: 1.1002, h: 1.1202, l: 1.0802, c: 1.1002 } } };

test('M15 both-boundary and possible breakeven contacts are unresolved conditional outcomes without numeric bounds', () => {
    const result = describeM15Uncertainty(input);
    expect(result.component).toBe('bid');
    expect(result.componentRangeContacts).toEqual({ stop: true, target: true, breakevenActivationLevel: true, entryPriceAfterPossibleBreakeven: true });
    expect(result.initialStopVsTargetOrderUnresolved).toBe(true);
    expect(result.breakevenActivationUnresolved).toBe(true);
    expect(result.conditionalOutcomeCandidates.map((row) => row.outcome)).toEqual(['INITIAL_OR_ACTIVE_STOP', 'TARGET', 'BREAKEVEN_STOP']);
    expect(result.exhaustiveBound).toMatchObject({ status: 'NOT_ESTABLISHED', lowerNetAud: null, upperNetAud: null, lowerNetR: null, upperNetR: null });
    expect(result.survival.status).toBe('UNRESOLVED');
});

test('SELL contacts use actual ask evidence, never midpoint or a mirrored BUY result', () => {
    const result = describeM15Uncertainty({ ...input, side: 'SELL', stopLossPrice: 1.115, takeProfitPrice: 1.09,
        breakevenTriggerPrice: 1.095,
        bar: { ...input.bar, bid: { o: 1.1, h: 1.2, l: 1.05, c: 1.1 }, ask: { o: 1.105, h: 1.11, l: 1.1, c: 1.105 } } });
    expect(result.component).toBe('ask');
    expect(result.componentRangeContacts).toEqual({ stop: false, target: false, breakevenActivationLevel: false, entryPriceAfterPossibleBreakeven: true });
    expect(result.conditionalOutcomeCandidates).toEqual([]);
    expect(result.status).toBe('INTRABAR_ORDER_AND_EXECUTION_UNRESOLVED');
});

test('missing component and unknown activation timing remain explicit uncertainty', () => {
    const missing = describeM15Uncertainty({ ...input, bar: { time: START / 1000, mid: input.bar.bid, complete: true } });
    expect(missing.status).toBe('COMPONENT_EVIDENCE_UNAVAILABLE');
    expect(missing.componentRangeContacts.stop).toBeNull();
    const unknown = describeM15Uncertainty({ ...input, activeFromMs: null });
    expect(unknown.protectionTiming.activeSomeInterval).toBeNull();
    expect(unknown.protectionTiming.activeWholeInterval).toBeNull();
    const intrabar = describeM15Uncertainty({ ...input, activeFromMs: START + 450000 });
    expect(intrabar.protectionTiming.intrabarActivationMakesRangeTimingUnresolved).toBe(true);
    const later = describeM15Uncertainty({ ...input, activeFromMs: START + 900000, breakevenTriggerPrice: null });
    expect(later.conditionalOutcomeCandidates).toEqual([]);
});

test('explicit earlier breakeven activation supports only a conditional stop candidate, without inventing trigger acknowledgement', () => {
    const result = describeM15Uncertainty({ ...input, breakevenTriggerPrice: null, stopLossPrice: null, takeProfitPrice: null,
        breakevenActiveAtMs: START - 1000 });
    expect(result.conditionalOutcomeCandidates.map((row) => row.outcome)).toEqual(['BREAKEVEN_STOP']);
    expect(result.breakevenActivationUnresolved).toBe(false);
    expect(result.exhaustiveBound.status).toBe('NOT_ESTABLISHED');
});

test('normalized long-key candles are supported and invalid inputs fail explicitly', () => {
    const result = describeM15Uncertainty({ ...input, bar: { time: new Date(START).toISOString(), complete: true,
        bid: { open: 1.1, high: 1.12, low: 1.08, close: 1.1 } } });
    expect(result.intervalEndMs).toBe(START + 900000);
    expect(() => describeM15Uncertainty({ ...input, side: 'UNKNOWN' })).toThrow('BUY or SELL');
    expect(() => describeM15Uncertainty({ ...input, entryPrice: 0 })).toThrow('entryPrice');
    expect(() => describeM15Uncertainty({ ...input, bar: { ...input.bar, time: START / 1000 + 1 } })).toThrow('grid aligned');
    expect(() => describeM15Uncertainty({ ...input, bar: { ...input.bar, sourceIntervalEndMs: START + 3600000 } })).toThrow('not M15');
    expect(describeM15Uncertainty({ ...input, bar: { ...input.bar, complete: false } }).status).toBe('COMPLETION_UNVERIFIED');
    expect(() => describeM15Uncertainty({ ...input, bar: { ...input.bar, bid: { o: 1.1, h: 1, l: 1.2, c: 1.1 } } })).toThrow('OHLC is invalid');
});
