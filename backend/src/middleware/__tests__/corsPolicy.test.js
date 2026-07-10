const { createCorsOptions, parseAllowedOrigins } = require("../corsPolicy");

describe("corsPolicy", () => {
    test("has no implicit cross-origin production allowlist", () => {
        expect(parseAllowedOrigins({ NODE_ENV: "production" })).toEqual([]);
    });

    test("parses an explicit, restricted origin allowlist", () => {
        expect(
            parseAllowedOrigins({
                NODE_ENV: "production",
                CORS_ALLOWED_ORIGINS: "https://ops.example, https://backup.example/",
            })
        ).toEqual(["https://ops.example", "https://backup.example"]);
    });

    test("allows configured origins and declines unknown origins", () => {
        const options = createCorsOptions({
            NODE_ENV: "production",
            CORS_ALLOWED_ORIGINS: "https://ops.example",
        });
        const allowed = jest.fn();
        const denied = jest.fn();

        options.origin("https://ops.example", allowed);
        options.origin("https://evil.example", denied);

        expect(allowed).toHaveBeenCalledWith(null, true);
        expect(denied).toHaveBeenCalledWith(null, false);
    });
});
