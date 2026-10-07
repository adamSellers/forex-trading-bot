const { evaluateIntradayBuyRetest, consumedBuyRetestEpisodeIds } = require('../intradayBuyRetestPolicy');
const PERIOD = 900_000;
const START = Date.parse('2026-08-10T07:00:00Z');
function bar(index, prices = {}) {
    const mid = { open: 1.1000, high: 1.1005, low: 1.0998, close: 1.1001, ...prices };
    return { time: new Date(START + index * PERIOD).toISOString(), complete: true, ...mid,
        bid: Object.fromEntries(Object.entries(mid).map(([key, value]) => [key, Number((value - .00004).toFixed(5))])) };
}
function fixture() {
    return [...Array.from({ length: 8 }, (_, i) => bar(i)),
        bar(8, { open: 1.1004, high: 1.1011, low: 1.1002, close: 1.1010 }),
        bar(9, { open: 1.1009, high: 1.1011, low: 1.1004, close: 1.1008 }),
        bar(10, { open: 1.1008, high: 1.1015, low: 1.1006, close: 1.1013 })];
}
function evaluate(candles, options = {}) {
    return evaluateIntradayBuyRetest({ instrument: 'EUR_USD', candles,
        nowMs: Date.parse(candles.at(-1).time) + PERIOD, ...options });
}

describe('completed M15 BUY break/retest/confirmation episodes', () => {
    test('requires distinct stages and freezes the preceding eight midpoint highs', () => {
        const candles = fixture();
        expect(evaluate(candles.slice(0, -2))).toMatchObject({ ready: false, classification: 'WAIT_FOR_RETEST', breakout: { level: 1.1005 } });
        expect(evaluate(candles.slice(0, -1))).toMatchObject({ ready: false, classification: 'WAIT_FOR_CONFIRMATION', retest: { high: 1.1011 } });
        expect(evaluate(candles)).toMatchObject({ ready: true, classification: 'CONFIRMED', structuralStopLossPrice: 1.10035 });
    });
    test('retouches update the retest high/time but retain the first bid low and require a later candle', () => {
        const candles = fixture();
        candles[10] = bar(10, { open: 1.1008, high: 1.1012, low: 1.10045, close: 1.1010 });
        const retouch = evaluate(candles);
        expect(retouch).toMatchObject({ ready: false, retest: { time: candles[10].time, high: 1.1012, bidLow: 1.10036 } });
        candles.push(bar(11, { open: 1.1010, high: 1.1015, low: 1.1006, close: 1.1014 }));
        expect(evaluate(candles)).toMatchObject({ ready: true, structuralStopLossPrice: 1.10035, episodeId: retouch.episodeId });
    });
    test('bid low includes intervening and confirmation candles without midpoint substitution', () => {
        const candles = fixture(); candles[10].bid.low = 1.1001;
        expect(evaluate(candles)).toMatchObject({ ready: true, structuralStopLossPrice: 1.10009 });
    });
    test.each([1.1005, 1.1004])('close %s at/below the frozen level cancels', (close) => {
        const candles = fixture(); candles[10] = bar(10, { open: 1.1008, high: 1.1012, low: 1.1003, close });
        expect(evaluate(candles)).toMatchObject({ ready: false, classification: 'BREAK_CANCELLED', breakout: null });
    });
    test('bearish or retouching candles cannot confirm even when they clear the retest high', () => {
        const candles = fixture(); candles[10].open = 1.1014;
        expect(evaluate(candles).ready).toBe(false);
        candles[10] = bar(10, { open: 1.1008, high: 1.1015, low: 1.1005, close: 1.1014 });
        expect(evaluate(candles)).toMatchObject({ ready: false, classification: 'WAIT_FOR_CONFIRMATION' });
    });
    test.each([9, 10])('missing bid on episode candle %s prevents entry and a complete refresh restores it', (index) => {
        const candles = fixture(), complete = structuredClone(candles); delete candles[index].bid;
        const missing = evaluate(candles);
        expect(missing).toMatchObject({ ready: false, classification: 'BID_EVIDENCE_UNAVAILABLE', structuralStopLossPrice: null });
        expect(evaluate(complete, { priorState: missing.state })).toMatchObject({ ready: true, episodeId: missing.episodeId, structuralStopLossPrice: 1.10035 });
        expect(evaluate(complete.slice(-1), { priorState: missing.state }).ready).toBe(false);
    });
    test('same confirmation remains available for permitted local retries, never after a filled episode', () => {
        const candles = fixture(), first = evaluate(candles);
        expect(evaluate(candles, { priorState: first.state })).toMatchObject({ ready: true, episodeId: first.episodeId });
        const consumed = evaluate(candles, { priorState: first.state, consumedEpisodeIds: [first.episodeId] });
        expect(consumed).toMatchObject({ ready: false, classification: 'EPISODE_ALREADY_TRADED', state: { consumed: true } });
        const later = [...candles, bar(11, { low: 1.1004, high: 1.1012, close: 1.1009 }),
            bar(12, { open: 1.1009, low: 1.1006, high: 1.1017, close: 1.1016 })];
        expect(evaluate(later, { priorState: consumed.state })).toMatchObject({ ready: false, classification: 'EPISODE_ALREADY_TRADED', episodeId: first.episodeId });
    });
    test('unfilled confirmation expires but retains its breakout; a new retest can confirm the same unconsumed episode', () => {
        const candles = fixture(), first = evaluate(candles);
        candles.push(bar(11, { open: 1.1013, high: 1.1015, low: 1.1007, close: 1.1014 }));
        const expired = evaluate(candles, { priorState: first.state });
        expect(expired).toMatchObject({ ready: false, classification: 'WAIT_FOR_RETEST', episodeId: first.episodeId, retest: null, confirmation: null });
        candles.push(bar(12, { open: 1.1010, high: 1.1011, low: 1.1004, close: 1.1008 }),
            bar(13, { open: 1.1008, high: 1.1015, low: 1.1006, close: 1.1013 }));
        expect(evaluate(candles, { priorState: expired.state })).toMatchObject({ ready: true, episodeId: first.episodeId });
    });
    test('a consumed episode rearms only after cancellation and a distinct later break/retest/confirmation', () => {
        const candles = fixture(), first = evaluate(candles);
        const consumed = evaluate(candles, { priorState: first.state, consumedEpisodeIds: [first.episodeId] });
        candles.push(bar(11, { open: 1.1008, high: 1.1009, low: 1.1003, close: 1.1005 }));
        const reset = evaluate(candles, { priorState: consumed.state });
        expect(reset).toMatchObject({ breakout: null, state: { consumed: false } });
        const level = Math.max(...candles.slice(-8).map(c => c.high));
        candles.push(bar(12, { open: level - .0001, high: level + .0006, low: level - .0002, close: level + .0004 }),
            bar(13, { open: level + .0003, high: level + .0005, low: level - .0001, close: level + .0002 }),
            bar(14, { open: level + .0003, high: level + .0009, low: level + .0001, close: level + .0007 }));
        const rearmed = evaluate(candles, { priorState: reset.state, consumedEpisodeIds: [first.episodeId] });
        expect(rearmed.ready).toBe(true); expect(rearmed.episodeId).not.toBe(first.episodeId);
    });
    test('gap, malformed and older caches cannot erase or rearm a consumed frozen episode', () => {
        const candles = fixture(), first = evaluate(candles);
        const consumed = evaluate(candles, { priorState: first.state, consumedEpisodeIds: [first.episodeId] });
        for (const evidence of [[bar(13, { open: 1.1007, high: 1.1010, low: 1.1006, close: 1.1008 })], [{ ...bar(11), low: NaN }], candles.slice(0, -1)]) {
            const result = evaluate(evidence, { priorState: consumed.state, nowMs: START + 14 * PERIOD });
            expect(result.ready).toBe(false); expect(result.state).toMatchObject({ consumed: true, breakout: first.breakout });
        }
    });
    test.each([false, true])('an observed cancellation across a gap clears the episode, while an above-level gap cannot (consumed=%s)', (filled) => {
        const first = evaluate(fixture());
        const prior = filled ? evaluate(fixture(), { priorState: first.state, consumedEpisodeIds: [first.episodeId] }).state : first.state;
        const above = bar(13, { open: 1.1008, high: 1.1011, low: 1.1004, close: 1.1009 });
        const blocked = evaluate([above], { priorState: prior });
        expect(blocked).toMatchObject({ ready: false, breakout: first.breakout });
        expect(blocked.state.lastProcessedCandleCloseTime).toBe(prior.lastProcessedCandleCloseTime);
        const cancelled = evaluate([bar(13, { open: 1.1008, high: 1.1009, low: 1.1003, close: 1.1005 })], { priorState: prior });
        expect(cancelled).toMatchObject({ ready: false, breakout: null, state: { consumed: false } });
        const newBars = Array.from({ length: 8 }, (_, i) => bar(14 + i));
        newBars.push(bar(22, { open: 1.1004, high: 1.1011, low: 1.1002, close: 1.1010 }),
            bar(23, { open: 1.1009, high: 1.1011, low: 1.1004, close: 1.1008 }),
            bar(24, { open: 1.1008, high: 1.1015, low: 1.1006, close: 1.1013 }));
        const next = evaluate(newBars, { priorState: cancelled.state, consumedEpisodeIds: [first.episodeId] });
        expect(next.ready).toBe(true); expect(next.episodeId).not.toBe(first.episodeId);
    });
    test.each([false, true])('later supplied cancellation is observed after above-level gap bars without bridging their retests or stop span (consumed=%s)', (filled) => {
        const first = evaluate(fixture());
        const prior = filled ? evaluate(fixture(), { priorState: first.state, consumedEpisodeIds: [first.episodeId] }).state : first.state;
        const above = [bar(13, { open: 1.1008, high: 1.1011, low: 1.1004, close: 1.1009 }),
            bar(14, { open: 1.1009, high: 1.1017, low: 1.1006, close: 1.1016 })];
        above[0].bid.low = 1.099;
        const blocked = evaluate(above, { priorState: prior });
        expect(blocked).toMatchObject({ ready: false, episodeId: first.episodeId, breakout: first.breakout,
            retest: null, confirmation: null, structuralStopLossPrice: null });
        expect(blocked.state.lastProcessedCandleCloseTime).toBe(prior.lastProcessedCandleCloseTime);
        const cancellation = bar(15, { open: 1.1008, high: 1.1009, low: 1.1003, close: 1.1005 });
        const cancelled = evaluate([...above, cancellation], { priorState: prior });
        expect(cancelled).toMatchObject({ ready: false, breakout: null, state: { consumed: false } });
        const completeWindow = Array.from({ length: 8 }, (_, i) => bar(16 + i));
        const newPattern = [bar(24, { open: 1.1004, high: 1.1011, low: 1.1002, close: 1.1010 }),
            bar(25, { open: 1.1009, high: 1.1011, low: 1.1004, close: 1.1008 }),
            bar(26, { open: 1.1008, high: 1.1015, low: 1.1006, close: 1.1013 })];
        const next = evaluate([...above, cancellation, ...completeWindow, ...newPattern], {
            priorState: prior, consumedEpisodeIds: filled ? [first.episodeId] : [] });
        expect(next).toMatchObject({ ready: true, structuralStopLossPrice: 1.10035 });
        expect(next.episodeId).not.toBe(first.episodeId);
    });
    test('JPY stop is one declared broker tick below episode bid low', () => {
        const candles = fixture().map(c => ({ ...c, bid: { ...c.bid, low: 110.036, open: 110.1, close: 110.2, high: 110.3 } }));
        expect(evaluate(candles, { instrument: 'USD_JPY', displayPrecision: 3 })).toMatchObject({ structuralStopLossPrice: 110.035 });
    });
    test('filled episodes are recovered across runs from broker-backed BUY trades only', () => {
        const id = evaluate(fixture()).episodeId;
        const trade = { instrument: 'EUR_USD', side: 'BUY', oandaTradeId: '123', mode: 'live', isOpen: false,
            brokerReconciliationPayload: { liveRuntime: { entryTelemetry: { strategyContext: { buyRetest: { episodeId: id } } } } } };
        expect(consumedBuyRetestEpisodeIds([trade, { ...trade, side: 'SELL' }, { ...trade, oandaTradeId: null }], 'EUR_USD')).toEqual([id]);
    });
});
