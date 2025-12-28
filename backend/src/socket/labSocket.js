// backend/src/socket/labSocket.js
const backtestEngine = require("../services/backtestEngine");
const logger = require("../utils/logger");

module.exports = (io, socket) => {
    socket.on("start_simulation", async (config) => {
        const socketId = socket.id;
        logger.info(`🧪 Lab Simulation requested by ${socketId}`);

        try {
            const results = await backtestEngine.runSimulation(
                config,
                (progress) => {
                    // Emit progress only to the specific client who requested it
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
};
