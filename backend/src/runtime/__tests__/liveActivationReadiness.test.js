const {
    applyControlledLiveConfig,
    evaluateControlledLiveReadiness,
    getControlledRiskLimitViolations,
} = require("../liveActivationReadiness");
const { computeConfigHash } = require("../../config/tradingConfig");

function buildLiveSelection(overrides = {}) {
    const configHash = overrides.configHash || "live-config";
    return {
        selectionId: "selection-1",
        liveRun: {
            runId: "run-live",
            strategy: "timesfm_directional",
            configHash,
            metadata: {
                promotedFromRunId: "candidate-1",
                promotionGate: {
                    passed: true,
                    status: "PASS",
                    gateVersion: 2,
                    configHash: "candidate-config",
                },
                phase4ControlledLive: {
                    sourceConfigHash: "candidate-config",
                    liveConfigHash: configHash,
                },
            },
            ...overrides,
        },
    };
}

function buildBaselineResumeSelection(overrides = {}) {
    const configHash = overrides.configHash || "live-config";
    const parentRunId = Object.prototype.hasOwnProperty.call(
        overrides,
        "parentRunId"
    )
        ? overrides.parentRunId
        : "run-legacy-live";
    const metadata = Object.prototype.hasOwnProperty.call(overrides, "metadata")
        ? overrides.metadata
        : {
              activationBasis: "explicit_user_baseline_resume",
              controlledBaselineResume: {
                  confirmed: true,
                  confirmedAt: 1_750_000_000_000,
                  predecessorLiveRunId: "run-legacy-live",
              },
              phase4ControlledLive: {
                  activationBasis: "explicit_user_baseline_resume",
                  predecessorLiveRunId: "run-legacy-live",
                  sourceConfigHash: "legacy-config",
                  liveConfigHash: configHash,
              },
          };

    return {
        selectionId: "selection-baseline-resume",
        liveRun: {
            runId: "run-controlled-live",
            parentRunId,
            strategy: "supertrend_momentum",
            configHash,
            metadata,
            ...overrides,
            // Keep the explicitly assembled metadata object when callers only
            // override another immutable run field.
            metadata,
        },
    };
}

describe("liveActivationReadiness", () => {
    test("applies every controlled cap, AUD identity, and keeps entries paused", () => {
        const config = applyControlledLiveConfig({
            enableTrading: true,
            maxOpenPositions: 3,
            riskPerTrade: 0.02,
            maxCapitalAtRisk: 500,
            maxPortfolioExposure: 0.5,
            maxAggregateStopRiskPctNav: 0.1,
            maxDailyLossPctNav: 0.1,
            maxDrawdownPctNav: 0.5,
            maxConsecutiveLosses: 20,
        });

        expect(config).toEqual(
            expect.objectContaining({
                enableTrading: false,
                referenceCurrency: "AUD",
                accountCurrency: "AUD",
                portfolioRiskEnforcement: true,
                maxOpenPositions: 1,
                riskPerTrade: 0.005,
                maxCapitalAtRisk: 50,
                maxPortfolioExposure: 0.1,
                maxAggregateStopRiskPctNav: 0.01,
                maxDailyLossPctNav: 0.02,
                maxDrawdownPctNav: 0.08,
                maxConsecutiveLosses: 3,
            })
        );
    });

    test("fails readiness without gate-v2 promotion-path evidence", () => {
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildLiveSelection({ metadata: {} }),
            config: applyControlledLiveConfig({}),
        });

        expect(readiness.reasons.map((reason) => reason.code)).toEqual(
            expect.arrayContaining([
                "PROMOTION_GATE_NOT_PASSED",
                "PROMOTION_PATH_REQUIRED",
                "LIVE_CONFIG_IDENTITY_MISMATCH",
            ])
        );
    });

    test("blocks the audited SuperTrend baseline when production marks it rejected", () => {
        const config = {
            ...applyControlledLiveConfig({}),
            controlledBaselineQualificationStatus: "rejected",
            controlledBaselineQualificationReasonCode:
                "FAILED_OUT_OF_SAMPLE_STRATEGY_AUDIT",
            strategyAuditVersion: "2026-08-04",
        };
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildBaselineResumeSelection({
                configHash: computeConfigHash(config),
            }),
            config,
        });

        expect(readiness.passed).toBe(false);
        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "BASELINE_STRATEGY_NOT_QUALIFIED",
                    auditVersion: "2026-08-04",
                }),
            ])
        );
        expect(
            readiness.activationOptions.controlledBaselineResume.reasons
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "BASELINE_STRATEGY_NOT_QUALIFIED",
                }),
            ])
        );
    });

    test("fails when any controlled portfolio risk cap is exceeded", () => {
        const config = {
            ...applyControlledLiveConfig({}),
            maxOpenPositions: 2,
            maxAggregateStopRiskPctNav: 0.02,
            maxConsecutiveLosses: 4,
        };
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildLiveSelection({
                configHash: computeConfigHash(config),
            }),
            config,
        });

        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxOpenPositions",
                }),
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxAggregateStopRiskPctNav",
                }),
                expect.objectContaining({
                    code: "CONTROLLED_RISK_LIMIT",
                    key: "maxConsecutiveLosses",
                }),
            ])
        );
        expect(getControlledRiskLimitViolations(config)).toHaveLength(3);
    });

    test("passes only with immutable promotion identity and all controls enabled", () => {
        const config = applyControlledLiveConfig({});
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildLiveSelection({
                configHash: computeConfigHash(config),
            }),
            config,
        });

        expect(readiness).toEqual(
            expect.objectContaining({
                passed: true,
                status: "PASS",
                liveRunId: "run-live",
                strategy: "timesfm_directional",
            })
        );
    });

    test("accepts an explicit controlled SuperTrend baseline successor without fabricated promotion evidence", () => {
        const config = applyControlledLiveConfig({});
        const liveSelection = buildBaselineResumeSelection({
            configHash: computeConfigHash(config),
        });

        expect(liveSelection.liveRun.metadata).not.toHaveProperty(
            "promotionGate"
        );
        expect(liveSelection.liveRun.metadata).not.toHaveProperty(
            "promotedFromRunId"
        );

        const readiness = evaluateControlledLiveReadiness({
            liveSelection,
            config,
        });

        expect(readiness).toEqual(
            expect.objectContaining({
                passed: true,
                status: "PASS",
                liveRunId: "run-controlled-live",
                strategy: "supertrend_momentum",
                activationBasis: "explicit_user_baseline_resume",
                promotionGate: null,
                reasons: [],
            })
        );
    });

    test.each([
        {
            name: "a different activation basis",
            expectedCode: "PROMOTION_PATH_REQUIRED",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "candidate_promotion",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "candidate_promotion",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "missing immutable parent lineage",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({ parentRunId: null }),
        },
        {
            name: "missing predecessor evidence",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "predecessor evidence that does not match the parent run",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "some-other-run",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "confirmation that was not explicit",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: false,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "a non-finite confirmation timestamp",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: "not-a-timestamp",
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "controlled metadata that names a different predecessor",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "some-other-run",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "fabricated candidate-promotion evidence",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    promotedFromRunId: "not-a-real-candidate",
                    promotionGate: {
                        passed: true,
                        gateVersion: 2,
                    },
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "live-config",
                    },
                },
            }),
        },
        {
            name: "a non-baseline strategy",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: buildBaselineResumeSelection({
                strategy: "timesfm_directional",
            }),
        },
        {
            name: "a wrapper strategy that contradicts the immutable run strategy",
            expectedCode: "BASELINE_RESUME_EVIDENCE_INVALID",
            selection: {
                ...buildBaselineResumeSelection({
                    strategy: "timesfm_directional",
                }),
                strategy: "supertrend_momentum",
            },
        },
    ])(
        "rejects controlled baseline evidence with $name",
        ({ selection, expectedCode }) => {
            const config = applyControlledLiveConfig({});
            const configHash = computeConfigHash(config);
            selection.liveRun.configHash = configHash;
            selection.liveRun.metadata.phase4ControlledLive.liveConfigHash =
                configHash;

            const readiness = evaluateControlledLiveReadiness({
                liveSelection: selection,
                config,
            });

            expect(readiness.passed).toBe(false);
            expect(readiness.status).toBe("FAIL");
            expect(readiness.reasons).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ code: expectedCode }),
                ])
            );
        }
    );

    test("keeps immutable live and current canonical config identity checks for a baseline resume", () => {
        const config = applyControlledLiveConfig({});
        const currentConfigHash = computeConfigHash(config);
        const wrongLiveIdentity = evaluateControlledLiveReadiness({
            liveSelection: buildBaselineResumeSelection({
                configHash: currentConfigHash,
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "different-live-config",
                    },
                },
            }),
            config,
        });
        const staleCanonicalConfig = evaluateControlledLiveReadiness({
            liveSelection: buildBaselineResumeSelection({
                configHash: "stale-live-config",
                metadata: {
                    activationBasis: "explicit_user_baseline_resume",
                    controlledBaselineResume: {
                        confirmed: true,
                        confirmedAt: 1_750_000_000_000,
                        predecessorLiveRunId: "run-legacy-live",
                    },
                    phase4ControlledLive: {
                        activationBasis: "explicit_user_baseline_resume",
                        predecessorLiveRunId: "run-legacy-live",
                        liveConfigHash: "stale-live-config",
                    },
                },
            }),
            config,
        });

        expect(wrongLiveIdentity.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "LIVE_CONFIG_IDENTITY_MISMATCH",
                }),
            ])
        );
        expect(staleCanonicalConfig.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "ACTIVE_CONFIG_MISMATCH" }),
            ])
        );
    });

    test("keeps AUD, enforcement, and every controlled risk cap mandatory for a baseline resume", () => {
        const config = {
            ...applyControlledLiveConfig({}),
            referenceCurrency: "USD",
            accountCurrency: "USD",
            portfolioRiskEnforcement: false,
            maxOpenPositions: 2,
            riskPerTrade: 0.006,
            maxCapitalAtRisk: 51,
            maxPortfolioExposure: 0.11,
            maxAggregateStopRiskPctNav: 0.011,
            maxNetCurrencyExposurePctNav: 2.1,
            maxCorrelatedExposurePctNav: 2.1,
            maxDailyLossPctNav: 0.021,
            maxDrawdownPctNav: 0.081,
            maxConsecutiveLosses: 4,
        };
        const configHash = computeConfigHash(config);
        const readiness = evaluateControlledLiveReadiness({
            liveSelection: buildBaselineResumeSelection({ configHash }),
            config,
        });

        expect(readiness.reasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "REFERENCE_CURRENCY_MISMATCH",
                }),
                expect.objectContaining({
                    code: "PORTFOLIO_RISK_ENFORCEMENT_DISABLED",
                }),
            ])
        );
        expect(
            readiness.reasons
                .filter((reason) => reason.code === "CONTROLLED_RISK_LIMIT")
                .map((reason) => reason.key)
        ).toEqual([
            "maxOpenPositions",
            "riskPerTrade",
            "maxCapitalAtRisk",
            "maxPortfolioExposure",
            "maxAggregateStopRiskPctNav",
            "maxNetCurrencyExposurePctNav",
            "maxCorrelatedExposurePctNav",
            "maxDailyLossPctNav",
            "maxDrawdownPctNav",
            "maxConsecutiveLosses",
        ]);
    });

    test("advertises the explicit resume option only for a paused legacy SuperTrend selection", () => {
        const config = applyControlledLiveConfig({
            strategy: "supertrend_momentum",
        });
        const legacySelection = {
            selectionId: "selection-legacy",
            strategy: "supertrend_momentum",
            liveRun: {
                runId: "run-legacy-live",
                strategy: "supertrend_momentum",
                configHash: "legacy-config",
                metadata: {},
            },
            shadowRun: {
                runId: "run-legacy-shadow",
                strategy: "supertrend_momentum",
                metadata: {},
            },
        };

        const paused = evaluateControlledLiveReadiness({
            liveSelection: legacySelection,
            config,
        });
        const running = evaluateControlledLiveReadiness({
            liveSelection: legacySelection,
            config: { ...config, enableTrading: true },
        });

        expect(
            paused.activationOptions.controlledBaselineResume
        ).toEqual(
            expect.objectContaining({
                eligible: true,
                code: "CONTROLLED_BASELINE_RESUME_AVAILABLE",
                requiresExplicitConfirmation: true,
                requiredConfirmation: "RESUME_CONTROLLED_BASELINE",
                requiresFlatPreflight: true,
                predecessorLiveRunId: "run-legacy-live",
                predecessorShadowRunId: "run-legacy-shadow",
            })
        );
        expect(
            running.activationOptions.controlledBaselineResume
        ).toEqual(
            expect.objectContaining({
                eligible: false,
                code: "CONTROLLED_BASELINE_RESUME_UNAVAILABLE",
                reasons: expect.arrayContaining([
                    expect.objectContaining({
                        code: "TRADING_MUST_BE_PAUSED",
                    }),
                ]),
            })
        );
    });
});
