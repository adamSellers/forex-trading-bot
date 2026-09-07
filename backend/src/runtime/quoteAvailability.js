// OANDA event time identifies a price; validated receipt time bounds its use.
// Neither an unchanged event nor reading a cached quote creates a new event.
function validTime(value, nowMs) {
    return Number.isFinite(value) && value > 0 && value <= nowMs + 1000;
}

function normalizeOandaPrice(raw, { instrument, fetchedAt }) {
    const matches = raw?.instrument === instrument;
    const bid = Number(raw?.bids?.[0]?.price);
    const ask = Number(raw?.asks?.[0]?.price);
    const numericTime = raw?.time === null || raw?.time === undefined || raw?.time === ""
        ? NaN : Number(raw.time);
    // OANDA supports ISO and decimal UNIX seconds (the client's requested format).
    const timestamp = Number.isFinite(numericTime)
        ? (numericTime < 100000000000 ? Math.round(numericTime * 1000) : numericTime)
        : Date.parse(raw?.time);
    const validQuote = matches && Number.isFinite(bid) && bid > 0 &&
        Number.isFinite(ask) && ask >= bid;
    const invalidReason = !matches ? "PRICE_MISSING"
        : !validQuote ? "INVALID_BID_ASK"
        : !validTime(timestamp, fetchedAt) ? "INVALID_BROKER_TIME"
        : typeof raw.tradeable !== "boolean" ? "INVALID_TRADEABILITY"
        : !validTime(fetchedAt, fetchedAt) ? "MISSING_RECEIPT_TIME" : null;
    const mid = validQuote ? (bid + ask) / 2 : null;
    return {
        instrument,
        bid: validQuote ? bid : null,
        ask: validQuote ? ask : null,
        mid,
        price: mid,
        spread: validQuote ? (ask - bid) / (instrument.includes("JPY") ? 0.01 : 0.0001) : null,
        tradeable: !invalidReason && raw.tradeable === true,
        time: raw?.time ?? null,
        timestamp: validTime(timestamp, fetchedAt) ? timestamp : null,
        fetchedAt: invalidReason ? null : fetchedAt,
        invalidReason,
    };
}

function evaluatePriceAvailability(price, { nowMs = Date.now(), maxAgeMs, requireTradeable = true }) {
    const receiptAgeMs = validTime(price?.fetchedAt, nowMs)
        ? Math.max(0, nowMs - price.fetchedAt) : null;
    const eventAgeMs = validTime(price?.timestamp, nowMs)
        ? Math.max(0, nowMs - price.timestamp) : null;
    const validQuote = Number.isFinite(price?.bid) && price.bid > 0 &&
        Number.isFinite(price?.ask) && price.ask >= price.bid;
    const reason = !price ? "PRICE_MISSING"
        : price.invalidReason || (!validQuote ? "INVALID_BID_ASK"
        : eventAgeMs === null ? "INVALID_BROKER_TIME"
        : receiptAgeMs === null ? "MISSING_RECEIPT_TIME"
        : receiptAgeMs > maxAgeMs ? "STALE_PRICE"
        : typeof price.tradeable !== "boolean" ? "INVALID_TRADEABILITY"
        : requireTradeable && !price.tradeable ? "PRICE_NOT_TRADEABLE" : null);
    return { available: reason === null, reason, receiptAgeMs, eventAgeMs };
}

module.exports = { normalizeOandaPrice, evaluatePriceAvailability };
