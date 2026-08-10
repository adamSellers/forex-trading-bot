const ValidationMiddleware = require("../validation");

describe("ValidationMiddleware.validateTradingConfig", () => {
    function createResponse() {
        return {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    }

    test("accepts the deployed live strategy", () => {
        const req = {
            body: {
                strategy: "intraday_momentum",
            },
        };
        const res = createResponse();
        const next = jest.fn();

        ValidationMiddleware.validateTradingConfig(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    test("rejects every retired strategy alias", () => {
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
                    "Invalid strategy. This release supports intraday_momentum only.",
                ],
            })
        );
    });

    test("rejects retired strategy keys in the live config path", () => {
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
                    "Invalid strategy. This release supports intraday_momentum only.",
                ],
            })
        );
    });
});
