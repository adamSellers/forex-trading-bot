'use strict';

// Explicit counterfactual paths through retained component OHLC. These paths
// are assumptions, never retained ticks or a claim of executable bid/ask truth.
const { HistoricalMarket } = require('./historicalMarket.cjs');
const PERIOD = 900_000;
const read = (component, key) => Number(component[key] ?? component[{ open: 'o', high: 'h', low: 'l', close: 'c' }[key]]);

class ViabilityMarket extends HistoricalMarket {
    constructor({ pathOrder = 'OHLC', spreadPips = null, homeConversionFeeRate = 0, ...options }) {
        if (!['OHLC', 'OLHC'].includes(pathOrder)) throw new Error('Declare OHLC or OLHC path');
        if (spreadPips !== null && !((Number.isFinite(spreadPips) && spreadPips >= 0) ||
            (typeof spreadPips === 'object' && Object.values(spreadPips).every((value) => Number.isFinite(value) && value >= 0)))) throw new Error('Invalid declared spread');
        if (!Number.isFinite(homeConversionFeeRate) || homeConversionFeeRate < 0 || homeConversionFeeRate >= 1) throw new Error('Invalid declared home-conversion fee');
        super(options);
        this.pathOrder = pathOrder;
        this.spreadPips = spreadPips;
        this.homeConversionFeeRate = homeConversionFeeRate;
        this.raw = options.candlesByInstrument;
        this.rawIndices = new Map();
    }

    _bar(instrument) {
        const bars = this.raw?.[instrument] ?? [];
        let index = this.rawIndices?.get(instrument) ?? 0;
        while (index + 1 < bars.length && bars[index + 1].time * 1000 <= this._nowMs) index++;
        this.rawIndices?.set(instrument, index);
        const bar = bars[index];
        return bar && bar.time * 1000 <= this._nowMs ? bar : null;
    }

    _point(component, fraction) {
        const keys = this.pathOrder === 'OHLC' ? ['open', 'high', 'low', 'close'] : ['open', 'low', 'high', 'close'];
        const point = Math.min(3, Math.max(0, fraction * 3));
        const leg = Math.min(2, Math.floor(point));
        return read(component, keys[leg]) + (read(component, keys[leg + 1]) - read(component, keys[leg])) * (point - leg);
    }

    getQuote(instrument) {
        // HistoricalMarket's constructor calls summary helpers before the path
        // fields are installed. Its completed-close API remains the fallback.
        if (!this.raw) return super.getQuote(instrument);
        const bar = this._bar(instrument);
        if (!bar?.bid || !bar?.ask) return super.getQuote(instrument);
        const startMs = bar.time * 1000;
        const within = this._nowMs < startMs + PERIOD;
        const fraction = within ? (this._nowMs - startMs) / PERIOD : 1;
        let bid = this._point(bar.bid, fraction);
        let ask = this._point(bar.ask, fraction);
        if (this.spreadPips !== null) {
            const center = this._point(bar.mid ?? bar, fraction);
            const declared = typeof this.spreadPips === 'number' ? this.spreadPips : this.spreadPips[instrument];
            if (!(declared >= 0)) throw new Error(`Missing declared spread for ${instrument}`);
            const half = declared * (instrument.endsWith('_JPY') ? 0.01 : 0.0001) / 2;
            bid = center - half; ask = center + half;
        }
        if (!(ask >= bid && bid > 0)) throw new Error(`Crossed modeled component path ${instrument}`);
        return { instrument, status: within ? 'tradeable' : 'non-tradeable', tradeable: within, componentQuoteStatus: 'AVAILABLE',
            time: new Date(within ? this._nowMs : startMs + PERIOD).toISOString(),
            bids: [{ price: String(bid), liquidity: 1_000_000 }], asks: [{ price: String(ask), liquidity: 1_000_000 }],
            closeoutBid: String(bid), closeoutAsk: String(ask),
            source: 'DECLARED_LINEAR_COMPONENT_OHLC_PATH', researchObservation: 'COUNTERFACTUAL_POINT',
            pathOrder: this.pathOrder, declaredSpreadPips: this.spreadPips,
            sourceIntervalStartSeconds: bar.time, sourceIntervalEndMs: startMs + PERIOD };
    }

    _conversionGraph() {
        if (!this.raw) return super._conversionGraph();
        const graph = new Map();
        const add = (from, to, edge) => { if (!graph.has(from)) graph.set(from, []); graph.get(from).push({ to, ...edge }); };
        for (const instrument of Object.keys(this.raw)) {
            const quote = this.getQuote(instrument);
            if (quote.componentQuoteStatus !== 'AVAILABLE') continue;
            const bid = Number(quote.bids[0].price), ask = Number(quote.asks[0].price), mid = (bid + ask) / 2;
            const [base, counter] = instrument.split('_');
            const evidence = { instrument, end: Date.parse(quote.time) };
            add(base, counter, { ...evidence, gain: bid, loss: ask, position: mid });
            add(counter, base, { ...evidence, gain: 1 / ask, loss: 1 / bid, position: 1 / mid });
        }
        return graph;
    }

    getHomeConversions() {
        const rows = super.getHomeConversions();
        // A fee is charged once on settlement into AUD, not on each bridge
        // edge. Position valuation remains at the neutral cross-currency rate.
        if (!this.raw || this.homeConversionFeeRate === 0) return rows;
        return rows.map((row) => row.currency === 'AUD' || row.status !== 'AVAILABLE' ? row : {
            ...row, accountGain: String(Number(row.positionValue) * (1 - this.homeConversionFeeRate)),
            accountLoss: String(Number(row.positionValue) * (1 + this.homeConversionFeeRate)),
            homeConversionFeeRate: this.homeConversionFeeRate,
            source: 'DECLARED_MIDPOINT_CROSS_RATE_WITH_ONCE_PER_AUD_SETTLEMENT_FEE',
            assumption: 'Foreign realized gains/losses settle using neutral midpoint path rate times (1-fee)/(1+fee). Fee applies once after the complete FX path; positionValue remains the neutral rate.',
        });
    }
}

module.exports = { ViabilityMarket, PERIOD };
