// Tests for HistoricalDataService - Oanda candle fetching, pagination, and caching
const fs = require("fs");
const path = require("path");
const os = require("os");
const HistoricalDataService = require("../historicalDataService");

// Helper to create mock Oanda candle response
const createOandaCandles = (count, startTime = 1696118400) => {
    const candles = [];
    for (let i = 0; i < count; i++) {
        const time = startTime + i * 900; // M15 = 900 seconds
        candles.push({
            complete: true,
            volume: 100 + i,
            time: time.toString(),
            mid: {
                o: (1.165 + i * 0.0001).toFixed(5),
                h: (1.166 + i * 0.0001).toFixed(5),
                l: (1.164 + i * 0.0001).toFixed(5),
                c: (1.1655 + i * 0.0001).toFixed(5),
            },
        });
    }
    return candles;
};

// Helper to create incomplete candle (should be filtered out)
const createIncompleteCandle = (time = 1696118400) => ({
    complete: false,
    volume: 50,
    time: time.toString(),
    mid: { o: "1.16500", h: "1.16600", l: "1.16400", c: "1.16550" },
});

describe("HistoricalDataService", () => {
    let service;
    let mockClient;
    let tempDir;

    beforeEach(() => {
        // Create temp directory for cache
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-test-"));

        // Mock Oanda client
        mockClient = {
            getCandles: jest.fn(),
        };

        service = new HistoricalDataService({
            cacheDir: tempDir,
            client: mockClient,
            requestDelayMs: 0, // No delay in tests
        });
    });

    afterEach(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe("getCandles", () => {
        test("should fetch candles from Oanda and return mapped data", async () => {
            const rawCandles = createOandaCandles(5);
            mockClient.getCandles.mockResolvedValueOnce({ candles: rawCandles });

            const from = 1696118400; // 2023-10-01
            const to = 1696122900;   // ~1.25 hours later

            const result = await service.getCandles("AUD_USD", "M15", from, to);

            expect(result).toHaveLength(5);
            expect(result[0]).toEqual({
                time: 1696118400,
                open: 1.165,
                high: 1.166,
                low: 1.164,
                close: 1.1655,
                volume: 100,
            });
        });

        test("should filter out incomplete candles", async () => {
            const candles = [
                ...createOandaCandles(3),
                createIncompleteCandle(1696118400 + 3 * 900),
            ];
            mockClient.getCandles.mockResolvedValueOnce({ candles });

            const result = await service.getCandles("AUD_USD", "M15", 1696118400, 1696122900);

            expect(result).toHaveLength(3);
        });

        test("should cache results to disk", async () => {
            const rawCandles = createOandaCandles(3);
            mockClient.getCandles.mockResolvedValueOnce({ candles: rawCandles });

            await service.getCandles("AUD_USD", "M15", 1696118400, 1696204800);

            // Verify cache file was created
            const files = fs.readdirSync(tempDir);
            expect(files).toHaveLength(1);
            expect(files[0]).toMatch(/^AUD_USD_M15_\d{8}_\d{8}\.json$/);
        });

        test("should return cached data on second call without hitting API", async () => {
            const rawCandles = createOandaCandles(3);
            mockClient.getCandles.mockResolvedValueOnce({ candles: rawCandles });

            const from = 1696118400;
            const to = 1696204800;

            // First call - fetches from API
            const result1 = await service.getCandles("AUD_USD", "M15", from, to);

            // Second call - should use cache
            const result2 = await service.getCandles("AUD_USD", "M15", from, to);

            expect(mockClient.getCandles).toHaveBeenCalledTimes(1);
            expect(result1).toEqual(result2);
        });

        test("should bypass cache when forceRefresh is true", async () => {
            const rawCandles = createOandaCandles(3);
            mockClient.getCandles.mockResolvedValue({ candles: rawCandles });

            const from = 1696118400;
            const to = 1696204800;

            await service.getCandles("AUD_USD", "M15", from, to);
            await service.getCandles("AUD_USD", "M15", from, to, { forceRefresh: true });

            expect(mockClient.getCandles).toHaveBeenCalledTimes(2);
        });

        test("should throw on missing parameters", async () => {
            await expect(service.getCandles(null, "M15", 100, 200))
                .rejects.toThrow("Missing required parameters");

            await expect(service.getCandles("AUD_USD", null, 100, 200))
                .rejects.toThrow("Missing required parameters");

            await expect(service.getCandles("AUD_USD", "M15", null, 200))
                .rejects.toThrow("Missing required parameters");

            await expect(service.getCandles("AUD_USD", "M15", 100, null))
                .rejects.toThrow("Missing required parameters");
        });

        test("should throw when fromTimestamp >= toTimestamp", async () => {
            await expect(service.getCandles("AUD_USD", "M15", 200, 100))
                .rejects.toThrow("fromTimestamp must be before toTimestamp");

            await expect(service.getCandles("AUD_USD", "M15", 100, 100))
                .rejects.toThrow("fromTimestamp must be before toTimestamp");
        });
    });

    describe("pagination", () => {
        test("should paginate when Oanda returns max candles per request", async () => {
            // First page returns MAX candles (5000)
            const page1 = createOandaCandles(5000, 1696118400);
            // Second page returns fewer candles (end of data)
            const page2StartTime = 1696118400 + 5000 * 900;
            const page2 = createOandaCandles(100, page2StartTime);

            mockClient.getCandles
                .mockResolvedValueOnce({ candles: page1 })
                .mockResolvedValueOnce({ candles: page2 });

            const from = 1696118400;
            const to = from + 6000 * 900; // More than 5000 candles worth

            const result = await service.getCandles("AUD_USD", "M15", from, to);

            expect(mockClient.getCandles).toHaveBeenCalledTimes(2);
            expect(result).toHaveLength(5100);
        });

        test("should stop pagination when API returns empty candles", async () => {
            const page1 = createOandaCandles(100);
            mockClient.getCandles
                .mockResolvedValueOnce({ candles: page1 })
                .mockResolvedValueOnce({ candles: [] });

            const from = 1696118400;
            const to = from + 200000 * 900;

            const result = await service.getCandles("AUD_USD", "M15", from, to);

            // Should stop after getting empty response, not keep requesting
            expect(result).toHaveLength(100);
        });

        test("should deduplicate candles across pages", async () => {
            // Page 1 and page 2 overlap by 1 candle
            const page1 = createOandaCandles(3, 1696118400);
            const overlappingCandle = createOandaCandles(1, 1696118400 + 2 * 900);
            const page2 = [...overlappingCandle, ...createOandaCandles(2, 1696118400 + 3 * 900)];

            mockClient.getCandles
                .mockResolvedValueOnce({ candles: page1 })
                .mockResolvedValueOnce({ candles: page2 });

            // Force pagination by making page1 look like it filled max
            const originalMax = 5000;
            // Use a service with lower max for testing pagination
            const from = 1696118400;
            const to = from + 10 * 900;

            const result = await service.getCandles("AUD_USD", "M15", from, to);

            // Should have unique candles only (no duplicates)
            const times = result.map((c) => c.time);
            const uniqueTimes = [...new Set(times)];
            expect(times.length).toBe(uniqueTimes.length);
        });

        test("should sort candles by time ascending", async () => {
            const candles = createOandaCandles(10);
            mockClient.getCandles.mockResolvedValueOnce({ candles });

            const result = await service.getCandles("AUD_USD", "M15", 1696118400, 1696204800);

            for (let i = 1; i < result.length; i++) {
                expect(result[i].time).toBeGreaterThan(result[i - 1].time);
            }
        });

        test("should pass from timestamp to Oanda API for count-based pagination", async () => {
            mockClient.getCandles.mockResolvedValueOnce({ candles: createOandaCandles(3) });

            const from = 1696118400;
            const to = 1696204800;

            await service.getCandles("AUD_USD", "M15", from, to);

            expect(mockClient.getCandles).toHaveBeenCalledWith(
                "AUD_USD",
                "M15",
                5000,
                { from: from.toString() }
            );
        });
    });

    describe("getCandlesMultiple", () => {
        test("should fetch candles for multiple instruments", async () => {
            const audCandles = createOandaCandles(3, 1696118400);
            const eurCandles = createOandaCandles(5, 1696118400);

            mockClient.getCandles
                .mockResolvedValueOnce({ candles: audCandles })
                .mockResolvedValueOnce({ candles: eurCandles });

            const result = await service.getCandlesMultiple(
                ["AUD_USD", "EUR_USD"],
                "M15",
                1696118400,
                1696204800
            );

            expect(Object.keys(result)).toEqual(["AUD_USD", "EUR_USD"]);
            expect(result["AUD_USD"]).toHaveLength(3);
            expect(result["EUR_USD"]).toHaveLength(5);
        });

        test("should fetch instruments sequentially (rate limiting)", async () => {
            const callOrder = [];
            mockClient.getCandles.mockImplementation(async (instrument) => {
                callOrder.push(instrument);
                return { candles: createOandaCandles(2) };
            });

            await service.getCandlesMultiple(
                ["AUD_USD", "EUR_USD", "GBP_USD"],
                "M15",
                1696118400,
                1696204800
            );

            expect(callOrder).toEqual(["AUD_USD", "EUR_USD", "GBP_USD"]);
        });
    });

    describe("listCache", () => {
        test("should list cached files", async () => {
            // Create some cache files
            const candles = createOandaCandles(3);
            mockClient.getCandles.mockResolvedValue({ candles });

            await service.getCandles("AUD_USD", "M15", 1696118400, 1696204800);
            await service.getCandles("EUR_USD", "M15", 1696118400, 1696204800);

            const cached = service.listCache();

            expect(cached).toHaveLength(2);
            expect(cached[0].instrument).toBe("AUD_USD");
            expect(cached[0].granularity).toBe("M15");
            expect(cached[1].instrument).toBe("EUR_USD");
        });

        test("should return empty array when no cache exists", () => {
            // Remove the temp dir to simulate no cache
            fs.rmSync(tempDir, { recursive: true, force: true });

            const cached = service.listCache();
            expect(cached).toEqual([]);
        });
    });

    describe("clearCache", () => {
        test("should clear all cached files", async () => {
            const candles = createOandaCandles(3);
            mockClient.getCandles.mockResolvedValue({ candles });

            await service.getCandles("AUD_USD", "M15", 1696118400, 1696204800);
            await service.getCandles("EUR_USD", "M15", 1696118400, 1696204800);

            const deleted = service.clearCache();

            expect(deleted).toBe(2);
            expect(fs.readdirSync(tempDir)).toHaveLength(0);
        });

        test("should clear cache for specific instrument only", async () => {
            const candles = createOandaCandles(3);
            mockClient.getCandles.mockResolvedValue({ candles });

            await service.getCandles("AUD_USD", "M15", 1696118400, 1696204800);
            await service.getCandles("EUR_USD", "M15", 1696118400, 1696204800);

            const deleted = service.clearCache("AUD_USD");

            expect(deleted).toBe(1);
            const remaining = fs.readdirSync(tempDir);
            expect(remaining).toHaveLength(1);
            expect(remaining[0]).toMatch(/^EUR_USD/);
        });

        test("should return 0 when no cache directory exists", () => {
            fs.rmSync(tempDir, { recursive: true, force: true });

            const deleted = service.clearCache();
            expect(deleted).toBe(0);
        });
    });

    describe("error handling", () => {
        test("should propagate Oanda API errors", async () => {
            mockClient.getCandles.mockRejectedValueOnce(
                new Error("Oanda API Error (429): Rate limit exceeded")
            );

            await expect(
                service.getCandles("AUD_USD", "M15", 1696118400, 1696204800)
            ).rejects.toThrow("Rate limit exceeded");
        });

        test("should handle API returning undefined candles", async () => {
            mockClient.getCandles.mockResolvedValueOnce({});

            const result = await service.getCandles("AUD_USD", "M15", 1696118400, 1696204800);

            expect(result).toEqual([]);
        });
    });

    describe("_formatDate", () => {
        test("should format UNIX timestamp as ISO date", () => {
            // 2023-10-01 00:00:00 UTC
            expect(service._formatDate(1696118400)).toBe("2023-10-01");
        });
    });

    describe("_formatDateCompact", () => {
        test("should format UNIX timestamp as compact date", () => {
            expect(service._formatDateCompact(1696118400)).toBe("20231001");
        });
    });
});
