"use strict";
const STATIC_HOLDS = new Set(['INTRADAY_MOMENTUM_WARMUP', 'INTRADAY_MOMENTUM_ROLLOVER_WINDOW',
    'INTRADAY_MOMENTUM_OUTSIDE_SESSION', 'INTRADAY_MOMENTUM_ATR_UNAVAILABLE', 'INTRADAY_MOMENTUM_ADX_WEAK',
    'INTRADAY_MOMENTUM_REGIME_NEUTRAL', 'INTRADAY_MOMENTUM_CANDLE_QUALITY',
    'INTRADAY_MOMENTUM_CONFIRMATION_MISSING', 'INTRADAY_MOMENTUM_NO_TRIGGER',
    'INTRADAY_MOMENTUM_M15_CANDLES_STALE', 'INTRADAY_MOMENTUM_H1_CANDLES_STALE',
    'INTRADAY_MOMENTUM_NOT_TRADEABLE', 'INTRADAY_MOMENTUM_MARKET_CLOSED',
    'INTRADAY_MOMENTUM_STALE_COMPLETED_CANDLE', 'INTRADAY_MOMENTUM_WAITING_FOR_POST_REOPEN_CANDLE']);

function needsMinuteScan(signals, hasExposure, scanMode) {
    if (scanMode === 'EVERY_MINUTE') return true;
    return signals.some((signal) => {
        if (STATIC_HOLDS.has(signal.reasonCode)) return false;
        if (!hasExposure && signal.signal === 'HOLD') {
            const context = signal.strategyContext ?? signal.decisionContext?.strategyContext ?? {};
            // No position can require an exit, and neither completed pattern
            // can become ready without another completed candle.
            if (context.buyRetest?.ready === false && context.sellRetest?.ready === false) return false;
        }
        return true;
    });
}

module.exports = { needsMinuteScan };
