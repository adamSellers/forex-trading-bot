const {
    buildOwnerRunExitPolicy,
    calculateMonotonicStop,
    resolveBreakevenDistance,
    isH4ChannelExitPolicy,
    resolveEntryExitWindowReason,
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

describe("H4 channel owner exit policy", () => {
    const config = {
        strategy: "multi_day_trend",
        liveReleaseVersion: "h4-channel-v1",
        executionPolicyVersion: "h4-channel-risk-v1",
        trendExitBars: 10,
        // Retained global fields cannot restore the intraday policy.
        timeStopHours: 6,
        enableBreakeven: true,
        enableTakeProfit: true,
        sessionCloseTimeZone: "America/New_York",
        sessionCloseLocalHour: 16,
        sessionCloseLocalMinute: 45,
        sessionCloseWindowMinutes: 30,
    };
    const policy = () => buildOwnerRunExitPolicy({ config, ownerRunId: "channel-owner" });

    test("captures a distinct immutable owner contract without targets, breakeven or an intraday deadline", () => {
        const openingConfig = { ...config };
        const saved = buildOwnerRunExitPolicy({ config: openingConfig, ownerRunId: "channel-owner" });
        openingConfig.trendExitBars = 3;
        expect(saved).toMatchObject({ version: 2, kind: "H4_CHANNEL", ownerRunId: "channel-owner",
            config: { trendExitBars: 10, enableChannelTrailing: true, channelTrailTimeframe: "4h",
                enableTakeProfit: false, enableBreakeven: false, enableTrailingStops: false, timeStopHours: 0 } });
        expect(resolveOwnerRunExitPolicy({ ownerExitPolicy: saved }, { strategy: "intraday_momentum" })).toBe(saved);
        expect(resolveBreakevenDistance({ policy: saved })).toBeNull();
    });

    test.each(["2026-08-10T20:45:00Z", "2026-08-11T22:00:00Z", "2026-01-12T21:45:00Z"])(
        "holds across weekday rollover and the old six-hour deadline at %s", (time) => {
            expect(resolveTimedExitReason({ trade: { entryTime: Date.parse(time) - 48 * 3_600_000 },
                policy: policy(), now: Date.parse(time) })).toBeNull();
        });

    test.each([
        ["2026-08-14T20:44:59Z", null], ["2026-08-14T20:45:00Z", "WEEKEND_CLOSE"],
        ["2026-01-09T21:44:59Z", null], ["2026-01-09T21:45:00Z", "WEEKEND_CLOSE"],
        ["2026-08-15T12:00:00Z", "WEEKEND_CLOSE"],
        ["2026-03-08T21:04:59Z", "WEEKEND_CLOSE"], ["2026-03-08T21:05:00Z", null],
        ["2026-11-01T22:04:59Z", "WEEKEND_CLOSE"], ["2026-11-01T22:05:00Z", null],
    ])("Friday flatten and entry embargo match New York DST at %s", (time, reason) => {
        const now = Date.parse(time);
        expect(resolveTimedExitReason({ policy: policy(), now })).toBe(reason);
        expect(resolveEntryExitWindowReason({ policy: config, now })).toBe(reason);
    });

    test("persisted v6 owners retain their daily close and one-R breakeven under the new selection", () => {
        const legacy = buildOwnerRunExitPolicy({ strategy: "intraday_momentum", config: {
            ...config, strategy: "intraday_momentum", liveReleaseVersion: "m15-intraday-v6",
            executionPolicyVersion: "intraday-risk-v6", breakevenTriggerRiskMultiple: 1,
        } });
        const resolved = resolveOwnerRunExitPolicy({ ownerExitPolicy: legacy }, config);
        expect(resolved).toBe(legacy);
        expect(isH4ChannelExitPolicy(resolved)).toBe(false);
        expect(resolveTimedExitReason({ policy: resolved, trade: { entryTime: Date.parse("2026-08-10T18:00:00Z") },
            now: Date.parse("2026-08-10T20:45:00Z") })).toBe("SESSION_CLOSE");
        expect(resolveBreakevenDistance({ policy: resolved, runtimeMetadata: { initialStopDistance: 0.001 } }))
            .toBeCloseTo(0.001);
    });

    test("a legacy trade missing its snapshot cannot inherit the selected channel exits", () => {
        const resolved = resolveOwnerRunExitPolicy({ strategy: "intraday_momentum", entryTime: 1 }, config);
        expect(isH4ChannelExitPolicy(resolved)).toBe(false);
        expect(resolved.config).toMatchObject({ timeStopHours: 6, enableBreakeven: true, breakevenTriggerRiskMultiple: 1 });
    });
});
