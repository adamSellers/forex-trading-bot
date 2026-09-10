// Subtracting nearby broker prices magnifies binary representation error when
// expressed in pips. Bound that error from the operands, not a trading allowance.
function priceDistanceError(left, right, pipValue) {
    if (![left, right, pipValue].every(Number.isFinite) || pipValue <= 0) return 0;
    const error = (Number.EPSILON * Math.abs(left) + Number.EPSILON * Math.abs(right)) / pipValue;
    return Number.isFinite(error) ? error : 0;
}

function exceedsQuoteLimit(value, limit, inheritedError = 0) {
    if (!Number.isFinite(value) || !Number.isFinite(limit)) return value > limit;
    const comparisonError = Number.EPSILON * Math.abs(value) + Number.EPSILON * Math.abs(limit);
    const error = Number.isFinite(inheritedError) && inheritedError >= 0 ? inheritedError : 0;
    return value - limit > error + comparisonError;
}

module.exports = { priceDistanceError, exceedsQuoteLimit };
