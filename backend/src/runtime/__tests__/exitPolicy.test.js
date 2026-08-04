const {
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    resolveBreakevenDistance,
    resolveOwnerRunExitPolicy,
    resolveTimedExitReason,
    resolveTrailingStopDistances,
} = require("../exitPolicy");

describe("carry-trend owner exit policy", () => {
    test("persists the opening live run's exit rules", () => {
        const persisted = buildOwnerRunExitPolicy({
            strategy: "carry_trend",
            ownerRunId: "live-owner-1",
            config: {
                breakevenTriggerRiskMultiple: 1,
                trailingStopActivationRiskMultiple: 2,
                trailingStopRiskMultiple: 1.5,
            },
        });
        const trade = {
            strategy: "carry_trend",
            brokerReconciliationPayload: { ownerExitPolicy: persisted },
        };

        expect(resolveOwnerRunExitPolicy(trade, {})).toEqual(persisted);
    });

    test("moves to breakeven after one initial risk distance", () => {
        const trade = { strategy: "carry_trend", entryPrice: 1.1 };
        const policy = buildOwnerRunExitPolicy({
            strategy: "carry_trend",
            config: { breakevenTriggerRiskMultiple: 1 },
        });
        expect(
            resolveBreakevenDistance({
                trade,
                policy,
                pipValue: 0.0001,
                runtimeMetadata: { initialStopDistance: 0.002 },
            })
        ).toBeCloseTo(0.002, 8);
    });

    test("activates the monotonic trail at two risk with 1.5 risk distance", () => {
        const trade = { strategy: "carry_trend", entryPrice: 1.1 };
        const policy = buildOwnerRunExitPolicy({
            strategy: "carry_trend",
            config: {
                trailingStopActivationRiskMultiple: 2,
                trailingStopRiskMultiple: 1.5,
            },
        });
        expect(
            resolveTrailingStopDistances({
                trade,
                policy,
                pipValue: 0.0001,
                runtimeMetadata: { initialStopDistance: 0.002 },
            })
        ).toEqual({
            activationDistance: expect.closeTo(0.004, 8),
            trailDistance: expect.closeTo(0.003, 8),
        });
    });

    test("supports a code-owned time stop but keeps this release disabled", () => {
        const entryTime = Date.UTC(2026, 6, 10, 0, 0, 0);
        const trade = { strategy: "carry_trend", entryTime };
        expect(
            resolveTimedExitReason({
                trade,
                policy: buildOwnerRunExitPolicy({
                    strategy: "carry_trend",
                    config: { timeStopHours: 0 },
                }),
                now: entryTime + 48 * 60 * 60 * 1000,
            })
        ).toBeNull();
        expect(
            resolveTimedExitReason({
                trade,
                policy: buildOwnerRunExitPolicy({
                    strategy: "carry_trend",
                    config: { timeStopHours: 24 },
                }),
                now: entryTime + 24 * 60 * 60 * 1000,
            })
        ).toBe("TIME_STOP");
    });

    test("never weakens an active long or short stop", () => {
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
