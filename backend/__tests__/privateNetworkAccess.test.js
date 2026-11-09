const request = require("supertest");
const WebSocket = require("ws");

// Exercise server.js and its real Express/Socket.IO wiring, with all external
// effects replaced before import. Never read .env, open a database, or contact
// the broker, email provider or report storage from this regression.
jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("../config/database", () => ({
    db: { raw: jest.fn(() => { throw new Error("Shared database must not run the checkpoint"); }) },
    dbPath: "/isolated/retention-fixture.sqlite",
}));
jest.mock("../src/maintenance/checkpointWal", () => ({ checkpointWal: jest.fn(), cancelWalCheckpoints: jest.fn() }));
jest.mock("../src/services/configService", () => {
    const { EventEmitter } = require("events");
    const { cloneDefaultConfig } = require("../src/config/tradingConfig");
    return class extends EventEmitter {
        constructor() {
            super();
            this.config = { ...cloneDefaultConfig(), enableTrading: true };
            this.init = jest.fn();
            this.update = jest.fn((changes) => Object.assign(this.config, changes));
        }
        get() { return this.config; }
        getPersistenceStatus() { return { durable: true }; }
    };
});
jest.mock("../src/services/OandaDataService", () => {
    const { EventEmitter } = require("events");
    const { normalizeOandaPrice } = require("../src/runtime/quoteAvailability");
    return class extends EventEmitter {
        constructor() {
            super();
            const fetchedAt = Date.now();
            this.prices = { AUD_USD: normalizeOandaPrice({
                instrument: "AUD_USD", bids: [{ price: "0.67" }], asks: [{ price: "0.6701" }],
                time: new Date(fetchedAt - 60_000).toISOString(), tradeable: true,
            }, { instrument: "AUD_USD", fetchedAt }) };
        }
        getAllPrices() { return this.prices; }
        getStatus() { return { isRunning: true, freshness: { pricesFresh: true, candlesFresh: true } }; }
    };
});
jest.mock("../src/services/LiveTradingEngine", () => {
    const { EventEmitter } = require("events");
    return class extends EventEmitter {
        constructor() { super(); this.isRunning = true; }
        init() {}
        getStatus() { return { isRunning: true, brokerStateUncertain: true }; }
        getBrokerEntryBlockReason() { return "Unresolved broker state in isolated fixture"; }
    };
});
jest.mock("../src/runtime/runtimeCoordinator", () => {
    const { EventEmitter } = require("events");
    return class extends EventEmitter {
        init() {}
        ensureLiveSelectionInitialized = jest.fn(async () => {});
        start = jest.fn(async () => {});
        getLiveSelection() { return null; }
        listRuns() { return []; }
        getStatus() { return { isRunning: true, lastRunTime: Date.now() }; }
    };
});
jest.mock("../src/repositories/tradeRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/signalRepository", () => jest.fn(() => ({ deleteOlderThan: jest.fn(async () => 0) })));
jest.mock("../src/repositories/entryDecisionRepository", () => jest.fn(() => ({ deleteOlderThan: jest.fn(async () => 0) })));
jest.mock("../src/repositories/strategyRunRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/portfolioRepository", () => jest.fn(() => ({ deleteOlderThan: jest.fn(async () => 0) })));
jest.mock("../src/repositories/brokerLifecycleRepository", () => jest.fn(() => ({})));
jest.mock("../src/services/emailService", () => ({ initialize: jest.fn() }));
jest.mock("../src/services/s3ReportScheduler", () => jest.fn(() => ({})));
jest.mock("../src/runtime/engineSupervisor", () => ({
    createEngineSupervisor: jest.fn(() => ({ ensureStarted: jest.fn() })),
}));
jest.mock("../src/services/operationalHealthService", () => ({
    OperationalHealthService: jest.fn(() => ({ start: jest.fn() })),
}));

describe("private internal-network app access", () => {
    let instance;
    let previousEnv;
    let previousListeners;

    beforeAll(async () => {
        previousEnv = { ...process.env };
        process.env.PORT = "0";
        process.env.CORS_ALLOWED_ORIGINS = "http://fx.oakroad";
        process.env.SIGNAL_RETENTION_DAYS = "14";
        process.env.ENTRY_DECISION_RETENTION_DAYS = "45";
        process.env.PORTFOLIO_SNAPSHOT_RETENTION_DAYS = "60";
        delete process.env.FOREX_OPERATOR_TOKEN;
        delete process.env.OANDA_API_KEY;
        delete process.env.OANDA_ACCOUNT_ID;
        previousListeners = Object.fromEntries(
            ["SIGTERM", "SIGINT"].map((name) => [name, process.listeners(name)])
        );
        const { Server } = require("http");
        const listen = Server.prototype.listen;
        const testListener = jest.spyOn(Server.prototype, "listen").mockImplementation(function (port, callback) {
            return listen.call(this, port, "127.0.0.1", callback);
        });
        try { instance = require("../server"); } finally { testListener.mockRestore(); }
        if (!instance.server.listening) {
            await new Promise((resolve, reject) => {
                instance.server.once("listening", resolve);
                instance.server.once("error", reject);
            });
        }
    });

    afterAll(async () => {
        if (instance) await new Promise((resolve) => instance.io.close(resolve));
        instance?.app.locals.liveOperator?.dispose();
        for (const [name, original] of Object.entries(previousListeners || {})) {
            for (const listener of process.listeners(name)) {
                if (!original.includes(listener)) process.removeListener(name, listener);
            }
        }
        process.env = previousEnv;
    });

    test("actual API exposes dashboard data without a token or session", async () => {
        const config = await request(instance.server).get("/api/config")
            .set("Origin", "http://fx.oakroad").expect(200);
        expect(config.body.strategy).toBe("multi_day_trend");
        expect(config.headers["access-control-allow-origin"]).toBe("http://fx.oakroad");
        const prices = await request(instance.server).get("/api/prices?instruments=AUD_USD").expect(200);
        expect(prices.body.prices[0].bid).toBe(0.67);
    });

    test("the operator dashboard exposes one versioned view with truthful unavailable sources", async () => {
        const config = instance.app.locals.configService.config;
        const assets = config.assets;
        config.assets = ["AUD_USD"];
        try {
            const { body } = await request(instance.server).get("/api/operator/dashboard").expect(200);
            expect(body).toMatchObject({ schemaVersion: 1, streamId: expect.any(String), publication: expect.any(Number),
                intent: { entriesEnabled: true, durable: true }, protection: { engineAttached: true },
                observations: { account: { status: "unavailable", observedAt: null }, prices: { status: "available" } } });
            expect(body.overview.prices[0]).toMatchObject({ instrument: "AUD_USD", bid: 0.67 });
            expect(body.overview.prices[0].fetchedAt - body.overview.prices[0].timestamp).toBe(60_000);
            expect(body.overview.account).toBeNull();
        } finally { config.assets = assets; }
    });

    test("actual server delegates ownership initialization and first scan to supervised attachment", async () => {
        const { createEngineSupervisor } = require("../src/runtime/engineSupervisor");
        const options = createEngineSupervisor.mock.calls[0][0];
        const coordinator = instance.app.locals.runtimeCoordinator;
        const priorCalls = coordinator.ensureLiveSelectionInitialized.mock.calls.length;
        await options.beforeStart();
        expect(coordinator.ensureLiveSelectionInitialized).toHaveBeenCalledTimes(priorCalls + 1);
        await options.onStarted();
        expect(coordinator.start).toHaveBeenCalledWith(instance.app.locals.dataService, 60000);
    });

    test("actual control route accepts pause without login", async () => {
        await request(instance.server).post("/api/trading/stop")
            .send({}).expect(200, { success: true, message: "Live entries disabled" });
        expect(instance.app.locals.configService.update).toHaveBeenCalledWith({ enableTrading: false });
        expect(instance.app.locals.configService.get().enableTrading).toBe(false);
    });

    test("operator commands preserve a confirmed pause and return structured activation rejection", async () => {
        const paused = await request(instance.server).post("/api/operator/entries/pause").send({}).expect(200);
        expect(paused.body).toMatchObject({ command: "pauseEntries", outcome: "accepted", success: true,
            refreshPending: true, view: { intent: { entriesEnabled: false, durable: true },
                entries: { state: "PAUSED" } } });
        const rejected = await request(instance.server).post("/api/operator/entries/enable").send({}).expect(409);
        expect(rejected.body).toMatchObject({ command: "enableEntries", outcome: "rejected", success: false,
            liveReadiness: { activationAllowed: false } });
        expect(instance.app.locals.configService.get().enableTrading).toBe(false);
    });

    test("login removal preserves trading readiness checks", async () => {
        const response = await request(instance.server).post("/api/trading/start").send({}).expect(409);
        expect(response.body.liveReadiness.reasons).toContainEqual(
            expect.objectContaining({ code: "BROKER_LIFECYCLE_UNRESOLVED" })
        );
        expect(instance.app.locals.configService.get().enableTrading).toBe(false);
    });

    test("removed login endpoints return normal API not-found responses", async () => {
        await request(instance.server).get("/api/auth/status").expect(404, { error: "Not found" });
        await request(instance.server).post("/api/auth/login").send({ token: "unused" }).expect(404);
    });

    test("actual server supplies health monitoring with inputs only, preserving visible risk state", async () => {
        const { OperationalHealthService: constructor } = require("../src/services/operationalHealthService");
        const options = constructor.mock.calls[0][0];
        expect(options).toEqual({ getInputs: expect.any(Function) });
        const { OperationalHealthService } = jest.requireActual("../src/services/operationalHealthService");
        const health = new OperationalHealthService(options);
        const snapshot = await health.check();
        expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: "BROKER_STATE_UNCERTAIN" }));
        expect(snapshot.entryState).toBe("PAUSED");
        expect(snapshot.entryBlockers).toContain("BROKER_STATE_UNCERTAIN");
        expect(snapshot.alerting).toBeUndefined();
    });

    test("actual Socket.IO handshake and dashboard updates work without credentials", async () => {
        const events = [];
        const url = `ws://127.0.0.1:${instance.server.address().port}/socket.io/?EIO=4&transport=websocket`;
        const socket = new WebSocket(url, { origin: "http://fx.oakroad" });
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("Socket.IO dashboard updates timed out")), 3000);
                const finish = (error) => {
                    clearTimeout(timeout);
                    error ? reject(error) : resolve();
                };
                socket.on("error", finish);
                socket.on("message", (buffer) => {
                    const packet = buffer.toString();
                    if (packet.startsWith("0")) socket.send("40");
                    if (packet === "2") socket.send("3");
                    if (!packet.startsWith("42")) return;
                    const event = JSON.parse(packet.slice(2));
                    events.push(event);
                    if (event[0] === "connected") {
                        socket.send('42["getPrices"]');
                        socket.send('42["operatorSubscribe"]');
                    }
                    if (events.some(([name]) => name === "operatorView") &&
                        events.some(([name]) => name === "engineStatus") &&
                        events.filter(([name]) => name === "priceUpdate").length === 2) finish();
                });
            });
            expect(events).toContainEqual(["connected", expect.objectContaining({
                message: "Connected to Forex Trading Bot",
            })]);
            expect(events.filter(([name]) => name === "priceUpdate")).toHaveLength(2);
            expect(events).toContainEqual(["operatorView", expect.objectContaining({
                schemaVersion: 1, streamId: expect.any(String), publication: expect.any(Number),
            })]);
            const response = await request(instance.server).get("/api/prices?instruments=AUD_USD").expect(200);
            for (const [, prices] of events.filter(([name]) => name === "priceUpdate")) {
                expect(prices.AUD_USD).toEqual(response.body.prices[0]);
                expect(prices.AUD_USD.fetchedAt - prices.AUD_USD.timestamp).toBe(60_000);
            }
        } finally {
            socket.terminate();
        }
    });

    test("operator subscriptions stop independently while the shared navigation socket stays connected", async () => {
        const events = [];
        const waiting = new Set();
        const socket = new WebSocket(`ws://127.0.0.1:${instance.server.address().port}/socket.io/?EIO=4&transport=websocket`);
        const waitFor = (predicate) => new Promise((resolve, reject) => {
            const check = () => {
                if (!predicate()) return;
                clearTimeout(timer);
                waiting.delete(check);
                resolve();
            };
            const timer = setTimeout(() => { waiting.delete(check); reject(new Error('Operator subscription event timed out')); }, 3000);
            waiting.add(check);
            check();
        });
        socket.on('message', (buffer) => {
            const packet = buffer.toString();
            if (packet.startsWith('0')) socket.send('40');
            if (packet === '2') socket.send('3');
            if (!packet.startsWith('42')) return;
            const event = JSON.parse(packet.slice(2));
            events.push(event);
            if (event[0] === 'connected') socket.send('42["getPrices"]');
            for (const check of [...waiting]) check();
        });
        try {
            await waitFor(() => events.filter(([name]) => name === 'priceUpdate').length === 2);
            expect(events.some(([name]) => name === 'operatorView')).toBe(false);
            socket.send('42["operatorSubscribe"]');
            await waitFor(() => events.some(([name, value]) => name === 'operatorSubscription' && value.active) &&
                events.some(([name]) => name === 'operatorView'));
            socket.send('42["operatorUnsubscribe"]');
            await waitFor(() => events.some(([name, value]) => name === 'operatorSubscription' && value.active === false));
            const stoppedAt = events.length;
            const previousPriceCount = events.filter(([name]) => name === 'priceUpdate').length;
            instance.app.locals.configService.emit('configChanged', instance.app.locals.configService.get());
            socket.send('42["getPrices"]');
            await waitFor(() => events.filter(([name]) => name === 'priceUpdate').length > previousPriceCount);
            expect(events.slice(stoppedAt).some(([name]) => name === 'operatorView')).toBe(false);
            expect(socket.readyState).toBe(WebSocket.OPEN);
        } finally { socket.terminate(); }
    });

    describe("live server retention checkpoint", () => {
        const { checkpointWal } = require("../src/maintenance/checkpointWal");
        const { db, dbPath } = require("../config/database");
        const logger = require("../src/utils/logger");
        const completedMessage = "WAL checkpoint (TRUNCATE) completed after retention sweep";

        beforeEach(() => {
            checkpointWal.mockReset();
            db.raw.mockClear();
            logger.info.mockClear();
            logger.warn.mockClear();
            logger.error.mockClear();
        });

        test("runs configured retention and delegates the configured database while the API remains available", async () => {
            let completeCheckpoint;
            checkpointWal.mockImplementationOnce(() => new Promise((resolve) => { completeCheckpoint = resolve; }));
            const retention = instance.runDataRetention();
            try {
                await request(instance.server).get("/api/config").expect(200);
                expect(instance.app.locals.signalRepository.deleteOlderThan).toHaveBeenCalledWith(14);
                expect(instance.app.locals.entryDecisionRepository.deleteOlderThan).toHaveBeenCalledWith(45);
                expect(instance.app.locals.portfolioRepository.deleteOlderThan).toHaveBeenCalledWith(60);
                expect(checkpointWal).toHaveBeenCalledWith(dbPath);
                expect(db.raw).not.toHaveBeenCalled();
                expect(logger.info).not.toHaveBeenCalledWith(completedMessage);
            } finally {
                completeCheckpoint?.({ busy: 0, log: 0, checkpointed: 0 });
                await retention;
            }
            expect(logger.info).toHaveBeenCalledWith(completedMessage);
        });

        test("a busy checkpoint is deferred without reporting completion or blocking the API", async () => {
            checkpointWal.mockResolvedValueOnce({ busy: 1, log: 12, checkpointed: 2 });
            await instance.runDataRetention();
            expect(logger.warn).toHaveBeenCalledWith(
                "Background WAL checkpoint deferred (readers/writers busy); will retry on next sweep"
            );
            expect(logger.info).not.toHaveBeenCalledWith(completedMessage);
            expect(db.raw).not.toHaveBeenCalled();
            await request(instance.server).get("/api/config").expect(200);
        });

        test("checkpoint failure is reported without false completion or escaping the retention task", async () => {
            checkpointWal.mockRejectedValueOnce(new Error("WAL checkpoint exceeded 5000ms deadline"));
            await expect(instance.runDataRetention()).resolves.toBeUndefined();
            expect(logger.error).toHaveBeenCalledWith(
                "Background WAL checkpoint after retention sweep failed:",
                "WAL checkpoint exceeded 5000ms deadline"
            );
            expect(logger.info).not.toHaveBeenCalledWith(completedMessage);
            expect(db.raw).not.toHaveBeenCalled();
        });
    });
});
