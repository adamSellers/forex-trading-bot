// Independent cash/reconciliation checks over broker and persisted observations.
const money = (value) => (typeof value === 'number' || typeof value === 'string') &&
    !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value)) ? Number(value) : null;
const sum = (rows, field) => rows.every((row) => money(row[field]) !== null)
    ? rows.reduce((total, row) => total + money(row[field]), 0) : null;
const close = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-8;
const brokerId = (value) => (typeof value === 'number' || typeof value === 'string') &&
    String(value).trim() !== '' && !(typeof value === 'number' && !Number.isFinite(value)) ? String(value) : null;
const localOpen = (row) => row.is_open === true || row.is_open === 1;
const localClosed = (row) => row.is_open === false || row.is_open === 0;
const counts = (ids) => ids.reduce((result, id) => result.set(id, (result.get(id) || 0) + 1), new Map());

function reconcileReplayAccounting({ broker, storedTrades, account }) {
    const closed = broker.trades.filter((trade) => trade.state === 'CLOSED');
    const storedClosed = storedTrades.filter(localClosed);
    const localIds = storedTrades.map((row) => brokerId(row.oanda_trade_id));
    const brokerIds = broker.trades.map((row) => brokerId(row.id));
    const localCounts = counts(localIds), brokerCounts = counts(brokerIds);
    const byBrokerId = new Map(storedTrades.map((row) => [brokerId(row.oanda_trade_id), row]));
    const grossClosedAud = sum(closed, 'realizedPL');
    const financingAud = sum(broker.trades, 'financing');
    const commissionAud = sum(broker.trades, 'commission');
    const initialBalanceAud = money(broker.initialBalanceAud);
    const expectedBalanceAud = [initialBalanceAud, grossClosedAud, financingAud, commissionAud].every((value) => value !== null)
        ? initialBalanceAud + grossClosedAud + financingAud - commissionAud : null;
    const tradeChecks = closed.map((trade) => {
        const id = brokerId(trade.id);
        const stored = id === null ? null : byBrokerId.get(id);
        const amounts = [money(trade.realizedPL), money(trade.financing), money(trade.commission)];
        const expectedNetAud = amounts.every((value) => value !== null) ? amounts[0] + amounts[1] - amounts[2] : null;
        return { brokerTradeId: trade.id, expectedNetAud, recordedNetAud: stored?.pnl_aud ?? null,
            recordedClosed: !!stored && localClosed(stored),
            matched: id !== null && localCounts.get(id) === 1 && brokerCounts.get(id) === 1 &&
                !!stored && localClosed(stored) && close(money(stored.pnl_aud), expectedNetAud) };
    });
    const localOpenIds = storedTrades.filter(localOpen).map((row) => brokerId(row.oanda_trade_id)).sort();
    const brokerOpenIds = broker.trades.filter((row) => row.state === 'OPEN').map((row) => brokerId(row.id)).sort();
    const closedNetAud = tradeChecks.every((row) => row.expectedNetAud !== null)
        ? tradeChecks.reduce((total, row) => total + row.expectedNetAud, 0) : null;
    const recordedClosedNetAud = sum(storedClosed, 'pnl_aud');
    const checks = {
        moneyEvidenceComplete: [initialBalanceAud, money(broker.balanceAud), grossClosedAud, financingAud, commissionAud,
            ...['balance', 'NAV', 'unrealizedPL', 'marginUsed', 'marginAvailable'].map((field) => money(account[field]))].every((value) => value !== null) &&
            broker.trades.every((row) => money(row.realizedPL) !== null) && recordedClosedNetAud !== null,
        ownershipEvidenceComplete: localIds.every((id) => id !== null) && brokerIds.every((id) => id !== null) &&
            storedTrades.every((row) => localOpen(row) || localClosed(row)) &&
            broker.trades.every((row) => row.state === 'OPEN' || row.state === 'CLOSED'),
        uniqueOwnership: localIds.length === localCounts.size && brokerIds.length === brokerCounts.size,
        lifetimeCostsAndBalance: close(expectedBalanceAud, money(broker.balanceAud)),
        accountBalance: close(money(account.balance), money(broker.balanceAud)),
        navEqualsBalancePlusUnrealized: money(account.balance) !== null && money(account.unrealizedPL) !== null &&
            close(money(account.NAV), money(account.balance) + money(account.unrealizedPL)),
        marginAvailable: money(account.NAV) !== null && money(account.marginUsed) !== null &&
            close(money(account.marginAvailable), Math.max(0, money(account.NAV) - money(account.marginUsed))),
        allClosedTradesReconciled: tradeChecks.every((row) => row.matched),
        allBrokerTradesHaveLocalOwners: brokerIds.every((id) => id !== null && localCounts.has(id)),
        allLocalTradesHaveBrokerOwners: localIds.every((id) => id !== null && brokerCounts.has(id)),
        openOwnership: JSON.stringify(localOpenIds) === JSON.stringify(brokerOpenIds),
        closedTotals: close(recordedClosedNetAud, closedNetAud),
    };
    return { status: Object.values(checks).every(Boolean) ? 'RECONCILED' : 'DISCREPANCY', checks,
        initialBalanceAud: broker.initialBalanceAud, expectedBalanceAud, observedBalanceAud: broker.balanceAud,
        closedTrades: closed.length, openTrades: brokerOpenIds.length,
        grossClosedAud, financingAud, commissionAud, closedNetAud, recordedClosedNetAud, tradeChecks,
        numericalToleranceAud: 1e-8, scope: 'Supplied model points and explicitly recorded costs; no intrabar or historical financing claim.' };
}

module.exports = { reconcileReplayAccounting };
