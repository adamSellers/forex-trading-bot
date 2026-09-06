const express = require("express");
const request = require("supertest");
const { createOperatorAuth } = require("../operatorAuth");
const { SESSION_DURATION_MS } = require("../../services/operatorAuthService");

const TOKEN = "a3".repeat(32);
const ORIGIN = "https://fx.example";

function harness(env = {}, options = {}) {
    const auth = createOperatorAuth({
        env: { NODE_ENV: "production", FOREX_OPERATOR_TOKEN: TOKEN, CORS_ORIGIN: ORIGIN, ...env },
        ...options,
    });
    const app = express();
    app.set("trust proxy", "loopback");
    app.use(express.json());
    app.get("/api/liveness", (_req, res) => res.json({ status: "ok" }));
    app.use("/api/auth", auth.router);
    app.use("/api", auth.middleware);
    const brokerClose = jest.fn();
    app.get("/api/account", (_req, res) => res.json({ balance: 100 }));
    app.post("/api/trade/close/123", (_req, res) => {
        brokerClose();
        res.json({ success: true });
    });
    return { app, auth, brokerClose };
}

async function login(app) {
    const result = await request(app).post("/api/auth/login")
        .set("Origin", ORIGIN).send({ token: TOKEN }).expect(200);
    return { result, cookie: result.headers["set-cookie"][0].split(";")[0] };
}

describe("Operator authentication boundary", () => {
    test.each(["", "short", "x".repeat(64)])("missing or invalid configured token fails closed: %s", async (token) => {
        const { app, brokerClose } = harness({ FOREX_OPERATOR_TOKEN: token });
        await request(app).get("/api/liveness").expect(200, { status: "ok" });
        const status = await request(app).get("/api/auth/status").expect(503);
        expect(status.body).toMatchObject({ configured: false, authenticated: false, code: "OPERATOR_SETUP_REQUIRED" });
        await request(app).get("/api/account").expect(503);
        await request(app).post("/api/trade/close/123").expect(503);
        expect(brokerClose).not.toHaveBeenCalled();
    });

    test("protects both account reads and broker mutations without credentials", async () => {
        const { app, brokerClose } = harness();
        await request(app).get("/api/account").expect(401);
        await request(app).post("/api/trade/close/123").expect(401);
        await request(app).post("/api/trade/close/123").set("Authorization", "Bearer wrong").expect(401);
        expect(brokerClose).not.toHaveBeenCalled();
    });

    test("scripts can use bearer authentication without browser headers", async () => {
        const { app, brokerClose } = harness();
        await request(app).get("/api/account").set("Authorization", `Bearer ${TOKEN}`).expect(200);
        await request(app).post("/api/trade/close/123").set("Authorization", `Bearer ${TOKEN}`).expect(200);
        expect(brokerClose).toHaveBeenCalledTimes(1);
    });

    test("login issues an opaque HttpOnly Strict session instead of returning the credential", async () => {
        const { app } = harness();
        const { cookie, result } = await login(app);
        expect(result.headers["set-cookie"][0]).toContain("HttpOnly");
        expect(result.headers["set-cookie"][0]).toContain("SameSite=Strict");
        expect(result.headers["set-cookie"][0]).not.toContain(TOKEN);
        expect(JSON.stringify(result.body)).not.toContain(TOKEN);
        expect(result.headers["cache-control"]).toBe("no-store");
        await request(app).get("/api/account").set("Cookie", cookie).expect(200);
    });

    test("rejects cross-origin and missing-origin cookie mutations before the broker handler", async () => {
        const { app, brokerClose } = harness();
        const { cookie } = await login(app);
        await request(app).post("/api/trade/close/123").set("Cookie", cookie)
            .set("Origin", "https://evil.example").expect(403);
        await request(app).post("/api/trade/close/123").set("Cookie", cookie).expect(403);
        expect(brokerClose).not.toHaveBeenCalled();
        await request(app).post("/api/trade/close/123").set("Cookie", cookie).set("Origin", ORIGIN).expect(200);
        expect(brokerClose).toHaveBeenCalledTimes(1);
    });

    test("login rejects cross-origin forms and limits bad-token attempts", async () => {
        const { app } = harness();
        await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ token: TOKEN }).expect(403);
        await request(app).post("/api/auth/login").set("Origin", ORIGIN).type("form").send({ token: TOKEN }).expect(415);
        for (let count = 0; count < 10; count += 1) {
            await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ token: "bad" }).expect(401);
        }
        await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ token: TOKEN }).expect(429);
    });

    test("HTTPS behind a loopback proxy receives Secure cookies; required HTTPS rejects plaintext login", async () => {
        const { app } = harness({ FOREX_AUTH_SECURE_COOKIE: "true" });
        await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ token: TOKEN }).expect(503);
        const response = await request(app).post("/api/auth/login").set("Origin", ORIGIN)
            .set("X-Forwarded-Proto", "https").send({ token: TOKEN }).expect(200);
        expect(response.headers["set-cookie"][0]).toContain("Secure");
    });

    test("expiry, logout and process restart revoke sessions", async () => {
        let now = 100000;
        const { app, auth } = harness({}, { now: () => now });
        const { cookie } = await login(app);
        const revoked = jest.fn();
        auth.service.on("sessionRevoked", revoked);
        now += SESSION_DURATION_MS + 1;
        await request(app).get("/api/account").set("Cookie", cookie).expect(401);
        expect(revoked).toHaveBeenCalledTimes(1);
        const next = await login(app);
        await request(harness().app).get("/api/account").set("Cookie", next.cookie).expect(401);
        await request(app).post("/api/auth/logout").set("Origin", ORIGIN).set("Cookie", next.cookie).expect(200);
        await request(app).get("/api/account").set("Cookie", next.cookie).expect(401);
    });

    test("Socket.IO rejects anonymous/cross-origin access and disconnects revoked sessions", async () => {
        const { app, auth } = harness();
        const { cookie } = await login(app);
        const denied = jest.fn();
        auth.socketMiddleware({ request: { headers: {} }, data: {} }, denied);
        expect(denied.mock.calls[0][0].data.code).toBe("AUTH_REQUIRED");
        const crossOrigin = jest.fn();
        auth.socketMiddleware({ request: { headers: { cookie, origin: "https://evil.example" } }, data: {} }, crossOrigin);
        expect(crossOrigin.mock.calls[0][0]).toBeInstanceOf(Error);
        const socket = { request: { headers: { cookie, origin: ORIGIN } }, data: {} };
        const allowed = jest.fn();
        auth.socketMiddleware(socket, allowed);
        expect(allowed).toHaveBeenCalledWith();
        expect(socket.data.operatorIdentity.method).toBe("session");
        const disconnectSockets = jest.fn();
        const io = { use: jest.fn(), on: jest.fn(), in: jest.fn(() => ({ disconnectSockets })) };
        auth.attachSocketServer(io);
        auth.service.revoke(socket.data.operatorIdentity.sessionId);
        expect(io.in).toHaveBeenCalledWith(`operator-session:${socket.data.operatorIdentity.sessionId}`);
        expect(disconnectSockets).toHaveBeenCalledWith(true);
    });
});
