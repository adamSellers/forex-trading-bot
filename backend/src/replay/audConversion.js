const {
    ACCOUNT_CURRENCY,
    AudCurrencyConverter,
    getInstrumentCurrencies,
} = require("../runtime/currencyConversion");

function splitInstrument(instrument) {
    return getInstrumentCurrencies(instrument);
}

/**
 * Resolve the number of AUD represented by one unit of currency.
 *
 * prices is a Map/object of instrument -> mid price at the valuation timestamp.
 * Conversion is deliberately fail-closed: silently treating an unavailable
 * conversion as 1 was a material source of false paper P&L and position sizing.
 */
function resolveCurrencyToAud(currency, prices = {}, options = {}) {
    const normalized = String(currency || "").toUpperCase();
    const readPrice = (instrument) =>
        prices instanceof Map ? prices.get(instrument) : prices[instrument];
    const converter = new AudCurrencyConverter({
        maxAgeMs: 0,
        now: () => options.timestamp || Date.now(),
        priceProvider: readPrice,
        homeConversionProvider:
            typeof options.rateProvider === "function"
                ? (fromCurrency) =>
                      options.rateProvider(
                          fromCurrency,
                          ACCOUNT_CURRENCY,
                          options.timestamp
                      )
                : null,
    });
    try {
        return converter.getRate(normalized, ACCOUNT_CURRENCY, {
            purpose: options.purpose || "neutral",
        });
    } catch (error) {
        error.message = `AUD conversion unavailable for ${normalized} at ${
            options.timestamp || "unknown time"
        }: ${error.message}`;
        throw error;
    }
}

function resolveQuoteToAud(instrument, prices, options = {}) {
    const { quoteCurrency } = splitInstrument(instrument);
    return resolveCurrencyToAud(quoteCurrency, prices, options);
}

module.exports = {
    splitInstrument,
    resolveCurrencyToAud,
    resolveQuoteToAud,
};
