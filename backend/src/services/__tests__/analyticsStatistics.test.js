const { bootstrapMeanInterval, wilsonInterval } = require('../analyticsStatistics');

describe('empirical bootstrap availability', () => {
    test.each([
        [[], 'EMPTY_SAMPLE'],
        [[-0.1787], 'SINGLE_OBSERVATION'],
        [[0, 0, 0], 'NO_OBSERVED_VARIATION'],
        [[-1, -1], 'NO_OBSERVED_VARIATION'],
    ])('does not infer certainty from %j', (values, status) => {
        const result = bootstrapMeanInterval(values, { samples: 500 });
        expect(result).toMatchObject({ lower: null, upper: null, samples: 0,
            observations: values.length, status, method: 'iid_empirical_percentile_bootstrap' });
        expect(result.reason).toEqual(expect.any(String));
    });

    test('retains deterministic finite intervals for a diverse empirical distribution', () => {
        const options = { samples: 500, seed: 0x41d5 };
        const result = bootstrapMeanInterval([-1, 1], options);
        // The two-draw empirical means are -1, 0 and +1. Both tails
        // contain more than 2.5% probability under resampling.
        expect(result).toEqual({ lower: -1, upper: 1, samples: 500, observations: 2,
            status: 'AVAILABLE', reason: null, method: 'iid_empirical_percentile_bootstrap' });
        expect(bootstrapMeanInterval([-1, 1], options)).toEqual(result);
    });

    test('singleton bootstrap unavailability does not change Wilson win-rate uncertainty', () => {
        expect(wilsonInterval(0, 1).lower).toBe(0);
        expect(wilsonInterval(0, 1).upper).toBeCloseTo(0.79345, 4);
    });
});
