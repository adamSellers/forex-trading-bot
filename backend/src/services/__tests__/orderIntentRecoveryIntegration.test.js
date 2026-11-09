const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const knex = require('knex');

let mockDatabase;
jest.mock('../emailService', () => ({
    sendTradeOpenedAlert: jest.fn(async () => {}), sendTradeClosedAlert: jest.fn(async () => {}),
}));

const LiveTradingEngine = require('../LiveTradingEngine');
const TradeRepository = require('../../repositories/tradeRepository');
const BrokerLifecycleRepository = require('../../repositories/brokerLifecycleRepository');
const { cloneDefaultConfig } = require('../../config/tradingConfig');
const oanda = require('../Oandaclient');

const entryAt = Date.parse('2026-10-14T13:02:00Z');
const closedAt = entryAt + 60_000;
const fill = {
    id: '102', orderID: '101', type: 'ORDER_FILL', instrument: 'EUR_USD', units: '10',
    price: '1.10000', time: new Date(entryAt).toISOString(),
    tradeOpened: { tradeID: '102', units: '10', price: '1.10000', initialMarginRequired: '1' },
};
const closedDetails = { trade: {
    id: '102', instrument: 'EUR_USD', state: 'CLOSED', initialUnits: '10', currentUnits: '0',
    price: '1.10000', openTime: new Date(entryAt).toISOString(), averageClosePrice: '1.09800',
    closeTime: new Date(closedAt).toISOString(), realizedPL: '-0.0300', financing: '-0.0020',
    commission: '0.0010', stopLossOrder: { state: 'FILLED', price: '1.09800' },
} };

describe('durable filled-order recovery through engine startup and broker reconciliation', () => {
    let directory;
    let databasePath;
    let trades;
    let lifecycle;
    let engines;
    let requests;

    async function openDatabase() {
        mockDatabase = knex({ client: 'better-sqlite3', connection: { filename: databasePath },
            useNullAsDefault: true, pool: { min: 1, max: 1 } });
        await mockDatabase.migrate.latest({ directory: path.resolve(__dirname, '../../../migrations') });
        trades = new TradeRepository(mockDatabase);
        lifecycle = new BrokerLifecycleRepository(mockDatabase);
    }

    function engine() {
        const config = { ...cloneDefaultConfig(), enableTrading: true };
        const configService = Object.assign(new EventEmitter(), { get: () => config });
        const value = new LiveTradingEngine({ brokerLifecycleRepository: lifecycle }).init(configService, {
            getCurrentPrice: () => null,
        }, trades, new EventEmitter(), null, null, lifecycle);
        engines.push(value);
        return value;
    }

    async function seedFilledIntent(overrides = {}) {
        const config = cloneDefaultConfig();
        return lifecycle.createIntent({
            intentId: 'recovery-entry', clientOrderId: 'oi-recovery-entry', clientTradeId: 'ti-recovery-entry',
            tradeId: 'local-102', brokerTradeId: '102', brokerOrderId: '101', instrument: 'EUR_USD',
            side: 'BUY', units: 10, status: 'FILLED_UNPERSISTED', submittedAt: entryAt,
            lastTransactionId: '103', responsePayload: { orderFillTransaction: fill },
            contextPayload: { config, signal: { symbol: 'EUR_USD', signal: 'BUY', strategy: 'multi_day_trend',
                strategyVersion: '2.1.0', runId: 'recovery-run', entryType: 'ROLLING_CHANNEL_BREAKOUT',
                atrPips: 10, tradePlan: { stopPips: 20, stopPriceMode: 'ATR_DISTANCE' } },
            initialStopLossPrice: 1.098, baseToAudRate: 1.65, quoteToAudRate: 1.5, riskBudgetAud: 0.03,
            instrumentMetadata: { name: 'EUR_USD', displayPrecision: 5, pipLocation: -4 } },
            ...overrides,
        });
    }

    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-intent-recovery-'));
        databasePath = path.join(directory, 'test.db');
        engines = [];
        requests = [];
        jest.spyOn(Date, 'now').mockReturnValue(closedAt + 60_000);
        jest.spyOn(global, 'fetch').mockImplementation(() => { throw new Error('Unexpected network request'); });
        jest.spyOn(oanda, 'initialize').mockResolvedValue({});
        jest.spyOn(oanda, '_request').mockImplementation(async (method, endpoint) => {
            requests.push({ method, endpoint });
            if (method === 'GET' && endpoint.endsWith('/openTrades')) return { trades: [] };
            if (method === 'GET' && endpoint.endsWith('/trades/102')) return structuredClone(closedDetails);
            if (method === 'GET' && endpoint.includes('/transactions/sinceid')) return {
                lastTransactionID: '104', transactions: endpoint.endsWith('=103') ? [{
                    id: '104', type: 'ORDER_FILL', orderID: '103', reason: 'STOP_LOSS_ORDER',
                    tradesClosed: [{ tradeID: '102', price: '1.09800', realizedPL: '-0.0300' }],
                }] : [],
            };
            throw new Error(`Unexpected broker request: ${method} ${endpoint}`);
        });
        await openDatabase();
    });

    afterEach(async () => {
        engines.forEach((value) => value.stop());
        await mockDatabase?.destroy();
        jest.restoreAllMocks();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test('a cold start records a saved fill that the broker already closed and resolves its entry block', async () => {
        await seedFilledIntent();
        // Closing/reopening SQLite and constructing a fresh engine models the
        // process stopping between durable fill recording and trade insertion.
        await mockDatabase.destroy();
        await openDatabase();
        const restarted = engine();
        await restarted.start();
        await restarted.syncWithOanda({ throwOnError: true });

        const recovered = await trades.getAllTrades();
        expect(recovered).toHaveLength(1);
        expect(recovered[0]).toMatchObject({ id: 'local-102', oandaTradeId: '102', isOpen: false,
            entryTime: entryAt, exitTime: closedAt, exitReason: 'STOP_LOSS',
            pnlAud: -0.033, swapAud: -0.002, commissionAud: 0.001 });
        expect(await lifecycle.getRecoverableIntents()).toEqual([]);
        expect(await lifecycle.getIntent('recovery-entry')).toMatchObject({ status: 'COMPLETED', brokerTradeId: '102' });
        expect(await restarted.getBrokerEntryBlockReason()).toBeNull();
        expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });

    test('a lost response and failed trade save retain their recovered fill across another cold restart', async () => {
        const extensions = oanda.buildClientExtensions('recovery-entry');
        await seedFilledIntent({ status: 'SUBMITTING', brokerTradeId: null, brokerOrderId: null,
            lastTransactionId: '100', responsePayload: null,
            clientOrderId: extensions.order.id, clientTradeId: extensions.trade.id });
        const transport = oanda._request.getMockImplementation();
        oanda._request.mockImplementation(async (method, endpoint, ...rest) => {
            if (method === 'GET' && endpoint.endsWith('/transactions/sinceid?id=100')) return {
                lastTransactionID: '104', transactions: [
                    { id: '101', type: 'MARKET_ORDER', clientExtensions: extensions.order },
                    fill,
                    { id: '104', type: 'ORDER_FILL', orderID: '103', reason: 'STOP_LOSS_ORDER',
                        tradesClosed: [{ tradeID: '102', price: '1.09800', realizedPL: '-0.0300' }] },
                ],
            };
            return transport(method, endpoint, ...rest);
        });
        jest.spyOn(trades, 'save').mockRejectedValueOnce(new Error('Injected SQLite write failure'));
        const first = engine();
        await first.start();
        expect(await lifecycle.getIntent('recovery-entry')).toMatchObject({ status: 'RECOVERY_PENDING',
            brokerTradeId: '102', responsePayload: { orderFillTransaction: fill } });
        expect(await first.getBrokerEntryBlockReason()).toMatch(/unresolved/);
        expect(await trades.getAllTrades()).toEqual([]);

        first.stop();
        await mockDatabase.destroy();
        await openDatabase();
        const restarted = engine();
        await restarted.start();
        await restarted.syncWithOanda({ throwOnError: true });
        expect(await trades.getAllTrades()).toEqual([expect.objectContaining({ isOpen: false,
            oandaTradeId: '102', pnlAud: -0.033, exitReason: 'STOP_LOSS' })]);
        expect(await lifecycle.getRecoverableIntents()).toEqual([]);
        expect(await restarted.getBrokerEntryBlockReason()).toBeNull();
        expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });

    test('a completed trade row resolves an interrupted intent without inserting the closed trade again', async () => {
        const intent = await seedFilledIntent();
        const first = engine();
        await first.start();
        const [closed] = await trades.getAllTrades();
        expect(closed.isOpen).toBe(false);
        await lifecycle.updateIntent(intent.intentId, { status: 'FILLED_UNPERSISTED', resolvedAt: null });
        first.stop();
        await mockDatabase.destroy();
        await openDatabase();

        const restarted = engine();
        await restarted.start();
        await restarted.syncWithOanda({ throwOnError: true });
        expect(await trades.getAllTrades()).toEqual([closed]);
        expect(await lifecycle.getRecoverableIntents()).toEqual([]);
        expect(await restarted.getBrokerEntryBlockReason()).toBeNull();
    });

    test('a retained fill for another broker trade remains unresolved without discarding its evidence', async () => {
        const responsePayload = { orderFillTransaction: { ...fill,
            tradeOpened: { ...fill.tradeOpened, tradeID: '999' } } };
        await seedFilledIntent({ responsePayload });
        const restarted = engine();
        await restarted.start();
        await restarted.syncWithOanda({ throwOnError: true });
        expect(await trades.getAllTrades()).toEqual([]);
        expect(await lifecycle.getIntent('recovery-entry')).toMatchObject({ status: 'RECOVERY_PENDING',
            brokerTradeId: '102', responsePayload,
            lastError: 'Retained entry fill does not match its order intent' });
        expect(await restarted.getBrokerEntryBlockReason()).toMatch(/unresolved/);
        expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });

    test('a genuinely unknown order outcome continues blocking entries without sending another order', async () => {
        await seedFilledIntent({ status: 'SUBMITTING', brokerTradeId: null, responsePayload: null });
        const restarted = engine();
        await restarted.start();
        await restarted.syncWithOanda({ throwOnError: true });
        expect(await trades.getAllTrades()).toEqual([]);
        expect(await lifecycle.getRecoverableIntents()).toHaveLength(1);
        expect(await restarted.getBrokerEntryBlockReason()).toMatch(/unresolved/);
        expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });

    test('a retained fill still reconstructs an open protected trade under its original owner', async () => {
        await seedFilledIntent();
        const openTrade = { id: '102', instrument: 'EUR_USD', state: 'OPEN', initialUnits: '10', currentUnits: '10',
            price: '1.10000', openTime: new Date(entryAt).toISOString(), initialMarginRequired: '1',
            stopLossOrder: { state: 'PENDING', price: '1.09800' } };
        const transport = oanda._request.getMockImplementation();
        oanda._request.mockImplementation(async (method, endpoint, body) => {
            if (method === 'GET' && endpoint.endsWith('/openTrades')) return { trades: [structuredClone(openTrade)] };
            if (method === 'GET' && endpoint.endsWith('/trades/102')) return { trade: structuredClone(openTrade) };
            if (method === 'PUT' && endpoint.endsWith('/trades/102/orders')) return {
                stopLossOrderTransaction: { id: '105', tradeID: '102', price: body.stopLoss.price },
            };
            return transport(method, endpoint, body);
        });
        const restarted = engine();
        await restarted.start();
        await restarted.syncWithOanda({ throwOnError: true });
        const recovered = await trades.getAllTrades();
        expect(recovered).toEqual([expect.objectContaining({ oandaTradeId: '102', isOpen: true,
            ownerRunId: 'recovery-run', stopLossPrice: 1.098 })]);
        expect(recovered[0].brokerReconciliationPayload.liveRuntime.initialRiskAud).toBeCloseTo(0.03, 10);
        expect(recovered[0].brokerReconciliationPayload.entryFill).toEqual(fill);
        expect(await lifecycle.getRecoverableIntents()).toEqual([]);
        expect(await restarted.getBrokerEntryBlockReason()).toBeNull();
    });

    test('closed broker exposure remains blocked until cumulative accounting is available', async () => {
        await seedFilledIntent();
        const transport = oanda._request.getMockImplementation();
        let accountingAvailable = false;
        oanda._request.mockImplementation(async (method, endpoint, ...rest) => {
            if (!accountingAvailable && method === 'GET' && endpoint.endsWith('/trades/102')) {
                const details = structuredClone(closedDetails);
                delete details.trade.realizedPL;
                return details;
            }
            return transport(method, endpoint, ...rest);
        });
        const restarted = engine();
        await restarted.start();
        expect(await trades.getAllTrades()).toEqual([expect.objectContaining({ isOpen: true,
            reconciliationStatus: 'CLOSE_RETRY_PENDING' })]);
        expect(await restarted.getBrokerEntryBlockReason()).toMatch(/pending/);
        accountingAvailable = true;
        await restarted.syncWithOanda({ throwOnError: true });
        expect(await trades.getAllTrades()).toEqual([expect.objectContaining({ isOpen: false, pnlAud: -0.033 })]);
        expect(await restarted.getBrokerEntryBlockReason()).toBeNull();
        expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
    });
});
