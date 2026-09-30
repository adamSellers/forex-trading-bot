const { resolveLossResetEvidence } = require('../intradayLossResetEvidence');

const end = Date.parse('2026-09-11T13:00:00Z');
const hour = 3_600_000;

function evidenceArguments() {
    const price = (value) => 1.3 + (value - 1.1) * 10;
    const h1Candles = Array.from({ length: 160 }, (_, index) => {
        const close = 1.1 + index * 0.0003 + Math.sin(index / 3) * 0.00024;
        return { time: new Date(end - (160 - index) * hour).toISOString(), complete: true,
            open: price(close - 0.00012), close: price(close),
            high: price(close + 0.00054), low: price(close - 0.00054) };
    });
    h1Candles.at(-2).close -= 0.035;
    h1Candles.at(-2).low = Math.min(h1Candles.at(-2).low, h1Candles.at(-2).close - 0.001);
    const closedAt = end - 90 * 60_000;
    return { instrument: 'GBP_USD', side: 'BUY', nowMs: end, signalCandleCloseTime: end,
        h1Candles, trades: [{ id: 'local-stop', oandaTradeId: 'broker-stop',
            instrument: 'GBP_USD', side: 'BUY', isOpen: false, mode: 'live',
            exitReason: 'STOP_LOSS', activeStopType: 'INITIAL_STOP',
            brokerReconciliationPayload: { close: { trade: { id: 'broker-stop', state: 'CLOSED',
                closeTime: new Date(closedAt).toISOString() } } },
        }] };
}

describe('durable H1 loss-reset evidence', () => {
    afterEach(() => jest.restoreAllMocks());

    test('an older scan queued behind a newer requalification cannot roll durable proof backwards or borrow future permission', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(end);
        const state = new Map();
        const repository = {
            getState: jest.fn(async (key) => structuredClone(state.get(key) || null)),
            setState: jest.fn(async (key, value) => { state.set(key, structuredClone(value)); }),
        };
        const args = evidenceArguments();
        const [current, older] = await Promise.all([
            resolveLossResetEvidence(args, repository),
            resolveLossResetEvidence({ ...args, nowMs: end - hour,
                signalCandleCloseTime: end - hour }, repository),
        ]);
        expect(current).toMatchObject({ allowed: true, state: { resetAt: end - hour, rearmedAt: end } });
        expect(older.allowed).toBe(false);
        expect([...state.values()]).toEqual([expect.objectContaining({
            resetAt: end - hour, rearmedAt: end, lastObservedCloseAt: end,
        })]);
        expect(repository.setState).toHaveBeenCalledTimes(1);
    });

    test('ordinary entries without a same-side stop do not depend on the loss-reset store', async () => {
        const repository = { getState: jest.fn(() => { throw new Error('unavailable'); }), setState: jest.fn() };
        const decision = await resolveLossResetEvidence({ ...evidenceArguments(), side: 'SELL' }, repository);
        expect(decision).toMatchObject({ allowed: true, classification: 'NO_LOSS_RESET_REQUIRED' });
        expect(repository.getState).not.toHaveBeenCalled();
        expect(repository.setState).not.toHaveBeenCalled();
    });

    test('a scan retains completed H1 requalification while its M15 cache lags, without authorizing that old signal', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(end);
        const repository = { getState: jest.fn(async () => null), setState: jest.fn(async () => {}) };
        const decision = await resolveLossResetEvidence({ ...evidenceArguments(),
            signalCandleCloseTime: end - hour, observeThroughNow: true }, repository);
        expect(decision.allowed).toBe(false);
        expect(repository.setState).toHaveBeenCalledWith(expect.stringContaining('broker-stop'),
            expect.objectContaining({ resetAt: end - hour, rearmedAt: end }), end);
    });
});
