'use strict';
// Research-only exact-input optimization. Mutable or incomplete evidence uses
// the full actual policy. No live source imports this module.
function createPolicyOptimization() {
const stamps = new WeakMap();
const stats = { calls: 0, lazyInitial: 0, lazyMaterialized: 0, trimmed: 0, retainedBars: 0, removedBars: 0, fallback: 0 };
const PERIOD = 900_000;
function validPrices(p) {
    return !!p && ['open', 'high', 'low', 'close'].every((key) => Number.isFinite(p[key]) && p[key] > 0) &&
        p.high >= Math.max(p.open, p.close, p.low) && p.low <= Math.min(p.open, p.close, p.high);
}
function ownData(object, keys) {
    if (!object || !Object.isFrozen(object)) return false;
    return keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        return descriptor && Object.hasOwn(descriptor, 'value');
    });
}
function stamp(bar) {
    if (!bar || typeof bar !== 'object') return null;
    if (stamps.has(bar)) return stamps.get(bar);
    if (!ownData(bar, ['time', 'complete', 'open', 'high', 'low', 'close', 'bid', 'ask'])) return null;
    const start = typeof bar.time === 'number' ? bar.time : Date.parse(bar.time);
    const sideStable = (side) => side == null || ownData(side, ['open', 'high', 'low', 'close']);
    if (!sideStable(bar.bid) || !sideStable(bar.ask)) return null;
    const value = { start, valid: Number.isFinite(start) && bar.complete !== false && validPrices(bar),
        bid: validPrices(bar.bid), ask: validPrices(bar.ask) };
    stamps.set(bar, value);
    return value;
}
function immutableInitial(args) {
    if (!Array.isArray(args.candles) || !Number.isFinite(args.nowMs) || typeof args.instrument !== 'string') return false;
    // A deferred unused fallback must see the same evidence as eager execution.
    // Snapshot array membership below; cached immutable rows have only data
    // properties, including frozen optional side components. Mutable evidence
    // is evaluated eagerly and cannot hide recovery or invalidation.
    return args.candles.every((bar) => stamp(bar) !== null);
}
function validState(state, args, side, count) {
    if (state?.version !== 1 || state.instrument !== args.instrument || state.breakoutBars !== count ||
        !Number.isFinite(state.lastProcessedCandleCloseTime) || state.lastProcessedCandleCloseTime > args.nowMs ||
        state[side === 'BUY' ? 'bidEvidenceAvailable' : 'askEvidenceAvailable'] !== true ||
        (side === 'BUY' && typeof state.consumed !== 'boolean')) return false;
    const { breakout, retest, confirmation, lastProcessedCandleCloseTime: cursor } = state;
    const start = (bar) => typeof bar?.time === 'number' ? bar.time : Date.parse(bar?.time);
    if (!breakout) return !retest && !confirmation && (side !== 'BUY' || !state.consumed);
    if (!(Number.isFinite(breakout.level) && breakout.level > 0 && start(breakout) + PERIOD === breakout.closedAt && breakout.closedAt <= cursor)) return false;
    if (!retest) return !confirmation;
    const limit = side === 'BUY' ? retest.high : retest.low;
    const liquidation = side === 'BUY' ? retest.bidLow : retest.askHigh;
    if (!(Number.isFinite(limit) && limit > 0 && Number.isFinite(liquidation) && liquidation > 0 &&
        start(retest) + PERIOD === retest.closedAt && retest.closedAt > breakout.closedAt &&
        retest.closedAt <= cursor && Number.isFinite(Date.parse(retest.firstTime)))) return false;
    return !confirmation || start(confirmation) + PERIOD === confirmation.closedAt &&
        confirmation.closedAt > retest.closedAt && confirmation.closedAt === cursor;
}
function redundantPrefix(args, side) {
    const count = Math.max(2, Math.floor(Number(args.breakoutBars) || 8));
    if (!Array.isArray(args.candles) || !Number.isFinite(args.nowMs) || !validState(args.priorState, args, side, count)) return null;
    let previous = -Infinity, cursor = -1;
    for (let index = 0; index < args.candles.length; index++) {
        const item = stamp(args.candles[index]);
        if (!item?.valid || !item[side === 'BUY' ? 'bid' : 'ask'] || item.start <= previous || item.start + PERIOD > args.nowMs) return null;
        previous = item.start;
        if (item.start + PERIOD === args.priorState.lastProcessedCandleCloseTime) cursor = index;
    }
    if (cursor < 0) return null;
    const begin = Math.max(0, cursor - count + 1);
    return begin > 0 ? args.candles.slice(begin) : null;
}
function lazyActual(fn, args) {
    stats.lazyInitial++;
    args = { ...args, candles: args.candles.slice(),
        ...(Array.isArray(args.consumedEpisodeIds) ? { consumedEpisodeIds: args.consumedEpisodeIds.slice() } : {}),
        ...(Array.isArray(args.consumedPatternIds) ? { consumedPatternIds: args.consumedPatternIds.slice() } : {}) };
    let result;
    const get = () => {
        if (!result) { stats.lazyMaterialized++; result = fn(args); }
        return result;
    };
    return new Proxy({}, {
        get: (_target, key) => Reflect.get(get(), key),
        has: (_target, key) => Reflect.has(get(), key),
        ownKeys: () => Reflect.ownKeys(get()),
        getOwnPropertyDescriptor: (_target, key) => Object.getOwnPropertyDescriptor(get(), key),
        getPrototypeOf: () => Object.getPrototypeOf(get()),
        set: (_target, key, value) => Reflect.set(get(), key, value),
        deleteProperty: (_target, key) => Reflect.deleteProperty(get(), key),
        defineProperty: (_target, key, descriptor) => Reflect.defineProperty(get(), key, descriptor),
    });
}
function wrap(fn, side) {
    return (args) => {
        stats.calls++;
        if (args && typeof args === 'object' && Object.hasOwn(args, 'historyAvailable') && Object.hasOwn(args, 'trades') &&
            !Object.hasOwn(args, 'priorState') && immutableInitial(args)) return lazyActual(fn, args);
        const candles = args && redundantPrefix(args, side);
        if (candles) {
            stats.trimmed++; stats.retainedBars += candles.length; stats.removedBars += args.candles.length - candles.length;
            return fn({ ...args, candles });
        }
        stats.fallback++;
        return fn(args);
    };
}
return { wrap, getStats: () => ({ ...stats }) };
}
module.exports = { createPolicyOptimization };
