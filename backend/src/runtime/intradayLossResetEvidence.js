const {
    evaluateLossResetPolicy,
    selectLossResetAnchor,
    lossResetStateKey,
} = require("./intradayLossResetPolicy");

// Signal scans and broker reconciliation share the repository instance. Keep
// each stop's read/advance/write together so concurrent scans cannot replace
// newer durable proof with a state read before that proof was recorded.
const repositoryQueues = new WeakMap();

function unavailable(decision) {
    return {
        ...decision,
        allowed: false,
        classification: "LOSS_RESET_EVIDENCE_UNAVAILABLE",
    };
}

async function resolveLossResetEvidence(args, repository) {
    const initial = evaluateLossResetPolicy(args);
    if (args.historyAvailable === false || !Array.isArray(args.trades)) return initial;
    const anchor = selectLossResetAnchor(args.trades, args.instrument, args.side);
    const key = lossResetStateKey({ ...args, anchor });
    if (!key) return initial;
    if (!repository?.getState || !repository?.setState) return unavailable(initial);

    let queues = repositoryQueues.get(repository);
    if (!queues) {
        queues = new Map();
        repositoryQueues.set(repository, queues);
    }
    const priorOperation = queues.get(key) || Promise.resolve();
    const operation = priorOperation.catch(() => {}).then(async () => {
        try {
            const priorState = await repository.getState(key);
            // A scan can wait behind execution that has observed a later H1
            // close. Validate that durable proof at read time, retaining its
            // monotonic progress; the original M15 close still bounds both
            // observations and entry authorization for the older signal.
            const nowMs = Math.max(args.nowMs, Date.now());
            // Scans retain completed H1 proof even when M15 has not caught up.
            // Execution omits this option and remains bounded to its signal.
            const observation = args.observeThroughNow
                ? evaluateLossResetPolicy({ ...args, nowMs, signalCandleCloseTime: null, priorState })
                : null;
            const decision = evaluateLossResetPolicy({ ...args, nowMs,
                priorState: observation?.state || priorState });
            const nextState = observation?.state || decision.state;
            if (nextState && JSON.stringify(nextState) !== JSON.stringify(priorState)) {
                await repository.setState(key, nextState, nowMs);
            }
            return decision;
        } catch (_error) {
            return unavailable(initial);
        }
    });
    queues.set(key, operation);
    try {
        return await operation;
    } finally {
        if (queues.get(key) === operation) queues.delete(key);
    }
}

module.exports = { resolveLossResetEvidence };
