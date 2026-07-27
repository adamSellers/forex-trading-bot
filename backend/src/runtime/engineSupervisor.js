const defaultLogger = require("../utils/logger");

// LiveTradingEngine.start() subscribes to the signal stream and enables
// position monitoring. If Oanda is unreachable it throws BEFORE subscribing,
// so a single failed attempt leaves the engine permanently detached: signals
// keep generating, enableTrading can even be true, and every status field
// looks healthy while nothing is listening for entries or managing exits.
// That is exactly the 2026-07-23 production outage — the Pi rebooted before
// its network was up and the engine sat detached for five days.
//
// Attaching the engine does NOT enable entries: enableTrading gates those
// independently in LiveTradingEngine.validateEntry, so retrying is always safe
// even while live trading is deliberately paused.
const DEFAULT_MIN_RETRY_MS = 15000;
const DEFAULT_MAX_RETRY_MS = 300000;

function createEngineSupervisor({
    tradingEngine,
    onStatusChange = () => {},
    minRetryMs = DEFAULT_MIN_RETRY_MS,
    maxRetryMs = DEFAULT_MAX_RETRY_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = defaultLogger,
} = {}) {
    if (!tradingEngine) {
        throw new Error("Engine supervisor requires a trading engine");
    }

    let retryTimer = null;
    let retryDelayMs = minRetryMs;
    let inFlight = null;

    function cancelPendingRetry() {
        if (retryTimer) {
            clearTimeoutFn(retryTimer);
            retryTimer = null;
        }
    }

    function scheduleRetry(delayMs) {
        // One pending retry at a time; a second timer would compound the
        // backoff into a tight restart loop against the broker API.
        if (retryTimer) return;

        retryTimer = setTimeoutFn(() => {
            retryTimer = null;
            ensureStarted({ reason: "retry" });
        }, delayMs);
        // A pending retry must never hold the process open during shutdown.
        retryTimer.unref?.();
    }

    async function ensureStarted({ reason = "boot" } = {}) {
        if (tradingEngine.isRunning) {
            return { running: true, alreadyRunning: true };
        }

        // Collapse concurrent callers (boot, retry timer, activation endpoint)
        // onto a single attempt so they cannot race each other into duplicate
        // signal subscriptions.
        if (inFlight) {
            return inFlight;
        }

        inFlight = (async () => {
            try {
                await tradingEngine.start();

                // A monitoring failure must not roll back a successful attach:
                // the engine is subscribed to signals by this point, and a
                // retry would short-circuit on isRunning and silently skip
                // monitoring forever.
                try {
                    tradingEngine.startMonitoring();
                } catch (monitorError) {
                    logger.error(
                        "Trading engine attached but position monitoring failed to start:",
                        monitorError.message
                    );
                }

                retryDelayMs = minRetryMs;
                logger.success(
                    `Trading engine started and listening for signals (${reason})`
                );
                onStatusChange();
                return { running: true };
            } catch (error) {
                const retryInMs = retryDelayMs;
                retryDelayMs = Math.min(retryDelayMs * 2, maxRetryMs);
                logger.error(
                    `Failed to start trading engine (${reason}); retrying in ${Math.round(
                        retryInMs / 1000
                    )}s:`,
                    error.message
                );
                scheduleRetry(retryInMs);
                onStatusChange();
                return { running: false, error: error.message, retryInMs };
            } finally {
                inFlight = null;
            }
        })();

        return inFlight;
    }

    return {
        ensureStarted,
        cancelPendingRetry,
        isRetryScheduled: () => retryTimer !== null,
    };
}

module.exports = {
    createEngineSupervisor,
    DEFAULT_MIN_RETRY_MS,
    DEFAULT_MAX_RETRY_MS,
};
