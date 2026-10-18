'use strict';
// Fixed-ledger sensitivity only. Does not alter inputs or active research jobs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { modeledQuote, conversion, archiveFor } = require('./economic-audit.cjs');
const root = path.resolve(__dirname, '../../../..');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sum = (values) => values.reduce((a, b) => a + b, 0);
const round = (value) => Number(value.toPrecision(15));
const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-8, `${label}: ${a} differs from ${b}`);
const json = (file) => JSON.parse(fs.readFileSync(file));
function midpointConversion(archive, spec, currency, time) {
    if (currency === 'AUD') return 1;
    const usdToAud = 1 / modeledQuote(archive, spec, 'AUD_USD', time).mid;
    if (currency === 'USD') return usdToAud;
    if (currency === 'JPY') return usdToAud / modeledQuote(archive, spec, 'USD_JPY', time).mid;
    throw Error(`Unspecified midpoint conversion ${currency}`);
}
function overlayOne(resultPath, markup = 0.01) {
    const bytes = fs.readFileSync(resultPath), result = JSON.parse(bytes), spec = result.spec;
    const archive = archiveFor(spec, path.dirname(resultPath)).data;
    const opened = new Map(result.brokerLedger.filter((event) => event.type === 'TRADE_OPENED').map((event) => [String(event.tradeId), event]));
    const closed = new Map(result.brokerLedger.filter((event) => event.type === 'TRADE_CLOSED').map((event) => [String(event.tradeId), event]));
    const rows = [], openRows = [];
    for (const trade of result.persistedTrades) {
        const id = String(trade.oanda_trade_id), entry = opened.get(id), exit = closed.get(id);
        assert.ok(entry, `Missing opening ${id}`);
        const counter = trade.instrument.split('_')[1], units = (trade.side === 'BUY' ? 1 : -1) * Math.abs(trade.units);
        const at = exit ? exit.atMs : Date.parse(spec.toUtcExclusive) - 1;
        const quote = modeledQuote(archive, spec, trade.instrument, at);
        const price = exit ? exit.fillPrice : trade.side === 'BUY' ? quote.bid : quote.ask;
        const quotePL = (price - entry.fillPrice) * units;
        const baseRate = conversion(archive, spec, counter, at, quotePL);
        const positionRate = midpointConversion(archive, spec, counter, at);
        const markedRate = positionRate * (counter === 'AUD' ? 1 : quotePL < 0 ? 1 + markup : 1 - markup);
        const oldGross = quotePL * baseRate, midpointUnmarkedGross = quotePL * positionRate, markedGross = quotePL * markedRate;
        if (exit) near(oldGross, exit.grossRealizedAud, `${id} original gross conversion`);
        const commission = (entry.commissionAud || 0) + (exit?.commissionAud || 0);
        const financing = exit?.lifetimeFinancingAud || 0;
        const conversionMarkupFromMidAud = counter === 'AUD' ? 0 : Math.abs(midpointUnmarkedGross) * markup;
        const oldConversionSpreadCostAud = midpointUnmarkedGross - oldGross;
        const replacementAdditionalCostAud = conversionMarkupFromMidAud - oldConversionSpreadCostAud;
        near(markedGross - oldGross, -replacementAdditionalCostAud, `${id} conversion replacement without double count`);
        const payload = typeof trade.broker_reconciliation_payload === 'string' ? JSON.parse(trade.broker_reconciliation_payload) : trade.broker_reconciliation_payload;
        const runtime = payload?.liveRuntime;
        const initialQuoteRisk = runtime?.initialStopLossPrice != null ? Math.abs(entry.fillPrice - runtime.initialStopLossPrice) * Math.abs(trade.units) : null;
        const entryPositionRate = midpointConversion(archive, spec, counter, entry.atMs);
        const markedInitialRiskAudFixedUnits = initialQuoteRisk === null ? null : initialQuoteRisk * entryPositionRate * (counter === 'AUD' ? 1 : 1 + markup);
        const row = { brokerTradeId: id, instrument: trade.instrument, side: trade.side, unitsFixed: Math.abs(trade.units),
            entryTime: entry.atMs, exitOrBoundaryTime: at, quoteCurrency: counter, quotePL,
            originalBidAskDerivedConversion: baseRate, modeledMidpointPositionConversion: positionRate,
            replacementMarkedConversion: markedRate, originalGrossAud: oldGross, replacementGrossAud: markedGross,
            originalNetAud: oldGross + financing - commission, replacementNetAudFixedLedger: markedGross + financing - commission,
            conversionMarkupFromMidAud, replacedOldConversionSpreadCostAud: oldConversionSpreadCostAud,
            replacementAdditionalCostAud, originalInitialRiskAud: runtime?.initialRiskAud ?? null,
            markedInitialRiskAudFixedUnits,
            initialRiskChangeFractionFixedUnits: runtime?.initialRiskAud > 0 && markedInitialRiskAudFixedUnits !== null
                ? markedInitialRiskAudFixedUnits / runtime.initialRiskAud - 1 : null,
            entryBrokerMarginRateInFrozenModel: runtime?.instrumentMetadata?.marginRate ?? null };
        (exit ? rows : openRows).push(row);
    }
    const delta = sum(rows.map((row) => row.replacementNetAudFixedLedger - row.originalNetAud));
    near(sum(rows.map((row) => row.originalNetAud)), result.summary.netAud, 'Original net total');
    return { caseId: spec.caseId, sourceResultPath: path.relative(root, resultPath), sourceResultSha256: sha(bytes),
        sourcePinSetSha256: sha(JSON.stringify(result.sourceHashes)), spec: { fromUtc: spec.fromUtc, toUtcExclusive: spec.toUtcExclusive,
            spreadPips: spec.spreadPips, pathOrder: spec.pathOrder, slippagePips: spec.slippagePips },
        closedTradesFixed: rows.length, openTradesFixed: openRows.length, originalClosedNetAud: result.summary.netAud,
        markedClosedNetAudFixedLedger: sum(rows.map((row) => row.replacementNetAudFixedLedger)),
        conversionMarkupFromMidAud: sum(rows.map((row) => row.conversionMarkupFromMidAud)),
        replacedOldConversionSpreadCostAud: sum(rows.map((row) => row.replacedOldConversionSpreadCostAud)),
        replacementAdditionalCostAud: -delta, originalFinalBalanceAud: result.summary.finalBalanceAud,
        markedFinalCashFixedLedger: result.summary.finalBalanceAud + delta,
        sizingFeedbackInvarianceEstablished: false, portfolioAdmissionInvarianceEstablished: false,
        rows, openBoundaryValuationRows: openRows };
}
function main() {
    const args = process.argv.slice(2), recent = args.includes('--recent'), resultIndex = args.indexOf('--result'), outIndex = args.indexOf('--output');
    const resultDirectory = path.join(root, `backend/data/backtests/viability-20261017/${recent ? 'recent' : 'full'}`);
    const files = resultIndex >= 0 ? [path.resolve(args[resultIndex + 1])]
        : fs.readdirSync(resultDirectory).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(resultDirectory, name));
    if (resultIndex < 0) assert.equal(files.length, 8, 'All eight frozen cases are required');
    const proofPath = path.join(__dirname, 'home-conversion-proof.json'), proof = json(proofPath);
    const observed = proof.conversions.filter((row) => row.currency !== 'AUD').map((row) => ({ currency: row.currency,
        gainToPositionRatio: round(row.accountGain / row.positionValue), lossToPositionRatio: round(row.accountLoss / row.positionValue) }));
    for (const row of observed) { near(row.gainToPositionRatio, 0.99, 'Observed gain markup'); near(row.lossToPositionRatio, 1.01, 'Observed loss markup'); }
    const output = { schemaVersion: 1, artifactKind: 'KNOWN_HOME_CONVERSION_MARKUP_FIXED_LEDGER_OVERLAY_ONLY',
        runtime: process.version, toolSha256: sha(fs.readFileSync(__filename)), helperSha256: sha(fs.readFileSync(path.join(__dirname, 'economic-audit.cjs'))),
        proofPath: path.relative(root, proofPath), proofSha256: sha(fs.readFileSync(proofPath)), observedConversionRatios: observed,
        markupFraction: 0.01,
        formula: 'Replace quotePL times derived bid/ask conversion with quotePL times modeled midpoint position conversion times 0.99 for gains or 1.01 for losses. Existing AUD commissions/financing are held fixed. Subtract the replaced old conversion-spread cost from the new midpoint markup cost; never add both.',
        cases: files.map((file) => overlayOne(file)),
        conclusion: 'This repairs one known cost on the exact saved fills/units only. It cannot complete the requested economic assessment because actual units, NAV/free margin, admission, loss state and subsequent portfolio feedback were not rerun.',
        limitations: ['Modeled midpoint position conversion remains a price-path assumption; observed broker position conversion can differ in timing and source.',
            'The 1% current observed markup is applied as an explicit current-cost sensitivity; this is not exact historical financing or fee evidence for every date.',
            'Changed accountLoss affects canonical whole-unit worst-fill risk sizing before an order. Changed cash affects future sizing and risk gates. Existing saved decisions do not prove no alternate orders would become eligible.',
            'Actual lower broker margin rates can affect free margin, broker marginUsed and final exposure despite the existing stricter 20x local leverage rule. A fixed-ledger conversion overlay cannot model that feedback.',
            'An exact corrected-cost orchestration rerun is required before claiming a full portfolio result that includes the known conversion markup and demonstrated broker metadata.'] };
    const destination = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : path.join(__dirname, recent ? 'home-conversion-overlay-recent.json' : 'home-conversion-overlay-full.json');
    fs.writeFileSync(destination, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output: path.relative(root, destination), cases: output.cases.map((row) => ({ caseId: row.caseId,
        trades: row.closedTradesFixed, originalNetAud: row.originalClosedNetAud, replacementNetAudFixedLedger: row.markedClosedNetAudFixedLedger,
        additionalConversionCostAud: row.replacementAdditionalCostAud })) }));
}
module.exports = { overlayOne, midpointConversion };
if (require.main === module) main();
