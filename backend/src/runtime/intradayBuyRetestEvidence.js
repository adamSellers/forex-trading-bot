const { evaluateIntradayBuyRetest } = require("./intradayBuyRetestPolicy");

const repositoryQueues = new WeakMap();

function consumedStateFromTrades(trades, instrument, breakoutBars) {
    const candidates = trades.filter((trade) => trade.instrument === instrument && trade.side === "BUY" &&
        trade.oandaTradeId && (!trade.mode || trade.mode === "live"))
        .map((trade) => {
            let payload = trade.brokerReconciliationPayload ?? trade.broker_reconciliation_payload;
            if (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch (_error) { return null; }
            }
            return payload?.liveRuntime?.entryTelemetry?.strategyContext?.buyRetest || null;
        }).filter((decision) => decision?.episodeId)
        .sort((a, b) => (b.breakout?.closedAt || 0) - (a.breakout?.closedAt || 0));
    const latest = candidates[0];
    if (!latest) return null;
    // A surviving broker-backed fill is also the durable consumed episode.
    // Reconstruct its cursor even if the dedicated state row is unavailable;
    // missing intervening candles then block rather than invent cancellation.
    return { version: 1, instrument,
        breakoutBars: Math.max(2, Math.floor(Number(breakoutBars) || 8)),
        lastProcessedCandleCloseTime: latest.confirmation?.closedAt,
        breakout: latest.breakout, retest: null, confirmation: null,
        bidEvidenceAvailable: true, consumed: true };
}

function buyRetestStateKey({ instrument, breakoutBars = 8, displayPrecision }) {
    const bars = Math.max(2, Math.floor(Number(breakoutBars) || 8));
    const precision = Number.isInteger(displayPrecision) ? displayPrecision
        : String(instrument).endsWith("JPY") ? 3 : 5;
    return `intraday-buy-retest:v1:${instrument}:${bars}:${precision}`;
}

function consumedBuyRetestEpisodes(trades, instrument) {
    if (!Array.isArray(trades)) return [];
    return Array.from(new Set(trades.filter((trade) => trade.instrument === instrument &&
        trade.side === "BUY" && trade.oandaTradeId && (!trade.mode || trade.mode === "live"))
        .flatMap((trade) => {
            let payload = trade.brokerReconciliationPayload ?? trade.broker_reconciliation_payload;
            if (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch (_error) { return []; }
            }
            const id = payload?.liveRuntime?.entryTelemetry?.strategyContext?.buyRetest?.episodeId;
            return typeof id === "string" && id ? [id] : [];
        })));
}

function unavailable(decision, classification = "BUY_RETEST_EVIDENCE_UNAVAILABLE") {
    return { ...decision, ready: false, classification };
}

// Scans and final entry validation serialize the read/advance/write operation.
// State is independent of a run ID: restart, release and candle-cache rollover
// must not silently replace the frozen broken level or reuse a filled breakout episode.
async function resolveBuyRetestEvidence(args, repository) {
    const evaluateArgs = { ...args, consumedEpisodeIds: consumedBuyRetestEpisodes(args.trades, args.instrument) };
    const initial = evaluateIntradayBuyRetest(evaluateArgs);
    if (args.historyAvailable === false || !Array.isArray(args.trades) ||
        !repository?.getState || !repository?.setState) return unavailable(initial);
    const key = buyRetestStateKey(evaluateArgs);
    let queues = repositoryQueues.get(repository);
    if (!queues) {
        queues = new Map();
        repositoryQueues.set(repository, queues);
    }
    const previous = queues.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
        try {
            const storedState = await repository.getState(key);
            const priorState = storedState || consumedStateFromTrades(args.trades, args.instrument, args.breakoutBars);
            const nowMs = Math.max(args.nowMs, Date.now());
            const decision = evaluateIntradayBuyRetest({ ...evaluateArgs, nowMs, priorState });
            const next = decision.state;
            if (Number.isFinite(priorState?.lastProcessedCandleCloseTime) &&
                (!Number.isFinite(next?.lastProcessedCandleCloseTime) ||
                 next.lastProcessedCandleCloseTime < priorState.lastProcessedCandleCloseTime)) {
                return unavailable(decision, "BUY_RETEST_STALE_CANDLES");
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

module.exports = { buyRetestStateKey, consumedBuyRetestEpisodes, resolveBuyRetestEvidence };
