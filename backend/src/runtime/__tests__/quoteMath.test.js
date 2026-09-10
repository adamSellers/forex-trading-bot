const { priceDistanceError, exceedsQuoteLimit } = require('../quoteMath');

describe('quote limit roundoff', () => {
    test.each([
        [1.30002, 1.30014, 0.0001],
        [153.300, 153.312, 0.01],
    ])('preserves real differences much smaller than a broker tick: %s → %s', (bid, ask, pip) => {
        const spread = (ask - bid) / pip;
        const error = priceDistanceError(bid, ask, pip);
        expect(exceedsQuoteLimit(spread, 1.2, error)).toBe(false);
        expect(exceedsQuoteLimit(spread + 0.000001, 1.2, error)).toBe(true);
    });

    test.each([undefined, NaN, Infinity, -Infinity])('invalid price %s cannot grant a tolerance', (invalid) => {
        expect(priceDistanceError(invalid, 1.3, 0.0001)).toBe(0);
        expect(exceedsQuoteLimit(1.3, 1.2, invalid)).toBe(true);
    });

    test('an infinite distance remains above a finite limit', () => {
        expect(exceedsQuoteLimit(Infinity, 1.2)).toBe(true);
    });
});
