'use strict';
const sum = (values) => values.reduce((total, value) => total + value, 0);
const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] : null;
function dayClusterSensitivity(rows) {
    const days = new Map();
    for (const row of rows) {
        const key = new Date(row.entryTime).toISOString().slice(0, 10);
        if (!days.has(key)) days.set(key, { trades: 0, netR: 0, netAud: 0 });
        const day = days.get(key); day.trades++; day.netR += row.netR ?? 0; day.netAud += row.netAud;
    }
    const clusters = [...days.values()], means = [];
    let state = 20261017;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    if (clusters.length > 1) for (let sample = 0; sample < 2000; sample++) {
        let trades = 0, netR = 0;
        for (let index = 0; index < clusters.length; index++) { const day = clusters[Math.floor(random() * clusters.length)]; trades += day.trades; netR += day.netR; }
        means.push(netR / trades);
    }
    return { method: 'SEEDED_RESAMPLE_OF_TRADE_BEARING_UTC_ENTRY_DAYS', replications: means.length, seed: 20261017,
        tradeBearingDays: days.size, closedTrades: rows.length,
        meanNetRPerTradePercentile95: means.length ? [quantile(means, 0.025), quantile(means, 0.975)] : null,
        limitations: 'Conditional sensitivity assuming exchangeable trade-bearing days; ignores interday dependence, parameter selection and unobserved paths/costs. Not an independent live-edge confidence claim.' };
}
function summarizeViability({ snapshot, fromMs, toMs, scanSummary, equity, tradeCosts, pathAssumptions }) {
    const trades = snapshot.tables.trades;
    const closed = trades.filter((trade) => !trade.is_open);
    const byBroker = new Map(tradeCosts.map((trade) => [trade.brokerTradeId, trade]));
    const rows = closed.map((trade) => ({ instrument: trade.instrument, side: trade.side, entryTime: trade.entry_time,
        exitTime: trade.exit_time, entryType: trade.entry_type, entryPrice: trade.entry_price, exitPrice: trade.exit_price,
        exitReason: trade.exit_reason, breakevenHit: !!trade.breakeven_hit, netAud: trade.pnl_aud,
        ...byBroker.get(trade.oanda_trade_id) }));
    const periods = {};
    const emptyPeriod = () => ({ trades: 0, wins: 0, netAud: 0, netR: 0, grossBeforeEstimatedFrictionAud: 0,
        estimatedFrictionAud: 0, executionFrictionAud: 0, homeConversionCostAud: 0 });
    for (let at = new Date(fromMs); at.getTime() < toMs; at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))) {
        periods[String(at.getUTCFullYear())] ??= emptyPeriod();
        periods[`${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`] ??= emptyPeriod();
    }
    for (const instrument of Object.keys(scanSummary.reasonCounts ?? {}).map((key) => key.split(':')[0])) periods[instrument] ??= emptyPeriod();
    for (const row of rows) {
        const date = new Date(row.entryTime), year = date.getUTCFullYear();
        for (const key of [String(year), `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`, row.instrument]) {
            if (!periods[key]) periods[key] = emptyPeriod();
            const period = periods[key]; period.trades++; period.wins += row.netAud > 0 ? 1 : 0;
            period.netAud += row.netAud; period.netR += row.netR ?? 0;
            period.grossBeforeEstimatedFrictionAud += row.grossBeforeEstimatedFrictionAud ?? row.netAud;
            period.estimatedFrictionAud += row.estimatedFrictionAud ?? 0;
            period.executionFrictionAud += row.executionFrictionAud ?? 0;
            period.homeConversionCostAud += row.homeConversionCostAud ?? 0;
        }
    }
    const byMonth = {};
    for (let at = new Date(fromMs); at.getTime() < toMs; at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))) byMonth[at.toISOString().slice(0, 7)] = 0;
    for (const trade of trades) byMonth[new Date(trade.entry_time).toISOString().slice(0, 7)]++;
    const entryTimes = trades.map((trade) => trade.entry_time).sort((a, b) => a - b);
    const boundaries = [fromMs, ...entryTimes, toMs];
    const gaps = boundaries.slice(1).map((time, index) => ({ fromUtc: new Date(boundaries[index]).toISOString(),
        toUtc: new Date(time).toISOString(), calendarDays: (time - boundaries[index]) / 86_400_000 }));
    const positives = rows.filter((row) => row.netAud > 0), negatives = rows.filter((row) => row.netAud < 0);
    const totalR = sum(rows.map((row) => row.netR ?? 0));
    const nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
    const cutoffCrossings = [];
    for (const trade of trades) {
        const exitMs = trade.is_open ? toMs : trade.exit_time;
        for (let at = Math.ceil(trade.entry_time / 3_600_000) * 3_600_000; at < exitMs; at += 3_600_000) {
            if (at > trade.entry_time && nyHour.format(new Date(at)) === '17') cutoffCrossings.push({
                brokerTradeId: trade.oanda_trade_id, instrument: trade.instrument, atUtc: new Date(at).toISOString() });
        }
    }
    let peak = snapshot.broker.initialBalanceAud, maxDrawdownAud = 0, maxDrawdownFraction = 0;
    for (const point of equity) { peak = Math.max(peak, point.navAud); maxDrawdownAud = Math.max(maxDrawdownAud, peak - point.navAud); maxDrawdownFraction = Math.max(maxDrawdownFraction, (peak - point.navAud) / peak); }
    return { interpretation: 'RETROSPECTIVE_CONDITIONAL_PATH_AND_COST_MODEL; NOT EXACT_HISTORICAL_BROKER_RETURNS',
        interval: { fromUtc: new Date(fromMs).toISOString(), toUtcExclusive: new Date(toMs).toISOString() }, pathAssumptions,
        initialBalanceAud: snapshot.broker.initialBalanceAud, finalBalanceAud: snapshot.broker.balanceAud,
        closedTrades: rows.length, openBoundaryTrades: trades.filter((trade) => trade.is_open),
        netAud: sum(rows.map((row) => row.netAud)), totalNetR: totalR, averageNetR: rows.length ? totalR / rows.length : null,
        wins: positives.length, losses: negatives.length, flat: rows.length - positives.length - negatives.length,
        winRate: rows.length ? positives.length / rows.length : null,
        profitFactor: negatives.length ? sum(positives.map((row) => row.netAud)) / -sum(negatives.map((row) => row.netAud)) : null,
        estimatedExecutionFrictionAud: sum(rows.map((row) => row.estimatedFrictionAud ?? 0)),
        executionFrictionAud: sum(rows.map((row) => row.executionFrictionAud ?? 0)),
        homeConversionCostAud: sum(rows.map((row) => row.homeConversionCostAud ?? 0)),
        grossBeforeEstimatedFrictionAud: sum(rows.map((row) => row.grossBeforeEstimatedFrictionAud ?? row.netAud)),
        costFieldDefinitions: {
            grossBeforeEstimatedFrictionAud: 'Midpoint entry-to-exit price movement at neutral position conversion; a fixed-timing decomposition, not an alternative strategy return.',
            executionFrictionAud: 'Midpoint movement minus executable price P/L, both at neutral AUD conversion, plus lifetime commission.',
            homeConversionCostAud: 'Executable price P/L at neutral AUD conversion minus broker settled P/L; settlement markup is already included exactly once in netAud.',
            estimatedExecutionFrictionAud: 'Legacy summary name for total modeled friction: executionFrictionAud + homeConversionCostAud. Financing is separate.',
        },
        financing: { actualHistoricalChargesKnown: false, modeledAud: snapshot.accounting.financingAud,
            newYork1700CutoffCrossings: cutoffCrossings,
            disclosure: 'No historical financing charges supplied. Session close precedes usual rollover; any residual rollover or fee is unresolved.',
            breakEvenAdditionalCostPerClosedTradeAud: rows.length ? sum(rows.map((row) => row.netAud)) / rows.length : null },
        drawdown: { sampledNavMaxAud: maxDrawdownAud, sampledNavMaxFraction: maxDrawdownFraction, observations: equity.length },
        uncertainty: dayClusterSensitivity(rows),
        frequency: { entriesPerTouchedCalendarMonth: trades.length / Object.keys(byMonth).length,
            entriesPer30CalendarDays: trades.length / ((toMs - fromMs) / (30 * 86_400_000)),
            observedUtcMarketDays: scanSummary.observedMarketDates?.length ?? null, monthlyEntries: byMonth,
            partialBoundaryMonths: { first: new Date(fromMs).getUTCDate() !== 1 || new Date(fromMs).getUTCHours() !== 0,
                last: new Date(toMs).getUTCDate() !== 1 || new Date(toMs).getUTCHours() !== 0 },
            zeroEntryMonths: Object.values(byMonth).filter((count) => !count).length,
            entryGapDays: { median: quantile(gaps.map((row) => row.calendarDays), 0.5), p90: quantile(gaps.map((row) => row.calendarDays), 0.9),
                maximum: Math.max(...gaps.map((row) => row.calendarDays)) }, longestGaps: gaps.sort((a, b) => b.calendarDays - a.calendarDays).slice(0, 10) },
        periods, scanSummary, accounting: snapshot.accounting, tradeLedger: rows,
        entryDecisionCounts: snapshot.tables.entry_decisions.reduce((result, row) => {
            const key = `${row.outcome}:${row.rejection_code ?? 'NONE'}`; result[key] = (result[key] ?? 0) + 1; return result;
        }, {}),
        finalBrokerRuntimeState: snapshot.tables.broker_runtime_state,
        finalDecisions: snapshot.tables.entry_decisions.slice(-15), finalRuntime: snapshot.runtime };
}
module.exports = { summarizeViability };
