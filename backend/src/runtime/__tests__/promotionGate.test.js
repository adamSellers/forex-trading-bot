const {
    DEFAULT_PROMOTION_GATE_OPTIONS,
    evaluatePromotionGate,
    resolveRequiredSides,
} = require("../promotionGate");

const DAY_MS = 86400000;
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0);

function buildTrades(count = 120, overrides = {}) {
    return Array.from({ length: count }, (_, index) => {
        const winning = index % 4 !== 0;
        const dayOffset = index % 40;
        const london = index % 2 === 0;
        const timestamp =
            NOW - (40 - dayOffset) * DAY_MS + (london ? 8 : 13) * 3600000;
        return {
            id: `trade-${index}`,
            instrument: london ? "EUR_USD" : "GBP_USD",
            side: "BUY",
            pnlAud: winning ? 2 : -1,
            pnlPips: winning ? 10 : -5,
            entryTime: timestamp,
            exitTime: timestamp + 3600000,
            isOpen: false,
            configHash: "config-1",
            brokerReconciliationPayload: {
                paperRuntime: {
                    volatilityRegime: index % 3 === 0 ? "high" : "normal",
                    commissionStatus: "MODELED",
                    spreadStatus: "MODELED",
                    slippageStatus: "MODELED",
                    financingMode: "NOT_APPLICABLE",
                    financingStatus: "NO_ROLLOVER",
                    costModelVersion: 1,
                },
            },
            ...overrides,
        };
    });
}

function buildContext(overrides = {}) {
    const trades = overrides.trades || buildTrades();
    const run = {
        runId: "candidate-1",
        strategy: "timesfm_directional",
        configHash: "config-1",
        startedAt: NOW - 40 * DAY_MS,
        configSnapshot: {
            strategy: "timesfm_directional",
            enableShorting: false,
            paperStartingBalanceAud: 10000,
            executionPolicyVersion: "unified-execution-v1",
        },
        metadata: {},
        ...(overrides.run || {}),
    };
    return {
        analytics: {},
        run,
        trades,
        matchedShadowEvidence: {
            passed: true,
            closedTrades: 80,
            overlapDays: 30,
            candidateNetExpectancyAud: 1.25,
            shadowNetExpectancyAud: 0.2,
            ...(overrides.matchedShadowEvidence || {}),
        },
        executionParity: {
            passed: true,
            configHash: "config-1",
            executionPolicyVersion: "unified-execution-v1",
            ...(overrides.executionParity || {}),
        },
        now: NOW,
        options: overrides.options || {},
    };
}

describe("promotionGate", () => {
    test("defaults to a 100-trade, multi-regime evidence contract", () => {
        expect(DEFAULT_PROMOTION_GATE_OPTIONS).toEqual(
            expect.objectContaining({
                minClosedTrades: 100,
                minElapsedDays: 30,
                minTradingDays: 20,
                minRegimes: 2,
                minProfitFactor: 1.2,
                requireMatchedShadow: true,
                requireExecutionParity: true,
            })
        );
    });

    test("passes a diversified candidate with positive AUD and pip lower bounds", () => {
        const gate = evaluatePromotionGate(buildContext());

        expect(gate.passed).toBe(true);
        expect(gate.gateVersion).toBe(2);
        expect(gate.referenceCurrency).toBe("AUD");
        expect(gate.evidence.expectancyAud.lowerBound).toBeGreaterThan(0);
        expect(gate.evidence.expectancyPips.lowerBound).toBeGreaterThan(0);
        expect(gate.evidence.configCoverageRatio).toBe(1);
    });

    test("rejects a sample below 100 closed trades", () => {
        const gate = evaluatePromotionGate(
            buildContext({ trades: buildTrades(99) })
        );

        expect(gate.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "MIN_CLOSED_TRADES",
                    actual: 99,
                    required: 100,
                }),
            ])
        );
    });

    test("rejects non-positive statistical lower bounds", () => {
        const trades = buildTrades(120).map((trade, index) => ({
            ...trade,
            pnlAud: index % 2 === 0 ? 1 : -1,
            pnlPips: index % 2 === 0 ? 5 : -5,
        }));
        const gate = evaluatePromotionGate(buildContext({ trades }));

        expect(gate.reasons.map((reason) => reason.code)).toEqual(
            expect.arrayContaining([
                "EXPECTANCY_LOWER_BOUND_PIPS",
                "EXPECTANCY_LOWER_BOUND_AUD",
                "PROFIT_FACTOR",
            ])
        );
    });

    test("rejects mixed or missing configuration identity", () => {
        const trades = buildTrades();
        trades[0] = { ...trades[0], configHash: "different-config" };
        const gate = evaluatePromotionGate(buildContext({ trades }));

        expect(gate.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "CONFIG_COVERAGE" }),
            ])
        );
    });

    test("rejects rollover trades whose AUD financing is unmodeled", () => {
        const trades = buildTrades();
        trades[0] = {
            ...trades[0],
            brokerReconciliationPayload: {
                paperRuntime: {
                    ...trades[0].brokerReconciliationPayload.paperRuntime,
                    financingMode: "UNMODELED",
                    financingStatus: "MISSING_RATE",
                    financingDayWeights: [{ day: "2026-07-08", weight: 3 }],
                },
            },
        };
        const gate = evaluatePromotionGate(buildContext({ trades }));

        expect(gate.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "UNMODELED_TRADING_COSTS" }),
            ])
        );
        expect(gate.evidence.incompleteCostRows[0].failures).toContain(
            "financing"
        );
    });

    test("requires matched-shadow outperformance and explicit execution parity", () => {
        const gate = evaluatePromotionGate(
            buildContext({
                matchedShadowEvidence: {
                    passed: false,
                    closedTrades: 10,
                    overlapDays: 3,
                    candidateNetExpectancyAud: 0.1,
                    shadowNetExpectancyAud: 0.2,
                },
                executionParity: { passed: false },
            })
        );

        expect(gate.reasons.map((reason) => reason.code)).toEqual(
            expect.arrayContaining([
                "MATCHED_SHADOW_EVIDENCE",
                "EXECUTION_PARITY_EVIDENCE",
            ])
        );
    });

    test("infers required sides from the immutable candidate config", () => {
        expect(resolveRequiredSides({ enableShorting: false })).toEqual(["BUY"]);
        expect(resolveRequiredSides({ enableShorting: true })).toEqual([
            "BUY",
            "SELL",
        ]);
    });
});
