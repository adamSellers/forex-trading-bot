const childProcess = require("node:child_process");
const path = require("node:path");

const activeCheckpoints = new Map();
const activeChildren = new Set();
const cancelledChildren = new WeakSet();
const WORKER = path.join(__dirname, "checkpointWalProcess.js");

function cancelWalCheckpoints() {
    for (const child of activeChildren) {
        cancelledChildren.add(child);
        child.kill("SIGKILL");
    }
}

// A parent exit also removes its timeout timers; never leave a native child
// running after that deadline owner has gone away.
process.once("exit", cancelWalCheckpoints);

// SQLite's synchronous checkpoint must not run on the trading event loop.
// Contended checkpoints defer immediately; slow disk work has a hard deadline.
function checkpointWal(databasePath, { timeoutMs = 5000, busyTimeoutMs = 0 } = {}) {
    if (typeof databasePath !== "string" || !databasePath || databasePath === ":memory:") {
        return Promise.reject(new Error("WAL checkpoint requires the configured database file"));
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5000 ||
        !Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 1000) {
        return Promise.reject(new Error("Invalid bounded WAL checkpoint deadlines"));
    }
    const filename = path.resolve(databasePath);
    if (activeCheckpoints.has(filename)) return activeCheckpoints.get(filename);
    const pending = new Promise((resolve, reject) => {
        let child;
        child = childProcess.execFile(process.execPath, [WORKER, filename, String(busyTimeoutMs)], {
            timeout: timeoutMs,
            killSignal: "SIGKILL",
            maxBuffer: 4096,
            encoding: "utf8",
            // No broker credentials, shell startup files or NODE_OPTIONS preload.
            env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
        }, (error, stdout, stderr) => {
            activeChildren.delete(child);
            if (error) {
                const cancelled = child && cancelledChildren.has(child);
                const timedOut = error.killed && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
                const failure = new Error(cancelled ? "WAL checkpoint cancelled for shutdown" : timedOut
                    ? `WAL checkpoint exceeded ${timeoutMs}ms deadline`
                    : `WAL checkpoint failed: ${stderr?.trim() || error.message}`);
                failure.code = cancelled ? "WAL_CHECKPOINT_CANCELLED" : timedOut ? "WAL_CHECKPOINT_TIMEOUT" : "WAL_CHECKPOINT_FAILED";
                reject(failure);
                return;
            }
            try {
                const result = JSON.parse(stdout);
                const minimumCount = result?.busy === 1 ? -1 : 0;
                if (![0, 1].includes(result?.busy) ||
                    !Number.isInteger(result.log) || result.log < minimumCount ||
                    !Number.isInteger(result.checkpointed) || result.checkpointed < minimumCount) {
                    throw new Error("Invalid WAL checkpoint result");
                }
                resolve(result);
            } catch (failure) {
                reject(new Error(`WAL checkpoint returned no valid result: ${failure.message}`));
            }
        });
        if (child) activeChildren.add(child);
    }).finally(() => activeCheckpoints.delete(filename));
    activeCheckpoints.set(filename, pending);
    return pending;
}

module.exports = { checkpointWal, cancelWalCheckpoints };
