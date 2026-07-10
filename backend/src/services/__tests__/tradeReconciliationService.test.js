const TradeReconciliationService = require("../tradeReconciliationService");

describe("TradeReconciliationService", () => {
    let service;

    beforeEach(() => {
        service = new TradeReconciliationService();
    });

    test("parses Oanda UNIX decimal-second timestamps without falling back to local time", () => {
        expect(service.parseBrokerTimestamp("1710000000.125")).toBe(
            1710000000125
        );
        expect(service.parseBrokerTimestamp(1710000000125)).toBe(1710000000125);
    });

    test("requires an explicit matching tradesClosed effect and includes every broker cost", () => {
        const result = service.resolveDirectClose({
            localTrade: {
                oandaTradeId: "489",
                activeStopType: "TRAILING",
            },
            closeResult: {
                orderFillTransaction: {
                    time: "1710000000.125",
                    price: "1.10200",
                    pl: "2.50",
                    financing: "-0.02",
                    commission: "-0.10",
                    guaranteedExecutionFee: "-0.03",
                    dividendAdjustment: "0.01",
                    tradesClosed: [
                        {
                            tradeID: "489",
                            price: "1.10210",
                            realizedPL: "2.50",
                            financing: "-0.02",
                        },
                    ],
                },
            },
            fallbackExitPrice: 1.1019,
            fallbackExitReason: "MANUAL",
        });

        expect(result).toEqual(
            expect.objectContaining({
                brokerConfirmedClosed: true,
                reconciliationStatus: "DIRECT_FILL",
                exitPrice: 1.1021,
                brokerClosedAt: 1710000000125,
                oandaGrossRealizedPL: 2.5,
                oandaFinancing: -0.02,
                oandaCommission: -0.1,
                oandaGuaranteedExecutionFee: -0.03,
                oandaDividendAdjustment: 0.01,
                oandaRealizedPL: 2.36,
            })
        );
    });

    test("reports tradeReduced as a partial close, never a confirmed full close", () => {
        const result = service.resolveDirectClose({
            localTrade: { oandaTradeId: "489" },
            closeResult: {
                orderFillTransaction: {
                    price: "1.10200",
                    tradeReduced: {
                        tradeID: "489",
                        units: "100",
                        realizedPL: "0.50",
                    },
                },
            },
            fallbackExitPrice: 1.1019,
        });

        expect(result).toEqual(
            expect.objectContaining({
                brokerConfirmedClosed: false,
                brokerConfirmedReduced: true,
                reconciliationStatus: "PARTIAL_CLOSE",
            })
        );
    });

    test("does not confirm an external close unless Oanda reports CLOSED", () => {
        const result = service.resolveExternalClose({
            localTrade: { instrument: "AUD_USD", entryPrice: 1.1 },
            tradeDetails: {
                trade: {
                    id: "489",
                    state: "OPEN",
                    averageClosePrice: null,
                },
            },
            fallbackExitPrice: 1.1,
        });

        expect(result.brokerConfirmedClosed).toBe(false);
        expect(result.reconciliationStatus).toBe("PARTIAL");
    });
});
