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
    beforeStart = null,
    onStarted = null,
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
            return ensureStarted({ reason: "retry" });
        }, delayMs);
        // A pending retry must never hold the process open during shutdown.
        retryTimer.unref?.();
    }

    async function ensureStarted({ reason = "boot" } = {}) {
        // Collapse concurrent callers (boot, retry timer, activation endpoint)
        // onto a single attempt so they cannot race each other into duplicate
        // signal subscriptions.
        if (inFlight) {
            return inFlight;
        }
        if (tradingEngine.isRunning && !onStarted) {
            return { running: true, alreadyRunning: true };
        }

        inFlight = (async () => {
            const alreadyRunning = tradingEngine.isRunning;
            try {
                if (!alreadyRunning) {
                    if (beforeStart) await beforeStart();
                    await tradingEngine.start();

                    // Monitoring starts before scans and remains active even
                    // if signal startup needs another supervised attempt.
                    try {
                        tradingEngine.startMonitoring();
                    } catch (monitorError) {
                        logger.error(
                            "Trading engine attached but position monitoring failed to start:",
                            monitorError.message
                        );
                    }
                }
                if (onStarted) await onStarted();

                cancelPendingRetry();
                retryDelayMs = minRetryMs;
                if (!alreadyRunning) {
                    logger.success(
                        `Trading engine started and listening for signals (${reason})`
                    );
                }
                onStatusChange();
                return alreadyRunning ? { running: true, alreadyRunning: true } : { running: true };
            } catch (error) {
                const retryInMs = retryDelayMs;
                retryDelayMs = Math.min(retryDelayMs * 2, maxRetryMs);
                logger.error(
                    `${tradingEngine.isRunning ? "Trading engine attached but signal startup failed" : "Failed to start trading engine"} (${reason}); retrying in ${Math.round(
                        retryInMs / 1000
                    )}s:`,
                    error.message
                );
                scheduleRetry(retryInMs);
                onStatusChange();
                return { running: tradingEngine.isRunning === true, error: error.message, retryInMs };
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
