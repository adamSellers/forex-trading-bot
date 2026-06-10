const PortfolioRepository = require("../portfolioRepository");
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

describe("PortfolioRepository", () => {
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
        repository = new PortfolioRepository();
        await cleanupTestDb(testDb);
    });

    test("should save and map runtime identity fields on snapshots", async () => {
        await repository.save({
            totalValueAud: 10250.55,
            balanceAud: 10000,
            unrealizedPnlAud: 125.25,
            realizedPnlAud: 20,
            marginUsedAud: 250,
            marginAvailableAud: 9750,
            positions: [{ instrument: "AUD_USD", units: 1000 }],
            positionCount: 1,
            exposurePercent: 2.5,
            snapshotTime: 1710000000000,
            mode: "paper_shadow",
            runId: "run-shadow-1",
            selectionId: "selection-1",
            strategy: "supertrend_momentum",
        });

        const current = await repository.getCurrent({ mode: "paper_shadow" });
        expect(current).toEqual(
            expect.objectContaining({
                totalValueAud: 10250.55,
                runId: "run-shadow-1",
                selectionId: "selection-1",
                mode: "paper_shadow",
                strategy: "supertrend_momentum",
                positions: [{ instrument: "AUD_USD", units: 1000 }],
            })
        );
    });

    test("should return history filtered by runtime identity", async () => {
        await repository.save({
            totalValueAud: 10001,
            balanceAud: 10000,
            snapshotTime: 1710000000000,
            mode: "live",
            runId: "run-live-1",
            strategy: "supertrend_momentum",
        });
        await repository.save({
            totalValueAud: 10002,
            balanceAud: 10000,
            snapshotTime: 1710000001000,
            mode: "paper_candidate",
            runId: "run-candidate-1",
            strategy: "mean_reversion",
        });

        const history = await repository.getHistory(10, {
            mode: "paper_candidate",
            runId: "run-candidate-1",
        });

        expect(history).toHaveLength(1);
        expect(history[0]).toEqual(
            expect.objectContaining({
                mode: "paper_candidate",
                runId: "run-candidate-1",
                strategy: "mean_reversion",
            })
        );
    });

    describe("deleteOlderThan", () => {
        const daysAgoMs = (days) => Date.now() - days * 24 * 60 * 60 * 1000;

        test("should delete only snapshots older than the cutoff", async () => {
            await repository.save({
                totalValueAud: 10000,
                balanceAud: 10000,
                snapshotTime: daysAgoMs(91),
                mode: "live",
            });
            await repository.save({
                totalValueAud: 10001,
                balanceAud: 10000,
                snapshotTime: daysAgoMs(1),
                mode: "live",
            });

            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(1);
            const remaining = await testDb("portfolio_snapshots");
            expect(remaining).toHaveLength(1);
            expect(Number(remaining[0].snapshot_time)).toBeGreaterThan(
                daysAgoMs(90)
            );
        });

        test("should return 0 when nothing is old enough", async () => {
            await repository.save({
                totalValueAud: 10000,
                balanceAud: 10000,
                snapshotTime: daysAgoMs(5),
                mode: "live",
            });

            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(0);
            expect(await testDb("portfolio_snapshots")).toHaveLength(1);
        });

        test("should return 0 on database errors instead of throwing", async () => {
            mockTestDbInstance = null;

            const deleted = await repository.deleteOlderThan(90);

            expect(deleted).toBe(0);
            mockTestDbInstance = testDb;
        });
    });
});
