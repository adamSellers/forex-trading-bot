// Pin the transitive local code/configuration used by the isolated replay.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function replaySourcePaths(root) {
    const files = new Set(['.nvmrc', 'backend/package.json', 'backend/package-lock.json',
        'backend/jest.config.js', 'backend/__tests__/setup.js', 'shared/tradingConfigDefaults.json',
        'backend/src/strategies/__tests__/fixtures/intradaySellRetestFixture.js']);
    function walk(directory, skipTests) {
        for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
            const relative = `${directory}/${entry.name}`;
            if (entry.isDirectory()) {
                if (!skipTests || entry.name !== '__tests__') walk(relative, skipTests);
            } else if (entry.isFile() && /\.(?:js|cjs|json)$/.test(entry.name)) files.add(relative);
        }
    }
    walk('backend/src', true);
    walk('backend/config', false);
    walk('backend/migrations', false);
    walk('backend/research', false);
    // Manifests pin source; they cannot include their own hash recursively.
    return [...files].filter((file) => !file.startsWith('backend/research/manifests/')).sort();
}

function hashReplaySources(root) {
    return Object.fromEntries(replaySourcePaths(root).map((file) => [file,
        crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}

function verifyReplaySources(root, expected) {
    const actual = hashReplaySources(root);
    if (!expected || JSON.stringify(Object.keys(expected).sort()) !== JSON.stringify(Object.keys(actual))) {
        throw new Error('Replay manifest must pin the complete source/configuration/migration set');
    }
    for (const [file, hash] of Object.entries(actual)) {
        if (expected[file] !== hash) throw new Error(`Replay source differs from manifest: ${file}`);
    }
    return actual;
}

module.exports = { replaySourcePaths, hashReplaySources, verifyReplaySources };
