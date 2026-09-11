const EntryDecisionRepository = require("../entryDecisionRepository");
const { createTestDb, destroyTestDb } = require("../../../__tests__/helpers/testDb");
const reconsiderationMigration = require("../../../migrations/011_add_entry_reconsideration");

let mockTestDbInstance = null;

jest.mock("../../../config/database", () => ({
    db: new Proxy(function () {}, {
        apply: (target, thisArg, args) => {
            if (mockTestDbInstance) {
                return mockTestDbInstance(args[0]);
            }
            throw new Error("Database not initialized");
        },
        get: (target, prop) => {
            if (mockTestDbInstance && mockTestDbInstance[prop]) {
                return typeof mockTestDbInstance[prop] === "function"
                    ? mockTestDbInstance[prop].bind(mockTestDbInstance)
                    : mockTestDbInstance[prop];
            }
            return undefined;
        },
    }),
}));

describe("EntryDecisionRepository", () => {
    let repository;

    beforeEach(() => {
        repository = new EntryDecisionRepository();
        mockTestDbInstance = null;
    });

    test("should save and map entry decision records", async () => {
        const mockInsert = jest.fn().mockResolvedValue([1]);
        mockTestDbInstance = jest.fn().mockReturnValue({ insert: mockInsert });

        await repository.save({
            decisionId: "decision-1",
            setupId: "setup-1",
            signalCandleTime: 1710000000000,
            decisionTime: 1710000001234,
            instrument: "GBP_USD",
            side: "BUY",
            signal: "BUY",
            entryType: "FRESH_FLIP",
            configHash: "cfg-123",
            configSnapshot: { minAdx: 21, freshLongRsiCeiling: 68 },
            stage: "RECEIVED",
            outcome: "PENDING",
            spreadPips: 1.2,
            priceAgeMs: 150,
            openPositions: 1,
            projectedExposure: 0.42,
            signalStrength: 28.5,
            adx: 28.5,
            rsi: 64.2,
            atrPips: 13.4,
            runId: "run-live-1",
            selectionId: "selection-1",
            mode: "live",
            strategy: "carry_trend",
        });

        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                decision_id: "decision-1",
                setup_id: "setup-1",
                signal_candle_time: 1710000000000,
                decision_time: 1710000001234,
                instrument: "GBP_USD",
                side: "BUY",
                signal: "BUY",
                entry_type: "FRESH_FLIP",
                config_hash: "cfg-123",
                stage: "RECEIVED",
                outcome: "PENDING",
                spread_pips: 1.2,
                price_age_ms: 150,
                open_positions: 1,
                projected_exposure: 0.42,
                signal_strength: 28.5,
                adx: 28.5,
                rsi: 64.2,
                atr_pips: 13.4,
                run_id: "run-live-1",
                selection_id: "selection-1",
                mode: "live",
                strategy: "carry_trend",
            })
        );
        expect(mockInsert.mock.calls[0][0].config_snapshot).toBe(
            JSON.stringify({
                minAdx: 21,
                freshLongRsiCeiling: 68,
            })
        );
    });

    test("should update stage, outcome, rejection code, and trade link", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(1);
        const mockWhere = jest.fn().mockReturnValue({ update: mockUpdate });
        mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

        await repository.updateDecision("decision-2", {
            stage: "FILLED",
            outcome: "FILLED",
            tradeId: "trade-2",
            runId: "run-live-2",
            selectionId: "selection-2",
            strategy: "carry_trend",
            rejectionCode: null,
            rejectionReason: null,
        });

        expect(mockWhere).toHaveBeenCalledWith("decision_id", "decision-2");
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                stage: "FILLED",
                outcome: "FILLED",
                trade_id: "trade-2",
                run_id: "run-live-2",
                selection_id: "selection-2",
                strategy: "carry_trend",
                rejection_code: null,
                rejection_reason: null,
            })
        );
    });

    test("should return decisions since cutoff", async () => {
        const rows = [
            {
                id: 2,
                decision_id: "decision-new",
                decision_time: 1710000100000,
                instrument: "AUD_USD",
                side: "BUY",
                signal: "BUY",
                entry_type: null,
                config_hash: null,
                config_snapshot: null,
                outcome: "PENDING",
                stage: "RECEIVED",
                rejection_code: null,
                rejection_reason: null,
                spread_pips: null,
                price_age_ms: null,
                open_positions: null,
                projected_exposure: null,
                signal_strength: null,
                adx: null,
                rsi: null,
                atr_pips: null,
                trade_id: null,
                run_id: null,
                selection_id: null,
                mode: "live",
                strategy: null,
                created_at: new Date(),
                updated_at: new Date(),
            },
        ];
        const mockOrderBy = jest.fn().mockResolvedValue(rows);
        const query = {
            orderBy: mockOrderBy,
        };
        const mockWhere = jest.fn().mockReturnValue(query);
        mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

        const result = await repository.getDecisionsSince(1710000050000);
        expect(mockWhere).toHaveBeenCalledWith(
            "decision_time",
            ">=",
            1710000050000
        );
        expect(mockOrderBy).toHaveBeenCalledWith("decision_time", "desc");
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
            expect.objectContaining({
                decisionId: "decision-new",
                decisionTime: 1710000100000,
                instrument: "AUD_USD",
            })
        );
    });

    describe("durable setup recovery", () => {
        let database;
        beforeEach(async () => {
            database = await createTestDb();
            mockTestDbInstance = database;
        });
        afterEach(async () => {
            await destroyTestDb(database);
        });

        const attempt = (overrides = {}) => ({
            decisionId: "attempt-1", setupId: "setup-1", signalCandleTime: 1789082100000,
            decisionTime: 1789083032000, instrument: "USD_JPY", side: "BUY", signal: "BUY",
            runId: "run-1", configHash: "config-1", entryReferencePrice: 154.537,
            ...overrides,
        });
        const identity = { runId: "run-1", configHash: "config-1", setupId: "setup-1" };

        test("round trips the actual rejection, original reference and latest attempt within its owner", async () => {
            await repository.save(attempt());
            const rejectionContext = { phase: "FINAL_QUOTE", spreadPips: 1.3, maxSpreadPips: 1.2 };
            await repository.updateDecision("attempt-1", {
                outcome: "REJECTED", rejectionCode: "SPREAD_TOO_WIDE", spreadPips: 1.3,
                canReconsider: true, rejectionContext,
            });
            expect(await repository.getLatestForSetup(identity)).toMatchObject({
                decisionId: "attempt-1", entryReferencePrice: 154.537,
                spreadPips: 1.3, rejectionContext, canReconsider: true,
            });
            // A clock correction must not resurrect the older safe rejection.
            await repository.save(attempt({ decisionId: "attempt-2", decisionTime: 1789082972000 }));
            await repository.save(attempt({ decisionId: "other-run", runId: "other", decisionTime: 1789083152000 }));
            await repository.save(attempt({ decisionId: "other-config", configHash: "other", decisionTime: 1789083152000 }));
            expect(await repository.getLatestForSetup(identity)).toMatchObject({
                decisionId: "attempt-2", outcome: "PENDING", canReconsider: false,
                entryReferencePrice: 154.537,
            });
            expect(await repository.getLatestForSetup({ ...identity, setupId: "missing" })).toBeNull();
        });

        test("a missing decision cannot acknowledge a safe rejection", async () => {
            await expect(repository.updateDecision("missing", { canReconsider: true }))
                .rejects.toThrow("was not updated");
            await expect(repository.getLatestForSetup({ setupId: "setup-1" }))
                .rejects.toThrow("requires run, config and setup identity");
        });

        test("migration preserves historical outcomes without inventing retry permission or quote evidence", async () => {
            await reconsiderationMigration.down(database);
            await database("entry_decisions").insert({
                decision_id: "historical", decision_time: 1789083032000, instrument: "USD_JPY",
                side: "BUY", signal: "BUY", outcome: "FILLED", trade_id: "original-trade",
                spread_pips: 1.1,
            });
            await reconsiderationMigration.up(database);
            const rows = await repository.getDecisionsSince(0);
            expect(rows[0]).toMatchObject({
                decisionId: "historical", outcome: "FILLED", tradeId: "original-trade", spreadPips: 1.1,
                entryReferencePrice: null, canReconsider: false, rejectionContext: null,
            });
        });
    });

    describe("deleteOlderThan", () => {
        test("should delete decisions older than specified days", async () => {
            let capturedCutoff = null;
            const mockDel = jest.fn().mockResolvedValue(3);
            const mockWhere = jest.fn((column, op, value) => {
                capturedCutoff = value;
                return { del: mockDel };
            });
            mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

            const now = Date.now();
            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(3);
            expect(mockTestDbInstance).toHaveBeenCalledWith("entry_decisions");
            expect(mockWhere).toHaveBeenCalledWith(
                "decision_time",
                "<",
                expect.any(Number)
            );
            // Cutoff should be approximately 90 days ago (ms epoch)
            const expectedCutoff = now - 90 * 24 * 60 * 60 * 1000;
            expect(Math.abs(capturedCutoff - expectedCutoff)).toBeLessThan(1000);
        });

        test("should return 0 on database errors instead of throwing", async () => {
            const mockDel = jest
                .fn()
                .mockRejectedValue(new Error("DB connection failed"));
            const mockWhere = jest.fn().mockReturnValue({ del: mockDel });
            mockTestDbInstance = jest.fn().mockReturnValue({ where: mockWhere });

            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(0);
        });
    });
});
