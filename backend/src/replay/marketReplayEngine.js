const {
    resolveQuoteToAud,
    splitInstrument,
} = require("./audConversion");
const {
    calculateCanonicalPositionSize,
    resolveCanonicalTradePlan,
} = require("../runtime/executionPolicy");

function toFiniteNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toTimestampMs(value) {
    const numeric = toFiniteNumber(value, null);
    if (numeric !== null) return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid candle time: ${value}`);
    return parsed;
}

function pipSizeForInstrument(instrument) {
    return splitInstrument(instrument).quoteCurrency === "JPY" ? 0.01 : 0.0001;
}

function normalizeCandle(instrument, candle, sequence) {
    const time = toTimestampMs(candle.time);
    const open = toFiniteNumber(candle.open ?? candle.mid?.o, null);
    const high = toFiniteNumber(candle.high ?? candle.mid?.h, null);
    const low = toFiniteNumber(candle.low ?? candle.mid?.l, null);
    const close = toFiniteNumber(candle.close ?? candle.mid?.c, null);
    if (![open, high, low, close].every(Number.isFinite)) {
        throw new Error(`Malformed ${instrument} candle at ${candle.time}`);
    }
    if (low > high || open < low || open > high || close < low || close > high) {
        throw new Error(`Invalid OHLC bounds for ${instrument} at ${candle.time}`);
    }
    if (candle.complete === false) {
        throw new Error(`Replay input contains incomplete candle for ${instrument}`);
    }
    return { ...candle, instrument, time, open, high, low, close, sequence };
}

function normalizeDataset(candlesByInstrument = {}) {
    const events = [];
    for (const [instrument, sourceCandles] of Object.entries(candlesByInstrument)) {
        let previousTime = -Infinity;
        const seen = new Set();
        for (const [sequence, source] of (sourceCandles || []).entries()) {
            const candle = normalizeCandle(instrument, source, sequence);
            if (seen.has(candle.time)) {
                throw new Error(`Duplicate candle for ${instrument} at ${candle.time}`);
            }
            if (candle.time <= previousTime) {
                throw new Error(`Candles are not strictly chronological for ${instrument}`);
            }
            seen.add(candle.time);
            previousTime = candle.time;
            events.push(candle);
        }
    }
    events.sort((a, b) => a.time - b.time || a.instrument.localeCompare(b.instrument));
    return events;
}

function groupEventsByTime(events) {
    const groups = [];
    for (const event of events) {
        const last = groups[groups.length - 1];
        if (!last || last.time !== event.time) {
            groups.push({ time: event.time, candles: [event] });
        } else {
            last.candles.push(event);
        }
    }
    return groups;
}

function synthesizeSideCandle(candle, spreadPips) {
    const pipSize = pipSizeForInstrument(candle.instrument);
    const explicitSpreadPrice = toFiniteNumber(candle.spreadPrice, null);
    const spreadPrice = Number.isFinite(explicitSpreadPrice)
        ? explicitSpreadPrice
        : Math.max(0, toFiniteNumber(candle.spreadPips, spreadPips)) * pipSize;
    const half = spreadPrice / 2;
    const sideValue = (side, key, mid, adjustment) =>
        toFiniteNumber(candle[side]?.[key], null) ?? mid + adjustment;

    return {
        mid: { open: candle.open, high: candle.high, low: candle.low, close: candle.close },
        bid: {
            open: sideValue("bid", "o", candle.open, -half),
            high: sideValue("bid", "h", candle.high, -half),
            low: sideValue("bid", "l", candle.low, -half),
            close: sideValue("bid", "c", candle.close, -half),
        },
        ask: {
            open: sideValue("ask", "o", candle.open, half),
            high: sideValue("ask", "h", candle.high, half),
            low: sideValue("ask", "l", candle.low, half),
            close: sideValue("ask", "c", candle.close, half),
        },
        spreadPrice,
        spreadPips: spreadPrice / pipSize,
    };
}

function countNewYorkRollovers(openedAt, closedAt) {
    if (!(closedAt > openedAt)) return 0;
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hourCycle: "h23",
    });
    let count = 0;
    let cursor = Math.floor(openedAt / 3600000) * 3600000 + 3600000;
    for (; cursor <= closedAt; cursor += 3600000) {
        if (formatter.format(new Date(cursor)) === "17") count += 1;
    }
    return count;
}

function directionFromSignal(signal = {}) {
    const action = String(signal.signal ?? signal.action ?? signal.direction ?? "").toUpperCase();
    if (["BUY", "LONG"].includes(action)) return 1;
    if (["SELL", "SHORT"].includes(action)) return -1;
    return 0;
}

class MarketReplayEngine {
    constructor(options = {}) {
        if (typeof options.strategy !== "function") {
            throw new Error("MarketReplayEngine requires an async strategy callback");
        }
        this.strategy = options.strategy;
        this.config = {
            startingBalanceAud: 10000,
            riskPerTrade: 0.005,
            maxOpenPositions: 3,
            maxLeverage: 20,
            marginRate: 0.05,
            defaultSpreadPips: 1,
            slippagePips: 0,
            commissionAudPerMillion: 0,
            defaultStopPips: 15,
            defaultRiskReward: 1.5,
            conservativeIntrabarOrdering: true,
            closeAtEnd: true,
            ...options.config,
        };
        this.rateProvider = options.rateProvider || null;
        this.financingModel = options.financingModel || null;
    }

    _quoteToAud(instrument, prices, timestamp) {
        return resolveQuoteToAud(instrument, prices, {
            timestamp,
            rateProvider: this.rateProvider,
        });
    }

    _buildOrder(signal, candle, prices, balanceAud, positions, pendingOrders) {
        const direction = directionFromSignal(signal);
        if (!direction) return null;
        const pipSize = pipSizeForInstrument(candle.instrument);
        const reference = candle.close;
        const tradePlan = signal.tradePlan || {};
        let requestedStopLossPrice = toFiniteNumber(
            signal.stopLossPrice ?? tradePlan.stopLossPrice,
            null
        );
        const requestedStopPips = Math.max(
            0.1,
            toFiniteNumber(
                signal.stopDistancePips ?? tradePlan.stopDistancePips,
                this.config.defaultStopPips
            )
        );
        if (!Number.isFinite(requestedStopLossPrice)) {
            requestedStopLossPrice =
                reference - direction * requestedStopPips * pipSize;
        }
        const canonicalPlan = resolveCanonicalTradePlan({
            signal: {
                ...signal,
                signal: direction === 1 ? "BUY" : "SELL",
                currentPrice: reference,
                tradePlan: {
                    ...tradePlan,
                    stopLossPrice: requestedStopLossPrice,
                },
            },
            config: {
                stopLossType: "FIXED",
                stopLossPips: this.config.defaultStopPips,
                minStopLossPips: this.config.minStopLossPips ?? 0,
                ...this.config,
            },
            entryPrice: reference,
            pipValue: pipSize,
        });
        if (!canonicalPlan) {
            return { rejected: true, reason: "invalid_stop_direction" };
        }
        const stopLossPrice = canonicalPlan.stopLossPrice;
        const stopDistance = Math.abs(reference - stopLossPrice);
        const quoteToAud = this._quoteToAud(candle.instrument, prices, candle.time);
        const marginUsedAud = Array.from(positions.values()).reduce(
            (sum, position) => sum + position.marginRequiredAud,
            0
        );
        const reservedMarginAud = Array.from(pendingOrders.values()).reduce(
            (sum, order) => sum + (order.marginRequiredAud || 0),
            0
        );
        const effectiveLeverage = Math.min(
            Math.max(1, this.config.maxLeverage),
            1 / Math.max(1e-9, this.config.marginRate)
        );
        const fixedUnits = toFiniteNumber(signal.units, null);
        const sizing = calculateCanonicalPositionSize({
            config: {
                ...this.config,
                positionSizeMethod: Number.isFinite(fixedUnits) ? "FIXED" : "RISK",
                fixedPositionUnits: fixedUnits,
                maxCapitalAtRisk:
                    this.config.maxCapitalAtRisk ?? balanceAud,
                marginBuffer: 0,
                leverage: effectiveLeverage,
                maxLeverage: effectiveLeverage,
            },
            signal,
            entryPrice: reference,
            stopLossPrice,
            equityAud: balanceAud,
            marginAvailableAud: Math.max(
                0,
                balanceAud - marginUsedAud - reservedMarginAud
            ),
            baseToAudRate: reference * quoteToAud,
            quoteToAudRate: quoteToAud,
        });
        if (!sizing.valid || !sizing.units) {
            return {
                rejected: true,
                reason:
                    sizing.code === "INVALID_SIZING_INPUT"
                        ? "insufficient_margin"
                        : "zero_units",
            };
        }
        const units = sizing.units;
        const marginRequiredAud = sizing.marginRequiredAud;

        let takeProfitPrice = toFiniteNumber(
            signal.takeProfitPrice ?? tradePlan.takeProfitPrice,
            null
        );
        if (!Number.isFinite(takeProfitPrice)) {
            const rewardRisk = Math.max(
                0,
                toFiniteNumber(signal.riskReward, this.config.defaultRiskReward)
            );
            takeProfitPrice = reference + direction * stopDistance * rewardRisk;
        }
        return {
            instrument: candle.instrument,
            direction,
            units,
            stopLossPrice,
            takeProfitPrice,
            signalTime: candle.time,
            signalPrice: reference,
            marginRequiredAud,
            sizing,
            signal: { ...signal },
        };
    }

    _fillOrder(order, candle, side, prices, balanceAud) {
        const pipSize = pipSizeForInstrument(order.instrument);
        const slippage = Math.max(0, this.config.slippagePips) * pipSize;
        const marketEntry = order.direction === 1 ? side.ask.open : side.bid.open;
        const entryPrice = marketEntry + order.direction * slippage;
        const signalStopDistance = Math.abs(order.signalPrice - order.stopLossPrice);
        const stopLossPrice = entryPrice - order.direction * signalStopDistance;
        const signalTargetDistance = Math.abs(order.takeProfitPrice - order.signalPrice);
        const takeProfitPrice = entryPrice + order.direction * signalTargetDistance;
        const quoteToAud = this._quoteToAud(order.instrument, prices, candle.time);
        const commissionAud =
            (order.units / 1_000_000) * Math.max(0, this.config.commissionAudPerMillion);
        return {
            ...order,
            id: `${order.instrument}:${order.signalTime}:${order.direction}`,
            openedAt: candle.time,
            entryPrice,
            marketEntryPrice: marketEntry,
            entryMidPrice: side.mid.open,
            stopLossPrice,
            takeProfitPrice,
            entryQuoteToAud: quoteToAud,
            entryCommissionAud: commissionAud,
            balanceBeforeAud: balanceAud,
            barsHeld: 0,
        };
    }

    _intrabarExit(position, side) {
        const isLong = position.direction === 1;
        const stopHit = isLong
            ? side.bid.low <= position.stopLossPrice
            : side.ask.high >= position.stopLossPrice;
        const targetHit = isLong
            ? side.bid.high >= position.takeProfitPrice
            : side.ask.low <= position.takeProfitPrice;
        if (!stopHit && !targetHit) return null;

        // OHLC data cannot reveal which level traded first. Choosing the stop is
        // intentionally conservative and prevents optimistic backtest bias.
        const reason = stopHit && targetHit && this.config.conservativeIntrabarOrdering
            ? "STOP_LOSS_AMBIGUOUS"
            : stopHit
            ? "STOP_LOSS"
            : "TAKE_PROFIT";
        const stopSelected = reason !== "TAKE_PROFIT";
        const level = stopSelected ? position.stopLossPrice : position.takeProfitPrice;
        const open = isLong ? side.bid.open : side.ask.open;
        let exitPrice = level;
        if (stopSelected) {
            exitPrice = isLong ? Math.min(level, open) : Math.max(level, open);
        }
        return { exitPrice, reason };
    }

    _closePosition(position, exitPrice, exitMidPrice, closedAt, reason, prices) {
        const pipSize = pipSizeForInstrument(position.instrument);
        const slippage = Math.max(0, this.config.slippagePips) * pipSize;
        const slippedExit = exitPrice - position.direction * slippage;
        const quoteToAud = this._quoteToAud(position.instrument, prices, closedAt);
        const pricePnlQuote =
            position.direction * (slippedExit - position.entryPrice) * position.units;
        const pricePnlAud = pricePnlQuote * quoteToAud;
        const grossMidPnlAud =
            position.direction *
            (exitMidPrice - position.entryMidPrice) *
            position.units *
            quoteToAud;
        const rollovers = countNewYorkRollovers(position.openedAt, closedAt);
        const financingAud = this.financingModel
            ? toFiniteNumber(this.financingModel({ ...position, closedAt, rollovers }), 0)
            : toFiniteNumber(position.signal.financingAudPerRollover, 0) * rollovers;
        const exitCommissionAud =
            (position.units / 1_000_000) * Math.max(0, this.config.commissionAudPerMillion);
        const commissionAud = position.entryCommissionAud + exitCommissionAud;
        const netPnlAud = pricePnlAud + financingAud - commissionAud;
        const executionCostAud = grossMidPnlAud - pricePnlAud + commissionAud;
        return {
            id: position.id,
            instrument: position.instrument,
            direction: position.direction === 1 ? "LONG" : "SHORT",
            units: position.units,
            signalTime: position.signalTime,
            openedAt: position.openedAt,
            closedAt,
            barsHeld: position.barsHeld,
            entryPrice: position.entryPrice,
            exitPrice: slippedExit,
            stopLossPrice: position.stopLossPrice,
            takeProfitPrice: position.takeProfitPrice,
            exitReason: reason,
            grossMidPnlAud,
            pricePnlAud,
            financingAud,
            commissionAud,
            executionCostAud,
            netPnlAud,
            rollovers,
            quoteToAud,
            riskAud: Math.abs(
                (position.entryPrice - position.stopLossPrice) *
                    position.units *
                    position.entryQuoteToAud
            ),
            metadata: position.signal.metadata || null,
        };
    }

    async run(candlesByInstrument = {}, runOptions = {}) {
        const events = normalizeDataset(candlesByInstrument);
        if (!events.length) throw new Error("Replay dataset is empty");
        const groups = groupEventsByTime(events);
        const histories = new Map();
        const positions = new Map();
        const pendingOrders = new Map();
        const prices = new Map();
        const trades = [];
        const decisions = [];
        const decisionFunnel = new Map();
        const rejections = [];
        const equityCurve = [];
        let balanceAud = this.config.startingBalanceAud;

        for (const group of groups) {
            for (const candle of group.candles) prices.set(candle.instrument, candle.open);

            for (const candle of group.candles) {
                const side = synthesizeSideCandle(candle, this.config.defaultSpreadPips);
                const pending = pendingOrders.get(candle.instrument);
                if (pending && candle.time > pending.signalTime) {
                    if (positions.size >= this.config.maxOpenPositions) {
                        rejections.push({ ...pending, rejectedAt: candle.time, reason: "max_positions" });
                    } else {
                        const position = this._fillOrder(
                            pending,
                            candle,
                            side,
                            prices,
                            balanceAud
                        );
                        positions.set(candle.instrument, position);
                    }
                    pendingOrders.delete(candle.instrument);
                }

                const position = positions.get(candle.instrument);
                if (position) {
                    position.barsHeld += 1;
                    const exit = this._intrabarExit(position, side);
                    const maxBars = toFiniteNumber(
                        position.signal.maxHoldingBars ??
                            position.signal.tradePlan?.maxHoldingBars,
                        null
                    );
                    const timedOut = Number.isFinite(maxBars) && position.barsHeld >= maxBars;
                    if (exit || timedOut) {
                        const result = this._closePosition(
                            position,
                            exit?.exitPrice ?? (position.direction === 1 ? side.bid.close : side.ask.close),
                            side.mid.close,
                            candle.time,
                            exit?.reason || "TIME_STOP",
                            prices
                        );
                        trades.push(result);
                        balanceAud += result.netPnlAud;
                        positions.delete(candle.instrument);
                    }
                }
            }

            for (const candle of group.candles) {
                prices.set(candle.instrument, candle.close);
                const history = histories.get(candle.instrument) || [];
                history.push(candle);
                histories.set(candle.instrument, history);
            }

            for (const candle of group.candles) {
                const position = positions.get(candle.instrument) || null;
                const signal = (await this.strategy({
                    instrument: candle.instrument,
                    candle,
                    candles: histories.get(candle.instrument),
                    histories,
                    prices,
                    position: position ? { ...position } : null,
                    balanceAud,
                    timestamp: group.time,
                })) || { signal: "HOLD" };
                const tradingActive =
                    group.time >= toFiniteNumber(runOptions.tradeFrom, -Infinity) &&
                    group.time <= toFiniteNumber(runOptions.tradeTo, Infinity);
                const decision = {
                    instrument: candle.instrument,
                    time: group.time,
                    signal: signal.signal || signal.action || "HOLD",
                    reasonCode: signal.reasonCode || null,
                    warmup: !tradingActive,
                };
                const funnelKey = JSON.stringify({
                    instrument: decision.instrument,
                    signal: decision.signal,
                    reasonCode: decision.reasonCode,
                    warmup: decision.warmup,
                });
                decisionFunnel.set(
                    funnelKey,
                    (decisionFunnel.get(funnelKey) || 0) + 1
                );
                if (runOptions.captureDecisions !== false) {
                    decisions.push(decision);
                }

                if (!tradingActive) continue;

                const direction = directionFromSignal(signal);
                const exitOnly = signal.entryType === "EXIT_ONLY" || signal.intent === "EXIT_LONG_ONLY";
                if (position && (signal.signal === "CLOSE" ||
                    (direction && direction !== position.direction))) {
                    const side = synthesizeSideCandle(candle, this.config.defaultSpreadPips);
                    const result = this._closePosition(
                        position,
                        position.direction === 1 ? side.bid.close : side.ask.close,
                        side.mid.close,
                        candle.time,
                        "OPPOSITE_SIGNAL",
                        prices
                    );
                    trades.push(result);
                    balanceAud += result.netPnlAud;
                    positions.delete(candle.instrument);
                    if (exitOnly) continue;
                }

                if (direction && !positions.has(candle.instrument) &&
                    !pendingOrders.has(candle.instrument) && !exitOnly) {
                    const order = this._buildOrder(
                        signal,
                        candle,
                        prices,
                        balanceAud,
                        positions,
                        pendingOrders
                    );
                    if (order?.rejected) {
                        rejections.push({
                            instrument: candle.instrument,
                            rejectedAt: candle.time,
                            reason: order.reason,
                        });
                    } else if (order) {
                        pendingOrders.set(candle.instrument, order);
                    }
                }
            }

            const unrealizedAud = Array.from(positions.values()).reduce((sum, position) => {
                const mid = prices.get(position.instrument);
                return sum + position.direction * (mid - position.entryPrice) *
                    position.units * this._quoteToAud(position.instrument, prices, group.time);
            }, 0);
            equityCurve.push({ time: group.time, balanceAud, equityAud: balanceAud + unrealizedAud });
        }

        if (this.config.closeAtEnd && positions.size) {
            const finalTime = groups[groups.length - 1].time;
            for (const position of positions.values()) {
                const candle = [...events].reverse().find(
                    (item) => item.instrument === position.instrument
                );
                const side = synthesizeSideCandle(candle, this.config.defaultSpreadPips);
                const result = this._closePosition(
                    position,
                    position.direction === 1 ? side.bid.close : side.ask.close,
                    side.mid.close,
                    finalTime,
                    "END_OF_DATA",
                    prices
                );
                trades.push(result);
                balanceAud += result.netPnlAud;
            }
            positions.clear();
        }

        return {
            referenceCurrency: "AUD",
            startedAt: groups[0].time,
            endedAt: groups[groups.length - 1].time,
            startingBalanceAud: this.config.startingBalanceAud,
            endingBalanceAud: balanceAud,
            netPnlAud: balanceAud - this.config.startingBalanceAud,
            trades,
            decisions,
            decisionFunnel: Array.from(decisionFunnel.entries()).map(
                ([key, count]) => ({ ...JSON.parse(key), count })
            ),
            rejections,
            equityCurve,
            openPositions: Array.from(positions.values()),
            pendingOrders: Array.from(pendingOrders.values()),
            assumptions: {
                nextBarOpenFills: true,
                conservativeIntrabarOrdering: this.config.conservativeIntrabarOrdering,
                spreadPips: this.config.defaultSpreadPips,
                slippagePips: this.config.slippagePips,
                commissionAudPerMillion: this.config.commissionAudPerMillion,
                financing: this.financingModel ? "custom" : "signal_rate_or_zero",
            },
        };
    }
}

module.exports = {
    MarketReplayEngine,
    countNewYorkRollovers,
    normalizeDataset,
    pipSizeForInstrument,
    synthesizeSideCandle,
};
