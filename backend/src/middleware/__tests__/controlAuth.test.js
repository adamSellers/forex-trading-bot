const {
    createControlAuth,
    getRequiredControlRole,
    timingSafeTokenEqual,
} = require("../controlAuth");

function createContext({ method = "POST", path = "/trading/stop", token = "" } = {}) {
    const req = {
        method,
        path,
        get: jest.fn((header) => {
            if (header.toLowerCase() === "authorization" && token) {
                return `Bearer ${token}`;
            }
            return undefined;
        }),
    };
    const res = {
        statusCode: 200,
        body: null,
        status: jest.fn(function status(code) {
            this.statusCode = code;
            return this;
        }),
        json: jest.fn(function json(payload) {
            this.body = payload;
            return this;
        }),
        set: jest.fn(),
    };
    const next = jest.fn();
    return { req, res, next };
}

describe("controlAuth", () => {
    test("leaves read-only endpoints public", () => {
        const { req, res, next } = createContext({ method: "GET", path: "/health" });
        createControlAuth({ env: { NODE_ENV: "production" } })(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test("fails closed when no control credential is configured", () => {
        const { req, res, next } = createContext();
        createControlAuth({ env: { NODE_ENV: "production" } })(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.body.code).toBe("CONTROL_AUTH_NOT_CONFIGURED");
    });

    test("requires a 32-character credential in production", () => {
        const token = "too-short";
        const { req, res, next } = createContext({ token });
        createControlAuth({
            env: { NODE_ENV: "production", CONTROL_API_TOKEN: token },
        })(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
    });

    test("allows an operator to pause trading but not activate it", () => {
        const token = "operator-token-with-at-least-32-characters";
        const env = { NODE_ENV: "production", CONTROL_API_OPERATOR_TOKEN: token };
        const stop = createContext({ path: "/trading/stop", token });
        createControlAuth({ env })(stop.req, stop.res, stop.next);
        expect(stop.next).toHaveBeenCalled();

        const start = createContext({ path: "/trading/start", token });
        createControlAuth({ env })(start.req, start.res, start.next);
        expect(start.res.status).toHaveBeenCalledWith(403);
        expect(start.res.body.requiredRole).toBe("admin");
    });

    test("allows an admin credential to mutate high-impact controls", () => {
        const token = "admin-token-with-at-least-32-characters---";
        const { req, res, next } = createContext({
            path: "/runtime/runs/run-1/promote",
            token,
        });
        createControlAuth({
            env: { NODE_ENV: "production", CONTROL_API_ADMIN_TOKEN: token },
        })(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.controlAuth.role).toBe("admin");
        expect(res.status).not.toHaveBeenCalled();
    });

    test("classifies live activation and configuration as admin operations", () => {
        expect(getRequiredControlRole({ method: "POST", path: "/trading/start" })).toBe("admin");
        expect(getRequiredControlRole({ method: "POST", path: "/config" })).toBe("admin");
        expect(getRequiredControlRole({ method: "POST", path: "/engine/sync" })).toBe("operator");
    });

    test("compares credential digests safely", () => {
        expect(timingSafeTokenEqual("abc", "abc")).toBe(true);
        expect(timingSafeTokenEqual("abc", "abcd")).toBe(false);
    });
});
