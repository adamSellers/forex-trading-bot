// Operational scripts use the same native SQLite dependency as the application.
const fs = require('node:fs');
const path = require('node:path');

function sqlite() {
    try { return require('better-sqlite3'); }
    catch {
        // A git-archive release has no staged dependencies at the preflight.
        // Read the installed project's SQLite with the selected app runtime
        // until npm ci has prepared the release's own dependency tree.
        const roots = [path.resolve(__dirname, '../backend')];
        if (process.env.FOREX_PROJECT_DIR) roots.push(path.resolve(process.env.FOREX_PROJECT_DIR, 'backend'));
        return require(require.resolve('better-sqlite3', { paths: roots }));
    }
}

function openReadOnly(filename, { immutable = false } = {}) {
    const Database = sqlite();
    // Deserializing only the snapshot bytes reproduces immutable=1: no journal
    // or WAL is consulted and no sidecar file can be created or modified.
    if (immutable) {
        const bytes = fs.readFileSync(filename);
        // SQLite deserialize cannot open a WAL-format image. A completed
        // standalone backup retains those journal-format header bytes, even
        // though its page image is complete. Normalize only the private memory
        // copy; the source snapshot, digest and on-disk sidecars stay untouched.
        if (bytes.length >= 100 && bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) && bytes[18] === 2 && bytes[19] === 2) {
            bytes[18] = 1; bytes[19] = 1;
        }
        return new Database(bytes, { readonly: true });
    }
    return new Database(path.resolve(filename), { readonly: true, fileMustExist: true });
}

const UNCERTAIN_INTENTS = "SELECT COUNT(*) AS count FROM broker_order_intents WHERE status IN ('PREPARED','SUBMITTING','AMBIGUOUS','RECOVERY_PENDING','FILLED_UNPERSISTED')";
const OPEN_QUARANTINES = "SELECT COUNT(*) AS count FROM broker_position_quarantines WHERE status='OPEN'";

function verifyDatabase(filename) {
    const connection = openReadOnly(filename, { immutable: true });
    try {
        const result = connection.prepare('PRAGMA quick_check').all();
        if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new Error('Snapshot failed SQLite quick_check');
        const tables = new Set(connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
        if (!['trades', 'strategy_runs', 'broker_order_intents', 'broker_position_quarantines'].every((table) => tables.has(table))) {
            throw new Error('Snapshot lacks the supported live lifecycle schema');
        }
        const checks = ["SELECT COUNT(*) AS count FROM trades WHERE mode='live' AND is_open=1", UNCERTAIN_INTENTS, OPEN_QUARANTINES];
        if (checks.some((query) => connection.prepare(query).get().count)) {
            throw new Error('Snapshot contains open or uncertain broker state; reconcile it before restoration');
        }
    } finally { connection.close(); }
}

module.exports = { openReadOnly, verifyDatabase, UNCERTAIN_INTENTS, OPEN_QUARANTINES };
