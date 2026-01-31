const TradeRepository = require('../backend/src/repositories/tradeRepository');
const AnalyticsService = require('../backend/src/services/analyticsService');
const { db } = require('../backend/config/database');

async function run() {
    try {
        const tradeRepo = new TradeRepository();
        // Mock signal repo as we only care about PnL
        const signalRepo = {
            getSignalsSince: async () => []
        };

        const service = new AnalyticsService(tradeRepo, signalRepo);

        console.log("--- Analytics Service Debug ---");
        console.log("Time (Local):", new Date().toString());
        console.log("Time (ISO):", new Date().toISOString());

        console.log("\nFetching Analytics for 24h...");
        const result = await service.getAnalytics('24h', 'live');

        console.log("Summary PnL AUD:", result.summary.totalPnLAud);
        console.log("Summary Object:", JSON.stringify(result.summary, null, 2));
        console.log("Raw Counts:", JSON.stringify(result.rawCounts, null, 2));

        console.log("\n--- Direct Repository Debug ---");
        const periodMs = 24 * 60 * 60 * 1000;
        const cutoffTime = Date.now() - periodMs;
        console.log(`Cutoff Time: ${cutoffTime} (${new Date(cutoffTime).toISOString()})`);

        const trades = await tradeRepo.getTradesSince(cutoffTime, 'live');
        console.log(`Found ${trades.length} trades since cutoff.`);

        trades.forEach(t => {
            console.log(`Trade ${t.id}: Open=${t.isOpen}, PnL=${t.pnlAud} (Type: ${typeof t.pnlAud}), Entry=${new Date(t.entryTime).toISOString()}`);
        });

        // Filter logic check
        const closedTrades = trades.filter(
            (t) => !t.isOpen && t.pnlAud !== null && t.pnlAud !== undefined
        );
        console.log(`Closed Trades (Filtered): ${closedTrades.length}`);

        const manualSum = closedTrades.reduce((sum, t) => sum + (t.pnlAud || 0), 0);
        console.log(`Manual Sum of Closed Trades: ${manualSum}`);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await db.destroy();
    }
}

run();
