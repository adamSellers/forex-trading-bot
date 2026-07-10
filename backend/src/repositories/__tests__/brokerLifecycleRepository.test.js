jest.mock("../../../config/database", () => ({ db: null }));

const BrokerLifecycleRepository = require("../brokerLifecycleRepository");

function createMemoryDatabase() {
    const tables = {
        broker_order_intents: [],
        broker_position_quarantines: [],
        broker_runtime_state: [],
    };

    class Query {
        constructor(table) {
            this.table = table;
            this.filters = [];
            this.sort = null;
            this.pendingInsert = null;
            this.conflictColumn = null;
        }

        where(column, value) {
            this.filters.push((row) => row[column] === value);
            return this;
        }

        whereIn(column, values) {
            this.filters.push((row) => values.includes(row[column]));
            return this;
        }

        whereNotIn(column, values) {
            this.filters.push((row) => !values.includes(row[column]));
            return this;
        }

        orderBy(column, direction = "asc") {
            this.sort = { column, direction };
            return this;
        }

        insert(row) {
            this.pendingInsert = { ...row };
            return this;
        }

        onConflict(column) {
            this.conflictColumn = column;
            return this;
        }

        async merge(updates) {
            const rows = tables[this.table];
            const existing = rows.find(
                (row) =>
                    row[this.conflictColumn] ===
                    this.pendingInsert[this.conflictColumn]
            );
            if (existing) Object.assign(existing, updates);
            else rows.push(this.pendingInsert);
            return 1;
        }

        selected() {
            let rows = tables[this.table].filter((row) =>
                this.filters.every((filter) => filter(row))
            );
            if (this.sort) {
                const multiplier = this.sort.direction === "desc" ? -1 : 1;
                rows = [...rows].sort(
                    (a, b) =>
                        (a[this.sort.column] - b[this.sort.column]) * multiplier
                );
            }
            return rows;
        }

        async first() {
            return this.selected()[0];
        }

        async update(updates) {
            const rows = this.selected();
            rows.forEach((row) => Object.assign(row, updates));
            return rows.length;
        }

        then(resolve, reject) {
            return Promise.resolve().then(() => {
                if (this.pendingInsert) {
                    tables[this.table].push(this.pendingInsert);
                    return 1;
                }
                return this.selected();
            }).then(resolve, reject);
        }
    }

    const database = (table) => new Query(table);
    database.tables = tables;
    return database;
}

describe("BrokerLifecycleRepository", () => {
    let database;
    let repository;

    beforeEach(() => {
        database = createMemoryDatabase();
        repository = new BrokerLifecycleRepository(database);
    });

    test("persists a prepared intent before submission and returns it for recovery", async () => {
        await repository.createIntent({
            intentId: "intent-1",
            clientOrderId: "oi-intent-1",
            clientTradeId: "ti-intent-1",
            decisionId: "decision-1",
            tradeId: "trade-1",
            status: "PREPARED",
            instrument: "EUR_USD",
            side: "BUY",
            units: 250,
            referencePrice: 1.1,
            finalQuote: 1.1001,
            priceBound: 1.1003,
            lastTransactionId: "100",
            requestPayload: { positionFill: "OPEN_ONLY" },
            contextPayload: { config: { enableBreakeven: true } },
            createdAt: 1710000000000,
        });

        const [intent] = await repository.getRecoverableIntents();
        expect(intent).toEqual(
            expect.objectContaining({
                intentId: "intent-1",
                tradeId: "trade-1",
                status: "PREPARED",
                units: 250,
                requestPayload: { positionFill: "OPEN_ONLY" },
                contextPayload: { config: { enableBreakeven: true } },
            })
        );
    });

    test("records ambiguous-to-completed lifecycle without losing correlation IDs", async () => {
        await repository.createIntent({
            intentId: "intent-2",
            clientOrderId: "oi-intent-2",
            clientTradeId: "ti-intent-2",
            tradeId: "trade-2",
            status: "PREPARED",
            instrument: "AUD_USD",
            side: "SELL",
            units: 300,
            createdAt: 1710000000000,
        });
        await repository.updateIntent("intent-2", {
            status: "AMBIGUOUS",
            attemptCount: 1,
            lastError: "request timed out",
        });
        await repository.updateIntent("intent-2", {
            status: "COMPLETED",
            brokerTradeId: "489",
            responsePayload: { recovered: true },
            resolvedAt: 1710000005000,
        });

        const intent = await repository.getIntentByBrokerTradeId("489");
        expect(intent).toEqual(
            expect.objectContaining({
                intentId: "intent-2",
                clientOrderId: "oi-intent-2",
                clientTradeId: "ti-intent-2",
                status: "COMPLETED",
                brokerTradeId: "489",
                responsePayload: { recovered: true },
            })
        );
        expect(await repository.getRecoverableIntents()).toEqual([]);
    });

    test("upserts broker-only quarantines and resolves positions no longer open", async () => {
        await repository.quarantineBrokerTrade({
            brokerTradeId: "900",
            instrument: "GBP_USD",
            side: "BUY",
            units: 100,
            reason: "UNMANAGED_BROKER_TRADE",
            brokerPayload: { id: "900", state: "OPEN" },
            lastSeenAt: 1710000000000,
        });
        await repository.quarantineBrokerTrade({
            brokerTradeId: "900",
            instrument: "GBP_USD",
            side: "BUY",
            units: 90,
            reason: "UNMANAGED_BROKER_TRADE",
            brokerPayload: { id: "900", currentUnits: "90" },
            lastSeenAt: 1710000001000,
        });

        expect(await repository.getOpenQuarantines()).toEqual([
            expect.objectContaining({
                brokerTradeId: "900",
                units: 90,
                status: "OPEN",
                lastSeenAt: 1710000001000,
            }),
        ]);

        await repository.resolveMissingQuarantines(new Set());
        expect(await repository.getOpenQuarantines()).toEqual([]);
        expect(await repository.getQuarantine("900")).toEqual(
            expect.objectContaining({ status: "RESOLVED" })
        );
    });

    test("persists runtime risk state across repository instances", async () => {
        await repository.setState("aud_nav_high_watermark", {
            navAud: 150,
            observedAt: 1710000000000,
        });
        const restartedRepository = new BrokerLifecycleRepository(database);

        expect(
            await restartedRepository.getState("aud_nav_high_watermark")
        ).toEqual({ navAud: 150, observedAt: 1710000000000 });
    });
});
