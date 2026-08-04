const StrategyRunRepository = require("../strategyRunRepository");
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

describe("StrategyRunRepository", () => {
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
        repository = new StrategyRunRepository();
        await cleanupTestDb(testDb);
    });

    test("creates and reads strategy runs with config snapshots and metadata", async () => {
        await repository.create({
            runId: "run-live-1",
            mode: "live",
            strategy: "carry_trend",
            status: "active",
            selectionId: "selection-1",
            configHash: "cfg-1",
            configSnapshot: {
                strategy: "carry_trend",
                assets: ["AUD_USD"],
            },
            metadata: {
                entryEnabled: true,
            },
            startedAt: 1710000000000,
        });

        const run = await repository.getByRunId("run-live-1");

        expect(run).toEqual(
            expect.objectContaining({
                runId: "run-live-1",
                mode: "live",
                strategy: "carry_trend",
                status: "active",
                selectionId: "selection-1",
                configHash: "cfg-1",
                configSnapshot: {
                    strategy: "carry_trend",
                    assets: ["AUD_USD"],
                },
                metadata: {
                    entryEnabled: true,
                },
            })
        );
    });

    test("updates status and stop timestamps", async () => {
        await repository.create({
            runId: "run-live-2",
            mode: "live",
            strategy: "carry_trend",
            status: "active",
            startedAt: 1710000000000,
        });

        const updated = await repository.update("run-live-2", {
            status: "stopped",
            stoppedAt: 1710000005000,
            metadata: {
                reason: "manual-stop",
            },
        });

        expect(updated).toEqual(
            expect.objectContaining({
                runId: "run-live-2",
                status: "stopped",
                stoppedAt: 1710000005000,
                metadata: {
                    reason: "manual-stop",
                },
            })
        );
    });

    test("rejects changes to immutable live release identity", async () => {
        await repository.create({
            runId: "run-immutable",
            mode: "live",
            strategy: "carry_trend",
            status: "active",
            configHash: "config-a",
            configSnapshot: { strategy: "carry_trend" },
            startedAt: 1710000000000,
        });

        await expect(
            repository.update("run-immutable", {
                configHash: "config-b",
                configSnapshot: { strategy: "retired_strategy" },
            })
        ).rejects.toMatchObject({ code: "IMMUTABLE_STRATEGY_RUN" });
    });

    test("persists restart lineage on a new run", async () => {
        await repository.create({
            runId: "run-fresh-window",
            parentRunId: "run-original-window",
            mode: "live",
            strategy: "carry_trend",
            status: "active",
            startedAt: 1710000000000,
        });

        await expect(
            repository.getByRunId("run-fresh-window")
        ).resolves.toEqual(
            expect.objectContaining({ parentRunId: "run-original-window" })
        );
    });

    test("retires active non-live rows left by the removed runtime", async () => {
        await testDb("strategy_runs").insert({
            run_id: "retired-run",
            mode: "retired_mode",
            strategy: "retired_strategy",
            status: "active",
            started_at: 1710000000000,
        });

        await expect(repository.retireNonLiveRuns(1710000005000)).resolves.toBe(1);
        await expect(testDb("strategy_runs").where("run_id", "retired-run").first())
            .resolves.toEqual(
                expect.objectContaining({
                    status: "stopped",
                    stopped_at: 1710000005000,
                })
            );
    });

    test("lists runs filtered by mode, status, and selection", async () => {
        await repository.create({
            runId: "run-live-3",
            mode: "live",
            strategy: "carry_trend",
            status: "active",
            selectionId: "selection-3",
            startedAt: 1710000000000,
        });
        await repository.create({
            runId: "run-managing-3",
            mode: "live",
            strategy: "carry_trend",
            status: "managing_only",
            selectionId: "selection-3",
            startedAt: 1710000001000,
        });
        await repository.create({
            runId: "run-live-4",
            mode: "live",
            strategy: "carry_trend",
            status: "stopped",
            selectionId: "selection-4",
            startedAt: 1710000002000,
        });

        const activeSelectionRuns = await repository.list({
            selectionId: "selection-3",
            statuses: ["active", "managing_only"],
        });

        expect(activeSelectionRuns).toHaveLength(2);
        expect(activeSelectionRuns.map((run) => run.runId)).toEqual([
            "run-managing-3",
            "run-live-3",
        ]);
    });
});
