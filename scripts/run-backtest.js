require("dotenv").config({ path: "./backend/.env" });
const fs = require("fs");
const path = require("path");
const BacktestingEngine = require("../backend/src/services/backtestingEngine");
const logger = require("../backend/src/utils/logger");

async function run() {
    logger.info("--- Starting Multi-Asset Backtest Runner ---");

    // --- Configuration for this backtest run ---
    const ASSETS_TO_TEST = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT"];
    const STRATEGY_TO_TEST = "balanced"; // 'conservative', 'balanced', 'responsive'
    const timeframe = "1h";
    const months = 12;
    const OUTPUT_DIR = path.join(__dirname, "../backend/data/backtests");

    const allReports = [];

    for (const asset of ASSETS_TO_TEST) {
        logger.info(`--- Running backtest for ${asset} ---`);

        const backtestConfig = {
            symbol: asset,
            dataFile: `${asset}-${timeframe}-${months}m.json`,
            strategy: STRATEGY_TO_TEST,
            timeframe: timeframe,
            startingCapital: 5000,
            riskPerTrade: 0.01, // 1%
            maxDailyLoss: 0.02, // 2%
            maxWeeklyLoss: 0.05, // 5%
            minSignalStrength: 0.5, // Require at least 0.5% MA divergence
            allocation: {
                [asset]: 1.0, // Allocate 100% to the asset being tested
            },
        };

        try {
            const engine = new BacktestingEngine(backtestConfig);
            const report = await engine.run(); // The engine already logs the individual summary
            allReports.push({ asset, report });
        } catch (error) {
            logger.error(`❌ Backtest for ${asset} failed to run:`, error);
            // Continue to the next asset
        }
        logger.info(`--- Finished backtest for ${asset} ---\n`);
    }

    // --- Generate and Save Final Report ---
    const summaryTable = allReports.map((r) => ({
        Asset: r.asset,
        "Total Trades": r.report.summary.totalTrades,
        "Win Rate (%)": r.report.summary.winRate,
        "Total PnL (USDT)": r.report.summary.totalPnL,
        "Final Value (USDT)": r.report.summary.finalPortfolioValue.toFixed(2),
        "Return (%)": r.report.summary.totalPnLPercent.toFixed(2),
    }));

    const finalReport = {
        runDetails: {
            strategy: STRATEGY_TO_TEST,
            assets: ASSETS_TO_TEST,
            timestamp: new Date().toISOString(),
        },
        summaryTable: summaryTable,
        fullReports: allReports,
    };

    // --- Final Summary Report ---
    logger.info("--- MULTI-ASSET BACKTEST SUMMARY ---");
    console.log(`Strategy: ${STRATEGY_TO_TEST}`);
    console.table(summaryTable);
    logger.info("------------------------------------");

    // Save the detailed report to a file
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const filename = `backtest-report-${STRATEGY_TO_TEST}-${new Date()
        .toISOString()
        .replace(/:/g, "-")}.json`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(finalReport, null, 2));
    logger.success(
        `✅ All backtests finished. Full report saved to: ${filepath}`
    );
}

run();
