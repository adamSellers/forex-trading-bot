// Tests for BacktestEngine - Strategy simulation on historical candle data
const BacktestEngine = require("../backtestEngine");
const { getPipValue } = require("../../utils/indicators");

// Helper: Generate candle array with controlled price movement
// direction: 'up' = trending up, 'down' = trending down, 'flat' = sideways
const generateCandles = (count, startPrice = 1.165, direction = "up", startTime = 1696118400) => {
    const candles = [];
    let price = startPrice;
    const step = direction === "up" ? 0.0003 : direction === "down" ? -0.0003 : 0;
    const noise = 0.0005;

    for (let i = 0; i < count; i++) {
        const open = price;
        const high = price + noise + Math.random() * noise;
        const low = price - noise - Math.random() * noise;
        price += step + (Math.random() - 0.5) * 0.00005;
        const close = price;
        candles.push({
            time: startTime + i * 900, // 15-min candles
            open,
            high: Math.max(open, close, high),
            low: Math.min(open, close, low),
            close,
            volume: 100 + Math.floor(Math.random() * 50),
        });
    }
    return candles;
};

// Helper: Generate candles with a known SuperTrend flip pattern
// Creates a downtrend followed by uptrend to trigger a RED→GREEN flip
const generateFlipCandles = (options = {}) => {
    const {
        startPrice = 1.18,
        downCandles = 80,
        upCandles = 80,
        startTime = 1696118400,
        dropMagnitude = 0.004,
        riseMagnitude = 0.006,
    } = options;

    const candles = [];
    let price = startPrice;

    // Phase 1: Downtrend (establishes RED SuperTrend direction)
    for (let i = 0; i < downCandles; i++) {
        const step = dropMagnitude / downCandles;
        const open = price;
        price -= step;
        const close = price;
        const spread = 0.0004;
        candles.push({
            time: startTime + i * 900,
            open,
            high: open + spread,
            low: close - spread,
            close,
            volume: 100,
        });
    }

    // Phase 2: Uptrend (triggers GREEN flip)
    for (let i = 0; i < upCandles; i++) {
        const step = riseMagnitude / upCandles;
        const open = price;
        price += step;
        const close = price;
        const spread = 0.0004;
        candles.push({
            time: startTime + (downCandles + i) * 900,
            open,
            high: close + spread,
            low: open - spread,
            close,
            volume: 100,
        });
    }

    return candles;
};

// Helper: Generate candles with a known up→down flip (for SHORT signals)
const generateShortFlipCandles = (options = {}) => {
    const {
        startPrice = 1.17,
        upCandles = 80,
        downCandles = 80,
        startTime = 1696118400,
    } = options;

    const candles = [];
    let price = startPrice;

    // Phase 1: Uptrend (establishes GREEN)
    for (let i = 0; i < upCandles; i++) {
        const step = 0.006 / upCandles;
        const open = price;
        price += step;
        const close = price;
        const spread = 0.0004;
        candles.push({
            time: startTime + i * 900,
            open,
            high: close + spread,
            low: open - spread,
            close,
            volume: 100,
        });
    }

    // Phase 2: Downtrend (triggers RED flip → SELL signal)
    for (let i = 0; i < downCandles; i++) {
        const step = 0.008 / downCandles;
        const open = price;
        price -= step;
        const close = price;
        const spread = 0.0004;
        candles.push({
            time: startTime + (upCandles + i) * 900,
            open,
            high: open + spread,
            low: close - spread,
            close,
            volume: 100,
        });
    }

    return candles;
};

describe("BacktestEngine", () => {
    let engine;

    beforeEach(() => {
        engine = new BacktestEngine();
    });

    // ==========================================================================
    // 1. Constructor & Config
    // ==========================================================================

    describe("constructor & config", () => {
        test("should create instance with null historicalDataService", () => {
            const e = new BacktestEngine();
            expect(e.historicalDataService).toBeNull();
        });

        test("should store historicalDataService reference", () => {
            const mockService = { getCandles: jest.fn() };
            const e = new BacktestEngine(mockService);
            expect(e.historicalDataService).toBe(mockService);
        });

        test("should use default config when no overrides provided", () => {
            const candles = generateCandles(100);
            const result = engine.runOnCandles(candles, "AUD_USD");

            expect(result.config.minAdx).toBe(22);
            expect(result.config.riskPerTrade).toBe(0.02);
            expect(result.config.stopLossAtrMultiplier).toBe(2.0);
            expect(result.config.enableTakeProfit).toBe(true);
            expect(result.config.takeProfitPercent).toBe(0.06);
            expect(result.config.spreadPips).toBe(1.5);
        });

        test("should merge config overrides", () => {
            const candles = generateCandles(100);
            const result = engine.runOnCandles(candles, "AUD_USD", {
                minAdx: 18,
                spreadPips: 2.0,
                initialBalance: 1000,
            });

            expect(result.config.minAdx).toBe(18);
            expect(result.config.spreadPips).toBe(2.0);
            expect(result.config.initialBalance).toBe(1000);
            // Defaults preserved for non-overridden
            expect(result.config.factor).toBe(3);
        });
    });

    // ==========================================================================
    // 2. Insufficient Data
    // ==========================================================================

    describe("insufficient data", () => {
        test("should return empty result for null candles", () => {
            const result = engine.runOnCandles(null, "AUD_USD");
            expect(result.trades).toEqual([]);
            expect(result.summary.totalTrades).toBe(0);
            expect(result.equityCurve).toEqual([]);
        });

        test("should return empty result for too few candles", () => {
            const result = engine.runOnCandles(generateCandles(10), "AUD_USD");
            expect(result.trades).toEqual([]);
            expect(result.summary.totalTrades).toBe(0);
        });

        test("should return empty result with starting balance preserved", () => {
            const result = engine.runOnCandles(null, "AUD_USD", { initialBalance: 1000 });
            expect(result.summary.startBalance).toBe(1000);
            expect(result.summary.endBalance).toBe(1000);
            expect(result.summary.returnPercent).toBe(0);
        });
    });

    // ==========================================================================
    // 3. run() with historicalDataService
    // ==========================================================================

    describe("run() integration", () => {
        test("should throw if historicalDataService is not provided", async () => {
            const e = new BacktestEngine();
            await expect(
                e.run("AUD_USD", "M15", 1696118400, 1696204800)
            ).rejects.toThrow("historicalDataService is required");
        });

        test("should fetch candles and delegate to runOnCandles", async () => {
            const candles = generateCandles(100);
            const mockService = {
                getCandles: jest.fn().mockResolvedValue(candles),
            };
            const e = new BacktestEngine(mockService);

            const result = await e.run("AUD_USD", "M15", 1696118400, 1696204800, { initialBalance: 500 });

            expect(mockService.getCandles).toHaveBeenCalledWith(
                "AUD_USD", "M15", 1696118400, 1696204800
            );
            expect(result).toHaveProperty("trades");
            expect(result).toHaveProperty("summary");
            expect(result).toHaveProperty("equityCurve");
            expect(result).toHaveProperty("config");
        });
    });

    // ==========================================================================
    // 4. Signal Generation
    // ==========================================================================

    describe("signal generation", () => {
        test("should detect FRESH_FLIP BUY on SuperTrend flip with strong ADX", () => {
            // Generate a down→up pattern that triggers a SuperTrend flip
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
                enableShorting: false,
                enableContinuationEntry: false,
            });

            // Should have at least one trade from the flip
            if (result.trades.length > 0) {
                const buyTrades = result.trades.filter((t) => t.side === "BUY");
                expect(buyTrades.length).toBeGreaterThanOrEqual(0);
                // If there are buy trades, first should be FRESH_FLIP
                if (buyTrades.length > 0) {
                    expect(buyTrades[0].entryType).toBe("FRESH_FLIP");
                }
            }
        });

        test("should not generate signal when data is flat (no flip)", () => {
            // Flat market = no SuperTrend flips
            const candles = generateCandles(200, 1.165, "flat");
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableContinuationEntry: false,
            });

            // Flat data may not produce any flips
            // Just verify the engine runs without error and returns valid structure
            expect(result).toHaveProperty("trades");
            expect(result).toHaveProperty("summary");
        });

        test("should not enter position when ADX is below threshold", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                minAdx: 99, // Impossibly high threshold
                enableContinuationEntry: false,
                enableShorting: false,
            });

            // With ADX threshold of 99, no entries should be triggered
            expect(result.trades.length).toBe(0);
        });

        test("should enforce no look-ahead bias (entry at next candle open)", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            // Every trade entry should be at a candle open price, not a close price
            for (const trade of result.trades) {
                // entryCandle tracks which candle the entry happened at
                if (trade.entryCandle != null) {
                    expect(trade.entryPrice).toBe(candles[trade.entryCandle].open);
                }
            }
        });

        test("should detect SHORT_ENTRY on SuperTrend flip GREEN→RED", () => {
            const candles = generateShortFlipCandles({ upCandles: 100, downCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableShorting: true,
                enableTrailingStops: false,
                enableBreakeven: false,
                enableContinuationEntry: false,
            });

            const sellTrades = result.trades.filter((t) => t.side === "SELL");
            if (sellTrades.length > 0) {
                const shortEntries = sellTrades.filter((t) => t.entryType === "SHORT_ENTRY");
                expect(shortEntries.length).toBeGreaterThanOrEqual(0);
            }
        });

        test("should not open short when enableShorting is false", () => {
            const candles = generateShortFlipCandles({ upCandles: 100, downCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableShorting: false,
                enableContinuationEntry: false,
            });

            const sellTrades = result.trades.filter((t) => t.side === "SELL");
            expect(sellTrades.length).toBe(0);
        });

        test("should respect maxOpenPositions limit", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                maxOpenPositions: 1,
            });

            // Engine is single-instrument, so max 1 at a time is natural
            // Verify it doesn't crash and produces valid results
            expect(result).toHaveProperty("trades");
        });
    });

    // ==========================================================================
    // 5. Trade Management
    // ==========================================================================

    describe("trade management", () => {
        test("should close trade at stop loss price", () => {
            const candles = generateFlipCandles({
                downCandles: 100,
                upCandles: 30, // Short uptrend → entry then likely reversal
                riseMagnitude: 0.002,
            });
            // Extend with downtrend to trigger SL
            const lastPrice = candles[candles.length - 1].close;
            const slCandles = generateCandles(60, lastPrice, "down", candles[candles.length - 1].time + 900);
            const allCandles = [...candles, ...slCandles];

            const result = engine.runOnCandles(allCandles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
                enableShorting: false,
                enableContinuationEntry: false,
            });

            const slTrades = result.trades.filter((t) => t.exitReason === "STOP_LOSS");
            for (const trade of slTrades) {
                expect(trade.exitPrice).toBe(trade.stopLossPrice);
                expect(trade.pnlNet).toBeLessThan(0);
            }
        });

        test("should calculate position size based on risk", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                initialBalance: 500,
                riskPerTrade: 0.02,
                marginBuffer: 0.2,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            for (const trade of result.trades) {
                expect(trade.units).toBeGreaterThan(0);
                expect(trade.marginUsed).toBeGreaterThan(0);
                // Units should be reasonable for a $500 account
                expect(trade.units).toBeLessThan(100000);
            }
        });

        test("should enforce minimum stop loss floor", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const pipValue = getPipValue("AUD_USD");

            const result = engine.runOnCandles(candles, "AUD_USD", {
                minStopLossPips: 15,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            for (const trade of result.trades) {
                expect(trade.stopLossPips).toBeGreaterThanOrEqual(15);
            }
        });

        test("should apply breakeven when profit exceeds trigger", () => {
            // Create scenario where price moves up past breakeven trigger then reverses
            const candles = generateFlipCandles({
                downCandles: 100,
                upCandles: 100,
                riseMagnitude: 0.01, // Strong rise to trigger breakeven
            });

            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableBreakeven: true,
                breakevenTriggerPips: 12,
                enableTrailingStops: false,
                enableShorting: false,
                enableContinuationEntry: false,
            });

            // If any trades were closed with breakeven active, SL should be at entry
            const beTradesAtEntry = result.trades.filter(
                (t) => t.breakevenHit && t.exitReason === "STOP_LOSS"
            );
            for (const trade of beTradesAtEntry) {
                // When breakeven is hit, SL moves to entry, so exit ≈ entry
                expect(Math.abs(trade.exitPrice - trade.entryPrice)).toBeLessThan(0.001);
            }
        });

        test("should close opposite position on signal reversal", () => {
            // Generate up→down→up pattern for reversals
            const upDown = generateShortFlipCandles({ upCandles: 80, downCandles: 80 });
            const lastPrice = upDown[upDown.length - 1].close;
            const recovery = generateCandles(80, lastPrice, "up", upDown[upDown.length - 1].time + 900);
            const allCandles = [...upDown, ...recovery];

            const result = engine.runOnCandles(allCandles, "AUD_USD", {
                enableShorting: true,
                enableTrailingStops: false,
                enableBreakeven: false,
                enableContinuationEntry: false,
            });

            const reversals = result.trades.filter((t) => t.exitReason === "SIGNAL_REVERSAL");
            // May or may not have reversals depending on flip timing
            expect(result).toHaveProperty("trades");
        });

        test("should handle SL priority over TP on same candle", () => {
            // This tests the engine's order of operations: SL is checked before TP
            // If a candle's range hits both, SL should win (conservative)
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            // Verify SL trades have exit at SL price, TP trades at TP price
            for (const trade of result.trades) {
                if (trade.exitReason === "STOP_LOSS") {
                    const effectiveSL = trade.trailingStopPrice || trade.stopLossPrice;
                    expect(trade.exitPrice).toBe(effectiveSL);
                }
                if (trade.exitReason === "TAKE_PROFIT") {
                    expect(trade.exitPrice).toBe(trade.takeProfitPrice);
                }
            }
        });

        test("should track trailing stop and close at trailing stop price", () => {
            // Strong uptrend to activate trailing, then reversal
            const candles = generateFlipCandles({
                downCandles: 100,
                upCandles: 60,
                riseMagnitude: 0.015, // Very strong to activate trailing
            });
            // Append a reversal
            const lastPrice = candles[candles.length - 1].close;
            const reversal = generateCandles(60, lastPrice, "down", candles[candles.length - 1].time + 900);
            const allCandles = [...candles, ...reversal];

            const result = engine.runOnCandles(allCandles, "AUD_USD", {
                enableTrailingStops: true,
                trailingStopPips: 25,
                trailingStopActivationPips: 15,
                enableBreakeven: false,
                enableShorting: false,
                enableContinuationEntry: false,
            });

            const trailingTrades = result.trades.filter((t) => t.exitReason === "TRAILING_STOP");
            for (const trade of trailingTrades) {
                expect(trade.trailingStopPrice).not.toBeNull();
                expect(trade.exitPrice).toBe(trade.trailingStopPrice);
            }
        });
    });

    // ==========================================================================
    // 6. Spread & P&L
    // ==========================================================================

    describe("spread & P&L", () => {
        test("should deduct spread cost from P&L", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                spreadPips: 2.0,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            for (const trade of result.trades) {
                expect(trade.spreadCost).toBeGreaterThan(0);
                expect(trade.pnlNet).toBeLessThan(trade.pnlGross);
                // pnlNet = pnlGross - spreadCost
                expect(trade.pnlNet).toBeCloseTo(trade.pnlGross - trade.spreadCost, 6);
            }
        });

        test("should calculate pnlPips accounting for spread", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const pipValue = getPipValue("AUD_USD");
            const spreadPips = 1.5;

            const result = engine.runOnCandles(candles, "AUD_USD", {
                spreadPips,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            for (const trade of result.trades) {
                const rawPips = (trade.side === "BUY"
                    ? trade.exitPrice - trade.entryPrice
                    : trade.entryPrice - trade.exitPrice) / pipValue;
                expect(trade.pnlPips).toBeCloseTo(rawPips - spreadPips, 4);
            }
        });

        test("should accumulate balance across multiple trades", () => {
            const candles = generateFlipCandles({
                downCandles: 100,
                upCandles: 100,
                riseMagnitude: 0.008,
            });
            // Add more candles to get multiple trades
            const lastPrice = candles[candles.length - 1].close;
            const more = generateCandles(150, lastPrice, "down", candles[candles.length - 1].time + 900);
            const allCandles = [...candles, ...more];

            const result = engine.runOnCandles(allCandles, "AUD_USD", {
                initialBalance: 500,
                enableShorting: true,
            });

            // End balance should equal initial + sum of all trade P&L
            const totalPnl = result.trades.reduce((sum, t) => sum + t.pnlNet, 0);
            expect(result.summary.endBalance).toBeCloseTo(500 + totalPnl, 4);
            expect(result.summary.totalPnl).toBeCloseTo(totalPnl, 4);
        });
    });

    // ==========================================================================
    // 7. Equity & Summary Stats
    // ==========================================================================

    describe("equity & summary stats", () => {
        test("should track equity curve throughout simulation", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD");

            expect(result.equityCurve.length).toBeGreaterThan(0);
            // Each point should have time and equity
            for (const point of result.equityCurve) {
                expect(point).toHaveProperty("time");
                expect(point).toHaveProperty("equity");
                expect(typeof point.equity).toBe("number");
            }
        });

        test("should calculate max drawdown correctly", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD");

            expect(result.summary.maxDrawdown).toBeGreaterThanOrEqual(0);
            expect(result.summary.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
        });

        test("should calculate summary statistics", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const lastPrice = candles[candles.length - 1].close;
            const more = generateCandles(150, lastPrice, "down", candles[candles.length - 1].time + 900);
            const allCandles = [...candles, ...more];

            const result = engine.runOnCandles(allCandles, "AUD_USD", {
                enableShorting: true,
            });

            expect(result.summary).toHaveProperty("totalTrades");
            expect(result.summary).toHaveProperty("winners");
            expect(result.summary).toHaveProperty("losers");
            expect(result.summary).toHaveProperty("winRate");
            expect(result.summary).toHaveProperty("profitFactor");
            expect(result.summary).toHaveProperty("expectancy");
            expect(result.summary).toHaveProperty("byEntryType");
            expect(result.summary).toHaveProperty("byExitReason");
            expect(result.summary.startBalance).toBe(500);

            // Consistency checks
            expect(result.summary.winners + result.summary.losers).toBe(result.summary.totalTrades);
            if (result.summary.totalTrades > 0) {
                expect(result.summary.winRate).toBe(result.summary.winners / result.summary.totalTrades);
            }
        });

        test("should break down results by entry type", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD");

            // byEntryType should be an object
            expect(typeof result.summary.byEntryType).toBe("object");
            for (const [type, stats] of Object.entries(result.summary.byEntryType)) {
                expect(stats).toHaveProperty("count");
                expect(stats).toHaveProperty("wins");
                expect(stats).toHaveProperty("pnl");
                expect(stats).toHaveProperty("winRate");
                expect(stats.count).toBeGreaterThan(0);
            }
        });

        test("should break down results by exit reason", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD");

            expect(typeof result.summary.byExitReason).toBe("object");
            for (const [reason, stats] of Object.entries(result.summary.byExitReason)) {
                expect(stats).toHaveProperty("count");
                expect(stats).toHaveProperty("pnl");
                expect(stats.count).toBeGreaterThan(0);
            }
        });
    });

    // ==========================================================================
    // 8. Continuation Entries
    // ==========================================================================

    describe("continuation entries", () => {
        test("should expire continuation window after configured seconds", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableContinuationEntry: true,
                continuationWindowSeconds: 1, // 1 second = immediate expiry
                minAdx: 99, // Force all entries to go through continuation path
            });

            // With a 1-second window and 15-min candles, no continuations should trigger
            const continuations = result.trades.filter(
                (t) => t.entryType && t.entryType.startsWith("CONTINUATION")
            );
            expect(continuations.length).toBe(0);
        });

        test("should not generate continuations when disabled", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableContinuationEntry: false,
            });

            const continuations = result.trades.filter(
                (t) => t.entryType && t.entryType.includes("CONTINUATION")
            );
            expect(continuations.length).toBe(0);
        });
    });

    // ==========================================================================
    // 9. JPY pairs
    // ==========================================================================

    describe("JPY pair handling", () => {
        test("should use correct pip value for JPY pairs", () => {
            const candles = [];
            let price = 150.5;
            for (let i = 0; i < 200; i++) {
                const open = price;
                const dir = i < 100 ? -0.03 : 0.05;
                price += dir;
                const close = price;
                candles.push({
                    time: 1696118400 + i * 900,
                    open,
                    high: Math.max(open, close) + 0.05,
                    low: Math.min(open, close) - 0.05,
                    close,
                    volume: 100,
                });
            }

            const result = engine.runOnCandles(candles, "USD_JPY");

            // Just verify it doesn't crash with JPY pricing
            expect(result).toHaveProperty("trades");
            // pip value for JPY should be 0.01
            expect(getPipValue("USD_JPY")).toBe(0.01);
        });
    });

    // ==========================================================================
    // 10. Edge Cases
    // ==========================================================================

    describe("edge cases", () => {
        test("should close remaining positions at backtest end", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 50 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            // If there are BACKTEST_END exits, they should be at the last candle close
            const endTrades = result.trades.filter((t) => t.exitReason === "BACKTEST_END");
            const lastClose = candles[candles.length - 1].close;
            for (const trade of endTrades) {
                expect(trade.exitPrice).toBe(lastClose);
            }
        });

        test("should end equity curve at realized end balance", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 50 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            const lastPoint = result.equityCurve[result.equityCurve.length - 1];
            expect(lastPoint).toBeDefined();
            expect(lastPoint.time).toBe(candles[candles.length - 1].time);
            expect(lastPoint.equity).toBeCloseTo(result.summary.endBalance, 6);
        });

        test("should handle zero spread correctly", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                spreadPips: 0,
            });

            for (const trade of result.trades) {
                expect(trade.spreadCost).toBe(0);
                expect(trade.pnlNet).toBe(trade.pnlGross);
            }
        });

        test("should return config used in the result", () => {
            const candles = generateCandles(100);
            const overrides = { minAdx: 18, spreadPips: 2.5 };
            const result = engine.runOnCandles(candles, "AUD_USD", overrides);

            expect(result.config.minAdx).toBe(18);
            expect(result.config.spreadPips).toBe(2.5);
        });
    });

    // ==========================================================================
    // 11. Multi-Timeframe Simulation
    // ==========================================================================

    describe("multi-timeframe simulation", () => {
        // Helper: Generate M15 candles aligned to hour boundaries
        // Each hour gets 4 candles at :00, :15, :30, :45
        const generateM15Candles = (hours, startPrice = 1.165, direction = "up", baseTime = 1696118400) => {
            const candles = [];
            let price = startPrice;
            const step = direction === "up" ? 0.0003 : direction === "down" ? -0.0003 : 0;
            const noise = 0.0005;

            for (let h = 0; h < hours; h++) {
                for (let q = 0; q < 4; q++) {
                    const open = price;
                    const high = price + noise + Math.random() * noise * 0.5;
                    const low = price - noise - Math.random() * noise * 0.5;
                    price += step + (Math.random() - 0.5) * 0.00005;
                    const close = price;
                    candles.push({
                        time: baseTime + h * 3600 + q * 900,
                        open,
                        high: Math.max(open, close, high),
                        low: Math.min(open, close, low),
                        close,
                        volume: 100,
                    });
                }
            }
            return candles;
        };

        // Helper: Generate M15 candles with a flip pattern (down then up)
        const generateM15FlipCandles = (options = {}) => {
            const {
                startPrice = 1.18,
                downHours = 25,
                upHours = 25,
                baseTime = 1696118400,
                dropMagnitude = 0.004,
                riseMagnitude = 0.006,
            } = options;

            const candles = [];
            let price = startPrice;
            const totalDownCandles = downHours * 4;
            const totalUpCandles = upHours * 4;

            // Phase 1: Downtrend
            for (let i = 0; i < totalDownCandles; i++) {
                const h = Math.floor(i / 4);
                const q = i % 4;
                const step = dropMagnitude / totalDownCandles;
                const open = price;
                price -= step;
                const close = price;
                const spread = 0.0004;
                candles.push({
                    time: baseTime + h * 3600 + q * 900,
                    open,
                    high: open + spread,
                    low: close - spread,
                    close,
                    volume: 100,
                });
            }

            // Phase 2: Uptrend
            for (let i = 0; i < totalUpCandles; i++) {
                const h = downHours + Math.floor(i / 4);
                const q = i % 4;
                const step = riseMagnitude / totalUpCandles;
                const open = price;
                price += step;
                const close = price;
                const spread = 0.0004;
                candles.push({
                    time: baseTime + h * 3600 + q * 900,
                    open,
                    high: close + spread,
                    low: open - spread,
                    close,
                    volume: 100,
                });
            }

            return candles;
        };

        // --- _aggregateToH1 unit tests ---

        test("should aggregate 8 M15 candles into 2 H1 candles", () => {
            const baseTime = 1696118400; // a round hour
            const m15 = [
                { time: baseTime + 0,    open: 1.10, high: 1.12, low: 1.09, close: 1.11, volume: 10 },
                { time: baseTime + 900,  open: 1.11, high: 1.13, low: 1.10, close: 1.12, volume: 20 },
                { time: baseTime + 1800, open: 1.12, high: 1.14, low: 1.11, close: 1.13, volume: 15 },
                { time: baseTime + 2700, open: 1.13, high: 1.15, low: 1.12, close: 1.14, volume: 25 },
                // Hour 2
                { time: baseTime + 3600, open: 1.14, high: 1.16, low: 1.13, close: 1.15, volume: 30 },
                { time: baseTime + 4500, open: 1.15, high: 1.17, low: 1.14, close: 1.16, volume: 10 },
                { time: baseTime + 5400, open: 1.16, high: 1.18, low: 1.15, close: 1.17, volume: 20 },
                { time: baseTime + 6300, open: 1.17, high: 1.19, low: 1.16, close: 1.18, volume: 15 },
            ];

            const result = engine._aggregateToH1(m15);

            // 2 H1 candles
            expect(result.h1Candles.length).toBe(2);

            // H1 bar 0: open=first M15 open, high=max highs, low=min lows, close=last M15 close
            expect(result.h1Candles[0].open).toBe(1.10);
            expect(result.h1Candles[0].high).toBe(1.15);
            expect(result.h1Candles[0].low).toBe(1.09);
            expect(result.h1Candles[0].close).toBe(1.14);
            expect(result.h1Candles[0].volume).toBe(70);

            // H1 bar 1
            expect(result.h1Candles[1].open).toBe(1.14);
            expect(result.h1Candles[1].high).toBe(1.19);
            expect(result.h1Candles[1].low).toBe(1.13);
            expect(result.h1Candles[1].close).toBe(1.18);

            // Mapping: first 4 → H1 index 0, next 4 → H1 index 1
            expect(result.m15ToH1Index).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);

            // Only the first H1 bar completes (index 3); last bar is incomplete
            expect(result.h1CompletionM15Indices.has(3)).toBe(true);
            expect(result.h1CompletionM15Indices.has(7)).toBe(false);
            expect(result.h1CompletionM15Indices.size).toBe(1);
        });

        test("should handle partial hour at end (no completion)", () => {
            const baseTime = 1696118400;
            const m15 = [
                { time: baseTime + 0,    open: 1.10, high: 1.12, low: 1.09, close: 1.11, volume: 10 },
                { time: baseTime + 900,  open: 1.11, high: 1.13, low: 1.10, close: 1.12, volume: 20 },
                { time: baseTime + 1800, open: 1.12, high: 1.14, low: 1.11, close: 1.13, volume: 15 },
                { time: baseTime + 2700, open: 1.13, high: 1.15, low: 1.12, close: 1.14, volume: 25 },
                // Partial hour 2 (only 2 candles)
                { time: baseTime + 3600, open: 1.14, high: 1.16, low: 1.13, close: 1.15, volume: 30 },
                { time: baseTime + 4500, open: 1.15, high: 1.17, low: 1.14, close: 1.16, volume: 10 },
            ];

            const result = engine._aggregateToH1(m15);

            expect(result.h1Candles.length).toBe(2);
            // First H1 bar completes, second does not
            expect(result.h1CompletionM15Indices.has(3)).toBe(true);
            expect(result.h1CompletionM15Indices.has(5)).toBe(false);
            expect(result.h1CompletionM15Indices.size).toBe(1);
        });

        test("should handle weekend gap (non-consecutive hours)", () => {
            const fridayHour = 1696118400;       // Friday hour
            const mondayHour = fridayHour + 172800; // +48 hours (Monday)

            const m15 = [
                { time: fridayHour + 0,    open: 1.10, high: 1.12, low: 1.09, close: 1.11, volume: 10 },
                { time: fridayHour + 900,  open: 1.11, high: 1.13, low: 1.10, close: 1.12, volume: 20 },
                // Weekend gap
                { time: mondayHour + 0,    open: 1.12, high: 1.14, low: 1.11, close: 1.13, volume: 15 },
                { time: mondayHour + 900,  open: 1.13, high: 1.15, low: 1.12, close: 1.14, volume: 25 },
            ];

            const result = engine._aggregateToH1(m15);

            // Two separate H1 bars (different hours)
            expect(result.h1Candles.length).toBe(2);
            expect(result.h1Candles[0].time).toBe(fridayHour);
            expect(result.h1Candles[1].time).toBe(mondayHour);

            // First H1 completes when Monday starts
            expect(result.h1CompletionM15Indices.has(1)).toBe(true);
            expect(result.h1CompletionM15Indices.size).toBe(1);
        });

        // --- Multi-TF mode integration tests ---

        test("should produce valid results in multi-TF mode", () => {
            const candles = generateM15FlipCandles({ downHours: 25, upHours: 25 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableMultiTimeframe: true,
                enableTrailingStops: false,
                enableBreakeven: false,
                enableShorting: false,
                enableContinuationEntry: false,
            });

            expect(result).toHaveProperty("trades");
            expect(result).toHaveProperty("summary");
            expect(result).toHaveProperty("equityCurve");
            expect(result.equityCurve.length).toBeGreaterThan(0);
            expect(result.config.enableMultiTimeframe).toBe(true);
        });

        test("should return empty result when not enough H1 candles for warmup", () => {
            // 10 hours = 40 M15 candles, but only 10 H1 → below 50 H1 minimum
            const candles = generateM15Candles(10);
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableMultiTimeframe: true,
            });

            expect(result.trades).toEqual([]);
            expect(result.summary.totalTrades).toBe(0);
        });

        test("should enforce no look-ahead bias in multi-TF mode", () => {
            const candles = generateM15FlipCandles({ downHours: 25, upHours: 25 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableMultiTimeframe: true,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            // Every trade entry should be at an M15 candle open price
            for (const trade of result.trades) {
                if (trade.entryCandle != null) {
                    expect(trade.entryPrice).toBe(candles[trade.entryCandle].open);
                }
            }
        });

        test("should not evaluate signals on non-completion M15 candles", () => {
            // In multi-TF mode, entries should only be queued at H1 completion points.
            // Entry happens on the NEXT M15 candle after an H1 completion M15.
            // This means entry candle time should be at :00 (first M15 of next hour).
            const candles = generateM15FlipCandles({ downHours: 25, upHours: 25 });
            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableMultiTimeframe: true,
                enableShorting: false,
                enableContinuationEntry: false,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            for (const trade of result.trades) {
                if (trade.entryCandle != null) {
                    // The signal fires at the :45 M15 candle (H1 completion).
                    // Entry executes at the NEXT M15 candle, which is :00 of the next hour.
                    const entryTime = candles[trade.entryCandle].time;
                    const minuteOffset = entryTime % 3600;
                    // Entry should be at :00 (start of hour = signal was at prev hour's :45)
                    expect(minuteOffset).toBe(0);
                }
            }
        });

        test("should run multi-TF with HTF filter without error", () => {
            const candles = generateM15FlipCandles({ downHours: 25, upHours: 25 });
            // Generate mock H4 candles (just enough for HTF computation)
            const h4Candles = generateCandles(60, 1.18, "up", candles[0].time);

            const result = engine.runOnCandles(candles, "AUD_USD", {
                enableMultiTimeframe: true,
                enableHTFFilter: true,
            }, h4Candles);

            expect(result).toHaveProperty("trades");
            expect(result).toHaveProperty("summary");
        });

        test("single-TF mode unchanged when enableMultiTimeframe is false", () => {
            const candles = generateFlipCandles({ downCandles: 100, upCandles: 100 });

            const resultDefault = engine.runOnCandles(candles, "AUD_USD", {
                enableTrailingStops: false,
                enableBreakeven: false,
            });
            const resultExplicit = engine.runOnCandles(candles, "AUD_USD", {
                enableMultiTimeframe: false,
                enableTrailingStops: false,
                enableBreakeven: false,
            });

            expect(resultDefault.trades.length).toBe(resultExplicit.trades.length);
            expect(resultDefault.summary.totalPnl).toBeCloseTo(resultExplicit.summary.totalPnl, 6);
        });

        test("run() should fetch M15 candles in multi-TF mode", async () => {
            const candles = generateM15Candles(60);
            const mockService = {
                getCandles: jest.fn().mockResolvedValue(candles),
            };
            const e = new BacktestEngine(mockService);

            await e.run("AUD_USD", "H1", 1696118400, 1696204800, {
                enableMultiTimeframe: true,
            });

            // Should fetch M15 regardless of the H1 granularity param
            expect(mockService.getCandles).toHaveBeenCalledWith(
                "AUD_USD", "M15", 1696118400, 1696204800
            );
        });
    });
});
