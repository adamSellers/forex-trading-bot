'use strict';
// Independent Node-only reducer. Never imports the app, broker or evaluator.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sum = (values) => values.reduce((a, b) => a + b, 0);
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const near = (a, b, label, tolerance = 1e-8) => assert.ok(finite(a) && finite(b) && Math.abs(Number(a) - Number(b)) <= tolerance, `${label}: ${a} differs from ${b}`);
const readJson = (file) => JSON.parse(fs.readFileSync(file));
const percentile = (values, q) => values[Math.floor((values.length - 1) * q)];
const archiveCache = new Map();
function archiveFor(spec, specDirectory) {
    const file = path.resolve(specDirectory, spec.archivePath);
    if (!archiveCache.has(file)) {
        const bytes = fs.readFileSync(file);
        archiveCache.set(file, { file, sha256: sha(bytes), data: JSON.parse(bytes) });
    }
    const archive = archiveCache.get(file);
    assert.equal(archive.sha256, spec.archiveSha256, 'Archive hash');
    return archive;
}
function sourceHashCheck(hashes) {
    const differences = Object.entries(hashes).filter(([file, expected]) => sha(fs.readFileSync(path.join(root, file))) !== expected).map(([file]) => file);
    assert.deepEqual(differences, [], 'Source files changed from evaluated revision');
}
function componentValue(bar, component, field) {
    const value = bar[component] ?? (component === 'mid' ? bar : null);
    assert.ok(value, `Missing ${component} price`);
    return Number(value[field] ?? value[{ o: 'open', h: 'high', l: 'low', c: 'close' }[field]]);
}
function modeledQuote(archive, spec, instrument, time) {
    const bars = archive.candlesByInstrument[instrument];
    let low = 0, high = bars.length - 1, index = -1;
    while (low <= high) { const middle = (low + high) >>> 1;
        if (bars[middle].time * 1000 <= time) { index = middle; low = middle + 1; } else high = middle - 1; }
    assert.ok(index >= 0, `Quote precedes archive ${instrument}`);
    const bar = bars[index], fraction = Math.min(1, (time - bar.time * 1000) / 900_000);
    const vertices = spec.pathOrder === 'OHLC' ? ['o', 'h', 'l', 'c'] : ['o', 'l', 'h', 'c'];
    const position = fraction * 3, leg = Math.min(2, Math.floor(position));
    const point = (component) => { const a = componentValue(bar, component, vertices[leg]), b = componentValue(bar, component, vertices[leg + 1]); return a + (b - a) * (position - leg); };
    let bid, ask;
    if (spec.spreadPips !== null) {
        const spread = typeof spec.spreadPips === 'number' ? spec.spreadPips : spec.spreadPips[instrument];
        const half = spread * (instrument.endsWith('JPY') ? 0.01 : 0.0001) / 2, mid = point('mid');
        bid = mid - half; ask = mid + half;
    } else { bid = point('bid'); ask = point('ask'); }
    return { bid, ask, mid: (bid + ask) / 2 };
}
function conversion(archive, spec, currency, time, amount) {
    if (currency === 'AUD') return 1;
    const aud = modeledQuote(archive, spec, 'AUD_USD', time);
    const positive = amount >= 0;
    if (currency === 'USD') return 1 / (positive ? aud.ask : aud.bid);
    if (currency === 'JPY') { const jpy = modeledQuote(archive, spec, 'USD_JPY', time); return 1 / ((positive ? aud.ask : aud.bid) * (positive ? jpy.ask : jpy.bid)); }
    throw Error(`Unspecified independent conversion path for ${currency}`);
}
function episodeIdentity(trade, payload) {
    const context = payload?.liveRuntime?.entryTelemetry?.strategyContext;
    if (trade.side === 'BUY') {
        const id = context?.buyRetest?.episodeId;
        return typeof id === 'string' && id ? `BUY:${trade.instrument}:${id}` : null;
    }
    const breakout = context?.sellRetest?.breakout;
    return finite(breakout?.closedAt) && Number(breakout.closedAt) > 0 && finite(breakout.level) && Number(breakout.level) > 0
        ? `SELL:${trade.instrument}:${Number(breakout.closedAt)}:${Number(breakout.level)}` : null;
}
function clusterDiagnostic(rows, field, seed = 20261017, repetitions = 5000) {
    const groups = new Map(), missing = [];
    for (const row of rows) {
        if (!row[field] || !finite(row.netR)) { missing.push(row.brokerTradeId); continue; }
        if (!groups.has(row[field])) groups.set(row[field], []);
        groups.get(row[field]).push(row);
    }
    const clusters = [...groups].map(([id, trades]) => ({ id, trades: trades.length,
        netR: sum(trades.map((row) => row.netR)), netAud: sum(trades.map((row) => row.netAud)),
        initialRiskAud: sum(trades.map((row) => row.initialRiskAud)) }));
    const tradeCount = sum(clusters.map((row) => row.trades)), risk = sum(clusters.map((row) => row.initialRiskAud));
    const distinct = new Set(clusters.map((row) => (row.netR / row.trades).toPrecision(14))).size;
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const means = [];
    if (clusters.length > 1 && distinct > 1) for (let sample = 0; sample < repetitions; sample++) {
        let n = 0, r = 0;
        for (let index = 0; index < clusters.length; index++) { const row = clusters[Math.floor(random() * clusters.length)]; n += row.trades; r += row.netR; }
        means.push(r / n);
    }
    means.sort((a, b) => a - b);
    return { clusterField: field, observedClusters: clusters.length, coveredClosedTrades: tradeCount,
        missingMetadataOrRiskTradeIds: missing,
        kishTradeSizeEffectiveClusters: clusters.length ? tradeCount ** 2 / sum(clusters.map((row) => row.trades ** 2)) : null,
        kishRiskSizeEffectiveClusters: risk > 0 ? risk ** 2 / sum(clusters.map((row) => row.initialRiskAud ** 2)) : null,
        conditionalMeanNetRPerTrade: tradeCount ? sum(clusters.map((row) => row.netR)) / tradeCount : null,
        seededClusterResampling: { seed, replications: means.length,
            percentile95MeanNetRPerTrade: means.length ? [percentile(means, 0.025), percentile(means, 0.975)] : null,
            status: !clusters.length ? 'NO_COVERED_CLUSTERS' : clusters.length < 2 ? 'SINGLETON_CLUSTER_UNAVAILABLE' : distinct < 2 ? 'DEGENERATE_EMPIRICAL_R_UNAVAILABLE' : 'CONDITIONAL_EMPIRICAL_SENSITIVITY' },
        clusters,
        limitations: 'Whole clusters are resampled uniformly with replacement; the mean uses the resampled trade count. Kish counts quantify size concentration only. Days and episodes are not established independent or exchangeable; interday dependence, historical rule selection, unobserved paths and unknown costs remain outside this conditional diagnostic.' };
}
function aggregate(rows, field) {
    const groups = {};
    for (const row of rows) {
        const key = String(row[field]);
        const out = groups[key] ||= { trades: 0, wins: 0, losses: 0, flat: 0, netAud: 0,
            grossBeforeEstimatedFrictionAud: 0, estimatedFrictionAud: 0, initialRiskAud: 0, riskCoveredTrades: 0, coveredNetR: 0 };
        out.trades++; out.wins += row.netAud > 0; out.losses += row.netAud < 0; out.flat += row.netAud === 0;
        out.netAud += row.netAud; out.grossBeforeEstimatedFrictionAud += row.grossBeforeEstimatedFrictionAud;
        out.estimatedFrictionAud += row.estimatedFrictionAud;
        if (finite(row.netR)) { out.riskCoveredTrades++; out.coveredNetR += row.netR; out.initialRiskAud += row.initialRiskAud; }
    }
    for (const out of Object.values(groups)) out.netR = out.riskCoveredTrades === out.trades ? out.coveredNetR : null;
    return groups;
}
function auditOne({ resultPath, specPath = null, verifySources = true }) {
    const resultBytes = fs.readFileSync(resultPath), result = JSON.parse(resultBytes), spec = result.spec;
    if (specPath) {
        assert.equal(sha(fs.readFileSync(specPath)), result.specSha256, 'Frozen spec hash');
        assert.deepEqual(readJson(specPath), spec, 'Spec contents');
    }
    const declaredEvidence = [
        [spec.protocolSha256, spec.protocolPath || path.join(__dirname, 'viability-protocol-r2.json')],
        [spec.inputManifestSha256, path.join(__dirname, 'viability-inputs.json')],
        [spec.launchSha256 || spec.launchRegistrationSha256, spec.launchRegistrationPath || path.join(__dirname, 'viability-launch.json')],
    ].filter(([expected]) => expected);
    for (const [expected, file] of declaredEvidence) assert.equal(sha(fs.readFileSync(file)), expected, `Declared evidence ${file}`);
    if (verifySources) sourceHashCheck(result.sourceHashes);
    assert.equal(result.nodeVersion.split('.')[0], '22');
    assert.equal(result.baselineIdentity.releaseVersion, 'm15-intraday-v6');
    assert.equal(result.baselineIdentity.strategyVersion, '1.4.0');
    const archived = archiveFor(spec, specPath ? path.dirname(specPath) : path.dirname(resultPath));
    assert.equal(result.archiveSha256, archived.sha256);
    const from = Date.parse(spec.fromUtc), to = Date.parse(spec.toUtcExclusive);
    assert.ok(Number.isFinite(from) && Number.isFinite(to) && from < to);
    assert.equal(Date.parse(result.summary.interval.fromUtc), from);
    assert.equal(Date.parse(result.summary.interval.toUtcExclusive), to);
    const ledger = result.brokerLedger, trades = result.persistedTrades;
    const opened = new Map(), closed = new Map(), finance = new Map();
    let cash = spec.initialBalanceAud;
    for (const event of ledger) {
        assert.ok(event.atMs >= from && event.atMs < to, 'Ledger event out of scoring interval');
        if (event.type === 'TRADE_OPENED') { assert.ok(!opened.has(String(event.tradeId)), 'Duplicate broker open'); opened.set(String(event.tradeId), event); cash -= event.commissionAud; }
        if (event.type === 'TRADE_CLOSED') { assert.ok(!closed.has(String(event.tradeId)), 'Duplicate broker close'); closed.set(String(event.tradeId), event); cash += event.grossRealizedAud - event.commissionAud; }
        if (event.type === 'FINANCING_APPLIED') { cash += event.amountAud; finance.set(String(event.tradeId), (finance.get(String(event.tradeId)) || 0) + event.amountAud); }
        near(cash, event.balanceAud, `Cash after event ${event.sequence}`);
    }
    near(cash, result.summary.finalBalanceAud, 'Final cash from independent event deltas');
    const localIds = trades.map((row) => String(row.oanda_trade_id));
    assert.equal(new Set(localIds).size, localIds.length, 'Unique local broker ownership');
    assert.equal(opened.size, trades.length, 'Every broker opening has a local owner');
    const summaries = new Map(result.summary.tradeLedger.map((row) => [String(row.brokerTradeId), row]));
    const rows = [], missingRisk = [], missingEpisode = [];
    for (const trade of trades) {
        const id = String(trade.oanda_trade_id), open = opened.get(id), close = closed.get(id);
        assert.ok(open, `No opening for local trade ${id}`);
        near(trade.entry_price, open.fillPrice, `${id} entry price`); near(trade.entry_time, open.atMs, `${id} entry time`);
        const signedUnits = trade.side === 'BUY' ? Math.abs(trade.units) : -Math.abs(trade.units);
        near(signedUnits, open.units, `${id} signed units`);
        if (trade.is_open) { assert.ok(!close, 'Open local trade has broker close'); continue; }
        assert.ok(close, `No broker close ${id}`);
        near(trade.exit_price, close.fillPrice, `${id} exit price`); near(trade.exit_time, close.atMs, `${id} exit time`);
        const financing = finance.get(id) || 0, commission = open.commissionAud + close.commissionAud;
        near(financing, close.lifetimeFinancingAud, `${id} lifetime financing`);
        near(commission, close.lifetimeCommissionAud, `${id} lifetime commission`);
        const counter = trade.instrument.split('_')[1];
        const quotePL = (trade.exit_price - trade.entry_price) * signedUnits;
        const independentlyConvertedGross = quotePL * conversion(archived.data, spec, counter, close.atMs, quotePL);
        near(independentlyConvertedGross, close.grossRealizedAud, `${id} independent executable-price gross`);
        const net = independentlyConvertedGross + financing - commission;
        near(net, trade.pnl_aud, `${id} persisted net cash`);
        const payload = typeof trade.broker_reconciliation_payload === 'string' ? JSON.parse(trade.broker_reconciliation_payload) : trade.broker_reconciliation_payload;
        const runtime = payload?.liveRuntime;
        const initialRisk = finite(runtime?.initialStopLossPrice) && finite(runtime?.quoteToAudRate)
            ? Math.abs(trade.entry_price - runtime.initialStopLossPrice) * Math.abs(trade.units) * runtime.quoteToAudRate : null;
        const netR = initialRisk > 0 ? net / initialRisk : null;
        if (netR === null) missingRisk.push(id);
        else { near(initialRisk, runtime.initialRiskAud, `${id} immutable initial risk`);
            near(runtime.quoteToAudRate, conversion(archived.data, spec, counter, open.atMs, -1), `${id} independent entry loss conversion`); }
        const episodeId = episodeIdentity(trade, payload); if (!episodeId) missingEpisode.push(id);
        const entryMid = modeledQuote(archived.data, spec, trade.instrument, open.atMs).mid;
        const exitMid = modeledQuote(archived.data, spec, trade.instrument, close.atMs).mid;
        const midpointPL = (exitMid - entryMid) * signedUnits;
        const grossBeforeEstimatedFrictionAud = midpointPL * conversion(archived.data, spec, counter, close.atMs, midpointPL);
        const estimatedFrictionAud = grossBeforeEstimatedFrictionAud - independentlyConvertedGross + commission;
        const summary = summaries.get(id); assert.ok(summary, `Missing summary trade ${id}`);
        near(net, summary.netAud, `${id} summary cash`);
        if (netR !== null) { near(initialRisk, summary.initialRiskAud, `${id} summary risk`); near(netR, summary.netR, `${id} summary R`); }
        near(grossBeforeEstimatedFrictionAud, summary.grossBeforeEstimatedFrictionAud, `${id} midpoint gross decomposition`);
        near(estimatedFrictionAud, summary.estimatedFrictionAud, `${id} friction decomposition`);
        const date = new Date(trade.entry_time), year = date.getUTCFullYear();
        rows.push({ brokerTradeId: id, instrument: trade.instrument, side: trade.side, entryTime: trade.entry_time,
            exitTime: trade.exit_time, exitReason: trade.exit_reason, entryDayUtc: date.toISOString().slice(0, 10),
            year, quarter: `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`, episodeId,
            netAud: net, netR, initialRiskAud: initialRisk, financingAud: financing, commissionAud: commission,
            grossBeforeEstimatedFrictionAud, estimatedFrictionAud });
    }
    assert.equal(rows.length, closed.size, 'All closed broker trades have reconciled local ownership');
    near(sum(rows.map((row) => row.netAud)), result.summary.netAud, 'Summary closed cash');
    if (!missingRisk.length) near(sum(rows.map((row) => row.netR)), result.summary.totalNetR, 'Summary total original-risk R');
    near(sum(rows.map((row) => row.grossBeforeEstimatedFrictionAud)), result.summary.grossBeforeEstimatedFrictionAud, 'Summary midpoint gross');
    near(sum(rows.map((row) => row.estimatedFrictionAud)), result.summary.estimatedExecutionFrictionAud, 'Summary friction');
    const byPair = aggregate(rows, 'instrument'), byYear = aggregate(rows, 'year'), byQuarter = aggregate(rows, 'quarter'), bySide = aggregate(rows, 'side');
    for (const groups of [byPair, byYear, byQuarter]) for (const [key, value] of Object.entries(groups)) {
        const actual = result.summary.periods[key]; assert.ok(actual, `Missing summary period ${key}`);
        assert.equal(value.trades, actual.trades); assert.equal(value.wins, actual.wins);
        near(value.netAud, actual.netAud, `${key} cash`);
        if (value.netR !== null) near(value.netR, actual.netR, `${key} R`);
        near(value.grossBeforeEstimatedFrictionAud, actual.grossBeforeEstimatedFrictionAud, `${key} midpoint gross`);
        near(value.estimatedFrictionAud, actual.estimatedFrictionAud, `${key} friction`);
    }
    const rejectCounts = {}, allDecisionCounts = {}, portfolioRiskReasonCounts = {}, riskRejectionRows = [];
    for (const decision of result.entryDecisions) {
        const key = `${decision.outcome}:${decision.rejection_code ?? 'NONE'}`;
        allDecisionCounts[key] = (allDecisionCounts[key] || 0) + 1;
        if (decision.outcome === 'REJECTED') rejectCounts[decision.rejection_code ?? 'UNSPECIFIED'] = (rejectCounts[decision.rejection_code ?? 'UNSPECIFIED'] || 0) + 1;
        const context = typeof decision.rejection_context === 'string' ? JSON.parse(decision.rejection_context) : decision.rejection_context;
        const riskReasons = context?.portfolioRisk?.reasons ?? [];
        for (const reason of riskReasons) portfolioRiskReasonCounts[reason.code] = (portfolioRiskReasonCounts[reason.code] || 0) + 1;
        if (decision.outcome === 'REJECTED' && (riskReasons.length || ['EXPOSURE_LIMIT', 'POSITION_SIZE_TOO_SMALL', 'INSUFFICIENT_MARGIN'].includes(decision.rejection_code))) {
            riskRejectionRows.push({ decisionId: decision.decision_id, atMs: decision.decision_time, instrument: decision.instrument,
                rejectionCode: decision.rejection_code, reason: decision.rejection_reason, portfolioRiskReasons: riskReasons });
        }
    }
    assert.deepEqual(allDecisionCounts, result.summary.entryDecisionCounts, 'Decision count aggregation');
    let peak = spec.initialBalanceAud, maximumDrawdownAud = 0, maximumDrawdownFraction = 0;
    for (const point of result.equityDailyAndTradeObservations) { peak = Math.max(peak, point.navAud);
        maximumDrawdownAud = Math.max(maximumDrawdownAud, peak - point.navAud);
        maximumDrawdownFraction = Math.max(maximumDrawdownFraction, (peak - point.navAud) / peak); }
    near(maximumDrawdownAud, result.summary.drawdown.sampledNavMaxAud, 'Sampled NAV drawdown AUD');
    near(maximumDrawdownFraction, result.summary.drawdown.sampledNavMaxFraction, 'Sampled NAV drawdown fraction');
    assert.equal(result.equityDailyAndTradeObservations.length, result.summary.drawdown.observations);
    const monthlyEntries = {};
    for (let time = new Date(from); time.getTime() < to; time = new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + 1, 1))) monthlyEntries[time.toISOString().slice(0, 7)] = 0;
    for (const trade of trades) monthlyEntries[new Date(trade.entry_time).toISOString().slice(0, 7)]++;
    assert.deepEqual(monthlyEntries, result.summary.frequency.monthlyEntries, 'Monthly entry counts including zero months');
    near(trades.length / ((to - from) / (30 * 86_400_000)), result.summary.frequency.entriesPer30CalendarDays, 'Elapsed-time normalized cadence');
    const absNet = sum(rows.map((row) => Math.abs(row.netAud)));
    const concentration = Object.fromEntries(Object.entries(byPair).map(([pair, value]) => [pair, { tradeShare: rows.length ? value.trades / rows.length : null,
        absoluteNetContributionShare: absNet ? sum(rows.filter((row) => row.instrument === pair).map((row) => Math.abs(row.netAud))) / absNet : null }]));
    return { caseId: spec.caseId, resultPath: path.relative(root, resultPath), resultSha256: sha(resultBytes),
        specSha256: result.specSha256, archiveSha256: archived.sha256, sourcePinSetSha256: sha(JSON.stringify(result.sourceHashes)),
        sourceVerification: verifySources ? 'MATCHES_CURRENT_FROZEN_FILES' : 'SOFTWARE_FIXTURE_SOURCE_CHECK_EXPLICITLY_DISABLED',
        interval: result.summary.interval, closedTrades: rows.length, openTrades: trades.filter((row) => row.is_open).length,
        independentFinalBalanceAud: cash, netAud: sum(rows.map((row) => row.netAud)),
        totalNetR: missingRisk.length ? null : sum(rows.map((row) => row.netR)),
        averageNetR: rows.length && !missingRisk.length ? sum(rows.map((row) => row.netR)) / rows.length : null,
        missingRiskMetadataTradeIds: missingRisk, missingEpisodeMetadataTradeIds: missingEpisode,
        grossBeforeEstimatedFrictionAud: sum(rows.map((row) => row.grossBeforeEstimatedFrictionAud)),
        estimatedFrictionAud: sum(rows.map((row) => row.estimatedFrictionAud)),
        financingAud: sum(rows.map((row) => row.financingAud)), commissionAud: sum(rows.map((row) => row.commissionAud)),
        bySide, byPair, byYear, byQuarter, pairConcentration: concentration,
        entryDecisionCounts: allDecisionCounts, rejectionCounts: rejectCounts, portfolioRiskReasonCounts, riskRejectionRows,
        uncertainty: { entryDay: clusterDiagnostic(rows, 'entryDayUtc'), breakoutEpisode: clusterDiagnostic(rows, 'episodeId') },
        frequency: result.summary.frequency, drawdown: result.summary.drawdown,
        accountingAssertions: 'ALL_PASSED', tradeLedger: rows };
}
function main() {
    const args = process.argv.slice(2), recent = args.includes('--recent');
    const outputIndex = args.indexOf('--output');
    const destination = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : path.join(__dirname, recent ? 'economic-audit-recent.json' : 'economic-audit-full.json');
    const specDirectory = path.join(root, recent ? 'docs/reviews/evidence/2026-10-17/viability-specs/recent' : 'docs/reviews/evidence/2026-10-17/viability-model/specs');
    const resultDirectory = path.join(root, `backend/data/backtests/viability-20261017/${recent ? 'recent' : 'full'}`);
    const specs = fs.readdirSync(specDirectory).filter((name) => name.endsWith('.json')).sort();
    assert.equal(specs.length, 8, 'Exactly the preregistered eight cases are required');
    const cases = [];
    for (const file of specs) {
        const specPath = path.join(specDirectory, file), spec = readJson(specPath);
        const resultPath = path.join(resultDirectory, `${spec.caseId}.json`);
        assert.ok(fs.existsSync(resultPath), `Case not complete: ${resultPath}`);
        assert.equal(spec.fromUtc, recent ? '2026-09-15T00:00:00Z' : '2020-03-01T00:00:00Z');
        assert.equal(spec.toUtcExclusive, recent ? '2026-10-17T00:00:00Z' : '2026-08-03T00:15:00Z');
        cases.push(auditOne({ resultPath, specPath }));
    }
    assert.equal(new Set(cases.map((item) => item.sourcePinSetSha256)).size, 1, 'Cases use different source versions');
    const output = { schemaVersion: 1, artifactKind: 'INDEPENDENT_COST_ACCOUNTING_AND_DAY_EPISODE_CLUSTER_AUDIT',
        cohort: recent ? 'RECENT_SEPARATE_COLD_START' : 'FULL_CONTINUOUS_COLD_START', runtime: process.version,
        toolSha256: sha(fs.readFileSync(__filename)), caseCount: cases.length,
        allAccountingAssertionsPassed: true, cases,
        definitions: { initialRisk: 'Absolute filled entry minus immutable original stop, times whole units, times entry quote-to-AUD loss conversion; current moved stop is never reused.',
            netCash: 'Independent modeled side/fill price P&L converted at exit plus explicit lifetime financing minus entry and closing commission. Every event cash delta is checked.',
            friction: 'Modeled midpoint entry-to-exit P&L minus modeled executable-price gross plus explicit commissions. This estimates execution friction; spread is not deducted again from net.',
            buyEpisode: 'Actual persisted buyRetest.episodeId, namespaced by instrument/side.',
            sellEpisode: 'Instrument plus actual sellRetest.breakout.closedAt and level. The more granular SELL pattern/retest/confirmation tuple is deliberately not used.',
            kish: 'Squared sum of cluster trade counts (or initial risk) divided by sum of squared cluster sizes. A concentration descriptor, not proof of independent effective trials.' },
        limits: ['All cases remain separate conditional historical sensitivities of one strategy, not independent strategy samples or an optimized selection.',
            'Day/episode resampling assumes exchangeable sampled clusters conditionally; temporal dependence, correlated episodes, historical selection, unobserved execution paths and unknown costs remain unresolved.',
            'No arbitrary minimum trade count or confidence interval proves an edge; singleton/degenerate/no-observation resampling intervals are unavailable.',
            'Input quotes and modeled conversion paths are counterfactual assumptions. Arithmetic agreement does not establish real broker fills, latency, financing or home-conversion parity.',
            'Sampled NAV drawdown is independently recomputed from the same retained equity observations. It is not an exhaustive intrabar drawdown bound. Monthly entry counts and elapsed-time-normalized cadence are independently checked.'] };
    fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output: path.relative(root, destination), cases: cases.map((item) => ({ caseId: item.caseId,
        trades: item.closedTrades, netAud: item.netAud, netR: item.totalNetR, episodes: item.uncertainty.breakoutEpisode.observedClusters })) }));
}
module.exports = { auditOne, clusterDiagnostic, episodeIdentity };
if (require.main === module) main();
