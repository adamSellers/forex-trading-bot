const {
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    resolveBreakevenDistance,
    resolveOwnerRunExitPolicy,
    resolveTimedExitReason,
    resolveTrailingStopDistances,
} = require("../exitPolicy");

describe("owner-run exit policy", () => {
    test("persists and resolves the owning run instead of the current config", () => {
        const persisted = buildOwnerRunExitPolicy({
            strategy: "mean_reversion",
            ownerRunId: "owner-1",
            config: {
                timeStopHours: 8,
                breakevenAtTpPercent: 0.5,
            },
        });
        const trade = {
            strategy: "mean_reversion",
            brokerReconciliationPayload: { ownerExitPolicy: persisted },
        };

        expect(
            resolveOwnerRunExitPolicy(trade, { timeStopHours: 1 })
        ).toEqual(persisted);
    });

    test("uses strategy-specific mean-reversion breakeven distance", () => {
        const trade = {
            strategy: "mean_reversion",
            entryPrice: 1.1,
            takeProfitPrice: 1.104,
        };
        const policy = buildOwnerRunExitPolicy({
            strategy: trade.strategy,
            config: { breakevenAtTpPercent: 0.5 },
        });
        expect(
            resolveBreakevenDistance({ trade, policy, pipValue: 0.0001 })
        ).toBeCloseTo(0.002, 8);
    });

    test("uses range-specific trailing activation and distance", () => {
        const trade = {
            strategy: "range_breakout",
            entryPrice: 1.1,
            takeProfitPrice: 1.103,
        };
        const policy = buildOwnerRunExitPolicy({
            strategy: trade.strategy,
            config: {
                tpRangeMultiplier: 1.5,
                trailActivationMultiplier: 1,
                trailDistanceMultiplier: 0.5,
            },
        });
        expect(
            resolveTrailingStopDistances({ trade, policy, pipValue: 0.0001 })
        ).toEqual({
            activationDistance: expect.closeTo(0.002, 8),
            trailDistance: expect.closeTo(0.001, 8),
        });
    });

    test("session close is calculated from entry, not today's global clock", () => {
        const entryTime = Date.UTC(2026, 6, 10, 17, 0, 0);
        const policy = buildOwnerRunExitPolicy({
            strategy: "range_breakout",
            config: { sessionCloseHourUTC: 16 },
        });
        const trade = { strategy: "range_breakout", entryTime };

        expect(
            resolveTimedExitReason({
                trade,
                policy,
                now: Date.UTC(2026, 6, 11, 15, 59, 0),
            })
        ).toBeNull();
        expect(
            resolveTimedExitReason({
                trade,
                policy,
                now: Date.UTC(2026, 6, 11, 16, 0, 0),
            })
        ).toBe("SESSION_CLOSE");
    });

    test("never weakens an already active breakeven or trailing stop", () => {
        expect(
            calculateMonotonicStop({
                trade: { side: "BUY", stopLossPrice: 1.1 },
                currentPrice: 1.101,
                trailDistance: 0.002,
            })
        ).toBeNull();
        expect(
            calculateMonotonicStop({
                trade: { side: "SELL", stopLossPrice: 1.1 },
                currentPrice: 1.099,
                trailDistance: 0.002,
            })
        ).toBeNull();
    });
});
