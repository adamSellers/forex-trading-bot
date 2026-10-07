const { createReplayTestHarness, fixtureArchive, START, M15 } = require('../testHarness.cjs');
const env = createReplayTestHarness();
const { buyLifecycleFlow, sellFadeFlow } = require('../fixtures/lifecycleFlows.cjs');

function declaredQuotes(h) {
    const original = h.market.getQuote.bind(h.market);
    const overrides = new Map();
    const tradeability = new Map();
    h.market.getQuote = (instrument) => {
        const quote = original(instrument);
        const bid = overrides.get(instrument);
        if (bid === undefined) return tradeability.has(instrument)
            ? { ...quote, tradeable: tradeability.get(instrument) } : quote;
        const pip = instrument.endsWith('_JPY') ? 0.01 : 0.0001;
        // These explicit API-shaped points exercise lifecycle plumbing. They
        // are independently declared, not reconstructed from archive OHLC.
        return { ...quote, time: new Date(h.clock.nowMs()).toISOString(),
            researchObservation: 'DECLARED_SYNTHETIC_LIFECYCLE_POINT',
            bids: [{ price: String(bid), liquidity: 1_000_000 }],
            asks: [{ price: String(bid + 0.4 * pip), liquidity: 1_000_000 }] };
    };
    return { setBid: (instrument, bid) => overrides.set(instrument, bid),
        setTradeable: (instrument, value) => tradeability.set(instrument, value),
        clear: () => { overrides.clear(); tradeability.clear(); } };
}

describe('persisted generated current-strategy lifecycle decisions', () => {
    test('a normal stop preserves its H1 reset across restart without reusing the filled BUY episode', async () => {
        const flow = buyLifecycleFlow({ nowMs: START, resetHour: 4 });
        const h = await env.replay({ input: fixtureArchive([flow], { futureIntervals: 0 }), assets: ['EUR_USD'] });
        const points = declaredQuotes(h);
        await h.observeAt(START);
        const opened = (await h.repositories.trades.getAllTrades())[0];
        expect(opened).toMatchObject({ side: 'BUY', isOpen: true, entryType: 'M15_BREAK_RETEST_CONFIRMATION' });
        points.setBid('EUR_USD', opened.stopLossPrice - 0.00001);
        await h.observeAt(START + 10_000, { scan: false });
        const stopped = (await h.repositories.trades.getAllTrades())[0];
        expect(stopped).toMatchObject({ exitReason: 'STOP_LOSS', isOpen: false, breakevenHit: false });
        expect(stopped.pnlAud).toBeLessThan(0);
        points.clear();
        const scans = [];
        for (let index = 1; index <= 27; index++) {
            if (index === 18) {
                const proof = await env.database('broker_runtime_state')
                    .where('state_key', 'like', 'intraday-loss-reset:v1:EUR_USD:BUY:%').first();
                expect(JSON.parse(proof.state_value)).toMatchObject({
                    anchor: { tradeId: stopped.id }, resetAt: START + 4 * 3_600_000, rearmedAt: null });
                expect(h.engine.stats.errors).toBe(0);
                await h.restart();
                expect((await env.database('broker_runtime_state').where('state_key', proof.state_key).first()).state_value)
                    .toBe(proof.state_value);
            }
            scans.push(...await h.observeAt(START + index * M15));
        }
        const rearmed = JSON.parse((await env.database('broker_runtime_state')
            .where('state_key', 'like', 'intraday-loss-reset:v1:EUR_USD:BUY:%').first()).state_value);
        expect(rearmed.anchor.brokerTradeId).toBe(stopped.oandaTradeId);
        expect(rearmed.resetAt).toBe(START + 4 * 3_600_000);
        expect(rearmed.rearmedAt).toBeGreaterThan(rearmed.resetAt);
        expect(scans.every((signal) => signal.signal !== 'BUY')).toBe(true);
        const episode = JSON.parse((await env.database('broker_runtime_state')
            .where('state_key', 'intraday-buy-retest:v1:EUR_USD:8:5').first()).state_value);
        expect(episode).toMatchObject({ consumed: true, breakout: opened.brokerReconciliationPayload
            .liveRuntime.entryTelemetry.strategyContext.buyRetest.breakout });
        const trades = await h.repositories.trades.getAllTrades();
        expect(trades).toHaveLength(1);
        expect(trades[0]).toMatchObject({ id: stopped.id, isOpen: false });
        const snapshot = await h.snapshot();
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test.each(['BREAKEVEN_STOP', 'TAKE_PROFIT'])('%s cannot reuse the filled BUY episode after more completed touches or restart', async (exitReason) => {
        const flow = buyLifecycleFlow({ nowMs: START });
        const h = await env.replay({ input: fixtureArchive([flow], { futureIntervals: 0 }), assets: ['EUR_USD'] });
        const points = declaredQuotes(h);
        await h.observeAt(START);
        const parent = (await h.repositories.trades.getAllTrades())[0];
        if (exitReason === 'BREAKEVEN_STOP') {
            const risk = parent.entryPrice - parent.stopLossPrice;
            points.setBid('EUR_USD', parent.entryPrice + 1.1 * risk);
            await h.observeAt(START + 10_000, { scan: false });
            expect((await h.repositories.trades.getAllTrades())[0]).toMatchObject({
                isOpen: true, breakevenHit: true, activeStopType: 'BREAKEVEN', stopLossPrice: parent.entryPrice });
            points.setBid('EUR_USD', parent.entryPrice);
        } else points.setBid('EUR_USD', parent.takeProfitPrice + 0.00001);
        const closedAt = START + 20_000;
        await h.observeAt(closedAt, { scan: false });
        expect((await h.repositories.trades.getAllTrades())[0]).toMatchObject({ isOpen: false, exitReason });
        points.clear();
        const old = (await h.observeAt(START + M15))[0];
        expect(old.signal).toBe('HOLD');
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect(h.engine.stats.errors).toBe(0);
        await h.restart();
        const scans = [];
        for (let index = 2; index <= 15; index++) scans.push(...await h.observeAt(START + index * M15));
        expect(scans.every((signal) => signal.signal !== 'BUY')).toBe(true);
        const episode = JSON.parse((await env.database('broker_runtime_state')
            .where('state_key', 'intraday-buy-retest:v1:EUR_USD:8:5').first()).state_value);
        expect(episode).toMatchObject({ consumed: true, breakout: parent.brokerReconciliationPayload
            .liveRuntime.entryTelemetry.strategyContext.buyRetest.breakout });
        expect(flow.m15.filter((bar) => Date.parse(bar.time) > closedAt &&
            bar.low <= episode.breakout.level && bar.close > episode.breakout.level).length).toBeGreaterThan(0);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('a generated SELL target cannot create a BUY fade before or after restart', async () => {
        const flow = sellFadeFlow({ nowMs: START });
        const h = await env.replay({ input: fixtureArchive([flow], { futureIntervals: 0 }), assets: ['GBP_USD'] });
        const points = declaredQuotes(h);
        await h.observeAt(START);
        const parent = (await h.repositories.trades.getAllTrades())[0];
        expect(parent).toMatchObject({ side: 'SELL', entryType: 'M15_BREAK_RETEST_REJECTION', isOpen: true });
        points.setBid('GBP_USD', parent.takeProfitPrice - 0.00005);
        await h.observeAt(START + 14 * 60_000, { scan: false });
        expect((await h.repositories.trades.getAllTrades())[0]).toMatchObject({ exitReason: 'TAKE_PROFIT', isOpen: false });
        points.clear();
        const offered = (await h.observeAt(START + M15))[0];
        expect(offered).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_BUY_RETEST_REQUIRED' });
        expect(offered.strategyContext.reentry).toMatchObject({ freshTouch: false,
            anchor: { tradeId: parent.id }, originalSide: 'SELL', executedSide: 'BUY', classification: 'POST_TP_FADE' });
        expect(await env.database('entry_decisions').where('entry_type', 'M15_POST_TP_FADE')).toHaveLength(0);
        await h.restart();
        const repeated = (await h.observeAt(START + M15 + 60_000))[0];
        expect(repeated.signal).toBe('HOLD');
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect(h.broker.snapshot().transactions.filter((row) => row.type === 'MARKET_ORDER')).toHaveLength(1);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('three generated normal losses arm the actual 24-hour cooldown without changing its deadline on restart', async () => {
        const assets = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_USD'];
        const flows = assets.map((instrument) => buyLifecycleFlow({ instrument,
            nowMs: instrument === 'AUD_USD' ? START + 3_600_000 : START }));
        const h = await env.replay({ input: fixtureArchive(flows), assets, initialBalanceAud: 1000 });
        const points = declaredQuotes(h);
        points.setTradeable('AUD_USD', false);
        await h.observeAt(START);
        const opened = await h.repositories.trades.getAllTrades();
        expect(opened).toHaveLength(3);
        for (const trade of opened) points.setBid(trade.instrument,
            trade.stopLossPrice - (trade.instrument.endsWith('_JPY') ? 0.001 : 0.00001));
        const lossTime = START + 10_000;
        await h.observeAt(lossTime, { scan: false });
        const losses = await h.repositories.trades.getAllTrades();
        expect(losses.every((trade) => !trade.isOpen && trade.exitReason === 'STOP_LOSS' && trade.pnlAud < 0)).toBe(true);
        const getRisk = () => h.engine.getEntryRiskState({
            runId: h.coordinator.getLiveSelection().liveRun.runId, config: h.engine.configService.get() });
        const cooldown = await getRisk();
        expect(cooldown).toMatchObject({ cooldownActive: true, consecutiveLosses: 3,
            cooldownStartedAt: lossTime, cooldownUntil: lossTime + 24 * 3_600_000 });
        points.clear();
        const fourth = (await h.observeAt(START + 3_600_000)).find((signal) => signal.symbol === 'AUD_USD');
        expect(fourth).toMatchObject({ signal: 'BUY', signalClass: 'ACTIONABLE' });
        expect(fourth.strategyContext.lossReset.allowed).toBe(true);
        const rejected = await env.database('entry_decisions').where('instrument', 'AUD_USD').first();
        expect(rejected).toMatchObject({ outcome: 'REJECTED', rejection_code: 'EXPOSURE_LIMIT' });
        expect(JSON.parse(rejected.rejection_context).portfolioRisk.reasons).toEqual([
            expect.objectContaining({ code: 'CONSECUTIVE_LOSS_COOLDOWN', cooldownUntil: cooldown.cooldownUntil }),
        ]);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(3);
        expect(h.engine.stats.errors).toBe(0);
        await h.restart();
        expect(await getRisk()).toMatchObject({ cooldownActive: true, cooldownUntil: cooldown.cooldownUntil });
        h.clock.set(cooldown.cooldownUntil - 1);
        expect(await getRisk()).toMatchObject({ cooldownActive: true, cooldownUntil: cooldown.cooldownUntil });
        h.clock.set(cooldown.cooldownUntil);
        expect(await getRisk()).toMatchObject({ cooldownActive: false, consecutiveLosses: 0 });
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(3);
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });
});
