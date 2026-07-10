const ACCOUNT_CURRENCY = "AUD";
const DEFAULT_RATE_MAX_AGE_MS = 30_000;

class CurrencyConversionError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = "CurrencyConversionError";
        this.code = "CURRENCY_CONVERSION_UNAVAILABLE";
        this.context = context;
    }
}

function normalizeCurrency(value) {
    return String(value || "").trim().toUpperCase();
}

function toPositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getInstrumentCurrencies(instrument) {
    const [baseCurrency, quoteCurrency, ...remainder] = String(instrument || "")
        .trim()
        .toUpperCase()
        .split("_");

    if (!baseCurrency || !quoteCurrency || remainder.length > 0) {
        throw new CurrencyConversionError(`Invalid instrument: ${instrument}`, {
            instrument,
        });
    }

    return { baseCurrency, quoteCurrency };
}

function normalizePriceData(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "string") {
        const rate = toPositiveNumber(value);
        return rate ? { rate, timestamp: null } : null;
    }

    const bid = toPositiveNumber(value.bid ?? value.closeoutBid);
    const ask = toPositiveNumber(value.ask ?? value.closeoutAsk);
    const rate =
        toPositiveNumber(value.price ?? value.mid ?? value.rate) ||
        (bid && ask ? (bid + ask) / 2 : bid || ask);

    return rate
        ? {
              rate,
              timestamp:
                  Number.isFinite(Number(value.timestamp))
                      ? Number(value.timestamp)
                      : null,
          }
        : null;
}

function selectHomeRate(record, { purpose = "neutral", amount = 0 } = {}) {
    if (!record) return null;

    const accountGain = toPositiveNumber(record.accountGain);
    const accountLoss = toPositiveNumber(record.accountLoss);
    const positionValue = toPositiveNumber(record.positionValue);
    const neutral = toPositiveNumber(
        record.rate ?? record.conversionRate ?? record.mid
    );

    if (purpose === "position" || purpose === "margin") {
        return positionValue || neutral || accountLoss || accountGain;
    }
    if (purpose === "pnl" && Number(amount) < 0) {
        return accountLoss || neutral || positionValue || accountGain;
    }
    if (purpose === "pnl" && Number(amount) > 0) {
        return accountGain || neutral || positionValue || accountLoss;
    }

    if (neutral) return neutral;
    if (accountGain && accountLoss) return (accountGain + accountLoss) / 2;
    return positionValue || accountLoss || accountGain;
}

/**
 * Strict synchronous currency converter for the canonical AUD account.
 *
 * OANDA `homeConversions` can be seeded through `seedHomeConversions`; a
 * provider may also return a conversion record on demand. If neither a fresh
 * home conversion nor a price path exists, conversion throws. It never assumes
 * a 1:1 rate for different currencies.
 */
class AudCurrencyConverter {
    constructor(options = {}) {
        this.accountCurrency = ACCOUNT_CURRENCY;
        this.priceProvider = options.priceProvider || null;
        this.homeConversionProvider = options.homeConversionProvider || null;
        this.maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
            ? Math.max(0, Number(options.maxAgeMs))
            : DEFAULT_RATE_MAX_AGE_MS;
        this.now = options.now || (() => Date.now());
        this.homeConversions = new Map();
        this.rateCache = new Map();

        if (options.homeConversions) {
            this.seedHomeConversions(options.homeConversions);
        }
    }

    setPriceProvider(provider) {
        this.priceProvider = provider || null;
        return this;
    }

    setHomeConversionProvider(provider) {
        this.homeConversionProvider = provider || null;
        return this;
    }

    isFresh(timestamp) {
        if (!Number.isFinite(Number(timestamp)) || this.maxAgeMs === 0) {
            return true;
        }
        return this.now() - Number(timestamp) <= this.maxAgeMs;
    }

    seedHomeConversions(payload, updatedAt = this.now()) {
        const entries = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.homeConversions)
              ? payload.homeConversions
              : Object.entries(payload || {}).map(([currency, value]) =>
                    typeof value === "object" && value !== null
                        ? { currency, ...value }
                        : { currency, rate: value }
                );

        for (const entry of entries) {
            const currency = normalizeCurrency(
                entry?.currency ?? entry?.fromCurrency
            );
            if (!currency) continue;
            if (!selectHomeRate(entry)) continue;

            this.homeConversions.set(currency, {
                ...entry,
                currency,
                updatedAt:
                    Number.isFinite(Number(entry.updatedAt))
                        ? Number(entry.updatedAt)
                        : updatedAt,
            });
        }

        return this;
    }

    getProviderHomeConversion(currency, options = {}) {
        if (!this.homeConversionProvider) return null;

        const provided = this.homeConversionProvider(currency, {
            ...options,
            accountCurrency: ACCOUNT_CURRENCY,
        });
        if (provided && typeof provided.then === "function") {
            throw new CurrencyConversionError(
                "Asynchronous home-conversion provider used in synchronous execution policy",
                { currency }
            );
        }
        if (provided === null || provided === undefined) return null;

        const record =
            typeof provided === "object"
                ? { currency, ...provided }
                : { currency, rate: provided };
        if (!selectHomeRate(record, options)) return null;
        this.seedHomeConversions([record]);
        return record;
    }

    getHomeRate(currency, options = {}) {
        const normalized = normalizeCurrency(currency);
        if (normalized === ACCOUNT_CURRENCY) return 1;

        let record = this.homeConversions.get(normalized) || null;
        if (!record || !this.isFresh(record.updatedAt)) {
            record = this.getProviderHomeConversion(normalized, options);
        }
        if (!record || !this.isFresh(record.updatedAt)) return null;
        return selectHomeRate(record, options);
    }

    cacheRate(fromCurrency, toCurrency, rate, timestamp = this.now()) {
        const from = normalizeCurrency(fromCurrency);
        const to = normalizeCurrency(toCurrency);
        const normalizedRate = toPositiveNumber(rate);
        if (!from || !to || !normalizedRate) return;

        this.rateCache.set(`${from}->${to}`, {
            rate: normalizedRate,
            updatedAt: timestamp,
        });
        this.rateCache.set(`${to}->${from}`, {
            rate: 1 / normalizedRate,
            updatedAt: timestamp,
        });
    }

    getCachedRate(fromCurrency, toCurrency) {
        const cached = this.rateCache.get(
            `${normalizeCurrency(fromCurrency)}->${normalizeCurrency(toCurrency)}`
        );
        return cached && this.isFresh(cached.updatedAt) ? cached.rate : null;
    }

    getPriceRate(instrument) {
        if (!this.priceProvider) return null;
        const normalized = String(instrument || "").toUpperCase();
        const priceData = normalizePriceData(this.priceProvider(normalized));
        if (!priceData || !this.isFresh(priceData.timestamp)) return null;

        const { baseCurrency, quoteCurrency } =
            getInstrumentCurrencies(normalized);
        this.cacheRate(
            baseCurrency,
            quoteCurrency,
            priceData.rate,
            priceData.timestamp || this.now()
        );
        return priceData.rate;
    }

    getDirectRate(fromCurrency, toCurrency, options = {}) {
        const from = normalizeCurrency(fromCurrency);
        const to = normalizeCurrency(toCurrency);
        const instrument = String(options.instrument || "").toUpperCase();
        const referencePrice = toPositiveNumber(options.price);

        if (instrument === `${from}_${to}` && referencePrice) {
            this.cacheRate(from, to, referencePrice);
            return referencePrice;
        }
        if (instrument === `${to}_${from}` && referencePrice) {
            this.cacheRate(from, to, 1 / referencePrice);
            return 1 / referencePrice;
        }

        const cached = this.getCachedRate(from, to);
        if (cached) return cached;

        const direct = this.getPriceRate(`${from}_${to}`);
        if (direct) return direct;
        const inverse = this.getPriceRate(`${to}_${from}`);
        return inverse ? 1 / inverse : null;
    }

    getRate(fromCurrency, toCurrency = ACCOUNT_CURRENCY, options = {}) {
        const from = normalizeCurrency(fromCurrency);
        const to = normalizeCurrency(toCurrency);
        if (!from || !to) {
            throw new CurrencyConversionError("Missing currency for conversion", {
                fromCurrency,
                toCurrency,
            });
        }
        if (from === to) return 1;

        if (to === ACCOUNT_CURRENCY) {
            const homeRate = this.getHomeRate(from, options);
            if (homeRate) {
                this.cacheRate(
                    from,
                    to,
                    homeRate,
                    this.homeConversions.get(from)?.updatedAt || this.now()
                );
                return homeRate;
            }
        }
        if (from === ACCOUNT_CURRENCY) {
            const homeRate = this.getHomeRate(to, options);
            if (homeRate) {
                this.cacheRate(
                    from,
                    to,
                    1 / homeRate,
                    this.homeConversions.get(to)?.updatedAt || this.now()
                );
                return 1 / homeRate;
            }
        }

        const direct = this.getDirectRate(from, to, options);
        if (direct) return direct;

        const path = options.path instanceof Set ? options.path : new Set();
        if (path.has(from)) {
            throw new CurrencyConversionError(
                `Unable to convert ${from} to ${to}`,
                { fromCurrency: from, toCurrency: to }
            );
        }
        const nextPath = new Set(path);
        nextPath.add(from);

        for (const bridge of ["AUD", "USD", "EUR", "GBP", "JPY"]) {
            if (bridge === from || bridge === to || nextPath.has(bridge)) {
                continue;
            }

            try {
                const first = this.getDirectRate(from, bridge, options);
                if (!first) continue;
                const second = this.getRate(bridge, to, {
                    ...options,
                    instrument: null,
                    price: null,
                    path: nextPath,
                });
                const bridgedRate = first * second;
                if (toPositiveNumber(bridgedRate)) {
                    return bridgedRate;
                }
            } catch (error) {
                if (!(error instanceof CurrencyConversionError)) throw error;
            }
        }

        throw new CurrencyConversionError(`Unable to convert ${from} to ${to}`, {
            fromCurrency: from,
            toCurrency: to,
            instrument: options.instrument || null,
        });
    }

    getQuoteToAccountRate(instrument, options = {}) {
        const { quoteCurrency } = getInstrumentCurrencies(instrument);
        return this.getRate(quoteCurrency, ACCOUNT_CURRENCY, {
            ...options,
            instrument,
        });
    }

    getBaseToAccountRate(instrument, options = {}) {
        const { baseCurrency } = getInstrumentCurrencies(instrument);
        return this.getRate(baseCurrency, ACCOUNT_CURRENCY, {
            ...options,
            instrument,
            purpose: options.purpose || "position",
        });
    }
}

module.exports = {
    ACCOUNT_CURRENCY,
    DEFAULT_RATE_MAX_AGE_MS,
    AudCurrencyConverter,
    CurrencyConversionError,
    getInstrumentCurrencies,
    normalizeCurrency,
};
