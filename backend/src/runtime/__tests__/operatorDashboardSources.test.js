const { createDashboardSources, observeOperatorChanges, portfolioView } = require('../operatorDashboardSources');
const { EventEmitter } = require('node:events');

test('one dashboard read shares broker account truth and preserves executable quote timestamps', async () => {
    const now = Date.parse('2026-11-09T02:00:00Z');
    let accountReads = 0;
    const brokerClient = {
        getAccountSummary: async () => { accountReads++; return { account: {
            balance: '100', NAV: '101', currency: 'AUD', marginUsed: '2', marginAvailable: '99',
            openTradeCount: '1', pendingOrderCount: '1', unrealizedPL: '1', pl: '0.3',
        } }; },
        getOpenTrades: async () => ({ trades: [{ id: '12', instrument: 'EUR_USD', currentUnits: '-10',
            price: '1.1', unrealizedPL: '1', openTime: String((now - 60_000) / 1000) }] }),
        getPricing: async () => ({ prices: [{ instrument: 'EUR_USD', tradeable: true,
            time: String((now - 60_000) / 1000), bids: [{ price: '1.1000' }], asks: [{ price: '1.1001' }] }] }),
    };
    const sources = createDashboardSources({ brokerClient, now: () => now,
        configService: { get: () => ({ strategy: 'multi_day_trend', assets: ['EUR_USD'] }) },
        coordinator: { getLiveSelection: () => ({ liveRun: { runId: 'run-1' } }) },
        dataService: { getAllPrices: () => ({}) },
        tradeRepository: { getTradeSummary: async () => ({ closedTradeCount: 2, winningTrades: 1 }),
            getTradesSince: async () => [{ pnlAud: 0.3 }] },
    })();
    const [account, portfolio, prices] = await Promise.all([sources.account(), sources.portfolio(), sources.prices()]);
    expect(accountReads).toBe(1);
    expect(account).toMatchObject({ balance: 100, currency: 'AUD', openTrades: 1 });
    expect(portfolio).toMatchObject({ totalValue: 101, realizedLast24hAud: 0.3,
        performance: { runId: 'run-1', winRate: 50 },
        positions: [{ id: '12', side: 'SELL', openTime: new Date(now - 60_000).toISOString() }] });
    expect(prices[0]).toMatchObject({ timestamp: now - 60_000, fetchedAt: now, bid: 1.1, ask: 1.1001 });
});

test('operator invalidations refresh local observations on quotes and release all owned listeners', () => {
    const configService = new EventEmitter();
    const dataService = new EventEmitter();
    const engine = new EventEmitter();
    const coordinator = new EventEmitter();
    const refreshes = [];
    const stop = observeOperatorChanges({ configService, dataService, engine, coordinator }, (names) => refreshes.push(names));
    dataService.emit('priceUpdate', {});
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]).toContain('prices');
    expect(refreshes[0]).not.toContain('account');
    expect(refreshes[0]).not.toContain('portfolio');
    engine.emit('tradeClosed', {});
    expect(refreshes.at(-1)).toBeNull();
    stop();
    stop();
    dataService.emit('priceUpdate', {});
    expect(refreshes).toHaveLength(2);
    for (const emitter of [configService, dataService, engine, coordinator]) expect(emitter.eventNames()).toEqual([]);
});

test('retained HTTP portfolio timestamps keep broker RFC3339 precision', async () => {
    const openTime = '2026-11-09T01:59:00.123456789Z';
    const portfolio = await portfolioView({ account: {}, brokerTrades: [{ currentUnits: '10', openTime }] });
    expect(portfolio.positions[0].openTime).toBe(openTime);
});

test('an observed empty live scan clears historical signals instead of resurrecting an earlier setup', async () => {
    let historyReads = 0;
    const sources = createDashboardSources({
        coordinator: { getStatus: () => ({ activeSignals: [], lastRun: 2 }),
            getLiveSelection: () => ({ liveRun: { runId: 'current-run' } }) },
        signalRepository: { getRecent: async () => { historyReads++; return [{ signal: 'BUY', runId: 'current-run' }]; } },
    })();
    expect(await sources.signals()).toEqual([]);
    expect(historyReads).toBe(0);
});
