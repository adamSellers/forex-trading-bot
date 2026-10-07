// Retained real incident observations validate entry eligibility only. The
// five-hour capture cannot reconstruct indicator warmup or alternative returns.
const fs = require('node:fs');
const crypto = require('node:crypto');
const evidenceBytes = fs.readFileSync(require.resolve('../../../docs/reviews/evidence/2026-10-07/eurusd-breakeven-repeat.json'));
if (crypto.createHash('sha256').update(evidenceBytes).digest('hex') !==
    'e47296ca29de3b97964d9976d51dde8f7a4a16c7f65bfd303b286135d5705d51') {
    throw new Error('Retained overnight incident input differs from its frozen evidence hash');
}
const evidence = JSON.parse(evidenceBytes);
const { evaluateIntradayBuyRetest } = require('../../src/runtime/intradayBuyRetestPolicy');
const { evaluateReentryPolicy } = require('../../src/runtime/intradayReentryPolicy');

const M15 = 900_000;
const normalize = (row) => {
    const prices = (component) => Object.fromEntries(['open', 'high', 'low', 'close']
        .map((key, index) => [key, Number(row[component]['ohlc'[index]])]));
    return { time: new Date(Number(row.time) * 1000).toISOString(), complete: row.complete,
        ...prices('mid'), bid: prices('bid'), ask: prices('ask') };
};
const bars = evidence.broker.candles.find((item) => item.granularity === 'M15').candles.map(normalize);
const second = evidence.trades.find((trade) => String(trade.oanda_trade_id) === '3519');
const recorded = second.liveRuntime.entryTelemetry.strategyContext;

describe('retained EUR/USD overnight continuation under the replacement BUY contract', () => {
    test('the old post-BE freshness predicate was satisfied but does not establish a new BUY break/retest', () => {
        const old = recorded.reentry;
        const latestClosedTrade = evidence.trades.find((trade) => String(trade.oanda_trade_id) === '3507');
        const replayed = evaluateReentryPolicy({ originalSide: old.originalSide,
            latestClosedTrade: { id: latestClosedTrade.trade_id, oandaTradeId: latestClosedTrade.oanda_trade_id,
                side: latestClosedTrade.side, exitReason: latestClosedTrade.exit_reason,
                brokerReconciliationPayload: { close: latestClosedTrade.close } },
            signalFastEma: old.signalFastEma, signalCandleTime: old.signalCandleTime,
            pullbackWindow: old.pullbackWindow });
        expect(replayed).toMatchObject({ allowed: true, freshTouch: true, classification: 'FRESH_CONTINUATION' });
        const eligibleBars = bars.filter((bar) => Date.parse(bar.time) + M15 <= recorded.signalCandleCloseTime);
        const decision = evaluateIntradayBuyRetest({ instrument: 'EUR_USD', candles: eligibleBars,
            breakoutBars: 8, displayPrecision: 5, nowMs: recorded.evaluatedAt });
        expect(decision).toMatchObject({ ready: false, classification: 'WAIT_FOR_BREAK' });
        expect(decision.confirmation).toBeNull();
        expect(eligibleBars.at(-1).close).toBe(1.12623);
        expect(Math.max(...eligibleBars.slice(-9, -1).map((bar) => bar.high))).toBe(1.12694);
    });

    test('causal successive completed-candle windows reach the same non-actionable second-entry state', () => {
        let state = null;
        let lastClose = 0;
        const eligibleBars = bars.filter((bar) => Date.parse(bar.time) + M15 <= recorded.signalCandleCloseTime);
        let decision;
        for (let count = 1; count <= eligibleBars.length; count++) {
            const prefix = eligibleBars.slice(0, count);
            const nowMs = Date.parse(prefix.at(-1).time) + M15;
            decision = evaluateIntradayBuyRetest({ instrument: 'EUR_USD', candles: prefix,
                breakoutBars: 8, displayPrecision: 5, nowMs, priorState: state });
            expect(decision.state.lastProcessedCandleCloseTime).toBeGreaterThan(lastClose);
            expect(decision.confirmation?.closedAt ?? nowMs).toBeLessThanOrEqual(nowMs);
            state = decision.state;
            lastClose = state.lastProcessedCandleCloseTime;
        }
        expect(decision).toMatchObject({ ready: false, classification: 'WAIT_FOR_BREAK' });
        expect(lastClose).toBe(recorded.signalCandleCloseTime);
    });

    test('the recorded ATR stop was inside the selected legacy touch-to-confirmation bid span', () => {
        const latestTouch = Date.parse(recorded.m15.pullbackSequence.long.latestTouchTime);
        const span = bars.filter((bar) => Date.parse(bar.time) >= latestTouch &&
            Date.parse(bar.time) + M15 <= recorded.signalCandleCloseTime);
        expect(span).toHaveLength(2);
        expect(span.every((bar) => bar.complete === true)).toBe(true);
        const anchor = Math.min(...span.map((bar) => bar.bid.low));
        expect(anchor).toBe(1.12548);
        expect((second.liveRuntime.initialStopLossPrice - anchor) / 0.0001).toBeCloseTo(1, 8);
        // This measured geometry does not supply a complete alternate holding
        // horizon, an executable counterfactual fill, or profitability evidence.
    });
});
