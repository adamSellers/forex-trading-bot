// backend/src/socket/labSocket.js - V3.2.4 WORKER LIFECYCLE FIX
const backtestEngine = require("../services/backtestEngine");
const logger = require("../utils/logger");
const { fork } = require("child_process");
const path = require("path");

// FIX #4: Track active workers globally for cleanup
const activeWorkers = new Map();

// FIX #4: Maximum time a worker can run before forced termination (10 minutes)
const WORKER_TIMEOUT_MS = 10 * 60 * 1000;

module.exports = (io, socket) => {
    const socketId = socket.id;

    // FIX #4: Cleanup function for socket disconnect
    const cleanupSocketWorkers = () => {
        const workerData = activeWorkers.get(socketId);
        if (workerData) {
            logger.warn(
                `🧹 Cleaning up worker for disconnected client ${socketId}`
            );
            terminateWorker(workerData, "Client disconnected");
            activeWorkers.delete(socketId);
        }
    };

    // FIX #4: Register disconnect handler once per socket
    socket.on("disconnect", () => {
        logger.info(`🔌 Client ${socketId} disconnected`);
        cleanupSocketWorkers();
    });

    // --- 1. EXISTING: Single Simulation ---
    socket.on("start_simulation", async (config) => {
        logger.info(`🧪 Lab Simulation requested by ${socketId}`);

        try {
            const results = await backtestEngine.runSimulation(
                config,
                (progress) => {
                    io.to(socketId).emit("simulation_progress", progress);
                }
            );

            io.to(socketId).emit("simulation_complete", results);
            logger.info(`✅ Simulation complete for ${socketId}`);
        } catch (error) {
            logger.error(`❌ Simulation failed: ${error.message}`);
            io.to(socketId).emit("simulation_error", {
                message: error.message,
            });
        }
    });

    // --- 2. GENETIC OPTIMIZATION (The Screener) - FIX #4: Full lifecycle management ---
    socket.on("start_optimization", (config) => {
        logger.info(`🧬 Genetic Optimization requested by ${socketId}`);

        // FIX #4: Check if this socket already has a running worker
        if (activeWorkers.has(socketId)) {
            logger.warn(
                `⚠️ Client ${socketId} already has an optimization running. Ignoring new request.`
            );
            io.to(socketId).emit("optimization_error", {
                message:
                    "An optimization is already running. Please wait for it to complete.",
            });
            return;
        }

        // Path to the worker file
        const workerPath = path.join(
            __dirname,
            "../workers/optimizationWorker.js"
        );

        // Spawn worker
        const worker = fork(workerPath, [], {
            // FIX #4: Limit worker memory to prevent Pi OOM
            execArgv: ["--max-old-space-size=512"],
        });

        // FIX #4: Track worker state
        const workerData = {
            worker,
            socketId,
            startTime: Date.now(),
            isTerminated: false,
            timeoutHandle: null,
            messageHandler: null,
            exitHandler: null,
            errorHandler: null,
        };

        // FIX #4: Set timeout to prevent runaway workers
        workerData.timeoutHandle = setTimeout(() => {
            if (!workerData.isTerminated) {
                logger.error(
                    `⏰ Worker timeout for ${socketId} after ${
                        WORKER_TIMEOUT_MS / 1000
                    }s`
                );
                io.to(socketId).emit("optimization_error", {
                    message:
                        "Optimization timed out. Try reducing the number of assets or days.",
                });
                terminateWorker(workerData, "Timeout");
            }
        }, WORKER_TIMEOUT_MS);

        // FIX #4: Store worker reference for cleanup
        activeWorkers.set(socketId, workerData);

        // Send start command to worker
        worker.send({ command: "start_optimization", config });

        // FIX #4: Message handler with proper cleanup
        workerData.messageHandler = (msg) => {
            if (workerData.isTerminated) return;

            try {
                if (msg.type === "progress") {
                    io.to(socketId).emit("optimization_progress", msg);
                } else if (msg.type === "optimization_complete") {
                    io.to(socketId).emit("optimization_complete", msg.data);
                    logger.success(`🏆 Optimization complete for ${socketId}`);
                    terminateWorker(workerData, "Completed successfully");
                } else if (msg.type === "error") {
                    io.to(socketId).emit("optimization_error", {
                        message: msg.error,
                    });
                    logger.error(`❌ Optimization Worker Error: ${msg.error}`);
                    terminateWorker(workerData, "Worker reported error");
                }
            } catch (err) {
                logger.error("Socket emit failed:", err.message);
            }
        };

        // FIX #4: Exit handler
        workerData.exitHandler = (code, signal) => {
            // Only report crash if we didn't intentionally terminate
            if (!workerData.isTerminated) {
                if (code !== 0) {
                    logger.warn(
                        `⚠️ Optimization worker exited unexpectedly. Code: ${code}, Signal: ${signal}`
                    );
                    io.to(socketId).emit("optimization_error", {
                        message: `Worker process crashed (code: ${code}). Check system logs.`,
                    });
                }
                cleanupWorkerData(workerData);
            }
        };

        // FIX #4: Error handler (for spawn failures, etc.)
        workerData.errorHandler = (err) => {
            if (!workerData.isTerminated) {
                logger.error(
                    `❌ Worker process error for ${socketId}:`,
                    err.message
                );
                io.to(socketId).emit("optimization_error", {
                    message: `Worker process error: ${err.message}`,
                });
                terminateWorker(workerData, "Process error");
            }
        };

        // Attach handlers
        worker.on("message", workerData.messageHandler);
        worker.on("exit", workerData.exitHandler);
        worker.on("error", workerData.errorHandler);
    });

    // --- 3. NEW: Cancel optimization endpoint ---
    socket.on("cancel_optimization", () => {
        const workerData = activeWorkers.get(socketId);
        if (workerData) {
            logger.info(`🛑 Optimization cancelled by user ${socketId}`);
            io.to(socketId).emit("optimization_error", {
                message: "Optimization cancelled by user.",
            });
            terminateWorker(workerData, "Cancelled by user");
        } else {
            logger.info(`⚠️ No active optimization to cancel for ${socketId}`);
        }
    });
};

/**
 * FIX #4: Gracefully terminate a worker with cleanup
 */
function terminateWorker(workerData, reason) {
    if (workerData.isTerminated) return;

    workerData.isTerminated = true;
    const { worker, socketId, startTime, timeoutHandle } = workerData;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.info(
        `🔪 Terminating worker for ${socketId}. Reason: ${reason}. Duration: ${duration}s`
    );

    // Clear the timeout
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        workerData.timeoutHandle = null;
    }

    // Remove from tracking
    activeWorkers.delete(socketId);

    // Remove event listeners to prevent memory leaks
    if (worker) {
        if (workerData.messageHandler)
            worker.off("message", workerData.messageHandler);
        if (workerData.exitHandler) worker.off("exit", workerData.exitHandler);
        if (workerData.errorHandler)
            worker.off("error", workerData.errorHandler);

        // Try graceful shutdown first
        try {
            worker.kill("SIGTERM");
        } catch (e) {
            logger.debug(`SIGTERM failed: ${e.message}`);
        }

        // Force kill after 5 seconds if still running
        setTimeout(() => {
            try {
                if (!worker.killed) {
                    logger.warn(
                        `⚠️ Worker didn't exit gracefully, sending SIGKILL`
                    );
                    worker.kill("SIGKILL");
                }
            } catch (e) {
                // Worker already dead, ignore
            }
        }, 5000);
    }
}

/**
 * FIX #4: Cleanup worker data without killing (for natural exit)
 */
function cleanupWorkerData(workerData) {
    if (workerData.timeoutHandle) {
        clearTimeout(workerData.timeoutHandle);
        workerData.timeoutHandle = null;
    }
    activeWorkers.delete(workerData.socketId);
    workerData.isTerminated = true;
}

/**
 * FIX #4: Export for external monitoring/cleanup (e.g., graceful shutdown)
 */
module.exports.getActiveWorkers = () => {
    return Array.from(activeWorkers.entries()).map(([socketId, data]) => ({
        socketId,
        startTime: data.startTime,
        duration: ((Date.now() - data.startTime) / 1000).toFixed(1) + "s",
        isTerminated: data.isTerminated,
    }));
};

module.exports.terminateAllWorkers = () => {
    logger.warn(`🧹 Terminating all ${activeWorkers.size} active workers...`);
    for (const [socketId, workerData] of activeWorkers) {
        terminateWorker(workerData, "System shutdown");
    }
};
