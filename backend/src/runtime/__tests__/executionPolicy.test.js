const {
    calculateCanonicalPositionSize,
    resolveCanonicalTradePlan,
} = require("../executionPolicy");

describe("canonical execution policy", () => {
    const structuralSignal = {
        signal: "SELL", currentPrice: 0.7, atrPips: 50,
        tradePlan: { stopPriceMode: "STRUCTURAL", structuralStopLossPrice: 0.701,
            stopPips: 1, stopLossPrice: 0.8, targetRiskMultiple: 1.5 },
    };

    test("structural SELL preserves its absolute anchor across quote movement", () => {
        const plan = resolveCanonicalTradePlan({ signal: structuralSignal,
            config: { minStopLossPips: 6 }, entryPrice: 0.6998, pipValue: 0.0001 });
        expect(plan).toMatchObject({ stopPriceMode: "STRUCTURAL", stopLossPrice: 0.701,
            structuralStopLossPrice: 0.701, source: "SIGNAL_STRUCTURAL_STOP", floored: false });
        expect(plan.stopLossPips).toBeCloseTo(12);
        expect(plan.takeProfitPrice).toBeCloseTo(0.698);
    });

    test("minimum floor may widen before submission but fill recovery preserves the submitted stop", () => {
        const signal = { ...structuralSignal, tradePlan: { ...structuralSignal.tradePlan, structuralStopLossPrice: 0.7003 } };
        const before = resolveCanonicalTradePlan({ signal, config: { minStopLossPips: 6 }, pipValue: 0.0001 });
        expect(before.stopLossPrice).toBeCloseTo(0.7006);
        expect(before.floored).toBe(true);
        const filled = resolveCanonicalTradePlan({ signal, config: { minStopLossPips: 6 },
            entryPrice: 0.7001, pipValue: 0.0001, submittedStopLossPrice: before.stopLossPrice });
        expect(filled.stopLossPrice).toBe(before.stopLossPrice);
        expect(filled.stopLossPips).toBeCloseTo(5);
        expect(filled.takeProfitPrice).toBeCloseTo(0.69935);
    });

    test.each([
        { structuralStopLossPrice: undefined }, { structuralStopLossPrice: null },
        { structuralStopLossPrice: 0 }, { structuralStopLossPrice: 0.6999 },
        { structuralStopLossPrice: 0.7 }, { structuralStopLossPrice: "invalid" },
        { stopPriceMode: "ATR" }, { stopPriceMode: undefined }, { targetRiskMultiple: null },
    ])("invalid structural contract never falls back to ATR: %j", (change) => {
        expect(resolveCanonicalTradePlan({ signal: { ...structuralSignal,
            tradePlan: { ...structuralSignal.tradePlan, ...change } },
            config: { minStopLossPips: 6 }, pipValue: 0.0001 })).toBeNull();
    });

    test("structural mode is SELL-only and recovered stop cannot move inside its anchor", () => {
        expect(resolveCanonicalTradePlan({ signal: { ...structuralSignal, signal: "BUY" },
            pipValue: 0.0001 })).toBeNull();
        expect(resolveCanonicalTradePlan({ signal: structuralSignal, pipValue: 0.0001,
            submittedStopLossPrice: 0.7009 })).toBeNull();
    });

    test("uses the same ATR fallback and minimum stop floor", () => {
        const plan = resolveCanonicalTradePlan({
            signal: {
                symbol: "EUR_USD",
                signal: "BUY",
                currentPrice: 1.1,
                atrPips: 4,
            },
            config: {
                stopLossType: "ATR",
                stopLossAtrMultiplier: 2,
                stopLossPips: 30,
                minStopLossPips: 15,
            },
            pipValue: 0.0001,
        });

        expect(plan.source).toBe("GLOBAL_CONFIG");
        expect(plan.stopLossPips).toBe(15);
        expect(plan.stopLossPrice).toBeCloseTo(1.0985, 8);
    });

    test("re-centers a relative strategy plan on the executable quote", () => {
        const plan = resolveCanonicalTradePlan({
            signal: {
                signal: "BUY",
                tradePlan: {
                    stopLossPrice: 1.0994,
                    stopPips: 6,
                    takeProfitPrice: 1.1009,
                    targetRiskMultiple: 1.5,
                },
            },
            config: { minStopLossPips: 6 },
            entryPrice: 1.1002,
            pipValue: 0.0001,
        });

        expect(plan.source).toBe("SIGNAL_TRADE_PLAN_DISTANCE");
        expect(plan.stopLossPrice).toBeCloseTo(1.0996, 8);
        expect(plan.takeProfitPrice).toBeCloseTo(1.1011, 8);
        expect(plan.stopLossPips).toBe(6);
    });

    test("floors a valid strategy stop without accepting an invalid TP", () => {
        const plan = resolveCanonicalTradePlan({
            signal: {
                symbol: "EUR_USD",
                signal: "SELL",
                currentPrice: 1.1,
                tradePlan: {
                    stopLossPrice: 1.1005,
                    takeProfitPrice: 1.101,
                },
            },
            config: { minStopLossPips: 15 },
            pipValue: 0.0001,
        });

        expect(plan.source).toBe("SIGNAL_TRADE_PLAN");
        expect(plan.floored).toBe(true);
        expect(plan.stopLossPrice).toBeCloseTo(1.1015, 8);
        expect(plan.takeProfitPrice).toBeNull();
    });

    test("applies the entry-type multiplier to the AUD risk budget", () => {
        const result = calculateCanonicalPositionSize({
            config: {
                positionSizeMethod: "RISK",
                riskPerTrade: 0.01,
                freshFlipRiskMultiplier: 0.5,
                maxCapitalAtRisk: 1_000,
                marginBuffer: 0,
                leverage: 20,
            },
            signal: {
                entryType: "FRESH_FLIP",
            },
            entryPrice: 1.1,
            stopLossPrice: 1.09,
            equityAud: 10_000,
            marginAvailableAud: 10_000,
            baseToAudRate: 1.6,
            quoteToAudRate: 1.5,
        });

        expect(result.valid).toBe(true);
        expect(result.riskBudgetAud).toBe(5);
        expect(result.riskPerUnitAud).toBeCloseTo(0.015, 8);
        expect(result.units).toBe(333);
        expect(result.multipliers).toEqual({
            freshFlip: 0.5,
            combined: 0.5,
        });
    });

    test("fails closed when an AUD conversion input is missing", () => {
        const result = calculateCanonicalPositionSize({
            config: { positionSizeMethod: "RISK" },
            signal: {},
            entryPrice: 1.1,
            stopLossPrice: 1.09,
            equityAud: 10_000,
            marginAvailableAud: 10_000,
            baseToAudRate: null,
            quoteToAudRate: 1.5,
        });

        expect(result).toEqual(
            expect.objectContaining({
                valid: false,
                units: 0,
                code: "INVALID_SIZING_INPUT",
            })
        );
    });

    test("caps fixed sizing by safe available margin", () => {
        const result = calculateCanonicalPositionSize({
            config: {
                positionSizeMethod: "FIXED",
                fixedPositionUnits: 10_000,
                marginBuffer: 0.2,
                leverage: 10,
            },
            signal: {},
            entryPrice: 1.1,
            stopLossPrice: 1.09,
            equityAud: 100,
            marginAvailableAud: 100,
            baseToAudRate: 2,
            quoteToAudRate: 1.5,
        });

        expect(result.units).toBe(400);
        expect(result.marginRequiredAud).toBe(80);
    });
});
