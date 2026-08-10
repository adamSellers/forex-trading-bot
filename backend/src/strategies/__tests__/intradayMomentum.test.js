const {
    evaluateIntradayMomentumEntry,
    getActivePairSessions,
} = require("../intradayMomentum");

function buildCandles({
    direction = 1,
    count = 160,
    minutes = 15,
    endTime = "2026-08-10T10:00:00.000Z",
    startPrice = 1.1,
    step = 0.00008,
    breakout = false,
} = {}) {
    const endMs = Date.parse(endTime);
    const candles = Array.from({ length: count }, (_, index) => {
        const wave = Math.sin(index / 3) * step * 0.8;
        const close = startPrice + direction * index * step + wave;
        return {
            time: new Date(endMs - (count - index) * minutes * 60_000).toISOString(),
            open: close - direction * step * 0.4,
            high: close + step * 1.8,
            low: close - step * 1.8,
            close,
            volume: 100,
        };
    });

    if (breakout) {
        const last = candles[candles.length - 1];
        const prior = candles.slice(-9, -1);
        const boundary =
            direction > 0
                ? Math.max(...prior.map((candle) => candle.high))
                : Math.min(...prior.map((candle) => candle.low));
        last.close = boundary + direction * step * 2;
        last.open = last.close - direction * step * 3;
        last.high = Math.max(last.open, last.close) + step;
        last.low = Math.min(last.open, last.close) - step;
    }
    return candles;
}

function marketContext(m15, h1, spreadPips = 0.4) {
    return {
        session: { spreadPips, tradeable: true },
        timeframes: {
            "15m": { candles: m15 },
            "1h": { candles: h1 },
        },
    };
}

function permissiveConfig(direction = 1) {
    return {
        intradayMinAdx: 0,
        intradayMinRangeAtr: 0,
        intradayMaxRangeAtr: 10,
        intradayMinBodyRatio: 0,
        intradayLongRsiMinimum: 0,
        intradayLongRsiMaximum: 100,
        intradayShortRsiMinimum: 0,
        intradayShortRsiMaximum: 100,
        intradayMaxCostToStopRatio: 1,
        expectedSlippagePips: 0.1,
        enableShorting: direction < 0,
    };
}

describe("intradayMomentum", () => {
    test("enters a completed-M15 long breakout inside a liquid pair session", async () => {
        const h1 = buildCandles({
            direction: 1,
            minutes: 60,
            step: 0.0003,
        });
        const m15 = buildCandles({ direction: 1, breakout: true });
        const currentPrice = m15[m15.length - 1].close;
        const result = await evaluateIntradayMomentumEntry({
            instrument: "EUR_USD",
            currentPrice,
            config: permissiveConfig(1),
            marketContext: marketContext(m15, h1),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "BUY",
                signalClass: "ACTIONABLE",
                intent: "ENTER_LONG",
                entryType: "M15_RANGE_BREAKOUT",
                reasonCode: "INTRADAY_MOMENTUM_LONG_ENTRY",
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeLessThan(currentPrice);
        expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(currentPrice);
        expect(result.strategyContext.activeSessions).toContain("London");
    });

    test("supports a symmetric short breakout with broker-side protection", async () => {
        const h1 = buildCandles({
            direction: -1,
            minutes: 60,
            step: 0.0003,
            startPrice: 1.4,
        });
        const m15 = buildCandles({
            direction: -1,
            breakout: true,
            startPrice: 1.3,
        });
        const currentPrice = m15[m15.length - 1].close;
        const result = await evaluateIntradayMomentumEntry({
            instrument: "GBP_USD",
            currentPrice,
            config: permissiveConfig(-1),
            marketContext: marketContext(m15, h1),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "SELL",
                intent: "ENTER_SHORT",
                reasonCode: "INTRADAY_MOMENTUM_SHORT_ENTRY",
            })
        );
        expect(result.tradePlan.stopLossPrice).toBeGreaterThan(currentPrice);
        expect(result.tradePlan.takeProfitPrice).toBeLessThan(currentPrice);
    });

    test("fails closed outside the configured pair sessions", async () => {
        const endTime = "2026-08-10T22:00:00.000Z";
        const h1 = buildCandles({
            direction: 1,
            minutes: 60,
            step: 0.0003,
            endTime,
        });
        const m15 = buildCandles({ direction: 1, breakout: true, endTime });
        const result = await evaluateIntradayMomentumEntry({
            instrument: "EUR_USD",
            currentPrice: m15[m15.length - 1].close,
            config: permissiveConfig(1),
            marketContext: marketContext(m15, h1),
        });

        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_OUTSIDE_SESSION");
    });

    test("rejects an otherwise valid trigger when costs dominate the stop", async () => {
        const h1 = buildCandles({
            direction: 1,
            minutes: 60,
            step: 0.0003,
        });
        const m15 = buildCandles({ direction: 1, breakout: true });
        const result = await evaluateIntradayMomentumEntry({
            instrument: "EUR_USD",
            currentPrice: m15[m15.length - 1].close,
            config: {
                ...permissiveConfig(1),
                intradayMaxCostToStopRatio: 0.05,
            },
            marketContext: marketContext(m15, h1, 3),
        });

        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_COST_TOO_HIGH");
        expect(result.strategyContext.costs.costToStopRatio).toBeGreaterThan(0.05);
    });

    test("uses pair-aware, daylight-saving-aware session clocks", () => {
        const summer = Date.parse("2026-08-10T10:00:00.000Z");
        const winter = Date.parse("2026-01-12T09:00:00.000Z");

        expect(getActivePairSessions("EUR_USD", summer)).toContain("London");
        expect(getActivePairSessions("EUR_USD", winter)).toContain("London");
        expect(getActivePairSessions("AUD_USD", summer)).not.toContain("London");
        expect(getActivePairSessions("NZD_USD", summer)).toEqual([]);
    });
});
