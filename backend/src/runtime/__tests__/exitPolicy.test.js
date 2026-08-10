const {
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    resolveBreakevenDistance,
    resolveOwnerRunExitPolicy,
    resolveTimedExitReason,
    resolveTrailingStopDistances,
} = require("../exitPolicy");

describe("intraday owner exit policy", () => {
    test("persists the opening live run's exit rules", () => {
        const persisted = buildOwnerRunExitPolicy({
            strategy: "intraday_momentum",
            ownerRunId: "live-owner-1",
            config: {
                breakevenTriggerRiskMultiple: 1,
                trailingStopActivationRiskMultiple: 2,
                trailingStopRiskMultiple: 1.5,
            },
        });
        const trade = {
            strategy: "intraday_momentum",
            brokerReconciliationPayload: { ownerExitPolicy: persisted },
        };

        expect(resolveOwnerRunExitPolicy(trade, {})).toEqual(persisted);
    });

    test("moves to breakeven after one initial risk distance", () => {
        const trade = { strategy: "intraday_momentum", entryPrice: 1.1 };
        const policy = buildOwnerRunExitPolicy({
            strategy: "intraday_momentum",
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
        const trade = { strategy: "intraday_momentum", entryPrice: 1.1 };
        const policy = buildOwnerRunExitPolicy({
            strategy: "intraday_momentum",
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

    test("supports the code-owned intraday time stop", () => {
        const entryTime = Date.UTC(2026, 6, 10, 0, 0, 0);
        const trade = { strategy: "intraday_momentum", entryTime };
        expect(
            resolveTimedExitReason({
                trade,
                policy: buildOwnerRunExitPolicy({
                    strategy: "intraday_momentum",
                    config: { timeStopHours: 0 },
                }),
                now: entryTime + 48 * 60 * 60 * 1000,
            })
        ).toBeNull();
        expect(
            resolveTimedExitReason({
                trade,
                policy: buildOwnerRunExitPolicy({
                    strategy: "intraday_momentum",
                    config: { timeStopHours: 24 },
                }),
                now: entryTime + 24 * 60 * 60 * 1000,
            })
        ).toBe("TIME_STOP");
    });

    test("closes before the New York rollover across daylight-saving time", () => {
        const policy = buildOwnerRunExitPolicy({
            strategy: "intraday_momentum",
            config: {
                timeStopHours: 6,
                sessionCloseTimeZone: "America/New_York",
                sessionCloseLocalHour: 16,
                sessionCloseLocalMinute: 45,
                sessionCloseWindowMinutes: 30,
            },
        });
        const trade = {
            strategy: "intraday_momentum",
            entryTime: Date.parse("2026-08-10T18:00:00.000Z"),
        };

        expect(
            resolveTimedExitReason({
                trade,
                policy,
                now: Date.parse("2026-08-10T20:44:00.000Z"),
            })
        ).toBeNull();
        expect(
            resolveTimedExitReason({
                trade,
                policy,
                now: Date.parse("2026-08-10T20:45:00.000Z"),
            })
        ).toBe("SESSION_CLOSE");
        expect(
            resolveTimedExitReason({
                trade: {
                    ...trade,
                    entryTime: Date.parse("2026-01-12T19:00:00.000Z"),
                },
                policy,
                now: Date.parse("2026-01-12T21:45:00.000Z"),
            })
        ).toBe("SESSION_CLOSE");
        expect(
            resolveTimedExitReason({
                trade: {
                    ...trade,
                    entryTime: Date.parse("2026-08-10T22:00:00.000Z"),
                },
                policy,
                now: Date.parse("2026-08-10T22:15:00.000Z"),
            })
        ).toBeNull();
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
