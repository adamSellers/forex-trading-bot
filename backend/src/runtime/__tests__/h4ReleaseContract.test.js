const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ConfigService = require('../../services/configService');
const OandaDataService = require('../../services/OandaDataService');
const SignalGenerator = require('../../services/signalGenerator');
const MarketContextService = require('../marketContextService');
const LiveTradingEngine = require('../../services/LiveTradingEngine');
const { cloneDefaultConfig, computeConfigHash, materializeStrategyConfig } = require('../../config/tradingConfig');
const legacyDefaults = require('../../../../shared/legacyIntradayConfigDefaults.json');
const { getStrategyDefinition, listStrategyCatalog } = require('../../strategies');
const { buildOwnerRunExitPolicy, resolveOwnerRunExitPolicy, resolveTimedExitReason } = require('../exitPolicy');

const H4_MS = 4 * 60 * 60 * 1000;
const copy = value => JSON.parse(JSON.stringify(value));

function h4Breakout() {
    const start = Date.parse('2026-08-10T21:00:00Z');
    return Array.from({ length: 23 }, (_, index) => ({
        time: new Date(start + index * H4_MS).toISOString(), complete: true,
        open: 1.1, high: index === 22 ? 1.1022 : 1.101,
        low: 1.099, close: index === 22 ? 1.102 : 1.1, volume: 100,
    }));
}

describe('H4 release integration contracts', () => {
    let directory;
    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-h4-release-contract-'));
        jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
            throw new Error('Contract tests cannot contact a broker');
        });
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test.each([false, true])('v6 migration preserves saved enabled=%s and shared risk without retaining its entry/exit rules', enabled => {
        const saved = { ...copy(legacyDefaults), enableTrading: enabled, riskPerTrade: 0.001,
            maxCapitalAtRisk: 75, maxAggregateStopRiskPctNav: 0.004,
            logLevel: 'debug', intradayTargetRiskMultiple: 1.8, timeStopHours: 4 };
        const configPath = path.join(directory, 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(saved));
        const current = new ConfigService(configPath).init().get();
        expect(current).toMatchObject({ strategy: 'multi_day_trend', liveReleaseVersion: 'h4-channel-v1',
            executionPolicyVersion: 'h4-channel-risk-v1', timeframe: '4h', enableTrading: enabled,
            riskPerTrade: 0.001, maxCapitalAtRisk: 75, maxAggregateStopRiskPctNav: 0.004,
            logLevel: 'debug', enableTakeProfit: false, enableBreakeven: false, timeStopHours: 0 });
        expect(current).not.toHaveProperty('intradayTargetRiskMultiple');
        expect(new ConfigService(configPath).init().get()).toEqual(current);
        expect(saved.timeStopHours).toBe(4);
        expect(saved.intradayTargetRiskMultiple).toBe(1.8);
    });

    test('historical v6 materialization retains its original hash and never acquires H4 defaults', () => {
        const original = copy(legacyDefaults);
        expect(computeConfigHash(original)).toBe('32b0c1a414ebab60913b');
        const materialized = materializeStrategyConfig(original);
        expect(materialized).toEqual(original);
        expect(computeConfigHash(materialized)).toBe('32b0c1a414ebab60913b');
        expect(materialized).not.toHaveProperty('trendBreakoutBars');
        expect(materialized).not.toHaveProperty('enableChannelTrailing');
    });

    test.each([false, true])('actual entry validation rejects unsafe retained risk with saved enabled=%s', async enabled => {
        const saved = { ...copy(legacyDefaults), enableTrading: enabled,
            riskPerTrade: 0.01, maxCapitalAtRisk: 500 };
        const configPath = path.join(directory, 'unsafe.json');
        fs.writeFileSync(configPath, JSON.stringify(saved));
        const service = new ConfigService(configPath).init();
        const engine = new LiveTradingEngine().init(service);
        const config = service.get();
        expect(config).toMatchObject({ strategy: 'multi_day_trend', enableTrading: enabled,
            riskPerTrade: 0.01, maxCapitalAtRisk: 500 });
        const result = await engine.validateEntry({ symbol: 'EUR_USD', signal: 'BUY',
            currentPrice: 1.1 }, config);
        expect(result.valid).toBe(false);
        if (enabled) {
            expect(result).toMatchObject({ code: 'EXPOSURE_LIMIT',
                reason: 'Configured risk exceeds the existing live release caps' });
            expect(result.context.riskLimitViolations).toEqual(expect.arrayContaining([
                expect.objectContaining({ key: 'riskPerTrade', actual: 0.01, max: 0.0025 }),
                expect.objectContaining({ key: 'maxCapitalAtRisk', actual: 500, max: 100 }),
            ]));
        } else {
            expect(result.code).toBe('TRADING_DISABLED');
        }
        expect(service.get().enableTrading).toBe(enabled);
        expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).enableTrading).toBe(enabled);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('the actual catalog exposes H4 only while legacy definition lookup stays versioned', () => {
        expect(getStrategyDefinition('intraday_momentum')).toMatchObject({
            key: 'intraday_momentum', version: '1.4.0', requiredData: { timeframes: ['15m', '1h'] },
        });
        expect(getStrategyDefinition('multi_day_trend')).toMatchObject({
            key: 'multi_day_trend', version: '2.0.0', requiredData: { timeframes: ['4h'] },
        });
        expect(listStrategyCatalog().map(item => item.key)).toEqual(['multi_day_trend']);
        const router = require('../../routes/tradingRoutes');
        const route = router.stack.find(item => item.route?.path === '/strategies/catalog').route.stack[0].handle;
        const res = { json: jest.fn() };
        route({}, res);
        expect(res.json.mock.calls[0][0].strategies.map(item => item.key)).toEqual(['multi_day_trend']);
    });

    test('a persisted v6 owner keeps its six-hour exit while the new owner holds through an ordinary weekday', () => {
        const legacy = buildOwnerRunExitPolicy({ strategy: 'intraday_momentum', config: legacyDefaults,
            ownerRunId: 'old-owner', createdAt: Date.parse('2026-08-11T06:00:00Z') });
        const modern = buildOwnerRunExitPolicy({ strategy: 'multi_day_trend', config: cloneDefaultConfig(),
            ownerRunId: 'new-owner', createdAt: Date.parse('2026-08-11T06:00:00Z') });
        const trade = { entryTime: Date.parse('2026-08-11T06:00:00Z'), ownerRunId: 'old-owner',
            brokerReconciliationPayload: { liveRuntime: { ownerExitPolicy: copy(legacy) } } };
        expect(resolveOwnerRunExitPolicy(trade, cloneDefaultConfig())).toEqual(legacy);
        const now = Date.parse('2026-08-11T13:00:00Z');
        expect(resolveTimedExitReason({ trade, policy: legacy, now })).toBe('TIME_STOP');
        expect(resolveTimedExitReason({ trade, policy: modern, now })).toBeNull();
        expect(legacy.config.enableBreakeven).toBe(true);
        expect(modern.config.enableBreakeven).toBe(false);
    });

    test('actual data/context/generator accepts a fresh H4 breakout with no M15 or H1 cache', async () => {
        const candles = h4Breakout();
        const now = Date.parse(candles.at(-1).time) + H4_MS + 91_000;
        jest.spyOn(Date, 'now').mockReturnValue(now);
        const config = { ...cloneDefaultConfig(), assets: ['EUR_USD'] };
        const data = new OandaDataService(config.assets);
        data.updateCandleConfig(config);
        data.candleCache.EUR_USD_H4 = candles;
        data.priceCache.EUR_USD = { price: 1.10204, bid: 1.102, ask: 1.10208, spread: 0.8,
            timestamp: now, fetchedAt: now, tradeable: true };
        expect(data.getEntryFreshness('EUR_USD', { nowMs: now }).fresh).toBe(true);
        const contexts = new MarketContextService();
        const run = { runId: 'h4-contract', strategy: config.strategy, config, assets: config.assets };
        const shared = contexts.buildSharedContext([run], data);
        const context = contexts.createInstrumentContext(shared, run, 'EUR_USD');
        expect(Object.keys(context.timeframes)).toEqual(['4h']);
        expect(context.entryFreshness.fresh).toBe(true);
        const generator = new SignalGenerator(config);
        const signal = await generator.generateSignal('EUR_USD', candles, data.priceCache.EUR_USD.price,
            { marketContext: context, nowMs: now });
        expect(signal).toMatchObject({ signal: 'BUY', strategy: 'multi_day_trend', strategyVersion: '2.0.0',
            entryType: 'ROLLING_CHANNEL_BREAKOUT', tradePlan: { takeProfitPrice: null, targetRiskMultiple: null } });
        expect(signal.strategyContext).not.toHaveProperty('buyRetest');
        expect(signal.strategyContext).not.toHaveProperty('lossReset');
        expect(data.getCandles('EUR_USD', '15m')).toEqual([]);
        expect(data.getCandles('EUR_USD', '1h')).toEqual([]);
        data.candleCache.EUR_USD_H4 = candles.slice(0, -1);
        data.candleCache.EUR_USD_M15 = [{ time: new Date(Math.floor(now / 900_000) * 900_000 - 900_000).toISOString() }];
        data.candleCache.EUR_USD_H1 = [{ time: new Date(Math.floor(now / 3_600_000) * 3_600_000 - 3_600_000).toISOString() }];
        expect(data.getEntryFreshness('EUR_USD', { nowMs: now }).fresh).toBe(false);
        const staleContext = contexts.createInstrumentContext(contexts.buildSharedContext([run], data), run, 'EUR_USD');
        const stale = await generator.generateSignal('EUR_USD', data.getCandles('EUR_USD', '4h'),
            data.priceCache.EUR_USD.price, { marketContext: staleContext, nowMs: now });
        expect(stale).toMatchObject({ signal: 'HOLD', reasonCode: 'MULTI_DAY_TREND_STALE_COMPLETED_CANDLE' });
    });

    test.each([
        ['2026-08-11T13:00:00Z', '2026-08-11T17:01:31Z'],
        ['2026-11-10T14:00:00Z', '2026-11-10T18:01:31Z'],
        ['2026-08-10T17:00:00Z', '2026-08-10T21:06:00Z'],
    ])('H4 data freshness honors broker NY alignment at %s', (start, now) => {
        const data = new OandaDataService(['EUR_USD']);
        data.candleCache.EUR_USD_H4 = [{ time: start, complete: true, open: 1.1, high: 1.11, low: 1.09, close: 1.1 }];
        expect(data.getEntryFreshness('EUR_USD', { nowMs: Date.parse(now) }).fresh).toBe(true);
        expect(data.getEntryFreshness('EUR_USD', { strategy: 'intraday_momentum', nowMs: Date.parse(now) }).fresh).toBe(false);
    });

    test('Friday H4 history cannot become a new entry after the DST weekend reopen', () => {
        const data = new OandaDataService(['EUR_USD']);
        data.candleCache.EUR_USD_H4 = [{ time: '2026-10-30T17:00:00Z', complete: true,
            open: 1.1, high: 1.11, low: 1.09, close: 1.1 }];
        expect(data.getEntryFreshness('EUR_USD', { nowMs: Date.parse('2026-11-01T22:06:00Z') }))
            .toMatchObject({ fresh: false, code: 'H4_SIGNAL_EXPIRED' });
    });

    test('H4 broker fetching preserves completed side OHLC and ignores the forming tail', async () => {
        const data = new OandaDataService(['EUR_USD']);
        const candle = { time: '2026-08-11T13:00:00.000000000Z', complete: true, volume: 40,
            mid: { o: '1.10', h: '1.11', l: '1.09', c: '1.105' },
            bid: { o: '1.09995', h: '1.10995', l: '1.08995', c: '1.10495' },
            ask: { o: '1.10005', h: '1.11005', l: '1.09005', c: '1.10505' } };
        data.oandaRequest = jest.fn(async () => ({ candles: [candle, { ...candle,
            time: '2026-08-11T17:00:00.000000000Z', complete: false }] }));
        await data.fetchCandles('EUR_USD', 'H4', 500);
        const request = new URL(data.oandaRequest.mock.calls[0][0], 'https://broker.invalid');
        expect(request.searchParams.get('granularity')).toBe('H4');
        expect(request.searchParams.get('price')).toBe('MBA');
        expect(data.getCandles('EUR_USD', '4h')).toEqual([expect.objectContaining({
            time: candle.time, high: 1.11, bid: expect.objectContaining({ low: 1.08995 }),
            ask: expect.objectContaining({ high: 1.11005 }),
        })]);
    });
});
