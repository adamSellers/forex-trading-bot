const { evaluateIntradayBuyRetest } = require('../intradayBuyRetestPolicy');
const { resolveBuyRetestEvidence, buyRetestStateKey, consumedBuyRetestEpisodes } = require('../intradayBuyRetestEvidence');

const end = Date.parse('2026-09-11T13:00:00Z');
const period = 900_000;
function fixture() {
    const { buyRetestFixture } = require('../../strategies/__tests__/fixtures/intradayBuyRetestFixture');
    const candles = buyRetestFixture({ nowMs: end }).m15;
    const map = new Map();
    const repository = {
        getState: jest.fn(async (key) => structuredClone(map.get(key) || null)),
        setState: jest.fn(async (key, value) => { map.set(key, structuredClone(value)); }),
    };
    return { args: { instrument: 'AUD_USD', candles, breakoutBars: 8, nowMs: end, trades: [], historyAvailable: true }, repository, map };
}

describe('durable BUY break/retest evidence', () => {
    beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(end));
    afterEach(() => jest.restoreAllMocks());

    test('the frozen break survives restart/cache rollover and its ready confirmation survives allowed same-candle retries', async () => {
        const { args, repository, map } = fixture();
        Date.now.mockReturnValue(end - 2 * period);
        const armed = await resolveBuyRetestEvidence({ ...args, candles: args.candles.slice(0, -2), nowMs: end - 2 * period }, repository);
        expect(armed).toMatchObject({ ready: false, classification: 'WAIT_FOR_RETEST', breakout: { level: evaluateIntradayBuyRetest(args).breakout.level } });
        Date.now.mockReturnValue(end);
        const restarted = { ...repository, getState: jest.fn(async (key) => structuredClone(map.get(key))) };
        const confirmed = await resolveBuyRetestEvidence({ ...args, candles: args.candles.slice(-2) }, restarted);
        expect(confirmed).toMatchObject({ ready: true, classification: 'CONFIRMED', breakout: { level: armed.breakout.level } });
        const retry = await resolveBuyRetestEvidence(args, restarted);
        expect(retry.episodeId).toBe(confirmed.episodeId);
        expect(retry.structuralStopLossPrice).toBe(confirmed.structuralStopLossPrice);
        expect(retry.ready).toBe(true);
    });

    test('an older concurrent scan cannot borrow a newer confirmation or replace durable progress', async () => {
        const { args, repository, map } = fixture();
        const [current, old] = await Promise.all([
            resolveBuyRetestEvidence(args, repository),
            resolveBuyRetestEvidence({ ...args, candles: args.candles.slice(0, -1), nowMs: end - period }, repository),
        ]);
        expect(current.ready).toBe(true);
        expect(old.ready).toBe(false);
        expect(map.get(buyRetestStateKey(args)).lastProcessedCandleCloseTime).toBe(end);
        expect(repository.setState).toHaveBeenCalledTimes(1);
    });

    test('broker-backed filled patterns remain consumed across runs, closed trades and serialized payloads', async () => {
        const { args, repository } = fixture();
        const first = await resolveBuyRetestEvidence(args, repository);
        const trades = [{ instrument: args.instrument, side: 'BUY', mode: 'live', oandaTradeId: '123', isOpen: false,
            brokerReconciliationPayload: JSON.stringify({ liveRuntime: { entryTelemetry: {
                strategyContext: { buyRetest: { episodeId: first.episodeId } },
            } } }) }];
        expect(consumedBuyRetestEpisodes(trades, args.instrument)).toEqual([first.episodeId]);
        expect(await resolveBuyRetestEvidence({ ...args, trades }, repository)).toMatchObject({
            ready: false, classification: 'EPISODE_ALREADY_TRADED', episodeId: first.episodeId,
        });
    });
    test('absent durable state recovers the frozen consumed episode from broker history; rolling-cache breaks cannot rearm it', async () => {
        const { args, repository, map } = fixture();
        const first = evaluateIntradayBuyRetest(args);
        const trades = [{ instrument: args.instrument, side: 'BUY', mode: 'live', oandaTradeId: '123', isOpen: false,
            brokerReconciliationPayload: JSON.stringify({ liveRuntime: { entryTelemetry: { strategyContext: { buyRetest: first } } } }) }];
        Date.now.mockReturnValue(end + 12 * period);
        const newer = args.candles.slice(-11).map((candle, index) => ({ ...candle,
            time: new Date(end + (index + 1) * period).toISOString(),
            open: candle.open + .02, high: candle.high + .02, low: candle.low + .02, close: candle.close + .02,
            bid: Object.fromEntries(Object.entries(candle.bid).map(([key, value]) => [key, value + .02])) }));
        expect(await resolveBuyRetestEvidence({ ...args, trades, candles: newer, nowMs: Date.now() }, repository))
            .toMatchObject({ ready: false, classification: 'EPISODE_ALREADY_TRADED', episodeId: first.episodeId, breakout: first.breakout });
        expect(map.size).toBe(0);
        const level = first.breakout.level;
        const cancellation = { ...newer[0], open: level + .0002, high: level + .0003, low: level - .0001, close: level };
        const cancelled = await resolveBuyRetestEvidence({ ...args, trades, candles: [cancellation], nowMs: Date.now() }, repository);
        expect(cancelled).toMatchObject({ ready: false, breakout: null, state: { consumed: false } });
        expect(map.get(buyRetestStateKey(args)).breakout).toBeNull();
    });

    test.each(['missing', 'read', 'write', 'history'])('unavailable %s evidence cannot authorize a new BUY', async (failure) => {
        const { args, repository } = fixture();
        expect(evaluateIntradayBuyRetest(args).ready).toBe(true);
        if (failure === 'read') repository.getState.mockRejectedValue(new Error('unavailable'));
        if (failure === 'write') repository.setState.mockRejectedValue(new Error('unavailable'));
        if (failure === 'history') { args.trades = null; args.historyAvailable = false; }
        expect(await resolveBuyRetestEvidence(args, failure === 'missing' ? null : repository)).toMatchObject({
            ready: false, classification: 'BUY_RETEST_EVIDENCE_UNAVAILABLE',
        });
    });

    test('empty startup candles do not persist an unusable cursor and healthy data can enter', async () => {
        const { args, repository } = fixture();
        expect((await resolveBuyRetestEvidence({ ...args, candles: [] }, repository)).ready).toBe(false);
        expect(repository.setState).not.toHaveBeenCalled();
        expect((await resolveBuyRetestEvidence(args, repository)).ready).toBe(true);
    });

    test('a read failure does not poison the later successful durable operation', async () => {
        const { args, repository } = fixture();
        repository.getState.mockRejectedValueOnce(new Error('unavailable'));
        expect((await resolveBuyRetestEvidence(args, repository)).ready).toBe(false);
        expect((await resolveBuyRetestEvidence(args, repository)).ready).toBe(true);
    });
});
