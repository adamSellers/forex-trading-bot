'use strict';

// Offline input adapter, not a broker or a source of exact historical fills.
// Input times are UNIX seconds at interval START. The clock is milliseconds.
const M15_SECONDS = 900;
const H1_SECONDS = 3600;
const KEYS = ['open', 'high', 'low', 'close'];
const SHORT_KEYS = ['o', 'h', 'l', 'c'];
const QUOTE_ASSUMPTION = 'COARSE_M15_COMPONENT_CLOSE';
const CONVERSION_ASSUMPTION = 'COARSE_M15_COMPONENT_CLOSE_DERIVATION';

function positiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function priceValues(component, label) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
        throw new TypeError(`${label}: OHLC must be an object`);
    }
    const hasLong = KEYS.some((key) => Object.hasOwn(component, key));
    const values = (hasLong ? KEYS : SHORT_KEYS).map((key) => component[key]);
    if (!values.every(positiveNumber)) {
        throw new TypeError(`${label}: OHLC must contain positive finite numbers`);
    }
    const [open, high, low, close] = values;
    if (low > high || open < low || open > high || close < low || close > high) {
        throw new RangeError(`${label}: inconsistent OHLC bounds`);
    }
    return values;
}

function normalizeComponent(component, label) {
    const values = priceValues(component, label);
    return Object.freeze(Object.fromEntries(KEYS.map((key, i) => [key, values[i]])));
}

function intervalStartSeconds(value, interval, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new TypeError(`${label}: time must be integer UNIX seconds`);
    }
    // A millisecond timestamp for an ordinary modern date produces an extended
    // ISO year. Reject it rather than silently guessing different time units.
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) {
        throw new RangeError(`${label}: UNIX seconds must represent a four-digit ISO year`);
    }
    if (value % interval !== 0) throw new RangeError(`${label}: interval start is not UTC-grid aligned`);
    return value;
}

function validateInput(bars, instrument, interval) {
    if (!Array.isArray(bars)) throw new TypeError(`${instrument}: candles must be an array`);
    const completion = { complete: 0, incomplete: 0, unobserved: 0 };
    const components = { mid: 0, bid: 0, ask: 0 };
    let previous = null;
    let absentGridSlots = 0;
    for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index];
        const label = `${instrument}[${index}]`;
        if (!bar || typeof bar !== 'object' || Array.isArray(bar)) throw new TypeError(`${label}: invalid candle`);
        const start = intervalStartSeconds(bar.time, interval, label);
        if (previous !== null) {
            if (start <= previous) throw new RangeError(`${label}: times must be strictly increasing`);
            absentGridSlots += (start - previous) / interval - 1;
        }
        previous = start;
        const hasPrimary = KEYS.some((key) => Object.hasOwn(bar, key));
        const primary = hasPrimary ? priceValues(bar, label) : null;
        const midpoint = bar.mid != null ? priceValues(bar.mid, `${label}.mid`) : primary;
        if (!midpoint) throw new TypeError(`${label}: midpoint OHLC is required`);
        if (primary && primary.some((value, i) => value !== midpoint[i])) {
            throw new RangeError(`${label}: primary OHLC differs from supplied midpoint OHLC`);
        }
        components.mid += 1;
        for (const side of ['bid', 'ask']) {
            if (bar[side] != null) {
                priceValues(bar[side], `${label}.${side}`);
                components[side] += 1;
            }
        }
        completion[bar.complete === true ? 'complete' : bar.complete === false ? 'incomplete' : 'unobserved'] += 1;
    }
    return {
        inputBars: bars.length, completionEvidence: completion, componentEvidence: components,
        absentGridSlotsBetweenObservedBars: absentGridSlots,
        firstIntervalStartSeconds: bars[0]?.time ?? null,
        lastIntervalStartSeconds: bars.at(-1)?.time ?? null,
    };
}

function normalizeBar(bar, instrument, interval, source) {
    const mid = normalizeComponent(bar.mid ?? bar, `${instrument}.mid`);
    return Object.freeze({
        time: new Date(bar.time * 1000).toISOString(), ...mid,
        mid, bid: bar.bid != null ? normalizeComponent(bar.bid, `${instrument}.bid`) : null,
        ask: bar.ask != null ? normalizeComponent(bar.ask, `${instrument}.ask`) : null,
        volume: Number.isFinite(bar.volume) ? bar.volume : null,
        complete: true, completionEvidence: bar.complete === true ? 'EXPLICIT_PER_BAR' : 'DECLARED_COMPLETED_ONLY_ARCHIVE',
        source, sourceIntervalStartSeconds: bar.time,
        sourceIntervalEndMs: (bar.time + interval) * 1000,
    });
}

// Preserve only bounded normalized history. Raw input remains caller-owned and
// must not be mutated after construction; no second full archive is allocated.
class CandleWindow {
    constructor(capacity) { this.values = new Array(capacity); this.capacity = capacity; this.size = 0; this.next = 0; }
    push(bar) { this.values[this.next] = bar; this.next = (this.next + 1) % this.capacity; this.size = Math.min(this.size + 1, this.capacity); }
    last() { return this.size ? this.values[(this.next - 1 + this.capacity) % this.capacity] : null; }
    list() { return Array.from({ length: this.size }, (_, i) => this.values[(this.next - this.size + i + this.capacity) % this.capacity]); }
}

function aggregateComponent(bars, component) {
    const values = bars.map((bar) => bar[component]);
    if (values.some((value) => value === null)) return null;
    return Object.freeze({ open: values[0].open, high: Math.max(...values.map((value) => value.high)),
        low: Math.min(...values.map((value) => value.low)), close: values.at(-1).close });
}

function aggregateHour(bars, start) {
    const mid = aggregateComponent(bars, 'mid');
    return Object.freeze({ time: new Date(start * 1000).toISOString(), ...mid,
        mid, bid: aggregateComponent(bars, 'bid'), ask: aggregateComponent(bars, 'ask'),
        volume: bars.every((bar) => Number.isFinite(bar.volume)) ? bars.reduce((sum, bar) => sum + bar.volume, 0) : null,
        complete: true, source: 'FOUR_CONTIGUOUS_M15_UTC_AGGREGATE',
        completionEvidence: bars.every((bar) => bar.completionEvidence === 'EXPLICIT_PER_BAR')
            ? 'FOUR_EXPLICIT_COMPLETED_M15_BARS' : 'M15_COMPLETION_INCLUDES_DECLARED_ARCHIVE_PROVENANCE',
        sourceIntervalStartSeconds: start, sourceIntervalEndMs: (start + H1_SECONDS) * 1000,
        sourceM15IntervalStartsSeconds: Object.freeze(bars.map((bar) => bar.sourceIntervalStartSeconds)),
    });
}

class HistoricalMarket {
    constructor({ candlesByInstrument, h1ByInstrument = {}, clock, maxBars = 500, pricingAssumptions = {}, completedOnlyDeclared = false } = {}) {
        if (!clock || typeof clock.nowMs !== 'function') throw new TypeError('clock.nowMs() is required');
        if (!Number.isSafeInteger(maxBars) || maxBars < 1) throw new RangeError('maxBars must be a positive integer');
        if (typeof completedOnlyDeclared !== 'boolean') throw new TypeError('completedOnlyDeclared must be explicitly boolean');
        for (const [name, input] of Object.entries({ candlesByInstrument, h1ByInstrument })) {
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${name} must be an instrument map`);
        }
        if (!pricingAssumptions || typeof pricingAssumptions !== 'object' || Array.isArray(pricingAssumptions)) {
            throw new TypeError('pricingAssumptions must be an explicit object');
        }
        if (Object.hasOwn(pricingAssumptions, 'tradeable') && typeof pricingAssumptions.tradeable !== 'boolean') {
            throw new TypeError('pricingAssumptions.tradeable must be boolean when declared');
        }
        if (Object.hasOwn(pricingAssumptions, 'liquidityUnits') && !positiveNumber(pricingAssumptions.liquidityUnits)) {
            throw new TypeError('pricingAssumptions.liquidityUnits must be positive finite when declared');
        }
        if (Object.keys(pricingAssumptions).some((key) => !['tradeable', 'liquidityUnits'].includes(key))) {
            throw new TypeError('Unsupported pricing assumption');
        }
        this.clock = clock;
        this.maxBars = maxBars;
        this.pricingAssumptions = Object.freeze({ ...pricingAssumptions });
        this.completedOnlyDeclared = completedOnlyDeclared;
        this._nowMs = null;
        this._states = new Map();
        this._currencies = new Set(['AUD']);
        const instruments = [...new Set([...Object.keys(candlesByInstrument), ...Object.keys(h1ByInstrument)])].sort();
        for (const instrument of instruments) {
            if (!/^[A-Z]{3}_[A-Z]{3}$/.test(instrument)) throw new TypeError(`Invalid FX instrument: ${instrument}`);
            const [base, quote] = instrument.split('_');
            if (base === quote) throw new TypeError(`Identical currencies in instrument: ${instrument}`);
            this._currencies.add(base); this._currencies.add(quote);
            const m15 = candlesByInstrument[instrument] ?? [];
            const suppliedH1 = Object.hasOwn(h1ByInstrument, instrument);
            const h1 = suppliedH1 ? h1ByInstrument[instrument] : [];
            this._states.set(instrument, {
                m15, h1, suppliedH1, m15Cursor: 0, h1Cursor: 0,
                m15Window: new CandleWindow(maxBars), h1Window: new CandleWindow(maxBars),
                m15Audit: validateInput(m15, instrument, M15_SECONDS),
                h1Audit: suppliedH1 ? validateInput(h1, `${instrument}.H1`, H1_SECONDS) : null,
                excludedIncompleteM15: 0, excludedUnobservedM15: 0,
                excludedIncompleteH1: 0, excludedUnobservedH1: 0,
                completedM15: 0, declaredCompletedM15: 0, completedH1: 0, declaredCompletedH1: 0,
                discardedObservedHours: 0, pendingHour: null,
            });
        }
        this.advanceTo(clock.nowMs());
    }

    advanceTo(nowMs) {
        if (typeof nowMs !== 'number' || !Number.isSafeInteger(nowMs) || !Number.isFinite(new Date(nowMs).getTime())) {
            throw new TypeError('advanceTo requires integer UNIX milliseconds');
        }
        if (this._nowMs !== null && nowMs < this._nowMs) throw new RangeError('HistoricalMarket cannot advance backwards');
        this._nowMs = nowMs;
        for (const [instrument, state] of this._states) {
            while (state.m15Cursor < state.m15.length && (state.m15[state.m15Cursor].time + M15_SECONDS) * 1000 <= nowMs) {
                const raw = state.m15[state.m15Cursor++];
                if (raw.complete !== true && !(this.completedOnlyDeclared && raw.complete === undefined)) {
                    state[raw.complete === false ? 'excludedIncompleteM15' : 'excludedUnobservedM15'] += 1;
                    continue;
                }
                const bar = normalizeBar(raw, instrument, M15_SECONDS, 'ARCHIVE_M15');
                state.m15Window.push(bar); state.completedM15 += 1;
                if (raw.complete !== true) state.declaredCompletedM15 += 1;
                if (!state.suppliedH1) this._accumulateHour(state, bar);
            }
            if (!state.suppliedH1 && state.pendingHour && (state.pendingHour.start + H1_SECONDS) * 1000 <= nowMs) {
                this._finishHour(state);
            }
            while (state.h1Cursor < state.h1.length && (state.h1[state.h1Cursor].time + H1_SECONDS) * 1000 <= nowMs) {
                const raw = state.h1[state.h1Cursor++];
                if (raw.complete !== true && !(this.completedOnlyDeclared && raw.complete === undefined)) {
                    state[raw.complete === false ? 'excludedIncompleteH1' : 'excludedUnobservedH1'] += 1;
                    continue;
                }
                state.h1Window.push(normalizeBar(raw, instrument, H1_SECONDS, 'EXPLICIT_H1_INPUT'));
                state.completedH1 += 1;
                if (raw.complete !== true) state.declaredCompletedH1 += 1;
            }
        }
        return this;
    }

    _accumulateHour(state, bar) {
        const start = Math.floor(bar.sourceIntervalStartSeconds / H1_SECONDS) * H1_SECONDS;
        if (state.pendingHour && state.pendingHour.start !== start) this._finishHour(state);
        if (!state.pendingHour) state.pendingHour = { start, bars: [] };
        state.pendingHour.bars.push(bar);
    }

    _finishHour(state) {
        const { start, bars } = state.pendingHour;
        if (bars.length === 4 && bars.every((bar, i) => bar.sourceIntervalStartSeconds === start + i * M15_SECONDS)) {
            state.h1Window.push(aggregateHour(bars, start)); state.completedH1 += 1;
        } else state.discardedObservedHours += 1;
        state.pendingHour = null;
    }

    getCandles(instrument, timeframe = 'M15') {
        const canonical = { M15: 'M15', '15m': 'M15', H1: 'H1', '1h': 'H1' }[timeframe];
        if (!canonical) throw new RangeError(`Unsupported historical timeframe: ${timeframe}`);
        const state = this._states.get(instrument);
        return state ? (canonical === 'M15' ? state.m15Window : state.h1Window).list() : [];
    }

    getCompletedBar(instrument) { return this._states.get(instrument)?.m15Window.last() ?? null; }

    getQuote(instrument) {
        const bar = this.getCompletedBar(instrument);
        let componentReason = null;
        if (!this._states.has(instrument)) componentReason = 'INSTRUMENT_NOT_PROVIDED';
        else if (!bar) componentReason = 'NO_COMPLETED_M15_BAR';
        else if (!bar.bid || !bar.ask) componentReason = 'BID_ASK_COMPONENT_EVIDENCE_UNAVAILABLE';
        else if (bar.ask.close < bar.bid.close) componentReason = 'CROSSED_COMPONENT_CLOSES_UNUSABLE_IN_COARSE_QUOTE_MODEL';
        const hasTradeability = Object.hasOwn(this.pricingAssumptions, 'tradeable');
        const hasLiquidity = Object.hasOwn(this.pricingAssumptions, 'liquidityUnits');
        const reason = componentReason ?? (!hasTradeability || !hasLiquidity ? 'EXECUTABLE_PRICING_ASSUMPTIONS_NOT_DECLARED'
            : this.pricingAssumptions.tradeable === false ? 'DECLARED_NONTRADEABLE_MODEL' : null);
        const bucket = (price) => ({ price: String(price), ...(hasLiquidity ? { liquidity: this.pricingAssumptions.liquidityUnits } : {}) });
        return {
            instrument, status: reason ? 'UNAVAILABLE' : 'AVAILABLE', reason,
            componentQuoteStatus: componentReason ? 'UNAVAILABLE' : 'AVAILABLE', componentQuoteReason: componentReason,
            // Actual broker tradeability and level liquidity were not retained.
            // A separate simulated broker must declare its assumptions for them.
            tradeable: componentReason ? false : hasTradeability ? this.pricingAssumptions.tradeable : null,
            tradeabilityStatus: hasTradeability ? 'DECLARED_MODEL_ASSUMPTION' : 'UNOBSERVED',
            liquidityStatus: hasLiquidity ? 'DECLARED_MODEL_ASSUMPTION' : 'UNOBSERVED',
            pricingAssumptions: this.pricingAssumptions,
            time: bar ? new Date(bar.sourceIntervalEndMs).toISOString() : null,
            bids: componentReason ? [] : [bucket(bar.bid.close)],
            asks: componentReason ? [] : [bucket(bar.ask.close)],
            source: QUOTE_ASSUMPTION, sourceIntervalStartSeconds: bar?.sourceIntervalStartSeconds ?? null,
            sourceIntervalEndMs: bar?.sourceIntervalEndMs ?? null,
            ageSinceSourceIntervalEndMs: bar ? this._nowMs - bar.sourceIntervalEndMs : null,
            componentMidClose: bar?.mid.close ?? null,
            assumption: 'Bid and ask component closes are used as a coarse pair; they need not be synchronous events or executable account quotes. No receipt timestamp, liquidity or actual tradeability is observed.',
        };
    }

    _conversionGraph() {
        const graph = new Map();
        const add = (from, to, edge) => {
            if (!graph.has(from)) graph.set(from, []);
            graph.get(from).push({ to, ...edge });
        };
        for (const instrument of this._states.keys()) {
            const quote = this.getQuote(instrument);
            if (quote.componentQuoteStatus !== 'AVAILABLE') continue;
            const [base, counter] = instrument.split('_');
            const bar = this.getCompletedBar(instrument);
            const evidence = { instrument, end: bar.sourceIntervalEndMs };
            add(base, counter, { ...evidence, gain: bar.bid.close, loss: bar.ask.close, position: bar.mid.close });
            add(counter, base, { ...evidence, gain: 1 / bar.ask.close, loss: 1 / bar.bid.close, position: 1 / bar.mid.close });
        }
        return graph;
    }

    _findConversion(graph, currency, requireSameEnd) {
        const queue = [{ currency, seen: new Set([currency]), legs: [], end: null, gain: 1, loss: 1, position: 1 }];
        for (let index = 0; index < queue.length; index += 1) {
            const item = queue[index];
            if (item.currency === 'AUD') return item;
            for (const edge of graph.get(item.currency) ?? []) {
                if (item.seen.has(edge.to) || (requireSameEnd && item.end !== null && item.end !== edge.end)) continue;
                queue.push({ currency: edge.to, seen: new Set([...item.seen, edge.to]),
                    legs: [...item.legs, edge.instrument], end: edge.end,
                    gain: item.gain * edge.gain, loss: item.loss * edge.loss, position: item.position * edge.position });
            }
        }
        return null;
    }

    getHomeConversions() {
        const graph = this._conversionGraph();
        return [...this._currencies].sort().map((currency) => {
            if (currency === 'AUD') return { currency, accountGain: '1', accountLoss: '1', positionValue: '1',
                status: 'AVAILABLE', reason: null, source: 'SAME_CURRENCY_IDENTITY', updatedAt: null,
                sourceInstruments: [], sourceIntervalEndMs: null };
            const path = this._findConversion(graph, currency, true);
            const invalidRate = path && ![path.gain, path.loss, path.position].every(positiveNumber);
            const reason = invalidRate ? 'INVALID_DERIVED_CONVERSION_RATE' : path ? null : this._findConversion(graph, currency, false)
                ? 'INCOMPARABLE_COMPONENT_CLOSE_INTERVALS' : 'CAUSAL_CONVERSION_PATH_UNAVAILABLE';
            const available = path && !invalidRate;
            return {
                currency, status: available ? 'AVAILABLE' : 'UNAVAILABLE', reason,
                accountGain: available ? String(path.gain) : null, accountLoss: available ? String(path.loss) : null,
                positionValue: available ? String(path.position) : null, source: CONVERSION_ASSUMPTION,
                updatedAt: path?.end ?? null, sourceIntervalEndMs: path?.end ?? null,
                sourceInstruments: path?.legs ?? [],
                ageSinceSourceIntervalEndMs: path ? this._nowMs - path.end : null,
                assumption: 'Derived AUD gain uses sell-side conversion legs, loss uses buy-side legs, and position value uses midpoint components. All legs share a completed M15 interval end; these are coarse-model rates, not retained broker homeConversions.',
            };
        });
    }

    summary() {
        return {
            adapterKind: 'CAUSAL_COMPLETED_CANDLE_INPUT', clockMs: this._nowMs, maxBars: this.maxBars,
            pricingAssumptions: this.pricingAssumptions,
            timestampUnitInput: 'UNIX_SECONDS', timestampMeaningInput: 'INTERVAL_START',
            completedOnlyDeclared: this.completedOnlyDeclared,
            instruments: [...this._states].map(([instrument, state]) => ({
                instrument, m15: { ...state.m15Audit, consumedInputBars: state.m15Cursor,
                    completedAvailableBarsSeen: state.completedM15, retainedBars: state.m15Window.size,
                    barsAcceptedViaCompletedOnlyDeclaration: state.declaredCompletedM15,
                    excludedIncompleteBars: state.excludedIncompleteM15, excludedUnknownCompletionBars: state.excludedUnobservedM15 },
                h1: { source: state.suppliedH1 ? 'EXPLICIT_H1_INPUT' : 'FOUR_CONTIGUOUS_M15_UTC_AGGREGATE',
                    inputAudit: state.h1Audit, consumedInputBars: state.h1Cursor,
                    completedAvailableBarsSeen: state.completedH1, retainedBars: state.h1Window.size,
                    explicitInputBarsAcceptedViaCompletedOnlyDeclaration: state.declaredCompletedH1,
                    excludedIncompleteBars: state.excludedIncompleteH1, excludedUnknownCompletionBars: state.excludedUnobservedH1,
                    discardedObservedHours: state.discardedObservedHours },
                quoteStatus: this.getQuote(instrument).status, quoteReason: this.getQuote(instrument).reason,
            })),
            homeConversions: this.getHomeConversions(),
            assumptions: [
                'Only intervals ending at or before the explicitly advanced clock are visible. Completion requires per-bar complete=true or an explicit completedOnlyDeclared caller declaration for absent flags. An explicit incomplete or invalid flag is excluded; absent intervals are never filled.',
                'Reconstructed H1 bars use UTC hour boundaries and exactly four contiguous completed M15 bars. Actual historical broker H1 alignment parity is unverified.',
                'Bid, ask and midpoint OHLC components are retained separately. Independent component closes do not establish synchronous executable spread.',
                'Conversion legs must share a completed interval end for this coarse research model; this is not a production freshness or broker-health rule.',
                'Clock progress alone does not create new market evidence. Source timestamps remain the actual interval end; no current broker receipt is invented.',
                'M15 OHLC does not establish intrabar order, polling-time breakeven outcomes, actual liquidity, slippage, fills or financing.',
                'Explicit H1 inputs override reconstruction for that instrument. Supplied input arrays must not be mutated after construction.',
                'Summary includes archive preflight coverage, including future rows; it must not be supplied to strategy features.',
            ],
        };
    }
}

module.exports = { HistoricalMarket };
