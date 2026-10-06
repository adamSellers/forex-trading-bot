const { ReplayBroker } = require('../replayBroker.cjs');

const START = Date.parse('2026-09-11T13:00:00Z');
function dependencies(atMs = START) {
    let now = atMs;
    let bid = 0.7;
    return { clock: { nowMs: () => now, advance: (ms) => { now += ms; } },
        setBid: (value) => { bid = value; },
        market: { getQuote: (instrument) => ({ instrument, time: new Date(now).toISOString(), tradeable: true,
            bids: [{ price: String(bid), liquidity: 1000000 }], asks: [{ price: String(bid + 0.0002), liquidity: 1000000 }] }),
        getHomeConversions: () => [{ currency: 'USD', positionValue: '1.5', accountGain: '1.4', accountLoss: '1.6' }] } };
}
async function fundedCheckpoint() {
    const source = dependencies();
    const broker = new ReplayBroker({ ...source, metadata: { AUD_USD: { name: 'AUD_USD', displayPrecision: 5, pipLocation: -4, marginRate: '0.05' } },
        commissionAud: 0.01, slippagePips: 0.2 });
    await broker.initialize();
    const result = await broker.placeMarketOrder('AUD_USD', 100, { orderIntentId: 'before-restart', stopLossPrice: 0.6992, takeProfitPrice: 0.7017 });
    const id = result.orderFillTransaction.tradeOpened.tradeID;
    source.clock.advance(10000);
    source.setBid(0.7013);
    await broker.modifyTrade(id, { stopLossPrice: 0.70022 });
    broker.applyFinancing({ id: 'carry-before-restart', tradeId: id, amountAud: -0.02 });
    return { ...source, broker, id, checkpoint: broker.exportCheckpoint() };
}

describe('modeled external broker checkpoints', () => {
    test('JSON round-trip retains open trade protection, cash, intents and financing deduplication', async () => {
        const original = await fundedCheckpoint();
        const next = dependencies(original.clock.nowMs());
        next.setBid(0.7013);
        const restored = ReplayBroker.fromCheckpoint({ ...next, checkpoint: JSON.parse(JSON.stringify(original.checkpoint)) });
        expect(restored.exportCheckpoint()).toEqual(original.checkpoint);
        expect(restored.snapshot()).toEqual(original.broker.snapshot());
        expect(await restored.getAccountSummary()).toEqual(await original.broker.getAccountSummary());
        expect((await restored.findOrderIntent('before-restart')).trade.stopLossOrder.price).toBe('0.70022');
        expect(restored.applyFinancing({ id: 'carry-before-restart', tradeId: original.id, amountAud: -0.02 })).toBe(false);
        next.clock.advance(10000);
        original.clock.advance(10000);
        next.setBid(0.7001);
        original.setBid(0.7001);
        expect(restored.observePrice('AUD_USD')).toEqual(original.broker.observePrice('AUD_USD'));
        expect(restored.snapshot()).toEqual(original.broker.snapshot());
        expect((await restored.getTrade(original.id)).trade).toMatchObject({ state: 'CLOSED', financing: '-0.02', commission: '0.02' });
        const second = await restored.placeMarketOrder('AUD_USD', 100, { orderIntentId: 'after-restart' });
        expect(second.orderFillTransaction.tradeOpened.tradeID).toBe('2');
        expect(Number(second.orderCreateTransaction.id)).toBe(original.checkpoint.state.nextTransactionId + 1);
    });

    test('a closed account checkpoint preserves realized settlement and original intent recovery', async () => {
        const state = await fundedCheckpoint();
        state.setBid(0.7001);
        state.broker.observePrice('AUD_USD');
        const checkpoint = state.broker.exportCheckpoint();
        const restored = ReplayBroker.fromCheckpoint({ ...dependencies(state.clock.nowMs()), checkpoint });
        expect(restored.exportCheckpoint()).toEqual(checkpoint);
        expect((await restored.findOrderIntent('before-restart')).trade.state).toBe('CLOSED');
        expect(restored.balanceAud).toBe(state.broker.balanceAud);
    });

    test('a terminal no-fill intent survives restart without creating exposure or resetting identifiers', async () => {
        const source = dependencies();
        const broker = new ReplayBroker({ ...source, metadata: { AUD_USD: { displayPrecision: 5, pipLocation: -4, marginRate: '0.05' } } });
        expect((await broker.placeMarketOrder('AUD_USD', 1.5, { orderIntentId: 'rejected-before-restart' })).errorCode).toBe('UNITS_INVALID');
        const restored = ReplayBroker.fromCheckpoint({ ...dependencies(), checkpoint: broker.exportCheckpoint() });
        expect(restored.snapshot()).toEqual(broker.snapshot());
        expect((await restored.findOrderIntent('rejected-before-restart')).status).toBe('REJECTED');
        const next = await restored.placeMarketOrder('AUD_USD', 100, { orderIntentId: 'valid-after-restart' });
        expect(next.orderCreateTransaction.id).toBe('2');
        expect(next.orderFillTransaction.tradeOpened.tradeID).toBe('1');
    });

    test('checkpoint and restored state cannot mutate one another through shared references', async () => {
        const state = await fundedCheckpoint();
        const restored = ReplayBroker.fromCheckpoint({ ...dependencies(state.clock.nowMs()), checkpoint: state.checkpoint });
        state.checkpoint.settings.metadata.AUD_USD.displayPrecision = 1;
        state.checkpoint.state.trades[0].price = '10';
        expect((await restored.getInstrumentMetadata('AUD_USD')).displayPrecision).toBe(5);
        expect((await restored.getTrade(state.id)).trade.price).toBe('0.70022');
        const checkpoint = restored.exportCheckpoint();
        checkpoint.state.intents[0][1].status = 'REJECTED';
        expect((await restored.findOrderIntent('before-restart')).status).toBe('FILLED');
    });

    test.each([
        ['version', (state) => { state.schemaVersion = 2; }],
        ['future broker time', (state) => { state.atMs += 1; }],
        ['missing metadata', (state) => { delete state.settings.metadata.AUD_USD; }],
        ['unknown precision', (state) => { state.settings.metadata.AUD_USD.displayPrecision = null; }],
        ['reset trade IDs', (state) => { state.state.nextTradeId = 1; }],
        ['reset transaction IDs', (state) => { state.state.nextTransactionId = 1; }],
        ['duplicate transaction IDs', (state) => { state.state.transactions[1].id = '1'; }],
        ['cash mismatch', (state) => { state.state.balanceAud += 1; }],
        ['missing financing amount', (state) => { state.state.trades[0].financing = null; }],
        ['missing commission amount', (state) => { state.state.trades[0].commission = null; }],
        ['changed entry price', (state) => { state.state.trades[0].price = '0.70030'; }],
        ['changed units', (state) => { state.state.trades[0].currentUnits = '-100'; }],
        ['foreign protection owner', (state) => { state.state.trades[0].stopLossOrder.tradeID = '999'; }],
        ['changed protection price', (state) => { state.state.trades[0].stopLossOrder.price = '0.69900'; }],
        ['lost intent owner', (state) => { state.state.intents[0][1].tradeId = '999'; }],
        ['changed intent identity', (state) => { state.state.intents[0][0] = 'unrelated-intent'; }],
        ['lost financing dedupe', (state) => { state.state.financingEvents = []; }],
        ['changed financing dedupe', (state) => { state.state.financingEvents[0][1].amountAud = -0.03; }],
        ['future ledger time', (state) => { state.state.ledger[0].atMs = state.atMs + 1; }],
    ])('rejects corrupted %s before restoring any account state', async (_label, mutate) => {
        const original = await fundedCheckpoint();
        const checkpoint = JSON.parse(JSON.stringify(original.checkpoint));
        mutate(checkpoint);
        expect(() => ReplayBroker.fromCheckpoint({ ...dependencies(original.clock.nowMs()), checkpoint }))
            .toThrow(expect.objectContaining({ code: 'REPLAY_CHECKPOINT_INVALID' }));
        expect(original.broker.exportCheckpoint()).toEqual(original.checkpoint);
    });
});
