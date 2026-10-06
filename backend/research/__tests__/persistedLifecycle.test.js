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

describe('persisted generated v5 lifecycle decisions', () => {
    test('a normal stop persists its H1 reset anchor, later requalification permits another generated BUY', async () => {
        const flow = buyLifecycleFlow({ nowMs: START, resetHour: 4 });
        const h = await env.replay({ input: fixtureArchive([flow], { futureIntervals: 0 }), assets: ['EUR_USD'] });
        const points = declaredQuotes(h);
        await h.observeAt(START);
        const opened = (await h.repositories.trades.getAllTrades())[0];
        expect(opened).toMatchObject({ side: 'BUY', isOpen: true, entryType: 'M15_PULLBACK_RESUMPTION' });
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
        expect(scans).toContainEqual(expect.objectContaining({ signal: 'HOLD',
            reasonCode: 'INTRADAY_MOMENTUM_WAIT_FOR_H1_RESET' }));
        const rearmed = scans.find((signal) => signal.signal === 'BUY' && signal.strategyContext?.lossReset?.classification === 'H1_RESET_REARMED');
        expect(rearmed).toBeDefined();
        expect(rearmed.strategyContext.lossReset.anchor.brokerTradeId).toBe(stopped.oandaTradeId);
        expect(rearmed.strategyContext.lossReset.state.resetAt).toBe(START + 4 * 3_600_000);
        expect(rearmed.strategyContext.lossReset.state.rearmedAt).toBeGreaterThan(rearmed.strategyContext.lossReset.state.resetAt);
        const trades = await h.repositories.trades.getAllTrades();
        expect(trades).toHaveLength(2);
        expect(trades.find((trade) => trade.id !== stopped.id)).toMatchObject({ side: 'BUY', isOpen: true });
        const snapshot = await h.snapshot();
        expect(snapshot.accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test.each(['BREAKEVEN_STOP', 'TAKE_PROFIT'])('%s blocks an old BUY continuation then admits a wholly post-exit touch', async (exitReason) => {
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
        expect(old.strategyContext.reentry).toMatchObject({ freshTouch: false,
            anchor: { tradeId: parent.id, closedAt }, classification: exitReason === 'BREAKEVEN_STOP'
                ? 'WAIT_FOR_FRESH_PULLBACK' : 'POST_TP_FADE' });
        expect(old.reasonCode).toBe(exitReason === 'BREAKEVEN_STOP'
            ? 'INTRADAY_MOMENTUM_WAIT_FOR_FRESH_PULLBACK' : 'INTRADAY_MOMENTUM_SELL_RETEST_REQUIRED');
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect(h.engine.stats.errors).toBe(0);
        await h.restart();
        const scans = [];
        for (let index = 2; index <= 15; index++) scans.push(...await h.observeAt(START + index * M15));
        const fresh = scans.find((signal) => signal.signal === 'BUY' &&
            signal.strategyContext?.reentry?.classification === 'FRESH_CONTINUATION');
        expect(fresh).toBeDefined();
        expect(fresh.entryType).toBe('M15_PULLBACK_RESUMPTION');
        expect(fresh.strategyContext.reentry.freshTouchTimes.length).toBeGreaterThan(0);
        expect(fresh.strategyContext.reentry.freshTouchTimes.every((time) => Date.parse(time) >= closedAt)).toBe(true);
        expect(fresh.strategyContext.lossReset).toMatchObject({ allowed: true, classification: 'NO_LOSS_RESET_REQUIRED' });
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(2);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('a generated SELL target permits one BUY fade, local retries and restart retain its parent and price anchor', async () => {
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
        const pricing = h.broker.getPricing.bind(h.broker);
        let wide = true;
        env.setFinalPricing(async (instruments, options) => {
            const payload = await pricing(instruments, options);
            if (wide) payload.prices = payload.prices.map((quote) => quote.instrument !== 'GBP_USD' ? quote : {
                ...quote, asks: quote.asks.map((level) => ({ ...level, price: String(Number(level.price) + 0.002) })),
            });
            return payload;
        });
        const offered = (await h.observeAt(START + M15))[0];
        expect(offered).toMatchObject({ signal: 'BUY', entryType: 'M15_POST_TP_FADE' });
        expect(offered.strategyContext.reentry).toMatchObject({ freshTouch: false,
            anchor: { tradeId: parent.id }, originalSide: 'SELL', executedSide: 'BUY' });
        const declined = await env.database('entry_decisions').where('entry_type', 'M15_POST_TP_FADE').first();
        expect(declined.rejection_code).toBe('SPREAD_TOO_WIDE');
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect(h.engine.stats.errors).toBe(0);
        await h.restart();
        wide = false;
        await h.observeAt(START + M15 + 60_000);
        const fade = (await h.repositories.trades.getAllTrades()).find((trade) => trade.entryType === 'M15_POST_TP_FADE');
        expect(fade).toMatchObject({ side: 'BUY', isOpen: true });
        const attempts = await env.database('entry_decisions').where('entry_type', 'M15_POST_TP_FADE').orderBy('id');
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toMatchObject({ outcome: 'FILLED', setup_id: declined.setup_id,
            entry_reference_price: declined.entry_reference_price });
        expect(fade.brokerReconciliationPayload.liveRuntime.entryTelemetry.strategyContext.reentry)
            .toMatchObject({ classification: 'POST_TP_FADE', anchor: { tradeId: parent.id } });
        points.setBid('GBP_USD', fade.stopLossPrice - 0.00001);
        await h.observeAt(START + M15 + 70_000, { scan: false });
        points.clear();
        expect(h.engine.stats.errors).toBe(0);
        await h.restart();
        const afterFade = (await h.observeAt(START + 2 * M15))[0];
        expect(afterFade).toMatchObject({ signal: 'HOLD', reasonCode: 'INTRADAY_MOMENTUM_FADE_ALREADY_TAKEN' });
        expect(afterFade.strategyContext.reentry).toMatchObject({ fadeConsumed: true, anchor: { tradeId: parent.id } });
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(2);
        expect((await h.snapshot()).accounting.status).toBe('RECONCILED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
    });

    test('three generated normal losses arm the actual 24-hour cooldown without changing its deadline on restart', async () => {
        const assets = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'AUD_USD'];
        const flows = assets.map((instrument) => buyLifecycleFlow({ instrument, nowMs: START }));
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
        const fourth = (await h.observeAt(START + M15)).find((signal) => signal.symbol === 'AUD_USD');
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
