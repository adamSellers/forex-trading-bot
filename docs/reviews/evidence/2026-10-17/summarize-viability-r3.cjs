'use strict';
// Reduction of all completed registered cases. No parameter selection, app
// execution, financial-source modification, or partial-case verdict.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), recent = args.includes('--recent');
const cohort = recent ? 'recent' : 'full';
const outputAt = args.indexOf('--output');
const destination = outputAt >= 0 ? path.resolve(args[outputAt + 1]) : path.join(__dirname, `viability-${cohort}-summary-r3-complete.json`);
const specDirectory = path.join(__dirname, `viability-r3/specs/${cohort}`);
const resultDirectory = path.join(root, `backend/data/backtests/viability-20261017/r3/${cohort}`);
const { verifyViabilityRegistration } = require(path.join(root, 'backend/research/viabilityRegistration.cjs'));
const files = fs.readdirSync(specDirectory).filter((name) => name.endsWith('.json')).sort();
assert.equal(files.length, 8, 'All eight original registered cases are required');
// Refuse before loading any partial outcome for reduction.
for (const file of files) {
    const spec = JSON.parse(fs.readFileSync(path.join(specDirectory, file)));
    assert.ok(fs.existsSync(path.join(resultDirectory, `${spec.caseId}.json`)), `Case incomplete: ${spec.caseId}`);
}
const cases = [];
let sourceHashes = null;
for (const file of files) {
    const specPath = path.join(specDirectory, file), specBytes = fs.readFileSync(specPath), spec = JSON.parse(specBytes);
    const resultPath = path.join(resultDirectory, `${spec.caseId}.json`), bytes = fs.readFileSync(resultPath), result = JSON.parse(bytes);
    const registered = verifyViabilityRegistration({ spec, specPath, root });
    assert.deepEqual(result.sourceHashes, registered.sourceHashes); assert.deepEqual(result.spec, spec);
    assert.equal(result.specSha256, sha(specBytes)); assert.equal(result.archiveSha256, spec.archiveSha256);
    assert.equal(result.schemaVersion, 2); assert.equal(result.networkAttempts, 0); assert.equal(result.engineErrors, 0);
    assert.equal(result.summary.accounting.status, 'RECONCILED');
    assert.equal(result.summary.closedTrades + result.summary.openBoundaryTrades.length, result.persistedTrades.length);
    if (sourceHashes === null) sourceHashes = result.sourceHashes; else assert.deepEqual(result.sourceHashes, sourceHashes);
    let runtimeRepair = null;
    const runtimeSidecar = `${resultPath}.runtime-repair.json`;
    if (fs.existsSync(runtimeSidecar)) {
        const sidecarBytes = fs.readFileSync(runtimeSidecar), record = JSON.parse(sidecarBytes);
        assert.equal(record.exitCode, 0); assert.equal(record.outputSha256, sha(bytes));
        assert.equal(record.specSha256, sha(specBytes));
        runtimeRepair = { path: path.relative(root, runtimeSidecar), sha256: sha(sidecarBytes), record };
    }
    cases.push({ caseId: spec.caseId, cohortId: spec.cohortId, costCaseId: spec.costCaseId, pathOrder: spec.pathOrder,
        specPath: path.relative(root, specPath), specSha256: sha(specBytes),
        resultPath: path.relative(root, resultPath), resultSha256: sha(bytes), resultBytes: bytes.length,
        archiveSha256: result.archiveSha256, registration: result.registration, nodeVersion: result.nodeVersion,
        elapsedSeconds: result.elapsedSeconds, runtimeRepair,
        persistedEntryCount: result.persistedTrades.length, exportedEntryDecisions: result.entryDecisions.length,
        brokerLedgerRows: result.brokerLedger.length, equityObservations: result.equityDailyAndTradeObservations.length,
        networkAttempts: result.networkAttempts, engineErrors: result.engineErrors,
        summary: result.summary });
}
assert.equal(new Set(cases.map((row) => row.nodeVersion)).size, 1, 'Runtime version differs across cases');
assert.equal(new Set(cases.map((row) => row.registration.launchRegistrationSha256)).size, 1, 'Financial launch registration differs');
assert.equal(new Set(cases.map((row) => row.summary.finalRuntime.configHash)).size, 1, 'Numerical config differs across cases');
const output = { schemaVersion: 1, artifactKind: 'ALL_EIGHT_CORRECTED_R3_FROZEN_CASE_REDUCTION',
    evaluationUse: 'RETROSPECTIVE_CONDITIONAL_MODEL', cohort,
    toolSha256: sha(fs.readFileSync(__filename)), sourcePinSetSha256: sha(JSON.stringify(sourceHashes)),
    sourceCount: Object.keys(sourceHashes).length, sourceHashes, caseCount: cases.length,
    exportContractErratumPath: 'docs/reviews/evidence/2026-10-17/viability-output-contract-errata-r3.json',
    cases,
    interpretation: 'Complete eight-case reduction only. Cases are separately evolving conditional accounts, not independent strategy trials, exact historical executions, or an untouched holdout. No economic recommendation is selected by this tool.',
    limits: ['Gross/friction decomposition fixes the actual modeled entry/exit times and does not rerun an alternative costless strategy.',
        'Historical financing is unavailable. Inspect cutoff crossings and open boundary exposure before interpreting net returns.',
        'Export-based checks cover serialized trading/decision/episode evidence; complete hidden intent/quarantine tables are not exported. See erratum.',
        'A retained JSON alone does not prove a successful child exit; preserve launcher exit/test logs and any runtime-repair sidecar in the trial ledger.'],
};
fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: path.relative(root, destination), cohort, caseCount: cases.length,
    cases: cases.map((row) => ({ caseId: row.caseId, trades: row.summary.closedTrades, netAud: row.summary.netAud,
        netR: row.summary.totalNetR, grossBeforeFrictionAud: row.summary.grossBeforeEstimatedFrictionAud,
        executionFrictionAud: row.summary.executionFrictionAud, homeConversionCostAud: row.summary.homeConversionCostAud,
        sampledDrawdownFraction: row.summary.drawdown.sampledNavMaxFraction, entriesPer30Days: row.summary.frequency.entriesPer30CalendarDays })) }));
