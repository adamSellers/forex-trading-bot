const ValidationMiddleware = require("../validation");

describe("ValidationMiddleware.validateTradingConfig", () => {
    function createResponse() {
        return {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    }

    test("accepts the extracted Phase 1 baseline strategy", () => {
        const req = {
            body: {
                strategy: "supertrend_momentum",
            },
        };
        const res = createResponse();
        const next = jest.fn();

        ValidationMiddleware.validateTradingConfig(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    test("rejects legacy strategy aliases", () => {
        const req = {
            body: {
                strategy: "balanced",
            },
        };
        const res = createResponse();
        const next = jest.fn();

        ValidationMiddleware.validateTradingConfig(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: "Validation failed",
                details: [
                    "Legacy strategy aliases are no longer supported. Use supertrend_momentum.",
                ],
            })
        );
    });

    test("rejects unimplemented strategy keys in the live config path", () => {
        const req = {
            body: {
                strategy: "mean_reversion",
            },
        };
        const res = createResponse();
        const next = jest.fn();

        ValidationMiddleware.validateTradingConfig(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: "Validation failed",
                details: [
                    "Invalid strategy. Phase 1 live runtime currently supports supertrend_momentum only.",
                ],
            })
        );
    });
});
