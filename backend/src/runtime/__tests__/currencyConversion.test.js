const {
    ACCOUNT_CURRENCY,
    AudCurrencyConverter,
    CurrencyConversionError,
} = require("../currencyConversion");
const price = (value, fetchedAt = Date.now(), extra = {}) => ({
    price: value, bid: value, ask: value, tradeable: true,
    timestamp: fetchedAt - 60_000, fetchedAt, ...extra,
});

describe("AudCurrencyConverter", () => {
    test("uses AUD as the canonical account currency", () => {
        expect(ACCOUNT_CURRENCY).toBe("AUD");
        const converter = new AudCurrencyConverter();
        expect(converter.getRate("AUD", "AUD")).toBe(1);
    });

    test("uses purpose-aware OANDA home conversion factors", () => {
        const converter = new AudCurrencyConverter({
            homeConversions: [
                {
                    currency: "USD",
                    accountGain: "1.51",
                    accountLoss: "1.53",
                    positionValue: "1.52",
                },
            ],
        });

        expect(
            converter.getRate("USD", "AUD", { purpose: "pnl", amount: 10 })
        ).toBe(1.51);
        expect(
            converter.getRate("USD", "AUD", { purpose: "pnl", amount: -10 })
        ).toBe(1.53);
        expect(
            converter.getRate("USD", "AUD", { purpose: "margin" })
        ).toBe(1.52);
    });

    test("converts JPY to AUD through current USD_JPY and AUD_USD prices", () => {
        const prices = {
            USD_JPY: price(150),
            AUD_USD: price(0.65),
        };
        const converter = new AudCurrencyConverter({
            priceProvider: (instrument) => prices[instrument] || null,
        });

        expect(converter.getRate("JPY", "AUD")).toBeCloseTo(
            (1 / 150) * (1 / 0.65),
            10
        );
    });

    test("fails closed when no fresh conversion path exists", () => {
        const converter = new AudCurrencyConverter({
            priceProvider: () => null,
        });

        expect(() => converter.getRate("CHF", "AUD")).toThrow(
            CurrencyConversionError
        );
        expect(() => converter.getRate("CHF", "AUD")).toThrow(
            "Unable to convert CHF to AUD"
        );
    });

    test("rejects stale cached price data", () => {
        const converter = new AudCurrencyConverter({
            maxAgeMs: 1_000,
            now: () => 10_000,
            priceProvider: (instrument) =>
                instrument === "AUD_USD"
                    ? price(0.65, 1_000, { timestamp: 1_000 })
                    : null,
        });

        expect(() => converter.getRate("USD", "AUD")).toThrow(
            CurrencyConversionError
        );
    });

    test("does not extend a home conversion's lifetime when it is read", () => {
        let now = 1_500;
        const converter = new AudCurrencyConverter({
            maxAgeMs: 1_000,
            now: () => now,
        });
        converter.seedHomeConversions(
            [{ currency: "USD", positionValue: 1.52, updatedAt: 1_000 }],
            1_000
        );
        expect(converter.getRate("USD", "AUD")).toBe(1.52);

        now = 2_001;
        expect(() => converter.getRate("USD", "AUD")).toThrow(
            CurrencyConversionError
        );
    });

    test("price conversions retain receipt age across repeated reads", () => {
        let now = 100_000;
        const converter = new AudCurrencyConverter({
            maxAgeMs: 1_000, now: () => now,
            priceProvider: (instrument) => instrument === "AUD_USD" ? price(0.65, 100_000) : null,
        });
        expect(converter.getRate("USD", "AUD")).toBeCloseTo(1 / 0.65);
        now += 900;
        expect(converter.getRate("USD", "AUD")).toBeCloseTo(1 / 0.65);
        now += 101;
        expect(() => converter.getRate("USD", "AUD")).toThrow(CurrencyConversionError);
    });

    test.each([undefined, null, 1_000, 200_000])("reading a provider cannot fabricate fresh home-conversion timing: %s", (updatedAt) => {
        const converter = new AudCurrencyConverter({
            now: () => 100_000,
            homeConversionProvider: () => ({ currency: "USD", positionValue: 1.52, updatedAt }),
        });
        expect(() => converter.getRate("USD", "AUD")).toThrow(CurrencyConversionError);
        expect(() => converter.getRate("USD", "AUD")).toThrow(CurrencyConversionError);
        expect(converter.homeConversions.size).toBe(0);
    });

    test("a validated provider home conversion keeps its original receipt on every read", () => {
        let now = 100_000;
        const converter = new AudCurrencyConverter({
            now: () => now,
            homeConversionProvider: () => ({ currency: "USD", positionValue: 1.52, updatedAt: 100_000 }),
        });
        expect(converter.getRate("USD", "AUD")).toBe(1.52);
        now += 30_001;
        expect(() => converter.getRate("USD", "AUD")).toThrow(CurrencyConversionError);
    });

    test.each([
        { invalidReason: "PRICE_REQUEST_FAILED" }, { tradeable: false },
        { fetchedAt: null }, { fetchedAt: undefined }, { ask: 0.64 },
    ])("a new unavailable provider quote cannot use an earlier cached rate: %j", (extra) => {
        let observation = price(0.65);
        const converter = new AudCurrencyConverter({
            priceProvider: (instrument) => instrument === "AUD_USD" ? observation : null,
        });
        expect(converter.getRate("USD", "AUD")).toBeCloseTo(1 / 0.65);
        observation = { ...observation, ...extra };
        expect(() => converter.getRate("USD", "AUD", { instrument: "AUD_USD", price: 0.65 }))
            .toThrow(CurrencyConversionError);
    });
});
