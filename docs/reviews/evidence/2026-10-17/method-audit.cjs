'use strict';

// Read-only, Node-only method audit. Does not import runtime, credentials or DB.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
const sourcePath = 'backend/data/historical/research_M15_MBA_20200101_20260803.json';
const buffer = fs.readFileSync(path.join(root, sourcePath));
const archive = JSON.parse(buffer);
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'shared/tradingConfigDefaults.json')));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const round = (value) => Number(value.toFixed(10));
const byInstrument = {};
for (const instrument of defaults.assets) {
    const pip = instrument.endsWith('JPY') ? 0.01 : 0.0001;
    const years = {};
    for (const candle of archive.candlesByInstrument[instrument]) {
        const year = new Date(candle.time * 1000).getUTCFullYear();
        const row = years[year] ||= { observations: 0, closeDifferenceAtMostConfiguredSpreadLimit: 0, values: [] };
        const difference = (candle.ask.c - candle.bid.c) / pip;
        row.observations++;
        row.values.push(difference);
        if (difference <= defaults.maxSpreadPips + 1e-8) row.closeDifferenceAtMostConfiguredSpreadLimit++;
    }
    for (const row of Object.values(years)) {
        row.values.sort((a, b) => a - b);
        row.medianComponentCloseDifferencePips = round(row.values[Math.floor(row.observations / 2)]);
        row.p95ComponentCloseDifferencePips = round(row.values[Math.floor(row.observations * 0.95)]);
        row.percentAtMostConfiguredSpreadLimit = round(100 * row.closeDifferenceAtMostConfiguredSpreadLimit / row.observations);
        delete row.values;
    }
    byInstrument[instrument] = years;
}
const sourceFiles = [
    'shared/tradingConfigDefaults.json',
    'backend/src/runtime/executionPolicy.js',
    'backend/src/runtime/intradayBuyRetestPolicy.js',
    'backend/src/runtime/intradaySellRetestPolicy.js',
    'backend/research/intrabarUncertainty.cjs',
    'backend/research/README.md',
    'docs/reviews/2026-10-06-profitability-implementation-plan.md',
];
const result = {
    schemaVersion: 1,
    artifactKind: 'INDEPENDENT_V6_RESEARCH_METHOD_AUDIT',
    capturedOnSydneyDate: '2026-10-17',
    purpose: 'Audit data, cost, cadence and inference limits; not a profitability result or authorization to trade.',
    source: { path: sourcePath, sha256: sha(buffer), bytes: buffer.length,
        granularity: archive.granularity, pricingComponents: archive.pricingComponents,
        evaluationUse: 'ALREADY_INSPECTED_RETROSPECTIVE', runtime: process.version },
    tool: { path: path.relative(root, __filename), sha256: sha(fs.readFileSync(__filename)) },
    sourceHashes: Object.fromEntries(sourceFiles.map((name) => [name, sha(fs.readFileSync(path.join(root, name)))])),
    evidenceMeanings: {
        componentCloseDifference: 'Ask-component close minus bid-component close. Components lack a shared retained event timestamp; this is not a verified simultaneous account executable spread.',
        candles: 'Completed OHLC prices locate retained extrema, not their temporal order or ten-second management delivery.',
        rawScans: 'Repeated scans of the same completed candle are not independent opportunities. Include market sessions and unique pair/candle decision coverage.',
        historicalLabels: 'All 2020-August 2026 data has prior outcome access; a holdout filename cannot restore untouched status.',
    },
    configuredSpreadLimitPips: defaults.maxSpreadPips,
    componentCloseDifferenceByYear: byInstrument,
    demonstratedInputSensitivity: {
        finding: 'Every EUR_USD and GBP_USD archived component-close difference in 2024, 2025 and January-August 2026 exceeds the configured 1.2 pip limit.',
        implication: 'Native component-close price proxies alone would prohibit all entries in those pair-years, irrespective of setup quality. A zero count cannot establish actual historical live-account cadence.',
        independentLiveContrast: 'Retained October 7 incident evidence contains actual EUR_USD fills and signal spreads around 0.8-1.1 pips. This differs in period and account-price evidence; it does not identify exact historical executable spreads.',
    },
    prespecifiedEconomicDecisionCriteria: {
        timing: 'Communicated to primary reviewer before inspecting the new historical evaluator outcomes.',
        keep: 'Unchanged current-rule portfolio must support positive net expectancy after explicit executable costs and plausible path/cost sensitivities, with cluster and period uncertainty not leaving the sign unresolved; cadence and capped capital must serve a stated economic purpose.',
        redesign: 'A specific demonstrated structural benefit survives costs, but an identifiable policy or implementation prevents viability; test a bounded new hypothesis without selecting a winning historical tweak as proof.',
        scrapCurrentStrategy: 'No credible edge survives generous declared assumptions, or ongoing live-risk/research expenditure lacks evidence sufficient to justify keeping this strategy. This does not prove every possible replacement unprofitable.',
        inconclusive: 'Contradictory, highly cost-sensitive or unresolved output fails a keep decision but is not mathematical proof profitability is impossible.',
        noAutomaticThreshold: 'No fixed win rate, arbitrary trade count, confidence cutoff or existing 100-trade analytics flag proves an edge. Independent effective day/episode clusters and economic effect matter.',
    },
    requiredEvaluationChecks: [
        'Preserve whole-unit sizing, AUD conversion, actual cost/spread and price-bound gates, portfolio competition/sort order, H1 reset, protected-exit state, cooldown, exposure and drawdown checks.',
        'Preserve frozen BUY/SELL episode state continuously across research calendar boundaries. Separately label fresh-start cohort sensitivities; never pool them as one continuous account.',
        'Apply spread once through bid/ask entry and liquidation prices. Explicit commissions/financing/fees are additional only when not already in the reported cash amount.',
        'Use BUY bid and SELL ask evidence for stop/target liquidation. Retained target threshold contacts do not imply realized fills.',
        'Declare per-execution adverse slippage assumptions, target fills at threshold or better, gap handling, whole-unit rounding, conversion-time assumptions and absent historical financing.',
        'Do not invent observed quote delivery or claim OHLC high-first/low-first paths are exhaustive. Additional recrossings and management delivery/acknowledgement can alter breakeven outcomes.',
        'Changing fixed-spread decision quotes while retaining archival bid/ask stops is a mixed proxy model. Reconstructing synchronous MBA from midpoint also changes structural-stop evidence; label each synthetic price world explicitly.',
        'Show separate raw opportunities, admitted entries, fills, unique active days, no-trade intervals, positions remaining open and observable mark-to-market drawdown; never force a final close for convenience.',
        'Report gross signals, conditional trade-label returns and achievable account/portfolio P&L separately. A rejected order is not a loss.',
        'Show net AUD and net original-cash-risk R, cost/path sensitivity, by-period and by-pair concentration, effective day/episode cluster counts and unknown coverage.',
    ],
    economicScale: {
        riskFormula: 'min(0.8 * freeMarginAud, 100) * 0.0025, before whole-unit and leverage caps, using current default 20% margin buffer',
        flat95AudRiskBudget: 0.19, flat95AudNominalOnePointFiveRTarget: 0.285,
        maximumRiskBudgetAud: 0.25,
        implication: 'Positive expectancy at this capped capital is a research outcome, not evidence of meaningful income. Raising capital/risk does not repair negative expectancy.',
    },
    officialContractSourcesChecked: [
        { url: 'https://developer.oanda.com/rest-live-v20/instrument-df/', checkedOnSydneyDate: '2026-10-17', supports: 'Candles contain interval-start time, component OHLC, volume and completion; H1/M15 are hour-aligned. OHLC lacks intrabar timestamps.' },
        { url: 'https://developer.oanda.com/rest-live-v20/pricing-df/', checkedOnSydneyDate: '2026-10-17', supports: 'ClientPrice is account-specific with event time, liquidity buckets and tradeable status. Home conversion has distinct gain/loss/position factors.' },
        { url: 'https://developer.oanda.com/rest-live-v20/order-df/', checkedOnSydneyDate: '2026-10-17', supports: 'Take-profit fills at threshold or better; ordinary stop-loss fills at threshold or worse; default liquidation sides are bid for a long and ask for a short.' },
        { url: 'https://developer.oanda.com/rest-live-v20/trade-df/', checkedOnSydneyDate: '2026-10-17', supports: 'Trade realized P&L and financing are separate fields; opened/closed execution times and dependent protections have their own evidence.' },
    ],
    changesMade: 'Only this local research audit script and its JSON output; no live order, setting, deployment or strategy rule.',
};
const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'method-audit.json');
fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output: path.relative(root, destination), archiveSha256: result.source.sha256,
    pairYears: Object.values(byInstrument).reduce((n, years) => n + Object.keys(years).length, 0) }));
