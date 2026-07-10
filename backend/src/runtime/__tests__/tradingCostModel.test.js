const {
    calculatePaperNetPnl,
    countRolloverDayWeights,
} = require("../tradingCostModel");

describe("paper trading cost model", () => {
    test("counts the configured Wednesday rollover as three financing days", () => {
        const entry = Date.UTC(2026, 6, 8, 20, 0, 0); // Wednesday
        const exit = Date.UTC(2026, 6, 8, 22, 0, 0);
        expect(
            countRolloverDayWeights({
                entryTime: entry,
                exitTime: exit,
                cutoffHourUtc: 21,
                tripleRolloverWeekday: 3,
            })
        ).toBe(3);
    });

    test("attributes spread/slippage and applies commission/financing once", () => {
        const entryTime = Date.UTC(2026, 6, 8, 20, 0, 0);
        const exitTime = Date.UTC(2026, 6, 8, 22, 0, 0);
        const costs = calculatePaperNetPnl({
            trade: {
                instrument: "EUR_USD",
                side: "BUY",
                units: 100_000,
                entryTime,
                entryNotionalAud: 160_000,
            },
            config: {
                paperCommissionPerMillionAud: 25,
                paperFinancingRates: {
                    EUR_USD: { longRateAnnual: -0.0365 },
                },
            },
            fillPnlAud: 100,
            pipValue: 0.0001,
            entryQuoteToAudRate: 1.5,
            exitQuoteToAudRate: 1.5,
            entrySpreadPips: 1,
            exitSpreadPips: 1,
            entrySlippagePips: 0.25,
            exitSlippagePips: 0.25,
            exitTime,
        });

        expect(costs.spreadCostAud).toBeCloseTo(15, 8);
        expect(costs.slippageCostAud).toBeCloseTo(7.5, 8);
        expect(costs.commissionAud).toBeCloseTo(8, 8);
        expect(costs.financingAud).toBeCloseTo(-48, 8);
        expect(costs.pnlAud).toBeCloseTo(44, 8);
        expect(costs.grossPnlAud - costs.totalCostAud).toBeCloseTo(
            costs.pnlAud,
            8
        );
        expect(costs.financingStatus).toBe("MODELED");
        expect(costs.financingMode).toBe("MODELED");
    });

    test("marks overnight financing unmodelled instead of silently treating zero as complete", () => {
        const costs = calculatePaperNetPnl({
            trade: {
                instrument: "EUR_USD",
                side: "BUY",
                units: 1000,
                entryTime: Date.UTC(2026, 6, 7, 20),
                entryNotionalAud: 1600,
            },
            config: {},
            fillPnlAud: 10,
            pipValue: 0.0001,
            entryQuoteToAudRate: 1.5,
            exitQuoteToAudRate: 1.5,
            entrySpreadPips: 1,
            exitSpreadPips: 1,
            exitTime: Date.UTC(2026, 6, 7, 22),
        });

        expect(costs.financingAud).toBe(0);
        expect(costs.financingMode).toBe("UNMODELED");
        expect(costs.financingStatus).toBe(
            "UNMODELED_MISSING_FINANCING_RATE"
        );
    });

    test("uses OANDA's per-weekday financing schedule", () => {
        expect(
            countRolloverDayWeights({
                entryTime: Date.UTC(2026, 6, 8, 20),
                exitTime: Date.UTC(2026, 6, 8, 22),
                cutoffHourUtc: 21,
                financingDaysOfWeek: [
                    { dayOfWeek: "WEDNESDAY", daysCharged: 2 },
                ],
            })
        ).toBe(2);
    });

    test("uses the 17:00 New York cutoff across daylight-saving changes", () => {
        expect(
            countRolloverDayWeights({
                entryTime: Date.UTC(2026, 6, 8, 20, 30),
                exitTime: Date.UTC(2026, 6, 8, 21, 30),
                cutoffTimeZone: "America/New_York",
                cutoffLocalHour: 17,
            })
        ).toBe(3);
        expect(
            countRolloverDayWeights({
                entryTime: Date.UTC(2026, 0, 7, 21, 30),
                exitTime: Date.UTC(2026, 0, 7, 22, 30),
                cutoffTimeZone: "America/New_York",
                cutoffLocalHour: 17,
            })
        ).toBe(3);
    });

    test("does not add separate weekend financing on top of triple rollover", () => {
        expect(
            countRolloverDayWeights({
                entryTime: Date.UTC(2026, 6, 10, 20), // Friday
                exitTime: Date.UTC(2026, 6, 12, 22), // Sunday
                cutoffTimeZone: "America/New_York",
                cutoffLocalHour: 17,
            })
        ).toBe(1);
    });
});
