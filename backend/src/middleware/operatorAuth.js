const express = require("express");
const { OperatorAuthService, SESSION_COOKIE } = require("../services/operatorAuthService");

const SETUP_REQUIRED = {
    error: "Operator access is not configured. Configure FOREX_OPERATOR_TOKEN before using the application.",
    code: "OPERATOR_SETUP_REQUIRED",
};

function createOperatorAuth(options = {}) {
    const service = new OperatorAuthService(options);
    const router = express.Router();
    router.use((_req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
    });

    router.get("/status", (req, res) => {
        const identity = service.authenticate(req);
        res.status(service.configured ? 200 : 503).json({
            configured: service.configured,
            authenticated: Boolean(identity),
            expiresAt: identity?.expiresAt || null,
            requiresHttps: service.requireSecureCookie && !req.secure,
            ...(!service.configured ? SETUP_REQUIRED : {}),
        });
    });

    router.post("/login", (req, res) => {
        if (!service.configured) return res.status(503).json(SETUP_REQUIRED);
        if (!service.allowedOrigin(req, true)) {
            return res.status(403).json({ error: "This browser origin is not permitted", code: "ORIGIN_DENIED" });
        }
        if (service.requireSecureCookie && !req.secure) {
            return res.status(503).json({ error: "Use the HTTPS dashboard to sign in", code: "HTTPS_REQUIRED" });
        }
        if (!req.is("application/json")) {
            return res.status(415).json({ error: "Login requires JSON" });
        }
        if (!service.takeLoginAttempt(req.ip || "unknown")) {
            res.set("Retry-After", "60");
            return res.status(429).json({ error: "Too many sign-in attempts. Try again in one minute." });
        }
        if (!service.validToken(req.body?.token)) {
            return res.status(401).json({ error: "Invalid operator access token", code: "AUTH_REQUIRED" });
        }
        const previous = service.authenticate(req);
        if (previous?.method === "session") service.revoke(previous.sessionId);
        const session = service.createSession();
        res.cookie(SESSION_COOKIE, session.value, service.cookieOptions(req));
        res.json({ authenticated: true, expiresAt: session.expiresAt });
    });

    function middleware(req, res, next) {
        res.set("Cache-Control", "no-store");
        if (!service.configured) return res.status(503).json(SETUP_REQUIRED);
        const identity = service.authenticate(req);
        if (!identity) return res.status(401).json({ error: "Operator sign-in required", code: "AUTH_REQUIRED" });
        const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
        if (!service.allowedOrigin(req, mutation && identity.method === "session")) {
            return res.status(403).json({ error: "This request origin is not permitted", code: "ORIGIN_DENIED" });
        }
        req.operatorIdentity = identity;
        next();
    }

    router.post("/logout", middleware, (req, res) => {
        service.revoke(req.operatorIdentity.sessionId);
        const { maxAge, ...cookieOptions } = service.cookieOptions(req);
        res.clearCookie(SESSION_COOKIE, cookieOptions);
        res.json({ authenticated: false });
    });

    function socketMiddleware(socket, next) {
        const identity = service.authenticate(socket.request);
        if (!service.configured || !identity || !service.allowedOrigin(socket.request, identity.method === "session")) {
            const error = new Error(service.configured ? "Operator sign-in required" : SETUP_REQUIRED.error);
            error.data = { code: service.configured ? "AUTH_REQUIRED" : "OPERATOR_SETUP_REQUIRED" };
            return next(error);
        }
        socket.data.operatorIdentity = identity;
        next();
    }

    function trackSocket(socket) {
        const identity = socket.data.operatorIdentity;
        if (identity?.method !== "session") return;
        socket.join(`operator-session:${identity.sessionId}`);
        const expiry = setTimeout(() => {
            service.revoke(identity.sessionId);
            socket.disconnect(true);
        }, Math.max(0, identity.expiresAt - service.now()));
        expiry.unref?.();
        socket.once("disconnect", () => clearTimeout(expiry));
    }

    function attachSocketServer(io) {
        io.use(socketMiddleware);
        io.on("connection", trackSocket);
        service.on("sessionRevoked", (sessionId) => {
            io.in(`operator-session:${sessionId}`).disconnectSockets(true);
        });
    }

    return { service, router, middleware, socketMiddleware, attachSocketServer };
}

module.exports = { createOperatorAuth };
