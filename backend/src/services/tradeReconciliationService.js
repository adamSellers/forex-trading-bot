class TradeReconciliationService {
    normalizeNumber(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    getPipValue(instrument) {
        return instrument && instrument.endsWith("_JPY") ? 0.01 : 0.0001;
    }

    getBrokerClosedAt(payload) {
        const trade = payload?.trade;
        const closeTime =
            trade?.closeTime ||
            trade?.closedTime ||
            payload?.orderFillTransaction?.time ||
            null;

        return this.parseBrokerTimestamp(closeTime, Date.now());
    }

    parseBrokerTimestamp(value, fallback = null) {
        if (value === null || value === undefined || value === "") {
            return fallback;
        }

        // Accept-Datetime-Format: UNIX returns decimal seconds as a string.
        // Date.parse("1710000000.123") is implementation-dependent, so parse
        // numeric values explicitly and normalize seconds to milliseconds.
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric < 100000000000 ? Math.round(numeric * 1000) : numeric;
        }

        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    getFillEffects(fillTransaction = {}) {
        return {
            tradeOpened: fillTransaction?.tradeOpened || null,
            tradeReduced: fillTransaction?.tradeReduced || null,
            tradesClosed: Array.isArray(fillTransaction?.tradesClosed)
                ? fillTransaction.tradesClosed
                : [],
        };
    }

    findEffectForTrade(effects, brokerTradeId) {
        const targetId = String(brokerTradeId || "");
        if (!targetId) return null;
        return (
            effects.tradesClosed.find(
                (effect) => String(effect?.tradeID || "") === targetId
            ) ||
            (String(effects.tradeReduced?.tradeID || "") === targetId
                ? effects.tradeReduced
                : null)
        );
    }

    getCostBreakdown({ fillTransaction = {}, effect = null, trade = null } = {}) {
        const grossRealizedPL =
            this.normalizeNumber(effect?.realizedPL) ??
            this.normalizeNumber(fillTransaction?.pl) ??
            this.normalizeNumber(trade?.realizedPL);
        const financing =
            this.normalizeNumber(effect?.financing) ??
            this.normalizeNumber(fillTransaction?.financing) ??
            this.normalizeNumber(trade?.financing) ??
            0;
        const commission = Math.abs(
            this.normalizeNumber(effect?.commission) ??
            this.normalizeNumber(fillTransaction?.commission) ??
            this.normalizeNumber(trade?.commission) ??
            0);
        const guaranteedExecutionFee = Math.abs(
            this.normalizeNumber(effect?.guaranteedExecutionFee) ??
            this.normalizeNumber(fillTransaction?.guaranteedExecutionFee) ??
            this.normalizeNumber(trade?.guaranteedExecutionFee) ??
            0);
        const dividendAdjustment =
            this.normalizeNumber(effect?.dividendAdjustment) ??
            this.normalizeNumber(fillTransaction?.dividendAdjustment) ??
            this.normalizeNumber(trade?.dividendAdjustment) ??
            0;

        return {
            grossRealizedPL,
            financing,
            commission,
            guaranteedExecutionFee,
            dividendAdjustment,
            totalRealizedPL:
                grossRealizedPL === null
                    ? null
                    : grossRealizedPL +
                      financing -
                      commission -
                      guaranteedExecutionFee +
                      dividendAdjustment,
        };
    }

    isApproxBreakeven(localTrade, closePrice) {
        if (!localTrade?.breakevenHit) return false;
        if (!Number.isFinite(closePrice) || !Number.isFinite(localTrade.entryPrice)) {
            return false;
        }

        const tolerance = this.getPipValue(localTrade.instrument) * 2;
        return Math.abs(closePrice - localTrade.entryPrice) <= tolerance;
    }

    determineExitReason(payload, localTrade, fallbackExitReason = "EXTERNAL") {
        const trade = payload?.trade;
        const closePrice = this.normalizeNumber(trade?.averageClosePrice);

        if (trade?.trailingStopLossOrder?.state === "FILLED") {
            return {
                exitReason: "TRAILING_STOP",
                brokerExitReason: "TRAILING_STOP_LOSS_ORDER_FILLED",
            };
        }

        if (trade?.takeProfitOrder?.state === "FILLED") {
            return {
                exitReason: "TAKE_PROFIT",
                brokerExitReason: "TAKE_PROFIT_ORDER_FILLED",
            };
        }

        if (trade?.stopLossOrder?.state === "FILLED") {
            return {
                exitReason: this.isApproxBreakeven(localTrade, closePrice)
                    ? "BREAKEVEN_STOP"
                    : "STOP_LOSS",
                brokerExitReason: "STOP_LOSS_ORDER_FILLED",
            };
        }

        if (trade?.state === "CLOSED") {
            return {
                exitReason: fallbackExitReason,
                brokerExitReason: "BROKER_REPORTED_CLOSED",
            };
        }

        return {
            exitReason: fallbackExitReason,
            brokerExitReason: null,
        };
    }

    resolveDirectClose({
        localTrade,
        closeResult,
        fallbackExitPrice,
        fallbackExitReason = "MANUAL",
    }) {
        const orderFill = closeResult?.orderFillTransaction || null;
        const effects = this.getFillEffects(orderFill);
        const targetEffect = this.findEffectForTrade(
            effects,
            localTrade?.oandaTradeId
        );
        const brokerConfirmedClosed = Boolean(
            orderFill &&
                targetEffect &&
                effects.tradesClosed.includes(targetEffect)
        );
        const brokerConfirmedReduced = Boolean(
            orderFill &&
                targetEffect &&
                targetEffect === effects.tradeReduced
        );
        const exitPrice =
            this.normalizeNumber(targetEffect?.price) ??
            this.normalizeNumber(orderFill?.price) ??
            fallbackExitPrice;
        const costs = this.getCostBreakdown({
            fillTransaction: orderFill,
            effect: targetEffect,
        });

        return {
            exitPrice,
            exitReason: fallbackExitReason,
            closePriceSource: brokerConfirmedClosed
                ? "BROKER_FILL"
                : "LOCAL_MARKET_FALLBACK",
            reconciliationStatus: brokerConfirmedClosed
                ? "DIRECT_FILL"
                : brokerConfirmedReduced
                ? "PARTIAL_CLOSE"
                : "UNRESOLVED",
            brokerConfirmedClosed,
            brokerConfirmedReduced,
            fillEffects: effects,
            brokerExitReason: fallbackExitReason,
            brokerClosedAt: this.getBrokerClosedAt(closeResult),
            lastBrokerSyncAt: Date.now(),
            brokerReconciliationPayload: closeResult || null,
            oandaRealizedPL: costs.totalRealizedPL,
            oandaGrossRealizedPL: costs.grossRealizedPL,
            oandaFinancing: costs.financing,
            oandaCommission: costs.commission,
            oandaGuaranteedExecutionFee: costs.guaranteedExecutionFee,
            oandaDividendAdjustment: costs.dividendAdjustment,
            activeStopType: localTrade?.activeStopType || null,
        };
    }

    resolveExternalClose({
        localTrade,
        tradeDetails,
        fallbackExitPrice,
        fallbackPriceSource = "LOCAL_MARKET_FALLBACK",
        fallbackExitReason = "EXTERNAL",
        lookupError = null,
    }) {
        const brokerExitPrice =
            this.normalizeNumber(tradeDetails?.trade?.averageClosePrice);
        const exitPrice = brokerExitPrice ?? fallbackExitPrice;
        const resolvedReason = this.determineExitReason(
            tradeDetails,
            localTrade,
            fallbackExitReason
        );
        const brokerConfirmedClosed = tradeDetails?.trade?.state === "CLOSED";
        const costs = this.getCostBreakdown({ trade: tradeDetails?.trade });

        return {
            exitPrice,
            exitReason: resolvedReason.exitReason,
            closePriceSource: brokerExitPrice
                ? "BROKER_CLOSE"
                : fallbackPriceSource,
            reconciliationStatus: tradeDetails?.trade
                ? brokerConfirmedClosed && brokerExitPrice
                    ? "RECONCILED"
                    : "PARTIAL"
                : "UNRESOLVED",
            brokerConfirmedClosed,
            brokerConfirmedReduced: false,
            brokerAccountingComplete: brokerConfirmedClosed && brokerExitPrice !== null && costs.grossRealizedPL !== null,
            brokerExitReason: resolvedReason.brokerExitReason,
            brokerClosedAt: this.getBrokerClosedAt(tradeDetails),
            lastBrokerSyncAt: Date.now(),
            brokerReconciliationPayload: tradeDetails?.trade
                ? tradeDetails
                : lookupError
                ? {
                      error: lookupError.message,
                      type: lookupError.name || "Error",
                  }
                : null,
            oandaRealizedPL: costs.totalRealizedPL,
            oandaGrossRealizedPL: costs.grossRealizedPL,
            oandaFinancing: costs.financing,
            oandaCommission: costs.commission,
            oandaGuaranteedExecutionFee: costs.guaranteedExecutionFee,
            oandaDividendAdjustment: costs.dividendAdjustment,
            activeStopType: localTrade?.activeStopType || null,
        };
    }
}

module.exports = TradeReconciliationService;
