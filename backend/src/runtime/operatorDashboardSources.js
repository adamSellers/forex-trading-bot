const { getStrategyDefinition, listStrategyCatalog } = require('../strategies');
const { normalizeOandaPrice, evaluatePriceAvailability } = require('./quoteAvailability');
const POSITION_POLICY = require('../constants/positionPolicy');

function systemStatus({ configService, coordinator, engine, dataService, brokerConfigured = () => true, now = Date.now }) {
    const config = configService.get();
    const strategy = getStrategyDefinition(config.strategy || 'multi_day_trend');
    return {
        status: 'ok', runtime: 'live_only', timestamp: new Date(now()).toISOString(), uptime: process.uptime(),
        services: { api: true, oanda: brokerConfigured(), dataService: dataService?.isRunning === true,
            signalGenerator: coordinator?.isRunning === true, tradingEngine: engine?.isRunning === true },
        config: { enableTrading: config.enableTrading === true, assets: config.assets || [], strategy: strategy.key,
            strategyLabel: strategy.label, strategyVersion: strategy.version, timeframe: config.timeframe || '4h',
            maxOpenPositions: null, positionPolicy: POSITION_POLICY, riskPerTrade: config.riskPerTrade || 0 },
    };
}

function accountView(account) {
    if (!account) throw new Error('Broker account observation is unavailable');
    return { balance: Number(account.balance), currency: account.currency, marginUsed: Number(account.marginUsed),
        marginAvailable: Number(account.marginAvailable), openTrades: Number(account.openTradeCount),
        pendingOrders: Number(account.pendingOrderCount), unrealizedPL: Number(account.unrealizedPL), pl: Number(account.pl) };
}

function brokerDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    const milliseconds = numeric < 100000000000 ? numeric * 1000 : numeric;
    return new Date(milliseconds).toISOString();
}

async function portfolioView({ account, brokerTrades, coordinator, tradeRepository, now = Date.now }) {
    if (!account || !Array.isArray(brokerTrades)) throw new Error('Broker portfolio observation is unavailable');
    const positions = brokerTrades.map((trade) => ({ id: trade.id, instrument: trade.instrument,
        units: Number(trade.currentUnits), side: Number(trade.currentUnits) > 0 ? 'BUY' : 'SELL',
        entryPrice: Number(trade.price), unrealizedPL: Number(trade.unrealizedPL),
        marginUsed: Number(trade.marginUsed || 0), openTime: brokerDate(trade.openTime) }));
    const runId = coordinator?.getLiveSelection?.()?.liveRun?.runId || null;
    const endTime = now();
    const [summary, recentClosed] = await Promise.all([
        runId && tradeRepository?.getTradeSummary
            ? tradeRepository.getTradeSummary({ mode: 'live', ownerRunId: runId }) : null,
        tradeRepository?.getTradesSince
            ? tradeRepository.getTradesSince(endTime - 86400000, { mode: 'live', timeBasis: 'realized', endTime }) : null,
    ]);
    return { balance: Number(account.balance), currency: account.currency,
        performance: summary ? { scope: 'Current run', runId, totalTrades: summary.closedTradeCount,
            winRate: summary.closedTradeCount ? summary.winningTrades / summary.closedTradeCount * 100 : null } : null,
        realizedLast24hAud: recentClosed ? recentClosed.reduce((sum, trade) => sum + Number(trade.pnlAud || 0), 0) : null,
        positions, totalValue: Number(account.NAV), unrealizedPnL: Number(account.unrealizedPL),
        realizedPnL: Number(account.pl), marginUsed: Number(account.marginUsed),
        marginAvailable: Number(account.marginAvailable), exposure: positions.length ? 'Active' : 'None' };
}

// Each refresh gets a new set of readers. Account and portfolio share one
// broker response within that refresh; partial price refreshes never request it.
function createDashboardSources(dependencies) {
    const { configService, coordinator, engine, dataService, tradeRepository, signalRepository,
        brokerClient, brokerConfigured = () => true, now = Date.now } = dependencies;
    return () => {
        let accountRequest;
        const account = () => {
            if (!brokerConfigured()) throw new Error('Oanda credentials are not configured');
            return accountRequest ||= Promise.resolve().then(() => brokerClient.getAccountSummary()).then((response) => {
                if (!response?.account) throw new Error('Broker account observation is unavailable');
                return response.account;
            });
        };
        return {
            systemStatus: () => systemStatus(dependencies),
            engineStatus: () => {
                if (!engine?.getStatus) throw new Error('Trading engine status is unavailable');
                return engine.getStatus();
            },
            account: async () => accountView(await account()),
            portfolio: async () => {
                const [observedAccount, response] = await Promise.all([account(), brokerClient.getOpenTrades()]);
                return portfolioView({ account: observedAccount, brokerTrades: response?.trades, coordinator, tradeRepository, now });
            },
            trades: () => {
                if (!tradeRepository?.getRecent) throw new Error('Trade history is unavailable');
                return tradeRepository.getRecent(50, { mode: 'live' });
            },
            signals: async () => {
                const status = coordinator?.getStatus?.() || {};
                let signals = status.activeSignals;
                if (!Array.isArray(signals)) {
                    const runId = coordinator?.getLiveSelection?.()?.liveRun?.runId;
                    if (!runId || !signalRepository?.getRecent) throw new Error('Live signals are unavailable');
                    signals = await signalRepository.getRecent(100, { mode: 'live', runId });
                }
                return signals.slice(0, 100);
            },
            prices: async () => {
                const instruments = configService.get().assets || [];
                const cached = dataService?.getAllPrices?.() || {};
                const rows = instruments.map((instrument) => cached[instrument]).filter(Boolean);
                if (instruments.length && rows.length === instruments.length && rows.every((row) =>
                    evaluatePriceAvailability(row, { nowMs: now(), maxAgeMs: 15000, requireTradeable: false }).available)) return rows;
                if (!instruments.length) return [];
                if (!brokerConfigured()) throw new Error('Oanda credentials are not configured');
                const response = await brokerClient.getPricing(instruments);
                if (!Array.isArray(response?.prices)) throw new Error('Oanda pricing response did not contain prices');
                const fetchedAt = now();
                return instruments.map((instrument) => {
                    const matches = response.prices.filter((price) => price.instrument === instrument);
                    const price = normalizeOandaPrice(matches.length === 1 ? matches[0] : null, { instrument, fetchedAt });
                    if (matches.length > 1) price.invalidReason = 'DUPLICATE_PRICE';
                    return price;
                });
            },
            liveSelection: async () => {
                if (!coordinator?.getLiveSelection) throw new Error('Live run identity is unavailable');
                await coordinator.ensureLiveSelectionInitialized?.();
                return coordinator.getLiveSelection();
            },
            catalog: () => listStrategyCatalog(),
        };
    };
}

function observeOperatorChanges({ configService, coordinator, engine, dataService }, invalidate) {
    const remove = [];
    const observe = (emitter, event, listener) => {
        if (!emitter?.on) return;
        emitter.on(event, listener);
        remove.push(() => emitter.off?.(event, listener));
    };
    const local = ['systemStatus', 'engineStatus', 'readiness', 'operationalHealth'];
    observe(dataService, 'priceUpdate', () => invalidate(['prices', ...local]));
    observe(coordinator, 'allSignalsGenerated', () => invalidate(['signals', 'liveSelection', ...local]));
    observe(coordinator, 'liveSelectionChanged', () => invalidate(null));
    observe(coordinator, 'runtimeRunsChanged', () => invalidate(null));
    observe(configService, 'configChanged', () => invalidate(null));
    observe(engine, 'tradeOpened', () => invalidate(null));
    observe(engine, 'tradeClosed', () => invalidate(null));
    observe(engine, 'engineStopped', () => invalidate(local));
    observe(engine, 'orderError', () => invalidate(local));
    observe(engine, 'engineTelemetry', ({ type } = {}) => {
        if (['brokerReconciliationPending', 'brokerTradeQuarantined', 'ambiguousOrderRecovered',
            'orderSubmitted', 'filled', 'exitRecorded', 'stopUpdated'].includes(type)) invalidate(local);
    });
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        remove.forEach((off) => off());
    };
}

module.exports = { createDashboardSources, observeOperatorChanges, systemStatus, accountView, portfolioView };
