const {
    evaluateIntradayMomentumEntry,
    getActivePairSessions,
    emaSeries,
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
            nowMs: Date.parse("2026-08-10T10:00:00Z"),
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
            nowMs: Date.parse("2026-08-10T10:00:00Z"),
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
    test.each([1, -1])("production default breakout works in direction %s", async (direction) => {
        const fixture = defaultEntryFixture({ direction });
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.signalType).toBe(direction > 0 ? "BUY" : "SELL");
        expect(result.entryType).toBe("M15_RANGE_BREAKOUT");
        expect(result.tradePlan.stopPips).toBe(6);
        expect(result.tradePlan.targetRiskMultiple).toBe(1.5);
        expect(result.strategyContext.costs.costToStopRatio).toBeCloseTo(0.1);
    });

    test.each([1, -1])("production default pullback works in direction %s", async (direction) => {
        const result = await evaluateIntradayMomentumEntry(defaultEntryFixture({ pullback: true, direction }));
        expect(result.signalType).toBe(direction > 0 ? "BUY" : "SELL");
        expect(result.entryType).toBe("M15_PULLBACK_RESUMPTION");
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
                expect(result.signalType).toBe(direction > 0 ? 'BUY' : 'SELL');
                expect(result.tradePlan.stopPips).toBe(6);
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
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_NO_TRIGGER");
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
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_NO_TRIGGER");
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
        expect(result.signalType).toBe(direction > 0 ? "BUY" : "SELL");
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
        expect(result.signalType).toBe(direction > 0 ? "BUY" : "SELL");
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
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_NO_TRIGGER");
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
        "fades stale post-TP $trigger in original direction $direction with mirrored protection", async ({ direction, trigger }) => {
            const fixture = reentryFixture({ direction, trigger });
            const original = await evaluateIntradayMomentumEntry(fixture);
            expect(original.signalType).toBe(direction > 0 ? "BUY" : "SELL");
            expect(original.strategyContext.m15.triggerCombination).toBe(trigger);
            const latestClosedTrade = closedTradeForFixture(fixture, { direction });
            const result = await evaluateIntradayMomentumEntry({ ...fixture, latestClosedTrade });
            expect(result).toMatchObject({
                signalType: direction > 0 ? "SELL" : "BUY",
                intent: direction > 0 ? "ENTER_SHORT" : "ENTER_LONG",
                signalClass: "ACTIONABLE", entryType: "M15_POST_TP_FADE",
                reasonCode: "INTRADAY_MOMENTUM_POST_TP_FADE",
                currentDir: direction,
                htfContext: { direction, longAllowed: direction > 0, shortAllowed: direction < 0 },
            });
            expect(result.strategyContext.h1).toEqual(original.strategyContext.h1);
            expect(result.strategyContext.m15).toEqual(original.strategyContext.m15);
            expect(result.strategyContext.reentry).toMatchObject({
                classification: "POST_TP_FADE", allowed: true, freshTouch: false,
                originalSide: original.signalType, executedSide: result.signalType,
                originalEntryType: original.entryType,
                anchor: { tradeId: latestClosedTrade.id, closedAt: latestClosedTrade.brokerClosedAt },
            });
            const distance = original.tradePlan.stopPips * 0.0001;
            expect(result.tradePlan).toMatchObject({ stopPips: original.tradePlan.stopPips,
                targetRiskMultiple: 1.5, timeStopHours: 6 });
            expect(result.tradePlan.stopLossPrice).toBeCloseTo(fixture.currentPrice + direction * distance, 10);
            expect(result.tradePlan.takeProfitPrice).toBeCloseTo(fixture.currentPrice - direction * distance * 1.5, 10);
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
        expect(result.entryType).toBe("M15_POST_TP_FADE");
        expect(result.strategyContext.reentry.freshTouchTimes).toEqual([]);
        expect(result.signalType).not.toBe(original.signalType);
    });

    test.each([1, -1].flatMap((direction) => ["STOP_LOSS", "SESSION_CLOSE", "TIME_STOP", "OPPOSITE_TP"]
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
        expect(result.reasonCode).toBe("INTRADAY_MOMENTUM_NO_TRIGGER");
        expect(result.strategyContext.m15.pullbackSequence.legacy[`${side}Pullback`]).toBe(true);
        expect(result.strategyContext.m15.triggerCombination).toBe("none");
        expect(result.strategyContext.reentry).toBeUndefined();
    });
});
