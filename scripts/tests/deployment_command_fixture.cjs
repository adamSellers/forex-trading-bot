'use strict';
const { assert, fs, path, run, read, json, write } = require('./test_helpers.cjs');
const name = path.basename(process.argv[1]); let args = process.argv.slice(2);
const root = process.env.TEST_ROOT; const statePath = path.join(root, 'state.json'); const state = json(statePath);
const save = () => write(statePath, JSON.stringify(state));
const log = (event) => fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(event) + '\n');
const fail = (point) => { if (process.env.FAIL_AT === point) process.exit(1); };
if (name === 'ssh') { log(['ssh', ...args, fs.readFileSync(0, 'utf8')]); }
else if (name === 'flock') { fs.fstatSync(9); log(['flock', ...args]); if (process.env.LOCK_BUSY === '1') process.exit(1); }
else if (name === 'sleep') { /* bounded fixtures skip idle waits */ }
else if (name === 'git') {
    if (args[0] === '-C') args = args.slice(2); log(['git', ...args]);
    if (args[0] === 'status') process.stdout.write(process.env.DIRTY === '1' ? ' M tracked-file\n' : '\n');
    else if (args[0] === 'rev-parse') process.stdout.write((args.at(-1) === 'HEAD' ? state.head : process.env.FOREX_DEPLOY_REVISION) + '\n');
    else if (args[0] === 'merge-base') fail('not-fast-forward');
    else if (args[0] === 'fetch') fail('fetch');
    else if (args[0] === 'archive') {
        const result = run('tar', ['-cf', '-', '-C', process.env.ARCHIVE_SOURCE, '.'], { encoding: null });
        if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status); }
        process.stdout.write(result.stdout);
    } else if (args[0] === 'merge') { fail('merge'); state.head = args.at(-1); save(); }
    else if (args[0] !== 'check-ref-format') throw new Error('Unexpected git command: ' + JSON.stringify(args));
} else if (name === 'npm') {
    const component = path.basename(process.cwd()); log(['npm', component, ...args]); fail(component + ':' + args.join(' '));
    if (args[0] === 'ci') write('node_modules/prepared.txt', 'new dependencies');
    if (JSON.stringify(args) === JSON.stringify(['run', 'build'])) write('dist/index.html', 'new dashboard');
    if (args[0] === 'test') {
        for (const key of ['OANDA_API_KEY','OANDA_ACCOUNT_ID','OANDA_ENVIRONMENT','FOREX_PROJECT_DIR','AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','EMAIL_PASS','SMTP_PASSWORD']) assert.equal(process.env[key], undefined, 'Test inherited credential: ' + key);
        assert.equal(process.env.NODE_ENV, 'test'); assert.equal(process.env.ENABLE_S3_ANALYTICS, 'false');
        assert.equal(process.env.DB_PATH, path.join(root, 'release/backend/data/deployment-test.db'));
    }
    if (JSON.stringify(args) === JSON.stringify(['run', 'db:migrate'])) {
        assert.equal(process.env.DB_PATH, path.join(root, 'production/backend/data/trading.db')); assert.equal(process.env.NODE_ENV, 'production');
    }
} else if (name === 'pm2') {
    log(['pm2', ...args]); fail('pm2:' + args[0]);
    if (args[0] === 'start') {
        assert.equal(process.env.FOREX_DEPLOY_LOCK_FD, undefined); assert.equal(process.env.FOREX_DEPLOY_LEGACY_ACCESS, undefined);
        // Node itself opens internal descriptors. Reject inheritance of the
        // actual maintenance lock inode, not an unrelated Node-owned fd9.
        let inherited = false;
        try {
            const descriptor = fs.fstatSync(9), expected = fs.statSync(path.join(root, 'backups/.backup.lock'));
            inherited = descriptor.dev === expected.dev && descriptor.ino === expected.ino;
        } catch {}
        assert.equal(inherited, false, 'PM2 inherited maintenance lock descriptor');
    }
    if (['start', 'restart'].includes(args[0])) { state.running = true; save(); }
    if (args[0] === 'stop') { state.running = false; save(); }
    if (args[0] === 'pid') process.stdout.write(state.running ? '4321\n' : '0\n');
} else if (name === 'fixture-command') {
    const action = args.shift();
    if (action === 'api') {
        const endpoint = args.at(-1).split('/api/').at(-1); log(['api', endpoint]);
        if (endpoint === 'health') {
            if (!state.running) process.exit(22); process.stdout.write(JSON.stringify({ config: { enableTrading: process.env.INVALID_STATE === '1' ? 'unknown' : state.enabled } }));
        } else if (endpoint === 'trading/stop') { state.enabled = false; save(); fail('pause-response'); }
        else if (endpoint === 'trading/start') {
            if (process.env.READINESS_BLOCKED === '1') process.exit(22);
            if (process.env.STUB_ACTUAL_ACTIVATION === '1') {
                const configPath = path.join(process.env.FOREX_PROJECT_DIR, 'backend/data/trading_config.json');
                write(configPath, JSON.stringify({ enableTrading: state.enabled }));
                const result = run(process.env.MAINTENANCE_TEST_NODE, [process.env.MAINTENANCE_TEST_API, 'start']);
                if (result.status) { process.stderr.write(result.stderr + result.stdout); process.exit(22); }
                const reply = JSON.parse(result.stdout); log(['actual-readiness', reply.liveReadiness.status, reply.liveReadiness.entryRisk.entryAllowed]);
                state.enabled = json(configPath).enableTrading; save();
            } else { state.enabled = true; save(); fail('resume-response'); }
        } else throw new Error('Unexpected API request: ' + endpoint);
    } else if (action === 'guard') {
        state.guards += 1; save(); log(['guard', state.guards]);
        if (state.enabled || !state.running || process.env.NOT_FLAT === '1' || (process.env.LATE_NOT_FLAT === '1' && state.guards > 1)) process.exit(1);
    } else if (action === 'backup') { log(['backup', process.env.FOREX_BACKUP_REQUIRE_RUN]); fail('backup'); }
    else if (action === 'health') { assert.equal(process.env.FOREX_DEPLOY_LEGACY_ACCESS, undefined); log(['health']); fail('health'); }
    else if (action === 'lock') log(['lock', ...args]);
    else if (action === 'bootstrap-runner') { log(['bootstrap-runner', process.env.FOREX_DEPLOY_REVISION, process.env.FOREX_DEPLOY_EXPECTED_HEAD, process.cwd()]); fail('bootstrap-runner'); }
    else throw new Error('Unexpected fixture command: ' + action);
} else throw new Error('Unexpected executable: ' + name);
