function wilsonInterval(successes, observations, z = 1.959963984540054) {
    if (!observations) return { lower: 0, upper: 1 };
    const probability = successes / observations;
    const denominator = 1 + z ** 2 / observations;
    const centre = probability + z ** 2 / (2 * observations);
    const margin =
        z *
        Math.sqrt(
            (probability * (1 - probability) + z ** 2 / (4 * observations)) /
                observations
        );
    return {
        lower: Math.max(0, (centre - margin) / denominator),
        upper: Math.min(1, (centre + margin) / denominator),
    };
}

function createPrng(seed = 0x5f3759df) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

function percentile(sorted, probability) {
    if (!sorted.length) return 0;
    const index = (sorted.length - 1) * probability;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function bootstrapMeanInterval(values = [], options = {}) {
    if (!values.length) return { lower: 0, upper: 0, samples: 0 };
    const samples = Math.max(100, Number(options.samples) || 2000);
    const confidence = Math.min(
        0.999,
        Math.max(0.5, Number(options.confidence) || 0.95)
    );
    const random = createPrng(Number(options.seed) || 0x5f3759df);
    const estimates = [];
    for (let sample = 0; sample < samples; sample += 1) {
        let total = 0;
        for (let index = 0; index < values.length; index += 1) {
            total += values[Math.floor(random() * values.length)];
        }
        estimates.push(total / values.length);
    }
    estimates.sort((left, right) => left - right);
    const tail = (1 - confidence) / 2;
    return {
        lower: percentile(estimates, tail),
        upper: percentile(estimates, 1 - tail),
        samples,
    };
}

module.exports = { bootstrapMeanInterval, wilsonInterval };
