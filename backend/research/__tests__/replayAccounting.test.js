const { reconcileReplayAccounting } = require('../replayAccounting.cjs');

function fixture() {
    return {
        broker: { initialBalanceAud: 100, balanceAud: 100, trades: [
            { id: '1', state: 'CLOSED', realizedPL: '0', financing: '0', commission: '0' },
        ] },
        storedTrades: [{ oanda_trade_id: '1', is_open: 0, pnl_aud: 0 }],
        account: { balance: '100', NAV: '100', unrealizedPL: '0', marginUsed: '0', marginAvailable: '100' },
    };
}

describe('replay accounting evidence', () => {
    test('actual numeric and string zero establish a complete reconciled flat outcome', () => {
        const state = fixture();
        state.storedTrades[0].pnl_aud = '0';
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('RECONCILED');
        expect(Object.values(result.checks).every(Boolean)).toBe(true);
        expect(result.tradeChecks[0]).toMatchObject({ expectedNetAud: 0, recordedNetAud: '0', recordedClosed: true, matched: true });
        expect(result).toMatchObject({ expectedBalanceAud: 100, grossClosedAud: 0, financingAud: 0,
            commissionAud: 0, closedNetAud: 0, recordedClosedNetAud: 0 });
    });

    test('closed net and cash include lifetime costs plus entry costs and financing on still-open positions', () => {
        const state = fixture();
        state.broker.trades[0] = { id: '1', state: 'CLOSED', realizedPL: '0.5', financing: '-0.03', commission: '0.02' };
        state.broker.trades.push({ id: '2', state: 'OPEN', realizedPL: '0', financing: '-0.01', commission: '0.01' });
        state.storedTrades = [{ oanda_trade_id: '1', is_open: false, pnl_aud: 0.45 },
            { oanda_trade_id: '2', is_open: true, pnl_aud: null }];
        state.broker.balanceAud = 100.43;
        state.account = { balance: '100.43', NAV: '100.4', unrealizedPL: '-0.03', marginUsed: '5', marginAvailable: '95.4' };
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('RECONCILED');
        expect(result).toMatchObject({ closedTrades: 1, openTrades: 1, grossClosedAud: 0.5, commissionAud: 0.03 });
        expect(result.financingAud).toBeCloseTo(-0.04, 12);
        expect(result.expectedBalanceAud).toBeCloseTo(100.43, 12);
        expect(result.closedNetAud).toBeCloseTo(0.45, 12);
        expect(result.recordedClosedNetAud).toBe(0.45);
    });

    test('an empty ledger and valid zero-balance account remain valid evidence', () => {
        const result = reconcileReplayAccounting({ broker: { initialBalanceAud: 0, balanceAud: 0, trades: [] }, storedTrades: [],
            account: { balance: '0', NAV: '0', unrealizedPL: '0', marginUsed: '0', marginAvailable: '0' } });
        expect(result.status).toBe('RECONCILED');
        expect(result.closedTrades).toBe(0);
        expect(result.closedNetAud).toBe(0);
    });

    test.each([null, undefined, '', ' ', false, NaN, Infinity, 'invalid'])('missing/invalid local closed PnL %s cannot match actual zero', (value) => {
        const state = fixture();
        state.storedTrades[0].pnl_aud = value;
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.moneyEvidenceComplete).toBe(false);
        expect(result.checks.allClosedTradesReconciled).toBe(false);
        expect(result.checks.closedTotals).toBe(false);
        expect(result.recordedClosedNetAud).toBeNull();
        expect(result.tradeChecks[0].matched).toBe(false);
    });

    test.each(['realizedPL', 'financing', 'commission'])('missing broker %s remains unknown instead of assumed zero', (field) => {
        const state = fixture();
        state.broker.trades[0][field] = null;
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.moneyEvidenceComplete).toBe(false);
        expect(result.expectedBalanceAud).toBeNull();
        expect(result.tradeChecks[0].expectedNetAud).toBeNull();
        expect(result.closedNetAud).toBeNull();
        expect(result.checks.allClosedTradesReconciled).toBe(false);
    });

    test.each(['balance', 'NAV', 'unrealizedPL', 'marginUsed', 'marginAvailable'])('unknown account %s cannot establish accounting identity', (field) => {
        const state = fixture();
        state.account[field] = null;
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.moneyEvidenceComplete).toBe(false);
    });

    test('duplicate local owners cannot disappear into a map and conceal extra recorded PnL', () => {
        const state = fixture();
        state.storedTrades.unshift({ oanda_trade_id: '1', is_open: 0, pnl_aud: 10 });
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.uniqueOwnership).toBe(false);
        expect(result.checks.allClosedTradesReconciled).toBe(false);
        expect(result.checks.closedTotals).toBe(false);
        expect(result.recordedClosedNetAud).toBe(10);
    });

    test('even a duplicate zero-valued owner violates the required one-to-one ownership', () => {
        const state = fixture();
        state.storedTrades.push({ ...state.storedTrades[0] });
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.uniqueOwnership).toBe(false);
        expect(result.checks.closedTotals).toBe(true);
    });

    test('extra local closed trades absent from broker ledger cannot pass ownership or net totals', () => {
        const state = fixture();
        state.storedTrades.push({ oanda_trade_id: '999', is_open: 0, pnl_aud: 10 });
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.allLocalTradesHaveBrokerOwners).toBe(false);
        expect(result.checks.closedTotals).toBe(false);
        expect(result.recordedClosedNetAud).toBe(10);
    });

    test('an extra zero-valued closed local owner still cannot pass ownership', () => {
        const state = fixture();
        state.storedTrades.push({ oanda_trade_id: '999', is_open: 0, pnl_aud: 0 });
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.allLocalTradesHaveBrokerOwners).toBe(false);
        expect(result.checks.closedTotals).toBe(true);
    });

    test('duplicate broker identities and missing owners cannot pass accounting', () => {
        const state = fixture();
        state.broker.trades.push({ ...state.broker.trades[0] });
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.uniqueOwnership).toBe(false);
        expect(result.checks.allClosedTradesReconciled).toBe(false);
        state.broker.trades.pop();
        state.storedTrades = [];
        expect(reconcileReplayAccounting(state).checks.allBrokerTradesHaveLocalOwners).toBe(false);
    });

    test.each([null, undefined, ''])('unknown owner ID %s is missing evidence', (value) => {
        const state = fixture();
        state.broker.trades[0].id = value;
        state.storedTrades[0].oanda_trade_id = value;
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.ownershipEvidenceComplete).toBe(false);
        expect(result.checks.allClosedTradesReconciled).toBe(false);
    });

    test('unknown lifecycle state is not implicitly treated as a settled closed trade', () => {
        const state = fixture();
        state.storedTrades[0].is_open = null;
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.ownershipEvidenceComplete).toBe(false);
        expect(result.tradeChecks[0].recordedClosed).toBe(false);
        expect(result.tradeChecks[0].matched).toBe(false);
        state.storedTrades[0].is_open = 0;
        state.broker.trades[0].state = 'UNOBSERVED';
        expect(reconcileReplayAccounting(state).checks.ownershipEvidenceComplete).toBe(false);
    });

    test('cash, NAV and margin faults fail their specific accounting checks', () => {
        const state = fixture();
        state.broker.balanceAud = 99;
        state.account.NAV = '101';
        const result = reconcileReplayAccounting(state);
        expect(result.status).toBe('DISCREPANCY');
        expect(result.checks.lifetimeCostsAndBalance).toBe(false);
        expect(result.checks.accountBalance).toBe(false);
        expect(result.checks.navEqualsBalancePlusUnrealized).toBe(false);
        expect(result.checks.marginAvailable).toBe(false);
    });
});
