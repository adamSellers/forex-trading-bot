const { HistoricalMarket } = require('../historicalMarket.cjs');
const { ViabilityMarket } = require('../viabilityMarket.cjs');
const { ReplayBroker } = require('../replayBroker.cjs');
const { ReplayClock } = require('../replayClock.cjs');
const { createPolicyOptimization } = require('../viabilityPolicyOptimization.cjs');
const { evaluateIntradayBuyRetest } = require('../../src/runtime/intradayBuyRetestPolicy');
const { evaluateIntradaySellRetest } = require('../../src/runtime/intradaySellRetestPolicy');
const START = Date.parse('2026-09-11T13:00:00Z'), M15 = 900_000;
const metadata = Object.fromEntries(['AUD_USD', 'EUR_USD', 'GBP_USD', 'USD_JPY'].map((name) => [name,
    { name, displayPrecision: name.endsWith('JPY') ? 3 : 5, pipLocation: name.endsWith('JPY') ? -2 : -4,
        marginRate: '0.03333333333333', tradeUnitsPrecision: 0 }]));
const raw = (time, center, range = 0) => ({ time: time / 1000, complete: true,
    mid: { o: center, h: center + range, l: center - range, c: center },
    bid: { o: center - 0.00005, h: center + range - 0.00005, l: center - range - 0.00005, c: center - 0.00005 },
    ask: { o: center + 0.00005, h: center + range + 0.00005, l: center - range + 0.00005, c: center + 0.00005 } });
function market() {
    const clock = new ReplayClock(START);
    const candlesByInstrument = Object.fromEntries(Object.entries({ AUD_USD: 0.7, EUR_USD: 1.1, GBP_USD: 1.3, USD_JPY: 150 })
        .map(([name, center]) => [name, [raw(START, center, name === 'EUR_USD' ? 0.01 : 0)]]));
    return { clock, market: new ViabilityMarket({ clock, candlesByInstrument, pathOrder: 'OHLC', spreadPips: 1,
        homeConversionFeeRate: 0.01, pricingAssumptions: { tradeable: true, liquidityUnits: 1_000_000 } }) };
}

test('AUD settlement fee is applied once after a complete direct or two-leg midpoint path', () => {
    const { market: m } = market();
    const expected = { AUD: 1, USD: 1 / 0.7, EUR: 1.1 / 0.7, GBP: 1.3 / 0.7, JPY: 1 / (150 * 0.7) };
    for (const row of m.getHomeConversions()) {
        expect(Number(row.positionValue)).toBeCloseTo(expected[row.currency], 12);
        expect(Number(row.accountGain)).toBeCloseTo(expected[row.currency] * (row.currency === 'AUD' ? 1 : 0.99), 12);
        expect(Number(row.accountLoss)).toBeCloseTo(expected[row.currency] * (row.currency === 'AUD' ? 1 : 1.01), 12);
    }
});

test.each([['gain', 300_000], ['loss', 600_000]])('%s settles once with fee while open valuation uses neutral conversion', async (_kind, elapsed) => {
    const { clock, market: m } = market();
    const b = new ReplayBroker({ clock, market: m, metadata, initialBalanceAud: 100, slippagePips: 0.2,
        unrealizedConversionPurpose: 'position' });
    const fill = await b.placeMarketOrder('EUR_USD', 10, { stopLossPrice: 1.08, takeProfitPrice: 1.12 });
    const id = fill.orderFillTransaction.tradeOpened.tradeID;
    const account = (await b.getAccountSummary()).account;
    const quote = m.getQuote('EUR_USD'), entry = Number(fill.orderFillTransaction.price);
    expect(Number(account.unrealizedPL)).toBeCloseTo((Number(quote.bids[0].price) - entry) * 10 / 0.7, 12);
    expect(Number(account.marginUsed)).toBeCloseTo(10 * 1.1 / 0.7 / 30, 10);
    clock.set(START + elapsed); m.advanceTo(clock.nowMs());
    const closed = await b.closeTrade(id), exit = Number(closed.orderFillTransaction.price);
    const quotePL = (exit - entry) * 10;
    expect(Number(closed.orderFillTransaction.pl)).toBeCloseTo(quotePL / 0.7 * (quotePL > 0 ? 0.99 : 1.01), 12);
    expect(ReplayBroker.fromCheckpoint({ checkpoint: b.exportCheckpoint(), clock, market: m }).unrealizedConversionPurpose).toBe('position');
});

test.each([['BUY', evaluateIntradayBuyRetest], ['SELL', evaluateIntradaySellRetest]])('%s immutable-prefix reduction exactly preserves actual policy output', (side, policy) => {
    const clock = new ReplayClock(START), bars = Array.from({ length: 401 }, (_, i) => raw(START - (400 - i) * M15, 1.1));
    const m = new HistoricalMarket({ clock, candlesByInstrument: { EUR_USD: bars }, maxBars: 500 });
    const optimize = createPolicyOptimization(), wrapped = optimize.wrap(policy, side);
    const firstArgs = { instrument: 'EUR_USD', candles: m.getCandles('EUR_USD'), nowMs: START };
    const initial = policy(firstArgs);
    clock.set(START + M15); m.advanceTo(clock.nowMs());
    const args = { ...firstArgs, candles: m.getCandles('EUR_USD'), nowMs: clock.nowMs(), priorState: initial.state };
    expect(wrapped(args)).toEqual(policy(args));
    expect(optimize.getStats().trimmed).toBe(1);
    expect(optimize.getStats().removedBars).toBeGreaterThan(380);
});

test('deferred unused initial fallback snapshots immutable row membership and consumed IDs; mutable rows remain eager', () => {
    const clock = new ReplayClock(START), m = new HistoricalMarket({ clock,
        candlesByInstrument: { EUR_USD: [raw(START - M15, 1.1)] } });
    const optimize = createPolicyOptimization(), fn = jest.fn((args) => ({ count: args.candles.length,
        consumed: [...args.consumedEpisodeIds] })), wrapped = optimize.wrap(fn, 'BUY');
    const candles = m.getCandles('EUR_USD'), consumedEpisodeIds = [];
    const result = wrapped({ instrument: 'EUR_USD', candles, nowMs: START, trades: [], historyAvailable: true, consumedEpisodeIds });
    expect(fn).not.toHaveBeenCalled();
    candles.length = 0; consumedEpisodeIds.push('later-change');
    expect(result.count).toBe(1); expect(result.consumed).toEqual([]);
    const mutable = { instrument: 'EUR_USD', candles: [{ time: START - M15 }], nowMs: START,
        trades: [], historyAvailable: true, consumedEpisodeIds: [] };
    wrapped(mutable);
    expect(fn).toHaveBeenCalledTimes(2);
});
