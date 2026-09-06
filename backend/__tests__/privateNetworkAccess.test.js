const request = require("supertest");
const WebSocket = require("ws");

// Exercise server.js and its real Express/Socket.IO wiring, with all external
// effects replaced before import. Never read .env, open a database, or contact
// the broker, email provider or report storage from this regression.
jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("../config/database", () => ({ db: {} }));
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
    return class extends EventEmitter {
        getAllPrices() { return { AUD_USD: { instrument: "AUD_USD", bid: 0.67, ask: 0.6701, timestamp: Date.now() } }; }
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
        getLiveSelection() { return null; }
        listRuns() { return []; }
    };
});
jest.mock("../src/repositories/tradeRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/signalRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/entryDecisionRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/strategyRunRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/portfolioRepository", () => jest.fn(() => ({})));
jest.mock("../src/repositories/brokerLifecycleRepository", () => jest.fn(() => ({})));
jest.mock("../src/services/emailService", () => ({ initialize: jest.fn() }));
jest.mock("../src/services/s3ReportScheduler", () => jest.fn(() => ({})));
jest.mock("../src/runtime/engineSupervisor", () => ({
    createEngineSupervisor: () => ({ ensureStarted: jest.fn() }),
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
        expect(config.body.strategy).toBe("intraday_momentum");
        expect(config.headers["access-control-allow-origin"]).toBe("http://fx.oakroad");
        const prices = await request(instance.server).get("/api/prices?instruments=AUD_USD").expect(200);
        expect(prices.body.prices[0].bid).toBe(0.67);
    });

    test("actual control route accepts pause without login", async () => {
        await request(instance.server).post("/api/trading/stop")
            .send({}).expect(200, { success: true, message: "Live entries disabled" });
        expect(instance.app.locals.configService.update).toHaveBeenCalledWith({ enableTrading: false });
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
                    if (event[0] === "connected") socket.send('42["getPrices"]');
                    if (events.some(([name]) => name === "engineStatus") &&
                        events.filter(([name]) => name === "priceUpdate").length === 2) finish();
                });
            });
            expect(events).toContainEqual(["connected", expect.objectContaining({
                message: "Connected to Forex Trading Bot",
            })]);
            expect(events.filter(([name]) => name === "priceUpdate")).toHaveLength(2);
        } finally {
            socket.terminate();
        }
    });
});
