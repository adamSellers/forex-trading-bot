#!/usr/bin/env node
// Small stdin/stat adapters shared by existing maintenance shell contracts.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const input = () => JSON.parse(fs.readFileSync(0, 'utf8'));
const output = (value) => console.log(value);
const requireCondition = (condition, message = null) => { if (!condition) throw new Error(message || ''); };
const truth = (value) => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object'
    ? Object.keys(value).length > 0 : !!value;

function databaseHealth(filename) {
    const budget = Number(process.env.FOREX_HEALTH_DB_TIMEOUT_SECONDS ?? '60');
    if (!Number.isFinite(budget) || budget <= 0 || budget > 60) {
        output('Database: check timeout must be greater than zero and at most 60 seconds'); return 1;
    }
    const cutoff = Date.now() - 10 * 60 * 1000;
    const sql = 'PRAGMA quick_check; SELECT COUNT(*) FROM broker_order_intents WHERE status IN ' +
        "('PREPARED','SUBMITTING','AMBIGUOUS','RECOVERY_PENDING','FILLED_UNPERSISTED') " +
        `AND created_at_ms < ${cutoff}; SELECT COUNT(*) FROM broker_position_quarantines WHERE status='OPEN';`;
    const result = spawnSync('sqlite3', ['-readonly', '-batch', '-noheader', filename, sql],
        { encoding: 'utf8', timeout: budget * 1000 });
    if (result.error) {
        output(result.error.code === 'ETIMEDOUT' ? `Database: verification timed out after ${budget} seconds` : 'Database: integrity could not be verified');
        return 1;
    }
    const text = result.stdout || '';
    const lines = text ? text.split(/\r\n|\n|\r/) : [];
    if (lines.at(-1) === '') lines.pop();
    if (lines[0] !== 'ok') { output('Database: integrity could not be verified'); return 1; }
    output('Database: integrity verified');
    if (result.status !== 0 || lines.length !== 3 || !lines.slice(1).every((line) => /^[0-9]+$/.test(line))) {
        output('Broker lifecycle: database state could not be verified'); return 1;
    }
    const [pending, quarantined] = lines.slice(1).map(Number);
    if (pending || quarantined) {
        output(`Broker lifecycle: ${pending} unresolved stale intent(s), ${quarantined} quarantined position(s)`); return 1;
    }
    output('Broker lifecycle: resolved'); return 0;
}

function operationalHealth(data) {
    const health = data.operationalHealth || {}, errors = [], now = Date.now();
    if (data.services?.oanda?.connected !== true) errors.push('Broker connectivity is not verified');
    if (typeof health.checkedAt !== 'number' || !Number.isFinite(health.checkedAt) || health.checkedAt > now + 10000 || now - health.checkedAt > 180000) {
        errors.push('Operational snapshot is missing or stale');
    }
    if (health.status !== 'healthy') errors.push('Operational state is not healthy');
    for (const issue of health.issues || []) errors.push(String(issue.message || issue.code || 'Unknown operational issue'));
    const live = data.liveSelection || {}, run = live.liveRun || {};
    if (!run.runId || !['intraday_momentum', 'multi_day_trend'].includes(live.strategy) || run.mode !== 'live' || run.status !== 'active') {
        errors.push('Canonical live runtime selection is not verified');
    }
    if (data.config?.enableTrading === true && data.liveReadiness?.passed !== true && data.liveReadiness?.status !== 'COOLDOWN') {
        errors.push('Live readiness failed while entries are enabled');
    }
    if (errors.length) { output([...new Set(errors)].join('\n')); return 1; }
    output('Operational health: healthy');
    output(`Entry state: ${health.entryState || 'unknown'}`);
    output('Broker: connected and recently reconciled'); return 0;
}

function main(command, args) {
    switch (command) {
    case 'pretty-json': output(JSON.stringify(input(), null, 4)); break;
    case 'pm2-online': requireCondition(input().some((process) => process.name === 'forex-backend' && process.pm2_env?.status === 'online')); break;
    case 'operational-health': return operationalHealth(input());
    case 'database-health': return databaseHealth(args[0]);
    case 'queue-idle': {
        const queue = input();
        requireCondition(queue && !Array.isArray(queue) && typeof queue === 'object' && queue.isProcessingQueue === false &&
            typeof queue.queueLength === 'number' && Number.isInteger(queue.queueLength) && queue.queueLength === 0); break;
    }
    case 'entries-paused': requireCondition(input().config?.enableTrading === false); break;
    case 'broker-flat': {
        const account = input().account || {};
        requireCondition(String(account.openTradeCount) === '0' && String(account.pendingOrderCount) === '0'); break;
    }
    case 'trading-enabled': {
        const value = input().config?.enableTrading;
        requireCondition(typeof value === 'boolean', 'Trading state is unavailable'); output(String(value)); break;
    }
    case 'backup-trading-enabled': output(String(truth(input().config?.enableTrading))); break;
    case 'account-open-trades': {
        const account = input();
        const value = Object.prototype.hasOwnProperty.call(account, 'openTrades') ? account.openTrades : -1;
        if (typeof value === 'string') requireCondition(/^[+-]?[0-9]+$/.test(value.trim()));
        else requireCondition(typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean');
        output(Math.trunc(Number(value))); break;
    }
    case 'same-filesystem': requireCondition(fs.statSync(args[0], { bigint: true }).dev === fs.statSync(args[1], { bigint: true }).dev, args[2]); break;
    case 'inherited-lock': {
        const expected = fs.statSync(args[0], { bigint: true }), inherited = fs.fstatSync(9, { bigint: true });
        requireCondition(expected.isFile() && inherited.isFile() && expected.dev === inherited.dev && expected.ino === inherited.ino); break;
    }
    case 'pm2-resources': {
        const app = input().find((row) => row.name === args[0]);
        if (app) output(`  Resource Usage:  CPU: ${app.monit?.cpu ?? 0}% | Memory: ${Math.floor((app.monit?.memory ?? 0) / 1024 / 1024)}MB`);
        break;
    }
    case 'runtime-status': {
        const data = input(), live = data.liveSelection || {}, run = live.liveRun || {};
        const short = (value) => value ? String(value).slice(0, 12) : 'n/a';
        output(`  Strategy:       ${live.strategy || 'n/a'}`);
        output(`  Selection ID:   ${short(live.selectionId)}`);
        output(`  Live Run:       ${short(run.runId)} (${run.status || 'unknown'})`);
        output(`  Managing Only:  ${(data.runs || []).filter((row) => row.mode === 'live' && row.status === 'managing_only').length} live run(s)`); break;
    }
    default: throw new Error('Unknown maintenance helper command');
    }
    return 0;
}

if (require.main === module) {
    try { process.exitCode = main(process.argv[2], process.argv.slice(3)); }
    catch (error) { if (error.message) console.error(error.message); process.exitCode = 1; }
}
module.exports = { main, databaseHealth, operationalHealth };
