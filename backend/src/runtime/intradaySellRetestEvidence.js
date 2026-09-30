const { evaluateIntradaySellRetest } = require("./intradaySellRetestPolicy");

const repositoryQueues = new WeakMap();

function sellRetestStateKey({ instrument, breakoutBars = 8, displayPrecision }) {
    const bars = Math.max(2, Math.floor(Number(breakoutBars) || 8));
    const precision = Number.isInteger(displayPrecision) ? displayPrecision
        : String(instrument).endsWith("JPY") ? 3 : 5;
    return `intraday-sell-retest:v1:${instrument}:${bars}:${precision}`;
}

function consumedSellRetestPatterns(trades, instrument) {
    if (!Array.isArray(trades)) return [];
    return Array.from(new Set(trades.filter((trade) => trade.instrument === instrument &&
        trade.side === "SELL" && trade.oandaTradeId && (!trade.mode || trade.mode === "live"))
        .flatMap((trade) => {
            let payload = trade.brokerReconciliationPayload ?? trade.broker_reconciliation_payload;
            if (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch (_error) { return []; }
            }
            const id = payload?.liveRuntime?.entryTelemetry?.strategyContext?.sellRetest?.patternId;
            return typeof id === "string" && id ? [id] : [];
        })));
}

function unavailable(decision, classification = "SELL_RETEST_EVIDENCE_UNAVAILABLE") {
    return { ...decision, ready: false, classification };
}

// Scans and final entry validation serialize the read/advance/write operation.
// State is independent of a run ID: restart, release and candle-cache rollover
// must not silently replace the frozen broken level or reuse a filled pattern.
async function resolveSellRetestEvidence(args, repository) {
    const evaluateArgs = { ...args, consumedPatternIds: consumedSellRetestPatterns(args.trades, args.instrument) };
    const initial = evaluateIntradaySellRetest(evaluateArgs);
    if (args.historyAvailable === false || !Array.isArray(args.trades) ||
        !repository?.getState || !repository?.setState) return unavailable(initial);
    const key = sellRetestStateKey(evaluateArgs);
    let queues = repositoryQueues.get(repository);
    if (!queues) {
        queues = new Map();
        repositoryQueues.set(repository, queues);
    }
    const previous = queues.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
        try {
            const priorState = await repository.getState(key);
            const nowMs = Math.max(args.nowMs, Date.now());
            const decision = evaluateIntradaySellRetest({ ...evaluateArgs, nowMs, priorState });
            const next = decision.state;
            if (Number.isFinite(priorState?.lastProcessedCandleCloseTime) &&
                (!Number.isFinite(next?.lastProcessedCandleCloseTime) ||
                 next.lastProcessedCandleCloseTime < priorState.lastProcessedCandleCloseTime)) {
                return unavailable(decision, "SELL_RETEST_STALE_CANDLES");
            }
            if (Number.isFinite(next?.lastProcessedCandleCloseTime) && JSON.stringify(next) !== JSON.stringify(priorState)) {
                await repository.setState(key, next, nowMs);
            }
            return decision;
        } catch (_error) {
            return unavailable(initial);
        }
    });
    queues.set(key, operation);
    try { return await operation; }
    finally { if (queues.get(key) === operation) queues.delete(key); }
}

module.exports = { sellRetestStateKey, consumedSellRetestPatterns, resolveSellRetestEvidence };
