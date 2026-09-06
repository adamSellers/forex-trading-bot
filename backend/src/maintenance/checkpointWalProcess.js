// Dedicated, short-lived SQLite process. Do not import application startup or
// its shared Knex connection: the parent owns all trading and broker activity.
const Database = require("better-sqlite3");

let database;
try {
    const filename = process.argv[2];
    const busyTimeoutMs = Number(process.argv[3]);
    if (!filename || filename === ":memory:" || !Number.isInteger(busyTimeoutMs) ||
        busyTimeoutMs < 0 || busyTimeoutMs > 1000) {
        throw new Error("Invalid checkpoint arguments");
    }
    database = new Database(filename, { fileMustExist: true, timeout: busyTimeoutMs });
    if (database.pragma("journal_mode", { simple: true }) !== "wal") {
        throw new Error("Checkpoint requires a WAL database");
    }
    const result = database.pragma("wal_checkpoint(TRUNCATE)")[0];
    process.stdout.write(JSON.stringify(result));
} catch (error) {
    process.stderr.write(error.message);
    process.exitCode = 1;
} finally {
    if (database) database.close();
}
