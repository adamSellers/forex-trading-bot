// Run from any directory with Node 20/22 after frontend dependencies are installed:
// node scripts/tests/frontend_refresh_contract.test.cjs
// Executes the actual refresh callback and deadline helper extracted from JSX.
// Only React setters and API responses are mocked; no copied refresh logic,
// browser rendering, network requests, broker calls, or application builds.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '../..');
const parser = require(require.resolve('@babel/parser', {
    paths: [path.join(projectRoot, 'frontend')],
}));
const source = fs.readFileSync(
    path.join(projectRoot, 'frontend/src/components/TradingDashboard.jsx'), 'utf8'
);
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });

function findInitializer(node, name) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'VariableDeclarator' && node.id.name === name) return node.init;
    for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
            const found = findInitializer(child, name);
            if (found) return found;
        }
    }
    return null;
}

const callback = findInitializer(ast, 'fetchInitialData')?.arguments?.[0];
const deadline = findInitializer(ast, 'withReadDeadline');
assert.equal(callback?.type, 'ArrowFunctionExpression', 'Locate the actual refresh callback');
assert.equal(deadline?.type, 'ArrowFunctionExpression', 'Locate the actual deadline helper');

const states = {};
const requests = [];
let clockMs = 1000;
const context = {
    isMountedRef: { current: true },
    refreshSequenceRef: { current: 0 },
    readinessSequenceRef: { current: 0 },
    strategyCatalogRef: { current: [{ key: 'intraday_momentum' }] },
    FETCH_LIMITS: { TRADES: 50, SIGNALS: 100 },
    normalizeStrategySelection: (key) => key,
    updateSignalState: (value) => { states.signals = value; },
    withReadDeadline: (promise) => promise,
    Date: { now: () => clockMs },
    console,
};
for (const key of [
    'Loading', 'DataError', 'SystemStatus', 'TradingEnabled', 'EngineStatus',
    'LiveSelection', 'SelectedStrategy', 'Portfolio', 'Trades', 'Prices', 'Account',
    'LiveReadiness', 'LastUpdate', 'StrategyCatalog',
]) {
    context['set' + key] = (value) => {
        states[key] = typeof value === 'function' ? value(states[key]) : value;
        if (key === 'StrategyCatalog') context.strategyCatalogRef.current = states[key];
    };
}
const getter = (key) => () => new Promise((resolve, reject) => {
    requests.push({ key, resolve, reject });
});
context.tradingAPI = Object.fromEntries(
    ['Status', 'Portfolio', 'Trades', 'Signals', 'Prices', 'Account', 'LiveReadiness']
        .map((key) => ['get' + key, getter(key)])
);
context.engineAPI = { getStatus: getter('Engine') };
context.runtimeAPI = { getLiveSelection: getter('Selection') };
context.strategiesAPI = { getCatalog: getter('Catalog') };
const refresh = vm.runInNewContext('(' + source.slice(callback.start, callback.end) + ')', context);

function resolveBatch(batch, nav, rejectKey = null) {
    const payload = {
        Status: { config: { enableTrading: false, strategy: 'intraday_momentum' } },
        Portfolio: { totalValue: nav },
        Trades: [], Signals: [], Prices: { prices: [] },
        Account: { balance: nav }, LiveReadiness: { passed: true },
        Engine: { isRunning: true },
        Selection: { liveSelection: { strategy: 'intraday_momentum' } },
        Catalog: [{ key: 'intraday_momentum' }],
    };
    assert.equal(batch.length, 10, 'Each dashboard refresh requests all ten data sources');
    for (const request of batch) {
        if (request.key === rejectKey) request.reject(new Error('mock unavailable'));
        else request.resolve(payload[request.key]);
    }
}

(async () => {
    const older = refresh();
    const oldBatch = requests.splice(0);
    const newer = refresh();
    const newBatch = requests.splice(0);
    resolveBatch(newBatch, 200);
    await newer;
    const verifiedAt = states.LastUpdate;
    assert.equal(states.Portfolio.totalValue, 200);
    clockMs += 1000;
    resolveBatch(oldBatch, 100);
    await older;
    assert.equal(states.Portfolio.totalValue, 200, 'An obsolete refresh cannot overwrite newer data');
    assert.equal(states.LastUpdate, verifiedAt, 'An obsolete refresh cannot advance freshness');

    clockMs += 1000;
    const partial = refresh();
    resolveBatch(requests.splice(0), 300, 'Portfolio');
    await partial;
    assert.equal(states.Portfolio.totalValue, 200, 'A failed read retains the last good portfolio');
    assert.match(states.DataError, /portfolio/);
    assert.equal(states.LastUpdate, verifiedAt, 'A partial refresh cannot advance full-refresh time');

    const catalogBefore = states.StrategyCatalog;
    const failedCatalog = refresh();
    resolveBatch(requests.splice(0), 400, 'Catalog');
    await failedCatalog;
    assert.equal(states.StrategyCatalog, catalogBefore, 'A failed catalog read retains prior choices');

    let timeout;
    const bounded = vm.runInNewContext('(' + source.slice(deadline.start, deadline.end) + ')', {
        setTimeout: (callback) => { timeout = callback; return 1; },
        clearTimeout: () => {},
    });
    const pending = bounded(new Promise(() => {}));
    timeout();
    await assert.rejects(pending, /timed out/);
    process.stdout.write('Frontend refresh contracts passed (4 scenarios: obsolete refresh, partial failure, catalog retention, deadline).\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
