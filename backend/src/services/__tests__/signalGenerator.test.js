const SignalGenerator = require("../signalGenerator");

describe("live SignalGenerator", () => {
    let generator;

    beforeEach(() => {
        generator = new SignalGenerator({
            strategy: "carry_trend",
            timeframe: "4h",
            assets: ["AUD_USD"],
            signalCooldown: 60_000,
        });
    });

    afterEach(() => generator.stop());

    test("defaults to the sole live strategy", () => {
        const defaultGenerator = new SignalGenerator();
        expect(defaultGenerator.config).toEqual(
            expect.objectContaining({
                strategy: "carry_trend",
                timeframe: "4h",
            })
        );
    });

    test("returns a structured warm-up signal when history is unavailable", async () => {
        const signal = await generator.generateSignal(
            "AUD_USD",
            [{ time: "2026-08-04T00:00:00Z", close: 0.65 }],
            0.65,
            { marketContext: { timeframes: { "4h": { candles: [] }, "1d": { candles: [] } } } }
        );

        expect(signal).toEqual(
            expect.objectContaining({
                symbol: "AUD_USD",
                signal: "HOLD",
                strategy: "carry_trend",
                strategyVersion: "1.0.0",
                timeframe: "4h",
            })
        );
        expect(signal.reasonCode).toMatch(/INSUFFICIENT_DATA|CARRY_TREND_WARMUP/);
    });

    test("preserves live strategy context and an explicit trade plan", () => {
        const strategyContext = {
            family: "carry_trend",
            daily: { momentum: 0.04 },
            financing: { longRateAnnual: 0.012, shortRateAnnual: -0.02 },
        };
        const tradePlan = { stopLossPrice: 0.635, takeProfitPrice: null };
        const signal = generator.buildSignal(
            "AUD_USD",
            {
                signalType: "BUY",
                reason: "Fresh breakout",
                reasonCode: "CARRY_TREND_LONG_ENTRY",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "CARRY_TREND_BREAKOUT",
                signalCandleTime: "2026-08-04T00:00:00Z",
                atrVal: 0.006,
                atrPips: 60,
                adxVal: 42,
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
    });

    test("suppresses a duplicate live action from the same completed candle", () => {
        const signal = {
            symbol: "AUD_USD",
            signal: "BUY",
            intent: "ENTER_LONG",
            entryType: "CARRY_TREND_BREAKOUT",
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
