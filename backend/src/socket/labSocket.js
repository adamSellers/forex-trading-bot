// backend/src/socket/labSocket.js
const backtestEngine = require("../services/backtestEngine");
const logger = require("../utils/logger");
const { fork } = require("child_process");
const path = require("path");

module.exports = (io, socket) => {
    // --- 1. EXISTING: Single Simulation ---
    socket.on("start_simulation", async (config) => {
        const socketId = socket.id;
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

    // --- 2. GENETIC OPTIMIZATION (The Screener) ---
    socket.on("start_optimization", (config) => {
        const socketId = socket.id;
        logger.info(`🧬 Genetic Optimization requested by ${socketId}`);

        // Path to the worker file
        const workerPath = path.join(
            __dirname,
            "../workers/optimizationWorker.js"
        );

        // Spawn worker
        const worker = fork(workerPath);

        // State flag to prevent double-messaging
        let isTerminated = false;

        worker.send({ command: "start_optimization", config });

        worker.on("message", (msg) => {
            if (isTerminated) return;

            try {
                if (msg.type === "progress") {
                    io.to(socketId).emit("optimization_progress", msg);
                } else if (msg.type === "optimization_complete") {
                    isTerminated = true; // Mark as successfully handled
                    io.to(socketId).emit("optimization_complete", msg.data);
                    logger.success(`🏆 Optimization complete for ${socketId}`);
                    worker.kill();
                } else if (msg.type === "error") {
                    isTerminated = true; // Mark as error handled
                    io.to(socketId).emit("optimization_error", {
                        message: msg.error,
                    });
                    logger.error(`❌ Optimization Worker Error: ${msg.error}`);
                    worker.kill();
                }
            } catch (err) {
                logger.error("Socket emit failed", err);
            }
        });

        // Safety: Handle unexpected crashes
        worker.on("exit", (code) => {
            // Only send "Crashed" if we haven't already handled a specific completion/error
            if (!isTerminated && code !== 0) {
                logger.warn(
                    `Optimization worker exited unexpectedly with code ${code}`
                );
                io.to(socketId).emit("optimization_error", {
                    message: "Worker Process Crashed (Check System Logs)",
                });
            }
        });
    });
};
