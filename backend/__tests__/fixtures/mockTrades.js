// Mock trade data for testing

/**
 * Create a mock trade object
 */
const createMockTrade = (overrides = {}) => ({
    id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    oandaTradeId: '489',
    instrument: 'AUD_USD',
    side: 'BUY',
    units: 795,
    entryPrice: 1.16571,
    exitPrice: null,
    entryCostAud: 46.17,
    exitValueAud: null,
    pnlAud: 0,
    pnlPips: 0,
    pnlPercent: 0,
    signal: 'BUY',
    signalStrength: 28.5,
    entryType: 'FRESH_FLIP',
    atrPips: 12.5,
    stopLossPrice: 1.16320,
    takeProfitPrice: 1.16918,
    trailingStopPrice: null,
    highestPrice: null,
    trailingStopPips: null,
    leverageUsed: 20,
    marginUsedAud: 46.17,
    spreadPips: 1.0,
    swapAud: 0,
    commissionAud: 0,
    holdingPeriodMs: null,
    entryTime: Date.now(),
    exitTime: null,
    exitReason: null,
    mode: 'live',
    isOpen: true,
    ...overrides,
});

/**
 * Create a closed trade
 */
const createClosedTrade = (overrides = {}) => {
    const entryTime = Date.now() - 3600000; // 1 hour ago
    return createMockTrade({
        exitPrice: 1.16784,
        exitValueAud: 48.94,
        pnlAud: 2.77,
        pnlPips: 21.3,
        pnlPercent: 6.0,
        holdingPeriodMs: 3600000,
        entryTime: entryTime,
        exitTime: Date.now(),
        exitReason: 'TAKE_PROFIT',
        isOpen: false,
        ...overrides,
    });
};

/**
 * Create a losing trade
 */
const createLosingTrade = (overrides = {}) => {
    const entryTime = Date.now() - 1800000; // 30 mins ago
    return createMockTrade({
        exitPrice: 1.16320,
        exitValueAud: 44.17,
        pnlAud: -2.00,
        pnlPips: -25.1,
        pnlPercent: -4.3,
        holdingPeriodMs: 1800000,
        entryTime: entryTime,
        exitTime: Date.now(),
        exitReason: 'STOP_LOSS',
        isOpen: false,
        ...overrides,
    });
};

/**
 * Create a batch of mixed trades for analytics testing
 */
const createTradeBatch = (count = 10) => {
    const trades = [];
    for (let i = 0; i < count; i++) {
        const isWinner = Math.random() > 0.4; // 60% win rate
        const trade = isWinner
            ? createClosedTrade({
                  id: `trade-batch-${i}`,
                  pnlAud: Math.random() * 5 + 1, // $1-$6 profit
                  entryTime: Date.now() - (count - i) * 3600000,
              })
            : createLosingTrade({
                  id: `trade-batch-${i}`,
                  pnlAud: -(Math.random() * 3 + 1), // $1-$4 loss
                  entryTime: Date.now() - (count - i) * 3600000,
              });
        trades.push(trade);
    }
    return trades;
};

/**
 * Create a database record format (snake_case)
 */
const createDbRecord = (trade) => ({
    trade_id: trade.id,
    oanda_trade_id: trade.oandaTradeId,
    instrument: trade.instrument,
    side: trade.side,
    units: trade.units,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    entry_cost_aud: trade.entryCostAud,
    exit_value_aud: trade.exitValueAud,
    pnl_aud: trade.pnlAud,
    pnl_pips: trade.pnlPips,
    pnl_percent: trade.pnlPercent,
    signal: trade.signal,
    signal_strength: trade.signalStrength,
    entry_type: trade.entryType,
    atr_pips: trade.atrPips,
    stop_loss_price: trade.stopLossPrice,
    take_profit_price: trade.takeProfitPrice,
    trailing_stop_price: trade.trailingStopPrice,
    highest_price: trade.highestPrice,
    trailing_stop_pips: trade.trailingStopPips,
    leverage_used: trade.leverageUsed,
    margin_used_aud: trade.marginUsedAud,
    spread_pips: trade.spreadPips,
    swap_aud: trade.swapAud,
    commission_aud: trade.commissionAud,
    holding_period_ms: trade.holdingPeriodMs,
    entry_time: trade.entryTime,
    exit_time: trade.exitTime,
    exit_reason: trade.exitReason,
    mode: trade.mode,
    is_open: trade.isOpen ? 1 : 0,
    created_at: new Date(),
    updated_at: new Date(),
});

module.exports = {
    createMockTrade,
    createClosedTrade,
    createLosingTrade,
    createTradeBatch,
    createDbRecord,
};
