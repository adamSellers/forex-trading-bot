'use strict';

const { HistoricalMarket } = require('../historicalMarket.cjs');
const { AudCurrencyConverter } = require('../../src/runtime/currencyConversion');
const { normalizeOandaPrice } = require('../../src/runtime/quoteAvailability');

const start = Date.parse('2026-10-03T15:00:00Z') / 1000;
const executableAssumptions = { tradeable: true, liquidityUnits: 1000000 };
const flat = (price) => ({ o: price, h: price, l: price, c: price });
function bar(time, mid = 1.3, bid = mid - 0.00002, ask = mid + 0.00002) {
    return { time, open: mid, high: mid, low: mid, close: mid,
        mid: flat(mid), bid: flat(bid), ask: flat(ask), volume: 10, complete: true };
}
function fixture(candlesByInstrument, options = {}) {
    let now = (start + 900) * 1000;
    const clock = { nowMs: () => now };
    const market = new HistoricalMarket({ candlesByInstrument, clock, ...options });
    return { market, clock, advance: (value) => { now = value; market.advanceTo(value); } };
}
const conversion = (market, currency) => market.getHomeConversions().find((row) => row.currency === currency);

test('only explicit completed intervals ending by the clock are exposed, with source time distinct from query time', () => {
    const bars = [bar(start), bar(start + 900, 9), { ...bar(start + 1800), complete: false },
        { ...bar(start + 2700), complete: undefined }];
    const { market, advance } = fixture({ GBP_USD: bars }, { clock: { nowMs: () => (start + 900) * 1000 - 1 } });
    expect(market.getCandles('GBP_USD')).toEqual([]);
    expect(market.getQuote('GBP_USD').reason).toBe('NO_COMPLETED_M15_BAR');
    advance((start + 900) * 1000);
    expect(market.getCandles('GBP_USD', '15m')).toHaveLength(1);
    expect(market.getCompletedBar('GBP_USD')).toMatchObject({ close: 1.3,
        time: new Date(start * 1000).toISOString(), sourceIntervalEndMs: (start + 900) * 1000 });
    advance((start + 4500) * 1000);
    expect(market.getCandles('GBP_USD').map((row) => row.close)).toEqual([1.3, 9]);
    expect(market.getQuote('GBP_USD')).toMatchObject({ time: new Date((start + 1800) * 1000).toISOString(),
        sourceIntervalEndMs: (start + 1800) * 1000, ageSinceSourceIntervalEndMs: 2700000 });
    expect(market.getQuote('GBP_USD')).not.toHaveProperty('fetchedAt');
    expect(market.summary().instruments[0].m15).toMatchObject({
        completedAvailableBarsSeen: 2, excludedIncompleteBars: 1, excludedUnknownCompletionBars: 1,
    });
});

test('four contiguous quarters aggregate each component at a completed UTC hour, including Sydney DST transition', () => {
    const bars = Array.from({ length: 8 }, (_, i) => {
        const value = i + 10;
        const component = (offset) => ({ o: value + offset, h: value + offset + 0.5,
            l: value + offset - 0.5, c: value + offset + 0.2 });
        return { time: start + i * 900, mid: component(0), bid: component(-1), ask: component(1), volume: i + 1, complete: true };
    });
    const { market, advance } = fixture({ GBP_USD: bars });
    advance((start + 3600) * 1000 - 1);
    expect(market.getCandles('GBP_USD', 'H1')).toEqual([]);
    advance((start + 3600) * 1000);
    expect(market.getCandles('GBP_USD', '1h')).toEqual([expect.objectContaining({
        time: '2026-10-03T15:00:00.000Z', open: 10, high: 13.5, low: 9.5, close: 13.2, volume: 10,
        bid: { open: 9, high: 12.5, low: 8.5, close: 12.2 },
        ask: { open: 11, high: 14.5, low: 10.5, close: 14.2 },
        sourceM15IntervalStartsSeconds: [start, start + 900, start + 1800, start + 2700],
    })]);
    advance((start + 7200) * 1000);
    expect(market.getCandles('GBP_USD', 'H1').map((row) => row.time))
        .toEqual(['2026-10-03T15:00:00.000Z', '2026-10-03T16:00:00.000Z']);
    expect(market.getCandles('GBP_USD', 'H1').map((row) => row.sourceIntervalEndMs))
        .toEqual([(start + 3600) * 1000, (start + 7200) * 1000]);
});

test.each(['absent', 'incomplete', 'unknown'])('an %s quarter never becomes a filled H1 bar and the following full hour recovers', (kind) => {
    const bars = Array.from({ length: 8 }, (_, i) => bar(start + i * 900));
    if (kind === 'absent') bars.splice(1, 1);
    else bars[1].complete = kind === 'incomplete' ? false : undefined;
    const { market, advance } = fixture({ GBP_USD: bars });
    advance((start + 3600) * 1000);
    expect(market.getCandles('GBP_USD', 'H1')).toEqual([]);
    advance((start + 7200) * 1000);
    expect(market.getCandles('GBP_USD', 'H1')).toHaveLength(1);
    expect(market.getCandles('GBP_USD', 'H1')[0].time).toBe('2026-10-03T16:00:00.000Z');
    expect(market.summary().instruments[0].h1.discardedObservedHours).toBe(1);
});

test('H1 keeps missing component evidence missing while preserving valid primary OHLC', () => {
    const bars = Array.from({ length: 4 }, (_, i) => bar(start + i * 900));
    delete bars[1].bid;
    const { market, advance } = fixture({ GBP_USD: bars });
    advance((start + 3600) * 1000);
    const hour = market.getCandles('GBP_USD', 'H1')[0];
    expect(hour).toMatchObject({ open: 1.3, close: 1.3, bid: null });
    expect(hour.ask).toEqual({ open: 1.30002, high: 1.30002, low: 1.30002, close: 1.30002 });
});

test('absent completion flags require explicit provenance, retain that distinction and never override incomplete flags', () => {
    const bars = Array.from({ length: 4 }, (_, i) => bar(start + i * 900));
    bars.forEach((row) => { delete row.complete; });
    const now = (start + 3600) * 1000;
    expect(fixture({ GBP_USD: bars }, { clock: { nowMs: () => now } }).market.getCandles('GBP_USD')).toEqual([]);
    const declared = fixture({ GBP_USD: bars }, { clock: { nowMs: () => now }, completedOnlyDeclared: true }).market;
    expect(declared.getCandles('GBP_USD')).toHaveLength(4);
    expect(declared.getCompletedBar('GBP_USD').completionEvidence).toBe('DECLARED_COMPLETED_ONLY_ARCHIVE');
    expect(declared.getCandles('GBP_USD', 'H1')[0].completionEvidence).toBe('M15_COMPLETION_INCLUDES_DECLARED_ARCHIVE_PROVENANCE');
    expect(declared.summary()).toMatchObject({ completedOnlyDeclared: true,
        instruments: [expect.objectContaining({ m15: expect.objectContaining({ barsAcceptedViaCompletedOnlyDeclaration: 4,
            completionEvidence: { complete: 0, incomplete: 0, unobserved: 4 } }) })] });
    bars[1].complete = false; bars[2].complete = null;
    const incomplete = fixture({ GBP_USD: bars }, { clock: { nowMs: () => now }, completedOnlyDeclared: true }).market;
    expect(incomplete.getCandles('GBP_USD')).toHaveLength(2);
    expect(incomplete.getCandles('GBP_USD', 'H1')).toEqual([]);
    expect(incomplete.summary().instruments[0].m15).toMatchObject({ excludedIncompleteBars: 1, excludedUnknownCompletionBars: 1 });
    expect(() => fixture({}, { completedOnlyDeclared: 'true' })).toThrow('explicitly boolean');
});

test('explicit supplied H1 is causal, independently validated, and overrides reconstruction including explicit empty input', () => {
    const quarters = Array.from({ length: 8 }, (_, i) => bar(start + i * 900));
    const hour = { time: start, open: 2, high: 3, low: 1, close: 2.5, complete: true };
    const { market, advance } = fixture({ GBP_USD: quarters }, { h1ByInstrument: { GBP_USD: [hour] } });
    expect(market.getCandles('GBP_USD', 'H1')).toEqual([]);
    advance((start + 7200) * 1000);
    expect(market.getCandles('GBP_USD', 'H1')).toEqual([expect.objectContaining({ close: 2.5, bid: null, ask: null,
        source: 'EXPLICIT_H1_INPUT', sourceIntervalEndMs: (start + 3600) * 1000 })]);
    expect(fixture({ GBP_USD: quarters }, { h1ByInstrument: { GBP_USD: [] },
        clock: { nowMs: () => (start + 7200) * 1000 } }).market.getCandles('GBP_USD', 'H1')).toEqual([]);
    expect(() => fixture({}, { h1ByInstrument: { GBP_USD: [{ ...hour, time: start + 900 }] } })).toThrow('UTC-grid aligned');
});

test('bounded histories and monotonic cursors do not duplicate bars on repeated advance', () => {
    const bars = Array.from({ length: 24 }, (_, i) => bar(start + i * 900));
    const { market, advance } = fixture({ GBP_USD: bars }, { maxBars: 3 });
    advance((start + 24 * 900) * 1000);
    const before = market.summary();
    advance((start + 24 * 900) * 1000);
    expect(market.summary()).toEqual(before);
    expect(market.getCandles('GBP_USD').map((row) => row.sourceIntervalStartSeconds))
        .toEqual([start + 21 * 900, start + 22 * 900, start + 23 * 900]);
    expect(market.getCandles('GBP_USD', 'H1')).toHaveLength(3);
    expect(before.instruments[0].m15).toMatchObject({ consumedInputBars: 24, completedAvailableBarsSeen: 24, retainedBars: 3 });
    const returned = market.getCandles('GBP_USD');
    returned.pop();
    expect(market.getCandles('GBP_USD')).toHaveLength(3);
    expect(() => { market.getCompletedBar('GBP_USD').ask.close = 999; }).toThrow(TypeError);
    expect(() => market.advanceTo((start + 24 * 900) * 1000 - 1)).toThrow('backwards');
});

test.each([
    ['ISO time', (row) => { row.time = new Date(start * 1000).toISOString(); }, 'integer UNIX seconds'],
    ['milliseconds time', (row) => { row.time *= 1000; }, 'four-digit ISO year'],
    ['fractional time', (row) => { row.time += 0.5; }, 'integer UNIX seconds'],
    ['misaligned time', (row) => { row.time += 1; }, 'UTC-grid aligned'],
    ['string price', (row) => { row.bid.c = '1'; }, 'positive finite numbers'],
    ['nonfinite price', (row) => { row.bid.c = Infinity; }, 'positive finite numbers'],
    ['negative price', (row) => { row.ask.o = -1; }, 'positive finite numbers'],
    ['inconsistent bounds', (row) => { row.ask.h = row.ask.l - 1; }, 'inconsistent OHLC bounds'],
    ['conflicting primary', (row) => { row.high += 1; }, 'differs from supplied midpoint'],
])('rejects %s without silently reinterpreting units or values', (_name, change, message) => {
    const value = bar(start); change(value);
    expect(() => fixture({ GBP_USD: [value] })).toThrow(message);
});

test('rejects duplicate and nonchronological rows and invalid clock/history/pricing options', () => {
    expect(() => fixture({ GBP_USD: [bar(start), bar(start)] })).toThrow('strictly increasing');
    expect(() => fixture({ GBP_USD: [bar(start + 900), bar(start)] })).toThrow('strictly increasing');
    expect(() => fixture({ bad_name: [] })).toThrow('Invalid FX instrument');
    expect(() => fixture({}, { maxBars: 0 })).toThrow('positive integer');
    expect(() => fixture({}, { clock: {} })).toThrow('clock.nowMs');
    expect(() => fixture({}, { clock: { nowMs: () => '123' } })).toThrow('integer UNIX milliseconds');
    expect(() => fixture({}, { pricingAssumptions: { tradeable: 'yes' } })).toThrow('must be boolean');
    expect(() => fixture({}, { pricingAssumptions: { liquidityUnits: 0 } })).toThrow('positive finite');
    expect(() => fixture({}, { pricingAssumptions: { spreadPips: 1 } })).toThrow('Unsupported pricing assumption');
    expect(() => fixture({ GBP_USD: [] }).market.getCandles('GBP_USD', 'D')).toThrow('Unsupported historical timeframe');
});

test('coarse quote preserves component closes and leaves execution unobserved until caller declares assumptions', () => {
    const { market, advance } = fixture({ GBP_USD: [bar(start, 1.3, 1.29, 1.31)] });
    expect(market.getQuote('GBP_USD')).toMatchObject({ status: 'UNAVAILABLE',
        reason: 'EXECUTABLE_PRICING_ASSUMPTIONS_NOT_DECLARED', componentQuoteStatus: 'AVAILABLE',
        tradeable: null, tradeabilityStatus: 'UNOBSERVED', liquidityStatus: 'UNOBSERVED',
        bids: [{ price: '1.29' }], asks: [{ price: '1.31' }], source: 'COARSE_M15_COMPONENT_CLOSE' });
    advance((start + 900) * 1000 + 10000);
    expect(market.getQuote('GBP_USD').ageSinceSourceIntervalEndMs).toBe(10000);
    const model = fixture({ GBP_USD: [bar(start, 1.3, 1.29, 1.31)] }, { pricingAssumptions: executableAssumptions }).market;
    const quote = model.getQuote('GBP_USD');
    expect(quote).toMatchObject({ status: 'AVAILABLE', tradeable: true, liquidityStatus: 'DECLARED_MODEL_ASSUMPTION',
        pricingAssumptions: executableAssumptions, bids: [{ price: '1.29', liquidity: 1000000 }] });
    expect(model.summary().pricingAssumptions).toEqual(executableAssumptions);
    expect(normalizeOandaPrice(quote, { instrument: 'GBP_USD', fetchedAt: (start + 900) * 1000 }))
        .toMatchObject({ bid: 1.29, ask: 1.31, tradeable: true, invalidReason: null });
});

test('missing, crossed, unknown instrument and nontradeable model quotes remain unavailable', () => {
    const missing = bar(start); delete missing.ask;
    const { market } = fixture({ GBP_USD: [missing], EUR_USD: [bar(start, 1.3, 1.31, 1.29)] },
        { pricingAssumptions: executableAssumptions });
    expect(market.getQuote('GBP_USD')).toMatchObject({ status: 'UNAVAILABLE', reason: 'BID_ASK_COMPONENT_EVIDENCE_UNAVAILABLE', bids: [], asks: [] });
    expect(market.getQuote('EUR_USD').reason).toBe('CROSSED_COMPONENT_CLOSES_UNUSABLE_IN_COARSE_QUOTE_MODEL');
    expect(market.getQuote('USD_JPY').reason).toBe('INSTRUMENT_NOT_PROVIDED');
    const off = fixture({ GBP_USD: [bar(start)] }, { pricingAssumptions: { tradeable: false, liquidityUnits: 100 } }).market;
    expect(off.getQuote('GBP_USD')).toMatchObject({ status: 'UNAVAILABLE', tradeable: false, reason: 'DECLARED_NONTRADEABLE_MODEL' });
});

test('contemporaneous AUD conversions respect gain/loss direction for direct, cross and inverse JPY legs', () => {
    const inputs = {
        AUD_USD: [bar(start, 0.65, 0.64, 0.66)], GBP_USD: [bar(start, 1.3, 1.29, 1.31)],
        USD_JPY: [bar(start, 150, 149, 151)], USD_CHF: [bar(start, 0.9, 0.89, 0.91)],
    };
    const { market } = fixture(inputs);
    expect(conversion(market, 'AUD')).toMatchObject({ status: 'AVAILABLE', accountGain: '1', accountLoss: '1', positionValue: '1', source: 'SAME_CURRENCY_IDENTITY' });
    for (const [currency, gain, loss, position] of [
        ['USD', 1 / 0.66, 1 / 0.64, 1 / 0.65],
        ['GBP', 1.29 / 0.66, 1.31 / 0.64, 1.3 / 0.65],
        ['JPY', 1 / (151 * 0.66), 1 / (149 * 0.64), 1 / (150 * 0.65)],
        ['CHF', 1 / (0.91 * 0.66), 1 / (0.89 * 0.64), 1 / (0.9 * 0.65)],
    ]) {
        const result = conversion(market, currency);
        expect(result.status).toBe('AVAILABLE');
        expect(Number(result.accountGain)).toBeCloseTo(gain, 12);
        expect(Number(result.accountLoss)).toBeCloseTo(loss, 12);
        expect(Number(result.positionValue)).toBeCloseTo(position, 12);
        expect(result.updatedAt).toBe((start + 900) * 1000);
        expect(result.source).toBe('COARSE_M15_COMPONENT_CLOSE_DERIVATION');
    }
    const converter = new AudCurrencyConverter({ homeConversions: market.getHomeConversions(), now: () => (start + 900) * 1000 });
    expect(converter.getHomeRate('JPY', { purpose: 'pnl', amount: 1 })).toBeCloseTo(1 / (151 * 0.66), 12);
    expect(converter.getHomeRate('JPY', { purpose: 'pnl', amount: -1 })).toBeCloseTo(1 / (149 * 0.64), 12);
    expect(converter.getHomeRate('GBP', { purpose: 'position' })).toBeCloseTo(1.3 / 0.65, 12);
});

test('absent bridges, future bridges and incomparable completed intervals are explicit conversion gaps', () => {
    const { market, advance } = fixture({ GBP_USD: [bar(start), bar(start + 900)],
        AUD_USD: [bar(start + 900, 0.65, 0.64, 0.66)] });
    expect(conversion(market, 'USD')).toMatchObject({ status: 'UNAVAILABLE', accountGain: null, accountLoss: null,
        positionValue: null, reason: 'CAUSAL_CONVERSION_PATH_UNAVAILABLE' });
    advance((start + 1800) * 1000);
    expect(conversion(market, 'GBP').status).toBe('AVAILABLE');
    const mismatched = fixture({ GBP_USD: [bar(start)], AUD_USD: [bar(start + 900, 0.65, 0.64, 0.66)] },
        { clock: { nowMs: () => (start + 1800) * 1000 } }).market;
    expect(conversion(mismatched, 'GBP')).toMatchObject({ status: 'UNAVAILABLE',
        reason: 'INCOMPARABLE_COMPONENT_CLOSE_INTERVALS', accountGain: null, accountLoss: null, positionValue: null });
    expect(mismatched.summary().homeConversions).toContainEqual(expect.objectContaining({ currency: 'GBP', reason: 'INCOMPARABLE_COMPONENT_CLOSE_INTERVALS' }));
    const noBridge = fixture({ USD_JPY: [bar(start, 150, 149, 151)] }).market;
    expect(conversion(noBridge, 'JPY').reason).toBe('CAUSAL_CONVERSION_PATH_UNAVAILABLE');
    const converter = new AudCurrencyConverter({ homeConversions: noBridge.getHomeConversions(), now: () => (start + 900) * 1000 });
    expect(converter.getHomeRate('JPY')).toBeNull();
});

test('conversion evidence is unchanged when clock moves without a new completed component bar', () => {
    const { market, advance } = fixture({ AUD_USD: [bar(start, 0.65, 0.64, 0.66)] });
    const before = conversion(market, 'USD');
    advance((start + 7200) * 1000);
    const after = conversion(market, 'USD');
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.accountGain).toBe(before.accountGain);
    expect(after.ageSinceSourceIntervalEndMs).toBe(6300000);
    expect(market.summary().assumptions).toContainEqual(expect.stringContaining('not a production freshness or broker-health rule'));
});
