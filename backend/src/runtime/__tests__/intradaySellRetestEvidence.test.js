const { evaluateIntradaySellRetest } = require('../intradaySellRetestPolicy');
const { resolveSellRetestEvidence, sellRetestStateKey, consumedSellRetestPatterns } = require('../intradaySellRetestEvidence');

const end = Date.parse('2026-09-11T13:00:00Z');
const period = 900_000;
function fixture() {
    const prices = Array.from({ length: 8 }, () => ({ open: .7000, high: .7003, low: .6997, close: .7000 }));
    prices.push({ open: .6999, high: .7000, low: .6995, close: .6996 },
        { open: .69955, high: .6998, low: .69945, close: .6996 },
        { open: .6996, high: .69965, low: .6992, close: .69925 });
    const candles = prices.map((bar, i) => ({ ...bar,
        time: new Date(end - (prices.length - i) * period).toISOString(), complete: true,
        ask: Object.fromEntries(Object.entries(bar).map(([key, value]) => [key, value + .00005])),
    }));
    const map = new Map();
    const repository = {
        getState: jest.fn(async (key) => structuredClone(map.get(key) || null)),
        setState: jest.fn(async (key, value) => { map.set(key, structuredClone(value)); }),
    };
    return { args: { instrument: 'AUD_USD', candles, breakoutBars: 8, nowMs: end, trades: [], historyAvailable: true }, repository, map };
}

describe('durable SELL break/retest evidence', () => {
    beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(end));
    afterEach(() => jest.restoreAllMocks());

    test('the frozen break survives restart/cache rollover and its ready confirmation survives allowed same-candle retries', async () => {
        const { args, repository, map } = fixture();
        Date.now.mockReturnValue(end - 2 * period);
        const armed = await resolveSellRetestEvidence({ ...args, candles: args.candles.slice(0, -2), nowMs: end - 2 * period }, repository);
        expect(armed).toMatchObject({ ready: false, classification: 'WAIT_FOR_RETEST', breakout: { level: .6997 } });
        Date.now.mockReturnValue(end);
        const restarted = { ...repository, getState: jest.fn(async (key) => structuredClone(map.get(key))) };
        const confirmed = await resolveSellRetestEvidence({ ...args, candles: args.candles.slice(-2) }, restarted);
        expect(confirmed).toMatchObject({ ready: true, classification: 'CONFIRMED', breakout: { level: .6997 } });
        const retry = await resolveSellRetestEvidence(args, restarted);
        expect(retry.patternId).toBe(confirmed.patternId);
        expect(retry.structuralStopLossPrice).toBe(confirmed.structuralStopLossPrice);
        expect(retry.ready).toBe(true);
    });

    test('an older concurrent scan cannot borrow a newer confirmation or replace durable progress', async () => {
        const { args, repository, map } = fixture();
        const [current, old] = await Promise.all([
            resolveSellRetestEvidence(args, repository),
            resolveSellRetestEvidence({ ...args, candles: args.candles.slice(0, -1), nowMs: end - period }, repository),
        ]);
        expect(current.ready).toBe(true);
        expect(old.ready).toBe(false);
        expect(map.get(sellRetestStateKey(args)).lastProcessedCandleCloseTime).toBe(end);
        expect(repository.setState).toHaveBeenCalledTimes(1);
    });

    test('broker-backed filled patterns remain consumed across runs, closed trades and serialized payloads', async () => {
        const { args, repository } = fixture();
        const first = await resolveSellRetestEvidence(args, repository);
        const trades = [{ instrument: args.instrument, side: 'SELL', mode: 'live', oandaTradeId: '123', isOpen: false,
            brokerReconciliationPayload: JSON.stringify({ liveRuntime: { entryTelemetry: {
                strategyContext: { sellRetest: { patternId: first.patternId } },
            } } }) }];
        expect(consumedSellRetestPatterns(trades, args.instrument)).toEqual([first.patternId]);
        expect(await resolveSellRetestEvidence({ ...args, trades }, repository)).toMatchObject({
            ready: false, classification: 'PATTERN_ALREADY_TRADED', patternId: first.patternId,
        });
    });

    test.each(['missing', 'read', 'write', 'history'])('unavailable %s evidence cannot authorize a new SELL', async (failure) => {
        const { args, repository } = fixture();
        expect(evaluateIntradaySellRetest(args).ready).toBe(true);
        if (failure === 'read') repository.getState.mockRejectedValue(new Error('unavailable'));
        if (failure === 'write') repository.setState.mockRejectedValue(new Error('unavailable'));
        if (failure === 'history') { args.trades = null; args.historyAvailable = false; }
        expect(await resolveSellRetestEvidence(args, failure === 'missing' ? null : repository)).toMatchObject({
            ready: false, classification: 'SELL_RETEST_EVIDENCE_UNAVAILABLE',
        });
    });

    test('empty startup candles do not persist an unusable cursor and healthy data can enter', async () => {
        const { args, repository } = fixture();
        expect((await resolveSellRetestEvidence({ ...args, candles: [] }, repository)).ready).toBe(false);
        expect(repository.setState).not.toHaveBeenCalled();
        expect((await resolveSellRetestEvidence(args, repository)).ready).toBe(true);
    });

    test('a read failure does not poison the later successful durable operation', async () => {
        const { args, repository } = fixture();
        repository.getState.mockRejectedValueOnce(new Error('unavailable'));
        expect((await resolveSellRetestEvidence(args, repository)).ready).toBe(false);
        expect((await resolveSellRetestEvidence(args, repository)).ready).toBe(true);
    });
});
