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

    // --- 2. NEW: Genetic Optimization (The Screener) ---
    socket.on("start_optimization", (config) => {
        const socketId = socket.id;
        logger.info(`🧬 Genetic Optimization requested by ${socketId}`);

        // Path to the new worker file
        const workerPath = path.join(
            __dirname,
            "../workers/optimizationWorker.js"
        );

        // Spawn the worker in a separate process to prevent freezing the server
        const worker = fork(workerPath);

        // Send the start command to the worker
        worker.send({ command: "start_optimization", config });

        // Listen for messages from the worker
        worker.on("message", (msg) => {
            try {
                if (msg.type === "progress") {
                    // Relay progress bar updates (e.g. "Analyzing BTC... 15%")
                    io.to(socketId).emit("optimization_progress", msg);
                } else if (msg.type === "optimization_complete") {
                    // Send the final "Dream Team" report
                    io.to(socketId).emit("optimization_complete", msg.data);
                    logger.success(`🏆 Optimization complete for ${socketId}`);
                    worker.kill(); // Clean up memory
                } else if (msg.type === "error") {
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
            if (code !== 0) {
                logger.warn(`Optimization worker exited with code ${code}`);
                io.to(socketId).emit("optimization_error", {
                    message: "Worker Process Crashed",
                });
            }
        });
    });
};
