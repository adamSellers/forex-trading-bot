const {
    MarketReplayEngine,
    countNewYorkRollovers,
    normalizeDataset,
} = require("../marketReplayEngine");

function candle(time, open, high, low, close, extra = {}) {
    return { time, open, high, low, close, complete: true, ...extra };
}

describe("MarketReplayEngine", () => {
    test("fills a close signal at the next bar and resolves ambiguous bars conservatively", async () => {
        const engine = new MarketReplayEngine({
            strategy: ({ candles }) =>
                candles.length === 1
                    ? {
                        signal: "BUY",
                        units: 1000,
                        stopDistancePips: 10,
                        riskReward: 1,
                    }
                    : { signal: "HOLD" },
            config: {
                startingBalanceAud: 10000,
                defaultSpreadPips: 2,
                slippagePips: 0,
            },
        });
        const firstTime = Date.parse("2026-07-01T00:00:00Z");
        const secondTime = Date.parse("2026-07-01T00:15:00Z");
        const result = await engine.run({
            AUD_USD: [
                candle(firstTime, 0.65, 0.6505, 0.6495, 0.65),
                candle(secondTime, 0.65, 0.652, 0.648, 0.65),
            ],
        });

        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].signalTime).toBe(firstTime);
        expect(result.trades[0].openedAt).toBe(secondTime);
        expect(result.trades[0].exitReason).toBe("STOP_LOSS_AMBIGUOUS");
        expect(result.trades[0].netPnlAud).toBeLessThan(0);
        expect(result.referenceCurrency).toBe("AUD");
    });

    test("fails closed when quote-to-AUD conversion data is unavailable", async () => {
        const engine = new MarketReplayEngine({
            strategy: ({ candles }) =>
                candles.length === 1 ? { signal: "BUY" } : { signal: "HOLD" },
        });
        const start = Date.parse("2026-07-01T00:00:00Z");

        await expect(
            engine.run({
                EUR_USD: [
                    candle(start, 1.17, 1.18, 1.16, 1.17),
                    candle(start + 900000, 1.17, 1.18, 1.16, 1.17),
                ],
            })
        ).rejects.toThrow("AUD conversion unavailable for USD");
    });

    test("rejects duplicate timestamps rather than silently rewriting history", () => {
        const time = Date.parse("2026-07-01T00:00:00Z");
        expect(() =>
            normalizeDataset({
                AUD_USD: [
                    candle(time, 0.65, 0.66, 0.64, 0.65),
                    candle(time, 0.65, 0.66, 0.64, 0.65),
                ],
            })
        ).toThrow("Duplicate candle");
    });

    test("counts OANDA-style 17:00 New York financing boundaries", () => {
        expect(
            countNewYorkRollovers(
                Date.parse("2026-07-01T20:30:00Z"),
                Date.parse("2026-07-01T21:30:00Z")
            )
        ).toBe(1);
    });
});
