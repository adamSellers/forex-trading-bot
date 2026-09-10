// Test-only bridge from backup.sh's curl stub to the actual activation routes.
// Persistence is confined to the disposable fixture; no broker requests run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
global.fetch = async () => { throw new Error('Unexpected network request in maintenance test'); };
const fixtureRoot = fs.realpathSync(process.env.FOREX_PROJECT_DIR);
assert.equal(fixtureRoot, fs.realpathSync(process.env.MAINTENANCE_TEST_PROJECT));
process.env.DB_PATH = path.join(fixtureRoot, 'backend/data/maintenance-test.db');
const backend = path.resolve(__dirname, '../../backend');
const loggerPath = require.resolve(path.join(backend, 'src/utils/logger'));
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true,
    exports: Object.fromEntries(['info', 'warn', 'error', 'debug', 'success'].map(key => [key, () => {}])) };
const ConfigService = require(path.join(backend, 'src/services/configService'));
const LiveTradingEngine = require(path.join(backend, 'src/services/LiveTradingEngine'));
const routes = require(path.join(backend, 'src/routes/tradingRoutes'));
const { computeConfigHash } = require(path.join(backend, 'src/config/tradingConfig'));

const configService = new ConfigService(path.join(fixtureRoot, 'backend/data/trading_config.json')).init();
const runId = 'maintenance-test-run';
const lastExit = Number(process.env.STUB_LAST_LOSS_AT);
assert(Number.isFinite(lastExit));
const clock = Number(process.env.STUB_RISK_CLOCK_MS || Date.now());
Date.now = () => clock;
const closedTrades = [2, 1, 0].map(index => ({
    id: `fixture-loss-${index}`, ownerRunId: runId, isOpen: false,
    pnlAud: -0.1, exitTime: lastExit - index * 60_000,
}));
const engine = new LiveTradingEngine();
engine.isRunning = true;
engine.brokerStateUncertain = false;
engine.configService = configService;
engine.tradeRepository = { getAllTrades: async () => closedTrades };
engine.getBrokerEntryBlockReason = async () => null;
const coordinator = {
    ensureLiveSelectionInitialized: async () => {},
    getLiveSelection: () => ({ liveRun: {
        runId, strategy: 'intraday_momentum', configHash: computeConfigHash(configService.get()),
    } }),
};
const action = process.argv[2];
const routePath = {
    health: '/health', start: '/trading/start', stop: '/trading/stop',
    readiness: '/trading/live-readiness',
}[action];
assert(routePath, 'Recognised maintenance fixture action');
const method = ['start', 'stop'].includes(action) ? 'post' : 'get';
const layer = routes.stack.find(item => item.route?.path === routePath && item.route.methods[method]);
assert(layer, 'The real maintenance route exists');
const req = { app: { locals: {
    configService, runtimeCoordinator: coordinator, tradingEngine: engine,
} } };
let status = 200;
const res = {
    status(code) { status = code; return this; },
    json(body) { process.stdout.write(JSON.stringify(body)); process.exitCode = status >= 400 ? 22 : 0; return this; },
};
Promise.resolve(layer.route.stack[0].handle(req, res)).catch(error => {
    process.stderr.write(error.stack + '\n'); process.exitCode = 1;
});
