const {
    calculateCanonicalPositionSize,
    resolveCanonicalTradePlan,
} = require("../executionPolicy");

describe("canonical execution policy", () => {
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
