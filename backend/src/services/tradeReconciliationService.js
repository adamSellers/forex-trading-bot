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

        if (!closeTime) return Date.now();

        const parsed = Date.parse(closeTime);
        return Number.isFinite(parsed) ? parsed : Date.now();
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
        const exitPrice =
            this.normalizeNumber(orderFill?.price) ?? fallbackExitPrice;

        return {
            exitPrice,
            exitReason: fallbackExitReason,
            closePriceSource: this.normalizeNumber(orderFill?.price)
                ? "BROKER_FILL"
                : "LOCAL_MARKET_FALLBACK",
            reconciliationStatus: orderFill ? "DIRECT_FILL" : "UNRESOLVED",
            brokerExitReason: fallbackExitReason,
            brokerClosedAt: this.getBrokerClosedAt(closeResult),
            lastBrokerSyncAt: Date.now(),
            brokerReconciliationPayload: closeResult || null,
            oandaRealizedPL: this.normalizeNumber(orderFill?.pl),
            oandaFinancing: this.normalizeNumber(orderFill?.financing) ?? 0,
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

        return {
            exitPrice,
            exitReason: resolvedReason.exitReason,
            closePriceSource: brokerExitPrice
                ? "BROKER_CLOSE"
                : fallbackPriceSource,
            reconciliationStatus: tradeDetails?.trade
                ? brokerExitPrice
                    ? "RECONCILED"
                    : "PARTIAL"
                : "UNRESOLVED",
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
            oandaRealizedPL: this.normalizeNumber(tradeDetails?.trade?.realizedPL),
            oandaFinancing:
                this.normalizeNumber(tradeDetails?.trade?.financing) ?? 0,
            activeStopType: localTrade?.activeStopType || null,
        };
    }
}

module.exports = TradeReconciliationService;
