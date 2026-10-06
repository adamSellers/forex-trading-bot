'use strict';
// Disposable operations fixtures. No production files or external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const SCRIPTS = path.resolve(__dirname, '..');
const NODE_MODULES = path.resolve(SCRIPTS, '../backend/node_modules');
function cleanEnv(extra = {}) {
    return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FOREX_|OANDA_|AWS_|EMAIL_|SMTP_)/.test(key))),
        NODE_PATH: NODE_MODULES, ...extra,
        PATH: extra.PATH ?? path.dirname(process.execPath) + ':' + process.env.PATH };
}
function write(file, source, mode) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source, mode ? { mode } : undefined); }
function executable(file, source) { write(file, source, 0o700); fs.chmodSync(file, 0o700); }
function shell(file, source) { executable(file, '#!/bin/bash\nset -e\n' + source + '\n'); }
function nodeStub(file, source) { executable(file, '#!' + process.execPath + '\n' + source + '\n'); }
function run(command, args = [], options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, ...options });
    if (result.error) throw result.error;
    return result;
}
function ok(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function json(file) { return JSON.parse(read(file)); }
function lines(file) { return fs.existsSync(file) ? read(file).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []; }
function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function database(file, sql) {
    const Database = require(require.resolve('better-sqlite3', { paths: [NODE_MODULES] }));
    const db = new Database(file); try { db.exec(sql); } finally { db.close(); }
}
function tarMember({ name, type = '0', data = Buffer.alloc(0), linkname = '', prefix = '', magic = 'ustar\0' }) {
    data = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const header = Buffer.alloc(512); const field = (at, size, value) => header.write(value, at, Math.min(size, Buffer.byteLength(value)), 'ascii');
    field(0, 100, name); field(100, 8, '0000644\0'); field(108, 8, '0000000\0'); field(116, 8, '0000000\0');
    field(124, 12, data.length.toString(8).padStart(11, '0') + '\0'); field(136, 12, '00000000000\0');
    header.fill(32, 148, 156); field(156, 1, type); field(157, 100, linkname);
    field(257, 6, magic); field(263, 2, '00'); field(345, 155, prefix);
    const checksum = [...header].reduce((sum, value) => sum + value, 0);
    field(148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
    return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
function archiveMembers(file, members) { fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([...members.map(tarMember), Buffer.alloc(1024)]))); }
function paxRecord(key, value) {
    const body = `${key}=${value}\n`; let length = Buffer.byteLength(body) + 2;
    while (length !== Buffer.byteLength(`${length} ${body}`)) length = Buffer.byteLength(`${length} ${body}`);
    return `${length} ${body}`;
}
function unsafeArchive(file, name, link = false) {
    archiveMembers(file, [{ name, type: link ? '2' : '0', linkname: link ? '/etc' : '', data: link ? '' : 'x' }]);
}
function flockExecutable(directory) {
    const found = run('bash', ['-c', 'command -v flock'], { env: cleanEnv() });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
    // Node core has no flock syscall. On development macOS only, compile a
    // disposable syscall bridge so inherited-descriptor/contention assertions
    // exercise real kernel locks rather than replacing them with a fake marker.
    const source = path.join(directory, 'flock-fixture.c'); const target = path.join(directory, 'flock-fixture');
    write(source, '#include <sys/file.h>\n#include <stdlib.h>\nint main(int argc,char **argv){if(argc<2)return 2;return flock(atoi(argv[argc-1]),LOCK_EX|LOCK_NB)==0?0:1;}\n');
    ok(run('cc', [source, '-o', target])); return target;
}
module.exports = { assert, fs, path, SCRIPTS, NODE_MODULES, cleanEnv, write, executable, shell, nodeStub,
    run, ok, read, json, lines, temporary, database, unsafeArchive, tarMember, archiveMembers, paxRecord, flockExecutable };
if (require.main === module) {
    const [action, file] = process.argv.slice(2);
    if (action === 'init-lifecycle-db') database(file, 'CREATE TABLE broker_order_intents(status TEXT); CREATE TABLE broker_position_quarantines(status TEXT);');
    else if (action === 'ambiguous-intent') database(file, "INSERT INTO broker_order_intents VALUES('AMBIGUOUS')");
    else if (action === 'flock-executable') process.stdout.write(flockExecutable(file) + '\n');
    else throw new Error('Unknown disposable fixture action');
}
