const {
    mapCandle,
    parseArgs,
    toUnixSeconds,
} = require("../fetchReplayDataset");

describe("fetchReplayDataset", () => {
    test("maps only complete MBA candles", () => {
        const raw = {
            time: "1710000000",
            complete: true,
            volume: 12,
            mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.15" },
            bid: { o: "1.09", h: "1.19", l: "0.99", c: "1.14" },
            ask: { o: "1.11", h: "1.21", l: "1.01", c: "1.16" },
        };

        expect(mapCandle(raw)).toEqual(
            expect.objectContaining({
                time: 1710000000,
                complete: true,
                open: 1.1,
                close: 1.15,
                bid: expect.objectContaining({ c: 1.14 }),
                ask: expect.objectContaining({ c: 1.16 }),
            })
        );
        expect(mapCandle({ ...raw, complete: false })).toBeNull();
    });

    test("parses flags and ISO timestamps", () => {
        expect(parseArgs(["--from", "2026-01-01", "--append"])).toEqual({
            from: "2026-01-01",
            append: true,
        });
        expect(toUnixSeconds("2026-01-01T00:00:00Z", "from")).toBe(
            1767225600
        );
    });
});
