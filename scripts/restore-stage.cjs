#!/usr/bin/env node
// Build and validate a restore candidate without touching the installation.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { verifyDatabase } = require('./maintenance-db.cjs');

const exists = (filename) => fs.existsSync(filename);
const isFile = (filename) => { try { return fs.statSync(filename).isFile(); } catch { return false; } };
const string = (buffer) => buffer.subarray(0, buffer.indexOf(0) < 0 ? buffer.length : buffer.indexOf(0)).toString('utf8');
function number(buffer) {
    let value;
    if (buffer[0] & 0x80) {
        value = BigInt(buffer[0] & 0x7f);
        for (const byte of buffer.subarray(1)) value = value * 256n + BigInt(byte);
    } else {
        const text = string(buffer).trim();
        if (text && !/^[0-7]+$/.test(text)) throw new Error('Invalid tar numeric header');
        value = BigInt(`0o${text || '0'}`);
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsupported tar member size');
    return Number(value);
}
function pax(data) {
    const values = {};
    for (let offset = 0; offset < data.length;) {
        const space = data.indexOf(32, offset);
        const length = Number(data.subarray(offset, space).toString('ascii'));
        if (space < 0 || !Number.isSafeInteger(length) || length <= space - offset + 1 || offset + length > data.length || data[offset + length - 1] !== 10) {
            throw new Error('Invalid tar extended header');
        }
        const record = data.subarray(space + 1, offset + length - 1).toString('utf8'), equals = record.indexOf('=');
        if (equals < 1) throw new Error('Invalid tar extended header');
        values[record.slice(0, equals)] = record.slice(equals + 1);
        offset += length;
    }
    return values;
}

// Two streaming passes preserve validation-before-extraction without holding a
// source archive in RAM. Extended path headers are interpreted before checking
// each final member; links/special files are never delegated to tar extraction.
async function readArchive(archiveHandle, visitor) {
    // The outer stage owns this descriptor across both passes. ReadStream's
    // explicit destroy closes its descriptor even with autoClose:false, so use
    // positional reads whose stream teardown cannot close the archive handle.
    const compressed = Readable.from((async function* () {
        for (let offset = 0;;) {
            const data = Buffer.allocUnsafe(64 * 1024);
            const { bytesRead } = await archiveHandle.read(data, 0, data.length, offset);
            if (!bytesRead) return;
            offset += bytesRead;
            yield data.subarray(0, bytesRead);
        }
    })());
    const stream = compressed.pipe(zlib.createGunzip());
    compressed.on('error', (error) => stream.destroy(error));
    const iterator = stream[Symbol.asyncIterator]();
    let chunk = Buffer.alloc(0), cursor = 0, globalPax = {}, nextPax = {}, longName = null;
    async function consume(size, write = null, allowEnd = false) {
        let remaining = size;
        const pieces = write === true ? [] : null;
        while (remaining) {
            if (cursor === chunk.length) {
                const next = await iterator.next();
                if (next.done) {
                    if (allowEnd && remaining === size) return null;
                    throw new Error('Truncated tar archive');
                }
                chunk = next.value; cursor = 0;
            }
            const length = Math.min(remaining, chunk.length - cursor), part = chunk.subarray(cursor, cursor + length);
            if (pieces) pieces.push(part);
            else if (write) write(part);
            cursor += length; remaining -= length;
        }
        return pieces ? Buffer.concat(pieces) : null;
    }
    try {
        while (true) {
            const header = await consume(512, true, true);
            if (!header || header.every((byte) => byte === 0)) break;
            const expected = number(header.subarray(148, 156));
            let checksum = 0, signedChecksum = 0;
            for (const [index, byte] of header.entries()) {
                checksum += index >= 148 && index < 156 ? 32 : byte;
                signedChecksum += index >= 148 && index < 156 ? 32 : byte >= 128 ? byte - 256 : byte;
            }
            if (expected !== checksum && expected !== signedChecksum) throw new Error('Invalid tar header checksum');
            const type = String.fromCharCode(header[156]), mode = number(header.subarray(100, 108));
            let size = number(header.subarray(124, 136));
            if (['x', 'g', 'L', 'K'].includes(type)) {
                const data = await consume(size, true);
                if (type === 'g') globalPax = { ...globalPax, ...pax(data) };
                else if (type === 'x') nextPax = { ...nextPax, ...pax(data) };
                else if (type === 'L') longName = string(data);
                await consume((512 - size % 512) % 512);
                continue;
            }
            const fields = { ...globalPax, ...nextPax };
            if (Object.keys(fields).some((key) => key.startsWith('GNU.sparse.'))) {
                throw new Error('Archive sparse file encodings are not supported');
            }
            const prefix = string(header.subarray(257, 263)) === 'ustar' ? string(header.subarray(345, 500)) : '';
            const name = fields.path ?? longName ?? `${prefix ? `${prefix}/` : ''}${string(header.subarray(0, 100))}`;
            if (fields.size !== undefined) {
                if (!/^[0-9]+$/.test(fields.size) || !Number.isSafeInteger(Number(fields.size))) throw new Error('Invalid tar extended size');
                size = Number(fields.size);
            }
            nextPax = {}; longName = null;
            const finish = await visitor({ name, type, mode, size }, consume);
            await consume((512 - size % 512) % 512);
            if (finish) await finish();
        }
    } finally { stream.destroy(); compressed.destroy(); }
}

function safeParts(member, rootName) {
    const parts = member.name.split('/').filter((part) => part !== '' && part !== '.');
    if (!parts.length || parts[0] !== rootName || parts.includes('..') || member.name.startsWith('/')) {
        throw new Error('Archive contains an unsafe or unexpected path');
    }
    if (!['5', '0', '\0', '7'].includes(member.type)) throw new Error('Archive links and special files are not supported');
    if (parts.some((part) => ['.keys', '.secrets', '.env'].includes(part))) {
        throw new Error('Credentials must come from the preserved installation, not the archive');
    }
    return parts;
}

function copyTree(source, target, filter = null) {
    // copytree follows its directory root while preserving descendant links.
    if (fs.lstatSync(source).isSymbolicLink() && fs.statSync(source).isDirectory()) source = fs.realpathSync(source);
    fs.cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true,
        preserveTimestamps: true, ...(filter ? { filter } : {}) });
}

async function stageRestore(project, backup, staging) {
    project = path.resolve(project); backup = path.resolve(backup); staging = path.resolve(staging);
    const rootName = path.basename(project), target = path.join(staging, rootName), name = path.basename(backup);
    let database;
    if (name.startsWith('forex_backup_') && name.endsWith('.tar.gz')) {
        database = path.join(path.dirname(backup), `trading_${name.slice('forex_backup_'.length, -'.tar.gz'.length)}.db`);
        if (!isFile(database)) throw new Error('Archive requires the SQLite snapshot with the exact matching timestamp');
        const archive = await fs.promises.open(backup, 'r');
        try {
            await readArchive(archive, async (member, consume) => { safeParts(member, rootName); await consume(member.size); });
            await readArchive(archive, async (member, consume) => {
                const destination = path.join(staging, ...safeParts(member, rootName));
                if (member.type === '5') { fs.mkdirSync(destination, { recursive: true }); await consume(member.size); }
                else {
                    fs.mkdirSync(path.dirname(destination), { recursive: true });
                    const descriptor = fs.openSync(destination, 'w');
                    try {
                        await consume(member.size, (part) => {
                            for (let offset = 0; offset < part.length;) offset += fs.writeSync(descriptor, part, offset);
                        });
                    }
                    finally { fs.closeSync(descriptor); }
                    fs.chmodSync(destination, member.mode & 0o777);
                }
            });
        } finally { await archive.close(); }
    } else if (path.extname(backup) === '.db') {
        database = backup;
        const excluded = new Set(['node_modules', 'dist', 'logs', '.git', '.keys', '.secrets', '.env']);
        copyTree(project, target, (source) => source === project || !excluded.has(path.basename(source)) && !path.basename(source).startsWith('trading.db'));
    } else throw new Error('Choose a forex_backup_TIMESTAMP.tar.gz archive or standalone .db snapshot');

    if (!isFile(database) || exists(`${database}-wal`)) throw new Error('A complete standalone SQLite snapshot is required');
    verifyDatabase(database);
    for (const required of ['backend/package.json', 'backend/server.js', 'ecosystem.config.js', 'scripts/start-wrapper.sh', 'scripts/load-maintenance-api.sh']) {
        if (!isFile(path.join(target, required))) throw new Error(`Restore candidate is missing ${required}; use database-only restore for older source archives`);
    }
    const dataDirectory = path.join(target, 'backend/data');
    fs.mkdirSync(dataDirectory, { recursive: true });
    for (const previous of fs.readdirSync(dataDirectory).filter((entry) => entry.startsWith('trading.db'))) fs.unlinkSync(path.join(dataDirectory, previous));
    fs.copyFileSync(database, path.join(dataDirectory, 'trading.db'));
    fs.chmodSync(path.join(dataDirectory, 'trading.db'), fs.statSync(database).mode & 0o777);
    fs.utimesSync(path.join(dataDirectory, 'trading.db'), fs.statSync(database).atime, fs.statSync(database).mtime);

    for (const relative of ['.keys', '.secrets', '.env', 'backend/.env', 'ssl', '.git']) {
        const original = path.join(project, relative), destination = path.join(target, relative);
        if (!exists(original)) continue;
        fs.rmSync(destination, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.statSync(original).isDirectory()) copyTree(original, destination);
        else {
            fs.copyFileSync(original, destination);
            fs.chmodSync(destination, fs.statSync(original).mode & 0o777);
            fs.utimesSync(destination, fs.statSync(original).atime, fs.statSync(original).mtime);
        }
    }
    const configPath = path.join(dataDirectory, 'trading_config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.enableTrading = false; config.enforceConfigFreeze = true;
    const temporary = path.join(dataDirectory, 'trading_config.restore.tmp');
    const descriptor = fs.openSync(temporary, 'w', 0o600);
    try { fs.fchmodSync(descriptor, 0o600); fs.writeFileSync(descriptor, JSON.stringify(config, null, 4)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, configPath);
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(database)) digest.update(chunk);
    fs.writeFileSync(path.join(target, 'RESTORE_MANIFEST.json'), JSON.stringify({ source: fs.realpathSync(backup),
        snapshot: fs.realpathSync(database), snapshotSha256: digest.digest('hex'), enableTrading: false }, null, 2));
    return target;
}

if (require.main === module) {
    (async () => {
        try {
            if (process.argv[2] === '--verify-db') verifyDatabase(process.argv[3]);
            else console.log(await stageRestore(...process.argv.slice(2, 5)));
        } catch (error) { console.error(`Restore validation failed: ${error.message}`); process.exitCode = 1; }
    })();
}
module.exports = { stageRestore, verifyDatabase };
