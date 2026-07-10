const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ROLE_LEVEL = Object.freeze({
    operator: 1,
    admin: 2,
});

function normalizeToken(value) {
    return typeof value === "string" ? value.trim() : "";
}

function getPresentedToken(req = {}) {
    const authorization = normalizeToken(req.get?.("authorization"));
    if (/^Bearer\s+/i.test(authorization)) {
        return normalizeToken(authorization.replace(/^Bearer\s+/i, ""));
    }

    return normalizeToken(req.get?.("x-control-token"));
}

function timingSafeTokenEqual(left, right) {
    const leftDigest = crypto
        .createHash("sha256")
        .update(String(left || ""))
        .digest();
    const rightDigest = crypto
        .createHash("sha256")
        .update(String(right || ""))
        .digest();

    return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function loadControlCredentials(env = process.env) {
    const credentials = [];
    const adminToken = normalizeToken(
        env.CONTROL_API_ADMIN_TOKEN ||
            env.CONTROL_API_TOKEN ||
            env.TRADING_API_TOKEN
    );
    const operatorToken = normalizeToken(env.CONTROL_API_OPERATOR_TOKEN);

    if (adminToken) {
        credentials.push({ role: "admin", token: adminToken });
    }
    if (
        operatorToken &&
        !credentials.some((credential) =>
            timingSafeTokenEqual(credential.token, operatorToken)
        )
    ) {
        credentials.push({ role: "operator", token: operatorToken });
    }

    return credentials;
}

function getRequiredControlRole(req = {}) {
    const path = String(req.path || req.originalUrl || "").split("?")[0];
    const method = String(req.method || "GET").toUpperCase();

    if (SAFE_METHODS.has(method)) return null;

    const adminOnly = [
        /^\/trading\/start$/,
        /^\/runtime\/live-selection$/,
        /^\/runtime\/runs\/[^/]+\/promote$/,
        /^\/config(?:\/|$)/,
        /^\/runtime\/paper\/reset$/,
    ];

    return adminOnly.some((pattern) => pattern.test(path))
        ? "admin"
        : "operator";
}

function isCredentialConfigurationSecure(credentials, env = process.env) {
    if (credentials.length === 0) return false;
    if (env.NODE_ENV !== "production") return true;

    return credentials.every((credential) => credential.token.length >= 32);
}

function createControlAuth(options = {}) {
    const env = options.env || process.env;

    return function controlAuth(req, res, next) {
        const requiredRole = getRequiredControlRole(req);
        if (!requiredRole) return next();

        const credentials = loadControlCredentials(env);
        if (!isCredentialConfigurationSecure(credentials, env)) {
            return res.status(503).json({
                error: "Control API authentication is not configured securely",
                code: "CONTROL_AUTH_NOT_CONFIGURED",
            });
        }

        const presentedToken = getPresentedToken(req);
        const credential = credentials.find((candidate) =>
            timingSafeTokenEqual(candidate.token, presentedToken)
        );

        if (!credential) {
            res.set?.("WWW-Authenticate", 'Bearer realm="forex-control"');
            return res.status(401).json({
                error: "Valid control API credentials are required",
                code: "CONTROL_AUTH_REQUIRED",
            });
        }

        if (ROLE_LEVEL[credential.role] < ROLE_LEVEL[requiredRole]) {
            return res.status(403).json({
                error: `${requiredRole} control authorization is required`,
                code: "CONTROL_AUTH_FORBIDDEN",
                requiredRole,
            });
        }

        req.controlAuth = {
            role: credential.role,
            authenticated: true,
        };
        return next();
    };
}

module.exports = {
    SAFE_METHODS,
    createControlAuth,
    getPresentedToken,
    getRequiredControlRole,
    isCredentialConfigurationSecure,
    loadControlCredentials,
    timingSafeTokenEqual,
};
