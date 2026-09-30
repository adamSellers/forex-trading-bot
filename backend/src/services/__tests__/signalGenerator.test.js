const SignalGenerator = require("../signalGenerator");

describe("live SignalGenerator", () => {
    let generator;

    beforeEach(() => {
        generator = new SignalGenerator({
            strategy: "intraday_momentum",
            timeframe: "15m",
            assets: ["AUD_USD"],
            signalCooldown: 60_000,
        });
    });

    afterEach(() => generator.stop());

    test("defaults to the sole live strategy", () => {
        const defaultGenerator = new SignalGenerator();
        expect(defaultGenerator.config).toEqual(
            expect.objectContaining({
                strategy: "intraday_momentum",
                timeframe: "15m",
            })
        );
    });

    test("returns a structured warm-up signal when history is unavailable", async () => {
        const signal = await generator.generateSignal(
            "AUD_USD",
            [{ time: "2026-08-04T00:00:00Z", close: 0.65 }],
            0.65,
            { marketContext: { timeframes: { "15m": { candles: [] }, "1h": { candles: [] } } } }
        );

        expect(signal).toEqual(
            expect.objectContaining({
                symbol: "AUD_USD",
                signal: "HOLD",
                strategy: "intraday_momentum",
                strategyVersion: "1.3.0",
                timeframe: "15m",
            })
        );
        expect(signal.reasonCode).toMatch(/INSUFFICIENT_DATA|INTRADAY_MOMENTUM_WARMUP/);
    });

    test("preserves live strategy context and an explicit trade plan", () => {
        const strategyContext = {
            family: "intraday_momentum",
            h1: { adx: 28, longRegime: true },
            m15: { rsi: 58 },
        };
        const tradePlan = { stopLossPrice: 0.635, takeProfitPrice: null };
        const signal = generator.buildSignal(
            "AUD_USD",
            {
                signalType: "BUY",
                reason: "Fresh M15 breakout",
                reasonCode: "INTRADAY_MOMENTUM_LONG_ENTRY",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "M15_RANGE_BREAKOUT",
                signalCandleTime: "2026-08-04T00:00:00Z",
                atrVal: 0.006,
                atrPips: 60,
                adxVal: 42,
                rsiVal: 58,
                currentDir: 1,
                tradePlan,
                strategyContext,
            },
            { version: "1.0.0" },
            0.65
        );

        expect(signal).toEqual(
            expect.objectContaining({
                signal: "BUY",
                intent: "ENTER_LONG",
                tradePlan,
                strategyContext,
            })
        );
        expect(signal.decisionContext.strategyContext).toBe(strategyContext);
        expect(signal.decisionContext.rsi).toBe(58);
        expect(signal.trend.rsi).toBe(58);
        expect(signal.data.rsi).toBe(58);
    });

    test("passes durable pair history to the strategy without changing its meaning", async () => {
        const strategy = require("../../strategies").getStrategyDefinition("intraday_momentum");
        const latestClosedTrade = { id: "normal-tp-1", exitTime: 1788760000000 };
        const lossResetDecisions = { SELL: { allowed: false, classification: "WAIT_FOR_H1_RESET" } };
        const lossResetTrades = [latestClosedTrade];
        const ownedOpenTrade = { side: "BUY", isOpen: true, entryType: "M15_RANGE_BREAKOUT" };
        const evaluate = jest.spyOn(strategy, "evaluateEntry").mockReturnValue({
            signalType: "HOLD", signalCandleTime: 1788760800000,
        });
        try {
            await generator.generateSignal("AUD_USD", [{}, {}], 0.65, {
                latestClosedTrade, reentryHistoryAvailable: false, lossResetDecisions, lossResetTrades, ownedOpenTrade, nowMs: 1788760800000,
            });
            expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
                latestClosedTrade, reentryHistoryAvailable: false, lossResetDecisions, lossResetTrades, ownedOpenTrade,
            }));
        } finally {
            evaluate.mockRestore();
        }
    });

    test("fade setup identity includes its TP episode while normal setup identity stays stable", () => {
        const evaluation = {
            signalType: "BUY", entryType: "M15_POST_TP_FADE",
            signalCandleTime: 1788760800000,
            strategyContext: { reentry: { anchor: { tradeId: "normal-tp-1" } } },
        };
        const first = generator.buildSignal("AUD_USD", evaluation, { version: "1.2.0" }, 0.65);
        const second = generator.buildSignal("AUD_USD", {
            ...evaluation,
            strategyContext: { reentry: { anchor: { tradeId: "normal-tp-2" } } },
        }, { version: "1.2.0" }, 0.65);
        expect(first.setupId).toBe("AUD_USD:LONG:1788760800000:M15_POST_TP_FADE:normal-tp-1");
        expect(second.setupId).not.toBe(first.setupId);
        const normal = generator.buildSignal("AUD_USD", {
            ...evaluation, entryType: "M15_RANGE_BREAKOUT",
        }, { version: "1.2.0" }, 0.65);
        expect(normal.setupId).toBe("AUD_USD:LONG:1788760800000:M15_RANGE_BREAKOUT");
    });

    test.each([[0, 0], [null, null], [undefined, null], [NaN, null]])(
        "keeps RSI %s distinct from unavailable RSI", (rsiVal, expected) => {
            const signal = generator.buildSignal("AUD_USD", {
                rsiVal, signalCandleTime: 1788760800000,
            }, { version: "1.2.0" }, 0.65);
            expect(signal.decisionContext.rsi).toBe(expected);
            expect(signal.trend.rsi).toBe(expected);
            expect(signal.data.rsi).toBe(expected);
        }
    );

    test("suppresses a duplicate live action from the same completed candle", () => {
        const signal = {
            symbol: "AUD_USD",
            signal: "BUY",
            intent: "ENTER_LONG",
            entryType: "M15_RANGE_BREAKOUT",
            signalCandleTime: 1_775_260_800_000,
        };

        expect(generator.validateSignal(signal).signal).toBe("BUY");
        expect(generator.validateSignal(signal)).toEqual(
            expect.objectContaining({
                signal: "COOLDOWN",
                reasonCode: "COOLDOWN_DUPLICATE_CANDLE",
                cooldownSuppressed: true,
            })
        );
    });

    test("publishes a live cycle and persists its signals", async () => {
        const repository = { saveBatch: jest.fn().mockResolvedValue(undefined) };
        generator.signalRepo = repository;
        generator.generateAllSignals = jest.fn().mockResolvedValue([
            { symbol: "AUD_USD", signal: "HOLD" },
        ]);
        generator.dataService = {};
        const listener = jest.fn();
        generator.on("allSignalsGenerated", listener);

        await generator.generateSignalCycle();

        expect(repository.saveBatch).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith([
            { symbol: "AUD_USD", signal: "HOLD" },
        ]);
    });
});
