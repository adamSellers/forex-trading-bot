const crypto = require("crypto");
const EventEmitter = require("events");
const { parseAllowedOrigins } = require("../middleware/corsPolicy");

const SESSION_COOKIE = "forex_operator_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const digest = (value) => crypto.createHash("sha256").update(value).digest();

// Sessions are deliberately process-local: restart or token rotation requires
// a new login. The operator credential never becomes the browser cookie.
class OperatorAuthService extends EventEmitter {
    constructor({ env = process.env, now = Date.now } = {}) {
        super();
        const token = String(env.FOREX_OPERATOR_TOKEN || "").trim();
        this.configured = /^[a-fA-F0-9]{64}$/.test(token);
        this.tokenDigest = this.configured ? digest(token) : null;
        this.requireSecureCookie = env.FOREX_AUTH_SECURE_COOKIE === "true";
        this.allowedOrigins = new Set(parseAllowedOrigins(env));
        this.now = now;
        this.sessions = new Map();
        this.loginAttempts = new Map();
    }

    validToken(token) {
        return this.configured && typeof token === "string" &&
            token.length <= 256 &&
            crypto.timingSafeEqual(this.tokenDigest, digest(token.trim()));
    }

    allowedOrigin(request, required = false) {
        const origin = request.headers?.origin;
        if (!origin) return !required;
        return this.allowedOrigins.has(String(origin).replace(/\/$/, ""));
    }

    cookieValue(request) {
        const cookie = String(request.headers?.cookie || "")
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
        return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
    }

    authenticate(request) {
        if (!this.configured) return null;
        const authorization = request.headers?.authorization;
        if (authorization) {
            const match = /^Bearer ([^\s]+)$/i.exec(authorization);
            return match && this.validToken(match[1]) ? { method: "bearer" } : null;
        }
        const value = this.cookieValue(request);
        if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
        const sessionId = digest(value).toString("hex");
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        if (session.expiresAt <= this.now()) {
            this.revoke(sessionId);
            return null;
        }
        return { method: "session", sessionId, expiresAt: session.expiresAt };
    }

    takeLoginAttempt(address) {
        const now = this.now();
        for (const [key, value] of this.loginAttempts) {
            if (value.until <= now) this.loginAttempts.delete(key);
        }
        let attempts = this.loginAttempts.get(address);
        if (!attempts) {
            // Bound memory even if a proxy supplies many distinct client IPs.
            if (this.loginAttempts.size >= 1024) return false;
            attempts = { count: 0, until: now + LOGIN_WINDOW_MS };
            this.loginAttempts.set(address, attempts);
        }
        attempts.count += 1;
        return attempts.count <= MAX_LOGIN_ATTEMPTS;
    }

    createSession() {
        for (const [id, session] of this.sessions) {
            if (session.expiresAt <= this.now()) this.revoke(id);
        }
        // Evict the oldest session instead of allowing unbounded memory use.
        if (this.sessions.size >= 256) this.revoke(this.sessions.keys().next().value);
        const value = crypto.randomBytes(32).toString("hex");
        const sessionId = digest(value).toString("hex");
        const expiresAt = this.now() + SESSION_DURATION_MS;
        this.sessions.set(sessionId, { expiresAt });
        return { value, sessionId, expiresAt };
    }

    revoke(sessionId) {
        if (sessionId && this.sessions.delete(sessionId)) {
            this.emit("sessionRevoked", sessionId);
        }
    }

    cookieOptions(request) {
        return {
            httpOnly: true,
            sameSite: "strict",
            secure: this.requireSecureCookie || request.secure === true,
            path: "/",
            maxAge: SESSION_DURATION_MS,
        };
    }
}

module.exports = { OperatorAuthService, SESSION_COOKIE, SESSION_DURATION_MS };
