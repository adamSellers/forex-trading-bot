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

            // Fork the worker process
            const worker = fork(workerPath);
            let isResolved = false;

            // UPDATED: Increased timeout to 45 minutes for Raspberry Pi SD Card I/O
            const TIMEOUT_DURATION = 45 * 60 * 1000;

            const timeout = setTimeout(() => {
                if (!worker.killed) {
                    logger.warn(
                        `⚠️ Backtest Worker timed out (${
                            TIMEOUT_DURATION / 60000
                        }m limit)! Killing process.`
                    );
                    worker.kill();
                    reject(
                        new Error(
                            `Simulation timed out (limit: ${
                                TIMEOUT_DURATION / 60000
                            } minutes)`
                        )
                    );
                }
            }, TIMEOUT_DURATION);

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

            worker.on("exit", (code) => {
                clearTimeout(timeout);
                if (!isResolved && code !== 0) {
                    reject(new Error(`Worker crashed with exit code ${code}`));
                }
            });

            worker.send({ command: "start", config });
        });
    }
}

module.exports = new BacktestEngine();
