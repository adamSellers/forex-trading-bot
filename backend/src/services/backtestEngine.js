// backend/src/services/backtestEngine.js
const { fork } = require("child_process");
const path = require("path");
const logger = require("../utils/logger");

class BacktestEngine {
    async runSimulation(config, notifyProgress = () => {}) {
        return new Promise((resolve, reject) => {
            const workerPath = path.join(
                __dirname,
                "../workers/backtestWorker.js"
            );

            // SPAWN CHILD PROCESS
            // This is the magic line. It creates a completely separate OS process.
            const worker = fork(workerPath);

            let isResolved = false;

            // Safety Timeout: Kill worker if it hangs for > 5 minutes
            const timeout = setTimeout(() => {
                if (!worker.killed) {
                    logger.warn(
                        "⚠️ Backtest Worker timed out! Killing process."
                    );
                    worker.kill();
                    reject(
                        new Error("Simulation timed out (limit: 5 minutes)")
                    );
                }
            }, 5 * 60 * 1000);

            // Listen for messages from the child
            worker.on("message", (msg) => {
                if (msg.type === "progress") {
                    notifyProgress(msg);
                } else if (msg.type === "result") {
                    clearTimeout(timeout);
                    isResolved = true;
                    resolve(msg.data);
                } else if (msg.type === "error") {
                    clearTimeout(timeout);
                    isResolved = true;
                    reject(new Error(msg.error));
                }
            });

            // Handle unexpected crashes (e.g., OOM)
            worker.on("exit", (code) => {
                clearTimeout(timeout);
                if (!isResolved && code !== 0) {
                    reject(
                        new Error(
                            `Worker crashed with exit code ${code} (Likely Out of Memory)`
                        )
                    );
                }
            });

            // Start the job
            worker.send({ command: "start", config });
        });
    }
}

module.exports = new BacktestEngine();
