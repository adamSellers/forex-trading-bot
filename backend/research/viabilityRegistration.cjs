'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyReplaySources } = require('./replayManifest.cjs');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function verifyViabilityRegistration({ spec, specPath, root }) {
    if (!Number.isFinite(spec.homeConversionFeeRate) || spec.homeConversionFeeRate < 0 || spec.homeConversionFeeRate >= 1 ||
        !['pnl', 'position'].includes(spec.unrealizedConversionPurpose) || typeof spec.policyOptimization !== 'boolean') {
        throw new Error('Explicit settlement fee, unrealized conversion and optimization declarations required');
    }
    const directory = path.dirname(specPath);
    function read(stem) {
        const filename = spec[`${stem}Path`], expected = spec[`${stem}Sha256`];
        if (typeof filename !== 'string' || !/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error(`Explicit pinned ${stem} required`);
        const absolute = path.resolve(directory, filename), bytes = fs.readFileSync(absolute);
        if (sha(bytes) !== expected) throw new Error(`Registered ${stem} hash mismatch`);
        return { absolute, sha256: expected, data: JSON.parse(bytes) };
    }
    const protocol = read('protocol'), input = read('inputManifest'), launch = read('launchRegistration'), metadata = read('instrumentMetadata');
    const sourceHashes = verifyReplaySources(root, launch.data.sourceHashes);
    if (launch.data.protocolSha256 !== protocol.sha256 || launch.data.inputManifestSha256 !== input.sha256) throw new Error('Launch registration does not match protocol/input manifest');
    const assertInput = (absolute, hash) => {
        if (!input.data.files?.some((row) => path.resolve(root, row.path) === absolute && row.sha256 === hash)) throw new Error('Requested source is absent from registered input manifest');
    };
    assertInput(path.resolve(directory, spec.archivePath), spec.archiveSha256);
    assertInput(metadata.absolute, metadata.sha256);
    const cohort = launch.data.scoredCohorts?.find((row) => row.id === spec.cohortId);
    if (!cohort || cohort.fromUtc !== spec.fromUtc || cohort.toUtcExclusive !== spec.toUtcExclusive || cohort.warmupDays !== 40) throw new Error('Scored cohort differs from launch registration');
    const model = launch.data.models?.find((row) => row.id === spec.costCaseId);
    const spread = typeof model?.spreadsPips === 'object' ? model.spreadsPips : null;
    if (!model || !equal(spread, spec.spreadPips) || model.slippagePips !== spec.slippagePips ||
        !launch.data.paths?.includes(spec.pathOrder)) throw new Error('Cost/path case differs from launch registration');
    for (const field of ['homeConversionFeeRate', 'unrealizedConversionPurpose', 'policyOptimization', 'initialBalanceAud', 'commissionAud']) {
        if (!equal(launch.data[field], spec[field])) throw new Error(`Declared ${field} differs from launch registration`);
    }
    if (!equal(spec.assets, protocol.data.baselineIdentity?.assets)) throw new Error('Assets differ from registered strategy');
    const instrumentMetadata = Object.fromEntries((metadata.data.instruments ?? []).map((row) => [row.name, row]));
    if (spec.assets.some((asset) => !instrumentMetadata[asset])) throw new Error('Registered metadata does not cover requested assets');
    return { sourceHashes, instrumentMetadata, registration: {
        protocolSha256: protocol.sha256, inputManifestSha256: input.sha256,
        launchRegistrationSha256: launch.sha256, instrumentMetadataSha256: metadata.sha256,
    } };
}

module.exports = { verifyViabilityRegistration };
