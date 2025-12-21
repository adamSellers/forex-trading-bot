// debug_stats.js
const TradeRepository = require("./src/repositories/tradeRepository");
const SignalRepository = require("./src/repositories/signalRepository");

async function runDebug() {
    try {
        console.log("🔍 STARTING REPO PROBE...");
        console.log("--------------------------------");

        const tradeRepo = new TradeRepository();
        const signalRepo = new SignalRepository();

        // 1. Check Time
        const now = Date.now();
        console.log(`⏰ Server Time: ${now} (${new Date(now).toISOString()})`);

        // 2. Run Trade Metrics Query
        console.log("\n📊 QUERYING TRADE METRICS (30d)...");
        try {
            const metrics = await tradeRepo.getPerformanceMetrics(
                "30d",
                "live"
            );
            console.log(
                "✅ Trade Metrics Result:",
                JSON.stringify(metrics, null, 2)
            );
        } catch (err) {
            console.error("❌ Trade Metrics Error:", err.message);
        }

        // 3. Run Signal Stats Query
        console.log("\n📡 QUERYING SIGNAL STATS (30d)...");
        try {
            // Check if the method exists first
            if (!signalRepo.getSignalStats) {
                console.error(
                    "❌ ERROR: signalRepo.getSignalStats method is MISSING!"
                );
            } else {
                const stats = await signalRepo.getSignalStats("30d");
                console.log(
                    "✅ Signal Stats Result:",
                    JSON.stringify(stats, null, 2)
                );
            }
        } catch (err) {
            console.error("❌ Signal Stats Error:", err.message);
        }

        console.log("\n--------------------------------");
        console.log("🏁 PROBE COMPLETE");
        process.exit(0);
    } catch (e) {
        console.error("FATAL:", e);
        process.exit(1);
    }
}

runDebug();
