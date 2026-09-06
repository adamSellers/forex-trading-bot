const DEVELOPMENT_ORIGINS = Object.freeze([
    "http://localhost:3100",
    "http://localhost:3101",
    "http://localhost:5173",
    "http://127.0.0.1:3100",
    "http://127.0.0.1:3101",
    "http://127.0.0.1:5173",
]);

function parseAllowedOrigins(env = process.env) {
    const configured = String(
        env.CORS_ALLOWED_ORIGINS || env.CORS_ORIGIN || ""
    )
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);

    if (configured.length > 0) {
        return configured;
    }

    return env.NODE_ENV === "production" ? [] : [...DEVELOPMENT_ORIGINS];
}

function createCorsOptions(env = process.env) {
    const allowedOrigins = new Set(parseAllowedOrigins(env));

    return {
        origin(origin, callback) {
            // Requests without Origin include same-origin navigation, health
            // probes, and CLI clients. Authentication is enforced separately.
            // Cross-origin browsers
            // must be explicitly allowlisted.
            if (!origin || allowedOrigins.has(String(origin).replace(/\/$/, ""))) {
                return callback(null, true);
            }
            return callback(null, false);
        },
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Control-Token"],
        credentials: true,
        maxAge: 600,
    };
}

module.exports = {
    DEVELOPMENT_ORIGINS,
    createCorsOptions,
    parseAllowedOrigins,
};
