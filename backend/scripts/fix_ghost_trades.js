// backend/scripts/fix_ghost_trades.js
// require("dotenv").config(); // Uncomment if you use .env variables for DB path
const path = require("path");
const { db } = require("../src/config/database"); // Adjust path if needed

// The specific trade ID that failed to close in the DB
const TARGET_TRADE_ID = "10533349787";

async function fixGhostTrade() {
    console.log(`🔧 Starting cleanup for Trade ID: ${TARGET_TRADE_ID}`);
    try {
        const result = await db("trades")
            .where({ trade_id: TARGET_TRADE_ID })
            .update({
                is_open: 0, // ✅ This is the correct "Status" flag
                exit_price: 859.35, // From logs
                exit_time: 1765946934119, // From logs
                exit_reason: "MANUAL_FIX_MIGRATION",
                pnl: -0.22, // From UI screenshot
            });

        if (result) {
            console.log("✅ SUCCESS: Trade marked as CLOSED in database.");
        } else {
            console.log(
                "⚠️ WARNING: Trade ID not found. It may have already been fixed."
            );
        }
        process.exit(0);
    } catch (error) {
        console.error("❌ ERROR:", error);
        process.exit(1);
    }
}

fixGhostTrade();
