const MINUTE_MS = 60_000;
const CANDLE_PUBLICATION_GRACE_MS = 90_000;
const TIMEFRAME_MINUTES = { "15m": 15, M15: 15, "1h": 60, H1: 60 };
const nyClock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

// OANDA major FX hours: Sunday 17:05 to Friday 16:59 New York,
// with the 16:59–17:05 maintenance break on trading weekdays.
// Verified for the deployed AUD/USD, EUR/USD, GBP/USD and USD/JPY universe:
// https://www.oanda.com/au-en/trading/hours-of-operation/ (2026-09-06).
// This schedule is a conservative gate, never an override of broker tradeable.
function getForexMarketState(nowMs = Date.now()) {
    if (!Number.isFinite(nowMs)) return { open: false, reason: "INVALID_TIME" };
    const parts = Object.fromEntries(
        nyClock.formatToParts(new Date(nowMs)).map((part) => [part.type, part.value])
    );
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const weekend = parts.weekday === "Sat" ||
        (parts.weekday === "Sun" && minute < 17 * 60 + 5) ||
        (parts.weekday === "Fri" && minute >= 16 * 60 + 59);
    const dailyBreak = minute >= 16 * 60 + 59 && minute < 17 * 60 + 5;
    const open = !weekend && !dailyBreak;
    const minutesSinceReopen = (minute - (17 * 60 + 5) + 1440) % 1440;
    return {
        open,
        reason: weekend ? "WEEKEND" : dailyBreak ? "DAILY_BREAK" : null,
        // During an open trading session this is the most recent daily reopen.
        // DST switches on Sunday before the market reopens, so this subtraction
        // never crosses a clock transition in an open session.
        reopenedAt: open
            ? Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - minutesSinceReopen * MINUTE_MS
            : null,
    };
}

function expectedCompletedCandleClose(timeframe, nowMs, graceMs) {
    const periodMs = TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
    if (!periodMs || !Number.isFinite(nowMs)) return null;
    let close = Math.floor((nowMs - graceMs) / periodMs) * periodMs;
    // A weekend can span 49 hours at the autumn DST change. Ignore empty
    // scheduled slots while preserving the final partially traded Friday bar.
    for (let index = 0; index < (7 * 24 * 60) / TIMEFRAME_MINUTES[timeframe]; index++) {
        if (getForexMarketState(close - 2 * MINUTE_MS).open) return close;
        close -= periodMs;
    }
    return null;
}

function evaluateCandleFreshness(candles, timeframe, {
    nowMs = Date.now(),
    graceMs = CANDLE_PUBLICATION_GRACE_MS,
} = {}) {
    const periodMs = TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
    const publicationGraceMs = Number.isFinite(graceMs)
        ? Math.max(0, Math.min(CANDLE_PUBLICATION_GRACE_MS, graceMs))
        : CANDLE_PUBLICATION_GRACE_MS;
    const latest = Array.isArray(candles) ? candles[candles.length - 1] : null;
    const startedAt = Date.parse(latest?.time);
    const latestCloseAt = Number.isFinite(startedAt) && periodMs ? startedAt + periodMs : null;
    const expectedCloseAt = expectedCompletedCandleClose(timeframe, nowMs, publicationGraceMs);
    let code = null;
    if (!latest || !Number.isFinite(latestCloseAt) || expectedCloseAt === null) {
        code = "CANDLE_DATA_UNAVAILABLE";
    } else if (latest.complete === false || latestCloseAt > nowMs + 1000) {
        code = "CANDLE_NOT_COMPLETE";
    } else if (latestCloseAt < expectedCloseAt) {
        code = "STALE_COMPLETED_CANDLE";
    }
    return { fresh: code === null, code, timeframe, latestCloseAt, expectedCloseAt, graceMs: publicationGraceMs };
}

function evaluateIntradayEntryFreshness({ m15Candles, h1Candles, nowMs = Date.now() } = {}) {
    const market = getForexMarketState(nowMs);
    const timeframes = {
        "15m": evaluateCandleFreshness(m15Candles, "15m", { nowMs }),
        "1h": evaluateCandleFreshness(h1Candles, "1h", { nowMs }),
    };
    let code = !market.open ? "MARKET_CLOSED" : null;
    if (!code) code = Object.values(timeframes).find((result) => !result.fresh)?.code || null;
    // Before the first new M15 candle after a daily/weekend reopen, the latest
    // historical bar can be current for reporting but must not trigger entry.
    if (!code && timeframes["15m"].latestCloseAt <= market.reopenedAt) {
        code = "WAITING_FOR_POST_REOPEN_CANDLE";
    }
    return { fresh: code === null, code, checkedAt: nowMs, market, timeframes };
}

module.exports = {
    CANDLE_PUBLICATION_GRACE_MS,
    evaluateCandleFreshness,
    evaluateIntradayEntryFreshness,
    getForexMarketState,
};
