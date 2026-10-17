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

    test('historical hydration preserves the original broker payload and adds separately attributable timing proof', () => {
        const localTrade = { isOpen: false, oandaTradeId: '2858', brokerReconciliationPayload: {
            close: { accounting: 'original' }, liveRuntime: { entryTelemetry: { retained: true } },
        } };
        const original = JSON.parse(JSON.stringify(localTrade));
        const tradeDetails = { trade: { id: '2858', state: 'CLOSED', closeTime: '1710000000.125' } };
        expect(service.recoverHistoricalCloseTime({ localTrade, tradeDetails, recoveredAt: 1800000000000 })).toEqual({
            ...localTrade.brokerReconciliationPayload,
            closeTimeEvidence: { brokerTradeId: '2858', confirmedBrokerClosedAt: 1710000000125,
                source: 'BROKER_CLOSED_TRADE' },
            historicalCloseTimeRecovery: { recoveredAt: 1800000000000, tradeDetails },
        });
        expect(localTrade).toEqual(original);
    });

    test.each([
        { id: 'another', state: 'CLOSED', closeTime: '1710000000.125' },
        { id: '2858', state: 'OPEN', closeTime: '1710000000.125' },
        { id: '2858', state: 'CLOSED' },
        { id: '2858', state: 'CLOSED', closeTime: 'invalid' },
        { id: '2858', instrument: 'AUD_USD', state: 'CLOSED', closeTime: '1710000000.125' },
        { id: '2858', initialUnits: '-10', state: 'CLOSED', closeTime: '1710000000.125' },
    ])('historical hydration rejects unproven closure: %j', (trade) => {
        expect(service.recoverHistoricalCloseTime({ localTrade: { isOpen: false, oandaTradeId: '2858',
            instrument: 'GBP_USD', side: 'BUY' },
            tradeDetails: { trade } })).toBeNull();
    });

    // Minimal authenticated broker GET captures retained in
    // docs/reviews/evidence/2026-10-17/recovered-close-proof.json.
    test.each([
        { id: '2867', instrument: 'AUD_USD', state: 'CLOSED', closeTime: '2026-06-01T13:21:31.252307297Z' },
        { id: '2858', instrument: 'GBP_USD', state: 'CLOSED', closeTime: '2026-05-28T00:55:35.281739993Z' },
    ])('accepts the authentic minimal broker close-time record for $id', (trade) => {
        const payload = service.recoverHistoricalCloseTime({ localTrade: {
            isOpen: false, oandaTradeId: trade.id, instrument: trade.instrument, side: 'BUY',
        }, tradeDetails: { trade } });
        expect(payload.closeTimeEvidence).toEqual({ brokerTradeId: trade.id,
            confirmedBrokerClosedAt: Date.parse(trade.closeTime), source: 'BROKER_CLOSED_TRADE' });
    });

    test.each([undefined, 'invalid'])('a missing or invalid broker close time (%s) is not measurement evidence', (closeTime) => {
        const result = service.resolveExternalClose({
            localTrade: { oandaTradeId: '489', instrument: 'AUD_USD' },
            tradeDetails: { trade: { id: '489', state: 'CLOSED', closeTime,
                averageClosePrice: '1.102', realizedPL: '2.5' } },
        });
        expect(result.brokerAccountingComplete).toBe(true);
        expect(result.brokerClosedAt).toEqual(expect.any(Number));
        expect(result.confirmedBrokerClosedAt).toBeNull();
    });

    test('an authoritative external close time is separate from the existing accounting timestamp fallback', () => {
        const result = service.resolveExternalClose({
            localTrade: { oandaTradeId: '489', instrument: 'AUD_USD' },
            tradeDetails: { trade: { id: '489', state: 'CLOSED', closeTime: '2026-09-14T06:50:47.965000000Z',
                averageClosePrice: '0.71385', realizedPL: '0.2297' } },
        });
        expect(result.confirmedBrokerClosedAt).toBe(Date.parse('2026-09-14T06:50:47.965Z'));
        expect(result.brokerClosedAt).toBe(result.confirmedBrokerClosedAt);
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
                    commission: "0.10",
                    guaranteedExecutionFee: "0.03",
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
                confirmedBrokerClosedAt: 1710000000125,
                oandaGrossRealizedPL: 2.5,
                oandaFinancing: -0.02,
                oandaCommission: 0.1,
                oandaGuaranteedExecutionFee: 0.03,
                oandaDividendAdjustment: 0.01,
                oandaRealizedPL: 2.36,
                brokerReconciliationPayload: expect.objectContaining({
                    closeTimeEvidence: {
                        brokerTradeId: '489', confirmedBrokerClosedAt: 1710000000125,
                        source: 'BROKER_FULL_CLOSE_FILL',
                    },
                }),
            })
        );
    });

    test("reports tradeReduced as a partial close, never a confirmed full close", () => {
        const result = service.resolveDirectClose({
            localTrade: { oandaTradeId: "489" },
            closeResult: {
                orderFillTransaction: {
                    time: '1710000000.125',
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
                confirmedBrokerClosedAt: null,
            })
        );
        expect(result.brokerReconciliationPayload.closeTimeEvidence).toBeUndefined();
    });

    test('retains authoritative time through incomplete accounting and a restart with untimed trade details', () => {
        const localTrade = { oandaTradeId: '489', instrument: 'AUD_USD' };
        const incomplete = service.resolveExternalClose({
            localTrade,
            tradeDetails: { trade: { id: '489', state: 'CLOSED', closeTime: '1710000000.125' } },
            fallbackExitPrice: 1.1,
        });
        expect(incomplete.brokerAccountingComplete).toBe(false);
        expect(incomplete.brokerReconciliationPayload.closeTimeEvidence).toEqual({
            brokerTradeId: '489', confirmedBrokerClosedAt: 1710000000125, source: 'BROKER_CLOSED_TRADE',
        });

        // Existing pending-close persistence round trips this payload unchanged.
        const restoredTrade = { ...localTrade,
            brokerReconciliationPayload: JSON.parse(JSON.stringify(incomplete.brokerReconciliationPayload)) };
        const recovered = service.resolveExternalClose({
            localTrade: restoredTrade,
            tradeDetails: { trade: { id: '489', state: 'CLOSED', averageClosePrice: '1.102', realizedPL: '2.5' } },
        });
        expect(recovered.brokerAccountingComplete).toBe(true);
        expect(recovered.oandaRealizedPL).toBe(2.5);
        expect(recovered.confirmedBrokerClosedAt).toBe(1710000000125);
        expect(recovered.brokerClosedAt).not.toBe(1710000000125);
    });

    test('uses a proven direct full-close time when cumulative details have no timestamp', () => {
        const localTrade = { oandaTradeId: '489', instrument: 'AUD_USD' };
        const direct = service.resolveDirectClose({
            localTrade,
            closeResult: { orderFillTransaction: { time: '1710000000.125',
                tradesClosed: [{ tradeID: '489', price: '1.102', realizedPL: '2.5' }] } },
        });
        const recovered = service.resolveExternalClose({
            localTrade,
            closeTimeEvidence: direct.brokerReconciliationPayload.closeTimeEvidence,
            tradeDetails: { trade: { id: '489', state: 'CLOSED', averageClosePrice: '1.102', realizedPL: '2.5' } },
        });
        expect(recovered.confirmedBrokerClosedAt).toBe(1710000000125);
        expect(recovered.brokerReconciliationPayload.closeTimeEvidence.source).toBe('BROKER_FULL_CLOSE_FILL');
    });

    test.each([
        ['another broker trade', { brokerTradeId: 'other', confirmedBrokerClosedAt: 1710000000125, source: 'BROKER_FULL_CLOSE_FILL' }],
        ['a local timestamp fallback', { brokerTradeId: '489', confirmedBrokerClosedAt: 1710000000125, source: 'LOCAL_FALLBACK' }],
        ['a missing timestamp', { brokerTradeId: '489', confirmedBrokerClosedAt: null, source: 'BROKER_CLOSED_TRADE' }],
    ])('does not reuse close-time evidence from %s', (_description, evidence) => {
        const result = service.resolveExternalClose({
            localTrade: { oandaTradeId: '489', brokerReconciliationPayload: { closeTimeEvidence: evidence } },
            closeTimeEvidence: evidence,
            tradeDetails: { trade: { id: '489', state: 'CLOSED', averageClosePrice: '1.102', realizedPL: '2.5' } },
        });
        expect(result.brokerAccountingComplete).toBe(true);
        expect(result.confirmedBrokerClosedAt).toBeNull();
        expect(result.brokerReconciliationPayload.closeTimeEvidence).toBeUndefined();
    });

    test('current broker close time takes precedence over stored timing evidence', () => {
        const result = service.resolveExternalClose({
            localTrade: { oandaTradeId: '489', brokerReconciliationPayload: { closeTimeEvidence: {
                brokerTradeId: '489', confirmedBrokerClosedAt: 1710000000125, source: 'BROKER_FULL_CLOSE_FILL',
            } } },
            tradeDetails: { trade: { id: '489', state: 'CLOSED', closeTime: '1710000000.250',
                averageClosePrice: '1.102', realizedPL: '2.5' } },
        });
        expect(result.confirmedBrokerClosedAt).toBe(1710000000250);
        expect(result.brokerReconciliationPayload.closeTimeEvidence.source).toBe('BROKER_CLOSED_TRADE');
    });

    test('an unrelated closed trade cannot establish measurement lifetime evidence', () => {
        const result = service.resolveExternalClose({
            localTrade: { oandaTradeId: '489' },
            tradeDetails: { trade: { id: 'other', state: 'CLOSED', closeTime: '1710000000.125',
                averageClosePrice: '1.102', realizedPL: '2.5' } },
        });
        expect(result.confirmedBrokerClosedAt).toBeNull();
        expect(result.brokerReconciliationPayload.closeTimeEvidence).toBeUndefined();
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
        expect(result.confirmedBrokerClosedAt).toBeNull();
        expect(result.reconciliationStatus).toBe("PARTIAL");
    });
});
