const { performance: importedPerformance } = require('node:perf_hooks');
const knex = require('knex');
const { ReplayClock } = require('../replayClock.cjs');
// Import first: installation must reach the already captured perf_hooks object.
const OandaDataService = require('../../src/services/OandaDataService');
const LiveTradingEngine = require('../../src/services/LiveTradingEngine');
const SignalGenerator = require('../../src/services/signalGenerator');
const oandaClient = require('../../src/services/Oandaclient');
const { cloneDefaultConfig } = require('../../src/config/tradingConfig');
const { evaluatePriceAvailability } = require('../../src/runtime/quoteAvailability');
const { evaluateIntradayMomentumEntry } = require('../../src/strategies/intradayMomentum');
const { buyEntryFixture, legacyBuyEntryFixture } = require('../fixtures/causalFlows.cjs');
const { getStrategyDefinition } = require('../../src/strategies');

const START = Date.parse('2026-10-01T23:59:59.900Z');
const TIMER_EXCLUSIONS = ['Date', 'performance', 'hrtime', 'nextTick',
    'queueMicrotask', 'setImmediate', 'clearImmediate'];

describe('research replay clock through production quote observations', () => {
    let clock;
    beforeEach(() => {
        // Freeze only scheduled timers. Native async database and Promise work
        // remains live, while observation advance does not start polling work.
        jest.useFakeTimers({ doNotFake: TIMER_EXCLUSIONS });
        clock = new ReplayClock(START);
        clock.install();
        jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected research network request'));
    });
    afterEach(() => {
        clock.restore();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    function pricing(eventTime = START - 60_000) {
        return { prices: [{ instrument: 'AUD_USD', tradeable: true,
            time: new Date(eventTime).toISOString(),
            bids: [{ price: '0.65996', liquidity: 1000000 }],
            asks: [{ price: '0.66004', liquidity: 1000000 }],
        }], homeConversions: [{ currency: 'USD', positionValue: '1.5', accountGain: '1.5', accountLoss: '1.5' }] };
    }

    function respondWithLatency({ headersMs = 0, bodyMs = 0, eventTime } = {}) {
        globalThis.fetch.mockImplementation(async () => {
            clock.advance(headersMs);
            return { ok: true, json: async () => {
                await Promise.resolve();
                clock.advance(bodyMs);
                return pricing(eventTime);
            } };
        });
    }

    test('Date constructors, calendar methods and both monotonic consumers share one explicit timeline', () => {
        expect(Date.now()).toBe(START);
        expect(new Date().getTime()).toBe(START);
        expect(Date()).toBe(new Date(START).toString());
        expect(new Date() instanceof Date).toBe(true);
        expect(new Date(2000, 0, 2).getFullYear()).toBe(2000);
        expect(Date.parse('2026-10-02T00:00:00Z')).toBe(Date.UTC(2026, 9, 2));
        expect(importedPerformance.now()).toBe(0);
        expect(globalThis.performance.now()).toBe(0);
        expect(clock.advance(100)).toBe(Date.UTC(2026, 9, 2));
        expect(new Date().toISOString()).toBe('2026-10-02T00:00:00.000Z');
        expect(new Date().getUTCHours()).toBe(0);
        expect(new Date().getUTCDate()).toBe(2);
        expect(clock.monoMs()).toBe(100);
        clock.set(START + 10_000);
        expect(clock.nowMs()).toBe(START + 10_000);
        expect(importedPerformance.now()).toBe(10_000);
        expect(globalThis.performance.now()).toBe(10_000);
    });

    test('sub-millisecond latency accumulates without making Date.now disagree with new Date', () => {
        clock.advance(0.5);
        expect(clock.nowMs()).toBe(START);
        expect(new Date().getTime()).toBe(Date.now());
        expect(importedPerformance.now()).toBe(0.5);
        clock.advance(0.5);
        expect(clock.nowMs()).toBe(START + 1);
        expect(new Date().getTime()).toBe(Date.now());
        expect(importedPerformance.now()).toBe(1);
    });

    test('advancing observations leaves polling dormant and real asynchronous SQLite operations can settle', async () => {
        const poll = jest.fn();
        const timer = setInterval(poll, 100);
        const database = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' },
            useNullAsDefault: true, pool: { min: 1, max: 1 } });
        try {
            await database.schema.createTable('clock_observations', (table) => table.bigInteger('received_at'));
            clock.advance(15 * 60_000);
            await database('clock_observations').insert({ received_at: Date.now() });
            expect(await database('clock_observations').first()).toEqual({ received_at: START + 15 * 60_000 });
            await new Promise((resolve) => setImmediate(resolve));
            expect(poll).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
        } finally {
            clearInterval(timer);
            await database.destroy();
        }
    });

    test.each([0, 25])('the actual DataService request accepts %sms elapsed time including the exact deadline', async (elapsedMs) => {
        const service = new OandaDataService(['AUD_USD'], { requestTimeoutMs: 25 });
        respondWithLatency({ headersMs: Math.min(elapsedMs, 10), bodyMs: Math.max(elapsedMs - 10, 0) });
        await service.fetchAllPrices();
        expect(service.getCurrentPrice('AUD_USD')).toMatchObject({
            timestamp: START - 60_000, fetchedAt: START + elapsedMs, tradeable: true, invalidReason: null,
        });
        expect(importedPerformance.now()).toBe(elapsedMs);
        expect(jest.getTimerCount()).toBe(0);
    });

    test.each([
        { headersMs: 26, bodyMs: 0 }, { headersMs: 10, bodyMs: 16 },
    ])('the actual request rejects late headers/body %j without dispatching abort or poll timers', async (latency) => {
        const service = new OandaDataService(['AUD_USD'], { requestTimeoutMs: 25 });
        respondWithLatency(latency);
        await service.fetchAllPrices();
        expect(service.getCurrentPrice('AUD_USD')).toMatchObject({
            fetchedAt: null, tradeable: false, invalidReason: 'PRICE_REQUEST_TIMEOUT',
        });
        expect(service.isFetchingPrices).toBe(false);
        expect(clock.monoMs()).toBe(26);
        expect(jest.getTimerCount()).toBe(0);
        respondWithLatency({ headersMs: 5, bodyMs: 5 });
        await service.fetchAllPrices();
        expect(service.getCurrentPrice('AUD_USD')).toMatchObject({
            fetchedAt: START + 36, tradeable: true, invalidReason: null,
        });
    });

    test.each([25, 26])('the actual engine final quote uses the same monotonic %sms budget', async (elapsedMs) => {
        clock.set(Date.parse('2026-10-02T13:00:00Z'));
        const fixture = buyEntryFixture({ instrument: 'AUD_USD', nowMs: clock.nowMs() });
        const evaluation = await evaluateIntradayMomentumEntry(fixture);
        expect(evaluation.signalType).toBe('BUY');
        const signal = new SignalGenerator().buildSignal(fixture.instrument, evaluation,
            getStrategyDefinition('intraday_momentum'), fixture.currentPrice);
        const service = new OandaDataService([fixture.instrument]);
        service.candleCache.AUD_USD_M15 = fixture.m15;
        service.candleCache.AUD_USD_H1 = fixture.h1;
        const engine = new LiveTradingEngine();
        engine.dataService = service;
        const startedAt = clock.nowMs();
        const startedMonotonicMs = clock.monoMs();
        jest.spyOn(oandaClient, 'getPricing').mockImplementation(async () => {
            clock.advance(elapsedMs);
            return { prices: [{ instrument: fixture.instrument, tradeable: true,
                time: new Date(startedAt - 60_000).toISOString(),
                bids: [{ price: String(fixture.currentPrice - 0.00002), liquidity: 1000000 }],
                asks: [{ price: String(fixture.currentPrice + 0.00002), liquidity: 1000000 }],
            }] };
        });
        const pending = engine.getFinalEntryQuote(signal, { ...cloneDefaultConfig(), maxPriceAgeMs: 25 },
            { pipLocation: -4, displayPrecision: 5 }, 10);
        if (elapsedMs === 25) {
            const quote = await pending;
            expect(quote).toMatchObject({ requestStartedAt: startedAt,
                requestElapsedMs: 25, fetchedAt: startedAt + 25,
                quoteTime: startedAt - 60_000, quoteAgeMs: 60_025 });
            expect(quote.requestStartedMonotonicMs).toBe(startedMonotonicMs);
        } else {
            await expect(pending).rejects.toMatchObject({ code: 'FINAL_QUOTE_EXPIRED',
                entryRejectionCode: 'STALE_PRICE',
                entryRejectionContext: { quoteRequestElapsedMs: 26 } });
        }
    });

    test('successful repeat delivery keeps the old broker event and refreshes only receipt time', async () => {
        const service = new OandaDataService(['AUD_USD'], { requestTimeoutMs: 25 });
        const eventTime = START - 60_000;
        respondWithLatency({ bodyMs: 7, eventTime });
        await service.fetchAllPrices();
        const first = service.getCurrentPrice('AUD_USD');
        clock.advance(5000);
        await service.fetchAllPrices();
        const second = service.getCurrentPrice('AUD_USD');
        expect(first.timestamp).toBe(eventTime);
        expect(second.timestamp).toBe(eventTime);
        expect(second.fetchedAt).toBe(first.fetchedAt + 5007);
        expect(second.tradeable).toBe(true);
        expect(service.getFreshnessStatus()).toMatchObject({ pricesFresh: true,
            oldestPriceAgeMs: 65_014, oldestPriceReceiptAgeMs: 0 });
        clock.advance(20_000);
        expect(evaluatePriceAvailability(second, { maxAgeMs: 20_000 })).toMatchObject({
            available: true, receiptAgeMs: 20_000,
        });
        clock.advance(1);
        expect(evaluatePriceAvailability(second, { maxAgeMs: 20_000 })).toMatchObject({
            available: false, reason: 'STALE_PRICE', receiptAgeMs: 20_001,
        });
    });

    test('installation preserves existing descriptors and restoration is safe to repeat', () => {
        clock.restore();
        const originalDate = globalThis.Date;
        const originalGlobalNow = globalThis.performance.now;
        const originalNow = importedPerformance.now;
        const descriptor = Object.getOwnPropertyDescriptor(importedPerformance, 'now');
        const restore = clock.install();
        expect(importedPerformance.now()).toBe(0);
        expect(() => new ReplayClock(START).install()).toThrow('already installed');
        restore();
        clock.restore();
        expect(globalThis.Date).toBe(originalDate);
        expect(globalThis.performance.now).toBe(originalGlobalNow);
        expect(importedPerformance.now).toBe(originalNow);
        expect(Object.getOwnPropertyDescriptor(importedPerformance, 'now')).toEqual(descriptor);
        const nextClock = new ReplayClock(START + 1000);
        try {
            nextClock.install();
            restore();
            expect(Date.now()).toBe(START + 1000);
            expect(globalThis.performance.now()).toBe(0);
        } finally { nextClock.restore(); }
    });

    test('invalid or backwards observations cannot mutate either clock', () => {
        for (const elapsed of [-1, NaN, Infinity]) expect(() => clock.advance(elapsed)).toThrow();
        expect(() => clock.set(START - 1)).toThrow('cannot rewind');
        expect(() => clock.set(NaN)).toThrow();
        expect(clock.nowMs()).toBe(START);
        expect(clock.monoMs()).toBe(0);
        expect(() => new ReplayClock(NaN)).toThrow();
        expect(() => new ReplayClock(START, { monotonicMs: -1 })).toThrow();
    });
});

describe('completed BUY research fixture with coherent H1 history', () => {
    test.each(['EUR_USD', 'USD_JPY'])(
        '%s break/retest/confirmation reaches the current strategy without replacing its signal', async (instrument) => {
            const fixture = buyEntryFixture({ instrument });
            expect(fixture.m15.every((bar) => bar.complete && Date.parse(bar.time) + 900_000 <= fixture.nowMs)).toBe(true);
            expect(fixture.h1.every((bar) => bar.complete && Date.parse(bar.time) + 3_600_000 <= fixture.nowMs)).toBe(true);
            const lastHour = fixture.h1.at(-1);
            const lastFour = fixture.m15.slice(-4);
            expect(lastHour.open).toBe(lastFour[0].open);
            expect(lastHour.close).toBe(lastFour.at(-1).close);
            expect(lastHour.high).toBe(Math.max(...lastFour.map((bar) => bar.high)));
            expect(lastHour.low).toBe(Math.min(...lastFour.map((bar) => bar.low)));
            const result = await evaluateIntradayMomentumEntry(fixture);
            expect(result.signalType).toBe('BUY');
            expect(result.entryType).toBe('M15_BREAK_RETEST_CONFIRMATION');
            expect(result.tradePlan.stopPriceMode).toBe('STRUCTURAL');
            expect(result.tradePlan.stopLossPrice).toBeLessThan(fixture.currentPrice);
            expect(result.tradePlan.takeProfitPrice).toBeGreaterThan(fixture.currentPrice);
        });

    test.each(['pullback', 'breakout'])('the old %s-only BUY fixture cannot bypass the current structural entry contract', async (entry) => {
        const fixture = legacyBuyEntryFixture({ instrument: 'EUR_USD', entry });
        const result = await evaluateIntradayMomentumEntry(fixture);
        expect(result.signalType).toBe('HOLD');
        expect(result.tradePlan).toBeNull();
        expect(result.entryType).not.toBe('M15_POST_TP_FADE');
    });
});
