#!/usr/bin/env node
// Read-only persisted pause/uncertainty guard, also usable by deployments.
const fs = require('node:fs');
const path = require('node:path');
const { openReadOnly, UNCERTAIN_INTENTS, OPEN_QUARANTINES } = require('./maintenance-db.cjs');

function requireRestoreSafety(project) {
    const config = JSON.parse(fs.readFileSync(path.join(project, 'backend/data/trading_config.json'), 'utf8'));
    if (config.enableTrading !== false) throw new Error('Pause and durably save new entries before maintenance');
    const database = openReadOnly(path.join(project, 'backend/data/trading.db'));
    try {
        if ([UNCERTAIN_INTENTS, OPEN_QUARANTINES].some((query) => database.prepare(query).get().count)) {
            throw new Error('Resolve durable broker uncertainty before maintenance');
        }
    } finally { database.close(); }
}

if (require.main === module) {
    try { requireRestoreSafety(process.argv[2]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { requireRestoreSafety };
