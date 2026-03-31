const EntryDecisionRepository = require("../entryDecisionRepository");
const {
    createTestDb,
    cleanupTestDb,
    destroyTestDb,
} = require("../../../__tests__/helpers/testDb");

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
    let testDb;

    beforeAll(async () => {
        testDb = await createTestDb();
        mockTestDbInstance = testDb;
    });

    afterAll(async () => {
        await destroyTestDb(testDb);
        mockTestDbInstance = null;
    });

    beforeEach(async () => {
        repository = new EntryDecisionRepository();
        await cleanupTestDb(testDb);
    });

    test("should save and map entry decision records", async () => {
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
            strategy: "supertrend_momentum",
        });

        const saved = await testDb("entry_decisions")
            .where("decision_id", "decision-1")
            .first();

        expect(saved.instrument).toBe("GBP_USD");
        expect(saved.config_hash).toBe("cfg-123");
        expect(saved.run_id).toBe("run-live-1");
        expect(saved.selection_id).toBe("selection-1");
        expect(saved.mode).toBe("live");
        expect(saved.strategy).toBe("supertrend_momentum");
        expect(JSON.parse(saved.config_snapshot)).toEqual({
            minAdx: 21,
            freshLongRsiCeiling: 68,
        });
    });

    test("should update stage, outcome, rejection code, and trade link", async () => {
        await repository.save({
            decisionId: "decision-2",
            decisionTime: 1710000001234,
            instrument: "EUR_USD",
            side: "SELL",
            signal: "SELL",
            entryType: "SHORT_ENTRY",
        });

        await repository.updateDecision("decision-2", {
            stage: "FILLED",
            outcome: "FILLED",
            tradeId: "trade-2",
            runId: "run-live-2",
            selectionId: "selection-2",
            strategy: "supertrend_momentum",
            rejectionCode: null,
            rejectionReason: null,
        });

        const row = await testDb("entry_decisions")
            .where("decision_id", "decision-2")
            .first();
        expect(row.stage).toBe("FILLED");
        expect(row.outcome).toBe("FILLED");
        expect(row.trade_id).toBe("trade-2");
        expect(row.run_id).toBe("run-live-2");
        expect(row.selection_id).toBe("selection-2");
        expect(row.strategy).toBe("supertrend_momentum");
    });

    test("should return decisions since cutoff", async () => {
        await repository.save({
            decisionId: "decision-old",
            decisionTime: 1710000000000,
            instrument: "AUD_USD",
            side: "BUY",
            signal: "BUY",
        });
        await repository.save({
            decisionId: "decision-new",
            decisionTime: 1710000100000,
            instrument: "AUD_USD",
            side: "BUY",
            signal: "BUY",
        });

        const rows = await repository.getDecisionsSince(1710000050000);
        expect(rows).toHaveLength(1);
        expect(rows[0].decisionId).toBe("decision-new");
    });
});
