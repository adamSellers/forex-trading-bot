const {
    evaluateIntradayMomentumEntry,
    getActivePairSessions,
    emaSeries,
} = require("../intradayMomentum");
const { sellRetestFixture } = require("./fixtures/intradaySellRetestFixture");
const { buyRetestFixture } = require("./fixtures/intradayBuyRetestFixture");

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
    test("a long breakout waits for a distinct retest and confirmation", async () => {
        const m15 = buildCandles({ direction: 1, breakout: true });
        const result = await evaluateIntradayMomentumEntry({ instrument: "EUR_USD",
            nowMs: Date.parse("2026-08-10T10:00:00Z"), currentPrice: m15.at(-1).close,
            config: permissiveConfig(1), marketContext: marketContext(m15, buildCandles({ minutes: 60, step: 0.0003 })) });
        expect(result).toMatchObject({ signalType: "HOLD", intent: "WAIT", tradePlan: null,
            reasonCode: "INTRADAY_MOMENTUM_BUY_WAIT_FOR_RETEST" });
        expect(result.strategyContext.activeSessions).toContain("London");
    });

    test("a short breakout only arms the new SELL setup", async () => {
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
            nowMs: Date.parse("2026-08-10T10:00:00Z"),
            currentPrice,
            config: permissiveConfig(-1),
            marketContext: marketContext(m15, h1),
        });

        expect(result).toEqual(
            expect.objectContaining({
                signalType: "HOLD",
                intent: "WAIT",
                reasonCode: "INTRADAY_MOMENTUM_SELL_WAIT_FOR_RETEST",
            })
        );
        expect(result.tradePlan).toBeNull();
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
            nowMs: Date.parse(endTime),
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
            nowMs: Date.parse("2026-08-10T10:00:00Z"),
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

// Oscillating M15 prices inside an H1 trend exercise the production thresholds.
// The pullback crosses its contemporaneous EMA and confirms a later resumption.
function defaultEntryFixture({ pullback = false, direction = 1, nowMs = Date.parse("2026-08-10T10:00:00Z") } = {}) {
    const amplitude = pullback ? 0.0001 : 0.0003;
    const phase = pullback ? 1.4 : 2.8;
    let previousClose = 1.1;
    const m15 = Array.from({ length: 160 }, (_, index) => {
        const close = 1.1 + index * 0.00001 + Math.sin(index / 2 + phase) * amplitude;
        const open = index === 0 ? close : previousClose;
        previousClose = close;
        return {
            time: new Date(nowMs - (160 - index) * 900_000).toISOString(),
            open, close,
            high: Math.max(open, close) + 0.00003,
            low: Math.min(open, close) - 0.00003,
        };
    });
    const h1 = buildCandles({ minutes: 60, step: 0.0003,
        endTime: new Date(Math.floor(nowMs / 3_600_000) * 3_600_000).toISOString() });
    if (direction < 0) {
        [...m15, ...h1].forEach((candle) => {
            const { open, close, high, low } = candle;
            Object.assign(candle, { open: 2.4 - open, close: 2.4 - close,
                high: 2.4 - low, low: 2.4 - high });
        });
    }
    return { instrument: "EUR_USD", currentPrice: m15[m15.length - 1].close, nowMs,
        marketContext: marketContext(m15, h1), m15, h1 };
}

describe("intradayMomentum deployed defaults and data gates", () => {
    test.each([1, -1])("legacy breakout alone waits for the retest policy in direction %s", async (direction) => {
        const result = await evaluateIntradayMomentumEntry(defaultEntryFixture({ direction }));
        expect(result).toMatchObject({ signalType: "HOLD", entryType: null, tradePlan: null });
        expect(result.reasonCode).toMatch(/^INTRADAY_MOMENTUM_(BUY|SELL)_/);
        expect(result.strategyContext.m15.trigger[direction > 0 ? "longBreakout" : "shortBreakout"]).toBe(true);
    });

    test.each([1, -1])("legacy EMA pullback alone waits for the retest policy in direction %s", async (direction) => {
        const result = await evaluateIntradayMomentumEntry(defaultEntryFixture({ pullback: true, direction }));
        expect(result).toMatchObject({ signalType: "HOLD", entryType: null, tradePlan: null });
        expect(result.strategyContext.m15.trigger.longBreakout).toBe(false);
        expect(result.strategyContext.m15.trigger.shortBreakout).toBe(false);
    });

    test.each([1, -1].flatMap((direction) => [0.7, 0.8].map((spread) => ({ direction, spread }))))(
        'direction $direction with broker spread $spread retains the 15 percent stop-cost boundary', async ({ direction, spread }) => {
            const fixture = defaultEntryFixture({ direction });
            const { normalizeOandaPrice } = require('../../runtime/quoteAvailability');
            const quote = normalizeOandaPrice({ instrument: fixture.instrument, tradeable: true,
                time: new Date(fixture.nowMs).toISOString(),
                bids: [{ price: '1.30002' }], asks: [{ price: (1.30002 + spread * 0.0001).toFixed(5) }],
            }, { instrument: fixture.instrument, fetchedAt: fixture.nowMs });
            // Translate the complete fixture to this quote without changing its
            // candle pattern, indicator direction or six-pip minimum stop.
            const offset = quote.price - fixture.currentPrice;
            for (const candle of [...fixture.m15, ...fixture.h1]) {
                for (const key of ['open', 'close', 'high', 'low']) candle[key] += offset;
            }
            fixture.currentPrice = quote.price;
            fixture.marketContext.price = quote;
            fixture.marketContext.session.spreadPips = quote.spread;
            const result = await evaluateIntradayMomentumEntry(fixture);
            if (spread === 0.7) {
                expect(result.strategyContext.costs.costToStopRatio).toBeGreaterThan(0.15);
                expect(result.signalType).toBe('HOLD');
                expect(result.strategyContext.costs.stopPips).toBe(6);
                if (direction < 0) expect(result.reasonCode).toMatch(/^INTRADAY_MOMENTUM_SELL_/);
            } else {
                expect(result.signalType).toBe('HOLD');
                expect(result.reasonCode).toBe('INTRADAY_MOMENTUM_COST_TOO_HIGH');
            }
        }
    );

    test.each([null, undefined, "", -0.1, NaN])("missing/invalid spread %s fails closed", async (spreadPips) => {
        const fixture = defaultEntryFixture();
        fixture.marketContext.session.spreadPips = spreadPips;
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_COST_TOO_HIGH");
    });

    test("rejects a fresh live price paired with stale trigger candles", async () => {
        const fixture = defaultEntryFixture();
        fixture.nowMs += 16 * 60_000 + 30_001;
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_STALE_COMPLETED_CANDLE");
    });

    test("rejects stale H1 context despite a current M15 trigger", async () => {
        const fixture = defaultEntryFixture();
        fixture.nowMs += 91_000;
        fixture.h1.pop();
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_STALE_COMPLETED_CANDLE");
    });

    test("uses the current pair session when a completed candle was in session", async () => {
        const fixture = defaultEntryFixture({ nowMs: Date.parse("2026-08-10T19:45:00Z") });
        fixture.nowMs = Date.parse("2026-08-10T20:00:30Z");
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_OUTSIDE_SESSION");
    });

    test("blocks Sydney entries during the New York rollover exit window", async () => {
        const fixture = defaultEntryFixture({ nowMs: Date.parse("2026-11-09T21:45:00Z") });
        fixture.instrument = "AUD_USD";
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(getActivePairSessions("AUD_USD", fixture.nowMs)).toContain("Sydney");
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_ROLLOVER_WINDOW");
    });

    test.each([false, null, undefined])("broker tradeable %s never authorizes an entry", async (tradeable) => {
        const fixture = defaultEntryFixture();
        fixture.marketContext.session.tradeable = tradeable;
        expect((await evaluateIntradayMomentumEntry(fixture)).reasonCode)
            .toBe("INTRADAY_MOMENTUM_NOT_TRADEABLE");
    });
});

function mirrorFixture(fixture, direction) {
    if (direction < 0) {
        [...fixture.m15, ...fixture.h1].forEach((candle) => {
            const { open, close, high, low } = candle;
            Object.assign(candle, { open: 2.4 - open, close: 2.4 - close,
                high: 2.4 - low, low: 2.4 - high });
        });
    }
    fixture.currentPrice = fixture.m15[fixture.m15.length - 1].close;
    return fixture;
}

describe("intradayMomentum bar-aligned pullback sequence", () => {
    test.each([1, -1])("does not turn EMA movement into a historical touch in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ pullback: true });
        const fast = emaSeries(fixture.m15.map((candle) => candle.close), 20);
        const signalEma = fast[fast.length - 1];
        fixture.m15.slice(-5, -1).forEach((candle, offset) => {
            const ownEma = fast[fast.length - 5 + offset];
            // A valid lower wick above its own EMA, below the later signal EMA.
            candle.low = (ownEma + Math.min(signalEma, candle.open, candle.close)) / 2;
            expect(candle.low).toBeGreaterThan(ownEma);
            expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
        });
        const result = await evaluateIntradayMomentumEntry(mirrorFixture(fixture, direction));
        const side = direction > 0 ? "long" : "short";
        const evidence = result.strategyContext.m15;
        expect(result.reasonCode).toBe(direction < 0
            ? `INTRADAY_MOMENTUM_SELL_${result.strategyContext.sellRetest.classification}`
            : `INTRADAY_MOMENTUM_BUY_${result.strategyContext.buyRetest.classification}`);
        expect(evidence.pullbackSequence.legacy[`${side}Pullback`]).toBe(true);
        expect(evidence.pullbackSequence[side].touchTimes).toEqual([]);
        expect(evidence.triggerCombination).toBe("none");
    });

    test.each([1, -1])("requires resumption past an older touch's intervening extreme in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ pullback: true });
        const fast = emaSeries(fixture.m15.map((candle) => candle.close), 20);
        fixture.m15.slice(-4, -1).forEach((candle, offset) => {
            const ownEma = fast[fast.length - 4 + offset];
            candle.low = (ownEma + Math.min(candle.open, candle.close)) / 2;
        });
        const touch = fixture.m15[fixture.m15.length - 5];
        touch.low = fast[fast.length - 5] - 0.000001;
        const result = await evaluateIntradayMomentumEntry(mirrorFixture(fixture, direction));
        const side = direction > 0 ? "long" : "short";
        const sequence = result.strategyContext.m15.pullbackSequence;
        expect(result.reasonCode).toBe(direction < 0
            ? `INTRADAY_MOMENTUM_SELL_${result.strategyContext.sellRetest.classification}`
            : `INTRADAY_MOMENTUM_BUY_${result.strategyContext.buyRetest.classification}`);
        expect(sequence.legacy[`${side}Pullback`]).toBe(true);
        expect(sequence[side].touchTimes).toEqual([touch.time]);
        expect(sequence[side].resumptionStartTime).toBe(touch.time);
        expect(sequence[side].resumed).toBe(false);
    });

    test.each([1, -1])("retains a valid old touch when its full sequence resumes in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ pullback: true });
        const fast = emaSeries(fixture.m15.map((candle) => candle.close), 20);
        fixture.m15.slice(-4, -1).forEach((candle, offset) => {
            const ownEma = fast[fast.length - 4 + offset];
            candle.low = (ownEma + Math.min(candle.open, candle.close)) / 2;
        });
        const touch = fixture.m15[fixture.m15.length - 5];
        touch.low = fast[fast.length - 5] - 0.000001;
        const signal = fixture.m15[fixture.m15.length - 1];
        signal.close = touch.high + 0.000001;
        signal.high = signal.close + 0.00001;
        fixture.config = permissiveConfig(direction);
        const result = await evaluateIntradayMomentumEntry(mirrorFixture(fixture, direction));
        const side = direction > 0 ? "long" : "short";
        expect(result.signalType).toBe("HOLD");
        expect(result.strategyContext.m15.pullbackSequence[side].latestTouchTime).toBe(touch.time);
        expect(result.strategyContext.m15.pullbackSequence[side].resumed).toBe(true);
        expect(result.strategyContext.m15.trigger[`${side}Pullback`]).toBe(true);
    });

    test.each([1, -1])("uses each close's own EMA50 for structural integrity in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ pullback: true });
        const slow = emaSeries(fixture.m15.map((candle) => candle.close), 50);
        const bar = fixture.m15[fixture.m15.length - 5];
        bar.close = slow[slow.length - 6] + 0.000001;
        bar.open = bar.close + 0.000003;
        bar.high = bar.open + 0.000005;
        bar.low = bar.close - 0.000005;
        fixture.config = permissiveConfig(direction);
        const result = await evaluateIntradayMomentumEntry(mirrorFixture(fixture, direction));
        const side = direction > 0 ? "long" : "short";
        const evidence = result.strategyContext.m15;
        expect(evidence.pullbackSequence.legacy[`${side}Pullback`]).toBe(false);
        expect(evidence.pullbackSequence[side].structureHeld).toBe(true);
        expect(evidence.trigger[`${side}Pullback`]).toBe(true);
        expect(result.signalType).toBe("HOLD");
        expect(evidence.pullbackWindow).toEqual(fixture.m15.slice(-5, -1)
            .map(({ time, high, low }) => ({ time, high, low })));
    });

    test.each([1, -1])("rejects a pullback that closes through its own EMA50 in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ pullback: true });
        const slow = emaSeries(fixture.m15.map((candle) => candle.close), 50);
        const bar = fixture.m15[fixture.m15.length - 5];
        bar.close = slow[slow.length - 6] - 0.000001;
        bar.open = bar.close + 0.000003;
        bar.high = bar.open + 0.000005;
        bar.low = bar.close - 0.000005;
        fixture.config = permissiveConfig(direction);
        const result = await evaluateIntradayMomentumEntry(mirrorFixture(fixture, direction));
        const side = direction > 0 ? "long" : "short";
        expect(result.reasonCode).toBe(direction < 0
            ? `INTRADAY_MOMENTUM_SELL_${result.strategyContext.sellRetest.classification}`
            : `INTRADAY_MOMENTUM_BUY_${result.strategyContext.buyRetest.classification}`);
        expect(result.strategyContext.m15.pullbackSequence[side].structureHeld).toBe(false);
    });

    test("does not report a fabricated RSI before sufficient history is available", async () => {
        const fixture = defaultEntryFixture();
        fixture.marketContext.timeframes["15m"].candles = fixture.m15.slice(-10);
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_WARMUP");
        expect(result.rsiVal).toBeNull();
    });
});

function reentryFixture({ direction = 1, trigger = "pullback_only" } = {}) {
    const fixture = defaultEntryFixture({ pullback: trigger !== "breakout_only" });
    if (trigger === "breakout_and_pullback") {
        // Extend the valid pullback's resumption through the eight-bar high;
        // the real default RSI and range checks must still accept this candle.
        const signal = fixture.m15[fixture.m15.length - 1];
        signal.close = Math.max(...fixture.m15.slice(-9, -1).map((bar) => bar.high)) + 0.000001;
        signal.high = signal.close + 0.00003;
    }
    return mirrorFixture(fixture, direction);
}

function closedTradeForFixture(fixture, { direction = 1, reason = "TAKE_PROFIT", closedAt } = {}) {
    const brokerClosedAt = closedAt ?? fixture.nowMs - 14 * 60_000;
    return {
        id: "normal-closed-1", oandaTradeId: "broker-1", instrument: fixture.instrument,
        side: direction > 0 ? "BUY" : "SELL", exitReason: reason,
        // Default close is inside the signal candle. No prior completed bar
        // can supply the post-exit touch, regardless of trigger combination.
        brokerClosedAt,
        isOpen: false, mode: "live", entryType: "M15_PULLBACK_RESUMPTION",
        brokerReconciliationPayload: {
            close: { trade: { id: "broker-1", state: "CLOSED", closeTime: new Date(brokerClosedAt).toISOString() } },
        },
    };
}

describe("intradayMomentum integrated protected-exit and fade decisions", () => {
    test.each([1, -1].flatMap((direction) => ["breakout_only", "pullback_only", "breakout_and_pullback"]
        .map((trigger) => ({ direction, trigger }))))(
        "blocks both post-TP fade directions for $trigger direction $direction", async ({ direction, trigger }) => {
            const fixture = reentryFixture({ direction, trigger });
            const original = await evaluateIntradayMomentumEntry(fixture);
            expect(original.signalType).toBe("HOLD");
            expect(original.strategyContext.m15.triggerCombination).toBe(trigger);
            const latestClosedTrade = closedTradeForFixture(fixture, { direction });
            const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
            expect(result).toMatchObject({ signalType: "HOLD", tradePlan: null,
                reasonCode: direction > 0 ? "INTRADAY_MOMENTUM_SELL_RETEST_REQUIRED" : "INTRADAY_MOMENTUM_BUY_RETEST_REQUIRED" });
            expect(result.strategyContext.h1).toEqual(original.strategyContext.h1);
            expect(result.strategyContext.m15).toEqual(original.strategyContext.m15);
            expect(result.strategyContext.reentry).toMatchObject({ classification: "POST_TP_FADE", freshTouch: false,
                originalSide: direction > 0 ? "BUY" : "SELL", executedSide: direction > 0 ? "SELL" : "BUY",
                anchor: { tradeId: latestClosedTrade.id, closedAt: latestClosedTrade.brokerClosedAt } });
        }
    );

    test.each([1, -1].flatMap((direction) => ["TAKE_PROFIT", "BREAKEVEN_STOP"]
        .map((reason) => ({ direction, reason }))))(
        "$reason allows a fresh default pullback in direction $direction at the exact broker-close boundary", async ({ direction, reason }) => {
            const fixture = reentryFixture({ direction });
            const original = await evaluateIntradayMomentumEntry(fixture);
            const { fastEma, pullbackWindow } = original.strategyContext.m15;
            const touch = pullbackWindow.filter((bar) => direction > 0 ? bar.low <= fastEma : bar.high >= fastEma).slice(-1)[0];
            expect(touch).toBeDefined();
            const latestClosedTrade = closedTradeForFixture(fixture, {
                direction, reason, closedAt: Date.parse(touch.time),
            });
            const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
            expect(result.signalType).toBe(original.signalType);
            expect(result.entryType).toBe(original.entryType);
            expect(result.tradePlan).toEqual(original.tradePlan);
            expect(result.strategyContext.reentry).toMatchObject({
                classification: "FRESH_CONTINUATION", freshTouch: true,
                freshTouchTimes: expect.arrayContaining([touch.time]),
            });
        }
    );

    test.each([1, -1].flatMap((direction) => ["breakout_only", "pullback_only", "breakout_and_pullback"]
        .map((trigger) => ({ direction, trigger }))))(
        "breakeven without freshness waits for $trigger in direction $direction", async ({ direction, trigger }) => {
            const fixture = reentryFixture({ direction, trigger });
            const result = await evaluateIntradayMomentumEntry({ ...fixture,
                latestClosedTrade: closedTradeForFixture(fixture, { direction, reason: "BREAKEVEN_STOP" }),
            });
            expect(result.signalType).toBe("HOLD");
            expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_WAIT_FOR_FRESH_PULLBACK");
            expect(result.tradePlan).toBeNull();
            expect(result.strategyContext.m15.triggerCombination).toBe(trigger);
            expect(result.strategyContext.reentry).toMatchObject({
                classification: "WAIT_FOR_FRESH_PULLBACK", allowed: false, freshTouch: false,
            });
        }
    );

    test.each([1, -1])("a touch candle straddling the TP cannot authorize normal continuation in direction %s", async (direction) => {
        const fixture = reentryFixture({ direction });
        const original = await evaluateIntradayMomentumEntry(fixture);
        const { fastEma, pullbackWindow } = original.strategyContext.m15;
        const latestTouch = pullbackWindow.filter((bar) => direction > 0 ? bar.low <= fastEma : bar.high >= fastEma).slice(-1)[0];
        const result = await evaluateIntradayMomentumEntry({ ...fixture,
            latestClosedTrade: closedTradeForFixture(fixture, {
                direction, closedAt: Date.parse(latestTouch.time) + 1,
            }),
        });
        expect(result.entryType).toBeNull();
        expect(result.strategyContext.reentry.freshTouchTimes).toEqual([]);
        expect(result.signalType).toBe("HOLD");
    });

    test.each([1, -1].flatMap((direction) => ["SESSION_CLOSE", "TIME_STOP", "OPPOSITE_TP"]
        .map((reason) => ({ direction, reason }))))(
        "$reason retains a normal qualifying entry in direction $direction", async ({ direction, reason }) => {
            const fixture = reentryFixture({ direction });
            const original = await evaluateIntradayMomentumEntry(fixture);
            const latestClosedTrade = closedTradeForFixture(fixture, {
                direction: reason === "OPPOSITE_TP" ? -direction : direction,
                reason: reason === "OPPOSITE_TP" ? "TAKE_PROFIT" : reason,
            });
            const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
            expect(result.signalType).toBe(original.signalType);
            expect(result.entryType).toBe(original.entryType);
            expect(result.tradePlan).toEqual(original.tradePlan);
            expect(result.strategyContext.reentry.classification).toBe("NORMAL");
        }
    );

    test.each([1, -1].flatMap((direction) => ["breakout_only", "pullback_only", "breakout_and_pullback"]
        .map((trigger) => ({ direction, trigger }))))(
        "initial stop blocks $trigger without an H1 reset in direction $direction", async ({ direction, trigger }) => {
            const fixture = reentryFixture({ direction, trigger });
            const latestClosedTrade = closedTradeForFixture(fixture, { direction, reason: "STOP_LOSS" });
            const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
            expect(result.signalType).toBe("HOLD");
            expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_WAIT_FOR_H1_RESET");
            expect(result.tradePlan).toBeNull();
            expect(result.strategyContext.reentry.classification).toBe("NORMAL");
            expect(result.strategyContext.m15.triggerCombination).toBe(trigger);
            expect(result.strategyContext.lossReset).toMatchObject({
                allowed: false, side: direction > 0 ? "BUY" : "SELL",
                anchor: { tradeId: latestClosedTrade.id, armed: true },
            });
        }
    );

    test.each([1, -1])("opposite normal close does not erase the stopped direction %s", async (direction) => {
        const fixture = reentryFixture({ direction });
        const stop = closedTradeForFixture(fixture, { direction, reason: "STOP_LOSS", closedAt: fixture.nowMs - 45 * 60_000 });
        const opposite = { ...closedTradeForFixture(fixture, { direction: -direction, reason: "SESSION_CLOSE" }), id: "opposite-close" };
        const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade: opposite,
            lossResetTrades: [stop, opposite] });
        expect(result.signalType).toBe("HOLD");
        expect(result.strategyContext.lossReset.anchor.tradeId).toBe(stop.id);
    });

    test("missing supplied loss evidence cannot silently become a normal entry", async () => {
        const result = await evaluateIntradayMomentumEntry({ ...reentryFixture(), lossResetDecisions: {} });
        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_LOSS_RESET_EVIDENCE_UNAVAILABLE");
    });

    test("a BUY fade is blocked even when its actual side has a stopped normal trade", async () => {
        const fixture = reentryFixture({ direction: -1 });
        const latestClosedTrade = closedTradeForFixture(fixture, { direction: -1 });
        const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade,
            lossResetDecisions: { BUY: { version: 1, instrument: fixture.instrument, side: "BUY",
                allowed: false, classification: "WAIT_FOR_H1_RESET" } } });
        expect(result).toMatchObject({ signalType: "HOLD", entryType: null,
            reasonCode: "INTRADAY_MOMENTUM_BUY_RETEST_REQUIRED" });
    });

    test.each([1, -1].flatMap((direction) => [false, true].map((missingEvidence) => ({ direction, missingEvidence }))))(
        "loss reset preserves only the existing opposite normal exit direction $direction, missing=$missingEvidence", async ({ direction, missingEvidence }) => {
            const fixture = reentryFixture({ direction });
            const latestClosedTrade = closedTradeForFixture(fixture, { direction, reason: "STOP_LOSS" });
            const ownedOpenTrade = { isOpen: true, side: direction > 0 ? "SELL" : "BUY", entryType: "M15_RANGE_BREAKOUT" };
            const args = { ...fixture, latestClosedTrade, ownedOpenTrade,
                ...(missingEvidence ? { lossResetDecisions: {} } : {}) };
            const result = await evaluateIntradayMomentumEntry(args);
            expect(result).toMatchObject({ signalType: direction > 0 ? "BUY" : "SELL",
                entryType: "EXIT_ONLY", intent: direction > 0 ? "EXIT_SHORT_ONLY" : "EXIT_LONG_ONLY",
                tradePlan: null, reasonCode: "INTRADAY_MOMENTUM_LOSS_RESET_EXIT_ONLY" });
            expect(result.strategyContext.lossReset.allowed).toBe(false);
            for (const trade of [null, { ...ownedOpenTrade, side: direction > 0 ? "BUY" : "SELL" },
                { ...ownedOpenTrade, isOpen: false }, { ...ownedOpenTrade, entryType: "M15_POST_TP_FADE" }]) {
                expect((await evaluateIntradayMomentumEntry({ ...args, ownedOpenTrade: trade })).signalType).toBe("HOLD");
            }
        }
    );

    test.each([1, -1])("unavailable durable history does not grant a first entry in direction %s", async (direction) => {
        const fixture = reentryFixture({ direction });
        const result = await evaluateIntradayMomentumEntry({ ...fixture,
            latestClosedTrade: null, reentryHistoryAvailable: false,
        });
        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_HISTORY_UNAVAILABLE");
        expect(result.strategyContext.reentry.allowed).toBe(false);
    });

    test.each([1, -1])("failed revised normal entry cannot be revived as a fade in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ pullback: true });
        const fast = emaSeries(fixture.m15.map((candle) => candle.close), 20);
        const signalEma = fast[fast.length - 1];
        fixture.m15.slice(-5, -1).forEach((candle, offset) => {
            const ownEma = fast[fast.length - 5 + offset];
            candle.low = (ownEma + Math.min(signalEma, candle.open, candle.close)) / 2;
        });
        mirrorFixture(fixture, direction);
        const result = await evaluateIntradayMomentumEntry({ ...fixture,
            latestClosedTrade: closedTradeForFixture(fixture, { direction }),
        });
        const side = direction > 0 ? "long" : "short";
        expect(result.signalType).toBe("HOLD");
        expect(result.reasonCode).toBe(direction < 0
            ? `INTRADAY_MOMENTUM_SELL_${result.strategyContext.sellRetest.classification}`
            : `INTRADAY_MOMENTUM_BUY_${result.strategyContext.buyRetest.classification}`);
        expect(result.strategyContext.m15.pullbackSequence.legacy[`${side}Pullback`]).toBe(true);
        expect(result.strategyContext.m15.triggerCombination).toBe("none");
        expect(result.strategyContext.reentry).toBeUndefined();
    });
});

describe("intradayMomentum SELL structural candidate", () => {
    test("production defaults allow the complete candidate with structural risk and unchanged exits", async () => {
        const fixture = sellRetestFixture();
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "SELL", intent: "ENTER_SHORT",
            entryType: "M15_BREAK_RETEST_REJECTION", reasonCode: "INTRADAY_MOMENTUM_SHORT_ENTRY",
            tradePlan: { stopPriceMode: "STRUCTURAL", targetRiskMultiple: 1.5, timeStopHours: 6 } });
        expect(result.strategyContext.h1.shortRegime).toBe(true);
        expect(result.rsiVal).toBeGreaterThanOrEqual(28);
        expect(result.rsiVal).toBeLessThanOrEqual(48);
        const expectedStop = Number((fixture.m15.at(-2).ask.high + 0.00001).toFixed(5));
        expect(result.tradePlan.stopLossPrice).toBe(expectedStop);
        expect(result.tradePlan.structuralStopLossPrice).toBe(expectedStop);
        expect(result.tradePlan.stopPips).toBeCloseTo((expectedStop - fixture.currentPrice) / 0.0001, 9);
        expect(result.tradePlan.takeProfitPrice).toBeCloseTo(fixture.currentPrice - (expectedStop - fixture.currentPrice) * 1.5, 10);
    });

    test.each(["missing ask", "unconfirmed retest", "consumed pattern"])("%s cannot become an actionable normal SELL", async (kind) => {
        const fixture = sellRetestFixture();
        if (kind === "missing ask") fixture.m15.at(-2).ask = null;
        if (kind === "unconfirmed retest") fixture.m15.at(-1).close = fixture.m15.at(-2).low;
        if (kind === "consumed pattern") {
            const prior = await evaluateIntradayMomentumEntry(fixture);
            fixture.latestClosedTrade = { ...closedTradeForFixture(fixture, { direction: -1, reason: "TIME_STOP" }),
                brokerReconciliationPayload: { liveRuntime: { entryTelemetry: { strategyContext: prior.strategyContext } } } };
        }
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.signalType).toBe("HOLD");
        expect(result.tradePlan).toBeNull();
    });

    test("a valid candidate still respects H1 initial-stop reset", async () => {
        const fixture = sellRetestFixture();
        const latestClosedTrade = closedTradeForFixture(fixture, { direction: -1, reason: "STOP_LOSS" });
        const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
        expect(result).toMatchObject({ signalType: "HOLD", tradePlan: null,
            reasonCode: "INTRADAY_MOMENTUM_WAIT_FOR_H1_RESET" });
        expect(result.strategyContext.sellRetest.ready).toBe(true);
    });

    test.each(["BREAKEVEN_STOP", "TAKE_PROFIT"])("a valid candidate retains the protected-exit %s policy", async (reason) => {
        const fixture = sellRetestFixture();
        const latestClosedTrade = closedTradeForFixture(fixture, { direction: -1, reason });
        const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
        if (reason === "BREAKEVEN_STOP") {
            expect(result).toMatchObject({ signalType: "HOLD", reasonCode: "INTRADAY_MOMENTUM_WAIT_FOR_FRESH_PULLBACK" });
        } else {
            expect(result).toMatchObject({ signalType: "HOLD", tradePlan: null,
                reasonCode: "INTRADAY_MOMENTUM_BUY_RETEST_REQUIRED" });
        }
    });

    test("structural stops retain the existing spread-to-stop cost guard", async () => {
        const fixture = sellRetestFixture();
        fixture.marketContext.session.spreadPips = 2;
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "HOLD", tradePlan: null,
            reasonCode: "INTRADAY_MOMENTUM_COST_TOO_HIGH" });
    });

    test("a structural distance below six pips uses the existing outward floor for costs and target", async () => {
        const fixture = sellRetestFixture({ scale: 0.00007 });
        fixture.marketContext.session.spreadPips = 0.6;
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "SELL", tradePlan: { stopPips: 6,
            stopPriceMode: "STRUCTURAL", targetRiskMultiple: 1.5 } });
        expect(result.tradePlan.structuralStopLossPrice).toBeLessThan(result.tradePlan.stopLossPrice);
        expect(result.tradePlan.stopLossPrice).toBeCloseTo(fixture.currentPrice + 0.0006, 10);
        expect(result.tradePlan.takeProfitPrice).toBeCloseTo(fixture.currentPrice - 0.0009, 10);
        expect(result.strategyContext.costs.costToStopRatio).toBeCloseTo(0.8 / 6, 10);
    });

    test("the prior qualified normal SELL still closes a long while waiting for the new entry pattern", async () => {
        const fixture = defaultEntryFixture({ direction: -1 });
        const result = await evaluateIntradayMomentumEntry({ ...fixture,
            ownedOpenTrade: { isOpen: true, side: "BUY", entryType: "M15_RANGE_BREAKOUT" } });
        expect(result).toMatchObject({ signalType: "SELL", intent: "EXIT_LONG_ONLY", entryType: "EXIT_ONLY",
            tradePlan: null, reasonCode: "INTRADAY_MOMENTUM_SELL_RETEST_EXIT_ONLY" });
        const fade = await evaluateIntradayMomentumEntry({ ...fixture,
            ownedOpenTrade: { isOpen: true, side: "BUY", entryType: "M15_POST_TP_FADE" } });
        expect(fade.signalType).toBe("HOLD");
    });
});

describe("intradayMomentum BUY structural candidate", () => {
    test("production defaults accept the real completed pattern with observed bid risk and unchanged exit defaults", async () => {
        const fixture = buyRetestFixture();
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "BUY", intent: "ENTER_LONG",
            entryType: "M15_BREAK_RETEST_CONFIRMATION", reasonCode: "INTRADAY_MOMENTUM_LONG_ENTRY",
            tradePlan: { stopPriceMode: "STRUCTURAL", targetRiskMultiple: 1.5, timeStopHours: 6 } });
        expect(result.strategyContext.h1.longRegime).toBe(true);
        expect(result.rsiVal).toBeGreaterThanOrEqual(52); expect(result.rsiVal).toBeLessThanOrEqual(72);
        const expectedStop = Number((Math.min(...fixture.m15.slice(-2).map(bar => bar.bid.low)) - .00001).toFixed(5));
        expect(result.tradePlan).toMatchObject({ stopLossPrice: expectedStop, structuralStopLossPrice: expectedStop });
        expect(result.tradePlan.stopPips).toBeCloseTo((fixture.currentPrice - expectedStop) / .0001, 9);
        expect(result.tradePlan.takeProfitPrice).toBeCloseTo(fixture.currentPrice + (fixture.currentPrice - expectedStop) * 1.5, 10);
    });

    test.each(["missing bid", "retouch instead of confirmation", "consumed episode"])("%s cannot authorize normal BUY", async (kind) => {
        const fixture = buyRetestFixture();
        if (kind === "missing bid") delete fixture.m15.at(-2).bid;
        if (kind === "retouch instead of confirmation") {
            const last = fixture.m15.at(-1);
            last.low = Math.max(...fixture.m15.slice(-11, -3).map(bar => bar.high));
            last.high = last.close + .00001;
            last.bid = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, Number((last[key] - .00002).toFixed(5))]));
        }
        if (kind === "consumed episode") {
            const first = await evaluateIntradayMomentumEntry(fixture);
            fixture.lossResetTrades = [{ ...closedTradeForFixture(fixture, { reason: "SESSION_CLOSE" }),
                brokerReconciliationPayload: { liveRuntime: { entryTelemetry: { strategyContext: first.strategyContext } } } }];
        }
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "HOLD", tradePlan: null });
        expect(result.strategyContext.buyRetest.ready).toBe(false);
    });

    test.each(["loss reset", "spread cost", "protected BE freshness"])("a valid BUY pattern still respects %s", async (guard) => {
        const fixture = buyRetestFixture();
        if (guard === "loss reset") fixture.latestClosedTrade = closedTradeForFixture(fixture, { reason: "STOP_LOSS" });
        if (guard === "spread cost") fixture.marketContext.session.spreadPips = 2;
        if (guard === "protected BE freshness") fixture.latestClosedTrade = closedTradeForFixture(fixture, { reason: "BREAKEVEN_STOP" });
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "HOLD", tradePlan: null,
            reasonCode: guard === "loss reset" ? "INTRADAY_MOMENTUM_WAIT_FOR_H1_RESET"
                : guard === "spread cost" ? "INTRADAY_MOMENTUM_COST_TOO_HIGH" : "INTRADAY_MOMENTUM_WAIT_FOR_FRESH_PULLBACK" });
        expect(result.strategyContext.buyRetest.ready).toBe(true);
    });

    test("the six-pip floor moves BUY protection outward while retaining the observed bid anchor", async () => {
        const fixture = buyRetestFixture({ scale: .00007 }); fixture.marketContext.session.spreadPips = .6;
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result).toMatchObject({ signalType: "BUY", tradePlan: { stopPips: 6, stopPriceMode: "STRUCTURAL", targetRiskMultiple: 1.5 } });
        expect(result.tradePlan.structuralStopLossPrice).toBeGreaterThan(result.tradePlan.stopLossPrice);
        expect(result.tradePlan.stopLossPrice).toBeCloseTo(fixture.currentPrice - .0006, 10);
        expect(result.tradePlan.takeProfitPrice).toBeCloseTo(fixture.currentPrice + .0009, 10);
        expect(result.strategyContext.costs.costToStopRatio).toBeCloseTo(.8 / 6, 10);
    });

    test("a prior qualifying legacy BUY still exits an owned normal short without granting a new entry or reversing an owned fade", async () => {
        const fixture = defaultEntryFixture();
        const result = await evaluateIntradayMomentumEntry({ ...fixture,
            ownedOpenTrade: { isOpen: true, side: "SELL", entryType: "M15_RANGE_BREAKOUT" } });
        expect(result).toMatchObject({ signalType: "BUY", intent: "EXIT_SHORT_ONLY", entryType: "EXIT_ONLY",
            tradePlan: null, reasonCode: "INTRADAY_MOMENTUM_BUY_RETEST_EXIT_ONLY" });
        expect((await evaluateIntradayMomentumEntry({ ...fixture,
            ownedOpenTrade: { isOpen: true, side: "SELL", entryType: "M15_POST_TP_FADE" } })).signalType).toBe("HOLD");
    });
});
