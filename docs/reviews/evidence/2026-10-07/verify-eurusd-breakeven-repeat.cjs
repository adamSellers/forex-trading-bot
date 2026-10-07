// Read-only verification of retained incident observations. No database,
// credentials, network, broker orders or runtime state are loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    evaluateReentryPolicy, sameReentryDecision, confirmedCloseTime,
} = require('../../../../backend/src/runtime/intradayReentryPolicy');

const e = JSON.parse(fs.readFileSync(path.join(__dirname, 'eurusd-breakeven-repeat.json')));
const [first, second] = e.trades;
const closeEnough = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const brokerMs = (time) => Number(time) * 1000;
const brokerTrade = (id) => e.broker.trades.find((t) => t.trade.id === id).trade;
const brokerTransaction = (id) => e.broker.transactions.find((t) => t.transaction.id === id).transaction;
const m15 = e.broker.candles.find((c) => c.granularity === 'M15').candles;
const candleAt = (time) => m15.find((c) => Math.abs(brokerMs(c.time) - Date.parse(time)) < 1);

assert.deepEqual(e.trades.map((t) => t.oanda_trade_id), ['3507', '3519']);
for (const t of e.trades) {
    const b = brokerTrade(t.oanda_trade_id);
    assert.equal(b.state, 'CLOSED');
    closeEnough(t.entry_time, brokerMs(b.openTime), 1);
    closeEnough(t.exit_time, brokerMs(b.closeTime), 1);
    closeEnough(t.entry_price, Number(b.price));
    closeEnough(t.exit_price, Number(b.averageClosePrice));
    closeEnough(t.units, Number(b.initialUnits));
    closeEnough(t.pnl_aud, Number(b.realizedPL));
    closeEnough(t.liveRuntime.initialRiskAud,
        t.units * (t.entry_price - t.liveRuntime.initialStopLossPrice) * t.liveRuntime.quoteToAudRate);
    assert.equal(t.sampledExcursion.lifetimeStatus, 'VERIFIED');
    assert.equal(t.sampledExcursion.observations, t.sampledExcursion.samples.length);
    for (const [observedAt] of t.sampledExcursion.samples) {
        assert.ok(observedAt >= t.entry_time && observedAt <= t.exit_time);
    }
    closeEnough(t.sampledExcursion.maxFavorablePips,
        Math.max(0, ...t.sampledExcursion.samples.map((s) => s[1])));
    closeEnough(t.sampledExcursion.maxAdversePips,
        Math.max(0, ...t.sampledExcursion.samples.map((s) => -s[1])));
    const decision = e.decisions.find((d) => d.trade_id === t.trade_id && d.outcome === 'FILLED');
    assert.ok(decision);
    const signal = e.signals.find((s) => s.setup_id === decision.setup_id && s.signal === 'BUY' &&
        Math.abs(s.timestamp - decision.decision_time) < 1000);
    assert.deepEqual(signal.context.strategyContext.reentry,
        t.liveRuntime.entryTelemetry.strategyContext.reentry);
}

const be = brokerTransaction('3515');
assert.equal(be.tradeID, first.oanda_trade_id);
closeEnough(Number(be.price), first.entry_price);
assert.ok(brokerMs(be.time) > first.entry_time && brokerMs(be.time) < first.exit_time);
assert.equal(brokerTransaction('3516').reason, 'STOP_LOSS_ORDER');
closeEnough(first.pnl_aud, 0);
assert.equal(brokerTransaction('3526').reason, 'STOP_LOSS_ORDER');
closeEnough(Number(brokerTransaction('3526').price), second.liveRuntime.initialStopLossPrice);
closeEnough(second.pnl_aud, -0.1691);

const context = second.liveRuntime.entryTelemetry.strategyContext;
const latestClosedTrade = {
    id: first.trade_id, oandaTradeId: first.oanda_trade_id, side: first.side,
    exitReason: first.exit_reason, brokerReconciliationPayload: { close: first.close },
};
assert.equal(confirmedCloseTime(latestClosedTrade), first.exit_time);
const reentry = evaluateReentryPolicy({
    originalSide: second.side, latestClosedTrade,
    pullbackWindow: context.m15.pullbackWindow,
    signalFastEma: context.m15.fastEma,
    signalCandleTime: context.reentry.signalCandleTime,
});
assert.equal(reentry.classification, 'FRESH_CONTINUATION');
assert.ok(sameReentryDecision(context.reentry, reentry));
assert.equal(reentry.freshTouchTimes.length, 4);
for (const bar of context.m15.pullbackSequence.bars) {
    const c = candleAt(bar.time);
    assert.ok(c.complete);
    for (const [saved, broker] of [['high', 'h'], ['low', 'l'], ['close', 'c']]) {
        closeEnough(bar[saved], Number(c.mid[broker]));
    }
    assert.ok(Date.parse(bar.time) > first.exit_time);
    assert.ok(bar.low <= bar.fastEma);
}
assert.equal(context.lossReset.classification, 'NO_LOSS_RESET_REQUIRED');
assert.equal(context.lossReset.anchor.armed, false);
assert.equal(context.m15.triggerCombination, 'pullback_only');
closeEnough(context.m15.pullbackSequence.long.resumptionBoundary, 1.12600);
closeEnough(context.m15.trigger.breakoutHigh, 1.12694);
assert.ok(context.m15.close > 1.12600 && context.m15.close < 1.12694);
const latestTouch = context.m15.pullbackSequence.long.latestTouchTime;
const signalTime = context.reentry.signalCandleTime;
const bidSpanLow = Math.min(Number(candleAt(latestTouch).bid.l), Number(candleAt(signalTime).bid.l));
closeEnough(bidSpanLow, 1.12548);
closeEnough((second.liveRuntime.initialStopLossPrice - bidSpanLow) / 0.0001, 1.0);

const costHolds = e.signals.filter((s) => s.reason_code === 'INTRADAY_MOMENTUM_COST_TOO_HIGH' &&
    s.timestamp >= context.signalCandleCloseTime && s.timestamp < second.entry_time);
assert.equal(costHolds.length, 7);
assert.ok(costHolds.every((s) => s.context.strategyContext.costs.costToStopRatio > 0.15));
assert.ok(context.costs.costToStopRatio < 0.15);
const fills = e.decisions.filter((d) => d.outcome === 'FILLED');
assert.equal(fills.length, 2);
assert.equal(new Set(fills.map((d) => d.setup_id)).size, 2);
assert.equal(first.run_id, second.run_id);
assert.equal(first.config_hash, second.config_hash);
assert.ok(second.liveRuntime.initialRiskAud < first.liveRuntime.initialRiskAud);

console.log(JSON.stringify({
    result: 'PASS', brokerMatchedTrades: 2, distinctFilledSetupIds: 2,
    reentryClassification: reentry.classification, brokerMatchedPostExitTouchBars: 4,
    costHoldsBeforeSecondEntry: costHolds.length, bidSpanLow,
    initialStopAboveBidSpanLowPips: 1.0,
    protectedExitToReentryMinutes: (second.entry_time - first.exit_time) / 60000,
    initialRiskAud: e.trades.map((t) => t.liveRuntime.initialRiskAud),
    netAud: e.trades.reduce((sum, t) => sum + t.pnl_aud, 0),
    limitations: e.limits,
}, null, 2));
