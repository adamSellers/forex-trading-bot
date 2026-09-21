// Quote event times and broker close times share the broker's millisecond time
// domain. Receipt time decides quote availability elsewhere; it is not an
// observation timestamp. Keep observations reversible until closure is known.
function aggregate(samples) {
    let maxFavorablePips = 0;
    let maxAdversePips = 0;
    let maxFavorableR = null;
    let maxAdverseR = null;
    for (const [, pips, r] of samples) {
        maxFavorablePips = Math.max(maxFavorablePips, pips);
        maxAdversePips = Math.max(maxAdversePips, -pips);
        if (Number.isFinite(r)) {
            maxFavorableR = Math.max(maxFavorableR ?? 0, r);
            maxAdverseR = Math.max(maxAdverseR ?? 0, -r);
        }
    }
    return {
        maxFavorablePips, maxAdversePips, maxFavorableR, maxAdverseR,
        observations: samples.length,
        firstObservedAt: samples[0]?.[0] ?? null,
        lastObservedAt: samples.at(-1)?.[0] ?? null,
    };
}

function hasReversibleSamples(sample) {
    return sample?.version === 2 && Array.isArray(sample.samples) &&
        sample.samples.every((point, index, points) =>
            Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
            (point[2] === null || Number.isFinite(point[2])) &&
            (index === 0 || point[0] > points[index - 1][0]));
}

function appendExcursionSample(prior, { observedAt, pips, r }) {
    if (prior?.lastObservedAt >= observedAt) return prior;
    const reversible = hasReversibleSamples(prior);
    const legacyAggregate = reversible ? prior.legacyAggregate : prior;
    const samples = [...(reversible ? prior.samples : []), [observedAt, pips, r]];
    return {
        version: 2,
        method: "EXECUTABLE_QUOTE_POLL",
        lifetimeStatus: "PROVISIONAL",
        // Do not mix unrecoverable v1 extrema into the corrected series. An
        // upgraded open trade retains them verbatim and has partial coverage.
        ...(legacyAggregate ? { legacyAggregate } : {}),
        ...aggregate(samples),
        samples,
    };
}

function finalizeSampledExcursion(prior, { entryTime, confirmedBrokerClosedAt }) {
    if (!prior) return null;
    const validCloseTime = Number.isFinite(confirmedBrokerClosedAt) &&
        Number.isFinite(entryTime) && confirmedBrokerClosedAt >= entryTime;
    if (!hasReversibleSamples(prior)) {
        return { ...prior, lifetimeStatus: prior.version === 2 ? "UNVERIFIED_HISTORY" : "LEGACY_UNVERIFIED" };
    }
    if (!validCloseTime) {
        // The accounting path can use its existing timestamp fallback. That
        // fallback cannot establish a measurement's position lifetime.
        return { ...prior, lifetimeStatus: "UNVERIFIED_CLOSE_TIME" };
    }
    const samples = prior.samples.filter(([at]) => at >= entryTime && at <= confirmedBrokerClosedAt);
    return {
        ...prior,
        ...aggregate(samples),
        samples,
        lifetimeStatus: "VERIFIED",
        confirmedBrokerClosedAt,
        excludedAfterClose: prior.samples.filter(([at]) => at > confirmedBrokerClosedAt).length,
    };
}

module.exports = { appendExcursionSample, finalizeSampledExcursion };
