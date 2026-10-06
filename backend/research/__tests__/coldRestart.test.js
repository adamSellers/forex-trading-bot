const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const workerPhase = process.env.RESEARCH_COLD_WORKER_PHASE;
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (workerPhase) {
    const { createReplayTestHarness, fixtureArchive, START } = require('../testHarness.cjs');
    const { buyEntryFixture } = require('../fixtures/causalFlows.cjs');
    const env = createReplayTestHarness();

    // Each worker reconstructs the same archive in its fresh heap. Only the
    // explicit external broker checkpoint, SQLite and caller-owned config cross
    // the process boundary; cached market/application objects never do.
    test(`isolated cold-restart worker ${workerPhase}`, async () => {
        const directory = process.env.RESEARCH_COLD_DIRECTORY;
        const control = workerPhase === 'control';
        const databasePath = path.join(directory, control ? 'control.db' : 'restart.db');
        const configPath = path.join(directory, control ? 'control-config.json' : 'restart-config.json');
        const checkpointPath = path.join(directory, 'checkpoint.json');
        const flow = buyEntryFixture({ instrument: 'EUR_USD', nowMs: START });
        const input = fixtureArchive([flow]);
        let point = null;
        function installPoint({ clock, market }) {
            const originalQuote = market.getQuote.bind(market);
            market.getQuote = (instrument) => {
                const quote = originalQuote(instrument);
                return instrument !== 'EUR_USD' || point === null ? quote : { ...quote,
                    time: new Date(clock.nowMs()).toISOString(), researchObservation: 'DECLARED_SYNTHETIC_POINT',
                    bids: [{ price: point.toFixed(5), liquidity: 1000000 }],
                    asks: [{ price: (point + 0.00004).toFixed(5), liquidity: 1000000 }] };
            };
        }
        let h;
        let join;
        let configBeforeBoot;
        if (workerPhase === 'tail') {
            join = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
            configBeforeBoot = hash(configPath);
            point = join.profitBid;
            h = await env.replay({ input, assets: ['EUR_USD'], startMs: join.atMs, databasePath, configPath,
                brokerCheckpoint: join.brokerCheckpoint, priorEvents: join.priorEvents,
                uuidStart: join.uuidSequence, beforeBoot: installPoint });
            expect(process.pid).not.toBe(join.processId);
            expect(h.clock.monoMs()).toBe(0);
            expect(hash(configPath)).toBe(configBeforeBoot);
            const inherited = (await h.repositories.trades.getAllTrades())[0];
            expect(inherited).toMatchObject({ id: join.trade.id, oandaTradeId: join.trade.oandaTradeId,
                entryPrice: join.trade.entryPrice, units: join.trade.units, isOpen: true,
                breakevenHit: true, activeStopType: 'BREAKEVEN', stopLossPrice: join.trade.entryPrice });
            expect(h.engine.openTrades.size).toBe(1);
            expect(h.broker.exportCheckpoint()).toEqual(join.brokerCheckpoint);
        } else {
            h = await env.replay({ input, assets: ['EUR_USD'], databasePath, configPath,
                brokerOptions: { commissionAud: 0.01, slippagePips: 0.2 }, beforeBoot: installPoint });
            await h.observeAt(START);
            const trade = (await h.repositories.trades.getAllTrades())[0];
            expect(trade).toMatchObject({ side: 'BUY', isOpen: true });
            point = trade.entryPrice + 1.1 * (trade.entryPrice - trade.stopLossPrice);
            await h.observeAt(START + 10000, { scan: false });
            const protectedTrade = (await h.repositories.trades.getAllTrades())[0];
            expect(protectedTrade).toMatchObject({ breakevenHit: true, stopLossPrice: trade.entryPrice });
            h.broker.applyFinancing({ id: 'before-cold-restart', tradeId: trade.oandaTradeId, amountAud: -0.02 });
            const midpoint = await h.snapshot();
            join = { atMs: h.clock.nowMs(), brokerCheckpoint: h.broker.exportCheckpoint(), priorEvents: midpoint.events,
                uuidSequence: env.uuidSequence, trade: protectedTrade, profitBid: point, processId: process.pid,
                configSha256: hash(configPath) };
            if (workerPhase === 'head') {
                fs.writeFileSync(checkpointPath, JSON.stringify(join, null, 2));
                await env.release(h);
                expect(fs.existsSync(configPath)).toBe(true);
                expect(fs.readFileSync(databasePath).subarray(0, 16).toString()).toBe('SQLite format 3\u0000');
                expect(env.networkAttempts).toBe(0);
                return;
            }
        }
        // Repeat the same financing delivery and scan after the boundary. The
        // modeled external broker dedupe and actual durable bot ownership must
        // prevent a second charge, order or local trade.
        expect(h.broker.applyFinancing({ id: 'before-cold-restart', tradeId: join.trade.oandaTradeId,
            amountAud: -0.02, atMs: join.atMs })).toBe(false);
        await h.observeAt(join.atMs);
        expect(await h.repositories.trades.getAllTrades()).toHaveLength(1);
        expect(h.broker.snapshot().transactions.filter((row) => row.type === 'MARKET_ORDER')).toHaveLength(1);
        point = join.trade.entryPrice - 0.0001;
        await h.observeAt(START + 20000, { scan: false });
        const snapshot = await h.snapshot();
        expect(snapshot.accounting).toMatchObject({ status: 'RECONCILED', financingAud: -0.02, commissionAud: 0.02 });
        expect(snapshot.tables.trades[0]).toMatchObject({ is_open: 0, active_stop_type: 'BREAKEVEN' });
        expect(snapshot.tables.broker_order_intents).toHaveLength(1);
        expect(snapshot.tables.broker_order_intents[0].status).toBe('COMPLETED');
        expect(h.engine.stats.errors).toBe(0);
        expect(env.networkAttempts).toBe(0);
        const output = { processId: process.pid, firstProcessId: join.processId, networkAttempts: env.networkAttempts,
            monotonicRestarted: workerPhase === 'tail', configSha256: hash(configPath),
            snapshot, brokerCheckpoint: h.broker.exportCheckpoint() };
        fs.writeFileSync(path.join(directory, control ? 'control-result.json' : 'cold-result.json'), JSON.stringify(output, null, 2));
        await env.release(h);
    });
} else {
    // Monotonic clocks belong to a process. Their intentional reset is excluded
    // from behavioral parity; wall/event times, ownership and money remain exact.
    function behavior(value) {
        if (Array.isArray(value)) return value.map(behavior);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
            .filter(([key]) => key !== 'monotonicMs').map(([key, item]) => [key, behavior(item)]));
        return value;
    }
    test('distinct bot processes recover file SQLite and preserved external broker state identically to an uninterrupted control', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forex-cold-restart-'));
        const childPids = [];
        try {
            for (const phase of ['head', 'tail', 'control']) {
                const env = { ...process.env, NODE_ENV: 'test', DB_PATH: path.join(directory, 'unused-default.db'),
                    RESEARCH_REPLAY_ISOLATED: '1', RESEARCH_COLD_WORKER_PHASE: phase, RESEARCH_COLD_DIRECTORY: directory };
                for (const key of Object.keys(env)) {
                    if (/^(OANDA_|EMAIL_|AWS_|S3_|SMTP_|DOTENV_CONFIG_)/.test(key) || key === 'NODE_OPTIONS') delete env[key];
                }
                const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../node_modules/jest/bin/jest.js'),
                    '--runInBand', '--runTestsByPath', __filename], { cwd: path.resolve(__dirname, '../..'), env,
                    encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
                if (result.error || result.status !== 0) throw new Error(`Cold worker ${phase} failed: ${result.error?.message || ''}\n${result.stdout}\n${result.stderr}`);
                childPids.push(result.pid);
            }
            const restarted = JSON.parse(fs.readFileSync(path.join(directory, 'cold-result.json'), 'utf8'));
            const uninterrupted = JSON.parse(fs.readFileSync(path.join(directory, 'control-result.json'), 'utf8'));
            expect(new Set(childPids).size).toBe(3);
            expect(restarted.processId).not.toBe(restarted.firstProcessId);
            expect(restarted.networkAttempts).toBe(0);
            expect(restarted.monotonicRestarted).toBe(true);
            expect(behavior(restarted.snapshot)).toEqual(behavior(uninterrupted.snapshot));
            expect(restarted.brokerCheckpoint).toEqual(uninterrupted.brokerCheckpoint);
            expect(restarted.configSha256).toBe(uninterrupted.configSha256);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    }, 60000);
}
